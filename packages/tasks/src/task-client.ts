import { createTRPCClient, createWSClient, httpLink, splitLink, wsLink } from "@trpc/client";
import type { Operation, TRPCClient, TRPCClientError } from "@trpc/client";
import type { Unsubscribable } from "@trpc/server/observable";
import { ConfigManager } from "@isomorphiq/core";
import { z } from "zod";
import {
    TaskEntitySchema,
    type CreateTaskInputWithPriority,
    type ExtendedUpdateTaskInput,
    type TaskEntity,
} from "./task-domain.ts";
import {
    TaskActionLogSchema,
    TaskSearchResultSchema,
    type TaskPriority,
    type TaskSearchOptions,
    type TaskStatus,
} from "./types.ts";
import type { TaskServiceRouter } from "./task-service-router.ts";
import type { TaskEvent } from "./task-events.ts";

export type TaskClientOptions = {
    url?: string;
    wsUrl?: string;
    environment?: string;
    headers?: Record<string, string>;
    enableSubscriptions?: boolean;
};

export type TaskClient = {
    listTasks: () => Promise<TaskEntity[]>;
    getTask: (id: string) => Promise<TaskEntity | null>;
    searchTasks: (options: TaskSearchOptions) => Promise<{ tasks: TaskEntity[]; total: number }>;
    createTask: (input: CreateTaskInputWithPriority, createdBy?: string) => Promise<TaskEntity>;
    updateTask: (id: string, updates: Omit<ExtendedUpdateTaskInput, "id">, updatedBy?: string) =>
        Promise<TaskEntity>;
    deleteTask: (id: string, deletedBy?: string) => Promise<void>;
    updateTaskStatus: (id: string, status: TaskStatus, updatedBy?: string) => Promise<TaskEntity>;
    claimTask: (id: string, workerId: string) => Promise<TaskEntity | null>;
    updateTaskPriority: (id: string, priority: TaskPriority, updatedBy?: string) => Promise<TaskEntity>;
    assignTask: (id: string, assignedTo: string, assignedBy?: string) => Promise<TaskEntity>;
    addCollaborator: (id: string, userId: string, updatedBy?: string) => Promise<TaskEntity>;
    removeCollaborator: (id: string, userId: string, updatedBy?: string) => Promise<TaskEntity>;
    addWatcher: (id: string, userId: string, updatedBy?: string) => Promise<TaskEntity>;
    removeWatcher: (id: string, userId: string, updatedBy?: string) => Promise<TaskEntity>;
    addDependency: (id: string, dependsOn: string, updatedBy?: string) => Promise<TaskEntity>;
    removeDependency: (id: string, dependsOn: string, updatedBy?: string) => Promise<TaskEntity>;
    getTasksByStatus: (status: TaskStatus) => Promise<TaskEntity[]>;
    getTasksByUser: (userId: string) => Promise<TaskEntity[]>;
    getTasksSortedByDependencies: () => Promise<TaskEntity[]>;
    createManyTasks: (inputs: CreateTaskInputWithPriority[], createdBy?: string) => Promise<TaskEntity[]>;
    subscribeToTaskEvents?: (handler: (event: TaskEvent) => void) => Unsubscribable;
    close: () => Promise<void>;
};

const resolveEnvironmentHeaderName = (): string =>
    ConfigManager.getInstance().getEnvironmentConfig().headerName;

const resolveDefaultEnvironment = (): string =>
    ConfigManager.getInstance().getEnvironmentConfig().default;

const normalizeTrpcUrl = (url: string): string => {
    if (url.includes("/trpc")) {
        return url;
    }
    return `${url.replace(/\/$/, "")}/trpc`;
};

const resolveBaseUrl = (): string => {
    const direct = process.env.TASKS_SERVICE_URL ?? process.env.TASKS_HTTP_URL;
    if (direct) {
        return direct;
    }
    const host = process.env.TASKS_HOST ?? "127.0.0.1";
    const portRaw = process.env.TASKS_HTTP_PORT ?? process.env.TASKS_PORT ?? "3006";
    const port = Number.parseInt(portRaw, 10);
    const resolvedPort = Number.isFinite(port) && port > 0 ? port : 3006;
    return `http://${host}:${resolvedPort}`;
};

const toWebSocketUrl = (url: string): string =>
    url.replace(/^http:/, "ws:").replace(/^https:/, "wss:");

const buildHeaders = (
    envHeader: string,
    environment: string | undefined,
    baseHeaders: Record<string, string> | undefined,
    op?: Operation,
): Record<string, string> => {
    const contextEnv = (op?.context as { environment?: string } | undefined)?.environment;
    const resolvedEnv = contextEnv ?? environment;
    return {
        ...(baseHeaders ?? {}),
        ...(resolvedEnv ? { [envHeader]: resolvedEnv } : {}),
    };
};

const CoercedDateSchema = z.preprocess((value) => {
    if (value instanceof Date) {
        return value;
    }
    if (typeof value === "string" || typeof value === "number") {
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) {
            return parsed;
        }
    }
    return value;
}, z.date());

const TaskActionLogWireSchema = TaskActionLogSchema.extend({
    createdAt: CoercedDateSchema,
});

const TaskWireSchema = TaskEntitySchema.extend({
    createdAt: CoercedDateSchema,
    updatedAt: CoercedDateSchema,
    actionLog: z.array(TaskActionLogWireSchema).optional(),
});

const TaskListSchema = z.array(TaskWireSchema);

const TaskSearchResultWireSchema = TaskSearchResultSchema.extend({
    tasks: TaskListSchema,
});

const normalizeTask = (value: unknown): TaskEntity => TaskWireSchema.parse(value);

const normalizeTaskList = (value: unknown): TaskEntity[] => TaskListSchema.parse(value);

const normalizeOptionalTask = (value: unknown): TaskEntity | null => {
    if (value === null || value === undefined) {
        return null;
    }
    return normalizeTask(value);
};

const normalizeSearchResult = (value: unknown): { tasks: TaskEntity[]; total: number } => {
    const parsed = TaskSearchResultWireSchema.parse(value);
    return {
        tasks: parsed.tasks,
        total: parsed.total,
    };
};

export const createTaskClient = (options: TaskClientOptions = {}): TaskClient => {
    const envHeader = resolveEnvironmentHeaderName();
    const defaultEnvironment = resolveDefaultEnvironment();
    const environment = options.environment ?? defaultEnvironment;
    const baseUrl = normalizeTrpcUrl(options.url ?? resolveBaseUrl());
    const wsUrl = options.wsUrl ?? toWebSocketUrl(baseUrl);
    const shouldEnableSubscriptions = options.enableSubscriptions !== false;

    const wsClient = shouldEnableSubscriptions
        ? createWSClient({
            url: wsUrl,
            connectionParams: () => ({ environment }),
        })
        : null;

    const client: TRPCClient<TaskServiceRouter> = createTRPCClient<TaskServiceRouter>({
        links: [
            ...(wsClient
                ? [
                    splitLink({
                        condition: (op) => op.type === "subscription",
                        true: wsLink({ client: wsClient }),
                        false: httpLink({
                            url: baseUrl,
                            headers: (opts) => buildHeaders(envHeader, environment, options.headers, opts.op),
                        }),
                    }),
                ]
                : [
                    httpLink({
                        url: baseUrl,
                        headers: (opts) => buildHeaders(envHeader, environment, options.headers, opts.op),
                    }),
                ]),
        ],
    });

    return {
        listTasks: async () => normalizeTaskList(await client.list.query()),
        getTask: async (id: string) => normalizeOptionalTask(await client.get.query({ id })),
        searchTasks: async (optionsValue: TaskSearchOptions) =>
            normalizeSearchResult(await client.search.query(optionsValue)),
        createTask: async (input, createdBy) =>
            normalizeTask(await client.create.mutate({ input, createdBy })),
        updateTask: async (id, updates, updatedBy) =>
            normalizeTask(await client.update.mutate({ id, updates, updatedBy })),
        deleteTask: async (id, deletedBy) => {
            await client.delete.mutate({ id, deletedBy });
        },
        updateTaskStatus: async (id, status, updatedBy) =>
            normalizeTask(await client.updateStatus.mutate({ id, status, updatedBy })),
        claimTask: async (id, workerId) =>
            normalizeOptionalTask(await client.claimTask.mutate({ id, workerId })),
        updateTaskPriority: async (id, priority, updatedBy) =>
            normalizeTask(await client.updatePriority.mutate({ id, priority, updatedBy })),
        assignTask: async (id, assignedTo, assignedBy) =>
            normalizeTask(await client.assign.mutate({ id, assignedTo, assignedBy })),
        addCollaborator: async (id, userId, updatedBy) =>
            normalizeTask(await client.addCollaborator.mutate({ id, userId, updatedBy })),
        removeCollaborator: async (id, userId, updatedBy) =>
            normalizeTask(await client.removeCollaborator.mutate({ id, userId, updatedBy })),
        addWatcher: async (id, userId, updatedBy) =>
            normalizeTask(await client.addWatcher.mutate({ id, userId, updatedBy })),
        removeWatcher: async (id, userId, updatedBy) =>
            normalizeTask(await client.removeWatcher.mutate({ id, userId, updatedBy })),
        addDependency: async (id, dependsOn, updatedBy) =>
            normalizeTask(await client.addDependency.mutate({ id, dependsOn, updatedBy })),
        removeDependency: async (id, dependsOn, updatedBy) =>
            normalizeTask(await client.removeDependency.mutate({ id, dependsOn, updatedBy })),
        getTasksByStatus: async (status) =>
            normalizeTaskList(await client.getByStatus.query({ status })),
        getTasksByUser: async (userId) =>
            normalizeTaskList(await client.getByUser.query({ userId })),
        getTasksSortedByDependencies: async () =>
            normalizeTaskList(await client.sortedByDependencies.query()),
        createManyTasks: async (inputs, createdBy) =>
            normalizeTaskList(await client.createMany.mutate({ inputs, createdBy })),
        subscribeToTaskEvents: wsClient
            ? (handler: (event: TaskEvent) => void) =>
                client.taskEvents.subscribe(undefined, {
                    onData: handler,
                    onError: (error: TRPCClientError<TaskServiceRouter>) => {
                        console.error("[TaskClient] Subscription error:", error);
                    },
                })
            : undefined,
        close: async () => {
            if (wsClient) {
                await wsClient.close();
            }
        },
    };
};
