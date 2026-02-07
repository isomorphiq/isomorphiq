import assert from "node:assert/strict";
import test from "node:test";
import {
    addWidgetAndPersist,
    createInMemoryStorage,
    loadDashboardState,
    removeWidgetAndPersist,
    type WidgetDefinition
} from "./dashboard.ts";

test("removes a widget and persists the updated dashboard", () => {
    const storage = createInMemoryStorage();
    const userId = "user-123";
    const widget: WidgetDefinition = {
        widgetId: "cpu",
        type: "metric",
        title: "CPU Usage",
        defaultSize: { w: 2, h: 2 }
    };

    const added = addWidgetAndPersist(storage, userId, widget, () => "widget-1");
    assert.equal(added.widgets.length, 1);

    const removed = removeWidgetAndPersist(storage, userId, "widget-1");
    assert.equal(removed.widgets.length, 0);

    const reloaded = loadDashboardState(storage, userId);
    assert.equal(reloaded.widgets.length, 0);
});

test("ignores removal for unknown widget ids", () => {
    const storage = createInMemoryStorage();
    const userId = "user-456";
    const widget: WidgetDefinition = {
        widgetId: "memory",
        type: "metric",
        title: "Memory Usage",
        defaultSize: { w: 4, h: 3 }
    };

    addWidgetAndPersist(storage, userId, widget, () => "widget-2");

    const removed = removeWidgetAndPersist(storage, userId, "missing-widget");
    assert.equal(removed.widgets.length, 1);
    assert.equal(removed.widgets[0]?.id, "widget-2");

    const reloaded = loadDashboardState(storage, userId);
    assert.equal(reloaded.widgets.length, 1);
    assert.equal(reloaded.widgets[0]?.id, "widget-2");
});
