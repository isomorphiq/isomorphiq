import { z } from "zod";

export const GridColumnsSchema = z.number().int().positive().max(48);

export const WidgetIdSchema = z.string().min(1);
export type WidgetId = z.output<typeof WidgetIdSchema>;

export const WidgetSizeSchema = z.object({
    w: z.number().int().positive(),
    h: z.number().int().positive()
});
export type WidgetSize = z.output<typeof WidgetSizeSchema>;

export const WidgetPlacementSchema = z.object({
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    w: z.number().int().positive(),
    h: z.number().int().positive()
});
export type WidgetPlacement = z.output<typeof WidgetPlacementSchema>;

export const WidgetDefinitionSchema = z.object({
    id: WidgetIdSchema,
    name: z.string().min(1),
    defaultSize: WidgetSizeSchema,
    minSize: WidgetSizeSchema.optional(),
    maxSize: WidgetSizeSchema.optional()
});
export type WidgetDefinition = z.output<typeof WidgetDefinitionSchema>;

export const DashboardWidgetSchema = z.object({
    instanceId: z.string().uuid(),
    widgetId: WidgetIdSchema,
    placement: WidgetPlacementSchema
});
export type DashboardWidget = z.output<typeof DashboardWidgetSchema>;

export const DashboardStateSchema = z.object({
    widgets: z.array(DashboardWidgetSchema),
    gridColumns: GridColumnsSchema,
    updatedAt: z.string().min(1)
});
export type DashboardState = z.output<typeof DashboardStateSchema>;

export const WidgetLibrarySchema = z.object({
    widgets: z.array(WidgetDefinitionSchema)
});
export type WidgetLibrary = z.output<typeof WidgetLibrarySchema>;
