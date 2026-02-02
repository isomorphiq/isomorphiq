import { z } from "zod";

export const DashboardWidgetLayoutSchema = z.object({
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    w: z.number().int().positive(),
    h: z.number().int().positive(),
});

export type DashboardWidgetLayout = z.output<typeof DashboardWidgetLayoutSchema>;

export const DashboardWidgetSchema = z.object({
    id: z.string().min(1),
    type: z.string().min(1),
    title: z.string().min(1),
    layout: DashboardWidgetLayoutSchema,
    config: z.record(z.unknown()).default({}),
    createdAt: z.string().datetime(),
});

export type DashboardWidget = z.output<typeof DashboardWidgetSchema>;

export const WidgetLibraryItemSchema = z.object({
    type: z.string().min(1),
    title: z.string().min(1),
    defaultLayout: DashboardWidgetLayoutSchema,
    defaultConfig: z.record(z.unknown()).default({}),
});

export type WidgetLibraryItem = z.output<typeof WidgetLibraryItemSchema>;

export const DashboardStateSchema = z.object({
    widgets: z.array(DashboardWidgetSchema),
    version: z.literal(1),
});

export type DashboardState = z.output<typeof DashboardStateSchema>;

export type StoragePort = {
    getItem: (key: string) => string | null;
    setItem: (key: string, value: string) => void;
};

export type AddWidgetInput = {
    dashboard: DashboardState;
    libraryItem: WidgetLibraryItem;
    idFactory: () => string;
    nowIso: () => string;
    columns?: number;
};

export const createEmptyDashboardState = (): DashboardState => ({
    widgets: [],
    version: 1,
});

const getMaxRow = (widgets: readonly DashboardWidget[]): number => {
    if (widgets.length === 0) {
        return 0;
    }

    return widgets
        .map((widget) => widget.layout.y + widget.layout.h)
        .reduce((max, value) => Math.max(max, value), 0);
};

const clampWidth = (width: number, columns: number): number =>
    Math.min(Math.max(1, width), Math.max(1, columns));

export const computeNextLayout = (
    widgets: readonly DashboardWidget[],
    defaultLayout: DashboardWidgetLayout,
    columns: number,
): DashboardWidgetLayout => {
    const width = clampWidth(defaultLayout.w, columns);
    const height = Math.max(1, defaultLayout.h);
    const y = getMaxRow(widgets);

    return {
        x: 0,
        y,
        w: width,
        h: height,
    };
};

export const addWidgetToDashboard = ({
    dashboard,
    libraryItem,
    idFactory,
    nowIso,
    columns = 12,
}: AddWidgetInput): DashboardState => {
    const layout = computeNextLayout(
        dashboard.widgets,
        libraryItem.defaultLayout,
        columns,
    );
    const widget: DashboardWidget = {
        id: idFactory(),
        type: libraryItem.type,
        title: libraryItem.title,
        layout,
        config: { ...libraryItem.defaultConfig },
        createdAt: nowIso(),
    };

    return {
        ...dashboard,
        widgets: [...dashboard.widgets, widget],
    };
};

export const serializeDashboardState = (dashboard: DashboardState): string =>
    JSON.stringify(dashboard);

export const parseDashboardState = (value: string): DashboardState =>
    DashboardStateSchema.parse(JSON.parse(value));

export const loadDashboardState = (
    storage: StoragePort,
    storageKey: string,
): DashboardState => {
    const raw = storage.getItem(storageKey);
    if (!raw) {
        return createEmptyDashboardState();
    }

    try {
        return parseDashboardState(raw);
    } catch {
        return createEmptyDashboardState();
    }
};

export const persistDashboardState = (
    storage: StoragePort,
    storageKey: string,
    dashboard: DashboardState,
): void => {
    storage.setItem(storageKey, serializeDashboardState(dashboard));
};
