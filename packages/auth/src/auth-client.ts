import { createTRPCClient, httpLink } from "@trpc/client";
import type { Operation, TRPCClient } from "@trpc/client";
import { ConfigManager } from "@isomorphiq/core";
import { z } from "zod";
import type { RolePermissions, UserPermissions } from "./security-types.ts";
import { RolePermissionsSchema, UserPermissionsSchema } from "./security-types.ts";
import type {
    AuthCredentials,
    AuthResult,
    ChangePasswordInput,
    CreateUserInput,
    EmailVerificationInput,
    PasswordResetInput,
    PasswordResetRequest,
    RefreshTokenResult,
    Session,
    UpdateProfileInput,
    UpdateUserInput,
    User,
} from "./types.ts";
import { SessionSchema, UserSchema } from "./types.ts";

type AuthServiceRouter = import("./auth-service-router.ts").AuthServiceRouter;

export type AuthClientOptions = {
    url?: string;
    environment?: string;
    headers?: Record<string, string>;
};

export type AuthClient = {
    createUser: (input: CreateUserInput) => Promise<User>;
    authenticateUser: (credentials: AuthCredentials) => Promise<AuthResult>;
    getUserById: (id: string) => Promise<User | null>;
    getAllUsers: () => Promise<User[]>;
    updateUser: (input: UpdateUserInput) => Promise<User>;
    deleteUser: (id: string) => Promise<void>;
    validateSession: (token: string) => Promise<User | null>;
    logoutUser: (token: string) => Promise<boolean>;
    refreshToken: (refreshToken: string) => Promise<RefreshTokenResult>;
    cleanupExpiredSessions: () => Promise<void>;
    hasPermission: (
        user: User,
        resource: string,
        action: string,
        context?: Record<string, unknown>,
    ) => Promise<boolean>;
    getUserPermissions: (user: User) => Promise<UserPermissions>;
    getPermissionMatrix: () => Promise<RolePermissions>;
    getAvailableResources: () => Promise<string[]>;
    getAvailableActions: (resource: string) => Promise<string[]>;
    updateProfile: (input: UpdateProfileInput) => Promise<User>;
    changePassword: (input: ChangePasswordInput) => Promise<void>;
    invalidateAllUserSessions: (userId: string) => Promise<void>;
    getUserSessions: (userId: string) => Promise<Session[]>;
    requestPasswordReset: (
        request: PasswordResetRequest,
    ) => Promise<{ success: boolean; message: string }>;
    resetPassword: (
        input: PasswordResetInput,
    ) => Promise<{ success: boolean; message: string }>;
    generateEmailVerification: (
        userId: string,
    ) => Promise<{ success: boolean; token?: string; message: string }>;
    verifyEmail: (
        input: EmailVerificationInput,
    ) => Promise<{ success: boolean; message: string }>;
    cleanupExpiredTokens: () => Promise<void>;
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
    const direct = process.env.AUTH_SERVICE_URL ?? process.env.AUTH_HTTP_URL;
    if (direct) {
        return direct;
    }
    const host = process.env.AUTH_HOST ?? "127.0.0.1";
    const portRaw = process.env.AUTH_HTTP_PORT ?? process.env.AUTH_PORT ?? "3009";
    const port = Number.parseInt(portRaw, 10);
    const resolvedPort = Number.isFinite(port) && port > 0 ? port : 3009;
    return `http://${host}:${resolvedPort}`;
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

const CoercedDateSchema = z.preprocess((value) => {
    if (value instanceof Date) {
        return value;
    }
    if (typeof value === "string" || typeof value === "number") {
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) {
            return parsed;
        }
    }
    return value;
}, z.date());

const UserWireSchema = UserSchema.extend({
    createdAt: CoercedDateSchema,
    updatedAt: CoercedDateSchema,
    lastLoginAt: CoercedDateSchema.optional(),
    passwordChangedAt: CoercedDateSchema.optional(),
    lockedUntil: CoercedDateSchema.optional(),
});

const SessionWireSchema = SessionSchema.extend({
    createdAt: CoercedDateSchema,
    expiresAt: CoercedDateSchema,
    refreshExpiresAt: CoercedDateSchema,
    lastAccessAt: CoercedDateSchema,
});

const UserListSchema = z.array(UserWireSchema);
const SessionListSchema = z.array(SessionWireSchema);

const normalizeUser = (value: unknown): User => UserWireSchema.parse(value);

const normalizeOptionalUser = (value: unknown): User | null => {
    if (value === null || value === undefined) {
        return null;
    }
    return normalizeUser(value);
};

const normalizeUserList = (value: unknown): User[] => UserListSchema.parse(value);

const normalizeSessionList = (value: unknown): Session[] => SessionListSchema.parse(value);

export const createAuthClient = (options: AuthClientOptions = {}): AuthClient => {
    const envHeader = resolveEnvironmentHeaderName();
    const defaultEnvironment = resolveDefaultEnvironment();
    const environment = options.environment ?? defaultEnvironment;
    const baseUrl = normalizeTrpcUrl(options.url ?? resolveBaseUrl());

    const client: TRPCClient<AuthServiceRouter> = createTRPCClient<AuthServiceRouter>({
        links: [
            httpLink({
                url: baseUrl,
                headers: (opts) => buildHeaders(envHeader, environment, options.headers, opts.op),
            }),
        ],
    });

    return {
        createUser: async (input) => normalizeUser(await client.createUser.mutate(input)),
        authenticateUser: async (credentials) => client.authenticateUser.mutate(credentials),
        getUserById: async (id) => normalizeOptionalUser(await client.getUserById.query({ id })),
        getAllUsers: async () => normalizeUserList(await client.listUsers.query()),
        updateUser: async (input) => normalizeUser(await client.updateUser.mutate(input)),
        deleteUser: async (id) => {
            await client.deleteUser.mutate({ id });
        },
        validateSession: async (token) =>
            normalizeOptionalUser(await client.validateSession.query({ token })),
        logoutUser: async (token) => client.logoutUser.mutate({ token }),
        refreshToken: async (refreshToken) => client.refreshToken.mutate({ refreshToken }),
        cleanupExpiredSessions: async () => {
            await client.cleanupExpiredSessions.mutate();
        },
        hasPermission: async (user, resource, action, context) =>
            client.hasPermission.query({ user, resource, action, context }),
        getUserPermissions: async (user) =>
            UserPermissionsSchema.parse(await client.getUserPermissions.query({ user })),
        getPermissionMatrix: async (): Promise<RolePermissions> =>
            RolePermissionsSchema.parse(
                await client.getPermissionMatrix.query(),
            ) as RolePermissions,
        getAvailableResources: async () => client.getAvailableResources.query(),
        getAvailableActions: async (resource) => client.getAvailableActions.query({ resource }),
        updateProfile: async (input) => normalizeUser(await client.updateProfile.mutate(input)),
        changePassword: async (input) => {
            await client.changePassword.mutate(input);
        },
        invalidateAllUserSessions: async (userId) => {
            await client.invalidateAllUserSessions.mutate({ userId });
        },
        getUserSessions: async (userId) =>
            normalizeSessionList(await client.getUserSessions.query({ userId })),
        requestPasswordReset: async (request) => client.requestPasswordReset.mutate(request),
        resetPassword: async (input) => client.resetPassword.mutate(input),
        generateEmailVerification: async (userId) =>
            client.generateEmailVerification.mutate({ userId }),
        verifyEmail: async (input) => client.verifyEmail.mutate(input),
        cleanupExpiredTokens: async () => {
            await client.cleanupExpiredTokens.mutate();
        },
    };
};
