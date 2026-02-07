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

export const DashboardPreferencesSchema = z.object({
    defaultView: z.enum(["list", "kanban", "calendar"]),
    itemsPerPage: z.number(),
    showCompleted: z.boolean(),
});

export const UserPreferencesSchema = z.object({
    theme: z.enum(["light", "dark", "auto"]),
    notifications: NotificationPreferencesSchema,
    dashboard: DashboardPreferencesSchema,
});

export type UserPreferences = z.output<typeof UserPreferencesSchema>;

export const UserProfileRecordSchema = z.object({
    userId: z.string(),
    profile: UserProfileDetailsSchema,
    preferences: UserPreferencesSchema,
    createdAt: z.date(),
    updatedAt: z.date(),
});

export type UserProfileRecord = z.output<typeof UserProfileRecordSchema>;

const UserPreferencesUpdateSchema = z.object({
    theme: z.enum(["light", "dark", "auto"]).optional(),
    notifications: NotificationPreferencesSchema.partial().optional(),
    dashboard: DashboardPreferencesSchema.partial().optional(),
});

export const UserProfileSeedSchema = z.object({
    profile: UserProfileDetailsSchema.partial().optional(),
    preferences: UserPreferencesUpdateSchema.optional(),
});

export const UpsertUserProfileInputSchema = z.object({
    userId: z.string(),
    profile: UserProfileDetailsSchema.partial().optional(),
    preferences: UserPreferencesUpdateSchema.optional(),
});

export type UserProfileSeed = z.output<typeof UserProfileSeedSchema>;
export type UpsertUserProfileInput = z.output<typeof UpsertUserProfileInputSchema>;

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
    dashboard: {
        defaultView: "list",
        itemsPerPage: 25,
        showCompleted: false,
    },
});
