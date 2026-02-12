// FILE_CONTEXT: "context-832cc645-25e5-4a6f-a8c4-d1b8e3aad7d7"

import { z } from "zod";

export const UserProfileDetailsSchema = z.object({
    name: z.string().optional(),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    avatar: z.string().optional(),
    bio: z.string().optional(),
    timezone: z.string().optional(),
    language: z.string().optional(),
});

export type UserProfileDetails = z.output<typeof UserProfileDetailsSchema>;

export const NotificationPreferencesSchema = z.object({
    email: z.boolean(),
    push: z.boolean(),
    taskAssigned: z.boolean(),
    taskCompleted: z.boolean(),
    taskOverdue: z.boolean(),
});

export const DashboardDefaultViewSchema = z.enum([
    "overview",
    "widgets",
    "queue",
    "tasks",
    "create",
    "history",
    "health",
    "logs",
    "list",
    "kanban",
    "calendar",
]);

export const DashboardRefreshRateSchema = z.enum(["off", "30s", "1m", "5m"]);

export const DashboardLayoutDensitySchema = z.enum(["compact", "comfortable", "spacious"]);

export const DashboardNotificationTypeSchema = z.enum([
    "task_created",
    "task_status_changed",
    "task_priority_changed",
    "task_completed",
    "task_failed",
    "task_deleted",
]);

const DashboardNotificationTypesSchema = z.object({
    task_created: z.boolean(),
    task_status_changed: z.boolean(),
    task_priority_changed: z.boolean(),
    task_completed: z.boolean(),
    task_failed: z.boolean(),
    task_deleted: z.boolean(),
});

export type DashboardNotificationTypes = z.output<typeof DashboardNotificationTypesSchema>;

const buildDefaultNotificationTypes = (): DashboardNotificationTypes => ({
    task_created: true,
    task_status_changed: true,
    task_priority_changed: true,
    task_completed: true,
    task_failed: true,
    task_deleted: true,
});

const normalizeNotificationTypes = (value: unknown): DashboardNotificationTypes => {
    if (!value || typeof value !== "object") {
        return buildDefaultNotificationTypes();
    }
    const record = Object.entries(value).reduce<Record<string, unknown>>(
        (acc, [key, entry]) => ({ ...acc, [key]: entry }),
        {},
    );
    const defaults = buildDefaultNotificationTypes();
    return Object.entries(defaults).reduce(
        (acc, [key, defaultValue]) => {
            const entry = record[key];
            return {
                ...acc,
                [key]: typeof entry === "boolean" ? entry : defaultValue,
            };
        },
        defaults,
    );
};

const DashboardWidgetNotificationPreferenceSchemaBase = z.object({
    enabled: z.boolean(),
    types: DashboardNotificationTypesSchema,
});

export type DashboardWidgetNotificationPreference = z.output<typeof DashboardWidgetNotificationPreferenceSchemaBase>;

const normalizeWidgetNotificationPreference = (
    value: unknown,
): DashboardWidgetNotificationPreference => {
    if (typeof value === "boolean") {
        return {
            enabled: value,
            types: buildDefaultNotificationTypes(),
        };
    }
    if (!value || typeof value !== "object") {
        return {
            enabled: true,
            types: buildDefaultNotificationTypes(),
        };
    }
    const record = Object.entries(value).reduce<Record<string, unknown>>(
        (acc, [key, entry]) => ({ ...acc, [key]: entry }),
        {},
    );
    const enabled = typeof record.enabled === "boolean" ? record.enabled : true;
    const types = normalizeNotificationTypes(record.types);
    return { enabled, types };
};

const DashboardWidgetNotificationPreferencesSchema = z.preprocess(
    (value) => {
        if (!value || typeof value !== "object") {
            return {};
        }
        return Object.entries(value).reduce<Record<string, unknown>>(
            (acc, [key, entry]) => ({
                ...acc,
                [key]: normalizeWidgetNotificationPreference(entry),
            }),
            {},
        );
    },
    z.record(DashboardWidgetNotificationPreferenceSchemaBase),
);

const DashboardWidgetLayoutStateSchema = z.record(z.array(z.string().min(1)));

const DashboardWidgetLayoutPayloadSchema = z.object({
    layout: DashboardWidgetLayoutStateSchema,
    updatedAt: z.number().int().nonnegative().optional(),
    version: z.number().int().positive().optional(),
});

const DashboardWidgetLayoutPreferenceSchema = z.union([
    DashboardWidgetLayoutPayloadSchema,
    DashboardWidgetLayoutStateSchema,
    z.object({ widgetLayout: DashboardWidgetLayoutStateSchema }).passthrough(),
]);

const DashboardPreferencesSchemaBase = z.object({
    defaultView: DashboardDefaultViewSchema,
    refreshRate: DashboardRefreshRateSchema,
    layoutDensity: DashboardLayoutDensitySchema,
    widgetNotifications: DashboardWidgetNotificationPreferencesSchema,
    widgetLayout: DashboardWidgetLayoutPreferenceSchema.nullable().optional(),
    itemsPerPage: z.number().int().positive(),
    showCompleted: z.boolean(),
});

export type DashboardPreferences = z.output<typeof DashboardPreferencesSchemaBase>;

const dashboardDefaults: DashboardPreferences = {
    defaultView: "overview",
    refreshRate: "30s",
    layoutDensity: "comfortable",
    widgetNotifications: {},
    widgetLayout: undefined,
    itemsPerPage: 25,
    showCompleted: false,
};

const buildDashboardDefaults = (): DashboardPreferences => ({
    ...dashboardDefaults,
    widgetNotifications: { ...dashboardDefaults.widgetNotifications },
});

const normalizeDashboardPreferences = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== "object") {
        return buildDashboardDefaults();
    }

    return Object.entries(value).reduce<Record<string, unknown>>(
        (acc, [key, entryValue]) => ({ ...acc, [key]: entryValue }),
        buildDashboardDefaults(),
    );
};

export const DashboardPreferencesSchema = z.preprocess(
    normalizeDashboardPreferences,
    DashboardPreferencesSchemaBase,
);

export const defaultDashboardPreferences = (): DashboardPreferences => buildDashboardDefaults();

export const UserPreferencesSchema = z.object({
    theme: z.enum(["light", "dark", "auto"]),
    notifications: NotificationPreferencesSchema,
    dashboard: DashboardPreferencesSchema,
});

export type UserPreferences = z.output<typeof UserPreferencesSchema>;

const PreferencesSyncMetadataSchemaBase = z.object({
    updatedAt: z.number().int().nonnegative(),
    deviceId: z.string().optional(),
    source: z.string().optional(),
});

export const PreferencesSyncMetadataSchema = z.preprocess(
    (value) => {
        if (!value || typeof value !== "object") {
            return { updatedAt: 0 };
        }
        const record = Object.entries(value).reduce<Record<string, unknown>>(
            (acc, [key, entry]) => ({ ...acc, [key]: entry }),
            {},
        );
        const updatedAt =
            typeof record.updatedAt === "number" && record.updatedAt >= 0 ? record.updatedAt : 0;
        const deviceId =
            typeof record.deviceId === "string" && record.deviceId.trim().length > 0
                ? record.deviceId
                : undefined;
        const source =
            typeof record.source === "string" && record.source.trim().length > 0
                ? record.source
                : undefined;
        return {
            updatedAt,
            ...(deviceId ? { deviceId } : {}),
            ...(source ? { source } : {}),
        };
    },
    PreferencesSyncMetadataSchemaBase,
);

export type PreferencesSyncMetadata = z.output<typeof PreferencesSyncMetadataSchema>;

export const UserProfileRecordSchema = z.object({
    userId: z.string(),
    profile: UserProfileDetailsSchema,
    preferences: UserPreferencesSchema,
    preferencesSync: PreferencesSyncMetadataSchema,
    createdAt: z.date(),
    updatedAt: z.date(),
});

export type UserProfileRecord = z.output<typeof UserProfileRecordSchema>;

const UserPreferencesUpdateSchema = z.object({
    theme: z.enum(["light", "dark", "auto"]).optional(),
    notifications: NotificationPreferencesSchema.partial().optional(),
    dashboard: DashboardPreferencesSchemaBase.partial().optional(),
});

export const UserProfileSeedSchema = z.object({
    profile: UserProfileDetailsSchema.partial().optional(),
    preferences: UserPreferencesUpdateSchema.optional(),
    preferencesSync: PreferencesSyncMetadataSchema.optional(),
});

export const UpsertUserProfileInputSchema = z.object({
    userId: z.string(),
    profile: UserProfileDetailsSchema.partial().optional(),
    preferences: UserPreferencesUpdateSchema.optional(),
    preferencesSync: PreferencesSyncMetadataSchema.optional(),
});

export type UserProfileSeed = z.output<typeof UserProfileSeedSchema>;
export type UpsertUserProfileInput = z.output<typeof UpsertUserProfileInputSchema>;

export const UserPreferencesExportSchema = z.object({
    version: z.number().int().positive(),
    exportedAt: z.number().int().nonnegative(),
    preferences: UserPreferencesSchema,
    preferencesSync: PreferencesSyncMetadataSchema,
});

export type UserPreferencesExport = z.output<typeof UserPreferencesExportSchema>;

export const defaultUserProfileDetails = (): UserProfileDetails => ({
    name: "",
    firstName: "",
    lastName: "",
    avatar: "",
    bio: "",
    timezone: "UTC",
    language: "en",
});

export const defaultUserPreferences = (): UserPreferences => ({
    theme: "auto",
    notifications: {
        email: true,
        push: false,
        taskAssigned: true,
        taskCompleted: true,
        taskOverdue: true,
    },
    dashboard: defaultDashboardPreferences(),
});
