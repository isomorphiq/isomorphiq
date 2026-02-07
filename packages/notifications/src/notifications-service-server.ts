import http from "node:http";
import path from "node:path";
import { nodeHTTPRequestHandler } from "@trpc/server/adapters/node-http";
import {
    ConfigManager,
    resolveEnvironmentFromHeaders,
    resolveEnvironmentValue,
} from "@isomorphiq/core";
import {
    notificationsServiceRouter,
    type NotificationsServiceContext,
} from "./notifications-service-router.ts";
import { NotificationsService } from "./notifications-service.ts";

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

const createEnvironmentService = async (environment: string): Promise<NotificationsService> => {
    const basePath = resolveBasePath();
    const envPath = path.join(basePath, environment);
    const notificationsPath = path.join(envPath, "notifications");
    const outboxPath = path.join(notificationsPath, "outbox");
    const preferencesPath = path.join(notificationsPath, "preferences");
    const service = new NotificationsService({
        outboxPath,
        preferencesPath,
    });
    await service.open();
    return service;
};

const resolveEnvironment = (req: http.IncomingMessage): string => {
    const fromHeaders = resolveEnvironmentFromHeaders(req.headers, environmentConfig);
    return resolveEnvironmentValue(fromHeaders, environmentConfig);
};

export async function startNotificationsServiceServer(): Promise<http.Server> {
    console.log("[NOTIFICATIONS] Starting notifications microservice");

    const environmentServices = new Map<string, NotificationsService>();
    for (const environment of environmentNames) {
        try {
            const service = await createEnvironmentService(environment);
            environmentServices.set(environment, service);
        } catch (error) {
            if (isLevelLockedError(error)) {
                console.error(
                    `[NOTIFICATIONS] Database locked for ${environment}; another notifications service may be running. Exiting.`,
                );
                throw error;
            }
            throw error;
        }
    }

    const fallbackEnvironment = environmentConfig.default;
    const fallbackService =
        environmentServices.get(fallbackEnvironment)
        ?? environmentServices.values().next().value;
    if (!fallbackService) {
        throw new Error("No environments configured for notifications service");
    }

    const resolveService = (environment: string): NotificationsService =>
        environmentServices.get(environment) ?? fallbackService;

    const createContext = (opts: { req: http.IncomingMessage }): NotificationsServiceContext => {
        const environment = resolveEnvironment(opts.req);
        return {
            environment,
            notificationsService: resolveService(environment),
        };
    };

    const host = process.env.NOTIFICATIONS_HOST ?? "127.0.0.1";
    const portRaw =
        process.env.NOTIFICATIONS_HTTP_PORT
        ?? process.env.NOTIFICATIONS_PORT
        ?? "3011";
    const port = Number.parseInt(portRaw, 10);
    const resolvedPort = Number.isFinite(port) && port > 0 ? port : 3011;

    const server = http.createServer(async (req, res) => {
        const url = req.url ?? "/";
        const parsed = new URL(url, `http://${req.headers.host ?? "localhost"}`);

        if (req.method === "GET" && parsed.pathname === "/health") {
            const service = resolveService(resolveEnvironment(req));
            const outbox = await service.listOutbox({ limit: 200 });
            const pending = outbox.filter((entry) => entry.status === "pending").length;
            const sent = outbox.filter((entry) => entry.status === "sent").length;
            const failed = outbox.filter((entry) => entry.status === "failed").length;
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
                JSON.stringify({
                    status: "ok",
                    service: "notifications-service",
                    queue: {
                        pending,
                        sent,
                        failed,
                    },
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
            router: notificationsServiceRouter,
            createContext,
            path: procedurePath,
        });
    });

    return await new Promise((resolve, reject) => {
        server.listen(resolvedPort, host, () => {
            console.log(
                `[NOTIFICATIONS] Notifications service listening on http://${host}:${resolvedPort}/trpc`,
            );
            resolve(server);
        });
        server.on("error", (error) => {
            console.error("[NOTIFICATIONS] Failed to start notifications service:", error);
            reject(error);
        });
    });
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
    startNotificationsServiceServer().catch((error) => {
        console.error("[NOTIFICATIONS] Fatal error during startup:", error);
        process.exit(1);
    });
}
