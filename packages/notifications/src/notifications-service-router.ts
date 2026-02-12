import { initTRPC } from "@trpc/server";
import { z } from "zod";
import {
    ListOutboxInputSchema,
    NotifyDependencySatisfiedInputSchema,
    NotifyMentionInputSchema,
    NotifyTaskCompletedInputSchema,
    NotifyTaskStatusChangedInputSchema,
    NotificationPreferencesSchema,
    SendDigestInputSchema,
    SendNotificationInputSchema,
} from "./notifications-domain.ts";
import type { NotificationsService } from "./notifications-service.ts";

export type NotificationsServiceContext = {
    environment: string;
    notificationsService: NotificationsService;
};

const t = initTRPC.context<NotificationsServiceContext>().create();

export const notificationsServiceRouter = t.router({
    sendNotification: t.procedure
        .input(SendNotificationInputSchema)
        .mutation(async ({ ctx, input }) => ctx.notificationsService.sendNotification(input)),
    notifyTaskStatusChanged: t.procedure
        .input(NotifyTaskStatusChangedInputSchema)
        .mutation(async ({ ctx, input }) => {
            const payload = NotifyTaskStatusChangedInputSchema.parse(input);
            return ctx.notificationsService.notifyTaskStatusChanged(payload);
        }),
    notifyTaskCompleted: t.procedure
        .input(NotifyTaskCompletedInputSchema)
        .mutation(async ({ ctx, input }) => {
            const payload = NotifyTaskCompletedInputSchema.parse(input);
            return ctx.notificationsService.notifyTaskCompleted(payload);
        }),
    notifyMention: t.procedure
        .input(NotifyMentionInputSchema)
        .mutation(async ({ ctx, input }) => {
            const payload = NotifyMentionInputSchema.parse(input);
            return ctx.notificationsService.notifyMention(payload);
        }),
    notifyDependencySatisfied: t.procedure
        .input(NotifyDependencySatisfiedInputSchema)
        .mutation(async ({ ctx, input }) => {
            const payload = NotifyDependencySatisfiedInputSchema.parse(input);
            return ctx.notificationsService.notifyDependencySatisfied(payload);
        }),
    setUserPreferences: t.procedure
        .input(NotificationPreferencesSchema)
        .mutation(async ({ ctx, input }) => ctx.notificationsService.setUserPreferences(input)),
    getUserPreferences: t.procedure
        .input(z.object({ userId: z.string() }))
        .query(async ({ ctx, input }) => ctx.notificationsService.getUserPreferences(input.userId)),
    listOutbox: t.procedure
        .input(ListOutboxInputSchema.optional())
        .query(async ({ ctx, input }) => ctx.notificationsService.listOutbox(input)),
    getOutboxMessage: t.procedure
        .input(z.object({ id: z.string() }))
        .query(async ({ ctx, input }) => ctx.notificationsService.getOutboxMessage(input.id)),
    processOutbox: t.procedure
        .mutation(async ({ ctx }) => ctx.notificationsService.processOutbox()),
    getNotificationHistory: t.procedure
        .input(
            z
                .object({
                    userId: z.string().optional(),
                    limit: z.number().int().positive().optional(),
                })
                .optional(),
        )
        .query(async ({ ctx, input }) =>
            ctx.notificationsService.getNotificationHistory(input?.userId, input?.limit),
        ),
    markNotificationRead: t.procedure
        .input(
            z.object({
                notificationId: z.string(),
                userId: z.string(),
            }),
        )
        .mutation(async ({ ctx, input }) => ({
            marked: await ctx.notificationsService.markNotificationAsRead(
                input.notificationId,
                input.userId,
            ),
        })),
    getNotificationStats: t.procedure
        .input(
            z
                .object({
                    userId: z.string().optional(),
                })
                .optional(),
        )
        .query(async ({ ctx, input }) => ctx.notificationsService.getNotificationStats(input?.userId)),
    sendDailyDigest: t.procedure
        .input(SendDigestInputSchema)
        .mutation(async ({ ctx, input }) => ctx.notificationsService.sendDailyDigest(input)),
    sendWeeklyDigest: t.procedure
        .input(SendDigestInputSchema)
        .mutation(async ({ ctx, input }) => ctx.notificationsService.sendWeeklyDigest(input)),
});

export type NotificationsServiceRouter = typeof notificationsServiceRouter;
