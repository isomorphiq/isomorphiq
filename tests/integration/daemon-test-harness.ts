import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createConnection, createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export type TestDaemonHandle = {
    process: ChildProcessWithoutNullStreams;
    tcpPort: number;
    dbRoot: string;
    cleanup: () => Promise<void>;
};

const getAvailablePort = async (): Promise<number> =>
    new Promise((resolve, reject) => {
        const server = createServer();
        server.on("error", reject);
        server.listen(0, () => {
            const address = server.address();
            if (address && typeof address === "object") {
                const port = address.port;
                server.close(() => resolve(port));
            } else {
                server.close(() => reject(new Error("Failed to resolve ephemeral port")));
            }
        });
    });

const waitForDaemon = async (tcpPort: number, timeoutMs: number): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    const tryOnce = (): Promise<boolean> =>
        new Promise((resolve) => {
            const client = createConnection({ port: tcpPort, host: "localhost" }, () => {
                client.write(`${JSON.stringify({ command: "get_daemon_status", data: {} })}\n`);
            });
            let response = "";
            client.on("data", (data) => {
                response += data.toString();
                try {
                    JSON.parse(response.trim());
                    client.end();
                    resolve(true);
                } catch (_error) {
                    void _error;
                }
            });
            client.on("error", () => resolve(false));
            client.on("close", () => resolve(response.length > 0));
            setTimeout(() => {
                client.destroy();
                resolve(false);
            }, 500);
        });

    while (Date.now() < deadline) {
        const ready = await tryOnce();
        if (ready) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(`Daemon did not become ready on port ${tcpPort}`);
};

export const startTestDaemon = async (): Promise<TestDaemonHandle> => {
    const dbRoot = await mkdtemp(path.join(tmpdir(), "isomorphiq-test-daemon-"));
    const tcpPort = await getAvailablePort();
    const httpPort = await getAvailablePort();
    const dbPath = path.join(dbRoot, "db");
    const savedSearchesPath = path.join(dbRoot, "saved-searches-db");
    const auditPath = path.join(dbRoot, "task-audit");

    const daemonProcess = spawn("yarn", ["run", "daemon"], {
        cwd: process.cwd(),
        env: {
            ...process.env,
            NODE_ENV: "test",
            ISOMORPHIQ_TEST_MODE: "true",
            ISOMORPHIQ_STORAGE_MODE: "memory",
            TCP_PORT: tcpPort.toString(),
            DAEMON_HTTP_PORT: httpPort.toString(),
            DB_PATH: dbPath,
            SAVED_SEARCHES_DB_PATH: savedSearchesPath,
            TASK_AUDIT_DB_PATH: auditPath,
            SKIP_TCP: "false",
        },
        stdio: "pipe",
        shell: true,
    });

    process.env.TCP_PORT = tcpPort.toString();
    process.env.DAEMON_PORT = tcpPort.toString();
    process.env.DAEMON_HOST = "localhost";

    await waitForDaemon(tcpPort, 10_000);

    const cleanup = async (): Promise<void> => {
        if (!daemonProcess.killed) {
            daemonProcess.kill("SIGTERM");
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
        await rm(dbRoot, { recursive: true, force: true });
    };

    return {
        process: daemonProcess,
        tcpPort,
        dbRoot,
        cleanup,
    };
};
