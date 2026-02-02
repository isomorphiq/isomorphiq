import { z } from "zod";

// Dashboard widget definitions and persistence helpers.

export const WidgetPlacementSchema = z.object({
    id: z.string(),
    widgetType: z.string(),
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    w: z.number().int().positive(),
    h: z.number().int().positive(),
});
export type WidgetPlacement = z.output<typeof WidgetPlacementSchema>;

export const DashboardLayoutSchema = z.object({
    version: z.literal(1),
    placements: z.array(WidgetPlacementSchema),
});
export type DashboardLayout = z.output<typeof DashboardLayoutSchema>;

const STORAGE_KEY = "supervisor.dashboard.layout.v1";

const defaultLayout = (): DashboardLayout => ({
    version: 1,
    placements: [],
});

const safeJsonParse = (raw: string | null): unknown | null => {
    if (!raw) {
        return null;
    }
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
};

const readFromStorage = (): DashboardLayout => {
    const storage = globalThis.localStorage;
    if (!storage) {
        return defaultLayout();
    }
    const parsed = safeJsonParse(storage.getItem(STORAGE_KEY));
    const validated = DashboardLayoutSchema.safeParse(parsed);
    return validated.success ? validated.data : defaultLayout();
};

const writeToStorage = (layout: DashboardLayout): void => {
    const storage = globalThis.localStorage;
    if (!storage) {
        return;
    }
    storage.setItem(STORAGE_KEY, JSON.stringify(layout));
};

export const loadDashboardLayout = (): DashboardLayout => readFromStorage();

const createWidgetId = (): string => {
    const cryptoApi = globalThis.crypto;
    if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
        return cryptoApi.randomUUID();
    }
    return `widget-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const nextPlacement = (
    placements: WidgetPlacement[],
    widgetType: string,
): WidgetPlacement => {
    const maxY = placements.reduce((acc, placement) => {
        const bottom = placement.y + placement.h;
        return bottom > acc ? bottom : acc;
    }, 0);

    return {
        id: createWidgetId(),
        widgetType,
        x: 0,
        y: maxY,
        w: 4,
        h: 3,
    };
};

export const addWidgetToDashboard = (
    layout: DashboardLayout,
    widgetType: string,
): DashboardLayout => {
    const placement = nextPlacement(layout.placements, widgetType);
    const updated: DashboardLayout = {
        version: 1,
        placements: [...layout.placements, placement],
    };
    writeToStorage(updated);
    return updated;
};

export const updateWidgetPlacement = (
    layout: DashboardLayout,
    placement: WidgetPlacement,
): DashboardLayout => {
    const updated: DashboardLayout = {
        version: 1,
        placements: layout.placements.map((item) =>
            item.id === placement.id ? placement : item,
        ),
    };
    writeToStorage(updated);
    return updated;
};

export const removeWidgetFromDashboard = (
    layout: DashboardLayout,
    widgetId: string,
): DashboardLayout => {
    const updated: DashboardLayout = {
        version: 1,
        placements: layout.placements.filter((item) => item.id !== widgetId),
    };
    writeToStorage(updated);
    return updated;
};
