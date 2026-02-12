// FILE_CONTEXT: "context-a2d6ff09-d979-49d1-81f9-31ff26bc956c"

import { z } from "zod";

const DASHBOARD_LAYOUT_SCHEMA_VERSION = 2;

export const WidgetPlacementSchema = z.object({
    id: z.string(),
    widgetType: z.string(),
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    w: z.number().int().positive(),
    h: z.number().int().positive()
});

export type WidgetPlacement = z.output<typeof WidgetPlacementSchema>;

const LayoutOrderSchema = z.array(z.string().min(1));

export const DashboardLayoutSchema = z.object({
    version: z.literal(DASHBOARD_LAYOUT_SCHEMA_VERSION),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
    order: LayoutOrderSchema,
    placements: z.array(WidgetPlacementSchema)
}).superRefine((layout, ctx) => {
    const placementIds = layout.placements.map((placement) => placement.id);
    const placementIdSet = new Set(placementIds);
    const orderSet = new Set(layout.order);

    if (placementIdSet.size !== placementIds.length) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Placement ids must be unique."
        });
    }

    if (orderSet.size !== layout.order.length) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Order sequence must not contain duplicate ids."
        });
    }

    placementIds.forEach((id) => {
        if (!orderSet.has(id)) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `Order sequence missing placement id: ${id}`
            });
        }
    });

    layout.order.forEach((id) => {
        if (!placementIdSet.has(id)) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `Order sequence references unknown placement id: ${id}`
            });
        }
    });
});

export type DashboardLayout = z.output<typeof DashboardLayoutSchema>;

const STORAGE_KEY = "supervisor.dashboard.layout.v1";

const nowTimestamp = (): number => Date.now();

const normalizeTimestamp = (value: unknown, fallback: number): number => {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
        return Math.floor(value);
    }
    return fallback;
};

const buildOrderSequence = (
    placements: WidgetPlacement[],
    order?: readonly string[]
): string[] => {
    const placementIds = placements.map((placement) => placement.id);
    const placementIdSet = new Set(placementIds);
    const seeded = (order ?? []).reduce(
        (state, id) => {
            if (!placementIdSet.has(id) || state.seen.has(id)) {
                return state;
            }
            const nextSeen = new Set(state.seen);
            nextSeen.add(id);
            return { list: state.list.concat(id), seen: nextSeen };
        },
        { list: [] as string[], seen: new Set<string>() }
    );

    return placementIds.reduce(
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
    placements?: WidgetPlacement[];
    order?: readonly string[];
    createdAt?: number;
    updatedAt?: number;
}): DashboardLayout => {
    const placements = input.placements ?? [];
    const createdAt = normalizeTimestamp(input.createdAt, nowTimestamp());
    const updatedAt = normalizeTimestamp(input.updatedAt, createdAt);
    const order = buildOrderSequence(placements, input.order);
    const placementsById = placements.reduce(
        (acc, placement) => {
            const next = new Map(acc);
            next.set(placement.id, placement);
            return next;
        },
        new Map<string, WidgetPlacement>()
    );
    const orderedPlacements = order.reduce<WidgetPlacement[]>((acc, id) => {
        const placement = placementsById.get(id);
        return placement ? acc.concat(placement) : acc;
    }, []);

    return {
        version: DASHBOARD_LAYOUT_SCHEMA_VERSION,
        createdAt,
        updatedAt,
        order,
        placements: orderedPlacements
    };
};

const defaultLayout = (): DashboardLayout => buildLayoutRecord({ placements: [] });

const LegacyDashboardLayoutSchema = z.object({
    version: z.number().int().positive().optional(),
    order: LayoutOrderSchema.optional(),
    placements: z.array(WidgetPlacementSchema),
    createdAt: z.number().optional(),
    updatedAt: z.number().optional()
});

type ParsedLayout = {
    layout: DashboardLayout;
    migrated: boolean;
};

const parseStoredLayout = (value: unknown): ParsedLayout | null => {
    const current = DashboardLayoutSchema.safeParse(value);
    if (current.success) {
        return { layout: buildLayoutRecord(current.data), migrated: false };
    }

    const legacy = LegacyDashboardLayoutSchema.safeParse(value);
    if (!legacy.success) {
        return null;
    }

    const legacyVersion = legacy.data.version;
    if (
        typeof legacyVersion === "number"
        && legacyVersion !== 1
        && legacyVersion !== DASHBOARD_LAYOUT_SCHEMA_VERSION
    ) {
        return null;
    }

    return {
        layout: buildLayoutRecord({
            placements: legacy.data.placements,
            order: legacy.data.order,
            createdAt: normalizeTimestamp(legacy.data.createdAt, 0),
            updatedAt: normalizeTimestamp(legacy.data.updatedAt, 0)
        }),
        migrated: true
    };
};

const safeJsonParse = (raw: string | null): unknown | null => {
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
};

const readFromStorage = (): DashboardLayout => {
    const storage = globalThis.localStorage;
    if (!storage) return defaultLayout();
    const parsed = safeJsonParse(storage.getItem(STORAGE_KEY));
    const resolved = parseStoredLayout(parsed);
    if (!resolved) {
        return defaultLayout();
    }
    if (resolved.migrated) {
        writeToStorage(resolved.layout);
    }
    return resolved.layout;
};

const serializeLayout = (layout: DashboardLayout): string =>
    JSON.stringify(buildLayoutRecord(layout));

const writeToStorage = (layout: DashboardLayout): void => {
    const storage = globalThis.localStorage;
    if (!storage) return;
    storage.setItem(STORAGE_KEY, serializeLayout(layout));
};

export const loadDashboardLayout = (): DashboardLayout => readFromStorage();

const createWidgetId = (): string => {
    const cryptoApi = globalThis.crypto;
    if (cryptoApi && typeof cryptoApi.randomUUID === "function") return cryptoApi.randomUUID();
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
        h: 3
    };
};

export const addWidgetToDashboard = (
    layout: DashboardLayout,
    widgetType: string,
): DashboardLayout => {
    const placement = nextPlacement(layout.placements, widgetType);
    const nextPlacements = layout.placements.concat(placement);
    const updated = buildLayoutRecord({
        placements: nextPlacements,
        order: layout.order,
        createdAt: layout.createdAt,
        updatedAt: nowTimestamp()
    });
    writeToStorage(updated);
    return updated;
};

export const updateWidgetPlacement = (
    layout: DashboardLayout,
    placement: WidgetPlacement
): DashboardLayout => {
    const nextPlacements = layout.placements.map((item) =>
        item.id === placement.id ? placement : item
    );
    const updated = buildLayoutRecord({
        placements: nextPlacements,
        order: layout.order,
        createdAt: layout.createdAt,
        updatedAt: nowTimestamp()
    });
    writeToStorage(updated);
    return updated;
};

export const removeWidgetFromDashboard = (
    layout: DashboardLayout,
    widgetId: string
): DashboardLayout => {
    const nextPlacements = layout.placements.filter((item) => item.id !== widgetId);
    const updated = buildLayoutRecord({
        placements: nextPlacements,
        order: layout.order,
        createdAt: layout.createdAt,
        updatedAt: nowTimestamp()
    });
    writeToStorage(updated);
    return updated;
};
