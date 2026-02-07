import http from "node:http";
import path from "node:path";
import { nodeHTTPRequestHandler } from "@trpc/server/adapters/node-http";
import {
    ConfigManager,
    resolveEnvironmentFromHeaders,
    resolveEnvironmentValue,
} from "@isomorphiq/core";
import {
    userProfileServiceRouter,
    type UserProfileServiceContext,
} from "./profiles-service-router.ts";
import { UserProfileService } from "./profiles-service.ts";

const isLevelLockedError = (error: unknown): boolean => {
    if (!error || typeof error !== "object") {
        return false;
    }
    const record = error as Record<string, unknown>;
    const code = record.code;
    if (code === "LEVEL_LOCKED") {
        return true;
    }
    const cause = record.cause as Record<string, unknown> | undefined;
    return Boolean(cause && cause.code === "LEVEL_LOCKED");
};

const configManager = ConfigManager.getInstance();
const environmentConfig = configManager.getEnvironmentConfig();
const environmentNames = Array.from(new Set(environmentConfig.available));

const resolveBasePath = (): string => {
    const basePath = configManager.getDatabaseConfig().path;
    return path.isAbsolute(basePath) ? basePath : path.join(process.cwd(), basePath);
};

const createEnvironmentService = async (
    environment: string,
): Promise<UserProfileService> => {
    const basePath = resolveBasePath();
    const envPath = path.join(basePath, environment);
    const profilesPath = path.join(envPath, "user-profile", "profiles");
    const service = new UserProfileService(profilesPath);
    await service.open();
    return service;
};

const resolveEnvironment = (req: http.IncomingMessage): string => {
    const fromHeaders = resolveEnvironmentFromHeaders(req.headers, environmentConfig);
    return resolveEnvironmentValue(fromHeaders, environmentConfig);
};

export async function startUserProfileServiceServer(): Promise<http.Server> {
    console.log("[PROFILES] Starting profiles microservice");

    const environmentServices = new Map<string, UserProfileService>();
    for (const environment of environmentNames) {
        try {
            const service = await createEnvironmentService(environment);
            environmentServices.set(environment, service);
        } catch (error) {
            if (isLevelLockedError(error)) {
                console.error(
                    `[PROFILES] Profile database locked for ${environment}; another service may be running. Exiting.`,
                );
                throw error;
            }
            throw error;
        }
    }

    const fallbackEnvironment = environmentConfig.default;
    const fallbackService =
        environmentServices.get(fallbackEnvironment) ??
        environmentServices.values().next().value;
    if (!fallbackService) {
        throw new Error("No environments configured for profiles service");
    }

    const resolveService = (environment: string): UserProfileService =>
        environmentServices.get(environment) ?? fallbackService;

    const createContext = (opts: {
        req: http.IncomingMessage;
    }): UserProfileServiceContext => {
        const environment = resolveEnvironment(opts.req);
        return {
            environment,
            userProfileService: resolveService(environment),
        };
    };

    const host = process.env.USER_PROFILE_HOST ?? "127.0.0.1";
    const portRaw =
        process.env.USER_PROFILE_HTTP_PORT ?? process.env.USER_PROFILE_PORT ?? "3010";
    const port = Number.parseInt(portRaw, 10);
    const resolvedPort = Number.isFinite(port) && port > 0 ? port : 3010;

    const server = http.createServer(async (req, res) => {
        const url = req.url ?? "/";
        const parsed = new URL(url, `http://${req.headers.host ?? "localhost"}`);

        if (req.method === "GET" && parsed.pathname === "/health") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
                JSON.stringify({
                    status: "ok",
                    service: "profiles-service",
                }),
            );
            return;
        }

        if (!parsed.pathname.startsWith("/trpc")) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Not found" }));
            return;
        }
        const basePath = "/trpc";
        const procedurePath =
            parsed.pathname === basePath
                ? ""
                : parsed.pathname.startsWith(`${basePath}/`)
                    ? parsed.pathname.slice(basePath.length + 1)
                    : parsed.pathname.slice(1);
        if (!procedurePath) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Procedure path missing" }));
            return;
        }
        await nodeHTTPRequestHandler({
            req,
            res,
            router: userProfileServiceRouter,
            createContext,
            path: procedurePath,
        });
    });

    return await new Promise((resolve, reject) => {
        server.listen(resolvedPort, host, () => {
            console.log(
                `[PROFILES] Profiles service listening on http://${host}:${resolvedPort}/trpc`,
            );
            resolve(server);
        });
        server.on("error", (error) => {
            console.error("[PROFILES] Failed to start profiles service:", error);
            reject(error);
        });
    });
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
    startUserProfileServiceServer().catch((error) => {
        console.error("[PROFILES] Fatal error during startup:", error);
        process.exit(1);
    });
}
