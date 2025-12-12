import { EventFactory, globalEventBus } from "../core/event-bus.ts";
import type {
	TaskAssignedEvent,
	TaskCreatedEvent,
	TaskDeletedEvent,
	TaskPriorityChangedEvent,
	TaskStatusChangedEvent,
	TaskUpdatedEvent,
} from "../core/events.ts";
import type { Result } from "../core/result.ts";
import { ConflictError, NotFoundError, UnauthorizedError } from "../core/result.ts";
import type {
	CreateTaskInputWithPriority,
	ExtendedUpdateTaskInput,
	TaskEntity,
	TaskPriority,
} from "../core/task.ts";
import { TaskDomainRules, TaskFactory } from "../core/task.ts";
import type { ITaskRepository } from "../repositories/task-repository.ts";
import type { TaskSearchOptions, TaskStatus } from "../types.ts";

/**
 * Enhanced Task Service with event-driven architecture
 */
export class EnhancedTaskService {
	private readonly taskRepository: ITaskRepository;

	constructor(taskRepository: ITaskRepository) {
		this.taskRepository = taskRepository;
		// Subscribe to event bus for internal event handling
		this.setupEventHandlers();
	}

	private setupEventHandlers(): void {
		// Handle task events for logging, metrics, etc.
		globalEventBus.on("task_created", this.handleTaskCreated.bind(this));
		globalEventBus.on("task_updated", this.handleTaskUpdated.bind(this));
		globalEventBus.on("task_deleted", this.handleTaskDeleted.bind(this));
		globalEventBus.on("task_status_changed", this.handleTaskStatusChanged.bind(this));
		globalEventBus.on("task_priority_changed", this.handleTaskPriorityChanged.bind(this));
		globalEventBus.on("task_assigned", this.handleTaskAssigned.bind(this));
	}

	private handleTaskCreated(event: TaskCreatedEvent): void {
		console.log(`[TaskService] Task created: ${event.data.task.id} by ${event.data.createdBy}`);
		// Could trigger additional business logic here
	}

	private handleTaskUpdated(event: TaskUpdatedEvent): void {
		console.log(`[TaskService] Task updated: ${event.data.task.id} by ${event.data.updatedBy}`);
		// Could trigger additional business logic here
	}

	private handleTaskDeleted(event: TaskDeletedEvent): void {
		console.log(`[TaskService] Task deleted: ${event.data.taskId} by ${event.data.deletedBy}`);
		// Could trigger additional business logic here
	}

	private handleTaskStatusChanged(event: TaskStatusChangedEvent): void {
		console.log(
			`[TaskService] Task status changed: ${event.data.taskId} from ${event.data.oldStatus} to ${event.data.newStatus}`,
		);
		// Could trigger notifications, automation rules, etc.
	}

	private handleTaskPriorityChanged(event: TaskPriorityChangedEvent): void {
		console.log(
			`[TaskService] Task priority changed: ${event.data.taskId} from ${event.data.oldPriority} to ${event.data.newPriority}`,
		);
		// Could trigger notifications, reordering, etc.
	}

	private handleTaskAssigned(event: TaskAssignedEvent): void {
		console.log(
			`[TaskService] Task assigned: ${event.data.task.id} to ${event.data.assignedTo} by ${event.data.assignedBy}`,
		);
		// Could trigger notifications to assigned user
	}

	// CRUD operations with event emission
	async createTask(
		input: CreateTaskInputWithPriority,
		createdBy: string,
	): Promise<Result<TaskEntity>> {
		// Validate input using domain rules
		const validationResult = TaskDomainRules.validateCreateInput(input);
		if (!validationResult.success) {
			return { success: false, error: validationResult.error };
		}

		// Create task entity using factory
		const taskResult = TaskFactory.create(input, createdBy);
		if (!taskResult.success) {
			return taskResult;
		}

		// Save to repository
		const saveResult = await this.taskRepository.create(taskResult.data);
		if (!saveResult.success) {
			return saveResult;
		}

		// Emit event
		const event = EventFactory.createTaskCreated(saveResult.data, createdBy);
		await globalEventBus.publish(event);

		return saveResult;
	}

	async getTask(id: string): Promise<Result<TaskEntity>> {
		const result = await this.taskRepository.findById(id);

		if (!result.success) {
			return result;
		}

		if (!result.data) {
			return {
				success: false,
				error: new NotFoundError("Task", id),
			};
		}

		return { success: true, data: result.data };
	}

	async getAllTasks(): Promise<Result<TaskEntity[]>> {
		return await this.taskRepository.findAll();
	}

	async updateTask(
		id: string,
		input: ExtendedUpdateTaskInput,
		updatedBy: string,
	): Promise<Result<TaskEntity>> {
		// Get existing task
		const existingResult = await this.getTask(id);
		if (!existingResult.success) {
			return existingResult;
		}

		const existingTask = existingResult.data;
		if (!existingTask) {
			return { success: false, error: new NotFoundError("Task", id) };
		}

		// Validate update input
		const validationResult = TaskDomainRules.validateUpdateInput(input);
		if (!validationResult.success) {
			return { success: false, error: validationResult.error };
		}

		// Update task using factory
		const updateResult = TaskFactory.update(existingTask, input);
		if (!updateResult.success) {
			return updateResult;
		}

		// Save to repository
		const saveResult = await this.taskRepository.update(id, updateResult.data);
		if (!saveResult.success) {
			return saveResult;
		}

		// Emit event with changes
		const changes = this.calculateChanges(existingTask, saveResult.data);
		const event = EventFactory.createTaskUpdated(saveResult.data, changes, updatedBy);
		await globalEventBus.publish(event);

		return saveResult;
	}

	async deleteTask(id: string, deletedBy: string): Promise<Result<void>> {
		// Check if task exists
		const existingResult = await this.getTask(id);
		if (!existingResult.success) {
			return { success: false, error: existingResult.error };
		}

		// Check if user has permission to delete
		if (!this.canDeleteTask(existingResult.data, deletedBy)) {
			return {
				success: false,
				error: new UnauthorizedError("delete", "task"),
			};
		}

		// Delete from repository
		const deleteResult = await this.taskRepository.delete(id);
		if (!deleteResult.success) {
			return deleteResult;
		}

		// Emit event
		const event = EventFactory.createTaskDeleted(id, deletedBy);
		await globalEventBus.publish(event);

		return deleteResult;
	}

	async getTasksByStatus(status: string): Promise<Result<TaskEntity[]>> {
		return await this.taskRepository.findByStatus(status);
	}

	async getTasksByUser(userId: string): Promise<Result<TaskEntity[]>> {
		// Get tasks where user is creator, assignee, collaborator, or watcher
		const [createdResult, assignedResult, collaboratingResult, watchingResult] = await Promise.all([
			this.taskRepository.findByCreatedBy(userId),
			this.taskRepository.findByAssignedTo(userId),
			this.taskRepository.findByCollaborator(userId),
			this.taskRepository.findByWatcher(userId),
		]);

		// Combine results, checking for errors
		const results = [createdResult, assignedResult, collaboratingResult, watchingResult];
		const firstError = results.find((r) => !r.success);
		if (firstError) {
			return firstError;
		}

		// Combine and deduplicate tasks
		const allTasks = new Map<string, TaskEntity>();
		const taskArrays = [
			createdResult.success ? createdResult.data : [],
			assignedResult.success ? assignedResult.data : [],
			collaboratingResult.success ? collaboratingResult.data : [],
			watchingResult.success ? watchingResult.data : [],
		];

		for (const tasks of taskArrays) {
			for (const task of tasks) {
				allTasks.set(task.id, task);
			}
		}

		return { success: true, data: Array.from(allTasks.values()) };
	}

	async searchTasks(
		options: TaskSearchOptions,
	): Promise<Result<{ tasks: TaskEntity[]; total: number }>> {
		return await this.taskRepository.search(options);
	}

	// Task management operations with event emission
	async assignTask(
		taskId: string,
		assignedTo: string,
		assignedBy: string,
	): Promise<Result<TaskEntity>> {
		const updateResult = await this.updateTask(taskId, { id: taskId, assignedTo }, assignedBy);
		if (!updateResult.success) {
			return updateResult;
		}

		// Emit assignment event
		const event = EventFactory.createTaskAssigned(updateResult.data, assignedTo, assignedBy);
		await globalEventBus.publish(event);

		return updateResult;
	}

	async updateTaskStatus(
		taskId: string,
		status: TaskStatus,
		updatedBy: string,
	): Promise<Result<TaskEntity>> {
		// Get current task for old status
		const currentResult = await this.getTask(taskId);
		if (!currentResult.success) {
			return currentResult;
		}

		const oldStatus = currentResult.data.status;

		const updateResult = await this.updateTask(taskId, { id: taskId, status }, updatedBy);
		if (!updateResult.success) {
			return updateResult;
		}

		// Emit status change event
		const event = EventFactory.createTaskStatusChanged(
			taskId,
			oldStatus,
			status,
			updateResult.data,
			updatedBy,
		);
		await globalEventBus.publish(event);

		return updateResult;
	}

	async updateTaskPriority(
		taskId: string,
		priority: TaskPriority,
		updatedBy: string,
	): Promise<Result<TaskEntity>> {
		// Get current task for old priority
		const currentResult = await this.getTask(taskId);
		if (!currentResult.success) {
			return currentResult;
		}

		const oldPriority = currentResult.data.priority;

		const updateResult = await this.updateTask(taskId, { ...currentResult.data, id: taskId, priority }, updatedBy);
		if (!updateResult.success) {
			return updateResult;
		}

		// Emit priority change event
		const event = EventFactory.createTaskPriorityChanged(
			taskId,
			oldPriority,
			priority,
			updateResult.data,
			updatedBy,
		);
		await globalEventBus.publish(event);

		return updateResult;
	}

	async addCollaborator(
		taskId: string,
		userId: string,
		updatedBy: string,
	): Promise<Result<TaskEntity>> {
		const taskResult = await this.getTask(taskId);
		if (!taskResult.success) {
			return taskResult;
		}

		const task = taskResult.data;
		if (!task) {
			return { success: false, error: new NotFoundError("Task", taskId) };
		}
		const collaborators = [...(task.collaborators || []), userId];

		const updateResult = await this.updateTask(taskId, { id: taskId, collaborators }, updatedBy);
		if (!updateResult.success) {
			return updateResult;
		}

		// Emit collaborators updated event
		const event = EventFactory.createTaskCollaboratorsUpdated(
			updateResult.data,
			collaborators,
			updatedBy,
		);
		await globalEventBus.publish(event);

		return updateResult;
	}

	async removeCollaborator(
		taskId: string,
		userId: string,
		updatedBy: string,
	): Promise<Result<TaskEntity>> {
		const taskResult = await this.getTask(taskId);
		if (!taskResult.success) {
			return taskResult;
		}

		const task = taskResult.data;
		const collaborators = (task.collaborators || []).filter((id) => id !== userId);

		const updateResult = await this.updateTask(taskId, { id: taskId, collaborators }, updatedBy);
		if (!updateResult.success) {
			return updateResult;
		}

		// Emit collaborators updated event
		const event = EventFactory.createTaskCollaboratorsUpdated(
			updateResult.data,
			collaborators,
			updatedBy,
		);
		await globalEventBus.publish(event);

		return updateResult;
	}

	async addWatcher(taskId: string, userId: string, updatedBy: string): Promise<Result<TaskEntity>> {
		const taskResult = await this.getTask(taskId);
		if (!taskResult.success) {
			return taskResult;
		}

		const task = taskResult.data;
		const watchers = [...(task.watchers || []), userId];

		const updateResult = await this.updateTask(taskId, { id: taskId, watchers }, updatedBy);
		if (!updateResult.success) {
			return updateResult;
		}

		// Emit watchers updated event
		const event = EventFactory.createTaskWatchersUpdated(updateResult.data, watchers, updatedBy);
		await globalEventBus.publish(event);

		return updateResult;
	}

	async removeWatcher(
		taskId: string,
		userId: string,
		updatedBy: string,
	): Promise<Result<TaskEntity>> {
		const taskResult = await this.getTask(taskId);
		if (!taskResult.success) {
			return taskResult;
		}

		const task = taskResult.data;
		const watchers = (task.watchers || []).filter((id) => id !== userId);

		const updateResult = await this.updateTask(taskId, { id: taskId, watchers }, updatedBy);
		if (!updateResult.success) {
			return updateResult;
		}

		// Emit watchers updated event
		const event = EventFactory.createTaskWatchersUpdated(updateResult.data, watchers, updatedBy);
		await globalEventBus.publish(event);

		return updateResult;
	}

	// Dependency operations with event emission
	async addDependency(
		taskId: string,
		dependsOn: string,
		updatedBy: string,
	): Promise<Result<TaskEntity>> {
		const taskResult = await this.getTask(taskId);
		if (!taskResult.success) {
			return taskResult;
		}

		const task = taskResult.data;

		// Check if dependency already exists
		if (task.dependencies.includes(dependsOn)) {
			return {
				success: false,
				error: new ConflictError("Task already depends on this task"),
			};
		}

		// Check for circular dependencies
		const allTasksResult = await this.getAllTasks();
		if (!allTasksResult.success || !allTasksResult.data) {
			return { success: false, error: allTasksResult.error };
		}

		const newDependencies = [...task.dependencies, dependsOn];
		if (TaskDomainRules.hasCircularDependency(taskId, newDependencies, allTasksResult.data)) {
			return {
				success: false,
				error: new ConflictError("Adding this dependency would create a circular dependency"),
			};
		}

		const updateResult = await this.updateTask(
			taskId,
			{ id: taskId, dependencies: newDependencies },
			updatedBy,
		);
		if (!updateResult.success) {
			return updateResult;
		}

		// Emit dependency added event
		const event = EventFactory.createTaskDependencyAdded(taskId, dependsOn, updatedBy);
		await globalEventBus.publish(event);

		return updateResult;
	}

	async removeDependency(
		taskId: string,
		dependsOn: string,
		updatedBy: string,
	): Promise<Result<TaskEntity>> {
		const taskResult = await this.getTask(taskId);
		if (!taskResult.success) {
			return taskResult;
		}

		const task = taskResult.data;
		const dependencies = task.dependencies.filter((id) => id !== dependsOn);

		const updateResult = await this.updateTask(taskId, { id: taskId, dependencies }, updatedBy);
		if (!updateResult.success) {
			return updateResult;
		}

		// Emit dependency removed event
		const event = EventFactory.createTaskDependencyRemoved(taskId, dependsOn, updatedBy);
		await globalEventBus.publish(event);

		return updateResult;
	}

	async getTasksSortedByDependencies(): Promise<Result<TaskEntity[]>> {
		const allTasksResult = await this.getAllTasks();
		if (!allTasksResult.success) {
			return allTasksResult;
		}

		// Filter only todo tasks and sort by dependencies and priority
		const todoTasks = allTasksResult.data.filter((task) => task.status === "todo");
		const sortedTasks = TaskDomainRules.sortTasksByPriorityAndDependencies(todoTasks);

		return { success: true, data: sortedTasks };
	}

	async createManyTasks(
		inputs: CreateTaskInputWithPriority[],
		createdBy: string,
	): Promise<Result<TaskEntity[]>> {
		const tasks: TaskEntity[] = [];
		const errors: Error[] = [];

		// Validate and create all tasks
		for (const input of inputs) {
			const taskResult = await this.createTask(input, createdBy);
			if (taskResult.success) {
				tasks.push(taskResult.data);
			} else {
				errors.push(taskResult.error as Error);
			}
		}

		if (errors.length > 0) {
			return {
				success: false,
				error: new Error(`Failed to create some tasks: ${errors.map((e) => e.message).join(", ")}`),
			};
		}

		return { success: true, data: tasks };
	}

	// Helper methods
	private calculateChanges(
		oldTask: TaskEntity,
		newTask: TaskEntity,
	): Record<string, { old: unknown; new: unknown }> {
		const changes: Record<string, { old: unknown; new: unknown }> = {};

		// Compare fields and record changes
		if (oldTask.title !== newTask.title) {
			changes.title = { old: oldTask.title, new: newTask.title };
		}
		if (oldTask.description !== newTask.description) {
			changes.description = { old: oldTask.description, new: newTask.description };
		}
		if (oldTask.status !== newTask.status) {
			changes.status = { old: oldTask.status, new: newTask.status };
		}
		if (oldTask.priority !== newTask.priority) {
			changes.priority = { old: oldTask.priority, new: newTask.priority };
		}
		if (oldTask.assignedTo !== newTask.assignedTo) {
			changes.assignedTo = { old: oldTask.assignedTo, new: newTask.assignedTo };
		}

		// Compare arrays
		if (
			JSON.stringify(oldTask.collaborators || []) !== JSON.stringify(newTask.collaborators || [])
		) {
			changes.collaborators = { old: oldTask.collaborators, new: newTask.collaborators };
		}
		if (JSON.stringify(oldTask.watchers || []) !== JSON.stringify(newTask.watchers || [])) {
			changes.watchers = { old: oldTask.watchers, new: newTask.watchers };
		}
		if (JSON.stringify(oldTask.dependencies) !== JSON.stringify(newTask.dependencies)) {
			changes.dependencies = { old: oldTask.dependencies, new: newTask.dependencies };
		}

		return changes;
	}

	private canDeleteTask(task: TaskEntity, userId: string): boolean {
		// Creator can delete
		if (task.createdBy === userId) {
			return true;
		}

		// Assigned user can delete
		if (task.assignedTo === userId) {
			return true;
		}

		// TODO: Add role-based permissions
		return false;
	}
}
