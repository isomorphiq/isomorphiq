import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { Level } from "level";
import { AutomationRuleEngine } from "./automation-rule-engine.ts";
import { globalEventBus } from "@isomorphiq/core";
import { TaskDomainRules } from "./task-domain.ts";
import type { CreateTaskInputWithPriority, ExtendedUpdateTaskInput, TaskEntity } from "./task-domain.ts";
import {
    TaskSearchOptionsSchema,
    TaskSearchQuerySchema,
    type CreateSavedSearchInput,
    type CreateTaskFromTemplateInput,
    type SavedSearch,
    type SearchQuery,
    type Task,
    type TaskPriority,
    TaskPrioritySchema,
    type TaskSearchOptions,
    type TaskStatus,
    type TaskType,
    TaskSchema,
    TaskTypeSchema,
    type UpdateSavedSearchInput,
} from "./types.ts";
import type {
    TaskAssignedEvent,
    TaskCreatedEvent,
    TaskDeletedEvent,
    TaskPriorityChangedEvent,
    TaskStatusChangedEvent,
    TaskUpdatedEvent,
    WebSocketEventType,
} from "@isomorphiq/realtime";
import { ProfileManager } from "@isomorphiq/user-profile";
import type { ACPProfile, ProfileMetrics, ProfileState } from "@isomorphiq/user-profile";
import type { WebSocketManager as RealtimeWebSocketManager } from "@isomorphiq/realtime";
import { LevelDbTaskRepository } from "./persistence/leveldb-task-repository.ts";
import { EnhancedTaskService } from "./enhanced-task-service.ts";
import { TemplateManager } from "./template-manager.ts";
import { IntegrationService } from "@isomorphiq/integrations";
import { cleanupConnection, createConnection, sendPrompt, waitForTaskCompletion } from "@isomorphiq/acp";

type TaskWebSocketManager = RealtimeWebSocketManager;

type BootstrapTaskSpec = {
    title: string;
    description: string;
    priority: TaskPriority;
    type: TaskType;
    assignedTo?: string;
};

type ParseResult<T> = { success: true; value: T } | { success: false; error: string };
type TaskExecutionResult = { success: boolean; output: string; error: string };
type PackageSummary = {
    name: string;
    dir: string;
    testScript: string | null;
    typecheckScript: string | null;
};

const BootstrapTaskSpecSchema = z.object({
    title: z.string().min(1),
    description: z.string().min(1),
    priority: TaskPrioritySchema,
    type: TaskTypeSchema,
    assignedTo: z.string().min(1).optional(),
});

const extractJsonObject = (text: string): string | null => {
    const trimmed = text.trim();
    if (!trimmed) {
        return null;
    }
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
        return trimmed;
    }
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end < 0 || end <= start) {
        return null;
    }
    return trimmed.slice(start, end + 1);
};

const parseJson = (text: string): ParseResult<unknown> => {
    try {
        return { success: true, value: JSON.parse(text) };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message };
    }
};

const parseBootstrapTaskSpec = (text: string): ParseResult<BootstrapTaskSpec> => {
    const jsonText = extractJsonObject(text);
    if (!jsonText) {
        return { success: false, error: "No JSON object found in ACP output." };
    }
    const parsedJson = parseJson(jsonText);
    if (!parsedJson.success) {
        return { success: false, error: parsedJson.error };
    }
    const validated = BootstrapTaskSpecSchema.safeParse(parsedJson.value);
    if (!validated.success) {
        return { success: false, error: validated.error.message };
    }
    return { success: true, value: validated.data };
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
    if (!value || typeof value !== "object") {
        return false;
    }
    return !Array.isArray(value);
};

const toStringOrNull = (value: unknown): string | null =>
    typeof value === "string" ? value : null;

const readJsonFile = async (filePath: string): Promise<Record<string, unknown> | null> => {
    try {
        const content = await fs.readFile(filePath, "utf-8");
        const parsed = JSON.parse(content);
        return isRecord(parsed) ? parsed : null;
    } catch (error) {
        void error;
        return null;
    }
};

const readDirEntries = async (dirPath: string): Promise<string[]> => {
    try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    } catch (error) {
        void error;
        return [];
    }
};

const readFileEntries = async (dirPath: string): Promise<string[]> => {
    try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
    } catch (error) {
        void error;
        return [];
    }
};

/**
 * ProductManager - Core task management and orchestration service
 * TODO - reimplement this using `@tsimpl/core` and `@tsimpl/runtime` ; use a `struct` and `impl` pattern.
 *
 * This is the main orchestrator for the task management system. It provides:
 * - High-level task operations with business logic
 * - Template and automation integration
 * - Event-driven coordination between components
 * - Dependency management and validation
 * - Task processing orchestration
 */
export class ProductManager {
    private taskService: EnhancedTaskService;
    private templateManager: TemplateManager;
    private automationEngine: AutomationRuleEngine;
    private db: Level<string, unknown>;
    private savedSearchesDb: Level<string, SavedSearch>;
    private integrationDb: Level<string, unknown>;
    private integrationService: IntegrationService;
    private profileManager: ProfileManager;
    private activeTaskIds = new Set<string>();
    private processLoopStartedAt = 0;
    private isInitialized = false;
    private wsManager: TaskWebSocketManager | null = null;

    constructor(dbPath?: string) {
        // Initialize LevelDB
        const workspaceRoot = process.env.INIT_CWD ?? process.cwd();
        const envDbPath = process.env.DB_PATH;
        const resolvedEnvPath = envDbPath
            ? (path.isAbsolute(envDbPath) ? envDbPath : path.join(workspaceRoot, envDbPath))
            : undefined;
        const databasePath = dbPath ?? resolvedEnvPath ?? path.join(workspaceRoot, "db");
        this.db = new Level<string, unknown>(databasePath, { valueEncoding: "json" });
        this.savedSearchesDb = new Level<string, SavedSearch>(
            path.join(process.cwd(), "saved-searches-db"),
            { valueEncoding: "json" },
        );
        this.integrationDb = new Level<string, unknown>(
            path.join(databasePath, "integrations"),
            { valueEncoding: "json" },
        );

        // Initialize repository and service - use tasks subdirectory
        const tasksPath = path.join(databasePath, "tasks");
        const taskRepository = new LevelDbTaskRepository(tasksPath);
        this.taskService = new EnhancedTaskService(taskRepository);

        // Initialize supporting services
        this.templateManager = new TemplateManager(databasePath);
        this.automationEngine = new AutomationRuleEngine();
        this.integrationService = new IntegrationService(this.integrationDb);
        this.profileManager = new ProfileManager();

        // Setup event handlers
        this.setupEventHandlers();
    }

	/**
	 * Initialize ProductManager and all its dependencies
	 */
	async initialize(): Promise<void> {
		if (this.isInitialized) {
			return;
		}

		try {
			// Open database
            await this.db.open();
            console.log("[PRODUCT-MANAGER] Database opened successfully");

			// Initialize templates
            await this.templateManager.createPredefinedTemplates();
            console.log("[PRODUCT-MANAGER] Templates initialized");

			// Load automation rules
            await this.loadAutomationRules();
            console.log("[PRODUCT-MANAGER] Automation rules loaded");

            await this.savedSearchesDb.open();
            console.log("[PRODUCT-MANAGER] Saved searches database opened");

            await this.integrationDb.open();
            await this.integrationService.initialize();
            console.log("[PRODUCT-MANAGER] Integration service initialized");

			this.isInitialized = true;
			console.log("[PRODUCT-MANAGER] Initialization completed");
		} catch (error) {
			console.error("[PRODUCT-MANAGER] Initialization failed:", error);
			throw error;
		}
	}

	/**
	 * Set WebSocket manager for real-time updates
	 */
	setWebSocketManager(wsManager: TaskWebSocketManager): void {
		this.wsManager = wsManager;
	}

	/**
	 * Get WebSocket manager
	 */
	getWebSocketManager(): TaskWebSocketManager | null {
		return this.wsManager;
	}

    getIntegrationService(): IntegrationService {
        return this.integrationService;
    }

	// ==================== TASK CRUD OPERATIONS ====================

	/**
	 * Create a new task with full validation and business logic
	 */
	async createTask(
		title: string,
		description: string,
		priority: "low" | "medium" | "high" = "medium",
		dependencies: string[] = [],
		createdBy?: string,
		assignedTo?: string,
		collaborators?: string[],
		watchers?: string[],
		_type: TaskType = "task",
	): Promise<Task> {
		await this.ensureInitialized();

		const input: CreateTaskInputWithPriority & { type?: TaskType } = {
			title,
			description,
			priority,
			dependencies,
			type: _type,
			...(assignedTo && { assignedTo }),
			...(collaborators && { collaborators }),
			...(watchers && { watchers }),
		};

		const result = await this.taskService.createTask(input, createdBy || "system");
		if (!result.success) {
			throw new Error(`Failed to create task: ${result.error.message}`);
		}

		const task = this.convertTaskEntityToTask(result.data);

		// Broadcast to WebSocket clients
		if (this.wsManager) {
			this.wsManager.broadcastTaskCreated(task);
		}

		console.log(`[PRODUCT-MANAGER] Created task: ${task.id}`);
		return task;
	}

	/**
	 * Get a specific task by ID
	 */
	async getTask(id: string): Promise<Task | null> {
		await this.ensureInitialized();

		const result = await this.taskService.getTask(id);
		if (!result.success || !result.data) {
			return null;
		}

		return this.convertTaskEntityToTask(result.data);
	}

	/**
	 * Get all tasks
	 */
	async getAllTasks(): Promise<Task[]> {
		await this.ensureInitialized();

		const result = await this.taskService.getAllTasks();
		if (!result.success) {
			return [];
		}

		return result.data.map((task) => this.convertTaskEntityToTask(task));
	}

	/**
	 * Update a task
	 */
    async updateTask(
        id: string,
        updates: Partial<{
            title: string;
            description: string;
            status: TaskStatus;
            priority: "low" | "medium" | "high";
            assignedTo: string;
            collaborators: string[];
            watchers: string[];
            dependencies: string[];
        }>,
        updatedBy?: string,
    ): Promise<Task> {
		await this.ensureInitialized();

		const input: ExtendedUpdateTaskInput = { id, ...updates };
		const result = await this.taskService.updateTask(id, input, updatedBy || "system");

		if (!result.success) {
			throw new Error(`Failed to update task: ${result.error.message}`);
		}

		const task = this.convertTaskEntityToTask(result.data);

		// Broadcast to WebSocket clients
		if (this.wsManager) {
			this.wsManager.broadcastTaskUpdated(task, updates);
		}

		console.log(`[PRODUCT-MANAGER] Updated task: ${task.id}`);
		return task;
	}

	/**
	 * Delete a task
	 */
	async deleteTask(id: string, deletedBy?: string): Promise<void> {
		await this.ensureInitialized();

		const result = await this.taskService.deleteTask(id, deletedBy || "system");
		if (!result.success) {
			throw new Error(`Failed to delete task: ${result.error.message}`);
		}

		// Broadcast to WebSocket clients
		if (this.wsManager) {
			this.wsManager.broadcastTaskDeleted(id);
		}

		console.log(`[PRODUCT-MANAGER] Deleted task: ${id}`);
	}

	// ==================== TASK MANAGEMENT OPERATIONS ====================

	/**
	 * Update task status with validation and business logic
	 */
	async updateTaskStatus(id: string, status: TaskStatus, updatedBy?: string): Promise<Task> {
		await this.ensureInitialized();

		const result = await this.taskService.updateTaskStatus(id, status, updatedBy || "system");
		if (!result.success) {
			throw new Error(`Failed to update task status: ${result.error?.message}`);
		}

		const task = this.convertTaskEntityToTask(result.data);

		// Broadcast to WebSocket clients
		if (this.wsManager) {
			const oldTask = await this.getTask(id);
			const oldStatus = oldTask?.status || "todo";
			this.wsManager.broadcastTaskStatusChanged(id, oldStatus, status, task);
		}

		console.log(`[PRODUCT-MANAGER] Updated task status: ${id} -> ${status}`);
		return task;
	}

	/**
	 * Update task priority
	 */
	async updateTaskPriority(
		id: string,
		priority: "low" | "medium" | "high",
		updatedBy?: string,
	): Promise<Task> {
		await this.ensureInitialized();

		const result = await this.taskService.updateTaskPriority(id, priority, updatedBy || "system");
		if (!result.success) {
			throw new Error(`Failed to update task priority: ${result.error?.message}`);
		}

		const task = this.convertTaskEntityToTask(result.data);

		// Broadcast to WebSocket clients
		if (this.wsManager) {
			const oldTask = await this.getTask(id);
			const oldPriority = oldTask?.priority || "medium";
			this.wsManager.broadcastTaskPriorityChanged(id, oldPriority, priority, task);
		}

		console.log(`[PRODUCT-MANAGER] Updated task priority: ${id} -> ${priority}`);
		return task;
	}

	/**
	 * Assign task to a user
	 */
	async assignTask(id: string, assignedTo: string, assignedBy?: string): Promise<Task> {
		await this.ensureInitialized();

		const result = await this.taskService.assignTask(id, assignedTo, assignedBy || "system");
		if (!result.success) {
			throw new Error(`Failed to assign task: ${result.error?.message}`);
		}

		const task = this.convertTaskEntityToTask(result.data);

		// Broadcast to WebSocket clients
		if (this.wsManager) {
			this.wsManager.broadcastTaskAssigned(task, assignedTo, assignedBy || "system");
		}

		console.log(`[PRODUCT-MANAGER] Assigned task: ${id} -> ${assignedTo}`);
		return task;
	}

	/**
	 * Add collaborator to task
	 */
	async addCollaborator(id: string, userId: string, updatedBy?: string): Promise<Task> {
		await this.ensureInitialized();

		const result = await this.taskService.addCollaborator(id, userId, updatedBy || "system");
		if (!result.success) {
			throw new Error(`Failed to add collaborator: ${result.error?.message}`);
		}

		const task = this.convertTaskEntityToTask(result.data);
		console.log(`[PRODUCT-MANAGER] Added collaborator: ${id} -> ${userId}`);
		return task;
	}

	/**
	 * Remove collaborator from task
	 */
	async removeCollaborator(id: string, userId: string, updatedBy?: string): Promise<Task> {
		await this.ensureInitialized();

		const result = await this.taskService.removeCollaborator(id, userId, updatedBy || "system");
		if (!result.success) {
			throw new Error(`Failed to remove collaborator: ${result.error?.message}`);
		}

		const task = this.convertTaskEntityToTask(result.data);
		console.log(`[PRODUCT-MANAGER] Removed collaborator: ${id} <- ${userId}`);
		return task;
	}

	/**
	 * Add dependency to task
	 */
	async addDependency(id: string, dependsOn: string, updatedBy?: string): Promise<Task> {
		await this.ensureInitialized();

		const result = await this.taskService.addDependency(id, dependsOn, updatedBy || "system");
		if (!result.success) {
			throw new Error(`Failed to add dependency: ${result.error?.message}`);
		}

		const task = this.convertTaskEntityToTask(result.data);
		console.log(`[PRODUCT-MANAGER] Added dependency: ${id} -> ${dependsOn}`);
		return task;
	}

	/**
	 * Remove dependency from task
	 */
    async removeDependency(id: string, dependsOn: string, updatedBy?: string): Promise<Task> {
        await this.ensureInitialized();

        const result = await this.taskService.removeDependency(id, dependsOn, updatedBy || "system");
        if (!result.success) {
			throw new Error(`Failed to remove dependency: ${result.error?.message}`);
		}

		const task = this.convertTaskEntityToTask(result.data);
        console.log(`[PRODUCT-MANAGER] Removed dependency: ${id} <- ${dependsOn}`);
        return task;
    }

    async updateTaskDependencies(
        id: string,
        dependencies: string[],
        updatedBy?: string,
    ): Promise<Task> {
        return await this.updateTask(id, { dependencies }, updatedBy);
    }

    async updateTaskAssignment(id: string, assignedTo: string, updatedBy?: string): Promise<Task> {
        return await this.assignTask(id, assignedTo, updatedBy);
    }

    async updateTaskCollaborators(
        id: string,
        collaborators: string[],
        updatedBy?: string,
    ): Promise<Task> {
        return await this.updateTask(id, { collaborators }, updatedBy);
    }

    async updateTaskWatchers(
        id: string,
        watchers: string[],
        updatedBy?: string,
    ): Promise<Task> {
        return await this.updateTask(id, { watchers }, updatedBy);
    }

    async hasTaskAccess(
        userId: string,
        taskId: string,
        _action: "read" | "write" | "delete" = "read",
    ): Promise<boolean> {
        void _action;
        const task = await this.getTask(taskId);
        if (!task) return false;
        if (task.createdBy === userId) return true;
        if (task.assignedTo === userId) return true;
        if (task.collaborators?.includes(userId)) return true;
        if (task.watchers?.includes(userId)) return true;
        return true;
    }

	// ==================== QUERY AND SEARCH OPERATIONS ====================

	/**
	 * Get tasks by status
	 */
	async getTasksByStatus(status: TaskStatus): Promise<Task[]> {
		await this.ensureInitialized();

		const result = await this.taskService.getTasksByStatus(status);
		if (!result.success) {
			return [];
		}

		return result.data.map((task) => this.convertTaskEntityToTask(task));
	}

	/**
	 * Get tasks for a specific user
	 */
	async getTasksForUser(
		userId: string,
		_include: ("created" | "assigned" | "collaborating" | "watching")[] = [
			"created",
			"assigned",
			"collaborating",
		],
		): Promise<Task[]> {
			await this.ensureInitialized();

			const result = await this.taskService.getTasksByUser(userId);
			if (!result.success) {
				return [];
			}

			const includeSet = new Set(_include);

			const filtered = result.data.filter((task) => {
				if (includeSet.has("created") && task.createdBy === userId) return true;
				if (includeSet.has("assigned") && task.assignedTo === userId) return true;
				if (includeSet.has("collaborating") && task.collaborators?.includes(userId)) return true;
				if (includeSet.has("watching") && task.watchers?.includes(userId)) return true;
				return false;
			});

			return filtered.map((task) => this.convertTaskEntityToTask(task));
		}

	/**
	 * Search tasks with filters and sorting
	 */
    private normalizeSearchOptions(options: TaskSearchOptions | SearchQuery): TaskSearchOptions {
        const optionsResult = TaskSearchOptionsSchema.safeParse(options);
        if (optionsResult.success) {
            return optionsResult.data;
        }

        const queryResult = TaskSearchQuerySchema.safeParse(options);
        if (!queryResult.success) {
            return {};
        }

        const query = queryResult.data;
        const mappedSort = query.sort
            ? {
                  field: query.sort.field === "relevance" ? "title" : query.sort.field,
                  direction: query.sort.direction,
              }
            : undefined;

        return {
            query: query.q,
            filters: {
                status: query.status,
                priority: query.priority,
                assignedTo: query.assignedTo,
                createdBy: query.createdBy,
                collaborators: query.collaborators,
                watchers: query.watchers,
            },
            sort: mappedSort,
            limit: query.limit,
            offset: query.offset,
        };
    }

    async searchTasks(
        options: TaskSearchOptions | SearchQuery,
    ): Promise<{ tasks: Task[]; total: number }> {
        await this.ensureInitialized();

        const normalized = this.normalizeSearchOptions(options);
        const result = await this.taskService.searchTasks(normalized);
        if (!result.success) {
            return { tasks: [], total: 0 };
        }

        return {
            tasks: result.data.tasks.map((task) => this.convertTaskEntityToTask(task)),
            total: result.data.total,
        };
    }

    generateSearchSuggestions(query: string | undefined, tasks: Task[]): string[] {
        if (!query || query.trim().length < 2) {
            return [];
        }

        const suggestions = new Set<string>();
        const queryLower = query.toLowerCase();

        tasks.forEach((task) => {
            const titleWords = task.title.toLowerCase().split(/\s+/);
            const descWords = task.description.toLowerCase().split(/\s+/);

            [...titleWords, ...descWords].forEach((word) => {
                if (word.includes(queryLower) && word.length > queryLower.length) {
                    suggestions.add(word);
                }
            });
        });

        return Array.from(suggestions).slice(0, 10);
    }

    private async ensureSavedSearchesDbOpen(): Promise<void> {
        try {
            await this.savedSearchesDb.open();
        } catch (error) {
            console.error("[SAVED_SEARCHES_DB] Failed to open database:", error);
            throw error;
        }
    }

    async createSavedSearch(input: CreateSavedSearchInput, createdBy: string): Promise<SavedSearch> {
        await this.ensureSavedSearchesDbOpen();

        const id = `saved-search-${Date.now()}`;
        const savedSearch: SavedSearch = {
            id,
            name: input.name,
            description: input.description,
            query: input.query,
            createdBy,
            isPublic: input.isPublic || false,
            createdAt: new Date(),
            updatedAt: new Date(),
            usageCount: 0,
        };

        await this.savedSearchesDb.put(id, savedSearch);
        console.log(`[SAVED_SEARCHES_DB] Created saved search: ${id}`);
        return savedSearch;
    }

    async getSavedSearches(userId?: string): Promise<SavedSearch[]> {
        await this.ensureSavedSearchesDbOpen();

        const searches: SavedSearch[] = [];
        const iterator = this.savedSearchesDb.iterator();

        try {
            for await (const [, value] of iterator) {
                if (value.isPublic || (userId && value.createdBy === userId)) {
                    searches.push(value);
                }
            }
        } catch (error) {
            console.error("[SAVED_SEARCHES_DB] Error reading saved searches:", error);
            throw error;
        } finally {
            try {
                await iterator.close();
            } catch (closeError) {
                console.error("[SAVED_SEARCHES_DB] Error closing iterator:", closeError);
            }
        }

        return searches.sort(
            (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
        );
    }

    async getSavedSearch(id: string, userId?: string): Promise<SavedSearch | null> {
        await this.ensureSavedSearchesDbOpen();

        try {
            const savedSearch = await this.savedSearchesDb.get(id);
            if (!savedSearch.isPublic && (!userId || savedSearch.createdBy !== userId)) {
                return null;
            }

            savedSearch.usageCount++;
            savedSearch.updatedAt = new Date();
            await this.savedSearchesDb.put(id, savedSearch);

            return savedSearch;
        } catch (_error) {
            void _error;
            return null;
        }
    }

    async updateSavedSearch(input: UpdateSavedSearchInput, userId: string): Promise<SavedSearch> {
        await this.ensureSavedSearchesDbOpen();

        const existingSearch = await this.savedSearchesDb.get(input.id).catch(() => null);
        if (!existingSearch) {
            throw new Error("Saved search not found");
        }

        if (existingSearch.createdBy !== userId) {
            throw new Error("Not authorized to update this saved search");
        }

        const updatedSearch: SavedSearch = {
            ...existingSearch,
            ...(input.name && { name: input.name }),
            ...(input.description !== undefined && { description: input.description }),
            ...(input.query && { query: input.query }),
            ...(input.isPublic !== undefined && { isPublic: input.isPublic }),
            updatedAt: new Date(),
        };

        await this.savedSearchesDb.put(input.id, updatedSearch);
        console.log(`[SAVED_SEARCHES_DB] Updated saved search: ${input.id}`);
        return updatedSearch;
    }

    async deleteSavedSearch(id: string, userId: string): Promise<void> {
        await this.ensureSavedSearchesDbOpen();

        const existingSearch = await this.savedSearchesDb.get(id).catch(() => null);
        if (!existingSearch) {
            throw new Error("Saved search not found");
        }

        if (existingSearch.createdBy !== userId) {
            throw new Error("Not authorized to delete this saved search");
        }

        await this.savedSearchesDb.del(id);
        console.log(`[SAVED_SEARCHES_DB] Deleted saved search: ${id}`);
    }

    /**
     * Get tasks sorted by dependencies and priority (for processing)
     */
    async getTasksSortedByDependencies(): Promise<Task[]> {
		await this.ensureInitialized();

		const result = await this.taskService.getTasksSortedByDependencies();
		if (!result.success) {
			return [];
		}

		return result.data.map((task) => this.convertTaskEntityToTask(task));
	}

	// ==================== TEMPLATE OPERATIONS ====================

	/**
	 * Create task from template
	 */
	async createTaskFromTemplate(
		input: CreateTaskFromTemplateInput,
	): Promise<{ mainTask: Task; subtasks: Task[] }> {
		await this.ensureInitialized();

		const result = await this.templateManager.createTaskFromTemplate(
			input,
			this.createTask.bind(this),
		);
		const { mainTask, subtasks } = result;

		console.log(
			`[PRODUCT-MANAGER] Created task from template: ${result.mainTask.id} with ${subtasks.length} subtasks`,
		);
		return { mainTask, subtasks };
	}

	/**
	 * Get template manager instance
	 */
    getTemplateManager(): TemplateManager {
        return this.templateManager;
    }

    getProfilesWithStates(): Array<{
        profile: ACPProfile;
        state: ProfileState;
        metrics: ProfileMetrics;
    }> {
        const profiles = this.profileManager.getAllProfiles();
        return profiles.map((profile) => {
            const state =
                this.profileManager.getProfileState(profile.name) ??
                ({
                    name: profile.name,
                    isActive: true,
                    currentTasks: 0,
                    completedTasks: 0,
                    failedTasks: 0,
                    averageProcessingTime: 0,
                    lastActivity: new Date(),
                    queueSize: 0,
                    isProcessing: false,
                } satisfies ProfileState);
            const metrics =
                this.profileManager.getProfileMetrics(profile.name) ??
                ({
                    throughput: 0,
                    successRate: 100,
                    averageTaskDuration: 0,
                    queueWaitTime: 0,
                    errorRate: 0,
                } satisfies ProfileMetrics);
            return { profile, state, metrics };
        });
    }

    getAllProfileStates(): ProfileState[] {
        return this.profileManager.getAllProfileStates();
    }

    getProfileState(name: string): ProfileState | undefined {
        return this.profileManager.getProfileState(name);
    }

    getProfileMetrics(name: string): ProfileMetrics | undefined {
        return this.profileManager.getProfileMetrics(name);
    }

    getAllProfileMetrics(): Map<string, ProfileMetrics> {
        return this.profileManager.getAllProfileMetrics();
    }

    getProfileTaskQueue(name: string): Task[] {
        const queue = this.profileManager.getTaskQueue(name);
        return queue
            .map((entry) => TaskSchema.safeParse(entry))
            .filter((entry) => entry.success)
            .map((entry) => entry.data);
    }

    updateProfileStatus(name: string, isActive: boolean): boolean {
        const state = this.profileManager.getProfileState(name);
        if (!state) {
            return false;
        }
        this.profileManager.updateProfileState(name, { isActive });
        return true;
    }

    assignTaskToProfile(name: string, task: Task): boolean {
        const profile = this.profileManager.getProfile(name);
        if (!profile) {
            return false;
        }
        this.profileManager.addToTaskQueue(name, task);
        return true;
    }

    getBestProfileForTask(task: Task): ACPProfile | undefined {
        if (task.assignedTo) {
            const assignedProfile = this.profileManager.getProfile(task.assignedTo);
            if (assignedProfile) {
                return assignedProfile;
            }
        }
        return this.profileManager.getBestProfileForTask(task);
    }

    // ==================== DEPENDENCY VALIDATION ====================

	/**
	 * Validate task dependencies
	 */
	validateDependencies(tasks: Task[]): {
		isValid: boolean;
		errors: string[];
		warnings: string[];
	} {
		const taskMap = new Map<string, Task>();
		const errors: string[] = [];
		const warnings: string[] = [];

		// Build task map
		for (const task of tasks) {
			taskMap.set(task.id, task);
		}

		// Check for circular dependencies using DFS with cycle path tracking
		const visited = new Set<string>();
		const recursionStack = new Set<string>();
		const path: string[] = [];

		const findCycle = (taskId: string): string[] | null => {
			if (recursionStack.has(taskId)) {
				// Found cycle, return the cycle path
				const cycleStart = path.indexOf(taskId);
				return path.slice(cycleStart).concat([taskId]);
			}
			if (visited.has(taskId)) {
				return null; // Already processed, no cycle from this node
			}

			visited.add(taskId);
			recursionStack.add(taskId);
			path.push(taskId);

			const task = taskMap.get(taskId);
			if (task) {
				for (const depId of task.dependencies) {
					const cycle = findCycle(depId);
					if (cycle) {
						return cycle;
					}
				}
			}

			recursionStack.delete(taskId);
			path.pop();
			return null;
		};

		// Check for cycles
		for (const task of tasks) {
			if (!visited.has(task.id)) {
				const cycle = findCycle(task.id);
				if (cycle) {
					const cycleTitles = cycle.map((id) => taskMap.get(id)?.title || id).join(" -> ");
					errors.push(`Circular dependency detected: ${cycleTitles}`);
				}
			}
		}

		// Check for non-existent dependencies
		for (const task of tasks) {
			for (const depId of task.dependencies) {
				if (!taskMap.has(depId)) {
					errors.push(`Task "${task.title}" depends on non-existent task: ${depId}`);
				}
			}
		}

		// Check for self-dependencies
		for (const task of tasks) {
			if (task.dependencies.includes(task.id)) {
				errors.push(`Task "${task.title}" cannot depend on itself`);
			}
		}

		// Check for completed tasks that are dependencies
		for (const task of tasks) {
			for (const depId of task.dependencies) {
				const depTask = taskMap.get(depId);
				if (depTask && depTask.status === "done") {
					warnings.push(`Task "${task.title}" depends on completed task "${depTask.title}"`);
				}
			}
		}

		// Check for dependency depth (potential infinite chains)
		const calculateDepth = (taskId: string, visited: Set<string> = new Set()): number => {
			if (visited.has(taskId)) return 0; // Prevent infinite recursion
			visited.add(taskId);

			const task = taskMap.get(taskId);
			if (!task || task.dependencies.length === 0) return 0;

			let maxDepth = 0;
			for (const depId of task.dependencies) {
				maxDepth = Math.max(maxDepth, calculateDepth(depId, new Set(visited)));
			}

			return maxDepth + 1;
		};

		for (const task of tasks) {
			const depth = calculateDepth(task.id);
			if (depth > 10) {
				warnings.push(
					`Task "${task.title}" has a deep dependency chain (${depth} levels), which may indicate complex dependencies`,
				);
			}
		}

		return {
			isValid: errors.length === 0,
			errors,
			warnings,
		};
	}

	// ==================== TASK PROCESSING ORCHESTRATION ====================

	/**
	 * Process tasks using dependency order and priority
	 * This is the main task processing loop
	 */
	async processTasksLoop(): Promise<void> {
		console.log("[PRODUCT-MANAGER] Starting task processing loop...");
        if (this.processLoopStartedAt === 0) {
            this.processLoopStartedAt = Date.now();
        }

		while (true) {
			try {
				// Get tasks ready for processing (todo status, dependencies satisfied)
				const readyTasks = await this.getReadyTasks();

				if (readyTasks.length === 0) {
                    const recovered = await this.recoverStaleInProgressTasks();
                    if (recovered > 0) {
                        console.log(
                            `[PRODUCT-MANAGER] Recovered ${recovered} stale in-progress task(s); retrying loop.`,
                        );
                        continue;
                    }
					const seeded = await this.ensureBootstrapTask();
					if (seeded) {
						continue;
					}
					console.log("[PRODUCT-MANAGER] No tasks ready for processing. Waiting 10 seconds...");
					await new Promise((resolve) => setTimeout(resolve, 10000));
					continue;
				}

				console.log(`[PRODUCT-MANAGER] Processing ${readyTasks.length} ready tasks`);

				// Process tasks one by one (could be made parallel)
				for (const task of readyTasks) {
					await this.processTask(task);
				}

				// Brief pause between processing cycles
				await new Promise((resolve) => setTimeout(resolve, 3000));
			} catch (error) {
				console.error("[PRODUCT-MANAGER] Error in task processing loop:", error);
				console.log("[PRODUCT-MANAGER] Waiting 10 seconds before retrying...");
				await new Promise((resolve) => setTimeout(resolve, 10000));
			}
		}
	}

	private async ensureBootstrapTask(): Promise<boolean> {
		const existingTasks = await this.getAllTasks();
        const activeTasks = existingTasks.filter((task) => task.status !== "done");
		if (activeTasks.length > 0) {
			return false;
		}

        console.log("[PRODUCT-MANAGER] No active tasks found, generating bootstrap task via ACP...");
        const seed = await this.generateBootstrapTaskSpec();
        if (!seed) {
            console.log("[PRODUCT-MANAGER] Bootstrap task generation failed; waiting for next cycle.");
            return false;
        }

        const assignedTo = seed.assignedTo ?? "development";
        const task = await this.createTask(
            seed.title,
            seed.description,
            seed.priority,
            [],
            "product-manager",
            assignedTo,
            undefined,
            undefined,
            seed.type,
        );

        console.log(`[PRODUCT-MANAGER] Seeded bootstrap task: ${task.id}`);
        return true;
	}

    private async recoverStaleInProgressTasks(): Promise<number> {
        const inProgressTasks = await this.getTasksByStatus("in-progress");
        if (inProgressTasks.length === 0) {
            return 0;
        }

        const now = Date.now();
        const hasActiveProcessing = this.activeTaskIds.size > 0;
        const startupRecoveryWindowMs = 5 * 60 * 1000;
        const elapsedSinceStart = now - this.processLoopStartedAt;
        const recoveryThresholdMs =
            !hasActiveProcessing && elapsedSinceStart <= startupRecoveryWindowMs
                ? 60 * 1000
                : 10 * 60 * 1000;
        const staleTasks = inProgressTasks.filter((task) => {
            if (!task.id || this.activeTaskIds.has(task.id)) {
                return false;
            }
            if (!(task.updatedAt instanceof Date)) {
                return true;
            }
            const ageMs = now - task.updatedAt.getTime();
            return ageMs >= recoveryThresholdMs;
        });

        if (staleTasks.length === 0) {
            return 0;
        }

        let recovered = 0;
        for (const task of staleTasks) {
            if (!task.id) {
                continue;
            }
            try {
                await this.updateTaskStatus(task.id, "todo", "system");
                recovered += 1;
            } catch (error) {
                console.error(
                    `[PRODUCT-MANAGER] Failed to recover task ${task.id}:`,
                    error,
                );
            }
        }

        return recovered;
    }

    private async buildBootstrapPrompt(): Promise<string> {
        const repositoryContext = await this.collectRepositoryContext();
        const profile = this.profileManager.getProfile("product-manager");
        const baseSystemPrompt =
            profile?.systemPrompt?.trim() ??
            "You are a Product Manager AI assistant focused on product gaps and feature discovery.";
        const baseTaskPrompt =
            profile?.getTaskPrompt({}) ??
            "Analyze the repository and propose a single feature ticket that is high leverage.";
        return [
            baseSystemPrompt,
            "",
            baseTaskPrompt,
            "",
            "Before proposing a feature, orient yourself in the repo:",
            "- Read AGENTS.md and follow the workflow rules.",
            "- Read root package.json scripts to understand how the app runs.",
            "- Skim README.md and any relevant docs in docs/ and packages/**/docs.",
            "- Survey existing packages to avoid duplicating implemented features.",
            "If you lack permission to read files, return a research task that documents what needs review.",
            "",
            "Repository context (use this as a starting point):",
            repositoryContext,
            "",
            "Do repository research and pick one scoped feature or fix that is missing, stale, or incomplete.",
            "Treat the repository context above as your research findings.",
            "Prioritize gaps in functionality, missing test coverage, or UI flows backed by mock data.",
            "Pick a single feature task that fits current stack and can be implemented in one dev cycle.",
            "Do not propose tasks that already exist; include evidence of the files you checked.",
            "Respect repo conventions in AGENTS.md: 4-space indentation, double quotes, .ts extensions, no interfaces or casts, struct/trait/impl pattern.",
            "Return only JSON with this exact shape:",
            "{",
            "  \"title\": \"...\",",
            "  \"description\": \"...\",",
            "  \"priority\": \"low|medium|high\",",
            "  \"type\": \"feature|story|task|integration|research\",",
            "  \"assignedTo\": \"development\"",
            "}",
            "Description should include: problem, requirements/acceptance criteria, evidence (file paths reviewed), impacted packages/files, and testing notes.",
            "Do not include markdown fences or extra text.",
        ].join("\n");
    }

    private async generateBootstrapTaskSpec(): Promise<BootstrapTaskSpec | null> {
        const prompt = await this.buildBootstrapPrompt();
        try {
            const session = await createConnection({
                fs: {
                    readTextFile: true,
                    writeTextFile: false,
                },
            });
            try {
                await sendPrompt(session.connection, session.sessionId, prompt, session.taskClient);
                const completion = await waitForTaskCompletion(
                    session.taskClient,
                    60000,
                    "product-manager",
                );
                if (completion.error) {
                    console.error("[PRODUCT-MANAGER] ACP bootstrap prompt failed:", completion.error);
                    return null;
                }
                const output = completion.output.trim();
                if (!output) {
                    console.error("[PRODUCT-MANAGER] ACP bootstrap prompt returned empty output.");
                    return null;
                }
                const parsed = parseBootstrapTaskSpec(output);
                if (!parsed.success) {
                    console.error("[PRODUCT-MANAGER] ACP bootstrap output invalid:", parsed.error);
                    return null;
                }
                return parsed.value;
            } finally {
                await cleanupConnection(session.connection, session.processResult);
            }
        } catch (error) {
            console.error("[PRODUCT-MANAGER] ACP bootstrap prompt failed:", error);
            return null;
        }
    }

    private async collectRepositoryContext(): Promise<string> {
        const root = process.cwd();
        const packagesRoot = path.join(root, "packages");
        const servicesRoot = path.join(root, "services");
        const webPagesRoot = path.join(root, "web", "src", "pages");
        const webComponentsRoot = path.join(root, "web", "src", "components");

        const [packages, services, webPages, demoPages, backupFiles] = await Promise.all([
            this.collectPackageSummaries(packagesRoot),
            this.collectPackageSummaries(servicesRoot),
            readFileEntries(webPagesRoot),
            this.collectDemoPages(webPagesRoot),
            this.collectBackupFiles([webComponentsRoot, packagesRoot]),
        ]);

        const packageNames = packages.map((entry) => entry.name);
        const serviceNames = services.map((entry) => entry.name);
        const packagesMissingTests = packages
            .filter((entry) => !this.isScriptConfigured(entry.testScript))
            .map((entry) => entry.name);

        const lines = [
            packageNames.length > 0
                ? `Packages (${packageNames.length}): ${packageNames.join(", ")}`
                : "Packages: none found",
            serviceNames.length > 0
                ? `Services (${serviceNames.length}): ${serviceNames.join(", ")}`
                : "Services: none found",
            webPages.length > 0
                ? `Web pages (${webPages.length}): ${webPages.slice(0, 15).join(", ")}`
                : "Web pages: none found",
            demoPages.length > 0 ? `Demo pages: ${demoPages.join(", ")}` : "",
            backupFiles.length > 0 ? `Backup/vestigial files: ${backupFiles.join(", ")}` : "",
            packagesMissingTests.length > 0
                ? `Packages missing tests: ${packagesMissingTests.join(", ")}`
                : "",
        ];

        return lines.filter((line) => line.length > 0).join("\n");
    }

    private async collectPackageSummaries(rootDir: string): Promise<PackageSummary[]> {
        const dirNames = await readDirEntries(rootDir);
        const summaries = await Promise.all(
            dirNames.map(async (dirName) => {
                const packagePath = path.join(rootDir, dirName, "package.json");
                const packageJson = await readJsonFile(packagePath);
                if (!packageJson) {
                    return null;
                }
                const name = toStringOrNull(packageJson.name);
                if (!name) {
                    return null;
                }
                const scripts = isRecord(packageJson.scripts) ? packageJson.scripts : null;
                const testScript = scripts ? toStringOrNull(scripts.test) : null;
                const typecheckScript = scripts ? toStringOrNull(scripts.typecheck) : null;
                return { name, dir: dirName, testScript, typecheckScript };
            }),
        );
        return summaries.filter((entry): entry is PackageSummary => entry !== null);
    }

    private async collectDemoPages(pagesDir: string): Promise<string[]> {
        const pages = await readFileEntries(pagesDir);
        return pages.filter((page) => page.toLowerCase().includes("demo")).slice(0, 10);
    }

    private async collectBackupFiles(roots: string[]): Promise<string[]> {
        const results = await Promise.all(
            roots.map((root) => this.walkForMatchingFiles(root, 3)),
        );
        return results
            .flat()
            .filter((filePath) => filePath.toLowerCase().endsWith(".bak"))
            .map((filePath) => path.relative(process.cwd(), filePath))
            .slice(0, 10);
    }

    private async walkForMatchingFiles(root: string, depth: number): Promise<string[]> {
        if (depth < 0) {
            return [];
        }
        const entries = await this.readDirectoryWithTypes(root);
        const files = entries
            .filter((entry) => entry.type === "file")
            .map((entry) => entry.path);
        const subdirs = entries.filter((entry) => entry.type === "dir").map((entry) => entry.path);
        const nested = await Promise.all(
            subdirs.map((dir) => this.walkForMatchingFiles(dir, depth - 1)),
        );
        return files.concat(...nested);
    }

    private async readDirectoryWithTypes(
        dirPath: string,
    ): Promise<Array<{ path: string; type: "file" | "dir" }>> {
        try {
            const entries = await fs.readdir(dirPath, { withFileTypes: true });
            return entries
                .filter((entry) => entry.isFile() || entry.isDirectory())
                .map((entry) => ({
                    path: path.join(dirPath, entry.name),
                    type: entry.isDirectory() ? "dir" : "file",
                }));
        } catch (error) {
            void error;
            return [];
        }
    }

    private isScriptConfigured(script: string | null): boolean {
        if (!script) {
            return false;
        }
        const normalized = script.toLowerCase();
        if (normalized.includes("not configured")) {
            return false;
        }
        if (normalized.startsWith("echo ")) {
            return false;
        }
        return true;
    }

	/**
	 * Get tasks that are ready for processing
	 */
	private async getReadyTasks(): Promise<Task[]> {
		const allTasks = await this.getAllTasks();
		const todoTasks = allTasks.filter((task) => task.status === "todo");

		// Sort by dependencies and priority
		const sortedTasks = TaskDomainRules.sortTasksByPriorityAndDependencies(
			todoTasks.map((task) => this.convertTaskToTaskEntity(task)),
		);

		// Filter tasks whose dependencies are all completed
		const readyTasks = sortedTasks.filter((task) => {
			return task.dependencies.every((depId: string) => {
				const depTask = allTasks.find((t) => t.id === depId);
				return !depTask || depTask.status === "done";
			});
		});

		return readyTasks.map((task) => this.convertTaskEntityToTask(task));
	}

	/**
	 * Process a single task
	 */
	private async processTask(task: Task): Promise<void> {
		console.log(`[PRODUCT-MANAGER] Processing task: ${task.title} (id: ${task.id})`);

		try {
			// Mark as in-progress
			await this.updateTaskStatus(task.id, "in-progress");
            this.activeTaskIds.add(task.id);

            const profile =
                this.getBestProfileForTask(task) ?? this.profileManager.getProfile("development");
            if (!profile) {
                throw new Error("No ACP profile available to process task.");
            }

            this.profileManager.startTaskProcessing(profile.name);
            const startTime = Date.now();
            const execution = await this.executeTaskWithProfile(task, profile);
            const duration = Date.now() - startTime;
            this.profileManager.endTaskProcessing(profile.name);
            this.profileManager.recordTaskProcessing(profile.name, duration, execution.success);

            if (!execution.success) {
                throw new Error(execution.error);
            }

			// Mark as completed
			await this.updateTaskStatus(task.id, "done");

			console.log(`[PRODUCT-MANAGER] Completed task: ${task.title} (id: ${task.id})`);
		} catch (error) {
			console.error(
				`[PRODUCT-MANAGER] Failed to process task: ${task.title} (id: ${task.id})`,
				error,
			);

			// Mark as todo again for retry
			await this.updateTaskStatus(task.id, "todo");
        } finally {
            this.activeTaskIds.delete(task.id);
		}
	}

    private buildProfilePrompt(profile: ACPProfile, task: Task): string {
        const instructions = [
            profile.systemPrompt.trim(),
            "",
            "Before acting, orient yourself in the repo:",
            "- Read AGENTS.md and follow the workflow rules.",
            "- Review root package.json scripts to understand how services are started.",
            "- Skim README.md and any relevant docs in docs/ and packages/**/docs.",
            "- Survey existing packages to avoid duplicating implemented features.",
            "If you discover the task is already implemented, say so and propose a better-scoped follow-up.",
            "If you lack permission to read files, say so and proceed with the task using the context available.",
            "",
            profile.getTaskPrompt({ task }),
        ];
        return instructions.join("\n");
    }

    private async executeTaskWithProfile(
        task: Task,
        profile: ACPProfile,
    ): Promise<TaskExecutionResult> {
        const prompt = this.buildProfilePrompt(profile, task);
        try {
            const session = await createConnection();
            try {
                await sendPrompt(session.connection, session.sessionId, prompt, session.taskClient);
                const completion = await waitForTaskCompletion(
                    session.taskClient,
                    600000,
                    profile.name,
                );
                if (completion.error) {
                    console.error(`[PRODUCT-MANAGER] ACP execution failed for ${task.id}:`, completion.error);
                    return { success: false, output: completion.output, error: completion.error };
                }
                return { success: true, output: completion.output, error: "" };
            } finally {
                await cleanupConnection(session.connection, session.processResult);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error(`[PRODUCT-MANAGER] ACP execution error for ${task.id}:`, message);
            return { success: false, output: "", error: message };
        }
    }

	/**
	 * Simulate task execution (replace with actual execution logic)
	 */
	private async simulateTaskExecution(_task: Task): Promise<void> {
		console.log(`[PRODUCT] Simulating execution for task ${_task.id}`);
		// Simulate work being done
		const processingTime = Math.random() * 5000 + 2000; // 2-7 seconds
		await new Promise((resolve) => setTimeout(resolve, processingTime));

		// Random chance of failure for demonstration
		if (Math.random() < 0.1) {
			// 10% failure rate
			throw new Error("Simulated task execution failure");
		}
	}

	// ==================== EVENT HANDLING ====================

	/**
	 * Setup event handlers for coordination
	 */
	private setupEventHandlers(): void {
		// Listen to task events for automation and logging
		globalEventBus.on("task_created", this.handleTaskCreated.bind(this));
		globalEventBus.on("task_updated", this.handleTaskUpdated.bind(this));
		globalEventBus.on("task_deleted", this.handleTaskDeleted.bind(this));
		globalEventBus.on("task_status_changed", this.handleTaskStatusChanged.bind(this));
		globalEventBus.on("task_priority_changed", this.handleTaskPriorityChanged.bind(this));
		globalEventBus.on("task_assigned", this.handleTaskAssigned.bind(this));
	}

	private handleTaskCreated(event: TaskCreatedEvent): void {
		const taskId = event.data.task.id;
		console.log(`[PRODUCT-MANAGER] Task created event: ${taskId}`);

		// Process automation rules
		this.processAutomationForEvent("task_created", event.data);
	}

	private handleTaskUpdated(event: TaskUpdatedEvent): void {
		const taskId = event.data.task.id;
		console.log(`[PRODUCT-MANAGER] Task updated event: ${taskId}`);

		// Process automation rules
		this.processAutomationForEvent("task_updated", event.data);
	}

	private handleTaskDeleted(event: TaskDeletedEvent): void {
		console.log(`[PRODUCT-MANAGER] Task deleted event: ${event.data.taskId}`);

		// Process automation rules
		this.processAutomationForEvent("task_deleted", event.data);
	}

	private handleTaskStatusChanged(event: TaskStatusChangedEvent): void {
		console.log(
			`[PRODUCT-MANAGER] Task status changed event: ${event.data.taskId} -> ${event.data.newStatus}`,
		);

		// Process automation rules
		this.processAutomationForEvent("task_status_changed", event.data);
	}

	private handleTaskPriorityChanged(event: TaskPriorityChangedEvent): void {
		console.log(
			`[PRODUCT-MANAGER] Task priority changed event: ${event.data.taskId} -> ${event.data.newPriority}`,
		);

		// Process automation rules
		this.processAutomationForEvent("task_priority_changed", event.data);
	}

	private handleTaskAssigned(event: TaskAssignedEvent): void {
		const taskId = event.data.task.id;
		console.log(`[PRODUCT-MANAGER] Task assigned event: ${taskId} -> ${event.data.assignedTo}`);

		// Process automation rules
		this.processAutomationForEvent("task_assigned", event.data);
	}

	/**
	 * Process automation rules for an event
	 */
	private async processAutomationForEvent(
		eventType: WebSocketEventType,
		eventData: unknown,
	): Promise<void> {
		try {
			const allTasks = await this.getAllTasks();
			const results = await this.automationEngine.processTaskEvent(eventType, eventData, allTasks);

			if (results.length > 0) {
				console.log(
					`[PRODUCT-MANAGER] Processed ${results.length} automation rules for ${eventType}`,
				);
			}
		} catch (error) {
			console.error(`[PRODUCT-MANAGER] Error processing automation for ${eventType}:`, error);
		}
	}

	// ==================== AUTOMATION MANAGEMENT ====================

	/**
	 * Load automation rules from template manager
	 */
	private async loadAutomationRules(): Promise<void> {
		try {
			const rules = await this.templateManager.getAllAutomationRules();
			this.automationEngine.loadRules(rules);
			console.log(`[PRODUCT-MANAGER] Loaded ${rules.length} automation rules`);
		} catch (error) {
			console.error("[PRODUCT-MANAGER] Failed to load automation rules:", error);
		}
	}

	// ==================== UTILITY METHODS ====================

	/**
	 * Ensure manager is initialized
	 */
	private async ensureInitialized(): Promise<void> {
		if (!this.isInitialized) {
			await this.initialize();
		}
	}

	/**
	 * Convert TaskEntity to Task (for backward compatibility)
	 */
	private convertTaskEntityToTask(entity: TaskEntity): Task {
		const task: Task = {
			id: entity.id,
			title: entity.title,
			description: entity.description,
			status: entity.status,
			priority: entity.priority,
			type: "task", // Default type, could be stored in entity if needed
			dependencies: entity.dependencies,
			createdBy: entity.createdBy,
			createdAt: entity.createdAt,
			updatedAt: entity.updatedAt,
		};

		// Only add optional fields if they exist
		if (entity.assignedTo) {
			task.assignedTo = entity.assignedTo;
		}
		if (entity.collaborators) {
			task.collaborators = entity.collaborators;
		}
		if (entity.watchers) {
			task.watchers = entity.watchers;
		}

		return task;
	}

	/**
	 * Convert Task to TaskEntity
	 */
	private convertTaskToTaskEntity(task: Task): TaskEntity {
		const entity: TaskEntity = {
			id: task.id,
			title: task.title,
			description: task.description,
			status: task.status,
			priority: task.priority,
			type: task.type ?? "task",
			dependencies: task.dependencies,
			createdBy: task.createdBy,
			createdAt: task.createdAt,
			updatedAt: task.updatedAt,
		};

		// Only add optional fields if they exist
		if (task.assignedTo) {
			entity.assignedTo = task.assignedTo;
		}
		if (task.collaborators) {
			entity.collaborators = task.collaborators;
		}
		if (task.watchers) {
			entity.watchers = task.watchers;
		}

		return entity;
	}

	// ==================== CLEANUP ====================

	/**
	 * Cleanup resources
	 */
	async cleanup(): Promise<void> {
		try {
			if (this.db) {
				await this.db.close();
				console.log("[PRODUCT-MANAGER] Database closed");
			}
		} catch (error) {
			console.error("[PRODUCT-MANAGER] Error during cleanup:", error);
		}
	}
}
