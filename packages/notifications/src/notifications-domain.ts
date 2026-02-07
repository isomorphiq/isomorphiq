import { z } from "zod";

export const NotificationChannelSchema = z.enum([
    "email",
    "sms",
    "slack",
    "teams",
    "websocket",
    "webhook",
]);
export type NotificationChannel = z.infer<typeof NotificationChannelSchema>;

export const NotificationPrioritySchema = z.enum(["low", "medium", "high", "urgent"]);
export type NotificationPriority = z.infer<typeof NotificationPrioritySchema>;

export const NotificationEventTypeSchema = z.enum([
    "task_created",
    "task_assigned",
    "task_status_changed",
    "task_priority_changed",
    "task_completed",
    "task_failed",
    "task_cancelled",
    "deadline_approaching",
    "dependency_satisfied",
    "dependency_blocked",
    "dependency_cycle_detected",
    "critical_path_delay",
    "bottleneck_identified",
    "dependency_validation_failed",
    "mention",
    "digest",
]);
export type NotificationEventType = z.infer<typeof NotificationEventTypeSchema>;

const AnyRecordSchema: z.ZodType<Record<string, unknown>> = z.record(z.unknown());

export const NotificationPreferencesSchema = z.object({
    userId: z.string(),
    enabled: z.boolean(),
    channels: z.object({
        email: z.object({
            enabled: z.boolean(),
            address: z.string().default(""),
            events: z.array(NotificationEventTypeSchema),
        }),
        sms: z.object({
            enabled: z.boolean(),
            phoneNumber: z.string().default(""),
            events: z.array(NotificationEventTypeSchema),
        }),
        slack: z.object({
            enabled: z.boolean(),
            webhookUrl: z.string().default(""),
            channel: z.string().default(""),
            events: z.array(NotificationEventTypeSchema),
        }),
        teams: z.object({
            enabled: z.boolean(),
            webhookUrl: z.string().default(""),
            events: z.array(NotificationEventTypeSchema),
        }),
        websocket: z.object({
            enabled: z.boolean(),
            events: z.array(NotificationEventTypeSchema),
        }),
        webhook: z.object({
            enabled: z.boolean(),
            url: z.string().default(""),
            events: z.array(NotificationEventTypeSchema),
        }),
    }),
    quietHours: z
        .object({
            start: z.string(),
            end: z.string(),
            timezone: z.string(),
        })
        .optional(),
    frequency: z.object({
        immediate: z.array(NotificationEventTypeSchema),
        hourly: z.array(NotificationEventTypeSchema),
        daily: z.array(NotificationEventTypeSchema),
        weekly: z.array(NotificationEventTypeSchema),
    }),
});
export type NotificationPreferences = z.infer<typeof NotificationPreferencesSchema>;

export const NotificationDataSchema = z.object({
    id: z.string(),
    type: NotificationEventTypeSchema,
    priority: NotificationPrioritySchema,
    title: z.string(),
    message: z.string(),
    recipients: z.array(z.string()),
    channels: z.array(NotificationChannelSchema),
    data: AnyRecordSchema.optional(),
    metadata: AnyRecordSchema.optional(),
    timestamp: z.coerce.date(),
});
export type NotificationData = z.infer<typeof NotificationDataSchema>;

export const SendNotificationInputSchema = z.object({
    type: NotificationEventTypeSchema,
    priority: NotificationPrioritySchema.default("medium"),
    title: z.string(),
    message: z.string(),
    recipients: z.array(z.string()).default([]),
    channels: z.array(NotificationChannelSchema).default(["websocket"]),
    data: AnyRecordSchema.optional(),
    metadata: AnyRecordSchema.optional(),
});
export type SendNotificationInput = z.infer<typeof SendNotificationInputSchema>;

export const OutboxStatusSchema = z.enum(["pending", "processing", "sent", "failed"]);
export type OutboxStatus = z.infer<typeof OutboxStatusSchema>;

export const DeliveryAttemptSchema = z.object({
    id: z.string(),
    notificationId: z.string(),
    recipient: z.string(),
    channel: NotificationChannelSchema,
    success: z.boolean(),
    error: z.string().optional(),
    providerMessageId: z.string().optional(),
    attemptedAt: z.coerce.date(),
});
export type DeliveryAttempt = z.infer<typeof DeliveryAttemptSchema>;

export const OutboxMessageRecordSchema = z.object({
    id: z.string(),
    notification: NotificationDataSchema,
    status: OutboxStatusSchema,
    attempts: z.number().int().nonnegative(),
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date(),
    nextAttemptAt: z.coerce.date().optional(),
    sentAt: z.coerce.date().optional(),
    failedAt: z.coerce.date().optional(),
    lastError: z.string().optional(),
    readByUserIds: z.array(z.string()),
    deliveries: z.array(DeliveryAttemptSchema),
});
export type OutboxMessageRecord = z.infer<typeof OutboxMessageRecordSchema>;

export const ListOutboxInputSchema = z.object({
    status: OutboxStatusSchema.optional(),
    recipientId: z.string().optional(),
    limit: z.number().int().positive().max(1000).optional(),
});
export type ListOutboxInput = z.infer<typeof ListOutboxInputSchema>;

export const NotificationHistoryEntrySchema = z.object({
    id: z.string(),
    notificationId: z.string(),
    userId: z.string(),
    channel: NotificationChannelSchema,
    type: NotificationEventTypeSchema,
    delivered: z.boolean(),
    read: z.boolean(),
    timestamp: z.coerce.date(),
    error: z.string().optional(),
});
export type NotificationHistoryEntry = z.infer<typeof NotificationHistoryEntrySchema>;

export const NotificationStatsSchema = z.object({
    total: z.number().int().nonnegative(),
    pending: z.number().int().nonnegative(),
    sent: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    deliveredAttempts: z.number().int().nonnegative(),
    failedAttempts: z.number().int().nonnegative(),
});
export type NotificationStats = z.infer<typeof NotificationStatsSchema>;

const allEventTypes = NotificationEventTypeSchema.options as NotificationEventType[];

export const createDefaultNotificationPreferences = (
    userId: string,
): NotificationPreferences => ({
    userId,
    enabled: true,
    channels: {
        email: {
            enabled: true,
            address: "",
            events: [...allEventTypes],
        },
        sms: {
            enabled: false,
            phoneNumber: "",
            events: ["task_failed", "deadline_approaching"],
        },
        slack: {
            enabled: false,
            webhookUrl: "",
            channel: "",
            events: [...allEventTypes],
        },
        teams: {
            enabled: false,
            webhookUrl: "",
            events: [...allEventTypes],
        },
        websocket: {
            enabled: true,
            events: [...allEventTypes],
        },
        webhook: {
            enabled: false,
            url: "",
            events: [...allEventTypes],
        },
    },
    frequency: {
        immediate: [...allEventTypes],
        hourly: [],
        daily: [],
        weekly: [],
    },
});

export const TaskSummarySchema = z.object({
    id: z.string(),
    title: z.string(),
    description: z.string().default(""),
    status: z.string(),
    priority: z.string(),
    createdBy: z.string().optional(),
    assignedTo: z.string().optional(),
    collaborators: z.array(z.string()).optional(),
    watchers: z.array(z.string()).optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type TaskSummary = z.infer<typeof TaskSummarySchema>;

export const NotifyTaskStatusChangedInputSchema = z.object({
    task: TaskSummarySchema,
    oldStatus: z.string(),
    newStatus: z.string(),
    recipients: z.array(z.string()),
});
export type NotifyTaskStatusChangedInput = z.infer<typeof NotifyTaskStatusChangedInputSchema>;

export const NotifyTaskCompletedInputSchema = z.object({
    task: TaskSummarySchema,
    recipients: z.array(z.string()),
});
export type NotifyTaskCompletedInput = z.infer<typeof NotifyTaskCompletedInputSchema>;

export const NotifyMentionInputSchema = z.object({
    task: TaskSummarySchema,
    mentionedUsers: z.array(z.string()),
    mentionedBy: z.string(),
});
export type NotifyMentionInput = z.infer<typeof NotifyMentionInputSchema>;

export const NotifyDependencySatisfiedInputSchema = z.object({
    taskId: z.string(),
    dependentTaskId: z.string(),
    recipients: z.array(z.string()),
});
export type NotifyDependencySatisfiedInput = z.infer<typeof NotifyDependencySatisfiedInputSchema>;

export const SendDigestInputSchema = z.object({
    userId: z.string(),
    tasks: z.array(TaskSummarySchema),
});
export type SendDigestInput = z.infer<typeof SendDigestInputSchema>;
