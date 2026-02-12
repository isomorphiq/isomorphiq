// FILE_CONTEXT: "context-b5560f81-49c0-4709-8a1b-1e63b1429b83"

import { z } from "zod";

const DashboardWidgetLayoutSchema = z.object({
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    w: z.number().int().positive(),
    h: z.number().int().positive()
});

const DashboardWidgetSchema = z.object({
    id: z.string().min(1),
    widgetId: z.string().min(1),
    type: z.string().min(1),
    title: z.string().min(1).optional(),
    layout: DashboardWidgetLayoutSchema
});

export const DashboardStateSchema = z.object({
    widgets: z.array(DashboardWidgetSchema),
    updatedAt: z.string().datetime()
});

export const WidgetDefinitionSchema = z.object({
    widgetId: z.string().min(1),
    type: z.string().min(1),
    title: z.string().min(1).optional(),
    defaultSize: DashboardWidgetLayoutSchema.pick({ w: true, h: true }).default({ w: 4, h: 4 })
});

export type DashboardWidgetLayout = z.output<typeof DashboardWidgetLayoutSchema>;
export type DashboardWidget = z.output<typeof DashboardWidgetSchema>;
export type DashboardState = z.output<typeof DashboardStateSchema>;
export type WidgetDefinition = z.output<typeof WidgetDefinitionSchema>;

export type DashboardStorage = {
    getItem: (key: string) => string | null;
    setItem: (key: string, value: string) => void;
    removeItem: (key: string) => void;
};

export const createEmptyDashboardState = (): DashboardState => ({
    widgets: [],
    updatedAt: new Date().toISOString()
});

const defaultIdFactory = (): string => {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }

    return `widget-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export const getNextWidgetPlacement = (
    widgets: readonly DashboardWidget[],
    size: Pick<DashboardWidgetLayout, "w" | "h">
): DashboardWidgetLayout => {
    const nextRowStart = widgets.reduce((maxY, widget) => {
        const widgetBottom = widget.layout.y + widget.layout.h;
        return Math.max(maxY, widgetBottom);
    }, 0);

    return {
        x: 0,
        y: nextRowStart,
        w: size.w,
        h: size.h
    };
};

export const addWidgetToDashboard = (
    state: DashboardState,
    widgetDefinition: WidgetDefinition,
    idFactory: () => string = defaultIdFactory
): DashboardState => {
    const placement = getNextWidgetPlacement(state.widgets, widgetDefinition.defaultSize);
    const widget: DashboardWidget = {
        id: idFactory(),
        widgetId: widgetDefinition.widgetId,
        type: widgetDefinition.type,
        title: widgetDefinition.title,
        layout: placement
    };

    return {
        widgets: [...state.widgets, widget],
        updatedAt: new Date().toISOString()
    };
};

export const removeWidgetFromDashboard = (
    state: DashboardState,
    widgetInstanceId: string
): DashboardState => {
    const nextWidgets = state.widgets.filter((widget) => widget.id !== widgetInstanceId);
    if (nextWidgets.length === state.widgets.length) {
        return state;
    }

    return {
        ...state,
        widgets: nextWidgets,
        updatedAt: new Date().toISOString()
    };
};

const storageKeyForUser = (userId: string): string => `dashboard:${userId}`;

export const loadDashboardState = (
    storage: DashboardStorage,
    userId: string,
    fallbackState: DashboardState = createEmptyDashboardState()
): DashboardState => {
    const raw = storage.getItem(storageKeyForUser(userId));
    if (raw === null) {
        return fallbackState;
    }

    let decoded: unknown;
    try {
        decoded = JSON.parse(raw);
    } catch {
        return fallbackState;
    }

    const parsed = DashboardStateSchema.safeParse(decoded);
    if (!parsed.success) {
        return fallbackState;
    }

    return parsed.data;
};

export const saveDashboardState = (
    storage: DashboardStorage,
    userId: string,
    state: DashboardState
): DashboardState => {
    const validated = DashboardStateSchema.parse(state);
    storage.setItem(storageKeyForUser(userId), JSON.stringify(validated));
    return validated;
};

export const addWidgetAndPersist = (
    storage: DashboardStorage,
    userId: string,
    widgetDefinition: WidgetDefinition,
    idFactory: () => string = defaultIdFactory
): DashboardState => {
    const currentState = loadDashboardState(storage, userId);
    const updatedState = addWidgetToDashboard(currentState, widgetDefinition, idFactory);
    return saveDashboardState(storage, userId, updatedState);
};

export const removeWidgetAndPersist = (
    storage: DashboardStorage,
    userId: string,
    widgetInstanceId: string
): DashboardState => {
    const currentState = loadDashboardState(storage, userId);
    const updatedState = removeWidgetFromDashboard(currentState, widgetInstanceId);
    return saveDashboardState(storage, userId, updatedState);
};

export const createInMemoryStorage = (): DashboardStorage => {
    const store = new Map<string, string>();
    return {
        getItem: (key) => store.get(key) ?? null,
        setItem: (key, value) => {
            store.set(key, value);
        },
        removeItem: (key) => {
            store.delete(key);
        }
    };
};

export const createBrowserStorage = (): DashboardStorage | null => {
    if (typeof globalThis === "undefined") {
        return null;
    }

    const candidate = Object.prototype.hasOwnProperty.call(globalThis, "localStorage")
        ? Reflect.get(globalThis, "localStorage")
        : undefined;
    if (!candidate || typeof candidate !== "object") {
        return null;
    }

    const getItem = Reflect.get(candidate, "getItem");
    const setItem = Reflect.get(candidate, "setItem");
    const removeItem = Reflect.get(candidate, "removeItem");
    if (typeof getItem !== "function" || typeof setItem !== "function" || typeof removeItem !== "function") {
        return null;
    }

    return {
        getItem: (key) => {
            const value = getItem.call(candidate, key);
            if (value === null) {
                return null;
            }
            return typeof value === "string" ? value : String(value);
        },
        setItem: (key, value) => {
            setItem.call(candidate, key, value);
        },
        removeItem: (key) => {
            removeItem.call(candidate, key);
        }
    };
};
