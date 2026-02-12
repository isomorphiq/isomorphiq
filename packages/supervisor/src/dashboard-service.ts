// FILE_CONTEXT: "context-0972d1f1-0982-42ff-af7d-1ca07855ab04"

import { randomUUID } from "node:crypto";
import type {
    DashboardSessionMetadata,
    DashboardState,
    DashboardWidget,
    WidgetPlacement,
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

const createSessionId = (): string => {
    try {
        return randomUUID();
    } catch {
        return `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }
};

const createSessionMetadata = (): DashboardSessionMetadata => {
    const now = nowIso();
    return {
        sessionId: createSessionId(),
        startedAt: now,
        lastActiveAt: now
    };
};

const touchSessionMetadata = (
    session?: DashboardSessionMetadata
): DashboardSessionMetadata => {
    const now = nowIso();
    if (!session) {
        return {
            sessionId: createSessionId(),
            startedAt: now,
            lastActiveAt: now
        };
    }
    return { ...session, lastActiveAt: now };
};

const createEmptyDashboardState = (options: DashboardOptions): DashboardState => ({
    widgets: [],
    gridColumns: options.gridColumns,
    selectedWidgetIds: [],
    session: createSessionMetadata(),
    updatedAt: nowIso()
});

export const addWidgetFromLibrary = async (params: {
    storage: DashboardStorage;
    library: WidgetLibrary;
    widgetId: WidgetId;
    placement?: Partial<WidgetPlacement>;
    options?: Partial<DashboardOptions>;
}): Promise<AddWidgetResult> => {
    const { storage, library, widgetId, placement: placementOverride, options } = params;
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
        resolvedOptions.gridColumns,
        placementOverride
    );

    const widget: DashboardWidget = {
        instanceId: createWidgetInstanceId(),
        widgetId: widgetDefinition.id,
        placement,
        config: {
            settings: {},
            selections: []
        }
    };

    const nextState: DashboardState = {
        ...currentState,
        widgets: [...currentState.widgets, widget],
        gridColumns: resolvedOptions.gridColumns,
        session: touchSessionMetadata(currentState.session),
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
        session: touchSessionMetadata(currentState.session),
        updatedAt: nowIso()
    };

    await storage.save(nextState);

    return { type: "removed", state: nextState, widget };
};
