import { existsSync } from "node:fs";
import path from "node:path";
import { AutomationRuleEngine } from "./automation-rule-engine.ts";
import { globalEventBus } from "@isomorphiq/core";
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
    type TaskSearchOptions,
    type TaskStatus,
    type TaskType,
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
import type { WebSocketManager as RealtimeWebSocketManager } from "@isomorphiq/realtime";
import { LevelDbTaskRepository } from "./persistence/leveldb-task-repository.ts";
import {
    createInMemoryStore,
    createLevelStore,
    type KeyValueStore,
    type KeyValueStoreFactory,
} from "./persistence/key-value-store.ts";
import { EnhancedTaskService } from "./enhanced-task-service.ts";
import { TemplateManager } from "./template-manager.ts";
import { IntegrationService } from "@isomorphiq/integrations";
import { InMemoryTaskRepository } from "./task-repository.ts";

type TaskWebSocketManager = RealtimeWebSocketManager;

export type ProductManagerOptions = {
    storageMode?: StorageMode;
};

export type StorageMode = "level" | "memory";

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

const normalizeStorageMode = (value: string | undefined): StorageMode | undefined => {
    if (value === "level" || value === "memory") {
        return value;
    }
    return undefined;
};

const isTestScriptName = (value: string): boolean => {
    const base = path.basename(value);
    const isScript =
        base.endsWith(".ts") ||
        base.endsWith(".js") ||
        base.endsWith(".mjs") ||
        base.endsWith(".cjs");
    return isScript && base.includes("test");
};

const isLikelyTestArg = (value: string): boolean =>
    value.includes("--test") ||
    value.includes(".test.") ||
    value.includes(".spec.") ||
    value.includes(`${path.sep}tests${path.sep}`) ||
    isTestScriptName(value);

const isTestRuntime = (): boolean =>
    process.env.NODE_ENV === "test" ||
    process.env.ISOMORPHIQ_TEST_MODE === "true" ||
    process.argv.some(isLikelyTestArg);

const resolveStorageMode = (options: ProductManagerOptions): StorageMode => {
    const optionMode = options.storageMode;
    if (optionMode) {
        return optionMode;
    }
    const envMode = normalizeStorageMode(process.env.ISOMORPHIQ_STORAGE_MODE);
    if (envMode) {
        return envMode;
    }
    return isTestRuntime() ? "memory" : "level";
};

const resolveWorkspacePath = (value: string | undefined, workspaceRoot: string): string | undefined => {
    if (!value) {
        return undefined;
    }
    return path.isAbsolute(value) ? value : path.join(workspaceRoot, value);
};

const resolveDatabasePath = (dbPath: string | undefined, workspaceRoot: string): string => {
    if (dbPath) {
        return dbPath;
    }
    const envPath = resolveWorkspacePath(process.env.DB_PATH, workspaceRoot);
    return envPath ?? path.join(workspaceRoot, "db");
};

const resolveSavedSearchesPath = (
    databasePath: string,
    workspaceRoot: string,
    storageMode: StorageMode,
): string => {
    const envPath = resolveWorkspacePath(process.env.SAVED_SEARCHES_DB_PATH, workspaceRoot);
    if (envPath) {
        return envPath;
    }
    if (storageMode === "memory") {
        return path.join(databasePath, "saved-searches-db");
    }
    return path.join(databasePath, "saved-searches-db");
};

/**
 * ProductManager - Core task management service
 * TODO - reimplement this using `@tsimpl/core` and `@tsimpl/runtime` ; use a `struct` and `impl` pattern.
 *
 * This is the main service for the task management system. It provides:
 * - High-level task operations with business logic
 * - Template and automation integration
 * - Event-driven coordination between components
 * - Dependency management and validation
 */
export class ProductManager {
    public taskService: EnhancedTaskService;
    private templateManager: TemplateManager;
    private automationEngine: AutomationRuleEngine;
    private db: KeyValueStore<string, unknown>;
    private savedSearchesDb: KeyValueStore<string, SavedSearch>;
    private integrationDb: KeyValueStore<string, unknown>;
    private integrationService: IntegrationService;
    private isInitialized = false;
    private wsManager: TaskWebSocketManager | null = null;

    constructor(dbPath?: string, options: ProductManagerOptions = {}) {
        const workspaceRoot = findWorkspaceRoot(process.env.INIT_CWD ?? process.cwd());
        const storageMode = resolveStorageMode(options);
        const storeFactory: KeyValueStoreFactory =
            storageMode === "memory" ? createInMemoryStore : createLevelStore;
        const databasePath = resolveDatabasePath(dbPath, workspaceRoot);
        const savedSearchesPath = resolveSavedSearchesPath(databasePath, workspaceRoot, storageMode);

        this.db = storeFactory<string, unknown>(databasePath);
        this.savedSearchesDb = storeFactory<string, SavedSearch>(savedSearchesPath);
        this.integrationDb = storeFactory<string, unknown>(path.join(databasePath, "integrations"));

        // Initialize repository and service - use tasks subdirectory
        const tasksPath = path.join(databasePath, "tasks");
        const taskRepository =
            storageMode === "memory"
                ? new InMemoryTaskRepository()
                : new LevelDbTaskRepository(tasksPath);
        this.taskService = new EnhancedTaskService(taskRepository);

        // Initialize supporting services
        this.templateManager = new TemplateManager(databasePath, { storeFactory });
        this.automationEngine = new AutomationRuleEngine();
        this.integrationService = new IntegrationService(this.integrationDb);

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
			type: entity.type ?? "task",
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
