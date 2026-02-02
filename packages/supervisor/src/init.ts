import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Lightweight supervisor for the daemon and core microservices (tasks/search).
// - Runs each service in a separate Node process (fresh V8 each time)
// - Auto-restarts on crash/exit only (no file-watching)
// - Minimal deps, no nodemon/systemd required

const pathExists = (candidate: string): boolean => {
    try {
        fs.accessSync(candidate, fs.constants.F_OK);
        return true;
    } catch {
        return false;
    }
};

const hasDaemonEntry = (root: string): boolean =>
    pathExists(path.join(root, "packages", "daemon", "src", "daemon.ts"));

const hasWorkspaceConfig = (root: string): boolean => {
    const pkgPath = path.join(root, "package.json");
    if (!pathExists(pkgPath)) {
        return false;
    }
    try {
        const raw = fs.readFileSync(pkgPath, "utf8");
        const parsed = JSON.parse(raw) as { workspaces?: unknown };
        return Array.isArray(parsed.workspaces) && parsed.workspaces.length > 0;
    } catch {
        return false;
    }
};

const findRepoRoot = (start: string): string | null => {
    let current = start;
    for (;;) {
        if (hasDaemonEntry(current) || hasWorkspaceConfig(current)) {
            return current;
        }
        const parent = path.dirname(current);
        if (parent === current) {
            return null;
        }
        current = parent;
    }
};

const resolveRoot = (): string => {
    const seeds = [
        process.env.INIT_CWD,
        process.cwd(),
        path.dirname(fileURLToPath(import.meta.url)),
    ].filter((value): value is string => typeof value === "string" && value.length > 0);

    for (const seed of seeds) {
        const found = findRepoRoot(seed);
        if (found) {
            return found;
        }
    }

    return process.cwd();
};

const ROOT = resolveRoot();
const DAEMON_ENTRY = path.join(ROOT, "packages", "daemon", "src", "daemon.ts");
const TASKS_ENTRY = path.join(ROOT, "packages", "tasks", "src", "task-service-server.ts");
const SEARCH_ENTRY = path.join(ROOT, "packages", "search", "src", "search-service-server.ts");
const CONTEXT_ENTRY = path.join(ROOT, "packages", "context", "src", "context-service-server.ts");

let shuttingDown = false;
const MAX_DELAY_MS = 10000;
const MIN_UPTIME_MS = 5000;

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

const readInteractiveFlag = (): boolean => {
    for (const arg of process.argv.slice(2)) {
        if (!arg.startsWith("--interactive")) {
            continue;
        }
        const [, value] = arg.split("=");
        if (!value) {
            return true;
        }
        const normalized = value.trim().toLowerCase();
        if (["false", "0", "no"].includes(normalized)) {
            return false;
        }
        if (["true", "1", "yes"].includes(normalized)) {
            return true;
        }
    }
    return true;
};

const createServiceSupervisor = (config: {
    name: string;
    entry: string;
    env: Record<string, string | undefined>;
}): { start: (reason?: string) => void; stop: (signal?: NodeJS.Signals) => Promise<void> } => {
    let child: ChildProcess | null = null;
    let restartDelayMs = 1000;
    let lastStart = 0;

    const start = (reason: string = "boot") => {
        if (child) return;
        if (!pathExists(config.entry)) {
            log(`${config.name} entry not found at ${config.entry}; skipping.`);
            return;
        }
        lastStart = Date.now();
        log(`Starting ${config.name} (${reason})...`);

        child = spawn("node", ["--experimental-strip-types", config.entry], {
            cwd: ROOT,
            env: buildEnv(process.env, config.env),
            stdio: "inherit",
        });

        child.on("exit", (code, signal) => {
            child = null;
            if (shuttingDown) return;
            if (code === 0 && !signal) {
                log(`${config.name} exited cleanly (code=0). Not restarting.`);
                return;
            }

            const uptime = Date.now() - lastStart;
            if (uptime > MIN_UPTIME_MS) {
                restartDelayMs = 1000;
            } else {
                restartDelayMs = Math.min(restartDelayMs * 2, MAX_DELAY_MS);
            }

            log(
                `${config.name} exited (code=${code}, signal=${signal}). Restarting in ${restartDelayMs}ms...`,
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
                    log(`Force killing ${config.name} after graceful timeout`);
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

const createDaemonSupervisor = (): ReturnType<typeof createServiceSupervisor> => {
    const interactive = readInteractiveFlag();
    return createServiceSupervisor({
        name: "daemon",
        entry: DAEMON_ENTRY,
        env: {
            // Keep TCP enabled by default; can be overridden with SKIP_TCP=true
            SKIP_TCP: process.env.SKIP_TCP ?? "false",
            HTTP_PORT: process.env.HTTP_PORT ?? "3003",
            ACP_SESSION_UPDATE_STREAM: interactive ? process.env.ACP_SESSION_UPDATE_STREAM : "",
            ACP_SESSION_UPDATE_PATH: interactive ? process.env.ACP_SESSION_UPDATE_PATH : "",
            ACP_SESSION_UPDATE_QUIET: interactive
                ? process.env.ACP_SESSION_UPDATE_QUIET
                : "0",
        },
    });
};

const createTasksSupervisor = (): ReturnType<typeof createServiceSupervisor> =>
    createServiceSupervisor({
        name: "tasks-service",
        entry: TASKS_ENTRY,
        env: {},
    });

const createSearchSupervisor = (): ReturnType<typeof createServiceSupervisor> =>
    createServiceSupervisor({
        name: "search-service",
        entry: SEARCH_ENTRY,
        env: {},
    });

const createContextSupervisor = (): ReturnType<typeof createServiceSupervisor> =>
    createServiceSupervisor({
        name: "context-service",
        entry: CONTEXT_ENTRY,
        env: {},
    });

async function shutdown(signal: NodeJS.Signals) {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`Received ${signal}, shutting down supervisor...`);
    await Promise.all([
        daemonSupervisor.stop(signal),
        tasksSupervisor.stop(signal),
        searchSupervisor.stop(signal),
        contextSupervisor.stop(signal),
    ]);
    process.exit(0);
}

function main() {
    log("Lightweight daemon supervisor starting");
    daemonSupervisor.start("boot");
    tasksSupervisor.start("boot");
    searchSupervisor.start("boot");
    contextSupervisor.start("boot");

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
}

const daemonSupervisor = createDaemonSupervisor();
const tasksSupervisor = createTasksSupervisor();
const searchSupervisor = createSearchSupervisor();
const contextSupervisor = createContextSupervisor();

main();

export { main as startSupervisor };
