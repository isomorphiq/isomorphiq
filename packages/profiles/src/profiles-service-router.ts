// FILE_CONTEXT: "context-c8adc85e-0c8f-44b6-847d-87721d096571"

import { initTRPC } from "@trpc/server";
import { z } from "zod";
import {
    UpsertUserProfileInputSchema,
    UserProfileSeedSchema,
    UserPreferencesExportSchema,
} from "./profiles-domain.ts";
import type { UserProfileService } from "./profiles-service.ts";

export type UserProfileServiceContext = {
    environment: string;
    userProfileService: UserProfileService;
};

const t = initTRPC.context<UserProfileServiceContext>().create();

export const userProfileServiceRouter = t.router({
    getProfile: t.procedure
        .input(z.object({ userId: z.string() }))
        .query(async ({ ctx, input }) => ctx.userProfileService.getProfile(input.userId)),
    getOrCreateProfile: t.procedure
        .input(
            z.object({
                userId: z.string(),
                seed: UserProfileSeedSchema.optional(),
            }),
        )
        .mutation(async ({ ctx, input }) =>
            ctx.userProfileService.getOrCreateProfile(input.userId, input.seed),
        ),
    upsertProfile: t.procedure
        .input(UpsertUserProfileInputSchema)
        .mutation(async ({ ctx, input }) => ctx.userProfileService.upsertProfile(input)),
    resetDashboardPreferences: t.procedure
        .input(z.object({ userId: z.string() }))
        .mutation(async ({ ctx, input }) =>
            ctx.userProfileService.resetDashboardPreferences(input.userId),
        ),
    exportPreferences: t.procedure
        .input(z.object({ userId: z.string() }))
        .query(async ({ ctx, input }) => ctx.userProfileService.exportPreferences(input.userId)),
    importPreferences: t.procedure
        .input(
            z.object({
                userId: z.string(),
                payload: UserPreferencesExportSchema,
            }),
        )
        .mutation(async ({ ctx, input }) =>
            ctx.userProfileService.importPreferences(input.userId, input.payload),
        ),
});

export type UserProfileServiceRouter = typeof userProfileServiceRouter;
