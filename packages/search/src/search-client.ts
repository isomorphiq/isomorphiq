import { createTRPCClient, httpLink } from "@trpc/client";
import type { Operation, TRPCClient } from "@trpc/client";
import { ConfigManager } from "@isomorphiq/core";
import { z } from "zod";
import {
    SavedSearchSchema,
    SearchResultSchema,
    type CreateSavedSearchInput,
    type SavedSearch,
    type SearchQuery,
    type SearchResult,
    type UpdateSavedSearchInput,
} from "./search-domain.ts";
import type { SearchServiceRouter } from "./search-service-router.ts";

export type SearchClientOptions = {
    url?: string;
    environment?: string;
    headers?: Record<string, string>;
};

export type SearchClient = {
    search: (query: SearchQuery) => Promise<SearchResult>;
    createSavedSearch: (input: CreateSavedSearchInput, createdBy: string) => Promise<SavedSearch>;
    listSavedSearches: (userId?: string) => Promise<SavedSearch[]>;
    getSavedSearch: (id: string, userId?: string) => Promise<SavedSearch | null>;
    updateSavedSearch: (input: UpdateSavedSearchInput, userId: string) => Promise<SavedSearch>;
    deleteSavedSearch: (id: string, userId: string) => Promise<void>;
    executeSavedSearch: (id: string, userId?: string) => Promise<SearchResult>;
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
    const direct = process.env.SEARCH_SERVICE_URL ?? process.env.SEARCH_HTTP_URL;
    if (direct) {
        return direct;
    }
    const host = process.env.SEARCH_HOST ?? "127.0.0.1";
    const portRaw = process.env.SEARCH_HTTP_PORT ?? process.env.SEARCH_PORT ?? "3007";
    const port = Number.parseInt(portRaw, 10);
    const resolvedPort = Number.isFinite(port) && port > 0 ? port : 3007;
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

const SavedSearchWireSchema = SavedSearchSchema.extend({
    createdAt: CoercedDateSchema,
    updatedAt: CoercedDateSchema,
});

const SavedSearchListSchema = z.array(SavedSearchWireSchema);

const normalizeSearchResult = (value: unknown): SearchResult =>
    SearchResultSchema.parse(value) as SearchResult;

const normalizeSavedSearch = (value: unknown): SavedSearch =>
    SavedSearchWireSchema.parse(value) as SavedSearch;

const normalizeSavedSearchList = (value: unknown): SavedSearch[] =>
    SavedSearchListSchema.parse(value) as SavedSearch[];

const normalizeOptionalSavedSearch = (value: unknown): SavedSearch | null => {
    if (value === null || value === undefined) {
        return null;
    }
    return normalizeSavedSearch(value);
};

export const createSearchClient = (options: SearchClientOptions = {}): SearchClient => {
    const envHeader = resolveEnvironmentHeaderName();
    const defaultEnvironment = resolveDefaultEnvironment();
    const environment = options.environment ?? defaultEnvironment;
    const baseUrl = normalizeTrpcUrl(options.url ?? resolveBaseUrl());

    const client: TRPCClient<SearchServiceRouter> = createTRPCClient<SearchServiceRouter>({
        links: [
            httpLink({
                url: baseUrl,
                headers: (opts) => buildHeaders(envHeader, environment, options.headers, opts.op),
            }),
        ],
    });

    return {
        search: async (query) => normalizeSearchResult(await client.search.query(query)),
        createSavedSearch: async (input, createdBy) =>
            normalizeSavedSearch(await client.createSavedSearch.mutate({ input, createdBy })),
        listSavedSearches: async (userId) =>
            normalizeSavedSearchList(await client.listSavedSearches.query({ userId })),
        getSavedSearch: async (id, userId) =>
            normalizeOptionalSavedSearch(await client.getSavedSearch.query({ id, userId })),
        updateSavedSearch: async (input, userId) =>
            normalizeSavedSearch(await client.updateSavedSearch.mutate({ input, userId })),
        deleteSavedSearch: async (id, userId) =>
            client.deleteSavedSearch.mutate({ id, userId }),
        executeSavedSearch: async (id, userId) =>
            normalizeSearchResult(await client.executeSavedSearch.query({ id, userId })),
    };
};
