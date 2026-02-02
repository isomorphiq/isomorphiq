import fs from "node:fs";
import path from "node:path";
import { ConfigManager } from "@isomorphiq/core";

const sleep = (durationMs: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, durationMs));

const isPidRunning = (pid: number): boolean => {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
};

const readLockFile = (lockPath: string): { pid?: number } | null => {
    try {
        const content = fs.readFileSync(lockPath, "utf8");
        const parsed = JSON.parse(content) as { pid?: number };
        return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
        return null;
    }
};

const waitForPidExit = async (pid: number, timeoutMs: number): Promise<boolean> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (!isPidRunning(pid)) {
            return true;
        }
        await sleep(250);
    }
    return !isPidRunning(pid);
};

const resolveLockPath = (): string => {
    const configManager = ConfigManager.getInstance();
    const basePath = configManager.getDatabaseConfig().path;
    const absoluteBase = path.isAbsolute(basePath)
        ? basePath
        : path.join(process.cwd(), basePath);
    return path.join(absoluteBase, "daemon.lock");
};

const parseForceFlag = (args: string[]): boolean =>
    args.some((arg) => arg.trim().toLowerCase() === "--force");

const main = async (): Promise<void> => {
    const lockPath = resolveLockPath();
    if (!fs.existsSync(lockPath)) {
        console.log("[DAEMON] No daemon lock file found. Nothing to kill.");
        return;
    }

    const lock = readLockFile(lockPath);
    const pid = lock?.pid;
    if (!pid || !Number.isFinite(pid)) {
        console.log("[DAEMON] Lock file missing a valid pid. Removing lock file.");
        try {
            fs.unlinkSync(lockPath);
        } catch {
            // ignore cleanup failures
        }
        return;
    }

    if (!isPidRunning(pid)) {
        console.log(`[DAEMON] No running daemon for pid ${pid}. Removing lock file.`);
        try {
            fs.unlinkSync(lockPath);
        } catch {
            // ignore cleanup failures
        }
        return;
    }

    console.log(`[DAEMON] Sending SIGTERM to daemon pid ${pid}...`);
    try {
        process.kill(pid, "SIGTERM");
    } catch (error) {
        console.error("[DAEMON] Failed to send SIGTERM:", error);
        process.exitCode = 1;
        return;
    }

    const terminated = await waitForPidExit(pid, 5000);
    if (!terminated) {
        const force = parseForceFlag(process.argv.slice(2));
        if (!force) {
            console.error(
                "[DAEMON] Daemon did not exit within 5s. Re-run with --force to send SIGKILL.",
            );
            process.exitCode = 1;
            return;
        }
        console.log(`[DAEMON] Sending SIGKILL to daemon pid ${pid}...`);
        try {
            process.kill(pid, "SIGKILL");
        } catch (error) {
            console.error("[DAEMON] Failed to send SIGKILL:", error);
            process.exitCode = 1;
            return;
        }
        const killed = await waitForPidExit(pid, 2000);
        if (!killed) {
            console.error("[DAEMON] Daemon still running after SIGKILL.");
            process.exitCode = 1;
            return;
        }
    }

    try {
        fs.unlinkSync(lockPath);
    } catch {
        // ignore cleanup failures
    }
    console.log("[DAEMON] Daemon stopped and lock released.");
};

main().catch((error) => {
    console.error("[DAEMON] Failed to kill daemon:", error);
    process.exit(1);
});
