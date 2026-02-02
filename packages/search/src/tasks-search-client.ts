import { createTRPCUntypedClient, httpLink } from "@trpc/client";
import type { Operation } from "@trpc/client";
import { ConfigManager } from "@isomorphiq/core";
import { z } from "zod";

export type TaskSearchSortField = "title" | "createdAt" | "updatedAt" | "priority" | "status";

export type TaskSearchOptionsLike = {
    query?: string;
    filters?: {
        status?: string[];
        priority?: string[];
        assignedTo?: string[];
        createdBy?: string[];
        collaborators?: string[];
        watchers?: string[];
        dateFrom?: string;
        dateTo?: string;
    };
    sort?: {
        field: TaskSearchSortField;
        direction: "asc" | "desc";
    };
    limit?: number;
    offset?: number;
};

export type TasksSearchClient = {
    searchTasks: (
        options: TaskSearchOptionsLike,
    ) => Promise<{ tasks: unknown[]; total: number }>;
};

export type TasksSearchClientOptions = {
    url?: string;
    environment?: string;
    headers?: Record<string, string>;
};

const TaskSearchResultSchema = z.object({
    tasks: z.array(z.unknown()),
    total: z.number(),
});

const normalizeSearchResult = (
    value: unknown,
): { tasks: unknown[]; total: number } =>
    TaskSearchResultSchema.parse(value) as { tasks: unknown[]; total: number };

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

export const createTasksSearchClient = (
    options: TasksSearchClientOptions = {},
): TasksSearchClient => {
    const envHeader = resolveEnvironmentHeaderName();
    const defaultEnvironment = resolveDefaultEnvironment();
    const environment = options.environment ?? defaultEnvironment;
    const baseUrl = normalizeTrpcUrl(options.url ?? resolveBaseUrl());

    const client = createTRPCUntypedClient({
        links: [
            httpLink({
                url: baseUrl,
                headers: (opts) => buildHeaders(envHeader, environment, options.headers, opts.op),
            }),
        ],
    });

    return {
        searchTasks: async (optionsValue: TaskSearchOptionsLike) =>
            normalizeSearchResult(await client.query("search", optionsValue)),
    };
};
