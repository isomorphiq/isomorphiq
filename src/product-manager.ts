import path from "node:path";
import { Level } from "level";
import { AutomationRuleEngine } from "./automation-rule-engine.ts";
import { globalEventBus } from "./core/event-bus.ts";
import type {
	TaskAssignedEvent,
	TaskCreatedEvent,
	TaskDeletedEvent,
	TaskPriorityChangedEvent,
	TaskStatusChangedEvent,
	TaskUpdatedEvent,
} from "./core/events.ts";
import type {
	CreateTaskInputWithPriority,
	ExtendedUpdateTaskInput,
	TaskEntity,
} from "./core/task.ts";
import { TaskDomainRules, type TaskPriority } from "./core/task.ts";
import { LevelDbTaskRepository } from "./repositories/leveldb-task-repository.ts";
import { EnhancedTaskService } from "./services/enhanced-task-service.ts";
import { TemplateManager } from "./template-manager.ts";
import type {
	CreateTaskFromTemplateInput,
	Task,
	TaskSearchOptions,
	TaskStatus,
	TaskType,
	WebSocketEventType,
} from "./types.ts";

interface TaskWebSocketManager {
	broadcastTaskCreated(task: Task): void;
	broadcastTaskUpdated(task: Task, updates: Partial<Task>): void;
	broadcastTaskDeleted(taskId: string): void;
	broadcastTaskStatusChanged(
		taskId: string,
		oldStatus: TaskStatus,
		newStatus: TaskStatus,
		task: Task,
	): void;
	broadcastTaskPriorityChanged(
		taskId: string,
		oldPriority: TaskPriority,
		newPriority: TaskPriority,
		task: Task,
	): void;
	broadcastTaskAssigned(task: Task, assignedTo: string, assignedBy: string): void;
}

/**
 * ProductManager - Core task management and orchestration service
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
	private isInitialized = false;
	private wsManager: TaskWebSocketManager | null = null;

	constructor(dbPath?: string) {
		// Initialize LevelDB
		const databasePath = dbPath || path.join(process.cwd(), "db");
		this.db = new Level<string, unknown>(databasePath, { valueEncoding: "json" });

		// Initialize repository and service - use tasks subdirectory
		const tasksPath = path.join(databasePath, "tasks");
		const taskRepository = new LevelDbTaskRepository(tasksPath);
		this.taskService = new EnhancedTaskService(taskRepository);

		// Initialize supporting services
		this.templateManager = new TemplateManager();
		this.automationEngine = new AutomationRuleEngine();

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

		const input: CreateTaskInputWithPriority = {
			title,
			description,
			priority,
			dependencies,
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

		return result.data.map((task) => this.convertTaskEntityToTask(task));
	}

	/**
	 * Search tasks with filters and sorting
	 */
	async searchTasks(options: TaskSearchOptions): Promise<{ tasks: Task[]; total: number }> {
		await this.ensureInitialized();

		const result = await this.taskService.searchTasks(options);
		if (!result.success) {
			return { tasks: [], total: 0 };
		}

		return {
			tasks: result.data.tasks.map((task) => this.convertTaskEntityToTask(task)),
			total: result.data.total,
		};
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

	// ==================== TASK PROCESSING ORCHESTRATION ====================

	/**
	 * Process tasks using dependency order and priority
	 * This is the main task processing loop
	 */
	async processTasksLoop(): Promise<void> {
		console.log("[PRODUCT-MANAGER] Starting task processing loop...");

		while (true) {
			try {
				// Get tasks ready for processing (todo status, dependencies satisfied)
				const readyTasks = await this.getReadyTasks();

				if (readyTasks.length === 0) {
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

			// Here you would integrate with ACP profiles or other execution mechanisms
			// For now, we'll simulate task completion
			await this.simulateTaskExecution(task);

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
		}
	}

	/**
	 * Simulate task execution (replace with actual execution logic)
	 */
	private async simulateTaskExecution(_task: Task): Promise<void> {
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
		const data = event.data as { task?: Task };
		const taskId = data.task?.id ?? "unknown";
		console.log(`[PRODUCT-MANAGER] Task created event: ${taskId}`);

		// Process automation rules
		this.processAutomationForEvent("task_created", event.data);
	}

	private handleTaskUpdated(event: TaskUpdatedEvent): void {
		const data = event.data as { task?: Task };
		const taskId = data.task?.id ?? "unknown";
		console.log(`[PRODUCT-MANAGER] Task updated event: ${taskId}`);

		// Process automation rules
		this.processAutomationForEvent("task_updated", event.data);
	}

	private handleTaskDeleted(event: TaskDeletedEvent): void {
		const data = event.data as { taskId?: string };
		console.log(`[PRODUCT-MANAGER] Task deleted event: ${data.taskId ?? "unknown"}`);

		// Process automation rules
		this.processAutomationForEvent("task_deleted", event.data);
	}

	private handleTaskStatusChanged(event: TaskStatusChangedEvent): void {
		const data = event.data as {
			taskId?: string;
			newStatus?: TaskStatus;
			oldStatus?: TaskStatus;
		};
		console.log(
			`[PRODUCT-MANAGER] Task status changed event: ${data.taskId ?? "unknown"} -> ${
				data.newStatus ?? "unknown"
			}`,
		);

		// Process automation rules
		this.processAutomationForEvent("task_status_changed", event.data);
	}

	private handleTaskPriorityChanged(event: TaskPriorityChangedEvent): void {
		const data = event.data as {
			taskId?: string;
			newPriority?: TaskPriority;
			oldPriority?: TaskPriority;
		};
		console.log(
			`[PRODUCT-MANAGER] Task priority changed event: ${data.taskId ?? "unknown"} -> ${
				data.newPriority ?? "unknown"
			}`,
		);

		// Process automation rules
		this.processAutomationForEvent("task_priority_changed", event.data);
	}

	private handleTaskAssigned(event: TaskAssignedEvent): void {
		const data = event.data as { task?: Task; assignedTo?: string };
		const taskId = data.task?.id ?? "unknown";
		console.log(`[PRODUCT-MANAGER] Task assigned event: ${taskId} -> ${data.assignedTo ?? ""}`);

		// Process automation rules
		this.processAutomationForEvent("task_assigned", event.data);
	}

	/**
	 * Process automation rules for an event
	 */
	private async processAutomationForEvent(
		eventType: WebSocketEventType,
		eventData: Record<string, unknown>,
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
