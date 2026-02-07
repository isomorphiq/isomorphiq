// FILE_CONTEXT: "context-cf70f883-7ed5-421a-bccc-9331843003c1"

import assert from "node:assert/strict";
import test from "node:test";

import {
    addWidgetAndPersist,
    updateWidgetPlacement,
    type DashboardLayout,
    type WidgetPlacement
} from "./addWidgetToDashboard.ts";

const createInMemoryStorage = (): {
    save: (layout: DashboardLayout) => Promise<void>;
    load: () => Promise<DashboardLayout>;
} => {
    let storedLayout: DashboardLayout = {
        widgets: [],
        placements: [],
        cols: 12,
        rowHeight: 4
    };
    return {
        save: async (layout) => { storedLayout = layout; },
        load: async () => storedLayout
    };
};

const addWidget = async (
    storage: { save: (layout: DashboardLayout) => Promise<void>; load: () => Promise<DashboardLayout> },
    widget: { id: string; type: string; title: string },
    defaultPlacementSize: { w: number; h: number }
): Promise<DashboardLayout> => {
    const layout = await storage.load();
    return addWidgetAndPersist({
        storage,
        layout,
        widget,
        defaultPlacementSize
    });
};

test("drag handle appears on hover", async () => {
    const storage = createInMemoryStorage();
    
    await addWidget(
        storage,
        { id: "widget-1", type: "metric", title: "CPU Usage" },
        { w: 4, h: 4 }
    );
    
    const loaded = await storage.load();
    
    assert.equal(loaded.widgets.length, 1);
    assert.equal(loaded.widgets[0]?.id, "widget-1");
});

test("ghost preview shows during drag", async () => {
    const storage = createInMemoryStorage();
    
    await addWidget(
        storage,
        { id: "widget-1", type: "metric", title: "CPU Usage" },
        { w: 4, h: 4 }
    );
    
    const loaded = await storage.load();
    
    assert.equal(loaded.widgets.length, 1);
    
    const ghostPlacement: WidgetPlacement = {
        id: "widget-1",
        x: 4,
        y: 0,
        w: 4,
        h: 4
    };
    
    const updated = updateWidgetPlacement(loaded, ghostPlacement);
    
    assert.equal(updated.placements[0]?.x, 4);
});

test("drop triggers position update", async () => {
    const storage = createInMemoryStorage();
    
    await addWidget(
        storage,
        { id: "widget-1", type: "metric", title: "CPU Usage" },
        { w: 4, h: 4 }
    );
    
    const loaded = await storage.load();
    
    assert.equal(loaded.widgets.length, 1);
    assert.equal(loaded.placements[0]?.y, 0);
    
    const droppedPlacement: WidgetPlacement = {
        id: "widget-1",
        x: 2,
        y: 2,
        w: 4,
        h: 4
    };
    
    const updated = updateWidgetPlacement(loaded, droppedPlacement);
    
    assert.equal(updated.placements[0]?.y, 2);
});

test("positions persist after page reload", async () => {
    const storage = createInMemoryStorage();
    
    await addWidget(
        storage,
        { id: "widget-1", type: "metric", title: "CPU Usage" },
        { w: 4, h: 4 }
    );
    
    const firstLoad = await storage.load();
    
    assert.equal(firstLoad.widgets.length, 1);
    
    const rearrangedPlacement: WidgetPlacement = {
        id: "widget-1",
        x: 6,
        y: 3,
        w: 4,
        h: 4
    };
    
    const updated = updateWidgetPlacement(firstLoad, rearrangedPlacement);
    await storage.save(updated);
    
    const secondLoad = await storage.load();
    
    assert.equal(secondLoad.widgets.length, 1);
    assert.equal(secondLoad.placements[0]?.x, 6);
    assert.equal(secondLoad.placements[0]?.y, 3);
});

test("multi-widget rearrangement works without collision", async () => {
    const storage = createInMemoryStorage();
    
    await addWidget(
        storage,
        { id: "widget-1", type: "metric", title: "CPU Usage" },
        { w: 4, h: 4 }
    );
    
    await addWidget(
        storage,
        { id: "widget-2", type: "metric", title: "Memory Usage" },
        { w: 4, h: 4 }
    );
    
    const loaded = await storage.load();
    
    assert.equal(loaded.widgets.length, 2);
    
    const cpuWidget = loaded.widgets.find(w => w.id === "widget-1");
    const memoryWidget = loaded.widgets.find(w => w.id === "widget-2");
    
    assert(cpuWidget);
    assert(memoryWidget);
    
    const cpuPlacementAfter: WidgetPlacement = {
        id: "widget-1",
        x: 0,
        y: 4,
        w: 4,
        h: 4
    };
    
    const memoryPlacementAfter: WidgetPlacement = {
        id: "widget-2",
        x: 4,
        y: 4,
        w: 4,
        h: 4
    };
    
    const updatedCpu = updateWidgetPlacement(loaded, cpuPlacementAfter);
    const updatedLayout = updateWidgetPlacement(updatedCpu, memoryPlacementAfter);
    await storage.save(updatedLayout);
    
    const finalLoad = await storage.load();
    
    assert.equal(finalLoad.widgets.length, 2);
    
    const finalCpu = finalLoad.widgets.find(w => w.id === "widget-1");
    const finalMemory = finalLoad.widgets.find(w => w.id === "widget-2");
    const finalCpuPlacement = finalLoad.placements.find(placement => placement.id === "widget-1");
    const finalMemoryPlacement = finalLoad.placements.find(placement => placement.id === "widget-2");
    
    assert(finalCpu);
    assert(finalMemory);
    assert(finalCpuPlacement);
    assert(finalMemoryPlacement);
    
    const overlap =
        finalCpuPlacement.x < finalMemoryPlacement.x + finalMemoryPlacement.w &&
        finalCpuPlacement.x + finalCpuPlacement.w > finalMemoryPlacement.x &&
        finalCpuPlacement.y < finalMemoryPlacement.y + finalMemoryPlacement.h &&
        finalCpuPlacement.y + finalCpuPlacement.h > finalMemoryPlacement.y;
    
    assert.equal(overlap, false);
});
