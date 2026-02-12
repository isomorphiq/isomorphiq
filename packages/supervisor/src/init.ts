// FILE_CONTEXT: "context-d14128e0-5434-4860-bb71-b33bf0ab219a"

import { type ChildProcess, spawn } from "node:child_process";
import { impl, method } from "@tsimpl/runtime";
import {
    createDelegatingSupervisor,
    reconcileInSupervisorTree,
    stopInSupervisorTree,
    SupervisableTrait,
    SupervisorTrait,
    type SupervisionProcessSnapshot,
    type SupervisionProcessStatus,
} from "@isomorphiq/core-supervision";
import {
    createWorkerManagerClient,
    type WorkerManagerClient,
    type WorkerRecord,
} from "@isomorphiq/worker-manager";
import {
    createSupervisorServiceCatalog,
    pathExists,
    type SupervisorServiceConfig,
} from "./service-catalog.ts";

const { root: ROOT, services } = createSupervisorServiceCatalog();
const serviceById = new Map(
    services.map((service) => [service.id, service] as const),
);
const WATCH_MODE =
    process.env.SUPERVISOR_WATCH === "1"
    || process.argv.includes("--watch");
const serviceWorkspaceById: Record<SupervisorServiceConfig["id"], string> = {
    "auth-service": "@isomorphiq/auth",
    "profiles-service": "@isomorphiq/profiles",
    "tasks-service": "@isomorphiq/tasks",
    "search-service": "@isomorphiq/search",
    "context-service": "@isomorphiq/context",
    "notifications-service": "@isomorphiq/notifications",
    "dashboard-service": "@isomorphiq/dashboard",
    "gateway": "@isomorphiq/gateway",
    "worker-manager": "@isomorphiq/worker-manager",
    "mcp-service": "@isomorphiq/mcp",
};

let shuttingDown = false;
const MAX_DELAY_MS = 10000;
const MIN_UPTIME_MS = 5000;
const WORKER_MANAGER_ID = "worker-manager";

const log = (...args: unknown[]) => console.log("[INIT]", ...args);

const buildEnv = (
    base: NodeJS.ProcessEnv,
    extra: Record<string, string | undefined>,
): NodeJS.ProcessEnv => ({
    ...base,
    ...Object.fromEntries(
        Object.entries(extra).filter(([, value]) => typeof value === "string"),
    ),
});

const getServiceConfig = (
    serviceId: SupervisorServiceConfig["id"],
): SupervisorServiceConfig => {
    const service = serviceById.get(serviceId);
    if (!service) {
        throw new Error(`Supervisor service config missing: ${serviceId}`);
    }
    return service;
};

const nowIso = (): string => new Date().toISOString();

type ServiceSupervisorOptions = {
    envOverrides?: Record<string, string | undefined>;
    instanceName?: string;
    scriptName?: string;
};

type ServiceProcessController = {
    id: string;
    name: string;
    start: (reason?: string) => Promise<void>;
    stop: (signal?: NodeJS.Signals) => Promise<void>;
    restart: () => Promise<void>;
    snapshot: () => Promise<SupervisionProcessSnapshot>;
};

const resolveServiceLaunch = (
    config: SupervisorServiceConfig,
    options?: ServiceSupervisorOptions,
): { command: string; args: string[] } => {
    const workspaceName = serviceWorkspaceById[config.id];
    const scriptName = options?.scriptName ?? (WATCH_MODE ? "start:watch" : "start");
    return {
        command: "yarn",
        args: ["workspace", workspaceName, scriptName],
    };
};

const createServiceSupervisor = (
    config: SupervisorServiceConfig,
    options: ServiceSupervisorOptions = {},
): ServiceProcessController => {
    let child: ChildProcess | null = null;
    let restartDelayMs = 1000;
    let lastStart = 0;
    let status: SupervisionProcessStatus = "stopped";
    let startedAt: string | undefined;
    const serviceName = options.instanceName ?? config.name;
    const serviceId = config.id;
    const effectiveEnv = {
        ...config.env,
        ...(options.envOverrides ?? {}),
    };

    const snapshot = async (): Promise<SupervisionProcessSnapshot> => ({
        id: serviceId,
        name: serviceName,
        kind: "service",
        status,
        pid: child?.pid,
        managedBy: "root-supervisor",
        startedAt,
        updatedAt: nowIso(),
    });

    const start = async (reason: string = "boot"): Promise<void> => {
        if (child) {
            return;
        }
        if (!pathExists(config.entry)) {
            status = "error";
            log(`${serviceName} entry not found at ${config.entry}; skipping.`);
            return;
        }
        lastStart = Date.now();
        status = "starting";
        startedAt = nowIso();
        const launchMode = WATCH_MODE ? "watch" : "normal";
        log(`Starting ${serviceName} (${reason}, mode=${launchMode})...`);
        const launch = resolveServiceLaunch(config, options);

        child = spawn(launch.command, launch.args, {
            cwd: ROOT,
            env: buildEnv(process.env, effectiveEnv),
            stdio: "inherit",
        });

        child.on("spawn", () => {
            status = "running";
            restartDelayMs = 1000;
        });

        child.on("error", (error) => {
            status = "error";
            log(`${serviceName} errored:`, error);
        });

        child.on("exit", (code, signal) => {
            child = null;
            if (shuttingDown) {
                status = "stopped";
                return;
            }
            if (code === 0 && !signal) {
                status = "stopped";
                log(`${serviceName} exited cleanly (code=0). Not restarting.`);
                return;
            }

            status = "error";
            const uptime = Date.now() - lastStart;
            if (uptime > MIN_UPTIME_MS) {
                restartDelayMs = 1000;
            } else {
                restartDelayMs = Math.min(restartDelayMs * 2, MAX_DELAY_MS);
            }

            log(
                `${serviceName} exited (code=${code}, signal=${signal}). Restarting in ${restartDelayMs}ms...`,
            );
            setTimeout(() => {
                void start("restart");
            }, restartDelayMs);
        });
    };

    const stop = async (signal: NodeJS.Signals = "SIGTERM"): Promise<void> => {
        if (!child) {
            status = "stopped";
            return;
        }

        status = "stopping";
        const proc = child;
        await new Promise<void>((resolve) => {
            const killTimer = setTimeout(() => {
                if (proc && !proc.killed) {
                    log(`Force killing ${serviceName} after graceful timeout`);
                    proc.kill("SIGKILL");
                }
            }, 5000);

            proc.once("exit", () => {
                clearTimeout(killTimer);
                child = null;
                status = "stopped";
                resolve();
            });

            proc.kill(signal);
        });
    };

    const restart = async (): Promise<void> => {
        await stop("SIGTERM");
        await start("restart");
    };

    return {
        id: serviceId,
        name: serviceName,
        start,
        stop,
        restart,
        snapshot,
    };
};

const asServiceSupervisable = (controller: ServiceProcessController): object => {
    const supervisable = {
        controller,
    };
    impl(SupervisableTrait).for(supervisable, {
        id: method(() => controller.id),
        kind: method(() => "service"),
        start: method(async () => {
            await controller.start("supervisor-tree");
            return await controller.snapshot();
        }),
        stop: method(async (_self: unknown, signal?: NodeJS.Signals) => {
            await controller.stop(signal);
            return await controller.snapshot();
        }),
        restart: method(async () => {
            await controller.restart();
            return await controller.snapshot();
        }),
        snapshot: method(async () => await controller.snapshot()),
    });
    return supervisable;
};

const resolveWorkerCountFromArgv = (): number | null => {
    const args = process.argv.slice(2);
    const workersPrefix = "--workers=";
    const workerCountPrefix = "--worker-count=";
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg.startsWith(workersPrefix)) {
            const parsed = Number.parseInt(arg.slice(workersPrefix.length).trim(), 10);
            return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
        }
        if (arg.startsWith(workerCountPrefix)) {
            const parsed = Number.parseInt(arg.slice(workerCountPrefix.length).trim(), 10);
            return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
        }
        if (arg === "--workers" || arg === "--worker-count") {
            const nextArg = args[index + 1];
            if (!nextArg || nextArg.startsWith("--")) {
                return null;
            }
            const parsed = Number.parseInt(nextArg.trim(), 10);
            return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
        }
    }
    return null;
};

const resolveWorkerCount = (): number => {
    const fromArgs = resolveWorkerCountFromArgv();
    if (fromArgs !== null) {
        return fromArgs;
    }
    const raw =
        process.env.ISOMORPHIQ_WORKER_COUNT
        ?? process.env.WORKER_COUNT
        ?? "1";
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
        return 1;
    }
    return parsed;
};

const resolveWorkerManagerBaseUrl = (): string => {
    const direct = process.env.WORKER_MANAGER_URL;
    if (direct && direct.trim().length > 0) {
        return direct.trim().replace(/\/+$/, "");
    }
    const hostRaw = process.env.WORKER_MANAGER_HOST ?? "127.0.0.1";
    const host =
        hostRaw === "0.0.0.0" || hostRaw === "::"
            ? "127.0.0.1"
            : hostRaw;
    const rawPort =
        process.env.WORKER_MANAGER_HTTP_PORT
        ?? process.env.WORKER_MANAGER_PORT
        ?? "3012";
    const parsed = Number.parseInt(rawPort, 10);
    const port = Number.isFinite(parsed) && parsed > 0 ? parsed : 3012;
    return `http://${host}:${port}`;
};

const toWorkerSnapshot = (record: WorkerRecord): SupervisionProcessSnapshot => ({
    id: record.id,
    name: record.name,
    kind: "worker",
    status: record.status,
    pid: record.pid,
    managedBy: record.managedBy ?? WORKER_MANAGER_ID,
    startedAt: record.startedAt,
    updatedAt: record.updatedAt,
    metadata: {
        ...(record.metadata ?? {}),
        port: record.port,
        restartCount: record.restartCount,
    },
});

const createWorkerManagerSupervisor = (
    controller: ServiceProcessController,
    client: WorkerManagerClient,
): object => {
    const workerManagerSupervisor = {
        controller,
    };

    impl(SupervisableTrait).for(workerManagerSupervisor, {
        id: method(() => WORKER_MANAGER_ID),
        kind: method(() => "supervisor"),
        start: method(async () => {
            await controller.start("supervisor-tree");
            return await controller.snapshot();
        }),
        stop: method(async (_self: unknown, signal?: NodeJS.Signals) => {
            await controller.stop(signal);
            return await controller.snapshot();
        }),
        restart: method(async () => {
            await controller.restart();
            return await controller.snapshot();
        }),
        snapshot: method(async () => await controller.snapshot()),
    });

    impl(SupervisorTrait).for(workerManagerSupervisor, {
        listProcesses: method(async () => {
            try {
                const workers = await client.listWorkers();
                return workers.map((worker) => toWorkerSnapshot(worker));
            } catch (error) {
                log("Failed to list workers from worker-manager:", error);
                return [];
            }
        }),
        startProcess: method(async (_self: unknown, targetId: string) => {
            try {
                const worker = await client.startWorkerById(targetId, { workerId: targetId });
                return worker ? toWorkerSnapshot(worker) : null;
            } catch (error) {
                log(`Failed to start worker ${targetId}:`, error);
                return null;
            }
        }),
        stopProcess: method(
            async (_self: unknown, targetId: string, signal?: NodeJS.Signals) => {
            try {
                const worker = await client.stopWorker(targetId, signal);
                return worker ? toWorkerSnapshot(worker) : null;
            } catch (error) {
                log(`Failed to stop worker ${targetId}:`, error);
                return null;
            }
            },
        ),
        restartProcess: method(async (_self: unknown, targetId: string) => {
            try {
                await client.stopWorker(targetId, "SIGTERM");
                const worker = await client.startWorkerById(targetId, { workerId: targetId });
                return worker ? toWorkerSnapshot(worker) : null;
            } catch (error) {
                log(`Failed to restart worker ${targetId}:`, error);
                return null;
            }
        }),
        reconcileProcesses: method(async (_self: unknown, desiredCount: number) => {
            try {
                const workers = await client.reconcileWorkers(desiredCount);
                return workers.map((worker) => toWorkerSnapshot(worker));
            } catch (error) {
                log("Failed to reconcile worker pool:", error);
                return [];
            }
        }),
    });

    return workerManagerSupervisor;
};

const waitForWorkerManager = async (
    client: WorkerManagerClient,
    attempts: number = 30,
): Promise<void> => {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        try {
            await client.health();
            return;
        } catch {
            await new Promise((resolve) => setTimeout(resolve, 500));
        }
    }
    throw new Error("worker-manager did not become healthy in time");
};

const rootSupervisor = createDelegatingSupervisor({
    id: "root-supervisor",
    name: "root-supervisor",
    lifecycle: {
        snapshot: async () => ({
            status: "running",
            pid: process.pid,
            managedBy: "system",
        }),
    },
});

const authSupervisor = createServiceSupervisor(getServiceConfig("auth-service"));
const profilesSupervisor = createServiceSupervisor(getServiceConfig("profiles-service"));
const tasksSupervisor = createServiceSupervisor(getServiceConfig("tasks-service"));
const searchSupervisor = createServiceSupervisor(getServiceConfig("search-service"));
const contextSupervisor = createServiceSupervisor(getServiceConfig("context-service"));
const notificationsSupervisor = createServiceSupervisor(getServiceConfig("notifications-service"));
const dashboardSupervisor = createServiceSupervisor(getServiceConfig("dashboard-service"));
const gatewaySupervisor = createServiceSupervisor(getServiceConfig("gateway"));
const mcpSupervisor = createServiceSupervisor(getServiceConfig("mcp-service"), {
    scriptName: "start",
});
const workerManagerProcessSupervisor = createServiceSupervisor(
    getServiceConfig("worker-manager"),
);
const workerManagerClient = createWorkerManagerClient({
    baseUrl: resolveWorkerManagerBaseUrl(),
});
const workerManagerSupervisor = createWorkerManagerSupervisor(
    workerManagerProcessSupervisor,
    workerManagerClient,
);

[
    asServiceSupervisable(authSupervisor),
    asServiceSupervisable(profilesSupervisor),
    asServiceSupervisable(tasksSupervisor),
    asServiceSupervisable(searchSupervisor),
    asServiceSupervisable(contextSupervisor),
    asServiceSupervisable(notificationsSupervisor),
    asServiceSupervisable(dashboardSupervisor),
    asServiceSupervisable(gatewaySupervisor),
    asServiceSupervisable(mcpSupervisor),
    workerManagerSupervisor,
].forEach((supervisable) => {
    rootSupervisor.registerSupervisable(supervisable);
});

const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) {
        return;
    }
    shuttingDown = true;
    log(`Received ${signal}, shutting down supervisor...`);

    try {
        await reconcileInSupervisorTree(rootSupervisor, 0);
    } catch (error) {
        log("Failed to reconcile workers to zero during shutdown:", error);
    }

    const shutdownOrder = [
        WORKER_MANAGER_ID,
        "mcp-service",
        "gateway",
        "dashboard-service",
        "notifications-service",
        "context-service",
        "search-service",
        "tasks-service",
        "profiles-service",
        "auth-service",
    ];
    for (const processId of shutdownOrder) {
        await stopInSupervisorTree(rootSupervisor, processId, signal);
    }
    process.exit(0);
};

async function main(): Promise<void> {
    const desiredWorkers = resolveWorkerCount();
    log(
        `Supervisor tree starting (mode=${WATCH_MODE ? "watch" : "normal"}, desiredWorkers=${desiredWorkers})`,
    );

    const startupOrder: ServiceProcessController[] = [
        authSupervisor,
        profilesSupervisor,
        tasksSupervisor,
        searchSupervisor,
        contextSupervisor,
        notificationsSupervisor,
        dashboardSupervisor,
        gatewaySupervisor,
        mcpSupervisor,
        workerManagerProcessSupervisor,
    ];
    for (const serviceSupervisor of startupOrder) {
        await serviceSupervisor.start("boot");
    }

    await waitForWorkerManager(workerManagerClient);
    await reconcileInSupervisorTree(rootSupervisor, desiredWorkers);
    log(`Worker-manager reconciled to ${desiredWorkers} worker(s)`);

    process.on("SIGINT", () => {
        void shutdown("SIGINT");
    });
    process.on("SIGTERM", () => {
        void shutdown("SIGTERM");
    });
}

main().catch((error) => {
    console.error("[INIT] Fatal supervisor startup error:", error);
    process.exit(1);
});

export { main as startSupervisor };
