import { type ChildProcess, spawn } from "node:child_process";
import path from "node:path";

// Lightweight supervisor for the task daemon.
// - Runs the daemon in a separate Node process (fresh V8 each time)
// - Auto-restarts on crash/exit only (no file-watching)
// - Minimal deps, no nodemon/systemd required

const ROOT = process.cwd();
const DAEMON_ENTRY = path.join(ROOT, "packages", "daemon", "src", "daemon.ts");

let child: ChildProcess | null = null;
let shuttingDown = false;
let restartDelayMs = 1000;
const MAX_DELAY_MS = 10000;
const MIN_UPTIME_MS = 5000;
let lastStart = 0;

const log = (...args: unknown[]) => console.log("[INIT]", ...args);

function startDaemon(reason: string = "boot") {
	if (child) return;

	lastStart = Date.now();
	log(`Starting daemon (${reason})...`);

	child = spawn("node", ["--experimental-strip-types", DAEMON_ENTRY], {
		cwd: ROOT,
		env: {
			...process.env,
			// Keep TCP enabled by default; can be overridden with SKIP_TCP=true
			SKIP_TCP: process.env.SKIP_TCP ?? "false",
			HTTP_PORT: process.env.HTTP_PORT ?? "3003",
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
