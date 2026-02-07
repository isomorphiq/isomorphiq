import { createContextClient, type ContextClient } from "@isomorphiq/context";
import { createTaskClient, type TaskClient } from "@isomorphiq/tasks";
import { fileURLToPath } from "node:url";

const RESET_ACTOR = "workers:reset";
const WORKER_ID_PREFIX = "worker-";

const hasText = (value: string | undefined): value is string =>
    typeof value === "string" && value.trim().length > 0;

const resolveGatewayBaseUrl = (): string => {
    const host = process.env.GATEWAY_HOST ?? "127.0.0.1";
    const parsedPort = Number.parseInt(process.env.GATEWAY_PORT ?? "3003", 10);
    const port = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 3003;
    return `http://${host}:${port}`;
};

const resolveTasksServiceUrl = (): string => {
    const direct =
        process.env.WORKER_TASKS_SERVICE_URL
        ?? process.env.TASKS_SERVICE_URL;
    return hasText(direct) ? direct.trim() : `${resolveGatewayBaseUrl()}/trpc/tasks-service`;
};

const resolveContextServiceUrl = (): string => {
    const direct =
        process.env.WORKER_CONTEXT_SERVICE_URL
        ?? process.env.CONTEXT_SERVICE_URL;
    return hasText(direct) ? direct.trim() : `${resolveGatewayBaseUrl()}/trpc/context-service`;
};

const isWorkerId = (value: string | undefined): boolean =>
    hasText(value) && value.startsWith(WORKER_ID_PREFIX);

const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value);

const hasWorkerContextMarkers = (value: unknown): boolean => {
    if (!isRecord(value)) {
        return false;
    }
    const markerKeys = [
        "currentTaskId",
        "lastTestResult",
        "testStatus",
        "testReport",
        "autoRecovered",
    ];
    return markerKeys.some((key) => key in value);
};

const collectCandidateWorkerIds = (tasks: Awaited<ReturnType<TaskClient["listTasks"]>>): Set<string> =>
    tasks.reduce<Set<string>>((workerIds, task) => {
        if (
            hasText(task.assignedTo)
            && (task.status === "in-progress" || isWorkerId(task.assignedTo))
        ) {
            workerIds.add(task.assignedTo);
        }
        return workerIds;
    }, new Set<string>());

const resetTaskClaims = async (taskClient: TaskClient): Promise<{
    touchedTaskCount: number;
    failedTaskIds: string[];
    workerIds: Set<string>;
}> => {
    const tasks = await taskClient.listTasks();
    const workerIds = collectCandidateWorkerIds(tasks);

    const resetTargets = tasks.filter(
        (task) => task.status === "in-progress" || isWorkerId(task.assignedTo),
    );

    const failures: string[] = [];
    for (const task of resetTargets) {
        const updates = {
            ...(task.status === "in-progress" ? { status: "todo" as const } : {}),
            assignedTo: undefined,
        };

        try {
            await taskClient.updateTask(task.id, updates, RESET_ACTOR);
            console.log(`[RESET-WORKERS] Cleared claim for task ${task.id}`);
        } catch (error) {
            failures.push(task.id);
            console.error(
                `[RESET-WORKERS] Failed to clear claim for task ${task.id}:`,
                error,
            );
        }
    }

    return {
        touchedTaskCount: resetTargets.length,
        failedTaskIds: failures,
        workerIds,
    };
};

const resetWorkerContexts = async (
    contextClient: ContextClient,
    workerIdsFromTasks: ReadonlySet<string>,
): Promise<{ deletedContextCount: number; failedContextIds: string[] }> => {
    const contexts = await contextClient.listContexts();

    const workerContextIds = contexts
        .filter(
            (context) =>
                isWorkerId(context.id)
                || hasWorkerContextMarkers(context.data),
        )
        .map((context) => context.id);
    const candidateIds = new Set<string>([
        ...workerIdsFromTasks,
        ...workerContextIds,
    ]);

    const failures: string[] = [];
    for (const contextId of candidateIds) {
        try {
            await contextClient.deleteContext(contextId);
            console.log(`[RESET-WORKERS] Deleted worker context ${contextId}`);
        } catch (error) {
            failures.push(contextId);
            console.error(
                `[RESET-WORKERS] Failed to delete worker context ${contextId}:`,
                error,
            );
        }
    }

    return {
        deletedContextCount: candidateIds.size - failures.length,
        failedContextIds: failures,
    };
};

async function main(): Promise<void> {
    const isTestMode =
        process.env.ISOMORPHIQ_TEST_MODE === "true" || process.env.NODE_ENV === "test";
    if (isTestMode) {
        console.log("[RESET-WORKERS] Reset disabled in test mode");
        return;
    }

    const tasksServiceUrl = resolveTasksServiceUrl();
    const contextServiceUrl = resolveContextServiceUrl();

    console.log(`[RESET-WORKERS] Tasks service: ${tasksServiceUrl}`);
    console.log(`[RESET-WORKERS] Context service: ${contextServiceUrl}`);

    const taskClient = createTaskClient({
        url: tasksServiceUrl,
        enableSubscriptions: false,
    });
    const contextClient = createContextClient({
        url: contextServiceUrl,
    });

    try {
        const taskReset = await resetTaskClaims(taskClient);
        const contextReset = await resetWorkerContexts(contextClient, taskReset.workerIds);

        console.log(
            `[RESET-WORKERS] Completed. Tasks touched=${taskReset.touchedTaskCount}, task failures=${taskReset.failedTaskIds.length}, contexts deleted=${contextReset.deletedContextCount}, context failures=${contextReset.failedContextIds.length}`,
        );
    } finally {
        await taskClient.close();
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main().catch((error) => {
        console.error("[RESET-WORKERS] Fatal error:", error);
        process.exit(1);
    });
}
