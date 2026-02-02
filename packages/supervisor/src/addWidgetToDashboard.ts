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

export const addWidgetToLayout = (input: AddWidgetInput): DashboardLayout => {
    const { layout, widget, placement, defaultPlacementSize } = input;
    const nextPlacement = placement ?? findNextPlacement(layout.placements, layout.cols, defaultPlacementSize);
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
    const nextPlacements = layout.placements.map((existing) =>
        existing.id === placement.id ? { ...existing, ...placement } : existing
    );

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
    const missingPlacements = layout.widgets
        .filter((widget) => !placementIds.has(widget.id))
        .map((widget) => ({
            ...findNextPlacement(layout.placements, layout.cols, defaultPlacementSize),
            id: widget.id
        }));

    if (missingPlacements.length === 0) {
        return layout;
    }

    return {
        ...layout,
        placements: [...layout.placements, ...missingPlacements]
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

const findNextPlacement = (
    placements: WidgetPlacement[],
    cols: number,
    defaultPlacementSize?: PlacementSize
): Omit<WidgetPlacement, "id"> => {
    const size = defaultPlacementSize ?? { w: 4, h: 4 };
    const maxY = placements.reduce((currentMax, placement) => {
        const bottom = placement.y + placement.h;
        return bottom > currentMax ? bottom : currentMax;
    }, 0);

    return {
        x: 0,
        y: maxY,
        w: Math.min(size.w, cols),
        h: size.h
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
