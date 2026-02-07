// FILE_CONTEXT: "context-e00f613e-60db-4882-923f-807cab4ca013"

import { LevelKeyValueAdapter } from "@isomorphiq/persistence-level";
import type { KeyValueAdapter, KeyValueIterator } from "@isomorphiq/persistence-adapter";
import type { ContextRecord } from "./context-domain.ts";

export type ContextRepository = {
    open: () => Promise<void>;
    close: () => Promise<void>;
    get: (id: string) => Promise<unknown | null>;
    put: (record: ContextRecord) => Promise<void>;
    del: (id: string) => Promise<void>;
    list: () => Promise<unknown[]>;
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

const readAll = async (
    iterator: KeyValueIterator<string, ContextRecord>,
): Promise<unknown[]> => {
    const results: unknown[] = [];
    try {
        for await (const [, value] of iterator) {
            results.push(value);
        }
    } finally {
        await iterator.close();
    }
    return results;
};

const createAdapter = (dbPath: string): KeyValueAdapter<string, ContextRecord> =>
    new LevelKeyValueAdapter<string, ContextRecord>(dbPath);

export const createContextRepository = (dbPath: string): ContextRepository => {
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
                return value;
            } catch (error) {
                if (isNotFoundError(error)) {
                    return null;
                }
                throw error;
            }
        },
        put: async (record: ContextRecord) => {
            await adapter.open();
            await adapter.put(record.id, record);
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
