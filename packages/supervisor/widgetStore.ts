export type WidgetId = string;

export type WidgetSize = {
    w: number;
    h: number;
};

export type WidgetPlacement = {
    id: string;
    widgetId: WidgetId;
    x: number;
    y: number;
    w: number;
    h: number;
};

export type DashboardLayout = {
    version: 1;
    widgets: ReadonlyArray<WidgetPlacement>;
};

export type AddWidgetOptions = {
    placement?: {
        x: number;
        y: number;
    };
    size?: WidgetSize;
    columns?: number;
};

const STORAGE_KEY = "dashboard.layout.v1";
const DEFAULT_COLUMNS = 12;
const DEFAULT_WIDGET_SIZE: WidgetSize = { w: 4, h: 4 };

type StorageLike = {
    getItem: (key: string) => string | null;
    setItem: (key: string, value: string) => void;
};

const isFiniteNumber = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value);

const getObjectValue = (value: unknown, key: string): unknown => {
    if (typeof value !== "object" || value === null) {
        return undefined;
    }

    const entry = Object.entries(value).find(([entryKey]) => entryKey === key);
    return entry ? entry[1] : undefined;
};

const isWidgetPlacement = (value: unknown): value is WidgetPlacement => {
    if (typeof value !== "object" || value === null) {
        return false;
    }

    return (
        typeof getObjectValue(value, "id") === "string" &&
        typeof getObjectValue(value, "widgetId") === "string" &&
        isFiniteNumber(getObjectValue(value, "x")) &&
        isFiniteNumber(getObjectValue(value, "y")) &&
        isFiniteNumber(getObjectValue(value, "w")) &&
        isFiniteNumber(getObjectValue(value, "h"))
    );
};

const normalizeLayout = (value: unknown): DashboardLayout => {
    if (typeof value !== "object" || value === null) {
        return createEmptyLayout();
    }

    const widgetsValue = getObjectValue(value, "widgets");
    const widgets = Array.isArray(widgetsValue)
        ? widgetsValue.filter(isWidgetPlacement)
        : [];

    return {
        version: 1,
        widgets,
    };
};

const createEmptyLayout = (): DashboardLayout => ({
    version: 1,
    widgets: [],
});

const isStorageLike = (value: unknown): value is StorageLike => {
    const getItemValue = getObjectValue(value, "getItem");
    const setItemValue = getObjectValue(value, "setItem");
    return typeof getItemValue === "function" && typeof setItemValue === "function";
};

const getStorage = (): StorageLike | null => {
    const candidate = getObjectValue(globalThis, "localStorage");
    return isStorageLike(candidate) ? candidate : null;
};

const parseLayout = (raw: string | null): DashboardLayout => {
    if (!raw) {
        return createEmptyLayout();
    }

    try {
        const parsed = JSON.parse(raw) as unknown;
        return normalizeLayout(parsed);
    } catch {
        return createEmptyLayout();
    }
};

const findNextPlacement = (
    layout: DashboardLayout,
    size: WidgetSize,
    columns: number,
): { x: number; y: number } => {
    if (layout.widgets.length === 0) {
        return { x: 0, y: 0 };
    }

    const maxY = layout.widgets.reduce(
        (currentMax, widget) => Math.max(currentMax, widget.y + widget.h),
        0,
    );

    return { x: 0, y: maxY };
};

const generateWidgetInstanceId = (): string => {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }

    return `widget_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
};

const normalizeSize = (size: WidgetSize, columns: number): WidgetSize => ({
    w: Math.max(1, Math.min(size.w, columns)),
    h: Math.max(1, size.h),
});

const createPlacement = (
    widgetId: WidgetId,
    layout: DashboardLayout,
    options?: AddWidgetOptions,
): WidgetPlacement => {
    const columns = options?.columns ?? DEFAULT_COLUMNS;
    const size = normalizeSize(options?.size ?? DEFAULT_WIDGET_SIZE, columns);
    const position = options?.placement ?? findNextPlacement(layout, size, columns);

    return {
        id: generateWidgetInstanceId(),
        widgetId,
        x: position.x,
        y: position.y,
        w: size.w,
        h: size.h,
    };
};

export const loadLayout = (storage: StorageLike | null = getStorage()): DashboardLayout =>
    parseLayout(storage?.getItem(STORAGE_KEY) ?? null);

export const saveLayout = (
    layout: DashboardLayout,
    storage: StorageLike | null = getStorage(),
): void => {
    if (!storage) {
        return;
    }

    storage.setItem(STORAGE_KEY, JSON.stringify(layout));
};

export const addWidgetToLayout = (
    layout: DashboardLayout,
    widgetId: WidgetId,
    options?: AddWidgetOptions,
): DashboardLayout => {
    const placement = createPlacement(widgetId, layout, options);
    return {
        ...layout,
        widgets: [...layout.widgets, placement],
    };
};

export const addWidgetAndPersist = (
    widgetId: WidgetId,
    options?: AddWidgetOptions,
    storage: StorageLike | null = getStorage(),
): DashboardLayout => {
    const currentLayout = loadLayout(storage);
    const nextLayout = addWidgetToLayout(currentLayout, widgetId, options);
    saveLayout(nextLayout, storage);
    return nextLayout;
};
