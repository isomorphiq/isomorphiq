import { execSync } from "node:child_process";

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

const parseForceFlag = (args: string[]): boolean =>
    args.some((arg) => arg.trim().toLowerCase() === "--force");

const readWorkerPids = (): number[] => {
    const output = execSync("ps -eo pid=,args=", { encoding: "utf8" });
    const lines = output
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

    const matches = lines
        .filter(
            (line) =>
                line.includes("packages/worker/src/worker-daemon.ts")
                || line.includes("packages/worker/src/daemon.ts"),
        )
        .map((line) => line.split(/\s+/, 2)[0])
        .map((pidRaw) => Number.parseInt(pidRaw, 10))
        .filter((pid) => Number.isFinite(pid) && pid > 0 && pid !== process.pid);

    return Array.from(new Set(matches));
};

const terminatePid = async (pid: number, force: boolean): Promise<boolean> => {
    try {
        process.kill(pid, "SIGTERM");
    } catch {
        return !isPidRunning(pid);
    }
    const terminated = await waitForPidExit(pid, 5000);
    if (terminated) {
        return true;
    }
    if (!force) {
        return false;
    }
    try {
        process.kill(pid, "SIGKILL");
    } catch {
        return !isPidRunning(pid);
    }
    return await waitForPidExit(pid, 2000);
};

const main = async (): Promise<void> => {
    const force = parseForceFlag(process.argv.slice(2));
    const pids = readWorkerPids();
    if (pids.length === 0) {
        console.log("[WORKER] No running worker processes found.");
        return;
    }

    console.log(`[WORKER] Stopping ${pids.length} worker process(es): ${pids.join(", ")}`);
    const results = await Promise.all(
        pids.map(async (pid) => ({
            pid,
            stopped: await terminatePid(pid, force),
        })),
    );
    const failed = results.filter((result) => !result.stopped);
    const stopped = results.filter((result) => result.stopped).map((result) => result.pid);
    if (stopped.length > 0) {
        console.log(`[WORKER] Stopped: ${stopped.join(", ")}`);
    }
    if (failed.length > 0) {
        console.error(
            `[WORKER] Failed to stop: ${failed.map((result) => result.pid).join(", ")}.`,
        );
        if (!force) {
            console.error("[WORKER] Re-run with --force to send SIGKILL.");
        }
        process.exitCode = 1;
        return;
    }

    console.log("[WORKER] All worker processes stopped.");
};

main().catch((error) => {
    console.error("[WORKER] Failed to stop workers:", error);
    process.exit(1);
});

