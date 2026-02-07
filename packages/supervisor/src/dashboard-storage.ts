// FILE_CONTEXT: "context-47dcd0c3-6b10-4c92-86f5-8bf972ac8421"

import { promises as fs } from "fs";
import path from "path";
import { LevelKeyValueAdapter } from "@isomorphiq/persistence-level";
import { DashboardStateSchema, type DashboardState } from "./dashboard-model.ts";

export type DashboardStorage = {
    load: () => Promise<DashboardState | null>;
    save: (state: DashboardState) => Promise<void>;
};

export type DashboardStatePayload = {
    version: number;
    state: DashboardState;
    updatedAt: string;
};

export type DashboardStateQueue = {
    load: () => Promise<DashboardState | null>;
    save: (state: DashboardState) => Promise<void>;
    clear: () => Promise<void>;
};

export type DashboardSyncedStorage = DashboardStorage & {
    flush: () => Promise<void>;
};

type StorageLike = {
    getItem: (key: string) => string | null;
    setItem: (key: string, value: string) => void;
    removeItem?: (key: string) => void;
};

type FetchLike = typeof fetch;

const DASHBOARD_STATE_PAYLOAD_VERSION = 1;
const DASHBOARD_STATE_STORAGE_KEY = "dashboard.state.v1";
const DASHBOARD_STATE_PENDING_KEY = "dashboard.state.pending.v1";

const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value);

const hasCode = (value: unknown): value is { code: unknown } =>
    isRecord(value) && "code" in value;

const isFileNotFound = (error: unknown): boolean => hasCode(error) && error.code === "ENOENT";
const isLevelNotFound = (error: unknown): boolean =>
    hasCode(error) && (error.code === "LEVEL_NOT_FOUND" || error.code === "NotFound");

const parseDashboardStatePayload = (value: unknown): DashboardState | null => {
    if (isRecord(value) && "state" in value) {
        const parsed = DashboardStateSchema.safeParse(value.state);
        return parsed.success ? parsed.data : null;
    }
    const parsed = DashboardStateSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
};

const buildDashboardStatePayload = (state: DashboardState): DashboardStatePayload => ({
    version: DASHBOARD_STATE_PAYLOAD_VERSION,
    state,
    updatedAt: state.updatedAt
});

const normalizeDashboardUpdatedAt = (value?: string): number => {
    if (!value) {
        return 0;
    }
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
};

const resolveStorage = (storage?: StorageLike | null): StorageLike | null => {
    if (storage) {
        return storage;
    }
    if (typeof globalThis === "undefined") {
        return null;
    }
    const candidate = Reflect.get(globalThis, "localStorage");
    if (!candidate || typeof candidate !== "object") {
        return null;
    }
    const getItem = Reflect.get(candidate, "getItem");
    const setItem = Reflect.get(candidate, "setItem");
    if (typeof getItem !== "function" || typeof setItem !== "function") {
        return null;
    }
    const removeItem = Reflect.get(candidate, "removeItem");
    return {
        getItem: (key: string) => {
            const value = getItem.call(candidate, key);
            if (value === null) {
                return null;
            }
            return typeof value === "string" ? value : String(value);
        },
        setItem: (key: string, value: string) => {
            setItem.call(candidate, key, value);
        },
        removeItem: typeof removeItem === "function"
            ? (key: string) => {
                  removeItem.call(candidate, key);
              }
            : undefined
    };
};

const resolveLatestDashboardState = (
    localState: DashboardState | null,
    remoteState: DashboardState | null
): { state: DashboardState | null; source: "local" | "remote" | "none" } => {
    if (localState && remoteState) {
        const localUpdatedAt = normalizeDashboardUpdatedAt(localState.updatedAt);
        const remoteUpdatedAt = normalizeDashboardUpdatedAt(remoteState.updatedAt);
        if (remoteUpdatedAt > localUpdatedAt) {
            return { state: remoteState, source: "remote" };
        }
        return { state: localState, source: "local" };
    }
    if (localState) {
        return { state: localState, source: "local" };
    }
    if (remoteState) {
        return { state: remoteState, source: "remote" };
    }
    return { state: null, source: "none" };
};

export const createJsonFileDashboardStorage = (filePath: string): DashboardStorage => {
    const load = async (): Promise<DashboardState | null> => {
        try {
            const raw = await fs.readFile(filePath, "utf-8");
            const parsed = JSON.parse(raw);
            return DashboardStateSchema.parse(parsed);
        } catch (error) {
            if (isFileNotFound(error)) {
                return null;
            }

            throw error;
        }
    };

    const save = async (state: DashboardState): Promise<void> => {
        const directory = path.dirname(filePath);
        await fs.mkdir(directory, { recursive: true });
        const payload = JSON.stringify(state, null, 4);
        const tempPath = `${filePath}.tmp`;
        await fs.writeFile(tempPath, payload, "utf-8");
        await fs.rename(tempPath, filePath);
    };

    return { load, save };
};

export const createLocalStorageDashboardStorage = (params?: {
    storage?: StorageLike | null;
    key?: string;
}): DashboardStorage => {
    const storage = resolveStorage(params?.storage ?? null);
    const key = params?.key ?? DASHBOARD_STATE_STORAGE_KEY;

    const load = async (): Promise<DashboardState | null> => {
        if (!storage) {
            return null;
        }
        const raw = storage.getItem(key);
        if (!raw) {
            return null;
        }
        try {
            const parsed = JSON.parse(raw);
            return parseDashboardStatePayload(parsed);
        } catch {
            return null;
        }
    };

    const save = async (state: DashboardState): Promise<void> => {
        if (!storage) {
            return;
        }
        const validated = DashboardStateSchema.parse(state);
        const payload = buildDashboardStatePayload(validated);
        storage.setItem(key, JSON.stringify(payload));
    };

    return { load, save };
};

export const createLocalStorageDashboardStateQueue = (params?: {
    storage?: StorageLike | null;
    key?: string;
}): DashboardStateQueue => {
    const storage = resolveStorage(params?.storage ?? null);
    const key = params?.key ?? DASHBOARD_STATE_PENDING_KEY;

    const load = async (): Promise<DashboardState | null> => {
        if (!storage) {
            return null;
        }
        const raw = storage.getItem(key);
        if (!raw) {
            return null;
        }
        try {
            const parsed = JSON.parse(raw);
            return parseDashboardStatePayload(parsed);
        } catch {
            return null;
        }
    };

    const save = async (state: DashboardState): Promise<void> => {
        if (!storage) {
            return;
        }
        const validated = DashboardStateSchema.parse(state);
        const payload = buildDashboardStatePayload(validated);
        storage.setItem(key, JSON.stringify(payload));
    };

    const clear = async (): Promise<void> => {
        if (!storage) {
            return;
        }
        if (typeof storage.removeItem === "function") {
            storage.removeItem(key);
            return;
        }
        storage.setItem(key, "");
    };

    return { load, save, clear };
};

export const createHttpDashboardStorage = (params: {
    endpoint: string;
    fetcher?: FetchLike;
    headers?: Record<string, string>;
    method?: "PUT" | "POST";
}): DashboardStorage => {
    const fetcher = params.fetcher ?? (typeof fetch !== "undefined" ? fetch : undefined);
    const endpoint = params.endpoint;
    const headers = params.headers ?? {};
    const method = params.method ?? "PUT";

    const load = async (): Promise<DashboardState | null> => {
        if (!fetcher) {
            return null;
        }
        try {
            const response = await fetcher(endpoint, {
                method: "GET",
                headers
            });
            if (!response.ok) {
                return null;
            }
            const payload = await response.json();
            return parseDashboardStatePayload(payload);
        } catch {
            return null;
        }
    };

    const save = async (state: DashboardState): Promise<void> => {
        if (!fetcher) {
            throw new Error("Fetch is unavailable for remote dashboard storage.");
        }
        const validated = DashboardStateSchema.parse(state);
        const payload = buildDashboardStatePayload(validated);
        const response = await fetcher(endpoint, {
            method,
            headers: {
                "Content-Type": "application/json",
                ...headers
            },
            body: JSON.stringify(payload)
        });
        if (!response.ok) {
            throw new Error(`Dashboard storage update failed with status ${response.status}.`);
        }
    };

    return { load, save };
};

export const createSyncedDashboardStorage = (params: {
    local: DashboardStorage;
    remote: DashboardStorage;
    queue?: DashboardStateQueue;
    isOnline?: () => boolean;
}): DashboardSyncedStorage => {
    const queue = params.queue ?? createLocalStorageDashboardStateQueue();
    const isOnline =
        params.isOnline ??
        (() => {
            if (typeof navigator !== "undefined" && typeof navigator.onLine === "boolean") {
                return navigator.onLine;
            }
            return true;
        });

    const load = async (): Promise<DashboardState | null> => {
        const [localState, remoteState] = await Promise.all([
            params.local.load().catch(() => null),
            params.remote.load().catch(() => null)
        ]);
        const resolved = resolveLatestDashboardState(localState, remoteState);
        if (resolved.source === "remote" && resolved.state) {
            await params.local.save(resolved.state);
            return resolved.state;
        }
        if (resolved.source === "local" && resolved.state && isOnline()) {
            try {
                await params.remote.save(resolved.state);
            } catch {
                await queue.save(resolved.state);
            }
        }
        return resolved.state;
    };

    const save = async (state: DashboardState): Promise<void> => {
        const validated = DashboardStateSchema.parse(state);
        await params.local.save(validated);
        if (isOnline()) {
            try {
                await params.remote.save(validated);
                return;
            } catch {
                await queue.save(validated);
                return;
            }
        }
        await queue.save(validated);
    };

    const flush = async (): Promise<void> => {
        if (!isOnline()) {
            return;
        }
        const pending = await queue.load();
        if (!pending) {
            return;
        }
        try {
            await params.remote.save(pending);
            await queue.clear();
        } catch {
            return;
        }
    };

    return { load, save, flush };
};

export const attachDashboardStorageAutoFlush = (
    storage: DashboardSyncedStorage
): (() => void) | null => {
    if (typeof globalThis === "undefined") {
        return null;
    }
    const addEventListener = Reflect.get(globalThis, "addEventListener");
    const removeEventListener = Reflect.get(globalThis, "removeEventListener");
    if (typeof addEventListener !== "function" || typeof removeEventListener !== "function") {
        return null;
    }
    const handler = () => {
        void storage.flush();
    };
    addEventListener.call(globalThis, "online", handler);
    return () => {
        removeEventListener.call(globalThis, "online", handler);
    };
};

export const createInMemoryDashboardStorage = (
    initialState: DashboardState | null = null
): DashboardStorage => {
    let state = initialState;

    const load = async (): Promise<DashboardState | null> => state;
    const save = async (nextState: DashboardState): Promise<void> => {
        state = nextState;
    };

    return { load, save };
};

export const createLevelDbDashboardStorage = (params: {
    dbPath: string;
    key?: string;
}): DashboardStorage => {
    const adapter = new LevelKeyValueAdapter<string, DashboardState>(params.dbPath);
    const key = params.key ?? "dashboard-state";

    const load = async (): Promise<DashboardState | null> => {
        await adapter.open();
        try {
            const stored = await adapter.get(key);
            return DashboardStateSchema.parse(stored);
        } catch (error) {
            if (isLevelNotFound(error)) {
                return null;
            }
            throw error;
        }
    };

    const save = async (state: DashboardState): Promise<void> => {
        await adapter.open();
        const validated = DashboardStateSchema.parse(state);
        await adapter.put(key, validated);
    };

    return { load, save };
};
