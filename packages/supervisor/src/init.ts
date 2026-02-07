import { type ChildProcess, spawn } from "node:child_process";
import {
    createSupervisorServiceCatalog,
    pathExists,
    type SupervisorServiceConfig,
} from "./service-catalog.ts";

// Lightweight supervisor for workers, gateway, and core microservices.
// (auth/profiles/tasks/search/context/gateway).
// - Runs each service in a separate Node process (fresh V8 each time)
// - Optional watch mode delegates file watching to each service's start:watch script
// - Minimal deps, no nodemon/systemd required

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
    "gateway": "@isomorphiq/gateway",
    "worker": "@isomorphiq/worker",
    "mcp-service": "@isomorphiq/mcp",
};

let shuttingDown = false;
const MAX_DELAY_MS = 10000;
const MIN_UPTIME_MS = 5000;
const WORKER_PORT_RANGE_START = 9001;
const WORKER_PORT_RANGE_END = 9099;

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

type ServiceSupervisorOptions = {
    envOverrides?: Record<string, string | undefined>;
    instanceName?: string;
    scriptName?: string;
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
): { start: (reason?: string) => void; stop: (signal?: NodeJS.Signals) => Promise<void> } => {
    let child: ChildProcess | null = null;
    let restartDelayMs = 1000;
    let lastStart = 0;
    const serviceName = options.instanceName ?? config.name;
    const effectiveEnv = {
        ...config.env,
        ...(options.envOverrides ?? {}),
    };

    const start = (reason: string = "boot") => {
        if (child) return;
        if (!pathExists(config.entry)) {
            log(`${serviceName} entry not found at ${config.entry}; skipping.`);
            return;
        }
        lastStart = Date.now();
        const launchMode = WATCH_MODE ? "watch" : "normal";
        log(`Starting ${serviceName} (${reason}, mode=${launchMode})...`);
        const launch = resolveServiceLaunch(config, options);

        child = spawn(launch.command, launch.args, {
            cwd: ROOT,
            env: buildEnv(process.env, effectiveEnv),
            stdio: "inherit",
        });

        child.on("exit", (code, signal) => {
            child = null;
            if (shuttingDown) return;
            if (code === 0 && !signal) {
                log(`${serviceName} exited cleanly (code=0). Not restarting.`);
                return;
            }

            const uptime = Date.now() - lastStart;
            if (uptime > MIN_UPTIME_MS) {
                restartDelayMs = 1000;
            } else {
                restartDelayMs = Math.min(restartDelayMs * 2, MAX_DELAY_MS);
            }

            log(
                `${serviceName} exited (code=${code}, signal=${signal}). Restarting in ${restartDelayMs}ms...`,
            );
            setTimeout(() => start("restart"), restartDelayMs);
        });
    };

    const stop = (signal: NodeJS.Signals = "SIGTERM"): Promise<void> =>
        new Promise((resolve) => {
            if (!child) return resolve();

            const proc = child;
            const killTimer = setTimeout(() => {
                if (proc && !proc.killed) {
                    log(`Force killing ${serviceName} after graceful timeout`);
                    proc.kill("SIGKILL");
                }
            }, 5000);

            proc.once("exit", () => {
                clearTimeout(killTimer);
                child = null;
                resolve();
            });

            proc.kill(signal);
        });

    return { start, stop };
};

const createAuthSupervisor = (): ReturnType<typeof createServiceSupervisor> =>
    createServiceSupervisor(getServiceConfig("auth-service"));

const createProfilesSupervisor = (): ReturnType<typeof createServiceSupervisor> =>
    createServiceSupervisor(getServiceConfig("profiles-service"));

const createTasksSupervisor = (): ReturnType<typeof createServiceSupervisor> =>
    createServiceSupervisor(getServiceConfig("tasks-service"));

const createSearchSupervisor = (): ReturnType<typeof createServiceSupervisor> =>
    createServiceSupervisor(getServiceConfig("search-service"));

const createContextSupervisor = (): ReturnType<typeof createServiceSupervisor> =>
    createServiceSupervisor(getServiceConfig("context-service"));

const createNotificationsSupervisor = (): ReturnType<typeof createServiceSupervisor> =>
    createServiceSupervisor(getServiceConfig("notifications-service"));

const createGatewaySupervisor = (): ReturnType<typeof createServiceSupervisor> =>
    createServiceSupervisor(getServiceConfig("gateway"));

const createMcpSupervisor = (): ReturnType<typeof createServiceSupervisor> =>
    createServiceSupervisor(getServiceConfig("mcp-service"), {
        scriptName: "start",
    });

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

const createWorkerSupervisors = (): Array<ReturnType<typeof createServiceSupervisor>> => {
    const workerConfig = getServiceConfig("worker");
    const workerCount = resolveWorkerCount();
    const maxWorkers = WORKER_PORT_RANGE_END - WORKER_PORT_RANGE_START + 1;
    if (workerCount > maxWorkers) {
        throw new Error(
            `WORKER_COUNT=${workerCount} exceeds supported range size ${maxWorkers} (${WORKER_PORT_RANGE_START}-${WORKER_PORT_RANGE_END})`,
        );
    }

    const gatewayHost = process.env.GATEWAY_HOST ?? "127.0.0.1";
    const gatewayPort = process.env.GATEWAY_PORT ?? "3003";
    const gatewayBaseUrl = `http://${gatewayHost}:${gatewayPort}`;
    return Array.from({ length: workerCount }, (_, index) => {
        const workerPort = WORKER_PORT_RANGE_START + index;
        const workerName = `worker-${index + 1}`;
        return createServiceSupervisor(workerConfig, {
            instanceName: workerName,
            scriptName: WATCH_MODE ? "start:worker:watch" : "start:worker",
            envOverrides: {
                ISOMORPHIQ_WORKER_ID: workerName,
                WORKER_SERVER_PORT: String(workerPort),
                WORKER_GATEWAY_URL: gatewayBaseUrl,
                ACP_MCP_PREFERENCE: "command",
                ISOMORPHIQ_ACP_MCP_PREFERENCE: "command",
            },
        });
    });
};

async function shutdown(signal: NodeJS.Signals) {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`Received ${signal}, shutting down supervisor...`);
    await Promise.all([
        ...workerSupervisors.map((workerSupervisor) => workerSupervisor.stop(signal)),
        mcpSupervisor.stop(signal),
        tasksSupervisor.stop(signal),
        searchSupervisor.stop(signal),
        contextSupervisor.stop(signal),
        notificationsSupervisor.stop(signal),
        authSupervisor.stop(signal),
        profilesSupervisor.stop(signal),
        gatewaySupervisor.stop(signal),
    ]);
    process.exit(0);
}

function main() {
    log(
        `Lightweight worker supervisor starting (mode=${WATCH_MODE ? "watch" : "normal"}, workers=${workerSupervisors.length})`,
    );
    authSupervisor.start("boot");
    profilesSupervisor.start("boot");
    tasksSupervisor.start("boot");
    searchSupervisor.start("boot");
    contextSupervisor.start("boot");
    notificationsSupervisor.start("boot");
    gatewaySupervisor.start("boot");
    mcpSupervisor.start("boot");
    workerSupervisors.forEach((workerSupervisor) => workerSupervisor.start("boot"));

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
}

const workerSupervisors = createWorkerSupervisors();
const mcpSupervisor = createMcpSupervisor();
const tasksSupervisor = createTasksSupervisor();
const searchSupervisor = createSearchSupervisor();
const contextSupervisor = createContextSupervisor();
const notificationsSupervisor = createNotificationsSupervisor();
const authSupervisor = createAuthSupervisor();
const profilesSupervisor = createProfilesSupervisor();
const gatewaySupervisor = createGatewaySupervisor();

main();

export { main as startSupervisor };
