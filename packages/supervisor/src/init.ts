import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Lightweight supervisor for the task daemon.
// - Runs the daemon in a separate Node process (fresh V8 each time)
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

let child: ChildProcess | null = null;
let shuttingDown = false;
let restartDelayMs = 1000;
const MAX_DELAY_MS = 10000;
const MIN_UPTIME_MS = 5000;
let lastStart = 0;

const log = (...args: unknown[]) => console.log("[INIT]", ...args);

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

function startDaemon(reason: string = "boot") {
	if (child) return;

	lastStart = Date.now();
	log(`Starting daemon (${reason})...`);
	const interactive = readInteractiveFlag();

	child = spawn("node", ["--experimental-strip-types", DAEMON_ENTRY], {
		cwd: ROOT,
		env: {
			...process.env,
			// Keep TCP enabled by default; can be overridden with SKIP_TCP=true
			SKIP_TCP: process.env.SKIP_TCP ?? "false",
			HTTP_PORT: process.env.HTTP_PORT ?? "3003",
			ACP_SESSION_UPDATE_STREAM: interactive ? process.env.ACP_SESSION_UPDATE_STREAM : "",
			ACP_SESSION_UPDATE_PATH: interactive ? process.env.ACP_SESSION_UPDATE_PATH : "",
			ACP_SESSION_UPDATE_QUIET: interactive
				? process.env.ACP_SESSION_UPDATE_QUIET
				: "0",
		},
		stdio: "inherit",
	});

	child.on("exit", (code, signal) => {
		child = null;
		if (shuttingDown) return;

		const uptime = Date.now() - lastStart;
		if (uptime > MIN_UPTIME_MS) {
			restartDelayMs = 1000; // reset backoff on healthy uptime
		} else {
			restartDelayMs = Math.min(restartDelayMs * 2, MAX_DELAY_MS);
		}

		log(`Daemon exited (code=${code}, signal=${signal}). Restarting in ${restartDelayMs}ms...`);
		setTimeout(() => startDaemon("restart"), restartDelayMs);
	});
}

function stopDaemon(signal: NodeJS.Signals = "SIGTERM"): Promise<void> {
	return new Promise((resolve) => {
		if (!child) return resolve();

		const proc = child;
		const killTimer = setTimeout(() => {
			if (proc && !proc.killed) {
				log("Force killing daemon after graceful timeout");
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
}

async function shutdown(signal: NodeJS.Signals) {
	if (shuttingDown) return;
	shuttingDown = true;
	log(`Received ${signal}, shutting down supervisor...`);
	await stopDaemon(signal);
	process.exit(0);
}

function main() {
	log("Lightweight daemon supervisor starting");
	startDaemon("boot");

	process.on("SIGINT", () => shutdown("SIGINT"));
	process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main();
