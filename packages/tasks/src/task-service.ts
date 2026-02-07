import { ConflictError, NotFoundError, UnauthorizedError, ValidationError, type Result } from "@isomorphiq/core";
import {
    TaskDomainRules,
    TaskFactory,
    type CreateTaskInputWithPriority,
    type ExtendedUpdateTaskInput,
    type TaskEntity,
} from "./task-domain.ts";
import type { TaskPriority, TaskSearchOptions, TaskStatus } from "./types.ts";
import type { TaskRepository } from "./task-repository.ts";

/**
 * Service interface for Task operations
 */
/* eslint-disable no-unused-vars */
export type TaskServiceApi = {
	// CRUD operations
	createTask(input: CreateTaskInputWithPriority, createdBy: string): Promise<Result<TaskEntity>>;
	getTask(id: string): Promise<Result<TaskEntity>>;
	getTaskByBranch(branch: string): Promise<Result<TaskEntity | null>>;
	getAllTasks(): Promise<Result<TaskEntity[]>>;
	updateTask(id: string, input: ExtendedUpdateTaskInput, updatedBy: string): Promise<Result<TaskEntity>>;
	deleteTask(id: string, deletedBy: string): Promise<Result<void>>;

	// Query operations
	getTasksByStatus(status: TaskStatus): Promise<Result<TaskEntity[]>>;
	getTasksByUser(userId: string): Promise<Result<TaskEntity[]>>;
	searchTasks(options: TaskSearchOptions): Promise<Result<{ tasks: TaskEntity[]; total: number }>>;

	// Task management operations
	assignTask(taskId: string, assignedTo: string, assignedBy: string): Promise<Result<TaskEntity>>;
	updateTaskStatus(
		taskId: string,
		status: TaskStatus,
		updatedBy: string,
	): Promise<Result<TaskEntity>>;
	updateTaskPriority(
		taskId: string,
		priority: TaskPriority,
		updatedBy: string,
	): Promise<Result<TaskEntity>>;
	addCollaborator(taskId: string, userId: string, updatedBy: string): Promise<Result<TaskEntity>>;
	removeCollaborator(
		taskId: string,
		userId: string,
		updatedBy: string,
	): Promise<Result<TaskEntity>>;
	addWatcher(taskId: string, userId: string, updatedBy: string): Promise<Result<TaskEntity>>;
	removeWatcher(taskId: string, userId: string, updatedBy: string): Promise<Result<TaskEntity>>;

	// Dependency operations
	addDependency(taskId: string, dependsOn: string, updatedBy: string): Promise<Result<TaskEntity>>;
	removeDependency(
		taskId: string,
		dependsOn: string,
		updatedBy: string,
	): Promise<Result<TaskEntity>>;
	getTasksSortedByDependencies(): Promise<Result<TaskEntity[]>>;

	// Batch operations
	createManyTasks(
		inputs: CreateTaskInputWithPriority[],
		createdBy: string,
	): Promise<Result<TaskEntity[]>>;
};
/* eslint-enable no-unused-vars */

/**
 * Task service implementation
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class TaskService implements TaskServiceApi {
	private readonly taskRepository: TaskRepository;

	constructor(taskRepository: TaskRepository) {
		this.taskRepository = taskRepository;
	}

    private async ensureDependenciesInSameEnvironment(
        taskId: string,
        dependencies: string[],
    ): Promise<Result<void>> {
        const validationResult = TaskDomainRules.validateDependencies(dependencies);
        if (!validationResult.success) {
            return validationResult;
        }

        const uniqueDependencies = Array.from(new Set(dependencies));
        for (const depId of uniqueDependencies) {
            if (depId === taskId) {
                return {
                    success: false,
                    error: new ValidationError("Task cannot depend on itself", "dependencies"),
                };
            }

            const dependencyResult = await this.taskRepository.findById(depId);
            if (!dependencyResult.success) {
                return { success: false, error: dependencyResult.error };
            }
            if (!dependencyResult.data) {
                return {
                    success: false,
                    error: new ValidationError(
                        `Dependency ${depId} must reference a task in the same environment as task ${taskId}`,
                        "dependencies",
                    ),
                };
            }
        }

        return { success: true, data: undefined };
    }

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

        if (taskResult.data.dependencies.length > 0) {
            const dependencyResult = await this.ensureDependenciesInSameEnvironment(
                taskResult.data.id,
                taskResult.data.dependencies,
            );
            if (!dependencyResult.success) {
                return { success: false, error: dependencyResult.error };
            }
        }

		// Save to repository
		return await this.taskRepository.create(taskResult.data);
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

	async getTaskByBranch(branch: string): Promise<Result<TaskEntity | null>> {
		return await this.taskRepository.findByBranch(branch);
	}

	async getAllTasks(): Promise<Result<TaskEntity[]>> {
		return await this.taskRepository.findAll();
	}

	async updateTask(
		id: string,
		input: ExtendedUpdateTaskInput,
		_updatedBy: string,
	): Promise<Result<TaskEntity>> {
		void _updatedBy;
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

        if (input.dependencies) {
            const dependencyResult = await this.ensureDependenciesInSameEnvironment(
                id,
                input.dependencies,
            );
            if (!dependencyResult.success) {
                return { success: false, error: dependencyResult.error };
            }
        }

		// Update task using factory
		const updateResult = TaskFactory.update(existingTask, input);
		if (!updateResult.success) {
			return updateResult;
		}

		// Save to repository
		return await this.taskRepository.update(id, updateResult.data);
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

		return await this.taskRepository.delete(id);
	}

	async getTasksByStatus(status: TaskStatus): Promise<Result<TaskEntity[]>> {
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

	async assignTask(
		taskId: string,
		assignedTo: string,
		assignedBy: string,
	): Promise<Result<TaskEntity>> {
		const updateResult = await this.updateTask(taskId, { id: taskId, assignedTo }, assignedBy);
		if (!updateResult.success) {
			return updateResult;
		}

		// TODO: Send notification to assigned user
		// TODO: Broadcast WebSocket event

		return updateResult;
	}

	async updateTaskStatus(
		taskId: string,
		status: TaskStatus,
		updatedBy: string,
	): Promise<Result<TaskEntity>> {
		const updateResult = await this.updateTask(taskId, { id: taskId, status }, updatedBy);
		if (!updateResult.success) {
			return updateResult;
		}

		// TODO: Send notifications to watchers
		// TODO: Broadcast WebSocket event

		return updateResult;
	}

	async updateTaskPriority(
		taskId: string,
		priority: TaskPriority,
		updatedBy: string,
	): Promise<Result<TaskEntity>> {
		const updateResult = await this.updateTask(taskId, { id: taskId, priority }, updatedBy);
		if (!updateResult.success) {
			return updateResult;
		}

		// TODO: Broadcast WebSocket event

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

		// TODO: Send notification to new collaborator
		// TODO: Broadcast WebSocket event

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

		// TODO: Broadcast WebSocket event

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

		// TODO: Broadcast WebSocket event

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

		// TODO: Broadcast WebSocket event

		return updateResult;
	}

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

        const dependencyCheck = await this.ensureDependenciesInSameEnvironment(taskId, [dependsOn]);
        if (!dependencyCheck.success) {
            return { success: false, error: dependencyCheck.error };
        }

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

		// TODO: Broadcast WebSocket event

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

		// TODO: Broadcast WebSocket event

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
				const error =
					taskResult.error instanceof Error
						? taskResult.error
						: new Error(taskResult.error ? String(taskResult.error) : "Unknown error");
				errors.push(error);
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

	/**
	 * Check if user can delete a task
	 */
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
