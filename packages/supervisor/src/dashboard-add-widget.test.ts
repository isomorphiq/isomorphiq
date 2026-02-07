import assert from "node:assert/strict";
import test from "node:test";
import { addWidgetFromLibrary, removeWidgetFromDashboard } from "./dashboard-service.ts";
import { createInMemoryDashboardStorage } from "./dashboard-storage.ts";
import type { WidgetLibrary } from "./dashboard-model.ts";

const sampleLibrary: WidgetLibrary = {
    widgets: [
        {
            id: "cpu",
            name: "CPU Usage",
            defaultSize: { w: 4, h: 2 }
        },
        {
            id: "memory",
            name: "Memory Usage",
            defaultSize: { w: 4, h: 2 }
        }
    ]
};

test("adds a widget from the library and persists it", async () => {
    const storage = createInMemoryDashboardStorage();
    const result = await addWidgetFromLibrary({
        storage,
        library: sampleLibrary,
        widgetId: "cpu"
    });

    assert.equal(result.type, "added");
    if (result.type === "added") {
        assert.equal(result.state.widgets.length, 1);
        assert.equal(result.widget.widgetId, "cpu");
        const loaded = await storage.load();
        assert.equal(loaded?.widgets.length, 1);
    }
});

test("places new widgets without overlap", async () => {
    const storage = createInMemoryDashboardStorage();
    await addWidgetFromLibrary({
        storage,
        library: sampleLibrary,
        widgetId: "cpu",
        options: { gridColumns: 8 }
    });
    const second = await addWidgetFromLibrary({
        storage,
        library: sampleLibrary,
        widgetId: "memory",
        options: { gridColumns: 8 }
    });

    assert.equal(second.type, "added");
    if (second.type === "added") {
        const [firstWidget, secondWidget] = second.state.widgets;
        const overlap =
            firstWidget.placement.x < secondWidget.placement.x + secondWidget.placement.w &&
            firstWidget.placement.x + firstWidget.placement.w > secondWidget.placement.x &&
            firstWidget.placement.y < secondWidget.placement.y + secondWidget.placement.h &&
            firstWidget.placement.y + firstWidget.placement.h > secondWidget.placement.y;
        assert.equal(overlap, false);
    }
});

test("returns not-found when widget id is missing", async () => {
    const storage = createInMemoryDashboardStorage();
    const result = await addWidgetFromLibrary({
        storage,
        library: sampleLibrary,
        widgetId: "missing"
    });

    assert.deepEqual(result, { type: "not-found", widgetId: "missing" });
});

test("removes a widget and persists the updated state", async () => {
    const storage = createInMemoryDashboardStorage();
    const result = await addWidgetFromLibrary({
        storage,
        library: sampleLibrary,
        widgetId: "cpu"
    });

    assert.equal(result.type, "added");
    if (result.type !== "added") {
        assert.fail("Expected widget to be added");
    }

    const removal = await removeWidgetFromDashboard({
        storage,
        instanceId: result.widget.instanceId
    });

    assert.equal(removal.type, "removed");
    if (removal.type === "removed") {
        assert.equal(removal.state.widgets.length, 0);
    }

    const loaded = await storage.load();
    assert.equal(loaded?.widgets.length, 0);
});

test("returns not-found when removing an unknown widget", async () => {
    const storage = createInMemoryDashboardStorage();
    await addWidgetFromLibrary({
        storage,
        library: sampleLibrary,
        widgetId: "cpu"
    });

    const removal = await removeWidgetFromDashboard({
        storage,
        instanceId: "missing-id"
    });

    assert.equal(removal.type, "not-found");
    if (removal.type === "not-found") {
        assert.equal(removal.state.widgets.length, 1);
    }

    const loaded = await storage.load();
    assert.equal(loaded?.widgets.length, 1);
});
