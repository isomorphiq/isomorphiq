import { z } from "zod";

export const DashboardWidgetSizeSchema = z.object({
    w: z.number().int().positive(),
    h: z.number().int().positive(),
});

export type DashboardWidgetSize = z.output<typeof DashboardWidgetSizeSchema>;

export const DashboardWidgetPositionSchema = z.object({
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    w: z.number().int().positive(),
    h: z.number().int().positive(),
});

export type DashboardWidgetPosition = z.output<typeof DashboardWidgetPositionSchema>;

export const WidgetDefinitionSchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    defaultSize: DashboardWidgetSizeSchema,
    defaultConfig: z.record(z.unknown()).default({}),
});

export type WidgetDefinition = z.output<typeof WidgetDefinitionSchema>;

export const DashboardWidgetSchema = z.object({
    instanceId: z.string().min(1),
    widgetId: z.string().min(1),
    name: z.string().min(1),
    position: DashboardWidgetPositionSchema,
    config: z.record(z.unknown()),
});

export type DashboardWidget = z.output<typeof DashboardWidgetSchema>;

export const DashboardStateSchema = z.object({
    version: z.number().int().positive(),
    widgets: z.array(DashboardWidgetSchema),
});

export type DashboardState = z.output<typeof DashboardStateSchema>;

export const DASHBOARD_STATE_VERSION = 1;

export const createEmptyDashboardState = (): DashboardState => ({
    version: DASHBOARD_STATE_VERSION,
    widgets: [],
});

export const createWidgetInstanceId = (): string => {
    const randomUuid =
        typeof globalThis.crypto !== "undefined" && "randomUUID" in globalThis.crypto
            ? globalThis.crypto.randomUUID.bind(globalThis.crypto)
            : null;

    if (randomUuid) {
        return randomUuid();
    }

    const randomSegment = Math.random().toString(36).slice(2);
    return `widget-${Date.now()}-${randomSegment}`;
};

export const placeWidget = (
    existingWidgets: readonly DashboardWidget[],
    size: DashboardWidgetSize,
): DashboardWidgetPosition => {
    const nextRow = existingWidgets.reduce((maxY, widget) => {
        const widgetBottom = widget.position.y + widget.position.h;
        return widgetBottom > maxY ? widgetBottom : maxY;
    }, 0);

    return {
        x: 0,
        y: nextRow,
        w: size.w,
        h: size.h,
    };
};

export const addWidgetToDashboard = (
    state: DashboardState,
    widget: WidgetDefinition,
): DashboardState => {
    const nextWidget: DashboardWidget = {
        instanceId: createWidgetInstanceId(),
        widgetId: widget.id,
        name: widget.name,
        position: placeWidget(state.widgets, widget.defaultSize),
        config: widget.defaultConfig ?? {},
    };

    return {
        ...state,
        widgets: [...state.widgets, nextWidget],
    };
};

export const updateWidgetPlacement = (
    state: DashboardState,
    instanceId: string,
    position: DashboardWidgetPosition,
): DashboardState => ({
    ...state,
    widgets: state.widgets.map((widget) =>
        widget.instanceId === instanceId ? { ...widget, position } : widget,
    ),
});
