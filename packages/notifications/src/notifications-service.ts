import { randomUUID } from "node:crypto";
import { Level } from "level";
import type { Task } from "@isomorphiq/tasks";
import {
    createDefaultNotificationPreferences,
    type DeliveryAttempt,
    type ListOutboxInput,
    type NotificationChannel,
    type NotificationData,
    type NotificationEventType,
    type NotificationPriority,
    type NotificationHistoryEntry,
    type NotificationPreferences,
    type NotificationStats,
    type OutboxMessageRecord,
    type SendNotificationInput,
    type TaskSummary,
    DeliveryAttemptSchema,
    ListOutboxInputSchema,
    NotifyDependencySatisfiedInputSchema,
    NotifyMentionInputSchema,
    NotifyTaskCompletedInputSchema,
    NotifyTaskStatusChangedInputSchema,
    NotificationDataSchema,
    NotificationEventTypeSchema,
    NotificationPreferencesSchema,
    NotificationPrioritySchema,
    OutboxMessageRecordSchema,
    SendDigestInputSchema,
    SendNotificationInputSchema,
    TaskSummarySchema,
} from "./notifications-domain.ts";

export type NotificationsServiceOptions = {
    outboxPath: string;
    preferencesPath: string;
    processingIntervalMs?: number;
    batchSize?: number;
    maxRetries?: number;
    retryDelayMs?: number;
};

const channelRequiresAddress = (channel: NotificationChannel): boolean =>
    ["email", "sms", "slack", "teams", "webhook"].includes(channel);

const hasChannelConfiguration = (
    preferences: NotificationPreferences,
    channel: NotificationChannel,
): boolean => {
    if (channel === "email") {
        return preferences.channels.email.address.trim().length > 0;
    }
    if (channel === "sms") {
        return preferences.channels.sms.phoneNumber.trim().length > 0;
    }
    if (channel === "slack") {
        return (
            preferences.channels.slack.webhookUrl.trim().length > 0
            && preferences.channels.slack.channel.trim().length > 0
        );
    }
    if (channel === "teams") {
        return preferences.channels.teams.webhookUrl.trim().length > 0;
    }
    if (channel === "webhook") {
        return preferences.channels.webhook.url.trim().length > 0;
    }
    return true;
};

const toTaskSummary = (task: Task | TaskSummary): TaskSummary => {
    const normalized = TaskSummarySchema.parse(task) as TaskSummary;
    return normalized;
};

const normalizeOutbox = (value: unknown): OutboxMessageRecord =>
    OutboxMessageRecordSchema.parse(value) as OutboxMessageRecord;

const normalizeDeliveryAttempt = (value: unknown): DeliveryAttempt =>
    DeliveryAttemptSchema.parse(value) as DeliveryAttempt;

const normalizePreferences = (value: unknown): NotificationPreferences =>
    NotificationPreferencesSchema.parse(value) as NotificationPreferences;

const normalizeListInput = (input: ListOutboxInput | undefined): ListOutboxInput =>
    ListOutboxInputSchema.parse(input ?? {});

const mapTaskPriority = (priority: string): NotificationPriority => {
    const parsed = NotificationPrioritySchema.safeParse(priority);
    if (parsed.success) {
        return parsed.data;
    }
    if (priority === "high") {
        return "high";
    }
    if (priority === "low") {
        return "low";
    }
    return "medium";
};

const withinQuietHours = (preferences: NotificationPreferences): boolean => {
    if (!preferences.quietHours) {
        return false;
    }
    const quietHours = preferences.quietHours;
    const now = new Date();
    const parseMinutes = (value: string): number => {
        const [hourRaw, minuteRaw] = value.split(":");
        const hour = Number.parseInt(hourRaw ?? "0", 10);
        const minute = Number.parseInt(minuteRaw ?? "0", 10);
        return (Number.isFinite(hour) ? hour : 0) * 60 + (Number.isFinite(minute) ? minute : 0);
    };

    const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: quietHours.timezone,
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
    });
    const parts = formatter.formatToParts(now);
    const hourPart = parts.find((part) => part.type === "hour")?.value ?? "0";
    const minutePart = parts.find((part) => part.type === "minute")?.value ?? "0";
    const currentMinutes = Number.parseInt(hourPart, 10) * 60 + Number.parseInt(minutePart, 10);
    const startMinutes = parseMinutes(quietHours.start);
    const endMinutes = parseMinutes(quietHours.end);

    if (startMinutes <= endMinutes) {
        return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
    }
    return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
};

const readNotificationEventType = (eventType: string): NotificationEventType => {
    const parsed = NotificationEventTypeSchema.safeParse(eventType);
    if (parsed.success) {
        return parsed.data;
    }
    return "task_status_changed";
};

const readDate = (value: Date | string | undefined): Date | undefined => {
    if (!value) {
        return undefined;
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return undefined;
    }
    return parsed;
};

export class NotificationsService {
    private readonly outboxDb: Level<string, OutboxMessageRecord>;
    private readonly preferencesDb: Level<string, NotificationPreferences>;
    private readonly processingIntervalMs: number;
    private readonly batchSize: number;
    private readonly maxRetries: number;
    private readonly retryDelayMs: number;
    private started = false;
    private processing = false;
    private intervalHandle: NodeJS.Timeout | null = null;

    constructor(options: NotificationsServiceOptions) {
        this.outboxDb = new Level<string, OutboxMessageRecord>(options.outboxPath, {
            valueEncoding: "json",
        });
        this.preferencesDb = new Level<string, NotificationPreferences>(options.preferencesPath, {
            valueEncoding: "json",
        });
        this.processingIntervalMs = options.processingIntervalMs ?? 1000;
        this.batchSize = options.batchSize ?? 20;
        this.maxRetries = options.maxRetries ?? 3;
        this.retryDelayMs = options.retryDelayMs ?? 5_000;
    }

    public async open(): Promise<void> {
        if (this.started) {
            return;
        }
        await this.outboxDb.open();
        await this.preferencesDb.open();
        this.started = true;
        this.startLoop();
    }

    public async close(): Promise<void> {
        if (!this.started) {
            return;
        }
        if (this.intervalHandle) {
            clearInterval(this.intervalHandle);
            this.intervalHandle = null;
        }
        await this.outboxDb.close();
        await this.preferencesDb.close();
        this.started = false;
    }

    private async ensureOpen(): Promise<void> {
        if (!this.started) {
            await this.open();
        }
    }

    private startLoop(): void {
        if (this.intervalHandle) {
            clearInterval(this.intervalHandle);
        }
        this.intervalHandle = setInterval(() => {
            void this.processOutbox().catch((error) => {
                console.error("[NOTIFICATIONS] Outbox processing failed:", error);
            });
        }, this.processingIntervalMs);
        this.intervalHandle.unref();
    }

    public async sendNotification(input: SendNotificationInput): Promise<{ notificationId: string }> {
        await this.ensureOpen();
        const payload = SendNotificationInputSchema.parse(input) as SendNotificationInput;
        const now = new Date();
        const notificationId = `notif-${randomUUID()}`;
        const notification: NotificationData = NotificationDataSchema.parse({
            ...payload,
            id: notificationId,
            timestamp: now,
        }) as NotificationData;
        const record: OutboxMessageRecord = OutboxMessageRecordSchema.parse({
            id: notificationId,
            notification,
            status: "pending",
            attempts: 0,
            createdAt: now,
            updatedAt: now,
            readByUserIds: [],
            deliveries: [],
        }) as OutboxMessageRecord;

        await this.outboxDb.put(record.id, record);
        return {
            notificationId,
        };
    }

    public async setUserPreferences(preferences: NotificationPreferences): Promise<{ updated: boolean }> {
        await this.ensureOpen();
        const validated = normalizePreferences(preferences);
        await this.preferencesDb.put(validated.userId, validated);
        return {
            updated: true,
        };
    }

    public async getUserPreferences(userId: string): Promise<NotificationPreferences | null> {
        await this.ensureOpen();
        try {
            const value = await this.preferencesDb.get(userId);
            return normalizePreferences(value);
        } catch {
            return null;
        }
    }

    private async resolvePreferences(userId: string): Promise<NotificationPreferences> {
        const existing = await this.getUserPreferences(userId);
        if (existing) {
            return existing;
        }
        const created = createDefaultNotificationPreferences(userId);
        await this.preferencesDb.put(userId, created);
        return created;
    }

    private shouldSendOnChannel = (
        preferences: NotificationPreferences,
        channel: NotificationChannel,
        eventType: NotificationEventType,
    ): boolean => {
        if (!preferences.enabled) {
            return false;
        }
        if (withinQuietHours(preferences)) {
            return false;
        }
        const channelConfig = preferences.channels[channel];
        if (!channelConfig.enabled) {
            return false;
        }
        if (!channelConfig.events.includes(eventType)) {
            return false;
        }
        if (channelRequiresAddress(channel) && !hasChannelConfiguration(preferences, channel)) {
            return false;
        }
        return true;
    };

    private async deliverToChannel(
        record: OutboxMessageRecord,
        recipient: string,
        channel: NotificationChannel,
    ): Promise<DeliveryAttempt> {
        const now = new Date();
        const providerMessageId = `${channel}-${randomUUID()}`;

        if (channel === "webhook") {
            const preferences = await this.resolvePreferences(recipient);
            const webhookUrl = preferences.channels.webhook.url;
            if (!webhookUrl || webhookUrl.trim().length === 0) {
                return normalizeDeliveryAttempt({
                    id: `delivery-${randomUUID()}`,
                    notificationId: record.id,
                    recipient,
                    channel,
                    success: false,
                    error: "Webhook URL missing",
                    attemptedAt: now,
                });
            }

            try {
                const response = await fetch(webhookUrl, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "User-Agent": "Isomorphiq-Notifications/1.0",
                    },
                    body: JSON.stringify({
                        notification: record.notification,
                        recipient,
                        attemptedAt: now.toISOString(),
                    }),
                });
                if (!response.ok) {
                    return normalizeDeliveryAttempt({
                        id: `delivery-${randomUUID()}`,
                        notificationId: record.id,
                        recipient,
                        channel,
                        success: false,
                        error: `Webhook delivery failed with status ${response.status}`,
                        attemptedAt: now,
                    });
                }
            } catch (error) {
                return normalizeDeliveryAttempt({
                    id: `delivery-${randomUUID()}`,
                    notificationId: record.id,
                    recipient,
                    channel,
                    success: false,
                    error: error instanceof Error ? error.message : "Webhook delivery failed",
                    attemptedAt: now,
                });
            }
        }

        return normalizeDeliveryAttempt({
            id: `delivery-${randomUUID()}`,
            notificationId: record.id,
            recipient,
            channel,
            success: true,
            providerMessageId,
            attemptedAt: now,
        });
    }

    private readEligibleChannels = async (
        notification: NotificationData,
        recipient: string,
    ): Promise<NotificationChannel[]> => {
        const preferences = await this.resolvePreferences(recipient);
        return notification.channels.filter((channel) =>
            this.shouldSendOnChannel(preferences, channel, notification.type),
        );
    };

    private processPendingRecord = async (
        record: OutboxMessageRecord,
    ): Promise<OutboxMessageRecord> => {
        const now = new Date();
        const processingRecord: OutboxMessageRecord = {
            ...record,
            status: "processing",
            updatedAt: now,
        };
        await this.outboxDb.put(record.id, processingRecord);

        const recipients = record.notification.recipients;
        const deliveryResults = await Promise.all(
            recipients.map(async (recipient) => {
                const channels = await this.readEligibleChannels(record.notification, recipient);
                if (channels.length === 0) {
                    return [] as DeliveryAttempt[];
                }
                const attempts = await Promise.all(
                    channels.map((channel) => this.deliverToChannel(record, recipient, channel)),
                );
                return attempts;
            }),
        );

        const flattened = deliveryResults.flat();
        const failures = flattened.filter((attempt) => !attempt.success);
        const hasFailures = failures.length > 0;
        const attempts = record.attempts + 1;
        const shouldRetry = hasFailures && attempts < this.maxRetries;

        const updatedRecord: OutboxMessageRecord = {
            ...processingRecord,
            status: shouldRetry ? "pending" : hasFailures ? "failed" : "sent",
            attempts,
            updatedAt: new Date(),
            deliveries: [...record.deliveries, ...flattened],
            lastError: hasFailures ? failures[0]?.error ?? "Delivery failed" : undefined,
            sentAt: hasFailures ? record.sentAt : new Date(),
            failedAt: hasFailures && !shouldRetry ? new Date() : undefined,
            nextAttemptAt: shouldRetry ? new Date(Date.now() + this.retryDelayMs) : undefined,
        };

        await this.outboxDb.put(updatedRecord.id, updatedRecord);
        return updatedRecord;
    };

    public async processOutbox(): Promise<{ processed: number }> {
        await this.ensureOpen();
        if (this.processing) {
            return { processed: 0 };
        }

        this.processing = true;
        try {
            const now = new Date();
            const all = await this.listOutbox({ limit: 1000 });
            const pending = all
                .filter((entry) => entry.status === "pending")
                .filter((entry) => {
                    const nextAttemptAt = readDate(entry.nextAttemptAt);
                    if (!nextAttemptAt) {
                        return true;
                    }
                    return nextAttemptAt.getTime() <= now.getTime();
                })
                .slice(0, this.batchSize);

            await Promise.all(pending.map((entry) => this.processPendingRecord(entry)));
            return {
                processed: pending.length,
            };
        } finally {
            this.processing = false;
        }
    }

    public async listOutbox(input?: ListOutboxInput): Promise<OutboxMessageRecord[]> {
        await this.ensureOpen();
        const filter = normalizeListInput(input);
        const limit = filter.limit ?? 100;
        const values: OutboxMessageRecord[] = [];

        for await (const [, value] of this.outboxDb.iterator()) {
            const record = normalizeOutbox(value);
            values.push(record);
        }

        const withStatus = filter.status
            ? values.filter((record) => record.status === filter.status)
            : values;
        const withRecipient = filter.recipientId
            ? withStatus.filter((record) => record.notification.recipients.includes(filter.recipientId))
            : withStatus;

        return withRecipient
            .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
            .slice(0, limit);
    }

    public async getOutboxMessage(id: string): Promise<OutboxMessageRecord | null> {
        await this.ensureOpen();
        try {
            const value = await this.outboxDb.get(id);
            return normalizeOutbox(value);
        } catch {
            return null;
        }
    }

    public async getNotificationHistory(
        userId?: string,
        limit?: number,
    ): Promise<NotificationHistoryEntry[]> {
        const outbox = await this.listOutbox({ limit: 1000 });
        const history = outbox
            .flatMap((record) =>
                record.deliveries.map((delivery) => ({
                    id: delivery.id,
                    notificationId: record.id,
                    userId: delivery.recipient,
                    channel: delivery.channel,
                    type: record.notification.type,
                    delivered: delivery.success,
                    read: record.readByUserIds.includes(delivery.recipient),
                    timestamp: delivery.attemptedAt,
                    error: delivery.error,
                })),
            )
            .filter((entry) => (userId ? entry.userId === userId : true))
            .sort((left, right) => right.timestamp.getTime() - left.timestamp.getTime());

        if (!limit || limit <= 0) {
            return history;
        }
        return history.slice(0, limit);
    }

    public async markNotificationAsRead(
        notificationId: string,
        userId: string,
    ): Promise<boolean> {
        const existing = await this.getOutboxMessage(notificationId);
        if (!existing) {
            return false;
        }
        const readBy = existing.readByUserIds.includes(userId)
            ? existing.readByUserIds
            : [...existing.readByUserIds, userId];
        const updated: OutboxMessageRecord = {
            ...existing,
            readByUserIds: readBy,
            updatedAt: new Date(),
        };
        await this.outboxDb.put(existing.id, updated);
        return true;
    }

    public async getNotificationStats(userId?: string): Promise<NotificationStats> {
        const outbox = await this.listOutbox({
            limit: 1000,
            ...(userId ? { recipientId: userId } : {}),
        });
        const relevantDeliveries = outbox.flatMap((record) =>
            record.deliveries.filter((delivery) => (userId ? delivery.recipient === userId : true)),
        );

        return {
            total: outbox.length,
            pending: outbox.filter((record) => record.status === "pending").length,
            sent: outbox.filter((record) => record.status === "sent").length,
            failed: outbox.filter((record) => record.status === "failed").length,
            deliveredAttempts: relevantDeliveries.filter((delivery) => delivery.success).length,
            failedAttempts: relevantDeliveries.filter((delivery) => !delivery.success).length,
        };
    }

    public async notifyTaskStatusChanged(input: unknown): Promise<{ notificationId: string }> {
        const parsed = NotifyTaskStatusChangedInputSchema.parse(input);
        const task = toTaskSummary(parsed.task);
        return this.sendNotification({
            type: "task_status_changed",
            priority: mapTaskPriority(task.priority),
            title: `Task status changed: ${task.title}`,
            message: `Task \"${task.title}\" changed from ${parsed.oldStatus} to ${parsed.newStatus}`,
            recipients: parsed.recipients,
            channels: ["email", "slack", "teams", "websocket"],
            data: {
                task,
                oldStatus: parsed.oldStatus,
                newStatus: parsed.newStatus,
            },
            metadata: {
                taskId: task.id,
                oldStatus: parsed.oldStatus,
                newStatus: parsed.newStatus,
            },
        });
    }

    public async notifyTaskCompleted(input: unknown): Promise<{ notificationId: string }> {
        const parsed = NotifyTaskCompletedInputSchema.parse(input);
        const task = toTaskSummary(parsed.task);
        return this.sendNotification({
            type: "task_completed",
            priority: mapTaskPriority(task.priority),
            title: `Task completed: ${task.title}`,
            message: `Task \"${task.title}\" was completed.`,
            recipients: parsed.recipients,
            channels: ["email", "slack", "teams", "websocket"],
            data: { task },
            metadata: { taskId: task.id },
        });
    }

    public async notifyMention(input: unknown): Promise<{ notificationId: string }> {
        const parsed = NotifyMentionInputSchema.parse(input);
        const task = toTaskSummary(parsed.task);
        return this.sendNotification({
            type: "mention",
            priority: "medium",
            title: `You were mentioned in ${task.title}`,
            message: `${parsed.mentionedBy} mentioned you in task \"${task.title}\".`,
            recipients: parsed.mentionedUsers,
            channels: ["email", "slack", "teams", "websocket"],
            data: { task },
            metadata: {
                taskId: task.id,
                mentionedBy: parsed.mentionedBy,
                mentionedUsers: parsed.mentionedUsers,
            },
        });
    }

    public async notifyDependencySatisfied(input: unknown): Promise<{ notificationId: string }> {
        const parsed = NotifyDependencySatisfiedInputSchema.parse(input);
        return this.sendNotification({
            type: "dependency_satisfied",
            priority: "medium",
            title: "Dependency satisfied",
            message: `Dependency ${parsed.taskId} has been satisfied for task ${parsed.dependentTaskId}.`,
            recipients: parsed.recipients,
            channels: ["email", "slack", "teams", "websocket"],
            metadata: {
                taskId: parsed.taskId,
                dependentTaskId: parsed.dependentTaskId,
            },
        });
    }

    public async sendDailyDigest(input: unknown): Promise<{ notificationId: string }> {
        const parsed = SendDigestInputSchema.parse(input);
        return this.sendNotification({
            type: "digest",
            priority: "low",
            title: "Daily task digest",
            message: `Daily digest with ${parsed.tasks.length} tasks.`,
            recipients: [parsed.userId],
            channels: ["email", "websocket"],
            data: {
                tasks: parsed.tasks,
                digestType: "daily",
            },
        });
    }

    public async sendWeeklyDigest(input: unknown): Promise<{ notificationId: string }> {
        const parsed = SendDigestInputSchema.parse(input);
        return this.sendNotification({
            type: "digest",
            priority: "low",
            title: "Weekly task digest",
            message: `Weekly digest with ${parsed.tasks.length} tasks.`,
            recipients: [parsed.userId],
            channels: ["email", "websocket"],
            data: {
                tasks: parsed.tasks,
                digestType: "weekly",
            },
        });
    }

    public async queueRawNotification(input: unknown): Promise<{ notificationId: string }> {
        const parsed = SendNotificationInputSchema.parse(input);
        return this.sendNotification(parsed);
    }

    public async queueEventNotification(input: {
        eventType: string;
        priority?: string;
        title: string;
        message: string;
        recipients: string[];
        channels?: string[];
        data?: Record<string, unknown>;
        metadata?: Record<string, unknown>;
    }): Promise<{ notificationId: string }> {
        const eventType = readNotificationEventType(input.eventType);
        const priorityResult = NotificationPrioritySchema.safeParse(input.priority ?? "medium");
        const priority = priorityResult.success ? priorityResult.data : "medium";
        const channels = (input.channels ?? ["websocket"]).filter((channel): channel is NotificationChannel => {
            return ["email", "sms", "slack", "teams", "websocket", "webhook"].includes(channel);
        });

        return this.sendNotification({
            type: eventType,
            priority,
            title: input.title,
            message: input.message,
            recipients: input.recipients,
            channels: channels.length > 0 ? channels : ["websocket"],
            data: input.data,
            metadata: input.metadata,
        });
    }
}
