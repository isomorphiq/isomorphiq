import type { Result } from "../core/result.ts";
import type { TaskEntity, TaskPriority } from "../core/task.ts";
import type { TaskFilters, TaskSearchOptions } from "../types.ts";

/**
 * Repository interface for Task data access
 */
/* eslint-disable no-unused-vars */
export interface ITaskRepository {
	// CRUD operations
	create(task: TaskEntity): Promise<Result<TaskEntity>>;
	findById(id: string): Promise<Result<TaskEntity | null>>;
	findAll(): Promise<Result<TaskEntity[]>>;
	update(id: string, task: TaskEntity): Promise<Result<TaskEntity>>;
	delete(id: string): Promise<Result<void>>;

	// Query operations
	findByStatus(status: string): Promise<Result<TaskEntity[]>>;
	findByCreatedBy(userId: string): Promise<Result<TaskEntity[]>>;
	findByAssignedTo(userId: string): Promise<Result<TaskEntity[]>>;
	findByCollaborator(userId: string): Promise<Result<TaskEntity[]>>;
	findByWatcher(userId: string): Promise<Result<TaskEntity[]>>;

	// Search and filter
	search(options: TaskSearchOptions): Promise<Result<{ tasks: TaskEntity[]; total: number }>>;
	filter(filters: TaskFilters): Promise<Result<TaskEntity[]>>;

	// Dependency operations
	findDependents(taskId: string): Promise<Result<TaskEntity[]>>;
	findDependencies(taskId: string): Promise<Result<TaskEntity[]>>;

	// Batch operations
	createMany(tasks: TaskEntity[]): Promise<Result<TaskEntity[]>>;
	updateMany(tasks: TaskEntity[]): Promise<Result<TaskEntity[]>>;
	deleteMany(ids: string[]): Promise<Result<void>>;
}
/* eslint-enable no-unused-vars */

/**
 * In-memory implementation of TaskRepository for testing
 */
export class InMemoryTaskRepository implements ITaskRepository {
	private tasks: Map<string, TaskEntity> = new Map();

	async create(task: TaskEntity): Promise<Result<TaskEntity>> {
		try {
			this.tasks.set(task.id, task);
			return { success: true, data: task };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}

	async findById(id: string): Promise<Result<TaskEntity | null>> {
		try {
			const task = this.tasks.get(id) || null;
			return { success: true, data: task };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}

	async findAll(): Promise<Result<TaskEntity[]>> {
		try {
			const tasks = Array.from(this.tasks.values());
			return { success: true, data: tasks };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}

	async update(id: string, task: TaskEntity): Promise<Result<TaskEntity>> {
		try {
			if (!this.tasks.has(id)) {
				return {
					success: false,
					error: new Error(`Task with id ${id} not found`),
				};
			}
			this.tasks.set(id, task);
			return { success: true, data: task };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}

	async delete(id: string): Promise<Result<void>> {
		try {
			if (!this.tasks.has(id)) {
				return {
					success: false,
					error: new Error(`Task with id ${id} not found`),
				};
			}
			this.tasks.delete(id);
			return { success: true, data: undefined };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}

	async findByStatus(status: string): Promise<Result<TaskEntity[]>> {
		try {
			const tasks = Array.from(this.tasks.values()).filter((task) => task.status === status);
			return { success: true, data: tasks };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}

	async findByCreatedBy(userId: string): Promise<Result<TaskEntity[]>> {
		try {
			const tasks = Array.from(this.tasks.values()).filter((task) => task.createdBy === userId);
			return { success: true, data: tasks };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}

	async findByAssignedTo(userId: string): Promise<Result<TaskEntity[]>> {
		try {
			const tasks = Array.from(this.tasks.values()).filter((task) => task.assignedTo === userId);
			return { success: true, data: tasks };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}

	async findByCollaborator(userId: string): Promise<Result<TaskEntity[]>> {
		try {
			const tasks = Array.from(this.tasks.values()).filter((task) =>
				task.collaborators?.includes(userId),
			);
			return { success: true, data: tasks };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}

	async findByWatcher(userId: string): Promise<Result<TaskEntity[]>> {
		try {
			const tasks = Array.from(this.tasks.values()).filter((task) =>
				task.watchers?.includes(userId),
			);
			return { success: true, data: tasks };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}

	async search(
		options: TaskSearchOptions,
	): Promise<Result<{ tasks: TaskEntity[]; total: number }>> {
		try {
			let tasks = Array.from(this.tasks.values());

			// Apply filters
			if (options.filters) {
				if (options.filters.status) {
					tasks = tasks.filter((task) => options.filters?.status?.includes(task.status));
				}
				if (options.filters.priority) {
					tasks = tasks.filter((task) => options.filters?.priority?.includes(task.priority));
				}
				if (options.filters.assignedTo) {
					tasks = tasks.filter(
						(task) => task.assignedTo && options.filters?.assignedTo?.includes(task.assignedTo),
					);
				}
				if (options.filters.createdBy) {
					tasks = tasks.filter((task) => options.filters?.createdBy?.includes(task.createdBy));
				}
			}

			// Apply text search
			if (options.query) {
				const query = options.query.toLowerCase();
				tasks = tasks.filter(
					(task) =>
						task.title.toLowerCase().includes(query) ||
						task.description.toLowerCase().includes(query),
				);
			}

			// Apply sorting
			if (options.sort) {
				tasks.sort((a, b) => {
					const { field, direction } = options.sort ?? { field: undefined, direction: "asc" };
					let aValue = a[field as keyof TaskEntity];
					let bValue = b[field as keyof TaskEntity];

					if (field === "priority") {
						const priorityOrder: Record<TaskPriority, number> = { high: 3, medium: 2, low: 1 };
						aValue = priorityOrder[a.priority];
						bValue = priorityOrder[b.priority];
					}

					if (aValue < bValue) return direction === "asc" ? -1 : 1;
					if (aValue > bValue) return direction === "asc" ? 1 : -1;
					return 0;
				});
			}

			// Apply pagination
			const total = tasks.length;
			if (options.offset) {
				tasks = tasks.slice(options.offset);
			}
			if (options.limit) {
				tasks = tasks.slice(0, options.limit);
			}

			return { success: true, data: { tasks, total } };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}

	async filter(filters: TaskFilters): Promise<Result<TaskEntity[]>> {
		const result = await this.search({ filters });
		if (!result.success) {
			return { success: false, error: result.error };
		}
		return { success: true, data: result.data.tasks };
	}

	async findDependents(taskId: string): Promise<Result<TaskEntity[]>> {
		try {
			const tasks = Array.from(this.tasks.values()).filter((task) =>
				task.dependencies.includes(taskId),
			);
			return { success: true, data: tasks };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}

	async findDependencies(taskId: string): Promise<Result<TaskEntity[]>> {
		try {
			const task = this.tasks.get(taskId);
			if (!task) {
				return { success: true, data: [] };
			}

			const dependencies = task.dependencies
				.map((depId) => this.tasks.get(depId))
				.filter((task): task is TaskEntity => task !== undefined);

			return { success: true, data: dependencies };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}

	async createMany(tasks: TaskEntity[]): Promise<Result<TaskEntity[]>> {
		try {
			for (const task of tasks) {
				this.tasks.set(task.id, task);
			}
			return { success: true, data: tasks };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}

	async updateMany(tasks: TaskEntity[]): Promise<Result<TaskEntity[]>> {
		try {
			for (const task of tasks) {
				if (this.tasks.has(task.id)) {
					this.tasks.set(task.id, task);
				}
			}
			return { success: true, data: tasks };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}

	async deleteMany(ids: string[]): Promise<Result<void>> {
		try {
			for (const id of ids) {
				this.tasks.delete(id);
			}
			return { success: true, data: undefined };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}
}
