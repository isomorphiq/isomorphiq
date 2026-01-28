import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
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
    type TaskActionLog,
    type TaskPriority,
    TaskActionLogStruct,
    type TaskSearchOptions,
    type TaskStatus,
    type TaskType,
    TaskSchema,
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
import { advanceToken, createToken, WORKFLOW } from "@isomorphiq/workflow";
import type { RuntimeState } from "@isomorphiq/workflow";

type TaskWebSocketManager = RealtimeWebSocketManager;

export type TaskSeedSpec = {
    title: string;
    description: string;
    priority: TaskPriority;
    type: TaskType;
    assignedTo?: string;
    createdBy?: string;
    dependencies?: string[];
};

export type TaskExecutionResult = {
    success: boolean;
    output: string;
    error: string;
    profileName: string;
    prompt?: string;
    summary?: string;
    modelName?: string;
};

export type TaskExecutor = (context: {
    task: Task;
    workflowState: RuntimeState | null;
}) => Promise<TaskExecutionResult>;

export type TaskSeedProvider = (context: {
    workflowState: RuntimeState | null;
    tasks: Task[];
}) => Promise<TaskSeedSpec | null>;

export type ProductManagerOptions = {
    taskExecutor?: TaskExecutor;
    taskSeedProvider?: TaskSeedProvider;
    profileManager?: ProfileManager;
};

const defaultTaskExecutor: TaskExecutor = async ({ task }) => {
    const profileName = task.assignedTo ?? "system";
    return {
        success: true,
        output: `No workflow executor configured; marked task ${task.id} as complete.`,
        error: "",
        profileName,
        summary: "Marked task complete without an external executor.",
        modelName: "system",
    };
};

const findWorkspaceRoot = (startDir: string): string => {
    const hasPrompts = existsSync(path.join(startDir, "prompts"));
    const hasPackageJson = existsSync(path.join(startDir, "package.json"));
    if (hasPrompts && hasPackageJson) {
        return startDir;
    }
    const parentDir = path.dirname(startDir);
    if (parentDir === startDir) {
        return startDir;
    }
    return findWorkspaceRoot(parentDir);
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
    private taskExecutor: TaskExecutor;
    private taskSeedProvider: TaskSeedProvider | null;
    private workflowToken = createToken<Record<string, unknown>>("new-feature-proposed");
    private lastWorkflowTransition: string | null = null;
    private activeTaskIds = new Set<string>();
    private processLoopStartedAt = 0;
    private isInitialized = false;
    private wsManager: TaskWebSocketManager | null = null;

    constructor(dbPath?: string, options: ProductManagerOptions = {}) {
        // Initialize LevelDB
        const workspaceRoot = findWorkspaceRoot(process.env.INIT_CWD ?? process.cwd());
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
        this.profileManager = options.profileManager ?? new ProfileManager();
        this.taskExecutor = options.taskExecutor ?? defaultTaskExecutor;
        this.taskSeedProvider = options.taskSeedProvider ?? null;

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
            actionLog: TaskActionLog[];
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
                const allTasks = await this.getAllTasks();
                const workflowStep = await this.advanceWorkflow(allTasks);
                let workflowState = workflowStep.state;
                const readyTasks = this.getReadyTasksFrom(allTasks);
                const inProgressTasks = this.getInProgressTasksFrom(allTasks);
                if (
                    inProgressTasks.length > 0 &&
                    workflowState?.name !== "tests-completed" &&
                    this.lastWorkflowTransition !== "tests-failed"
                ) {
                    this.workflowToken = { ...this.workflowToken, state: "tests-completed" };
                    workflowState = WORKFLOW["tests-completed"] ?? workflowState;
                }
                const useInProgressTasks =
                    workflowState?.name === "tests-completed" ||
                    workflowStep.transition === "additional-implementation";
                let candidateTasks = useInProgressTasks ? inProgressTasks : readyTasks;

				if (candidateTasks.length === 0) {
                    if (useInProgressTasks && readyTasks.length > 0) {
                        console.log(
                            "[PRODUCT-MANAGER] No in-progress tasks; falling back to ready tasks.",
                        );
                        candidateTasks = readyTasks;
                    }
                }

                if (candidateTasks.length === 0) {
                    const recovered = await this.recoverStaleInProgressTasks();
                    if (recovered > 0) {
                        console.log(
                            `[PRODUCT-MANAGER] Recovered ${recovered} stale in-progress task(s); retrying loop.`,
                        );
                        continue;
                    }
                    const seeded = await this.seedTasksFromWorkflow(workflowState, allTasks);
                    if (seeded) {
                        continue;
                    }
					console.log("[PRODUCT-MANAGER] No tasks ready for processing. Waiting 10 seconds...");
					await new Promise((resolve) => setTimeout(resolve, 10000));
					continue;
				}

				console.log(`[PRODUCT-MANAGER] Processing ${candidateTasks.length} ready tasks`);
                const workflowTask = workflowState
                    ? this.selectReadyTaskForState(candidateTasks, workflowState)
                    : null;
                const task = workflowTask ?? candidateTasks[0];

                if (!task) {
                    console.log("[PRODUCT-MANAGER] No tasks selected after workflow evaluation.");
                    await new Promise((resolve) => setTimeout(resolve, 10000));
                    continue;
                }

				// Process tasks one by one (could be made parallel)
                await this.processTask(task, workflowState, workflowStep.transition);

				// Brief pause between processing cycles
				await new Promise((resolve) => setTimeout(resolve, 3000));
			} catch (error) {
				console.error("[PRODUCT-MANAGER] Error in task processing loop:", error);
				console.log("[PRODUCT-MANAGER] Waiting 10 seconds before retrying...");
				await new Promise((resolve) => setTimeout(resolve, 10000));
			}
		}
	}

    private async seedTasksFromWorkflow(
        workflowState: RuntimeState | null,
        tasks: Task[],
    ): Promise<boolean> {
        const activeTasks = tasks.filter((task) => task.status !== "done");
        if (activeTasks.length > 0) {
            return false;
        }
        if (!this.taskSeedProvider) {
            return false;
        }

        const seed = await this.taskSeedProvider({ workflowState, tasks });
        if (!seed) {
            return false;
        }

        const createdBy = seed.createdBy ?? "workflow";
        const dependencies = seed.dependencies ?? [];
        const task = await this.createTask(
            seed.title,
            seed.description,
            seed.priority,
            dependencies,
            createdBy,
            seed.assignedTo,
            undefined,
            undefined,
            seed.type,
        );

        console.log(`[PRODUCT-MANAGER] Seeded workflow task: ${task.id}`);
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

	/**
	 * Get tasks that are ready for processing
	 */
	private async getReadyTasks(): Promise<Task[]> {
		const allTasks = await this.getAllTasks();
		return this.getReadyTasksFrom(allTasks);
	}

    private getReadyTasksFrom(allTasks: Task[]): Task[] {
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

    private getWorkflowState(): RuntimeState | null {
        const state = WORKFLOW[this.workflowToken.state];
        return state ?? null;
    }

    private getWorkflowTransition(state: RuntimeState, tasks: Task[]): string | null {
        if (state.name === "task-in-progress" && this.lastWorkflowTransition === "tests-failed") {
            return "additional-implementation";
        }
        if (state.decider) {
            const decided = state.decider(tasks);
            if (decided) {
                return decided;
            }
        }
        if (state.defaultTransition) {
            return state.defaultTransition;
        }
        const transitions = Object.keys(state.transitions);
        return transitions.length > 0 ? transitions[0] : null;
    }

    private async advanceWorkflow(allTasks: Task[]): Promise<{
        state: RuntimeState | null;
        transition: string | null;
    }> {
        const currentState = this.getWorkflowState();
        if (!currentState) {
            return { state: null, transition: null };
        }
        if (currentState.name === "tests-completed") {
            return { state: currentState, transition: null };
        }
        const transition = this.getWorkflowTransition(currentState, allTasks);
        if (!transition) {
            return { state: currentState, transition: null };
        }
        try {
            const nextToken = await advanceToken(this.workflowToken, transition, WORKFLOW, {
                tasks: allTasks,
            });
            const previousState = this.workflowToken.state;
            this.workflowToken = nextToken;
            if (previousState !== nextToken.state) {
                console.log(
                    `[WORKFLOW] Transitioned ${previousState} -> ${nextToken.state} via ${transition}`,
                );
            }
            this.lastWorkflowTransition = transition;
            return { state: WORKFLOW[nextToken.state] ?? null, transition };
        } catch (error) {
            console.warn("[WORKFLOW] Failed to advance workflow state:", error);
            return { state: currentState, transition: null };
        }
    }

    private matchesWorkflowTarget(task: Task, targetType: string): boolean {
        if (task.type === targetType) {
            return true;
        }
        if (targetType === "feature" && task.type === "task") {
            const text = `${task.title} ${task.description}`.toLowerCase();
            return text.includes("feature");
        }
        return false;
    }

    private selectReadyTaskForState(readyTasks: Task[], state: RuntimeState): Task | null {
        if (!state.targetType) {
            return readyTasks[0] ?? null;
        }
        const match = readyTasks.find((task) =>
            this.matchesWorkflowTarget(task, state.targetType),
        );
        return match ?? null;
    }

    private getInProgressTasksFrom(allTasks: Task[]): Task[] {
        const inProgressTasks = allTasks.filter((task) => task.status === "in-progress");
        if (inProgressTasks.length === 0) {
            return [];
        }
        const sortedTasks = TaskDomainRules.sortTasksByPriorityAndDependencies(
            inProgressTasks.map((task) => this.convertTaskToTaskEntity(task)),
        );
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
    private async processTask(
        task: Task,
        workflowState: RuntimeState | null,
        workflowTransition: string | null,
    ): Promise<void> {
        let modelName = "unknown-model";
        console.log(
            `[PRODUCT-MANAGER][${modelName}] Processing task: ${task.title} (id: ${task.id})`,
        );

        try {
            // Mark as in-progress
            await this.updateTaskStatus(task.id, "in-progress");
            this.activeTaskIds.add(task.id);

            const startTime = Date.now();
            const execution = await this.taskExecutor({ task, workflowState });
            const duration = Date.now() - startTime;

            const qaTransition =
                workflowState?.name === "tests-completed"
                    ? execution.success
                        ? "tests-passing"
                        : "tests-failed"
                    : null;
            const logTransition = qaTransition ?? workflowTransition;
            modelName = execution.modelName ?? modelName;
            const actorName = execution.profileName || task.assignedTo || "system";
            const actionLogEntry = this.createActionLogEntry(
                actorName,
                duration,
                execution,
                logTransition,
            );
            await this.appendActionLogEntry(task.id, actionLogEntry, task.actionLog);

            if (!execution.success) {
                throw new Error(execution.error);
            }

            if (workflowState?.name === "tests-completed") {
                const transition = qaTransition ?? "tests-passing";
                const nextToken = await advanceToken(this.workflowToken, transition, WORKFLOW);
                this.workflowToken = nextToken;
                this.lastWorkflowTransition = transition;
                await this.updateTaskStatus(task.id, "done");
                console.log(
                    `[PRODUCT-MANAGER][${modelName}] QA approved task: ${task.title} (id: ${task.id})`,
                );
            } else {
                this.workflowToken = { ...this.workflowToken, state: "tests-completed" };
                this.lastWorkflowTransition = "run-tests";
                console.log(
                    `[PRODUCT-MANAGER][${modelName}] Task work completed; awaiting QA: ${task.title} (id: ${task.id})`,
                );
            }
        } catch (error) {
            console.error(
                `[PRODUCT-MANAGER][${modelName}] Failed to process task: ${task.title} (id: ${task.id})`,
                error,
            );

            if (workflowState?.name === "tests-completed") {
                const nextToken = await advanceToken(this.workflowToken, "tests-failed", WORKFLOW);
                this.workflowToken = nextToken;
                this.lastWorkflowTransition = "tests-failed";
                await this.updateTaskStatus(task.id, "in-progress");
            } else {
                // Mark as todo again for retry
                await this.updateTaskStatus(task.id, "todo");
            }
        } finally {
            this.activeTaskIds.delete(task.id);
        }
    }

    private formatExecutionLine(text: string, fallback: string): string {
        const line = text
            .split("\n")
            .map((part) => part.trim())
            .find((part) => part.length > 0);
        if (!line) {
            return fallback;
        }
        const compact = line.replace(/\s+/g, " ");
        const maxLength = 180;
        const clipped =
            compact.length > maxLength ? `${compact.slice(0, maxLength - 3)}...` : compact;
        const trimmed = clipped.replace(/[.!?]+$/, "");
        return trimmed.length > 0 ? trimmed : fallback;
    }

    private formatExecutionSummary(output: string): string {
        const line = this.formatExecutionLine(output, "No output was returned");
        return `Completed: ${line}.`;
    }

    private formatExecutionError(error: string): string {
        const line = this.formatExecutionLine(error, "No error message was returned");
        return `Failed: ${line}.`;
    }

    private createActionLogEntry(
        profileName: string,
        durationMs: number,
        execution: TaskExecutionResult,
        workflowTransition: string | null,
    ): TaskActionLog {
        const summary = execution.summary
            ? execution.summary
            : execution.success
              ? this.formatExecutionSummary(execution.output)
              : this.formatExecutionError(execution.error);
        return TaskActionLogStruct.from({
            id: `action-${randomUUID()}`,
            summary,
            profile: profileName,
            durationMs,
            createdAt: new Date(),
            success: execution.success,
            transition: workflowTransition ?? undefined,
            prompt: execution.prompt,
            modelName: execution.modelName,
        });
    }

    private async appendActionLogEntry(
        taskId: string,
        entry: TaskActionLog,
        fallbackLog?: TaskActionLog[],
    ): Promise<void> {
        try {
            const currentTask = await this.getTask(taskId);
            const currentLog = currentTask?.actionLog ?? fallbackLog ?? [];
            await this.updateTask(taskId, { actionLog: [...currentLog, entry] }, "system");
        } catch (error) {
            console.warn(`[PRODUCT-MANAGER] Failed to append action log for ${taskId}:`, error);
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
            actionLog: entity.actionLog ?? [],
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
            actionLog: task.actionLog ?? [],
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
