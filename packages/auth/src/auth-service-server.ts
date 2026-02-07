import http from "node:http";
import path from "node:path";
import { nodeHTTPRequestHandler } from "@trpc/server/adapters/node-http";
import {
    createHttpMicroserviceRuntime,
    MicroserviceTrait,
    resolveLevelDbRootPath,
    resolveTrpcProcedurePath,
    tryHandleMicroserviceHealthRequest,
    writeJsonNotFound,
    writeJsonResponse,
} from "@isomorphiq/core-microservice";
import { ConfigManager, resolveEnvironmentFromHeaders } from "@isomorphiq/core";
import { authServiceRouter, type AuthServiceContext } from "./auth-service-router.ts";
import { UserManager } from "./user-manager.ts";

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

const resolveDefaultDbPath = (): string => {
    return path.join(resolveLevelDbRootPath(), "auth");
};

const resolveAuthDbPath = (): string => {
    const configured = process.env.ISOMORPHIQ_AUTH_DB_PATH ?? process.env.AUTH_DB_PATH;
    if (!configured || configured.trim().length === 0) {
        return resolveDefaultDbPath();
    }
    return path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured);
};

const resolveEnvironment = (req: http.IncomingMessage): string =>
    resolveEnvironmentFromHeaders(req.headers, environmentConfig);

export async function startAuthServiceServer(): Promise<http.Server> {
    console.log("[AUTH] Starting auth service microservice");

    const authDbPath = resolveAuthDbPath();
    const userManager = new UserManager(authDbPath);

    try {
        await userManager.getAllUsers();
    } catch (error) {
        if (isLevelLockedError(error)) {
            console.error("[AUTH] Auth LevelDB is locked; another auth service may already be running.");
            throw error;
        }
        throw error;
    }

    const createContext = (opts: { req: http.IncomingMessage }): AuthServiceContext => ({
        environment: resolveEnvironment(opts.req),
        userManager,
    });

    const host = process.env.AUTH_HOST ?? "127.0.0.1";
    const portRaw = process.env.AUTH_HTTP_PORT ?? process.env.AUTH_PORT ?? "3009";
    const port = Number.parseInt(portRaw, 10);
    const resolvedPort = Number.isFinite(port) && port > 0 ? port : 3009;

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
            router: authServiceRouter,
            createContext,
            path: procedurePath,
        });
    });

    const microservice = createHttpMicroserviceRuntime({
        id: "auth-service",
        name: "auth-service",
        kind: "trpc",
        host,
        port: resolvedPort,
        server,
    });

    await MicroserviceTrait.start(microservice.runtime as any);
    console.log(`[AUTH] Auth service listening on http://${host}:${resolvedPort}/trpc`);
    console.log(`[AUTH] LevelDB path: ${authDbPath}`);
    return microservice.server;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
    startAuthServiceServer().catch((error) => {
        console.error("[AUTH] Fatal error during startup:", error);
        process.exit(1);
    });
}
