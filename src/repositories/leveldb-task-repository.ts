import path from "node:path";
import { Level } from "level";
import type { Result } from "../core/result.ts";
import type { TaskEntity, TaskPriority } from "../core/task.ts";
import type { TaskFilters, TaskSearchOptions } from "../types.ts";
import type { ITaskRepository } from "./task-repository.ts";

/**
 * LevelDB implementation of TaskRepository
 */
export class LevelDbTaskRepository implements ITaskRepository {
	private db: Level<string, TaskEntity>;
	private dbReady = false;

	constructor(dbPath?: string) {
		const defaultPath = path.join(process.cwd(), "db", "tasks");
		this.db = new Level(dbPath || defaultPath, { valueEncoding: "json" });
	}

	private async ensureDbOpen(): Promise<void> {
		if (!this.dbReady) {
			await this.db.open();
			this.dbReady = true;
		}
	}

	async create(task: TaskEntity): Promise<Result<TaskEntity>> {
		try {
			await this.ensureDbOpen();
			await this.db.put(task.id, task);
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
			await this.ensureDbOpen();
			const task = await this.db.get(id).catch(() => null);
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
			await this.ensureDbOpen();
			const tasks: TaskEntity[] = [];
			const iterator = this.db.iterator();

			for await (const [, value] of iterator) {
				// Normalize legacy tasks
				const normalized: TaskEntity = {
					...value,
					dependencies: Array.isArray((value as { dependencies?: unknown }).dependencies)
						? (value as { dependencies?: string[] }).dependencies
						: [],
					priority: (value as { priority?: TaskPriority }).priority || "medium",
					status: (value as { status?: TaskEntity["status"] }).status || "todo",
				};
				tasks.push(normalized);
			}

			await iterator.close();
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
			await this.ensureDbOpen();

			// Check if task exists
			const existing = await this.db.get(id).catch(() => null);
			if (!existing) {
				return {
					success: false,
					error: new Error(`Task with id ${id} not found`),
				};
			}

			await this.db.put(id, task);
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
			await this.ensureDbOpen();

			// Check if task exists
			const existing = await this.db.get(id).catch(() => null);
			if (!existing) {
				return {
					success: false,
					error: new Error(`Task with id ${id} not found`),
				};
			}

			await this.db.del(id);
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
			const allTasksResult = await this.findAll();
			if (!allTasksResult.success) {
				return allTasksResult;
			}

			const tasks = allTasksResult.data.filter((task) => task.status === status);
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
			const allTasksResult = await this.findAll();
			if (!allTasksResult.success) {
				return allTasksResult;
			}

			const tasks = allTasksResult.data.filter((task) => task.createdBy === userId);
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
			const allTasksResult = await this.findAll();
			if (!allTasksResult.success) {
				return allTasksResult;
			}

			const tasks = allTasksResult.data.filter((task) => task.assignedTo === userId);
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
			const allTasksResult = await this.findAll();
			if (!allTasksResult.success) {
				return allTasksResult;
			}

			const tasks = allTasksResult.data.filter((task) => task.collaborators?.includes(userId));
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
			const allTasksResult = await this.findAll();
			if (!allTasksResult.success) {
				return allTasksResult;
			}

			const tasks = allTasksResult.data.filter((task) => task.watchers?.includes(userId));
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
			const allTasksResult = await this.findAll();
			if (!allTasksResult.success) {
				return allTasksResult;
			}

			let tasks = allTasksResult.data;

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
		return this.search({ filters }).then((result) =>
			result.success
				? { success: true, data: result.data.tasks }
				: (result as Result<TaskEntity[]>),
		);
	}

	async findDependents(taskId: string): Promise<Result<TaskEntity[]>> {
		try {
			const allTasksResult = await this.findAll();
			if (!allTasksResult.success) {
				return allTasksResult;
			}

			const tasks = allTasksResult.data.filter((task) => task.dependencies.includes(taskId));
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
			const taskResult = await this.findById(taskId);
			if (!taskResult.success || !taskResult.data) {
				return { success: true, data: [] };
			}

			const task = taskResult.data;
			const dependencies: TaskEntity[] = [];

			for (const depId of task.dependencies) {
				const depResult = await this.findById(depId);
				if (depResult.success && depResult.data) {
					dependencies.push(depResult.data);
				}
			}

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
			await this.ensureDbOpen();

			const batch = this.db.batch();
			for (const task of tasks) {
				batch.put(task.id, task);
			}
			await batch.write();

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
			await this.ensureDbOpen();

			const batch = this.db.batch();
			for (const task of tasks) {
				batch.put(task.id, task);
			}
			await batch.write();

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
			await this.ensureDbOpen();

			const batch = this.db.batch();
			for (const id of ids) {
				batch.del(id);
			}
			await batch.write();

			return { success: true, data: undefined };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}
}
