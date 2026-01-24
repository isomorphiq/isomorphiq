import path from "node:path";
import type { Result } from "@isomorphiq/core";
import { LevelKeyValueAdapter } from "@isomorphiq/persistence-level";
import { TaskEntitySchema, TaskEntityStruct, type TaskEntity } from "../task-domain.ts";
import type { TaskFilters, TaskPriority, TaskSearchOptions, TaskStatus } from "../types.ts";
import { TaskPrioritySchema, TaskStatusSchema, TaskTypeSchema } from "../types.ts";
import type { TaskRepository } from "../task-repository.ts";

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null;

const readString = (record: Record<string, unknown>, key: string): string | undefined => {
    const value = record[key];
    return typeof value === "string" ? value : undefined;
};

const readStringArray = (record: Record<string, unknown>, key: string): string[] | undefined => {
    const value = record[key];
    if (!Array.isArray(value)) {
        return undefined;
    }
    return value.filter((item): item is string => typeof item === "string");
};

const readDate = (record: Record<string, unknown>, key: string): Date | undefined => {
    const value = record[key];
    if (value instanceof Date) {
        return value;
    }
    if (typeof value === "string" || typeof value === "number") {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? undefined : date;
    }
    return undefined;
};

const normalizeTaskEntity = (value: unknown, key?: string): TaskEntity | null => {
    const parsed = TaskEntitySchema.safeParse(value);
    if (parsed.success) {
        return TaskEntityStruct.from(parsed.data);
    }

    if (!isRecord(value)) {
        return null;
    }

    const priorityResult = TaskPrioritySchema.safeParse(value.priority);
    const statusResult = TaskStatusSchema.safeParse(value.status);
    const typeResult = TaskTypeSchema.safeParse(value.type);

    const fallbackId = typeof key === "string" ? key : "";
    const normalized = {
        id: readString(value, "id") ?? fallbackId,
        title: readString(value, "title") ?? "",
        description: readString(value, "description") ?? "",
        status: statusResult.success ? statusResult.data : "todo",
        priority: priorityResult.success ? priorityResult.data : "medium",
        type: typeResult.success ? typeResult.data : "task",
        dependencies: readStringArray(value, "dependencies") ?? [],
        createdBy: readString(value, "createdBy") ?? "system",
        assignedTo: readString(value, "assignedTo"),
        collaborators: readStringArray(value, "collaborators"),
        watchers: readStringArray(value, "watchers"),
        createdAt: readDate(value, "createdAt") ?? new Date(),
        updatedAt: readDate(value, "updatedAt") ?? new Date(),
    };

    const normalizedResult = TaskEntitySchema.safeParse(normalized);
    return normalizedResult.success ? TaskEntityStruct.from(normalizedResult.data) : null;
};

/**
 * LevelDB-backed task repository used by the tasks domain.
 * Stores tasks under a configurable path (default: db/tasks).
 */
export class LevelDbTaskRepository implements TaskRepository {
    private db: LevelKeyValueAdapter<string, TaskEntity>;
    private dbReady = false;

    constructor(dbPath?: string) {
        const defaultPath = path.join(process.cwd(), "db", "tasks");
        this.db = new LevelKeyValueAdapter<string, TaskEntity>(dbPath || defaultPath);
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
            if (!task) {
                return { success: true, data: null };
            }
            const normalized = normalizeTaskEntity(task, id);
            return { success: true, data: normalized };
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

            for await (const [key, value] of iterator) {
                const normalized = normalizeTaskEntity(value, String(key));
                if (normalized) {
                    tasks.push(normalized);
                }
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

    async findByStatus(status: TaskStatus): Promise<Result<TaskEntity[]>> {
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
                return {
                    success: false,
                    error: allTasksResult.error || new Error("Failed to fetch tasks"),
                };
            }

            let tasks = allTasksResult.data;

            if (options.filters) {
                if (options.filters.status) {
                    tasks = tasks.filter((task) => options.filters?.status?.includes(task.status));
                }
                if (options.filters.priority) {
                    tasks = tasks.filter((task) => options.filters?.priority?.includes(task.priority));
                }
                if (options.filters.assignedTo) {
                    tasks = tasks.filter(
                        (task) =>
                            task.assignedTo && options.filters?.assignedTo?.includes(task.assignedTo),
                    );
                }
                if (options.filters.createdBy) {
                    tasks = tasks.filter((task) => options.filters?.createdBy?.includes(task.createdBy));
                }
                if (options.filters.collaborators) {
                    tasks = tasks.filter((task) =>
                        task.collaborators?.some((collab) => options.filters?.collaborators?.includes(collab)),
                    );
                }
                if (options.filters.watchers) {
                    tasks = tasks.filter((task) =>
                        task.watchers?.some((watcher) => options.filters?.watchers?.includes(watcher)),
                    );
                }
            }

            if (options.query) {
                const query = options.query.toLowerCase();
                tasks = tasks.filter(
                    (task) =>
                        task.title.toLowerCase().includes(query) ||
                        task.description.toLowerCase().includes(query),
                );
            }

            if (options.sort) {
                tasks = tasks.slice().sort((a, b) => {
                    const { field, direction } = options.sort ?? { field: undefined, direction: "asc" };
                    const directionMultiplier = direction === "asc" ? 1 : -1;
                    const priorityOrder: Record<TaskPriority, number> = { high: 3, medium: 2, low: 1 };

                    const compareStrings = (left: string, right: string): number =>
                        left.localeCompare(right) * directionMultiplier;
                    const compareNumbers = (left: number, right: number): number =>
                        (left - right) * directionMultiplier;
                    const compareDates = (left: Date, right: Date): number =>
                        (left.getTime() - right.getTime()) * directionMultiplier;

                    switch (field) {
                        case "title":
                            return compareStrings(a.title, b.title);
                        case "priority":
                            return compareNumbers(priorityOrder[a.priority], priorityOrder[b.priority]);
                        case "status":
                            return compareStrings(a.status, b.status);
                        case "createdAt":
                            return compareDates(a.createdAt, b.createdAt);
                        case "updatedAt":
                            return compareDates(a.updatedAt, b.updatedAt);
                        default:
                            return 0;
                    }
                });
            }

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

            const tasksResult = await this.findAll();
            if (!tasksResult.success) {
                return tasksResult;
            }

            const dependencies = taskResult.data.dependencies
                .map((depId) => tasksResult.data.find((t) => t.id === depId))
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
            await this.ensureDbOpen();
            for (const task of tasks) {
                await this.db.put(task.id, task);
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
            await this.ensureDbOpen();
            for (const task of tasks) {
                await this.db.put(task.id, task);
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
            await this.ensureDbOpen();
            for (const id of ids) {
                await this.db.del(id);
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
