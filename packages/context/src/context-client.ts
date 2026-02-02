import { createTRPCClient, httpLink } from "@trpc/client";
import type { Operation, TRPCClient } from "@trpc/client";
import { ConfigManager } from "@isomorphiq/core";
import type {
    ContextData,
    ContextRecord,
    CreateContextInput,
} from "./context-domain.ts";
import type { ContextServiceRouter } from "./context-service-router.ts";

export type ContextClientOptions = {
    url?: string;
    environment?: string;
    headers?: Record<string, string>;
};

export type ContextClient = {
    createContext: (input?: CreateContextInput) => Promise<ContextRecord>;
    getContext: (id: string) => Promise<ContextRecord | null>;
    updateContext: (id: string, patch: ContextData) => Promise<ContextRecord>;
    replaceContext: (id: string, data: ContextData) => Promise<ContextRecord>;
    deleteContext: (id: string) => Promise<void>;
    listContexts: () => Promise<ContextRecord[]>;
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
    const direct = process.env.CONTEXT_SERVICE_URL ?? process.env.CONTEXT_HTTP_URL;
    if (direct) {
        return direct;
    }
    const host = process.env.CONTEXT_HOST ?? "127.0.0.1";
    const portRaw = process.env.CONTEXT_HTTP_PORT ?? process.env.CONTEXT_PORT ?? "3008";
    const port = Number.parseInt(portRaw, 10);
    const resolvedPort = Number.isFinite(port) && port > 0 ? port : 3008;
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

export const createContextClient = (options: ContextClientOptions = {}): ContextClient => {
    const envHeader = resolveEnvironmentHeaderName();
    const defaultEnvironment = resolveDefaultEnvironment();
    const environment = options.environment ?? defaultEnvironment;
    const baseUrl = normalizeTrpcUrl(options.url ?? resolveBaseUrl());

    const client: TRPCClient<ContextServiceRouter> = createTRPCClient({
        links: [
            httpLink({
                url: baseUrl,
                headers: (opts) => buildHeaders(envHeader, environment, options.headers, opts.op),
            }),
        ],
    });

    return {
        createContext: async (input) => client.create.mutate(input ?? {}),
        getContext: async (id) => client.get.query({ id }),
        updateContext: async (id, patch) => client.update.mutate({ id, patch }),
        replaceContext: async (id, data) => client.replace.mutate({ id, data }),
        deleteContext: async (id) => {
            await client.delete.mutate({ id });
        },
        listContexts: async () => client.list.query(),
    };
};
