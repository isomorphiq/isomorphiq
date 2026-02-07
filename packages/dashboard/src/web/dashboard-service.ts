import http from "node:http";
import path from "node:path";
import { ConfigManager, resolveEnvironmentFromHeaders } from "@isomorphiq/core";
import { WebSocketManager } from "@isomorphiq/realtime";
import { createTaskClient, createTaskServiceClient, type TaskClient, type TaskServiceApi } from "@isomorphiq/tasks";
import { DashboardAnalyticsService } from "../services/dashboard-analytics-service.ts";
import { TaskAuditService } from "../services/task-audit-service.ts";
import { DashboardServer } from "./dashboard.ts";

type DashboardEnvironmentServices = {
    environment: string;
    taskManager: Pick<TaskServiceApi, "getAllTasks">;
    webSocketManager: WebSocketManager;
    analyticsService: DashboardAnalyticsService;
};

type RuntimeEnvironmentServices = DashboardEnvironmentServices & {
    taskClient: TaskClient;
};

const readNumber = (value: string | undefined, fallback: number): number => {
    if (!value) {
        return fallback;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const resolveDashboardPort = (): number => readNumber(process.env.DASHBOARD_PORT, 3005);
const resolveDashboardHost = (): string => process.env.DASHBOARD_HOST || "127.0.0.1";

const resolveTasksServiceUrl = (): string => {
    const direct = process.env.DASHBOARD_TASKS_SERVICE_URL ?? process.env.TASKS_SERVICE_URL;
    if (direct && direct.trim().length > 0) {
        return direct.trim();
    }
    const host = process.env.TASKS_HOST || "127.0.0.1";
    const port = readNumber(process.env.TASKS_HTTP_PORT ?? process.env.TASKS_PORT, 3006);
    return `http://${host}:${String(port)}/trpc`;
};

const createEnvironmentServices = async (
    environment: string,
    databasePath: string,
): Promise<RuntimeEnvironmentServices> => {
    const taskClient = createTaskClient({
        environment,
        enableSubscriptions: false,
        url: resolveTasksServiceUrl(),
    });
    const taskService = createTaskServiceClient(taskClient);
    const taskAuditService = new TaskAuditService(path.join(databasePath, "task-audit", environment));
    await taskAuditService.initialize();
    const analyticsService = new DashboardAnalyticsService(taskService, taskAuditService);
    await analyticsService.initialize();
    const webSocketManager = new WebSocketManager({ path: "/dashboard-ws" });

    return {
        environment,
        taskManager: taskService,
        webSocketManager,
        analyticsService,
        taskClient,
    };
};

export async function startDashboardService(): Promise<void> {
    const configManager = ConfigManager.getInstance();
    const environmentConfig = configManager.getEnvironmentConfig();
    const defaultEnvironment = environmentConfig.default;
    const availableEnvironments = environmentConfig.available.length > 0
        ? environmentConfig.available
        : [defaultEnvironment];
    const databasePath = process.env.DB_PATH ?? path.join(process.cwd(), "db");

    const runtimeServices = new Map<string, RuntimeEnvironmentServices>();
    for (const environment of availableEnvironments) {
        const services = await createEnvironmentServices(environment, databasePath);
        runtimeServices.set(environment, services);
    }

    const dashboardServices = new Map<string, DashboardEnvironmentServices>(
        Array.from(runtimeServices.entries()).map(([environment, services]) => [
            environment,
            {
                environment: services.environment,
                taskManager: services.taskManager,
                webSocketManager: services.webSocketManager,
                analyticsService: services.analyticsService,
            },
        ]),
    );

    const resolveEnvironment = (headers: http.IncomingHttpHeaders): string =>
        resolveEnvironmentFromHeaders(headers, environmentConfig);

    const dashboardServer = new DashboardServer(
        dashboardServices,
        resolveEnvironment,
        defaultEnvironment,
    );

    const server = http.createServer((req, res) => {
        const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
        if (url.pathname === "/health") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
                JSON.stringify({
                    status: "ok",
                    service: "dashboard",
                    timestamp: new Date().toISOString(),
                }),
            );
            return;
        }
        dashboardServer.handleRequest(req, res).catch((error) => {
            console.error("[DASHBOARD] Error handling request:", error);
            if (!res.headersSent) {
                res.writeHead(500, { "Content-Type": "application/json" });
            }
            res.end(JSON.stringify({ error: "Internal server error" }));
        });
    });

    await dashboardServer.initializeWebSocketServer(server);

    const host = resolveDashboardHost();
    const port = resolveDashboardPort();
    await new Promise<void>((resolve, reject) => {
        server.listen(port, host, () => {
            resolve();
        });
        server.on("error", reject);
    });

    console.log(`[DASHBOARD] Dashboard service listening on http://${host}:${String(port)}`);
    console.log(`[DASHBOARD] Tasks service source: ${resolveTasksServiceUrl()}`);

    const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
        console.log(`[DASHBOARD] Received ${signal}, shutting down dashboard service`);
        await Promise.allSettled(Array.from(runtimeServices.values()).map(async (services) => {
            await services.taskClient.close();
        }));
        await new Promise<void>((resolve) => {
            server.close(() => resolve());
        });
        process.exit(0);
    };

    process.on("SIGINT", () => {
        void shutdown("SIGINT");
    });
    process.on("SIGTERM", () => {
        void shutdown("SIGTERM");
    });
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
    startDashboardService().catch((error) => {
        console.error("[DASHBOARD] Failed to start dashboard service:", error);
        process.exit(1);
    });
}
