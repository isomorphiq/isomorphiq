// FILE_CONTEXT: "context-e6f7db03-7cb4-424f-9f27-46659a3614dc"

import { z } from "zod";

export const DataSourceSchema = z.object({
	type: z.string().min(1),
	config: z.record(z.unknown()).default({}),
});

export type DataSource = z.output<typeof DataSourceSchema>;

export const MetricDefinitionSchema = z.object({
	name: z.string().min(1),
	type: z.enum(["counter", "gauge", "histogram"]),
	description: z.string().min(1).optional(),
	unit: z.string().min(1).optional(),
});

export type MetricDefinition = z.output<typeof MetricDefinitionSchema>;

export const UsageConstraintSchema = z.object({
	maxInstances: z.number().int().positive().optional(),
	requiredPermissions: z.array(z.string()).default([]),
	environmentRestrictions: z.array(z.string()).default([]),
});

export type UsageConstraint = z.output<typeof UsageConstraintSchema>;

export const WidgetCategorySchema = z.enum([
	"analytics",
	"monitoring",
	"navigation",
	"actions",
	"data",
]);

export type WidgetCategory = z.output<typeof WidgetCategorySchema>;

export const WidgetCatalogItemSchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1),
	category: WidgetCategorySchema,
	description: z.string().min(1),
	supportedDataSources: z.array(DataSourceSchema).default([]),
	metricDefinitions: z.array(MetricDefinitionSchema).default([]),
	usageConstraints: UsageConstraintSchema.default({
		maxInstances: 5,
		requiredPermissions: [],
		environmentRestrictions: [],
	}),
});

export type WidgetCatalogItem = z.output<typeof WidgetCatalogItemSchema>;

export const WidgetCatalogSchema = z.object({
	version: z.number().int().positive(),
	items: z.array(WidgetCatalogItemSchema),
});

export type WidgetCatalog = z.output<typeof WidgetCatalogSchema>;

export const WIDGET_CATALOG_VERSION = 1;

export const createEmptyWidgetCatalog = (): WidgetCatalog => ({
	version: WIDGET_CATALOG_VERSION,
	items: [],
});

const sampleWidgets: WidgetCatalogItem[] = [
	{
		id: "cpu",
		name: "CPU Usage Monitor",
		category: "monitoring",
		description: "Real-time CPU utilization percentage with trend analysis",
		supportedDataSources: [{ type: "system-metrics" }],
		metricDefinitions: [
			{
				name: "cpu_usage_percent",
				type: "gauge",
				unit: "%",
			},
		],
	},
	{
		id: "memory",
		name: "Memory Usage Monitor",
		category: "monitoring",
		description: "Current memory allocation with heap/stack breakdown",
		supportedDataSources: [{ type: "system-metrics" }],
		metricDefinitions: [
			{
				name: "memory_used_mb",
				type: "gauge",
				unit: "MB",
			},
			{
				name: "heap_usage_percent",
				type: "gauge",
				unit: "%",
			},
		],
	},
	{
		id: "task-queue",
		name: "Task Queue Status",
		category: "analytics",
		description: "Current pending task count with priority breakdown",
		supportedDataSources: [{ type: "task-storage" }],
		metricDefinitions: [
			{
				name: "pending_count",
				type: "counter",
				unit: "tasks",
			},
			{
				name: "high_priority_pending",
				type: "counter",
				unit: "tasks",
			},
		],
	},
	{
		id: "workflow-flow",
		name: "Workflow Progress Tracker",
		category: "navigation",
		description: "Visual progress indicator for active workflows",
		supportedDataSources: [{ type: "workflow-state" }],
		metricDefinitions: [],
	},
	{
		id: "action-panel",
		name: "Quick Actions Panel",
		category: "actions",
		description: "Common operations with one-click execution",
		supportedDataSources: [],
		metricDefinitions: [],
		usageConstraints: {
			maxInstances: 1,
			requiredPermissions: ["write"],
			environmentRestrictions: ["production"],
		},
	},
];

export const getWidgetCatalog = (): WidgetCatalog => ({
	version: WIDGET_CATALOG_VERSION,
	items: sampleWidgets,
});

type Result =
	| { status: "success"; catalog: WidgetCatalog }
	| { status: "error"; errorCode: string };

export const validateWidgetCatalog = (value: unknown): Result => {
	const result = WidgetCatalogSchema.safeParse(value);

	if (!result.success) {
		return {
			status: "error",
			errorCode: "widget_catalog_invalid_payload",
		};
	}

	return {
		status: "success",
		catalog: result.data,
	};
};

export const serializeWidgetCatalog = (catalog: WidgetCatalog): string => JSON.stringify(catalog);

export const parseWidgetCatalog = (
	raw: string | null,
): {
	status: "missing" | "valid" | "corrupt";
	catalog: WidgetCatalog;
	errorCode: string | null;
} => {
	if (!raw) {
		return { status: "missing", catalog: createEmptyWidgetCatalog(), errorCode: null };
	}

	try {
		const parsed = JSON.parse(raw) as unknown;
		const validated = validateWidgetCatalog(parsed);

		if (validated.status === "error") {
			const errorCode: string = validated.errorCode;
			return {
				status: "corrupt",
				catalog: createEmptyWidgetCatalog(),
				errorCode,
			};
		}

		return { status: "valid", catalog: validated.catalog, errorCode: null };
	} catch {
		return {
			status: "corrupt",
			catalog: createEmptyWidgetCatalog(),
			errorCode: "widget_catalog_parse_error",
		};
	}
};
