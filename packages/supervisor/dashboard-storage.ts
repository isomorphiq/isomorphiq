import { DashboardStateSchema, createEmptyDashboardState } from "./dashboard.ts";

export type DashboardStorage = {
    getItem: (key: string) => string | null;
    setItem: (key: string, value: string) => void;
};

export const DASHBOARD_STORAGE_KEY = "dashboard.state.v1";

const safeJsonParse = (raw: string): unknown => {
    try {
        return JSON.parse(raw);
    } catch (error) {
        return null;
    }
};

export const loadDashboardState = (
    storage: DashboardStorage,
    key: string = DASHBOARD_STORAGE_KEY,
) => {
    const raw = storage.getItem(key);
    if (!raw) {
        return createEmptyDashboardState();
    }

    const parsed = safeJsonParse(raw);
    const result = DashboardStateSchema.safeParse(parsed);
    if (!result.success) {
        return createEmptyDashboardState();
    }

    return result.data;
};

export const persistDashboardState = (
    storage: DashboardStorage,
    state: unknown,
    key: string = DASHBOARD_STORAGE_KEY,
) => {
    const validated = DashboardStateSchema.safeParse(state);
    if (!validated.success) {
        return;
    }

    storage.setItem(key, JSON.stringify(validated.data));
};
