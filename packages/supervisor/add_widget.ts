import { randomUUID } from "node:crypto";

export type WidgetId = string;

export type WidgetSize = {
    w: number;
    h: number;
};

export type WidgetDefinition = {
    id: WidgetId;
    defaultSize: WidgetSize;
    minSize?: WidgetSize;
    maxSize?: WidgetSize;
};

export type DashboardWidget = {
    id: string;
    widgetId: WidgetId;
    x: number;
    y: number;
    w: number;
    h: number;
};

export type Dashboard = {
    id: string;
    widgets: ReadonlyArray<DashboardWidget>;
    layoutVersion: number;
    gridColumns?: number;
};

export type Placement = {
    x: number;
    y: number;
    w: number;
    h: number;
};

export type PlacementStrategy = (args: {
    dashboard: Dashboard;
    widget: WidgetDefinition;
    size: WidgetSize;
}) => Placement;

export type AddWidgetResult = {
    dashboard: Dashboard;
    widget: DashboardWidget;
};

export type DashboardStorage = {
    load: (dashboardId: string) => Promise<Dashboard | null>;
    save: (dashboard: Dashboard) => Promise<void>;
};

const range = (start: number, endExclusive: number): ReadonlyArray<number> => {
    if (endExclusive <= start) {
        return [];
    }
    return Array.from({ length: endExclusive - start }, (_, i) => start + i);
};

const clampSize = (size: WidgetSize, minSize?: WidgetSize, maxSize?: WidgetSize): WidgetSize => {
    const withMin = minSize
        ? {
            w: Math.max(size.w, minSize.w),
            h: Math.max(size.h, minSize.h),
        }
        : size;
    return maxSize
        ? {
            w: Math.min(withMin.w, maxSize.w),
            h: Math.min(withMin.h, maxSize.h),
        }
        : withMin;
};

const buildOccupied = (widgets: ReadonlyArray<DashboardWidget>): ReadonlySet<string> => {
    const points = widgets.flatMap((widget) =>
        range(widget.x, widget.x + widget.w).flatMap((x) =>
            range(widget.y, widget.y + widget.h).map((y) => `${x},${y}`),
        ),
    );
    return new Set(points);
};

const isAreaFree = (occupied: ReadonlySet<string>, placement: Placement): boolean =>
    range(placement.x, placement.x + placement.w).every((x) =>
        range(placement.y, placement.y + placement.h).every((y) => !occupied.has(`${x},${y}`)),
    );

const findFirstAvailablePlacement = (args: {
    widgets: ReadonlyArray<DashboardWidget>;
    size: WidgetSize;
    gridColumns: number;
}): Placement => {
    const { widgets, size, gridColumns } = args;
    const occupied = buildOccupied(widgets);
    const maxY = widgets.reduce((current, widget) => Math.max(current, widget.y + widget.h), 0);
    const maxSearchY = maxY + size.h + 50;
    const xCandidates = range(0, Math.max(0, gridColumns - size.w + 1));
    const yCandidates = range(0, maxSearchY + 1);

    const candidate = yCandidates
        .flatMap((y) => xCandidates.map((x) => ({ x, y, w: size.w, h: size.h })))
        .find((placement) => isAreaFree(occupied, placement));

    return candidate ?? { x: 0, y: maxSearchY, w: size.w, h: size.h };
};

const defaultPlacementStrategy: PlacementStrategy = ({ dashboard, widget, size }) =>
    findFirstAvailablePlacement({
        widgets: dashboard.widgets,
        size: clampSize(size, widget.minSize, widget.maxSize),
        gridColumns: dashboard.gridColumns ?? 12,
    });

const makeWidgetInstanceId = (): string => {
    try {
        return randomUUID();
    } catch {
        return `widget_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    }
};

export const addWidgetToDashboard = (args: {
    dashboard: Dashboard;
    widget: WidgetDefinition;
    placementStrategy?: PlacementStrategy;
    makeId?: () => string;
}): AddWidgetResult => {
    const { dashboard, widget, placementStrategy, makeId } = args;
    const size = clampSize(widget.defaultSize, widget.minSize, widget.maxSize);
    const placement = (placementStrategy ?? defaultPlacementStrategy)({
        dashboard,
        widget,
        size,
    });
    const newWidget: DashboardWidget = {
        id: (makeId ?? makeWidgetInstanceId)(),
        widgetId: widget.id,
        x: placement.x,
        y: placement.y,
        w: placement.w,
        h: placement.h,
    };
    return {
        dashboard: {
            ...dashboard,
            widgets: [...dashboard.widgets, newWidget],
            layoutVersion: dashboard.layoutVersion + 1,
        },
        widget: newWidget,
    };
};

export const addWidgetAndPersist = async (args: {
    storage: DashboardStorage;
    dashboardId: string;
    widget: WidgetDefinition;
    placementStrategy?: PlacementStrategy;
    makeId?: () => string;
}): Promise<AddWidgetResult> => {
    const { storage, dashboardId, widget, placementStrategy, makeId } = args;
    const current = await storage.load(dashboardId);
    if (!current) {
        throw new Error(`Dashboard not found: ${dashboardId}`);
    }
    const result = addWidgetToDashboard({
        dashboard: current,
        widget,
        placementStrategy,
        makeId,
    });
    await storage.save(result.dashboard);
    return result;
};
