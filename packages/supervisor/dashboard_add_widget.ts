// FILE_CONTEXT: "context-0c2c49e2-72cb-4ed0-9515-c78474323641"

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";

export const WidgetDefinitionSchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    minWidth: z.number().int().positive().default(1),
    minHeight: z.number().int().positive().default(1),
    defaultWidth: z.number().int().positive().default(2),
    defaultHeight: z.number().int().positive().default(2),
});

export type WidgetDefinition = {
    id: string;
    name: string;
    minWidth: number;
    minHeight: number;
    defaultWidth: number;
    defaultHeight: number;
};

export const WidgetLibrarySchema = z.object({
    widgets: z.array(WidgetDefinitionSchema),
});

export type WidgetLibrary = {
    widgets: WidgetDefinition[];
};

export const DashboardWidgetSchema = z.object({
    instanceId: z.string().min(1),
    widgetId: z.string().min(1),
    settings: z.record(z.unknown()).default({}),
});

export type DashboardWidget = {
    instanceId: string;
    widgetId: string;
    settings: Record<string, unknown>;
};

export const DashboardWidgetPlacementSchema = z.object({
    instanceId: z.string().min(1),
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    w: z.number().int().positive(),
    h: z.number().int().positive(),
});

export type DashboardWidgetPlacement = {
    instanceId: string;
    x: number;
    y: number;
    w: number;
    h: number;
};

export const DashboardSchema = z.object({
    id: z.string().min(1),
    version: z.number().int().nonnegative(),
    widgets: z.array(DashboardWidgetSchema),
    layout: z.array(DashboardWidgetPlacementSchema),
});

export type Dashboard = {
    id: string;
    version: number;
    widgets: DashboardWidget[];
    layout: DashboardWidgetPlacement[];
};

export type AddWidgetError =
    | {
          type: "unknown-widget";
          widgetId: string;
      }
    | {
          type: "instance-id-collision";
          instanceId: string;
      };

export type AddWidgetResult =
    | {
          ok: true;
          dashboard: Dashboard;
          widget: DashboardWidget;
          placement: DashboardWidgetPlacement;
      }
    | {
          ok: false;
          error: AddWidgetError;
      };

export type AddWidgetOptions = {
    instanceId: string;
    widgetId: string;
    placement?: {
        x: number;
        y: number;
        w?: number;
        h?: number;
    };
};

const hasInstanceId = (widgets: DashboardWidget[], instanceId: string): boolean =>
    widgets.some((widget) => widget.instanceId === instanceId);

const findWidgetDefinition = (
    library: WidgetLibrary,
    widgetId: string,
): WidgetDefinition | undefined => library.widgets.find((widget) => widget.id === widgetId);

const overlaps = (
    a: DashboardWidgetPlacement,
    b: DashboardWidgetPlacement,
): boolean => {
    const ax2 = a.x + a.w;
    const ay2 = a.y + a.h;
    const bx2 = b.x + b.w;
    const by2 = b.y + b.h;

    const separated =
        ax2 <= b.x || bx2 <= a.x || ay2 <= b.y || by2 <= a.y;

    return !separated;
};

const placementOverlaps = (
    layout: DashboardWidgetPlacement[],
    placement: DashboardWidgetPlacement,
): boolean => layout.some((existing) => overlaps(existing, placement));

const computeNextPlacement = (
    layout: DashboardWidgetPlacement[],
    widget: WidgetDefinition,
    placement?: AddWidgetOptions["placement"],
): DashboardWidgetPlacement => {
    const width = placement?.w ?? widget.defaultWidth;
    const height = placement?.h ?? widget.defaultHeight;
    const startX = placement?.x ?? 0;
    const startY = placement?.y ?? 0;

    if (placement && placement.x >= 0 && placement.y >= 0) {
        return {
            instanceId: "",
            x: placement.x,
            y: placement.y,
            w: width,
            h: height,
        };
    }

    const maxY = layout.reduce((acc, item) => Math.max(acc, item.y + item.h), 0);
    const maxX = layout.reduce((acc, item) => Math.max(acc, item.x + item.w), 0);
    const searchWidth = Math.max(maxX + width, 12);

    const positions = Array.from({ length: maxY + height + 1 }, (_, y) =>
        Array.from({ length: searchWidth }, (_, x) => ({
            x,
            y,
        })),
    ).flat();

    const candidate = positions.find(({ x, y }) =>
        !placementOverlaps(layout, {
            instanceId: "",
            x,
            y,
            w: width,
            h: height,
        }),
    );

    if (candidate) {
        return {
            instanceId: "",
            x: candidate.x,
            y: candidate.y,
            w: width,
            h: height,
        };
    }

    return {
        instanceId: "",
        x: startX,
        y: Math.max(maxY, startY),
        w: width,
        h: height,
    };
};

export const addWidgetToDashboard = (
    dashboard: Dashboard,
    library: WidgetLibrary,
    options: AddWidgetOptions,
): AddWidgetResult => {
    const widgetDefinition = findWidgetDefinition(library, options.widgetId);

    if (!widgetDefinition) {
        return {
            ok: false,
            error: {
                type: "unknown-widget",
                widgetId: options.widgetId,
            },
        };
    }

    if (hasInstanceId(dashboard.widgets, options.instanceId)) {
        return {
            ok: false,
            error: {
                type: "instance-id-collision",
                instanceId: options.instanceId,
            },
        };
    }

    const basePlacement = computeNextPlacement(
        dashboard.layout,
        widgetDefinition,
        options.placement,
    );
    const placement: DashboardWidgetPlacement = {
        ...basePlacement,
        instanceId: options.instanceId,
    };

    const widget: DashboardWidget = {
        instanceId: options.instanceId,
        widgetId: options.widgetId,
        settings: {},
    };

    const updatedDashboard: Dashboard = {
        ...dashboard,
        version: dashboard.version + 1,
        widgets: [...dashboard.widgets, widget],
        layout: [...dashboard.layout, placement],
    };

    return {
        ok: true,
        dashboard: updatedDashboard,
        widget,
        placement,
    };
};

export type DashboardPersistence = {
    load: (dashboardId: string) => Promise<Dashboard | null>;
    save: (dashboard: Dashboard) => Promise<void>;
};

export type DashboardFilePersistenceOptions = {
    pathForId: (dashboardId: string) => string;
};

export const createFileDashboardPersistence = (
    options: DashboardFilePersistenceOptions,
): DashboardPersistence => ({
    load: async (dashboardId: string): Promise<Dashboard | null> => {
        const path = options.pathForId(dashboardId);
        try {
            const payload = await readFile(path, "utf-8");
            return deserializeDashboard(payload);
        } catch (error) {
            if (error instanceof Error && "code" in error && error.code === "ENOENT") {
                return null;
            }
            throw error;
        }
    },
    save: async (dashboard: Dashboard): Promise<void> => {
        const path = options.pathForId(dashboard.id);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, serializeDashboard(dashboard), "utf-8");
    },
});

export const serializeDashboard = (dashboard: Dashboard): string =>
    JSON.stringify(DashboardSchema.parse(dashboard));

export const deserializeDashboard = (payload: string): Dashboard =>
    DashboardSchema.parse(JSON.parse(payload));

export const addWidgetToDashboardAndPersist = async (
    persistence: DashboardPersistence,
    library: WidgetLibrary,
    options: AddWidgetOptions & { dashboardId: string },
): Promise<AddWidgetResult> => {
    const loaded = await persistence.load(options.dashboardId);
    const dashboard = loaded ?? {
        id: options.dashboardId,
        version: 0,
        widgets: [],
        layout: [],
    };

    const result = addWidgetToDashboard(dashboard, library, options);

    if (!result.ok) {
        return result;
    }

    await persistence.save(result.dashboard);

    return result;
};
