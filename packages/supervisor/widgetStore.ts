// FILE_CONTEXT: "context-0926a30d-e9d5-4f93-bcc4-00f9ab888d6d"

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
    version: 2;
    widgets: ReadonlyArray<WidgetPlacement>;
    order: ReadonlyArray<string>;
    createdAt: number;
    updatedAt: number;
};

export type AddWidgetOptions = {
    placement?: {
        x: number;
        y: number;
    };
    size?: WidgetSize;
    columns?: number;
};

const DASHBOARD_LAYOUT_SCHEMA_VERSION = 2;
const STORAGE_KEY = "dashboard.layout.v1";
const DEFAULT_COLUMNS = 12;
const DEFAULT_WIDGET_SIZE: WidgetSize = { w: 4, h: 4 };

type StorageLike = {
    getItem: (key: string) => string | null;
    setItem: (key: string, value: string) => void;
};

const isNonEmptyString = (value: unknown): value is string =>
    typeof value === "string" && value.length > 0;

const isNonNegativeNumber = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value) && value >= 0;

const isNonNegativeInteger = (value: unknown): value is number =>
    isNonNegativeNumber(value) && Number.isInteger(value);

const isPositiveNumber = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value) && value > 0;

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
        isNonEmptyString(getObjectValue(value, "id")) &&
        isNonEmptyString(getObjectValue(value, "widgetId")) &&
        isNonNegativeNumber(getObjectValue(value, "x")) &&
        isNonNegativeNumber(getObjectValue(value, "y")) &&
        isPositiveNumber(getObjectValue(value, "w")) &&
        isPositiveNumber(getObjectValue(value, "h"))
    );
};

const LAYOUT_ERROR_CODES = {
    invalidPayload: "dashboard_layout_invalid_payload",
    invalidWidget: "dashboard_layout_invalid_widget",
    invalidVersion: "dashboard_layout_invalid_version",
    invalidOrder: "dashboard_layout_invalid_order",
    invalidMetadata: "dashboard_layout_invalid_metadata",
    versionMismatch: "dashboard_layout_version_mismatch",
};

const nowTimestamp = (): number => Date.now();

const normalizeTimestamp = (value: unknown, fallback: number): number => {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
        return Math.floor(value);
    }
    return fallback;
};

const buildOrderSequence = (
    widgets: ReadonlyArray<WidgetPlacement>,
    order?: ReadonlyArray<string>
): string[] => {
    const widgetIds = widgets.map((widget) => widget.id);
    const widgetIdSet = new Set(widgetIds);
    const seeded = (order ?? []).reduce(
        (state, id) => {
            if (!widgetIdSet.has(id) || state.seen.has(id)) {
                return state;
            }
            const nextSeen = new Set(state.seen);
            nextSeen.add(id);
            return { list: state.list.concat(id), seen: nextSeen };
        },
        { list: [] as string[], seen: new Set<string>() }
    );

    return widgetIds.reduce(
        (state, id) => {
            if (state.seen.has(id)) {
                return state;
            }
            const nextSeen = new Set(state.seen);
            nextSeen.add(id);
            return { list: state.list.concat(id), seen: nextSeen };
        },
        seeded
    ).list;
};

const buildLayoutRecord = (input: {
    widgets: ReadonlyArray<WidgetPlacement>;
    order?: ReadonlyArray<string>;
    createdAt?: number;
    updatedAt?: number;
}): DashboardLayout => {
    const createdAt = normalizeTimestamp(input.createdAt, nowTimestamp());
    const updatedAt = normalizeTimestamp(input.updatedAt, createdAt);
    const order = buildOrderSequence(input.widgets, input.order);
    const widgetsById = input.widgets.reduce(
        (acc, widget) => {
            const next = new Map(acc);
            next.set(widget.id, widget);
            return next;
        },
        new Map<string, WidgetPlacement>()
    );
    const orderedWidgets = order.reduce<WidgetPlacement[]>((acc, id) => {
        const widget = widgetsById.get(id);
        return widget ? acc.concat(widget) : acc;
    }, []);

    return {
        version: DASHBOARD_LAYOUT_SCHEMA_VERSION,
        widgets: orderedWidgets,
        order,
        createdAt,
        updatedAt,
    };
};

const isOrderSequenceValid = (
    order: ReadonlyArray<string>,
    widgets: ReadonlyArray<WidgetPlacement>
): boolean => {
    const widgetIds = widgets.map((widget) => widget.id);
    const widgetIdSet = new Set(widgetIds);
    const orderSet = new Set(order);

    if (orderSet.size !== order.length) {
        return false;
    }

    if (widgetIdSet.size !== widgetIds.length) {
        return false;
    }

    if (order.length !== widgetIds.length) {
        return false;
    }

    return order.every((id) => widgetIdSet.has(id));
};

const validateLayout = (
    value: unknown
):
    | { ok: true; layout: DashboardLayout; migrated: boolean }
    | { ok: false; errorCode: string; version?: number } => {
    if (typeof value !== "object" || value === null) {
        return { ok: false, errorCode: LAYOUT_ERROR_CODES.invalidPayload };
    }

    const widgetsValue = getObjectValue(value, "widgets");
    const widgets = Array.isArray(widgetsValue)
        ? widgetsValue.filter(isWidgetPlacement)
        : [];
    if (!Array.isArray(widgetsValue) || widgets.length !== widgetsValue.length) {
        return { ok: false, errorCode: LAYOUT_ERROR_CODES.invalidWidget };
    }

    const versionValue = getObjectValue(value, "version");
    if (versionValue !== undefined) {
        if (!isPositiveNumber(versionValue) || !Number.isInteger(versionValue)) {
            return { ok: false, errorCode: LAYOUT_ERROR_CODES.invalidVersion };
        }
        if (
            versionValue !== DASHBOARD_LAYOUT_SCHEMA_VERSION
            && versionValue !== 1
        ) {
            return { ok: false, errorCode: LAYOUT_ERROR_CODES.versionMismatch, version: versionValue };
        }
    }

    const orderValue = getObjectValue(value, "order");
    const order = Array.isArray(orderValue)
        ? orderValue.filter(isNonEmptyString)
        : null;
    const orderList = order ?? [];
    const hasOrder = Array.isArray(orderValue) && order !== null && order.length === orderValue.length;
    const createdAtValue = getObjectValue(value, "createdAt");
    const updatedAtValue = getObjectValue(value, "updatedAt");
    const hasMetadata = isNonNegativeInteger(createdAtValue) && isNonNegativeInteger(updatedAtValue);
    const hasValidOrder = hasOrder ? isOrderSequenceValid(orderList, widgets) : false;

    const requiresMigration =
        versionValue !== DASHBOARD_LAYOUT_SCHEMA_VERSION || !hasMetadata || !hasValidOrder;

    if (versionValue === DASHBOARD_LAYOUT_SCHEMA_VERSION) {
        if (!hasOrder) {
            return { ok: false, errorCode: LAYOUT_ERROR_CODES.invalidOrder };
        }
        if (!hasValidOrder) {
            return { ok: false, errorCode: LAYOUT_ERROR_CODES.invalidOrder };
        }
        if (!hasMetadata) {
            return { ok: false, errorCode: LAYOUT_ERROR_CODES.invalidMetadata };
        }
    }

    const layout = buildLayoutRecord({
        widgets,
        order: hasOrder ? orderList : undefined,
        createdAt: normalizeTimestamp(createdAtValue, requiresMigration ? 0 : nowTimestamp()),
        updatedAt: normalizeTimestamp(updatedAtValue, requiresMigration ? 0 : nowTimestamp()),
    });

    return { ok: true, layout, migrated: requiresMigration };
};

const createEmptyLayout = (): DashboardLayout =>
    buildLayoutRecord({ widgets: [] });

const isStorageLike = (value: unknown): value is StorageLike => {
    const getItemValue = getObjectValue(value, "getItem");
    const setItemValue = getObjectValue(value, "setItem");
    return typeof getItemValue === "function" && typeof setItemValue === "function";
};

const getStorage = (): StorageLike | null => {
    const candidate = getObjectValue(globalThis, "localStorage");
    return isStorageLike(candidate) ? candidate : null;
};

const serializeLayout = (layout: DashboardLayout): string =>
    JSON.stringify(buildLayoutRecord(layout));

const parseLayout = (
    raw: string | null,
): {
    status: "missing" | "valid" | "migrated" | "corrupt" | "version-mismatch";
    layout: DashboardLayout;
    errorCode: string | null;
    version: number | null;
} => {
    if (!raw) {
        return { status: "missing", layout: createEmptyLayout(), errorCode: null, version: null };
    }

    try {
        const parsed = JSON.parse(raw) as unknown;
        const validated = validateLayout(parsed);
        if (!validated.ok) {
            return {
                status: validated.errorCode === LAYOUT_ERROR_CODES.versionMismatch
                    ? "version-mismatch"
                    : "corrupt",
                layout: createEmptyLayout(),
                errorCode: validated.errorCode,
                version: validated.version ?? null,
            };
        }
        return {
            status: validated.migrated ? "migrated" : "valid",
            layout: validated.layout,
            errorCode: null,
            version: null
        };
    } catch {
        return {
            status: "corrupt",
            layout: createEmptyLayout(),
            errorCode: LAYOUT_ERROR_CODES.invalidPayload,
            version: null,
        };
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

export const loadLayout = (storage: StorageLike | null = getStorage()): DashboardLayout => {
    if (!storage) {
        return createEmptyLayout();
    }

    const resolved = parseLayout(storage.getItem(STORAGE_KEY));
    if (resolved.status !== "valid") {
        if (resolved.status === "version-mismatch") {
            console.warn(
                "Dashboard layout version mismatch. Rebuilding default layout.",
                { expected: DASHBOARD_LAYOUT_SCHEMA_VERSION, found: resolved.version },
            );
        } else if (resolved.errorCode) {
            console.warn(
                "Invalid dashboard layout found in storage. Falling back to default layout.",
                { code: resolved.errorCode },
            );
        }
        const payload = resolved.status === "migrated" ? resolved.layout : createEmptyLayout();
        storage.setItem(STORAGE_KEY, serializeLayout(payload));
        return payload;
    }

    return resolved.layout;
};

export const saveLayout = (
    layout: DashboardLayout,
    storage: StorageLike | null = getStorage(),
): void => {
    if (!storage) {
        return;
    }

    storage.setItem(STORAGE_KEY, serializeLayout(layout));
};

export const addWidgetToLayout = (
    layout: DashboardLayout,
    widgetId: WidgetId,
    options?: AddWidgetOptions,
): DashboardLayout => {
    const placement = createPlacement(widgetId, layout, options);
    return buildLayoutRecord({
        widgets: layout.widgets.concat(placement),
        order: layout.order,
        createdAt: layout.createdAt,
        updatedAt: nowTimestamp(),
    });
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
