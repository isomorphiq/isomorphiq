import path from "node:path";
import { ConflictError, type Result } from "@isomorphiq/core";
import { LevelKeyValueAdapter } from "@isomorphiq/persistence-level";
import { TaskEntitySchema, TaskEntityStruct, type TaskEntity } from "../task-domain.ts";
import type {
    TaskActionLog,
    TaskFilters,
    TaskPriority,
    TaskSearchOptions,
    TaskStatus,
} from "../types.ts";
import {
    TaskActionLogSchema,
    TaskActionLogStruct,
    TaskPrioritySchema,
    TaskStatusSchema,
    TaskTypeSchema,
} from "../types.ts";
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

const readNumber = (record: Record<string, unknown>, key: string): number | undefined => {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === "string") {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
};

const ACTION_LOG_BASE_KEYS = [
    "id",
    "summary",
    "profile",
    "durationMs",
    "createdAt",
    "success",
    "transition",
    "prompt",
    "modelName",
];

const ACTION_LOG_BASE_KEY_SET = new Set(ACTION_LOG_BASE_KEYS);

const readActionLogExtras = (record: Record<string, unknown>): Record<string, unknown> =>
    Object.entries(record).reduce<Record<string, unknown>>((acc, [key, value]) => {
        if (ACTION_LOG_BASE_KEY_SET.has(key)) {
            return acc;
        }
        return { ...acc, [key]: value };
    }, {});

const normalizeActionLogEntry = (
    value: unknown,
    fallbackTaskId: string,
    index: number,
): TaskActionLog | null => {
    if (!isRecord(value)) {
        return null;
    }
    const extras = readActionLogExtras(value);
    const normalized = {
        ...extras,
        id: readString(value, "id") ?? `log-${fallbackTaskId}-${index}`,
        summary: readString(value, "summary") ?? "",
        profile: readString(value, "profile") ?? "unknown",
        durationMs: readNumber(value, "durationMs") ?? 0,
        createdAt: readDate(value, "createdAt") ?? new Date(),
        success: typeof value.success === "boolean" ? value.success : true,
        transition: readString(value, "transition"),
        prompt: readString(value, "prompt"),
        modelName: readString(value, "modelName"),
    };
    const parsed = TaskActionLogSchema.safeParse(normalized);
    return parsed.success ? TaskActionLogStruct.from(parsed.data) : null;
};

const readActionLog = (
    record: Record<string, unknown>,
    fallbackTaskId: string,
): TaskActionLog[] | undefined => {
    const value = record.actionLog;
    if (!Array.isArray(value)) {
        return undefined;
    }
    const normalized = value
        .map((entry, index) => normalizeActionLogEntry(entry, fallbackTaskId, index))
        .filter((entry): entry is TaskActionLog => entry !== null);
    return normalized.length > 0 ? normalized : [];
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
        prd: readString(value, "prd"),
        status: statusResult.success ? statusResult.data : "todo",
        priority: priorityResult.success ? priorityResult.data : "medium",
        type: typeResult.success ? typeResult.data : "task",
        branch: readString(value, "branch"),
        dependencies: readStringArray(value, "dependencies") ?? [],
        createdBy: readString(value, "createdBy") ?? "system",
        assignedTo: readString(value, "assignedTo"),
        collaborators: readStringArray(value, "collaborators"),
        watchers: readStringArray(value, "watchers"),
        actionLog: readActionLog(value, fallbackId) ?? [],
        createdAt: readDate(value, "createdAt") ?? new Date(),
        updatedAt: readDate(value, "updatedAt") ?? new Date(),
    };

    const normalizedResult = TaskEntitySchema.safeParse(normalized);
    return normalizedResult.success ? TaskEntityStruct.from(normalizedResult.data) : null;
};

const BRANCH_INDEX_PREFIX = "branch-index:";

const normalizeBranchName = (branch: string | undefined): string | null => {
    if (typeof branch !== "string") {
        return null;
    }
    const normalized = branch.trim();
    return normalized.length > 0 ? normalized : null;
};

/**
 * LevelDB-backed task repository used by the tasks domain.
 * Stores tasks under a configurable path (default: db/tasks).
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class LevelDbTaskRepository implements TaskRepository {
    private db: LevelKeyValueAdapter<string, unknown>;
    private dbReady = false;

    constructor(dbPath?: string) {
        const defaultPath = path.join(process.cwd(), "db", "tasks");
        this.db = new LevelKeyValueAdapter<string, unknown>(dbPath || defaultPath);
    }

    private async ensureDbOpen(): Promise<void> {
        if (!this.dbReady) {
            await this.db.open();
            this.dbReady = true;
        }
    }

    private branchIndexKey(branch: string): string {
        return `${BRANCH_INDEX_PREFIX}${branch}`;
    }

    private async getIndexedTaskIdForBranch(branch: string): Promise<string | null> {
        const raw = await this.db.get(this.branchIndexKey(branch)).catch(() => null);
        return typeof raw === "string" && raw.trim().length > 0 ? raw : null;
    }

    private async assertBranchAvailable(branch: string, expectedTaskId: string): Promise<void> {
        const indexedTaskId = await this.getIndexedTaskIdForBranch(branch);
        if (!indexedTaskId || indexedTaskId === expectedTaskId) {
            return;
        }
        throw new ConflictError(
            `Branch "${branch}" is already assigned to task ${indexedTaskId}`,
            { field: "branch" },
        );
    }

    private async setBranchIndex(branch: string, taskId: string): Promise<void> {
        await this.db.put(this.branchIndexKey(branch), taskId);
    }

    private async removeBranchIndex(branch: string): Promise<void> {
        await this.db.del(this.branchIndexKey(branch)).catch(() => undefined);
    }

    async create(task: TaskEntity): Promise<Result<TaskEntity>> {
        try {
            await this.ensureDbOpen();
            const branch = normalizeBranchName(task.branch);
            if (branch) {
                await this.assertBranchAvailable(branch, task.id);
            }
            await this.db.put(task.id, task);
            if (branch) {
                await this.setBranchIndex(branch, task.id);
            }
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
            const existingRaw = await this.db.get(id).catch(() => null);
            const existing = existingRaw ? normalizeTaskEntity(existingRaw, id) : null;
            if (!existing) {
                return {
                    success: false,
                    error: new Error(`Task with id ${id} not found`),
                };
            }

            const existingBranch = normalizeBranchName(existing.branch);
            const nextBranch = normalizeBranchName(task.branch);
            if (nextBranch && nextBranch !== existingBranch) {
                await this.assertBranchAvailable(nextBranch, id);
            }

            await this.db.put(id, task);
            if (existingBranch && existingBranch !== nextBranch) {
                await this.removeBranchIndex(existingBranch);
            }
            if (nextBranch) {
                await this.setBranchIndex(nextBranch, id);
            }
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
            const existingRaw = await this.db.get(id).catch(() => null);
            const existing = existingRaw ? normalizeTaskEntity(existingRaw, id) : null;
            if (!existing) {
                return {
                    success: false,
                    error: new Error(`Task with id ${id} not found`),
                };
            }

            await this.db.del(id);
            const existingBranch = normalizeBranchName(existing.branch);
            if (existingBranch) {
                await this.removeBranchIndex(existingBranch);
            }
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

    async findByBranch(branch: string): Promise<Result<TaskEntity | null>> {
        try {
            await this.ensureDbOpen();
            const normalizedBranch = normalizeBranchName(branch);
            if (!normalizedBranch) {
                return { success: true, data: null };
            }

            const indexedTaskId = await this.getIndexedTaskIdForBranch(normalizedBranch);
            if (indexedTaskId) {
                const indexedTaskResult = await this.findById(indexedTaskId);
                if (!indexedTaskResult.success) {
                    return { success: false, error: indexedTaskResult.error };
                }
                if (
                    indexedTaskResult.data &&
                    normalizeBranchName(indexedTaskResult.data.branch) === normalizedBranch
                ) {
                    return { success: true, data: indexedTaskResult.data };
                }
                await this.removeBranchIndex(normalizedBranch);
            }

            const allTasksResult = await this.findAll();
            if (!allTasksResult.success) {
                return { success: false, error: allTasksResult.error };
            }

            const match =
                allTasksResult.data.find(
                    (task) => normalizeBranchName(task.branch) === normalizedBranch,
                ) ?? null;
            if (match) {
                await this.setBranchIndex(normalizedBranch, match.id);
            }
            return { success: true, data: match };
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
                        task.description.toLowerCase().includes(query) ||
                        (typeof task.prd === "string" && task.prd.toLowerCase().includes(query)),
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
            const branchAssignments = new Map<string, string>();
            const previousBranches = new Map<string, string | null>();
            for (const task of tasks) {
                const nextBranch = normalizeBranchName(task.branch);
                if (nextBranch) {
                    const existingAssignment = branchAssignments.get(nextBranch);
                    if (existingAssignment && existingAssignment !== task.id) {
                        throw new ConflictError(
                            `Branch "${nextBranch}" is assigned multiple times in createMany payload`,
                            { field: "branch" },
                        );
                    }
                    branchAssignments.set(nextBranch, task.id);
                }
                const existingRaw = await this.db.get(task.id).catch(() => null);
                const existing = existingRaw ? normalizeTaskEntity(existingRaw, task.id) : null;
                previousBranches.set(task.id, normalizeBranchName(existing?.branch));
            }

            for (const [branch, taskId] of branchAssignments.entries()) {
                await this.assertBranchAvailable(branch, taskId);
            }

            for (const task of tasks) {
                const previousBranch = previousBranches.get(task.id) ?? null;
                const nextBranch = normalizeBranchName(task.branch);
                await this.db.put(task.id, task);
                if (previousBranch && previousBranch !== nextBranch) {
                    await this.removeBranchIndex(previousBranch);
                }
                if (nextBranch) {
                    await this.setBranchIndex(nextBranch, task.id);
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

    async updateMany(tasks: TaskEntity[]): Promise<Result<TaskEntity[]>> {
        try {
            await this.ensureDbOpen();
            const branchAssignments = new Map<string, string>();
            const previousBranches = new Map<string, string | null>();
            for (const task of tasks) {
                const nextBranch = normalizeBranchName(task.branch);
                if (nextBranch) {
                    const existingAssignment = branchAssignments.get(nextBranch);
                    if (existingAssignment && existingAssignment !== task.id) {
                        throw new ConflictError(
                            `Branch "${nextBranch}" is assigned multiple times in updateMany payload`,
                            { field: "branch" },
                        );
                    }
                    branchAssignments.set(nextBranch, task.id);
                }
                const existingRaw = await this.db.get(task.id).catch(() => null);
                const existing = existingRaw ? normalizeTaskEntity(existingRaw, task.id) : null;
                previousBranches.set(task.id, normalizeBranchName(existing?.branch));
            }

            for (const [branch, taskId] of branchAssignments.entries()) {
                await this.assertBranchAvailable(branch, taskId);
            }

            for (const task of tasks) {
                const previousBranch = previousBranches.get(task.id) ?? null;
                const nextBranch = normalizeBranchName(task.branch);
                await this.db.put(task.id, task);
                if (previousBranch && previousBranch !== nextBranch) {
                    await this.removeBranchIndex(previousBranch);
                }
                if (nextBranch) {
                    await this.setBranchIndex(nextBranch, task.id);
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
            await this.ensureDbOpen();
            const previousBranches = new Map<string, string>();
            for (const id of ids) {
                const existingRaw = await this.db.get(id).catch(() => null);
                const existing = existingRaw ? normalizeTaskEntity(existingRaw, id) : null;
                const existingBranch = normalizeBranchName(existing?.branch);
                if (existingBranch) {
                    previousBranches.set(id, existingBranch);
                }
            }
            for (const id of ids) {
                await this.db.del(id);
                const existingBranch = previousBranches.get(id);
                if (existingBranch) {
                    await this.removeBranchIndex(existingBranch);
                }
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
