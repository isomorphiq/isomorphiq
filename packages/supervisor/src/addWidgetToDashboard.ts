// FILE_CONTEXT: "context-bb902150-c68e-47f5-99a5-5ae05cf0f72b"

import { z } from "zod";

const PlacementSizeSchema = z.object({
    w: z.number().int().positive(),
    h: z.number().int().positive()
});

export type PlacementSize = z.output<typeof PlacementSizeSchema>;

export const WidgetDefinitionSchema = z.object({
    type: z.string().min(1),
    defaultTitle: z.string().min(1).optional(),
    defaultSize: PlacementSizeSchema.optional(),
    defaultConfig: z.record(z.unknown()).default({})
});

export type WidgetDefinition = z.output<typeof WidgetDefinitionSchema>;

export const WidgetInstanceSchema = z.object({
    id: z.string().min(1),
    type: z.string().min(1),
    title: z.string().min(1).optional(),
    config: z.record(z.unknown()).default({})
});

export type WidgetInstance = z.output<typeof WidgetInstanceSchema>;

export const WidgetPlacementSchema = z.object({
    id: z.string().min(1),
    x: z.number().int().min(0),
    y: z.number().int().min(0),
    w: z.number().int().positive(),
    h: z.number().int().positive()
});

export type WidgetPlacement = z.output<typeof WidgetPlacementSchema>;

export const DashboardLayoutSchema = z.object({
    widgets: z.array(WidgetInstanceSchema),
    placements: z.array(WidgetPlacementSchema),
    cols: z.number().int().positive(),
    rowHeight: z.number().int().positive()
});

export type DashboardLayout = z.output<typeof DashboardLayoutSchema>;

export type DashboardStorage = {
    load: () => Promise<DashboardLayout | null>;
    save: (layout: DashboardLayout) => Promise<void>;
};

export type CreateWidgetInstanceInput = {
    definition: WidgetDefinition;
    id?: string;
    title?: string;
    config?: Record<string, unknown>;
};

export const createWidgetInstance = (input: CreateWidgetInstanceInput): WidgetInstance => {
    const { definition, id, title, config } = input;
    const widgetId = id ?? generateWidgetId();
    const mergedConfig = {
        ...definition.defaultConfig,
        ...config
    };

    return {
        id: widgetId,
        type: definition.type,
        title: title ?? definition.defaultTitle,
        config: mergedConfig
    };
};

export type AddWidgetInput = {
    layout: DashboardLayout;
    widget: WidgetInstance;
    placement?: Omit<WidgetPlacement, "id">;
    defaultPlacementSize?: PlacementSize;
};

const clamp = (value: number, min: number, max: number): number =>
    Math.min(max, Math.max(min, value));

const normalizePlacementSize = (size: PlacementSize, cols: number): PlacementSize => {
    const safeColumns = Math.max(1, cols);
    const width = clamp(size.w, 1, safeColumns);
    const height = Math.max(1, size.h);
    return { w: width, h: height };
};

const normalizePlacementCandidate = (
    placement: Omit<WidgetPlacement, "id">,
    cols: number,
    size: PlacementSize
): Omit<WidgetPlacement, "id"> => {
    const safeColumns = Math.max(1, cols);
    const maxX = Math.max(0, safeColumns - size.w);
    return {
        x: clamp(placement.x, 0, maxX),
        y: Math.max(0, placement.y),
        w: size.w,
        h: size.h
    };
};

const overlaps = (left: Omit<WidgetPlacement, "id">, right: WidgetPlacement): boolean => {
    const leftRight = left.x + left.w;
    const rightRight = right.x + right.w;
    const leftBottom = left.y + left.h;
    const rightBottom = right.y + right.h;

    const separatedHorizontally = leftRight <= right.x || rightRight <= left.x;
    const separatedVertically = leftBottom <= right.y || rightBottom <= left.y;

    return !(separatedHorizontally || separatedVertically);
};

const collides = (candidate: Omit<WidgetPlacement, "id">, placements: WidgetPlacement[]): boolean =>
    placements.some((existing) => overlaps(candidate, existing));

const findNextPlacement = (
    placements: WidgetPlacement[],
    cols: number,
    defaultPlacementSize?: PlacementSize,
    placementOverride?: Omit<WidgetPlacement, "id">
): Omit<WidgetPlacement, "id"> => {
    const baseSize = placementOverride
        ? { w: placementOverride.w, h: placementOverride.h }
        : defaultPlacementSize ?? { w: 4, h: 4 };
    const size = normalizePlacementSize(baseSize, cols);
    const safeColumns = Math.max(1, cols);
    const maxX = Math.max(0, safeColumns - size.w);
    const maxY = placements.reduce(
        (currentMax, placement) => Math.max(currentMax, placement.y + placement.h),
        0
    );
    const basePlacement = placementOverride ?? {
        x: 0,
        y: 0,
        w: size.w,
        h: size.h
    };
    const candidate = normalizePlacementCandidate(basePlacement, cols, size);

    const searchStartY = placementOverride ? candidate.y : 0;
    const searchMaxY = Math.max(maxY, candidate.y) + size.h + 1;

    for (let y = searchStartY; y <= searchMaxY; y += 1) {
        const xStart = y === candidate.y ? candidate.x : 0;
        for (let x = xStart; x <= maxX; x += 1) {
            const nextCandidate = {
                x,
                y,
                w: size.w,
                h: size.h
            };
            if (!collides(nextCandidate, placements)) {
                return nextCandidate;
            }
        }
    }

    return {
        x: 0,
        y: searchMaxY,
        w: size.w,
        h: size.h
    };
};

export const addWidgetToLayout = (input: AddWidgetInput): DashboardLayout => {
    const { layout, widget, placement, defaultPlacementSize } = input;
    const nextPlacement = findNextPlacement(
        layout.placements,
        layout.cols,
        defaultPlacementSize,
        placement
    );
    const filteredWidgets = layout.widgets.filter((existing) => existing.id !== widget.id);
    const filteredPlacements = layout.placements.filter((existing) => existing.id !== widget.id);

    return {
        ...layout,
        widgets: [...filteredWidgets, widget],
        placements: [
            ...filteredPlacements,
            {
                ...nextPlacement,
                id: widget.id
            }
        ]
    };
};

export const updateWidgetPlacement = (layout: DashboardLayout, placement: WidgetPlacement): DashboardLayout => {
    const remainingPlacements = layout.placements.filter((existing) => existing.id !== placement.id);
    const nextPlacement = findNextPlacement(
        remainingPlacements,
        layout.cols,
        { w: placement.w, h: placement.h },
        placement
    );
    const resolvedPlacement = {
        ...nextPlacement,
        id: placement.id
    };
    const nextPlacements = layout.placements.some((existing) => existing.id === placement.id)
        ? layout.placements.map((existing) =>
            existing.id === placement.id
                ? {
                    ...existing,
                    ...resolvedPlacement
                }
                : existing
        )
        : remainingPlacements.concat(resolvedPlacement);

    return {
        ...layout,
        placements: nextPlacements
    };
};

export const ensurePlacements = (
    layout: DashboardLayout,
    defaultPlacementSize?: PlacementSize
): DashboardLayout => {
    const placementIds = new Set(layout.placements.map((placement) => placement.id));
    const missingWidgets = layout.widgets.filter((widget) => !placementIds.has(widget.id));

    if (missingWidgets.length === 0) {
        return layout;
    }

    const nextPlacements = missingWidgets.reduce((placements, widget) => {
        const nextPlacement = findNextPlacement(placements, layout.cols, defaultPlacementSize);
        return placements.concat({ ...nextPlacement, id: widget.id });
    }, layout.placements);

    return {
        ...layout,
        placements: nextPlacements
    };
};

export const addWidgetAndPersist = async (
    input: AddWidgetInput & { storage: DashboardStorage }
): Promise<DashboardLayout> => {
    const { storage, ...addWidgetInput } = input;
    const nextLayout = addWidgetToLayout(addWidgetInput);
    await storage.save(nextLayout);
    return nextLayout;
};

export const loadDashboardLayout = async (
    storage: DashboardStorage,
    fallback: DashboardLayout
): Promise<DashboardLayout> => {
    const storedLayout = await storage.load();
    if (storedLayout) {
        return storedLayout;
    }

    await storage.save(fallback);
    return fallback;
};

export const createLocalStorageDashboardStorage = (
    key: string = "dashboard.layout.v1"
): DashboardStorage => {
    return {
        load: async () => {
            if (typeof window === "undefined" || !window.localStorage) {
                return null;
            }

            const raw = window.localStorage.getItem(key);
            if (!raw) {
                return null;
            }

            const parsed = safeParseJson(raw);
            if (!parsed) {
                return null;
            }

            const validated = DashboardLayoutSchema.safeParse(parsed);
            return validated.success ? validated.data : null;
        },
        save: async (layout) => {
            if (typeof window === "undefined" || !window.localStorage) {
                return;
            }

            window.localStorage.setItem(key, JSON.stringify(layout));
        }
    };
};

const generateWidgetId = (): string => {
    if (globalThis.crypto && "randomUUID" in globalThis.crypto) {
        return globalThis.crypto.randomUUID();
    }

    return `widget_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
};

const safeParseJson = (raw: string): unknown | null => {
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
};
