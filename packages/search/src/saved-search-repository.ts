import { LevelKeyValueAdapter } from "@isomorphiq/persistence-level";
import type { KeyValueAdapter, KeyValueIterator } from "@isomorphiq/persistence-adapter";
import type { SavedSearch } from "./search-domain.ts";

export type SavedSearchRepository = {
    open: () => Promise<void>;
    close: () => Promise<void>;
    get: (id: string) => Promise<SavedSearch | null>;
    put: (search: SavedSearch) => Promise<void>;
    del: (id: string) => Promise<void>;
    list: () => Promise<SavedSearch[]>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value);

const isNotFoundError = (error: unknown): boolean => {
    if (!isRecord(error)) {
        return false;
    }
    const code = error.code;
    return code === "LEVEL_NOT_FOUND" || code === "NotFound";
};

const normalizeDate = (value: unknown): Date => {
    if (value instanceof Date) {
        return value;
    }
    if (typeof value === "string" || typeof value === "number") {
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) {
            return parsed;
        }
    }
    return new Date();
};

const normalizeSavedSearch = (search: SavedSearch): SavedSearch => ({
    ...search,
    createdAt: normalizeDate(search.createdAt),
    updatedAt: normalizeDate(search.updatedAt),
});

const readAll = async (
    iterator: KeyValueIterator<string, SavedSearch>,
): Promise<SavedSearch[]> => {
    const results: SavedSearch[] = [];
    try {
        for await (const [, value] of iterator) {
            results.push(normalizeSavedSearch(value));
        }
    } finally {
        await iterator.close();
    }
    return results;
};

const createAdapter = (dbPath: string): KeyValueAdapter<string, SavedSearch> =>
    new LevelKeyValueAdapter<string, SavedSearch>(dbPath);

export const createSavedSearchRepository = (dbPath: string): SavedSearchRepository => {
    const adapter = createAdapter(dbPath);

    return {
        open: async () => {
            await adapter.open();
        },
        close: async () => {
            await adapter.close();
        },
        get: async (id: string) => {
            await adapter.open();
            try {
                const value = await adapter.get(id);
                return normalizeSavedSearch(value);
            } catch (error) {
                if (isNotFoundError(error)) {
                    return null;
                }
                throw error;
            }
        },
        put: async (search: SavedSearch) => {
            await adapter.open();
            await adapter.put(search.id, search);
        },
        del: async (id: string) => {
            await adapter.open();
            await adapter.del(id);
        },
        list: async () => {
            await adapter.open();
            const iterator = adapter.iterator();
            return await readAll(iterator);
        },
    };
};
