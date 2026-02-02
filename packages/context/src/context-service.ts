import { randomUUID } from "node:crypto";
import {
    ContextRecordSchema,
    type ContextData,
    type ContextRecord,
    type CreateContextInput,
} from "./context-domain.ts";
import { createContextRepository, type ContextRepository } from "./context-repository.ts";

export type ContextService = {
    open: () => Promise<void>;
    close: () => Promise<void>;
    createContext: (input?: CreateContextInput) => Promise<ContextRecord>;
    getContext: (id: string) => Promise<ContextRecord | null>;
    updateContext: (id: string, patch: ContextData) => Promise<ContextRecord>;
    replaceContext: (id: string, data: ContextData) => Promise<ContextRecord>;
    deleteContext: (id: string) => Promise<void>;
    listContexts: () => Promise<ContextRecord[]>;
};

export type ContextServiceOptions = {
    contextPath: string;
    repository?: ContextRepository;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value);

const createContextId = (): string => `context-${randomUUID()}`;

const normalizeData = (data: ContextData | undefined): ContextData => data ?? {};

const parseRecord = (value: unknown): ContextRecord =>
    ContextRecordSchema.parse(value) as ContextRecord;

const readRecord = async (
    repository: ContextRepository,
    id: string,
): Promise<ContextRecord | null> => {
    const value = await repository.get(id);
    if (value === undefined) {
        console.warn(`[CONTEXT] Unexpected undefined record for id=${id}; treating as missing`);
        try {
            await repository.del(id);
        } catch (error) {
            console.warn(`[CONTEXT] Failed to delete corrupt record id=${id}:`, error);
        }
        return null;
    }
    if (value === null) {
        return null;
    }
    try {
        return parseRecord(value);
    } catch (error) {
        const message =
            error instanceof Error ? error.message : "Unknown validation error";
        throw new Error(`Invalid context record for id=${id}: ${message}`);
    }
};

const mergeContextData = (base: ContextData, patch: ContextData): ContextData => {
    const keys = new Set([...Object.keys(base), ...Object.keys(patch)]);
    return Array.from(keys).reduce((acc, key) => {
        const baseValue = base[key];
        const patchValue = patch[key];
        if (isRecord(baseValue) && isRecord(patchValue)) {
            return {
                ...acc,
                [key]: mergeContextData(baseValue, patchValue),
            };
        }
        if (typeof patchValue === "undefined") {
            return {
                ...acc,
                [key]: baseValue,
            };
        }
        return {
            ...acc,
            [key]: patchValue,
        };
    }, {} as ContextData);
};

export const createContextService = (options: ContextServiceOptions): ContextService => {
    const repository = options.repository ?? createContextRepository(options.contextPath);

    const open = async (): Promise<void> => {
        await repository.open();
    };

    const close = async (): Promise<void> => {
        await repository.close();
    };

    const createContext = async (input: CreateContextInput = {}): Promise<ContextRecord> => {
        const id = input.id ?? createContextId();
        const existing = await readRecord(repository, id);
        if (existing) {
            throw new Error(`Context ${id} already exists`);
        }
        const now = new Date();
        const record: ContextRecord = {
            id,
            data: normalizeData(input.data),
            createdAt: now,
            updatedAt: now,
        };
        await repository.put(record);
        return record;
    };

    const getContext = async (id: string): Promise<ContextRecord | null> => {
        return await readRecord(repository, id);
    };

    const updateContext = async (id: string, patch: ContextData): Promise<ContextRecord> => {
        const existing = await readRecord(repository, id);
        if (!existing) {
            throw new Error(`Context ${id} not found`);
        }
        const merged = mergeContextData(existing.data, patch);
        const updated: ContextRecord = {
            ...existing,
            data: merged,
            updatedAt: new Date(),
        };
        await repository.put(updated);
        return updated;
    };

    const replaceContext = async (id: string, data: ContextData): Promise<ContextRecord> => {
        const existing = await readRecord(repository, id);
        if (!existing) {
            throw new Error(`Context ${id} not found`);
        }
        const updated: ContextRecord = {
            ...existing,
            data,
            updatedAt: new Date(),
        };
        await repository.put(updated);
        return updated;
    };

    const deleteContext = async (id: string): Promise<void> => {
        await repository.del(id);
    };

    const listContexts = async (): Promise<ContextRecord[]> => {
        const records = await repository.list();
        const parsed = records.map((record) => parseRecord(record));
        return [...parsed].sort(
            (left, right) => right.updatedAt.getTime() - left.updatedAt.getTime(),
        );
    };

    return {
        open,
        close,
        createContext,
        getContext,
        updateContext,
        replaceContext,
        deleteContext,
        listContexts,
    };
};
