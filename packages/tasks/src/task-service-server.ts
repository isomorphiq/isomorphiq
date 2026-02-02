import http from "node:http";
import path from "node:path";
import { WebSocketServer } from "ws";
import { applyWSSHandler } from "@trpc/server/adapters/ws";
import { nodeHTTPRequestHandler } from "@trpc/server/adapters/node-http";
import { ConfigManager, resolveEnvironmentFromHeaders, resolveEnvironmentValue } from "@isomorphiq/core";
import { EnhancedTaskService } from "./enhanced-task-service.ts";
import { LevelDbTaskRepository } from "./persistence/leveldb-task-repository.ts";
import { TaskEventBus } from "./task-event-bus.ts";
import { taskServiceRouter, type TaskServiceContext } from "./task-service-router.ts";

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

const readConnectionEnvironment = (info: { connectionParams?: Record<string, unknown> | null } | undefined):
    string | undefined => {
    const params = info?.connectionParams;
    if (!params || typeof params !== "object") {
        return undefined;
    }
    const value = (params as Record<string, unknown>).environment;
    return typeof value === "string" ? value : undefined;
};

type EnvironmentServices = {
    taskService: EnhancedTaskService;
    taskEventBus: TaskEventBus;
};

const configManager = ConfigManager.getInstance();
const environmentConfig = configManager.getEnvironmentConfig();
const environmentNames = Array.from(new Set(environmentConfig.available));

const resolveBasePath = (): string => {
    const basePath = configManager.getDatabaseConfig().path;
    return path.isAbsolute(basePath) ? basePath : path.join(process.cwd(), basePath);
};

const createEnvironmentServices = async (environment: string): Promise<EnvironmentServices> => {
    const basePath = resolveBasePath();
    const envPath = path.join(basePath, environment);
    const taskRepository = new LevelDbTaskRepository(path.join(envPath, "tasks"));
    const taskService = new EnhancedTaskService(taskRepository);
    const taskEventBus = new TaskEventBus();

    const warmup = await taskService.getAllTasks();
    if (!warmup.success) {
        if (isLevelLockedError(warmup.error)) {
            throw warmup.error;
        }
        console.warn(`[TASKS] Failed to warm LevelDB for ${environment}:`, warmup.error);
    }

    return { taskService, taskEventBus };
};

const resolveEnvironment = (
    req: http.IncomingMessage,
    info?: { connectionParams?: Record<string, unknown> | null },
): string => {
    const fromConnection = readConnectionEnvironment(info);
    if (fromConnection) {
        return resolveEnvironmentValue(fromConnection, environmentConfig);
    }
    return resolveEnvironmentFromHeaders(req.headers, environmentConfig);
};

export async function startTaskServiceServer(): Promise<http.Server> {
    console.log("[TASKS] Starting task service microservice");

    const environmentServices = new Map<string, EnvironmentServices>();
    for (const environment of environmentNames) {
        try {
            const services = await createEnvironmentServices(environment);
            environmentServices.set(environment, services);
        } catch (error) {
            if (isLevelLockedError(error)) {
                console.error(
                    `[TASKS] Task database locked for ${environment}; another service may be running. Exiting.`,
                );
                throw error;
            }
            throw error;
        }
    }

    const fallbackEnvironment = environmentConfig.default;
    const fallbackServices =
        environmentServices.get(fallbackEnvironment) ?? environmentServices.values().next().value;
    if (!fallbackServices) {
        throw new Error("No environments configured for task service");
    }

    const resolveServices = (environment: string): EnvironmentServices =>
        environmentServices.get(environment) ?? fallbackServices;

    const createContext = (opts: { req: http.IncomingMessage; info: { connectionParams?: Record<string, unknown> | null } }):
        TaskServiceContext => {
        const environment = resolveEnvironment(opts.req, opts.info);
        const services = resolveServices(environment);
        return {
            environment,
            taskService: services.taskService,
            taskEventBus: services.taskEventBus,
        };
    };

    const host = process.env.TASKS_HOST ?? "127.0.0.1";
    const portRaw = process.env.TASKS_HTTP_PORT ?? process.env.TASKS_PORT ?? "3006";
    const port = Number.parseInt(portRaw, 10);
    const resolvedPort = Number.isFinite(port) && port > 0 ? port : 3006;

    const server = http.createServer(async (req, res) => {
        const url = req.url ?? "/";
        if (!url.startsWith("/trpc")) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Not found" }));
            return;
        }
        const parsed = new URL(url, `http://${req.headers.host ?? "localhost"}`);
        const basePath = "/trpc";
        const path =
            parsed.pathname === basePath
                ? ""
                : parsed.pathname.startsWith(`${basePath}/`)
                    ? parsed.pathname.slice(basePath.length + 1)
                    : parsed.pathname.slice(1);
        if (!path) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Procedure path missing" }));
            return;
        }
        await nodeHTTPRequestHandler({
            req,
            res,
            router: taskServiceRouter,
            createContext,
            path,
        });
    });

    const wss = new WebSocketServer({ noServer: true });
    applyWSSHandler({
        wss,
        router: taskServiceRouter,
        createContext,
    });

    server.on("upgrade", (req, socket, head) => {
        const url = new URL(req.url ?? "", `http://${req.headers.host ?? "localhost"}`);
        if (url.pathname !== "/trpc") {
            socket.destroy();
            return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
            wss.emit("connection", ws, req);
        });
    });

    return await new Promise((resolve, reject) => {
        server.listen(resolvedPort, host, () => {
            console.log(`[TASKS] Task service listening on http://${host}:${resolvedPort}/trpc`);
            resolve(server);
        });
        server.on("error", (error) => {
            console.error("[TASKS] Failed to start task service:", error);
            reject(error);
        });
    });
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
    startTaskServiceServer().catch((error) => {
        console.error("[TASKS] Fatal error during startup:", error);
        process.exit(1);
    });
}
