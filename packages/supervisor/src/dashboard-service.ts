// FILE_CONTEXT: "context-0972d1f1-0982-42ff-af7d-1ca07855ab04"

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

export type RemoveWidgetResult =
    | { type: "removed"; state: DashboardState; widget: DashboardWidget }
    | { type: "not-found"; instanceId: string; state: DashboardState };

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

export const removeWidgetFromDashboard = async (params: {
    storage: DashboardStorage;
    instanceId: string;
    options?: Partial<DashboardOptions>;
}): Promise<RemoveWidgetResult> => {
    const { storage, instanceId, options } = params;
    const resolvedOptions: DashboardOptions = {
        ...defaultOptions,
        ...options
    };

    const currentState = (await storage.load()) ?? createEmptyDashboardState(resolvedOptions);
    const widget = currentState.widgets.find((item) => item.instanceId === instanceId);

    if (!widget) {
        return { type: "not-found", instanceId, state: currentState };
    }

    const nextState: DashboardState = {
        ...currentState,
        widgets: currentState.widgets.filter((item) => item.instanceId !== instanceId),
        updatedAt: nowIso()
    };

    await storage.save(nextState);

    return { type: "removed", state: nextState, widget };
};
