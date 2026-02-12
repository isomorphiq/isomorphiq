import type {
    ListOutboxInput,
    NotificationHistoryEntry,
    NotificationStats,
    OutboxMessageRecord,
    SendDigestInput,
    SendNotificationInput,
    TaskSummary,
} from "./notifications-domain.ts";
import {
    createNotificationsClient,
    type NotificationsClient,
    type NotificationsClientOptions,
} from "./notifications-client.ts";

const isNotificationsClient = (
    value: NotificationsClient | NotificationsClientOptions | undefined,
): value is NotificationsClient =>
    Boolean(value)
    && typeof (value as NotificationsClient).sendNotification === "function";

const resolveClient = (
    clientOrOptions?: NotificationsClient | NotificationsClientOptions,
): NotificationsClient => {
    if (isNotificationsClient(clientOrOptions)) {
        return clientOrOptions;
    }
    return createNotificationsClient(clientOrOptions);
};

export const queueNotification = async (
    input: SendNotificationInput,
    clientOrOptions?: NotificationsClient | NotificationsClientOptions,
): Promise<{ notificationId: string }> => {
    const client = resolveClient(clientOrOptions);
    return client.sendNotification(input);
};

export const notifyTaskStatusChanged = async (
    input: {
        task: TaskSummary;
        oldStatus: string;
        newStatus: string;
        recipients: string[];
    },
    clientOrOptions?: NotificationsClient | NotificationsClientOptions,
): Promise<{ notificationId: string }> => {
    const client = resolveClient(clientOrOptions);
    return client.notifyTaskStatusChanged(input);
};

export const notifyTaskCompleted = async (
    input: {
        task: TaskSummary;
        recipients: string[];
    },
    clientOrOptions?: NotificationsClient | NotificationsClientOptions,
): Promise<{ notificationId: string }> => {
    const client = resolveClient(clientOrOptions);
    return client.notifyTaskCompleted(input);
};

export const notifyMention = async (
    input: {
        task: TaskSummary;
        mentionedUsers: string[];
        mentionedBy: string;
    },
    clientOrOptions?: NotificationsClient | NotificationsClientOptions,
): Promise<{ notificationId: string }> => {
    const client = resolveClient(clientOrOptions);
    return client.notifyMention(input);
};

export const notifyDependencySatisfied = async (
    input: {
        taskId: string;
        dependentTaskId: string;
        recipients: string[];
    },
    clientOrOptions?: NotificationsClient | NotificationsClientOptions,
): Promise<{ notificationId: string }> => {
    const client = resolveClient(clientOrOptions);
    return client.notifyDependencySatisfied(input);
};

export const sendDailyDigest = async (
    input: SendDigestInput,
    clientOrOptions?: NotificationsClient | NotificationsClientOptions,
): Promise<{ notificationId: string }> => {
    const client = resolveClient(clientOrOptions);
    return client.sendDailyDigest(input);
};

export const sendWeeklyDigest = async (
    input: SendDigestInput,
    clientOrOptions?: NotificationsClient | NotificationsClientOptions,
): Promise<{ notificationId: string }> => {
    const client = resolveClient(clientOrOptions);
    return client.sendWeeklyDigest(input);
};

export const listOutgoingMessages = async (
    input?: ListOutboxInput,
    clientOrOptions?: NotificationsClient | NotificationsClientOptions,
): Promise<OutboxMessageRecord[]> => {
    const client = resolveClient(clientOrOptions);
    return client.listOutbox(input);
};

export const listPendingOutgoingMessages = async (
    limit?: number,
    clientOrOptions?: NotificationsClient | NotificationsClientOptions,
): Promise<OutboxMessageRecord[]> => {
    const client = resolveClient(clientOrOptions);
    return client.listPendingOutbox(limit);
};

export const listSentOutgoingMessages = async (
    limit?: number,
    clientOrOptions?: NotificationsClient | NotificationsClientOptions,
): Promise<OutboxMessageRecord[]> => {
    const client = resolveClient(clientOrOptions);
    return client.listSentOutbox(limit);
};

export const listNotificationHistory = async (
    input?: { userId?: string; limit?: number },
    clientOrOptions?: NotificationsClient | NotificationsClientOptions,
): Promise<NotificationHistoryEntry[]> => {
    const client = resolveClient(clientOrOptions);
    return client.getNotificationHistory(input);
};

export const getNotificationStats = async (
    userId?: string,
    clientOrOptions?: NotificationsClient | NotificationsClientOptions,
): Promise<NotificationStats> => {
    const client = resolveClient(clientOrOptions);
    return client.getNotificationStats(userId);
};

export const triggerOutboxProcessing = async (
    clientOrOptions?: NotificationsClient | NotificationsClientOptions,
): Promise<{ processed: number }> => {
    const client = resolveClient(clientOrOptions);
    return client.processOutbox();
};
