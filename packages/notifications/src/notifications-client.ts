import { createTRPCClient, httpLink } from "@trpc/client";
import type { Operation, TRPCClient } from "@trpc/client";
import { ConfigManager } from "@isomorphiq/core";
import type {
    ListOutboxInput,
    NotificationHistoryEntry,
    NotificationPreferences,
    NotificationStats,
    OutboxMessageRecord,
    SendDigestInput,
    SendNotificationInput,
    TaskSummary,
} from "./notifications-domain.ts";

type NotificationsServiceRouter = import("./notifications-service-router.ts").NotificationsServiceRouter;

export type NotificationsClientOptions = {
    url?: string;
    environment?: string;
    headers?: Record<string, string>;
};

export type NotificationsClient = {
    sendNotification: (input: SendNotificationInput) => Promise<{ notificationId: string }>;
    notifyTaskStatusChanged: (input: {
        task: TaskSummary;
        oldStatus: string;
        newStatus: string;
        recipients: string[];
    }) => Promise<{ notificationId: string }>;
    notifyTaskCompleted: (input: {
        task: TaskSummary;
        recipients: string[];
    }) => Promise<{ notificationId: string }>;
    notifyMention: (input: {
        task: TaskSummary;
        mentionedUsers: string[];
        mentionedBy: string;
    }) => Promise<{ notificationId: string }>;
    notifyDependencySatisfied: (input: {
        taskId: string;
        dependentTaskId: string;
        recipients: string[];
    }) => Promise<{ notificationId: string }>;
    setUserPreferences: (input: NotificationPreferences) => Promise<{ updated: boolean }>;
    getUserPreferences: (userId: string) => Promise<NotificationPreferences | null>;
    listOutbox: (input?: ListOutboxInput) => Promise<OutboxMessageRecord[]>;
    getOutboxMessage: (id: string) => Promise<OutboxMessageRecord | null>;
    listPendingOutbox: (limit?: number) => Promise<OutboxMessageRecord[]>;
    listSentOutbox: (limit?: number) => Promise<OutboxMessageRecord[]>;
    getNotificationHistory: (input?: {
        userId?: string;
        limit?: number;
    }) => Promise<NotificationHistoryEntry[]>;
    markNotificationRead: (notificationId: string, userId: string) => Promise<{ marked: boolean }>;
    getNotificationStats: (userId?: string) => Promise<NotificationStats>;
    sendDailyDigest: (input: SendDigestInput) => Promise<{ notificationId: string }>;
    sendWeeklyDigest: (input: SendDigestInput) => Promise<{ notificationId: string }>;
    processOutbox: () => Promise<{ processed: number }>;
};

const resolveEnvironmentHeaderName = (): string =>
    ConfigManager.getInstance().getEnvironmentConfig().headerName;

const resolveDefaultEnvironment = (): string =>
    ConfigManager.getInstance().getEnvironmentConfig().default;

const normalizeTrpcUrl = (url: string): string => {
    if (url.includes("/trpc")) {
        return url;
    }
    return `${url.replace(/\/$/, "")}/trpc`;
};

const resolveBaseUrl = (): string => {
    const direct =
        process.env.NOTIFICATIONS_SERVICE_URL
        ?? process.env.NOTIFICATIONS_HTTP_URL;
    if (direct) {
        return direct;
    }
    const host = process.env.NOTIFICATIONS_HOST ?? "127.0.0.1";
    const portRaw =
        process.env.NOTIFICATIONS_HTTP_PORT
        ?? process.env.NOTIFICATIONS_PORT
        ?? "3011";
    const parsed = Number.parseInt(portRaw, 10);
    const port = Number.isFinite(parsed) && parsed > 0 ? parsed : 3011;
    return `http://${host}:${port}`;
};

const buildHeaders = (
    envHeader: string,
    environment: string | undefined,
    baseHeaders: Record<string, string> | undefined,
    op?: Operation,
): Record<string, string> => {
    const contextEnv = (op?.context as { environment?: string } | undefined)?.environment;
    const resolvedEnv = contextEnv ?? environment;
    return {
        ...(baseHeaders ?? {}),
        ...(resolvedEnv ? { [envHeader]: resolvedEnv } : {}),
    };
};

export const createNotificationsClient = (
    options: NotificationsClientOptions = {},
): NotificationsClient => {
    const envHeader = resolveEnvironmentHeaderName();
    const defaultEnvironment = resolveDefaultEnvironment();
    const environment = options.environment ?? defaultEnvironment;
    const baseUrl = normalizeTrpcUrl(options.url ?? resolveBaseUrl());

    const client: TRPCClient<NotificationsServiceRouter> =
        createTRPCClient<NotificationsServiceRouter>({
            links: [
                httpLink({
                    url: baseUrl,
                    headers: (opts) =>
                        buildHeaders(envHeader, environment, options.headers, opts.op),
                }),
            ],
        });

    return {
        sendNotification: async (input) => client.sendNotification.mutate(input),
        notifyTaskStatusChanged: async (input) =>
            client.notifyTaskStatusChanged.mutate(input),
        notifyTaskCompleted: async (input) => client.notifyTaskCompleted.mutate(input),
        notifyMention: async (input) => client.notifyMention.mutate(input),
        notifyDependencySatisfied: async (input) =>
            client.notifyDependencySatisfied.mutate(input),
        setUserPreferences: async (input) => client.setUserPreferences.mutate(input),
        getUserPreferences: async (userId) => client.getUserPreferences.query({ userId }),
        listOutbox: async (input) => client.listOutbox.query(input),
        getOutboxMessage: async (id) => client.getOutboxMessage.query({ id }),
        listPendingOutbox: async (limit) =>
            client.listOutbox.query({ status: "pending", ...(limit ? { limit } : {}) }),
        listSentOutbox: async (limit) =>
            client.listOutbox.query({ status: "sent", ...(limit ? { limit } : {}) }),
        getNotificationHistory: async (input) => client.getNotificationHistory.query(input),
        markNotificationRead: async (notificationId, userId) =>
            client.markNotificationRead.mutate({ notificationId, userId }),
        getNotificationStats: async (userId) =>
            client.getNotificationStats.query(userId ? { userId } : undefined),
        sendDailyDigest: async (input) => client.sendDailyDigest.mutate(input),
        sendWeeklyDigest: async (input) => client.sendWeeklyDigest.mutate(input),
        processOutbox: async () => client.processOutbox.mutate(),
    };
};
