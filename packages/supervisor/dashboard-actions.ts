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
