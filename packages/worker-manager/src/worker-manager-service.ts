import path from "node:path";
import { type ChildProcess, spawn } from "node:child_process";
import { resolveScopedLevelDbPath } from "@isomorphiq/core-microservice";
import {
    WorkerRecordSchema,
    type WorkerRecord,
    type WorkerStartRequest,
    type WorkerManagerHealth,
} from "./worker-manager-domain.ts";
import { createWorkerRecordStore } from "./worker-record-store.ts";

type WorkerControl = {
    process: ChildProcess | null;
    expectedRunning: boolean;
    restartDelayMs: number;
    lastStartedAt: number;
};

export type WorkerManagerServiceOptions = {
    managerId?: string;
    dbPath: string;
    workspaceRoot?: string;
    watchMode?: boolean;
    workerPortRangeStart?: number;
    workerPortRangeEnd?: number;
    gatewayBaseUrl?: string;
};

export type WorkerManagerService = {
    open: () => Promise<void>;
    close: () => Promise<void>;
    health: () => Promise<WorkerManagerHealth>;
    listWorkers: () => Promise<readonly WorkerRecord[]>;
    getWorker: (workerId: string) => Promise<WorkerRecord | null>;
    startWorker: (request?: WorkerStartRequest) => Promise<WorkerRecord>;
    stopWorker: (workerId: string, signal?: NodeJS.Signals) => Promise<WorkerRecord | null>;
    reconcileWorkers: (desiredCount: number) => Promise<readonly WorkerRecord[]>;
};

const MAX_RESTART_DELAY_MS = 10000;
const MIN_UPTIME_MS = 5000;
const DEFAULT_RESTART_DELAY_MS = 1000;
const DEFAULT_PORT_RANGE_START = 9001;
const DEFAULT_PORT_RANGE_END = 9099;

const nowIso = (): string => new Date().toISOString();

const toWorkerRecord = (value: WorkerRecord | Record<string, unknown>): WorkerRecord =>
    WorkerRecordSchema.parse(value) as WorkerRecord;

const resolveGatewayBaseUrl = (explicit: string | undefined): string => {
    if (explicit && explicit.trim().length > 0) {
        return explicit.trim();
    }
    const host = process.env.GATEWAY_HOST ?? "127.0.0.1";
    const rawPort = process.env.GATEWAY_PORT ?? "3003";
    const port = Number.parseInt(rawPort, 10);
    const resolvedPort = Number.isFinite(port) && port > 0 ? port : 3003;
    return `http://${host}:${resolvedPort}`;
};

const toWorkerId = (index: number): string => `worker-${index + 1}`;

const normalizeDesiredCount = (value: number): number => {
    if (!Number.isFinite(value) || value < 0) {
        return 0;
    }
    return Math.floor(value);
};

const parseSignal = (value: string | undefined): NodeJS.Signals | undefined => {
    if (!value || value.trim().length === 0) {
        return undefined;
    }
    return value.trim() as NodeJS.Signals;
};

export const createWorkerManagerService = (
    options: WorkerManagerServiceOptions,
): WorkerManagerService => {
    const managerId = options.managerId ?? "worker-manager";
    const workspaceRoot = options.workspaceRoot ?? process.cwd();
    const watchMode = options.watchMode === true;
    const gatewayBaseUrl = resolveGatewayBaseUrl(options.gatewayBaseUrl);
    const workerPortRangeStart =
        options.workerPortRangeStart ?? DEFAULT_PORT_RANGE_START;
    const workerPortRangeEnd = options.workerPortRangeEnd ?? DEFAULT_PORT_RANGE_END;
    const workerRecordStore = createWorkerRecordStore(options.dbPath);
    const records = new Map<string, WorkerRecord>();
    const controls = new Map<string, WorkerControl>();
    const restartTimers = new Map<string, NodeJS.Timeout>();
    let opened = false;
    let shuttingDown = false;

    const stopRestartTimer = (workerId: string): void => {
        const timer = restartTimers.get(workerId);
        if (!timer) {
            return;
        }
        clearTimeout(timer);
        restartTimers.delete(workerId);
    };

    const readControl = (workerId: string): WorkerControl => {
        const existing = controls.get(workerId);
        if (existing) {
            return existing;
        }
        const created: WorkerControl = {
            process: null,
            expectedRunning: false,
            restartDelayMs: DEFAULT_RESTART_DELAY_MS,
            lastStartedAt: 0,
        };
        controls.set(workerId, created);
        return created;
    };

    const persistRecord = async (record: WorkerRecord): Promise<WorkerRecord> => {
        const parsed = toWorkerRecord(record);
        records.set(parsed.id, parsed);
        await workerRecordStore.put(parsed);
        return parsed;
    };

    const updateRecord = async (
        workerId: string,
        patch: Partial<WorkerRecord>,
    ): Promise<WorkerRecord> => {
        const existing = records.get(workerId);
        const fallbackPort = (() => {
            if (existing) {
                return existing.port;
            }
            const indexMatch = /^worker-(\d+)$/.exec(workerId);
            const index = indexMatch ? Number.parseInt(indexMatch[1], 10) - 1 : 0;
            const normalizedIndex = Number.isFinite(index) && index >= 0 ? index : 0;
            const candidate = workerPortRangeStart + normalizedIndex;
            return candidate <= workerPortRangeEnd ? candidate : workerPortRangeStart;
        })();
        const next: WorkerRecord = toWorkerRecord({
            id: workerId,
            name: workerId,
            kind: "worker",
            status: patch.status ?? existing?.status ?? "stopped",
            pid: patch.pid ?? existing?.pid,
            managedBy: managerId,
            startedAt: patch.startedAt ?? existing?.startedAt,
            updatedAt: nowIso(),
            metadata: patch.metadata ?? existing?.metadata,
            port: patch.port ?? existing?.port ?? fallbackPort,
            restartCount: patch.restartCount ?? existing?.restartCount ?? 0,
        });
        return await persistRecord(next);
    };

    const reservePort = (workerId: string, preferredPort?: number): number => {
        const existing = records.get(workerId);
        if (existing?.port) {
            return existing.port;
        }
        if (
            typeof preferredPort === "number"
            && preferredPort >= workerPortRangeStart
            && preferredPort <= workerPortRangeEnd
        ) {
            return preferredPort;
        }
        const usedPorts = new Set(
            Array.from(records.values())
                .filter((record) => record.id !== workerId)
                .map((record) => record.port),
        );
        for (let port = workerPortRangeStart; port <= workerPortRangeEnd; port += 1) {
            if (!usedPorts.has(port)) {
                return port;
            }
        }
        throw new Error(
            `No worker ports available in range ${workerPortRangeStart}-${workerPortRangeEnd}`,
        );
    };

    const spawnWorker = async (
        workerId: string,
        preferredPort?: number,
        fromRestart: boolean = false,
    ): Promise<WorkerRecord> => {
        if (shuttingDown) {
            throw new Error("Worker manager is shutting down");
        }
        const control = readControl(workerId);
        if (control.process) {
            const existing = records.get(workerId);
            if (existing) {
                return existing;
            }
        }
        stopRestartTimer(workerId);
        const workerPort = reservePort(workerId, preferredPort);
        const scriptName = watchMode ? "start:worker:watch" : "start:worker";
        const launch = spawn(
            "yarn",
            ["workspace", "@isomorphiq/worker", scriptName],
            {
                cwd: workspaceRoot,
                env: {
                    ...process.env,
                    ISOMORPHIQ_WORKER_ID: workerId,
                    WORKER_SERVER_PORT: String(workerPort),
                    WORKER_GATEWAY_URL: gatewayBaseUrl,
                    ACP_MCP_PREFERENCE: "command",
                    ISOMORPHIQ_ACP_MCP_PREFERENCE: "command",
                },
                stdio: "inherit",
            },
        );

        controls.set(workerId, {
            ...control,
            process: launch,
            expectedRunning: true,
            lastStartedAt: Date.now(),
        });
        const currentRestartCount = records.get(workerId)?.restartCount ?? 0;
        const createdAt = nowIso();
        const startingRecord = await updateRecord(workerId, {
            status: "starting",
            pid: launch.pid,
            port: workerPort,
            startedAt: createdAt,
            restartCount: fromRestart ? currentRestartCount + 1 : currentRestartCount,
            metadata: {
                gatewayBaseUrl,
            },
        });

        launch.on("spawn", () => {
            void updateRecord(workerId, {
                status: "running",
                pid: launch.pid,
                port: workerPort,
                startedAt: createdAt,
                metadata: {
                    gatewayBaseUrl,
                },
            });
        });

        launch.on("error", (error) => {
            console.error(`[WORKER-MANAGER] Worker ${workerId} failed to start:`, error);
            void updateRecord(workerId, {
                status: "error",
                pid: undefined,
                metadata: {
                    gatewayBaseUrl,
                    error: error.message,
                },
            });
        });

        launch.on("exit", (code, signal) => {
            const currentControl = readControl(workerId);
            controls.set(workerId, {
                ...currentControl,
                process: null,
            });
            const uptime = Date.now() - currentControl.lastStartedAt;
            const shouldRestart = currentControl.expectedRunning && !shuttingDown;
            if (!shouldRestart) {
                void updateRecord(workerId, {
                    status: "stopped",
                    pid: undefined,
                    metadata: {
                        gatewayBaseUrl,
                        exitCode: code,
                        signal,
                    },
                });
                return;
            }
            const restartDelayMs =
                uptime > MIN_UPTIME_MS
                    ? DEFAULT_RESTART_DELAY_MS
                    : Math.min(
                          currentControl.restartDelayMs * 2,
                          MAX_RESTART_DELAY_MS,
                      );
            controls.set(workerId, {
                ...currentControl,
                process: null,
                restartDelayMs,
            });
            void updateRecord(workerId, {
                status: "error",
                pid: undefined,
                metadata: {
                    gatewayBaseUrl,
                    exitCode: code,
                    signal,
                    restartDelayMs,
                },
            });
            const timer = setTimeout(() => {
                restartTimers.delete(workerId);
                void spawnWorker(workerId, workerPort, true).catch((error) => {
                    console.error(
                        `[WORKER-MANAGER] Failed to restart worker ${workerId}:`,
                        error,
                    );
                });
            }, restartDelayMs);
            restartTimers.set(workerId, timer);
        });

        return startingRecord;
    };

    const stopWorker = async (
        workerId: string,
        signal?: NodeJS.Signals,
    ): Promise<WorkerRecord | null> => {
        stopRestartTimer(workerId);
        const control = readControl(workerId);
        controls.set(workerId, {
            ...control,
            expectedRunning: false,
        });
        const resolvedSignal = signal ?? "SIGTERM";
        const child = control.process;
        if (!child) {
            if (!records.has(workerId)) {
                return null;
            }
            return await updateRecord(workerId, {
                status: "stopped",
                pid: undefined,
            });
        }

        await updateRecord(workerId, {
            status: "stopping",
        });

        await new Promise<void>((resolve) => {
            const killTimer = setTimeout(() => {
                if (!child.killed) {
                    child.kill("SIGKILL");
                }
            }, 5000);
            child.once("exit", () => {
                clearTimeout(killTimer);
                resolve();
            });
            child.kill(resolvedSignal);
        });

        const nextControl = readControl(workerId);
        controls.set(workerId, {
            ...nextControl,
            process: null,
            expectedRunning: false,
        });

        return await updateRecord(workerId, {
            status: "stopped",
            pid: undefined,
            metadata: {
                gatewayBaseUrl,
                stoppedBy: managerId,
            },
        });
    };

    const open = async (): Promise<void> => {
        if (opened) {
            return;
        }
        await workerRecordStore.open();
        const existingRecords = await workerRecordStore.list();
        for (const record of existingRecords) {
            records.set(record.id, record);
            controls.set(record.id, {
                process: null,
                expectedRunning: false,
                restartDelayMs: DEFAULT_RESTART_DELAY_MS,
                lastStartedAt: 0,
            });
            await updateRecord(record.id, {
                status: "stopped",
                pid: undefined,
                metadata: {
                    ...(record.metadata ?? {}),
                    recoveredAt: nowIso(),
                },
            });
        }
        opened = true;
    };

    const close = async (): Promise<void> => {
        if (!opened) {
            return;
        }
        shuttingDown = true;
        for (const workerId of Array.from(restartTimers.keys())) {
            stopRestartTimer(workerId);
        }
        const activeWorkers = Array.from(controls.keys());
        for (const workerId of activeWorkers) {
            await stopWorker(workerId, "SIGTERM");
        }
        await workerRecordStore.close();
        opened = false;
    };

    const listWorkers = async (): Promise<readonly WorkerRecord[]> => {
        await open();
        return Array.from(records.values()).sort((left, right) =>
            left.id.localeCompare(right.id),
        );
    };

    const getWorker = async (workerId: string): Promise<WorkerRecord | null> => {
        await open();
        const inMemory = records.get(workerId);
        if (inMemory) {
            return inMemory;
        }
        return await workerRecordStore.get(workerId);
    };

    const startWorker = async (
        request: WorkerStartRequest = {},
    ): Promise<WorkerRecord> => {
        await open();
        const workerId =
            request.workerId && request.workerId.trim().length > 0
                ? request.workerId.trim()
                : toWorkerId(records.size);
        return await spawnWorker(workerId, request.port);
    };

    const reconcileWorkers = async (
        desiredCount: number,
    ): Promise<readonly WorkerRecord[]> => {
        await open();
        const normalizedCount = normalizeDesiredCount(desiredCount);
        const maxWorkers = workerPortRangeEnd - workerPortRangeStart + 1;
        if (normalizedCount > maxWorkers) {
            throw new Error(
                `desiredCount=${normalizedCount} exceeds worker port range capacity ${maxWorkers}`,
            );
        }

        const desiredIds = Array.from(
            { length: normalizedCount },
            (_, index) => toWorkerId(index),
        );
        const desiredSet = new Set(desiredIds);
        const knownIds = new Set<string>([
            ...Array.from(records.keys()),
            ...Array.from(controls.keys()),
        ]);

        for (const workerId of knownIds) {
            if (desiredSet.has(workerId)) {
                continue;
            }
            await stopWorker(workerId, "SIGTERM");
        }

        for (const workerId of desiredIds) {
            const control = readControl(workerId);
            controls.set(workerId, {
                ...control,
                expectedRunning: true,
            });
            if (control.process) {
                continue;
            }
            await spawnWorker(workerId);
        }

        return await listWorkers();
    };

    const health = async (): Promise<WorkerManagerHealth> => {
        await open();
        const workerList = await listWorkers();
        const running = workerList.filter((worker) => worker.status === "running").length;
        return {
            status: "ok",
            service: "worker-manager",
            managerId,
            pid: process.pid,
            workers: {
                running,
                total: workerList.length,
            },
        };
    };

    return {
        open,
        close,
        health,
        listWorkers,
        getWorker,
        startWorker,
        stopWorker,
        reconcileWorkers,
    };
};

export const resolveWorkerManagerDbPath = (): string => {
    const explicit = process.env.WORKER_MANAGER_DB_PATH;
    if (explicit && explicit.trim().length > 0) {
        return path.isAbsolute(explicit)
            ? explicit
            : path.join(process.cwd(), explicit);
    }
    const environment =
        process.env.ISOMORPHIQ_ENVIRONMENT
        ?? process.env.DEFAULT_ENVIRONMENT
        ?? "production";
    return resolveScopedLevelDbPath("worker-manager", { environment });
};

export const resolveWorkerManagerPort = (): number => {
    const raw =
        process.env.WORKER_MANAGER_HTTP_PORT
        ?? process.env.WORKER_MANAGER_PORT
        ?? "3012";
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 3012;
};

export const resolveWorkerManagerHost = (): string =>
    process.env.WORKER_MANAGER_HOST ?? "127.0.0.1";

export const resolveDesiredWorkerCount = (): number => {
    const raw =
        process.env.ISOMORPHIQ_WORKER_COUNT
        ?? process.env.WORKER_COUNT
        ?? "1";
    const parsed = Number.parseInt(raw, 10);
    return normalizeDesiredCount(parsed);
};

export const parseWorkerStopSignal = parseSignal;
