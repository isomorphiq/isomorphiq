import { initTRPC } from "@trpc/server";
import { z } from "zod";
import {
    UpsertUserProfileInputSchema,
    UserProfileSeedSchema,
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
});

export type UserProfileServiceRouter = typeof userProfileServiceRouter;
