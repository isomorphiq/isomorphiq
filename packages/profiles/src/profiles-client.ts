import { createTRPCClient, httpLink } from "@trpc/client";
import type { Operation, TRPCClient } from "@trpc/client";
import { ConfigManager } from "@isomorphiq/core";
import { z } from "zod";
import type {
    UpsertUserProfileInput,
    UserProfileRecord,
    UserProfileSeed,
} from "./profiles-domain.ts";
import { UserProfileRecordSchema } from "./profiles-domain.ts";

type UserProfileServiceRouter = import("./profiles-service-router.ts").UserProfileServiceRouter;

export type UserProfileClientOptions = {
    url?: string;
    environment?: string;
    headers?: Record<string, string>;
};

export type UserProfileClient = {
    getProfile: (userId: string) => Promise<UserProfileRecord | null>;
    getOrCreateProfile: (userId: string, seed?: UserProfileSeed) => Promise<UserProfileRecord>;
    upsertProfile: (input: UpsertUserProfileInput) => Promise<UserProfileRecord>;
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
    const direct = process.env.USER_PROFILE_SERVICE_URL ?? process.env.USER_PROFILE_HTTP_URL;
    if (direct) {
        return direct;
    }
    const host = process.env.USER_PROFILE_HOST ?? "127.0.0.1";
    const portRaw =
        process.env.USER_PROFILE_HTTP_PORT ?? process.env.USER_PROFILE_PORT ?? "3010";
    const port = Number.parseInt(portRaw, 10);
    const resolvedPort = Number.isFinite(port) && port > 0 ? port : 3010;
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

const UserProfileRecordWireSchema = UserProfileRecordSchema.extend({
    createdAt: CoercedDateSchema,
    updatedAt: CoercedDateSchema,
});

const normalizeProfile = (value: unknown): UserProfileRecord =>
    UserProfileRecordWireSchema.parse(value) as UserProfileRecord;

const normalizeOptionalProfile = (value: unknown): UserProfileRecord | null => {
    if (value === null || value === undefined) {
        return null;
    }
    return normalizeProfile(value);
};

export const createUserProfileClient = (
    options: UserProfileClientOptions = {},
): UserProfileClient => {
    const envHeader = resolveEnvironmentHeaderName();
    const defaultEnvironment = resolveDefaultEnvironment();
    const environment = options.environment ?? defaultEnvironment;
    const baseUrl = normalizeTrpcUrl(options.url ?? resolveBaseUrl());

    const client: TRPCClient<UserProfileServiceRouter> =
        createTRPCClient<UserProfileServiceRouter>({
            links: [
                httpLink({
                    url: baseUrl,
                    headers: (opts) =>
                        buildHeaders(envHeader, environment, options.headers, opts.op),
                }),
            ],
        });

    return {
        getProfile: async (userId) =>
            normalizeOptionalProfile(await client.getProfile.query({ userId })),
        getOrCreateProfile: async (userId, seed) =>
            normalizeProfile(await client.getOrCreateProfile.mutate({ userId, seed })),
        upsertProfile: async (input) =>
            normalizeProfile(await client.upsertProfile.mutate(input)),
    };
};
