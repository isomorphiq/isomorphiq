import { randomUUID } from "node:crypto";
import {
    ContextRecordSchema,
    type ContextData,
    type ContextRecord,
    type CreateContextInput,
    type FileContextLookupInput,
} from "./context-domain.ts";
import { createContextRepository, type ContextRepository } from "./context-repository.ts";

export type ContextService = {
    open: () => Promise<void>;
    close: () => Promise<void>;
    createContext: (input?: CreateContextInput) => Promise<ContextRecord>;
    getOrCreateFileContext: (input: FileContextLookupInput) => Promise<ContextRecord>;
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

const normalizeOptionalString = (value: unknown): string | undefined => {
    if (typeof value !== "string") {
        return undefined;
    }
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : undefined;
};

const normalizeStringList = (value: unknown): string[] => {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
};

const uniqueStrings = (values: string[]): string[] =>
    values.reduce<string[]>(
        (acc, value) => (acc.includes(value) ? acc : [...acc, value]),
        [],
    );

const clampRecent = <T>(values: T[], maxItems: number): T[] => {
    if (values.length <= maxItems) {
        return values;
    }
    return values.slice(values.length - maxItems);
};

const normalizeFilePath = (value: string): string => value.trim();

const readLookupCount = (value: unknown): number =>
    typeof value === "number" && Number.isFinite(value) && value >= 0
        ? Math.floor(value)
        : 0;

const readFileObservations = (value: unknown): Array<Record<string, unknown>> => {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .filter((entry): entry is Record<string, unknown> => isRecord(entry))
        .map((entry) => ({ ...entry }));
};

const buildLookupEvent = (
    input: FileContextLookupInput,
    timestamp: string,
): Record<string, unknown> => {
    const relatedFiles = uniqueStrings([
        ...normalizeStringList(input.relatedFiles),
    ]);
    const todos = uniqueStrings([...normalizeStringList(input.todos)]);
    return {
        at: timestamp,
        ...(input.operation ? { operation: input.operation } : {}),
        ...(input.taskId ? { taskId: input.taskId } : {}),
        ...(input.taskTitle ? { taskTitle: input.taskTitle } : {}),
        ...(input.reason ? { reason: input.reason } : {}),
        ...(relatedFiles.length > 0 ? { relatedFiles } : {}),
        ...(todos.length > 0 ? { todos } : {}),
    };
};

const mergeFileContextData = (
    data: ContextData,
    id: string,
    input: FileContextLookupInput,
    now: Date,
): ContextData => {
    const nowIso = now.toISOString();
    const filePath = normalizeFilePath(input.filePath);
    const fileContext = isRecord(data.fileContext) ? data.fileContext : {};
    const existingPaths = normalizeStringList(fileContext.paths);
    const existingRelated = normalizeStringList(fileContext.relatedFiles);
    const existingTodos = normalizeStringList(fileContext.todos);
    const existingObservations = readFileObservations(fileContext.observations);
    const observation = buildLookupEvent(input, nowIso);

    const nextPaths = uniqueStrings([filePath, ...existingPaths]);
    const nextRelated = uniqueStrings([
        ...existingRelated,
        ...normalizeStringList(input.relatedFiles),
    ]);
    const nextTodos = uniqueStrings([
        ...existingTodos,
        ...normalizeStringList(input.todos),
    ]);
    const nextObservations = clampRecent(
        [...existingObservations, observation],
        100,
    );
    const firstSeenAt = normalizeOptionalString(fileContext.firstSeenAt) ?? nowIso;
    const previousLookupCount = readLookupCount(fileContext.lookupCount);
    const lookupCount = previousLookupCount + 1;

    const nextFileContext: ContextData = {
        schemaVersion: 1,
        kind: "file",
        id,
        primaryPath: filePath,
        paths: nextPaths,
        relatedFiles: nextRelated,
        todos: nextTodos,
        firstSeenAt,
        lastLookupAt: nowIso,
        lookupCount,
        observations: nextObservations,
    };

    return {
        ...data,
        fileContext: nextFileContext,
    };
};

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

const recordMatchesFilePath = (record: ContextRecord, filePath: string): boolean => {
    const fileContext = isRecord(record.data.fileContext) ? record.data.fileContext : {};
    const primaryPath = normalizeOptionalString(fileContext.primaryPath);
    if (primaryPath === filePath) {
        return true;
    }
    const paths = normalizeStringList(fileContext.paths);
    return paths.includes(filePath);
};

const findFileContextByPath = async (
    repository: ContextRepository,
    filePath: string,
): Promise<ContextRecord | null> => {
    const records = await repository.list();
    const parsed = records.reduce<ContextRecord[]>((acc, record) => {
        try {
            return [...acc, parseRecord(record)];
        } catch (error) {
            console.warn("[CONTEXT] Skipping invalid context record during file lookup:", error);
            return acc;
        }
    }, []);
    const matching = parsed
        .filter((record) => recordMatchesFilePath(record, filePath))
        .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
    return matching[0] ?? null;
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

    const getOrCreateFileContext = async (
        input: FileContextLookupInput,
    ): Promise<ContextRecord> => {
        const normalizedFilePath = normalizeFilePath(input.filePath);
        if (normalizedFilePath.length === 0) {
            throw new Error("filePath is required");
        }
        const normalizedInput: FileContextLookupInput = {
            ...input,
            filePath: normalizedFilePath,
        };
        const existingByPath =
            input.contextId ? null : await findFileContextByPath(repository, normalizedFilePath);
        const contextId = input.contextId ?? existingByPath?.id ?? createContextId();
        const existing = existingByPath ?? (await readRecord(repository, contextId));
        const now = new Date();
        if (!existing) {
            const data = mergeFileContextData({}, contextId, normalizedInput, now);
            const created: ContextRecord = {
                id: contextId,
                data,
                createdAt: now,
                updatedAt: now,
            };
            await repository.put(created);
            return created;
        }

        const updatedData = mergeFileContextData(
            existing.data,
            contextId,
            normalizedInput,
            now,
        );
        const updated: ContextRecord = {
            ...existing,
            data: updatedData,
            updatedAt: now,
        };
        await repository.put(updated);
        return updated;
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
        getOrCreateFileContext,
        getContext,
        updateContext,
        replaceContext,
        deleteContext,
        listContexts,
    };
};
