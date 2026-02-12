// FILE_CONTEXT: "context-0c8b3046-3247-4728-96a3-d0e83648d371"

import {
    DashboardState,
    WidgetDefinition,
    addWidgetToDashboard,
} from "./dashboard.ts";
import {
    DashboardStorage,
    loadDashboardState,
    persistDashboardState,
} from "./dashboard-storage.ts";

export const addWidgetAndPersist = (
    storage: DashboardStorage,
    widget: WidgetDefinition,
    stateOverride?: DashboardState,
): DashboardState => {
    const currentState = stateOverride ?? loadDashboardState(storage);
    const nextState = addWidgetToDashboard(currentState, widget);
    persistDashboardState(storage, nextState);
    return nextState;
};
