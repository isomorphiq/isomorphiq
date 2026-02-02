import type {
    DashboardState,
    DashboardWidget,
    WidgetId,
    WidgetLibrary
} from "./dashboard-model.ts";
import { computeNextPlacement } from "./dashboard-layout.ts";
import { createWidgetInstanceId } from "./dashboard-ids.ts";
import type { DashboardStorage } from "./dashboard-storage.ts";

export type AddWidgetResult =
    | { type: "added"; state: DashboardState; widget: DashboardWidget }
    | { type: "not-found"; widgetId: WidgetId };

export type DashboardOptions = {
    gridColumns: number;
};

const defaultOptions: DashboardOptions = {
    gridColumns: 12
};

const nowIso = (): string => new Date().toISOString();

const createEmptyDashboardState = (options: DashboardOptions): DashboardState => ({
    widgets: [],
    gridColumns: options.gridColumns,
    updatedAt: nowIso()
});

export const addWidgetFromLibrary = async (params: {
    storage: DashboardStorage;
    library: WidgetLibrary;
    widgetId: WidgetId;
    options?: Partial<DashboardOptions>;
}): Promise<AddWidgetResult> => {
    const { storage, library, widgetId, options } = params;
    const resolvedOptions: DashboardOptions = {
        ...defaultOptions,
        ...options
    };

    const widgetDefinition = library.widgets.find((widget) => widget.id === widgetId);

    if (!widgetDefinition) {
        return { type: "not-found", widgetId };
    }

    const currentState = (await storage.load()) ?? createEmptyDashboardState(resolvedOptions);
    const placement = computeNextPlacement(
        currentState.widgets.map((widget) => widget.placement),
        widgetDefinition.defaultSize,
        resolvedOptions.gridColumns
    );

    const widget: DashboardWidget = {
        instanceId: createWidgetInstanceId(),
        widgetId: widgetDefinition.id,
        placement
    };

    const nextState: DashboardState = {
        ...currentState,
        widgets: [...currentState.widgets, widget],
        gridColumns: resolvedOptions.gridColumns,
        updatedAt: nowIso()
    };

    await storage.save(nextState);

    return { type: "added", state: nextState, widget };
};
