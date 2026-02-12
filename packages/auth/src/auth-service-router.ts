import { initTRPC } from "@trpc/server";
import { z } from "zod";
import {
    AuthCredentialsSchema,
    ChangePasswordInputSchema,
    CreateUserInputSchema,
    EmailVerificationInputSchema,
    PasswordResetInputSchema,
    PasswordResetRequestSchema,
    UpdateProfileInputSchema,
    UpdateUserInputSchema,
    UserSchema,
} from "./types.ts";
import { RolePermissionsSchema, UserPermissionsSchema } from "./security-types.ts";
import type { UserManager } from "./user-manager.ts";

export type AuthServiceContext = {
    environment: string;
    userManager: UserManager;
};

const t = initTRPC.context<AuthServiceContext>().create();

export const authServiceRouter = t.router({
    createUser: t.procedure
        .input(CreateUserInputSchema)
        .mutation(async ({ ctx, input }) => ctx.userManager.createUser(input)),
    authenticateUser: t.procedure
        .input(AuthCredentialsSchema)
        .mutation(async ({ ctx, input }) => ctx.userManager.authenticateUser(input)),
    getUserById: t.procedure
        .input(z.object({ id: z.string() }))
        .query(async ({ ctx, input }) => ctx.userManager.getUserById(input.id)),
    listUsers: t.procedure
        .query(async ({ ctx }) => ctx.userManager.getAllUsers()),
    updateUser: t.procedure
        .input(UpdateUserInputSchema)
        .mutation(async ({ ctx, input }) => ctx.userManager.updateUser(input)),
    deleteUser: t.procedure
        .input(z.object({ id: z.string() }))
        .mutation(async ({ ctx, input }) => {
            await ctx.userManager.deleteUser(input.id);
            return { success: true };
        }),
    validateSession: t.procedure
        .input(z.object({ token: z.string() }))
        .query(async ({ ctx, input }) => ctx.userManager.validateSession(input.token)),
    logoutUser: t.procedure
        .input(z.object({ token: z.string() }))
        .mutation(async ({ ctx, input }) => ctx.userManager.logoutUser(input.token)),
    refreshToken: t.procedure
        .input(z.object({ refreshToken: z.string() }))
        .mutation(async ({ ctx, input }) => ctx.userManager.refreshToken(input.refreshToken)),
    cleanupExpiredSessions: t.procedure
        .mutation(async ({ ctx }) => {
            await ctx.userManager.cleanupExpiredSessions();
            return { success: true };
        }),
    hasPermission: t.procedure
        .input(
            z.object({
                user: UserSchema,
                resource: z.string(),
                action: z.string(),
                context: z.record(z.unknown()).optional(),
            }),
        )
        .query(async ({ ctx, input }) =>
            ctx.userManager.hasPermission(input.user, input.resource, input.action, input.context),
        ),
    getUserPermissions: t.procedure
        .input(z.object({ user: UserSchema }))
        .query(async ({ ctx, input }) =>
            UserPermissionsSchema.parse(await ctx.userManager.getUserPermissions(input.user)),
        ),
    getPermissionMatrix: t.procedure
        .query(async ({ ctx }) =>
            RolePermissionsSchema.parse(ctx.userManager.getPermissionMatrix()),
        ),
    getAvailableResources: t.procedure
        .query(async ({ ctx }) => ctx.userManager.getAvailableResources()),
    getAvailableActions: t.procedure
        .input(z.object({ resource: z.string() }))
        .query(async ({ ctx, input }) => ctx.userManager.getAvailableActions(input.resource)),
    updateProfile: t.procedure
        .input(UpdateProfileInputSchema)
        .mutation(async ({ ctx, input }) => ctx.userManager.updateProfile(input)),
    changePassword: t.procedure
        .input(ChangePasswordInputSchema)
        .mutation(async ({ ctx, input }) => {
            await ctx.userManager.changePassword(input);
            return { success: true };
        }),
    getUserSessions: t.procedure
        .input(z.object({ userId: z.string() }))
        .query(async ({ ctx, input }) => ctx.userManager.getUserSessions(input.userId)),
    invalidateAllUserSessions: t.procedure
        .input(z.object({ userId: z.string() }))
        .mutation(async ({ ctx, input }) => {
            await ctx.userManager.invalidateAllUserSessions(input.userId);
            return { success: true };
        }),
    requestPasswordReset: t.procedure
        .input(PasswordResetRequestSchema)
        .mutation(async ({ ctx, input }) => ctx.userManager.requestPasswordReset(input)),
    resetPassword: t.procedure
        .input(PasswordResetInputSchema)
        .mutation(async ({ ctx, input }) => ctx.userManager.resetPassword(input)),
    generateEmailVerification: t.procedure
        .input(z.object({ userId: z.string() }))
        .mutation(async ({ ctx, input }) => ctx.userManager.generateEmailVerification(input.userId)),
    verifyEmail: t.procedure
        .input(EmailVerificationInputSchema)
        .mutation(async ({ ctx, input }) => ctx.userManager.verifyEmail(input)),
    cleanupExpiredTokens: t.procedure
        .mutation(async ({ ctx }) => {
            await ctx.userManager.cleanupExpiredTokens();
            return { success: true };
        }),
});

export type AuthServiceRouter = typeof authServiceRouter;
