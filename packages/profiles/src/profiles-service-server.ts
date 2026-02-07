import http from "node:http";
import { nodeHTTPRequestHandler } from "@trpc/server/adapters/node-http";
import {
    createHttpMicroserviceRuntime,
    MicroserviceTrait,
    resolveEnvironmentLevelDbPath,
    resolveTrpcProcedurePath,
    tryHandleMicroserviceHealthRequest,
    writeJsonNotFound,
    writeJsonResponse,
} from "@isomorphiq/core-microservice";
import {
    ConfigManager,
    resolveEnvironmentFromHeaders,
    resolveEnvironmentValue,
} from "@isomorphiq/core";
import type { ProfileManager } from "./acp-profiles.ts";
import { ProfileManager as AcpProfileManager } from "./acp-profiles.ts";
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

const createEnvironmentService = async (
    environment: string,
): Promise<UserProfileService> => {
    const profilesPath = resolveEnvironmentLevelDbPath(
        environment,
        ["user-profile", "profiles"],
    );
    const service = new UserProfileService(profilesPath);
    await service.open();
    return service;
};

const resolveEnvironment = (req: http.IncomingMessage): string => {
    const fromHeaders = resolveEnvironmentFromHeaders(req.headers, environmentConfig);
    return resolveEnvironmentValue(fromHeaders, environmentConfig);
};

const readRequestBody = async (req: http.IncomingMessage): Promise<string> =>
    await new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on("data", (chunk) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        req.on("end", () => {
            resolve(Buffer.concat(chunks).toString("utf8"));
        });
        req.on("error", reject);
    });

const parseJsonBody = (
    raw: string,
): { success: true; data: unknown } | { success: false; error: string } => {
    const trimmed = raw.trim();
    if (!trimmed) {
        return { success: true, data: {} };
    }
    try {
        return { success: true, data: JSON.parse(trimmed) as unknown };
    } catch {
        return { success: false, error: "Invalid JSON body" };
    }
};

const decodePathSegment = (value: string): string | null => {
    try {
        return decodeURIComponent(value);
    } catch {
        return null;
    }
};

const isProfilesApiPath = (pathname: string): boolean =>
    pathname === "/api/profiles" || pathname.startsWith("/api/profiles/");

const getProfileNameFromPath = (
    pathname: string,
    suffix: "/state" | "/metrics" | "/queue" | "/config" | "/status" | "/assign-task",
): string | null => {
    const escapedSuffix = suffix.replace("/", "\\/");
    const regex = new RegExp(`^\\/api\\/profiles\\/([^/]+)${escapedSuffix}$`);
    const match = regex.exec(pathname);
    if (!match) {
        return null;
    }
    return decodePathSegment(match[1]);
};

const handleProfilesApiRequest = async (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    profileManager: ProfileManager,
): Promise<boolean> => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const pathname = url.pathname;
    const method = (req.method ?? "GET").toUpperCase();
    if (!isProfilesApiPath(pathname)) {
        return false;
    }

    try {
        if (method === "GET" && pathname === "/api/profiles/with-states") {
            await profileManager.waitForProfileOverrides();
            const profiles = profileManager.getProfilesWithStates();
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(profiles));
            return true;
        }

        if (method === "GET" && pathname === "/api/profiles/configs") {
            await profileManager.waitForProfileOverrides();
            const profiles = profileManager.getAllProfileConfigurations();
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(profiles));
            return true;
        }

        if (method === "GET" && pathname === "/api/profiles/states") {
            const states = profileManager.getAllProfileStates();
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(states));
            return true;
        }

        if (method === "GET" && pathname === "/api/profiles/metrics") {
            const metrics = Object.fromEntries(profileManager.getAllProfileMetrics());
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(metrics));
            return true;
        }

        if (method === "GET" && pathname.endsWith("/state")) {
            const profileName = getProfileNameFromPath(pathname, "/state");
            if (!profileName) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Invalid profile name" }));
                return true;
            }
            const state = profileManager.getProfileState(profileName);
            if (!state) {
                res.writeHead(404, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Profile not found" }));
                return true;
            }
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(state));
            return true;
        }

        if (method === "GET" && pathname.endsWith("/metrics")) {
            const profileName = getProfileNameFromPath(pathname, "/metrics");
            if (!profileName) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Invalid profile name" }));
                return true;
            }
            const metrics = profileManager.getProfileMetrics(profileName);
            if (!metrics) {
                res.writeHead(404, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Profile not found" }));
                return true;
            }
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(metrics));
            return true;
        }

        if (method === "GET" && pathname.endsWith("/queue")) {
            const profileName = getProfileNameFromPath(pathname, "/queue");
            if (!profileName) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Invalid profile name" }));
                return true;
            }
            const profile = profileManager.getProfile(profileName);
            if (!profile) {
                res.writeHead(404, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Profile not found" }));
                return true;
            }
            const queue = profileManager.getTaskQueue(profileName);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(queue));
            return true;
        }

        if (method === "GET" && pathname.endsWith("/config")) {
            const profileName = getProfileNameFromPath(pathname, "/config");
            if (!profileName) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Invalid profile name" }));
                return true;
            }
            await profileManager.waitForProfileOverrides();
            const profileConfig = profileManager.getProfileConfiguration(profileName);
            if (!profileConfig) {
                res.writeHead(404, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Profile not found" }));
                return true;
            }
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(profileConfig));
            return true;
        }

        if (method === "PUT" && pathname.endsWith("/status")) {
            const profileName = getProfileNameFromPath(pathname, "/status");
            if (!profileName) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Invalid profile name" }));
                return true;
            }
            const parsed = parseJsonBody(await readRequestBody(req));
            if (parsed.success === false) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: parsed.error }));
                return true;
            }
            const body = parsed.data as Record<string, unknown>;
            const isActive = body.isActive;
            if (typeof isActive !== "boolean") {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "isActive must be a boolean" }));
                return true;
            }
            const state = profileManager.getProfileState(profileName);
            if (!state) {
                res.writeHead(404, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Profile not found" }));
                return true;
            }
            profileManager.updateProfileState(profileName, { isActive });
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: true }));
            return true;
        }

        if (method === "PUT" && pathname.endsWith("/config")) {
            const profileName = getProfileNameFromPath(pathname, "/config");
            if (!profileName) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Invalid profile name" }));
                return true;
            }
            const parsed = parseJsonBody(await readRequestBody(req));
            if (parsed.success === false) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: parsed.error }));
                return true;
            }
            const body = parsed.data as {
                runtimeName?: unknown;
                modelName?: unknown;
                systemPrompt?: unknown;
                taskPromptPrefix?: unknown;
            };
            const isValidText = (value: unknown): boolean =>
                value === undefined || value === null || typeof value === "string";
            if (
                !isValidText(body.runtimeName)
                || !isValidText(body.modelName)
                || !isValidText(body.systemPrompt)
                || !isValidText(body.taskPromptPrefix)
            ) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(
                    JSON.stringify({
                        error: "runtimeName, modelName, systemPrompt, and taskPromptPrefix must be string, null, or undefined",
                    }),
                );
                return true;
            }
            if (
                body.runtimeName !== undefined
                && body.runtimeName !== null
                && body.runtimeName !== "codex"
                && body.runtimeName !== "opencode"
            ) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "runtimeName must be either \"codex\" or \"opencode\"" }));
                return true;
            }

            await profileManager.waitForProfileOverrides();
            const updated = await profileManager.updateProfileConfiguration(profileName, {
                ...(Object.prototype.hasOwnProperty.call(body, "runtimeName")
                    ? { runtimeName: body.runtimeName === null ? undefined : String(body.runtimeName) }
                    : {}),
                ...(Object.prototype.hasOwnProperty.call(body, "modelName")
                    ? { modelName: body.modelName === null ? undefined : String(body.modelName) }
                    : {}),
                ...(Object.prototype.hasOwnProperty.call(body, "systemPrompt")
                    ? { systemPrompt: body.systemPrompt === null ? undefined : String(body.systemPrompt) }
                    : {}),
                ...(Object.prototype.hasOwnProperty.call(body, "taskPromptPrefix")
                    ? {
                        taskPromptPrefix:
                            body.taskPromptPrefix === null
                                ? undefined
                                : String(body.taskPromptPrefix),
                    }
                    : {}),
            });
            if (!updated) {
                res.writeHead(404, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Profile not found" }));
                return true;
            }
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(updated));
            return true;
        }

        if (method === "POST" && pathname.endsWith("/assign-task")) {
            const profileName = getProfileNameFromPath(pathname, "/assign-task");
            if (!profileName) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Invalid profile name" }));
                return true;
            }
            const parsed = parseJsonBody(await readRequestBody(req));
            if (parsed.success === false) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: parsed.error }));
                return true;
            }
            const body = parsed.data as { task?: { title?: unknown; description?: unknown } };
            const task = body.task;
            if (!task || typeof task.title !== "string" || typeof task.description !== "string") {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Task must have title and description" }));
                return true;
            }
            const profile = profileManager.getProfile(profileName);
            if (!profile) {
                res.writeHead(404, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Profile not found" }));
                return true;
            }
            profileManager.addToTaskQueue(profileName, task);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: true }));
            return true;
        }

        if (method === "POST" && pathname === "/api/profiles/best-for-task") {
            const parsed = parseJsonBody(await readRequestBody(req));
            if (parsed.success === false) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: parsed.error }));
                return true;
            }
            const body = parsed.data as { task?: { title?: unknown } };
            const task = body.task;
            if (!task || typeof task.title !== "string") {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Task must have title" }));
                return true;
            }
            const bestProfile = profileManager.getBestProfileForTask(task);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ bestProfile }));
            return true;
        }

        res.writeHead(405, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Method not allowed" }));
        return true;
    } catch (error) {
        console.error("[PROFILES] Profiles API request failed:", error);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Profile service request failed" }));
        return true;
    }
};

export async function startUserProfileServiceServer(): Promise<http.Server> {
    console.log("[PROFILES] Starting profiles microservice");

    const profileManager = new AcpProfileManager();
    await profileManager.waitForProfileOverrides();

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
        const path = parsed.pathname;

        const healthHandled = await tryHandleMicroserviceHealthRequest(
            req,
            res,
            path,
            async () => await MicroserviceTrait.health(microservice.runtime as any),
        );
        if (healthHandled) {
            return;
        }

        const profilesApiHandled = await handleProfilesApiRequest(req, res, profileManager);
        if (profilesApiHandled) {
            return;
        }

        if (!path.startsWith("/trpc")) {
            writeJsonNotFound(res);
            return;
        }
        const procedurePath = resolveTrpcProcedurePath(path, "/trpc");
        if (!procedurePath) {
            writeJsonResponse(res, 404, { error: "Procedure path missing" });
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

    const microservice = createHttpMicroserviceRuntime({
        id: "profiles-service",
        name: "profiles-service",
        kind: "trpc",
        host,
        port: resolvedPort,
        server,
    });

    await MicroserviceTrait.start(microservice.runtime as any);
    console.log(
        `[PROFILES] Profiles service listening on http://${host}:${resolvedPort}/trpc`,
    );
    return microservice.server;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
    startUserProfileServiceServer().catch((error) => {
        console.error("[PROFILES] Fatal error during startup:", error);
        process.exit(1);
    });
}
