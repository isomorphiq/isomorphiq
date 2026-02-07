import http from "node:http";
import { randomUUID } from "node:crypto";
import type { Result } from "@isomorphiq/core";
import { ProfileManager } from "@isomorphiq/profiles";
import {
    createTaskClient,
    createTaskServiceClient,
    type TaskClient,
    type TaskServiceApi,
} from "@isomorphiq/tasks";
import { createWorkflowAgentRunner, ProfileWorkflowRunner } from "@isomorphiq/workflow";
import type { TaskActionLog, TaskStatus } from "@isomorphiq/types";

type WorkerRuntime = {
    taskClient: TaskClient;
    taskService: TaskServiceApi;
    workflowRunner: ProfileWorkflowRunner;
};

const readPort = (value: string | undefined, fallback: number): number => {
    if (!value) {
        return fallback;
    }
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const resolveWorkerId = (): string =>
    process.env.ISOMORPHIQ_WORKER_ID
    ?? process.env.WORKER_ID
    ?? `worker-${process.pid}-${randomUUID().slice(0, 8)}`;

const resolveGatewayBaseUrl = (): string => {
    const direct =
        process.env.WORKER_GATEWAY_URL
        ?? process.env.ISOMORPHIQ_GATEWAY_URL
        ?? process.env.GATEWAY_URL;
    if (direct && direct.trim().length > 0) {
        return direct.trim();
    }
    const host = process.env.GATEWAY_HOST ?? "127.0.0.1";
    const port = readPort(process.env.GATEWAY_PORT, 3003);
    return `http://${host}:${port}`;
};

const resolveResult = async <T>(
    action: Promise<Result<T>>,
): Promise<T> => {
    const result = await action;
    if (result.success && result.data !== undefined) {
        return result.data;
    }
    throw result.error ?? new Error("Task service operation failed");
};

const resolveTasksServiceUrl = (): string => {
    const direct =
        process.env.WORKER_TASKS_SERVICE_URL
        ?? process.env.TASKS_SERVICE_URL;
    if (direct && direct.trim().length > 0) {
        return direct.trim();
    }
    return `${resolveGatewayBaseUrl()}/trpc/tasks-service`;
};

const resolveContextServiceUrl = (): string => {
    const direct =
        process.env.WORKER_CONTEXT_SERVICE_URL
        ?? process.env.CONTEXT_SERVICE_URL;
    if (direct && direct.trim().length > 0) {
        return direct.trim();
    }
    return `${resolveGatewayBaseUrl()}/trpc/context-service`;
};

const resolveWorkerServerPort = (): number =>
    readPort(
        process.env.WORKER_SERVER_PORT
        ?? process.env.ISOMORPHIQ_WORKER_SERVER_PORT
        ?? process.env.WORKER_PORT,
        9001,
    );

const applyWorkerAcpMcpDefaults = (
    tasksServiceUrl: string,
    contextServiceUrl: string,
): void => {
    process.env.ACP_MCP_PREFERENCE = process.env.ACP_MCP_PREFERENCE ?? "command";
    process.env.ISOMORPHIQ_ACP_MCP_PREFERENCE =
        process.env.ISOMORPHIQ_ACP_MCP_PREFERENCE ?? "command";
    process.env.TASKS_SERVICE_URL = process.env.TASKS_SERVICE_URL ?? tasksServiceUrl;
    process.env.CONTEXT_SERVICE_URL = process.env.CONTEXT_SERVICE_URL ?? contextServiceUrl;
};

const startWorkerServer = async (
    workerId: string,
    port: number,
): Promise<http.Server> => {
    const server = http.createServer((req, res) => {
        const method = req.method ?? "GET";
        const url = req.url ?? "/";
        if (method === "GET" && url === "/health") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
                JSON.stringify({
                    status: "ok",
                    workerId,
                    pid: process.pid,
                    uptime: process.uptime(),
                    timestamp: new Date().toISOString(),
                }),
            );
            return;
        }
        if (method === "GET" && url === "/worker") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
                JSON.stringify({
                    workerId,
                    pid: process.pid,
                    port,
                    gateway: resolveGatewayBaseUrl(),
                    timestamp: new Date().toISOString(),
                }),
            );
            return;
        }
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not found" }));
    });

    await new Promise<void>((resolve) => {
        server.listen(port, "127.0.0.1", () => resolve());
    });
    console.log(`[WORKER] Worker server listening on http://127.0.0.1:${port}`);
    return server;
};

const createWorkerRuntime = async (
    workerId: string,
    profileManager: ProfileManager,
    tasksServiceUrl: string,
): Promise<WorkerRuntime> => {
    const taskClient = createTaskClient({
        url: tasksServiceUrl,
        enableSubscriptions: false,
    });
    const taskService = createTaskServiceClient(taskClient);
    const workflowAgentRunner = createWorkflowAgentRunner({ profileManager });
    const contextId = workerId;

    const updateTaskStatus = async (
        taskId: string,
        status: TaskStatus,
        updatedBy?: string,
    ): Promise<void> => {
        await resolveResult(taskService.updateTaskStatus(taskId, status, updatedBy ?? workerId));
    };

    const appendTaskActionLogEntry = async (
        taskId: string,
        entry: TaskActionLog,
        fallbackLog?: TaskActionLog[],
    ): Promise<void> => {
        const task = await resolveResult(taskService.getTask(taskId));
        const currentLog = task.actionLog ?? fallbackLog ?? [];
        await resolveResult(
            taskService.updateTask(
                taskId,
                {
                    id: taskId,
                    actionLog: [...currentLog, entry],
                },
                "workflow",
            ),
        );
    };

    const workflowRunner = new ProfileWorkflowRunner({
        taskProvider: async () => await resolveResult(taskService.getAllTasks()),
        taskExecutor: workflowAgentRunner.executeTask,
        contextId,
        workerId,
        updateTaskStatus,
        appendTaskActionLogEntry,
        claimTask: async (taskId: string) => await taskClient.claimTask(taskId, workerId),
    });

    return {
        taskClient,
        taskService,
        workflowRunner,
    };
};

const closeWorkerRuntime = async (runtime: WorkerRuntime): Promise<void> => {
    await runtime.taskClient.close();
};

async function main(): Promise<void> {
    const isTestMode =
        process.env.ISOMORPHIQ_TEST_MODE === "true" || process.env.NODE_ENV === "test";
    const shouldProcessTasks =
        process.env.ISOMORPHIQ_ENABLE_TASK_PROCESSING === "true" || !isTestMode;
    if (!shouldProcessTasks) {
        console.log("[WORKER] Task processing disabled by environment");
        return;
    }

    const workerId = resolveWorkerId();
    const workerServerPort = resolveWorkerServerPort();
    const tasksServiceUrl = resolveTasksServiceUrl();
    const contextServiceUrl = resolveContextServiceUrl();
    applyWorkerAcpMcpDefaults(tasksServiceUrl, contextServiceUrl);

    const profileManager = new ProfileManager();
    await profileManager.waitForProfileOverrides();

    console.log(`[WORKER] Starting worker ${workerId}`);
    console.log(`[WORKER] Tasks service via gateway: ${tasksServiceUrl}`);
    console.log(`[WORKER] Context service via gateway: ${contextServiceUrl}`);
    const workerServer = await startWorkerServer(workerId, workerServerPort);
    const runtime = await createWorkerRuntime(
        workerId,
        profileManager,
        tasksServiceUrl,
    );

    const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
        console.log(`[WORKER] Received ${signal}, shutting down ${workerId}`);
        await new Promise<void>((resolve) => workerServer.close(() => resolve()));
        await closeWorkerRuntime(runtime);
        process.exit(0);
    };
    process.on("SIGINT", () => void shutdown("SIGINT"));
    process.on("SIGTERM", () => void shutdown("SIGTERM"));

    await runtime.workflowRunner.runLoop().catch((error) => {
        console.error(`[WORKER] Workflow loop failed (${workerId}):`, error);
        throw error;
    });
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
    main().catch((error) => {
        console.error("[WORKER] Fatal worker error:", error);
        process.exit(1);
    });
}
