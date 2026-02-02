// Dashboard widget placement and persistence utilities.
// Functional, immutable transformations with a pluggable storage adapter.

export type DashboardWidgetId = string;

export type WidgetPlacement = {
    x: number;
    y: number;
    w: number;
    h: number;
};

export type DashboardWidget = {
    id: DashboardWidgetId;
    placement: WidgetPlacement;
};

export type DashboardState = {
    widgets: ReadonlyArray<DashboardWidget>;
};

export type WidgetLibraryItem = {
    id: DashboardWidgetId;
    defaultPlacement: WidgetPlacement;
};

export type DashboardStorage = {
    load: () => Promise<DashboardState | null>;
    save: (state: DashboardState) => Promise<void>;
};

export type JsonStorageLike = {
    getItem: (key: string) => string | null;
    setItem: (key: string, value: string) => void;
};

export const createDashboardState = (widgets: ReadonlyArray<DashboardWidget>): DashboardState => ({
    widgets,
});

const isWidgetPlacement = (value: unknown): value is WidgetPlacement => {
    if (!value || typeof value !== "object") {
        return false;
    }

    const x = Reflect.get(value, "x");
    const y = Reflect.get(value, "y");
    const w = Reflect.get(value, "w");
    const h = Reflect.get(value, "h");

    return (
        typeof x === "number" &&
        typeof y === "number" &&
        typeof w === "number" &&
        typeof h === "number"
    );
};

const isDashboardWidget = (value: unknown): value is DashboardWidget => {
    if (!value || typeof value !== "object") {
        return false;
    }

    const id = Reflect.get(value, "id");
    const placement = Reflect.get(value, "placement");
    return typeof id === "string" && isWidgetPlacement(placement);
};

const isDashboardState = (value: unknown): value is DashboardState => {
    if (!value || typeof value !== "object") {
        return false;
    }

    const widgets = Reflect.get(value, "widgets");
    return Array.isArray(widgets) && widgets.every(isDashboardWidget);
};

export const addWidgetToDashboard = (
    state: DashboardState,
    widget: WidgetLibraryItem,
    placementOverride?: WidgetPlacement,
): DashboardState => {
    const nextWidget: DashboardWidget = {
        id: widget.id,
        placement: placementOverride ?? widget.defaultPlacement,
    };

    const filtered = state.widgets.filter((item) => item.id !== widget.id);
    return createDashboardState([...filtered, nextWidget]);
};

export const updateWidgetPlacement = (
    state: DashboardState,
    widgetId: DashboardWidgetId,
    placement: WidgetPlacement,
): DashboardState =>
    createDashboardState(
        state.widgets.map((item) =>
            item.id === widgetId
                ? {
                      ...item,
                      placement,
                  }
                : item,
        ),
    );

export const removeWidgetFromDashboard = (
    state: DashboardState,
    widgetId: DashboardWidgetId,
): DashboardState =>
    createDashboardState(state.widgets.filter((item) => item.id !== widgetId));

export const persistDashboardState = async (
    storage: DashboardStorage,
    state: DashboardState,
): Promise<void> => {
    await storage.save(state);
};

export const loadDashboardState = async (storage: DashboardStorage): Promise<DashboardState> => {
    const stored = await storage.load();
    return stored ?? createDashboardState([]);
};

export const createMemoryDashboardStorage = (initial?: DashboardState): DashboardStorage => {
    let current = initial ?? createDashboardState([]);

    return {
        load: async () => current,
        save: async (state: DashboardState) => {
            current = state;
        },
    };
};

export const createJsonDashboardStorage = (
    storage: JsonStorageLike,
    key: string,
): DashboardStorage => ({
    load: async () => {
        const raw = storage.getItem(key);
        if (raw === null) {
            return null;
        }

        try {
            const parsed: unknown = JSON.parse(raw);
            if (!isDashboardState(parsed)) {
                return null;
            }

            return parsed;
        } catch {
            return null;
        }
    },
    save: async (state: DashboardState) => {
        storage.setItem(key, JSON.stringify(state));
    },
});
