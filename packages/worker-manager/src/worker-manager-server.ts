import http from "node:http";
import {
    createHttpMicroserviceRuntime,
    MicroserviceTrait,
    writeJsonResponse,
} from "@isomorphiq/core-microservice";
import {
    WorkerReconcileRequestSchema,
    WorkerStartRequestSchema,
    WorkerStopRequestSchema,
} from "./worker-manager-domain.ts";
import {
    createWorkerManagerService,
    parseWorkerStopSignal,
    resolveDesiredWorkerCount,
    resolveWorkerManagerDbPath,
    resolveWorkerManagerHost,
    resolveWorkerManagerPort,
} from "./worker-manager-service.ts";

const readRequestBody = async (req: http.IncomingMessage): Promise<unknown> => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    if (chunks.length === 0) {
        return {};
    }
    const raw = Buffer.concat(chunks).toString("utf8").trim();
    if (raw.length === 0) {
        return {};
    }
    return JSON.parse(raw);
};

const notFound = (res: http.ServerResponse): void => {
    writeJsonResponse(res, 404, {
        error: "Not found",
    });
};

const normalizePath = (value: string): string => value.replace(/\/+$/, "") || "/";

export async function startWorkerManagerServer(): Promise<http.Server> {
    console.log("[WORKER-MANAGER] Starting worker-manager microservice");
    const service = createWorkerManagerService({
        dbPath: resolveWorkerManagerDbPath(),
        workspaceRoot: process.cwd(),
        watchMode: process.env.SUPERVISOR_WATCH === "1",
    });
    await service.open();

    const desiredWorkers = resolveDesiredWorkerCount();
    await service.reconcileWorkers(desiredWorkers);
    console.log(`[WORKER-MANAGER] Initial worker reconciliation complete (desired=${desiredWorkers})`);

    const server = http.createServer(async (req, res) => {
        try {
            const method = req.method ?? "GET";
            const parsedUrl = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
            const pathname = normalizePath(parsedUrl.pathname);

            if (method === "GET" && pathname === "/health") {
                const health = await service.health();
                writeJsonResponse(res, 200, health);
                return;
            }

            if (method === "GET" && pathname === "/workers") {
                const workers = await service.listWorkers();
                writeJsonResponse(res, 200, { workers });
                return;
            }

            if (method === "POST" && pathname === "/workers/reconcile") {
                const body = await readRequestBody(req);
                const input = WorkerReconcileRequestSchema.parse(body);
                const workers = await service.reconcileWorkers(input.desiredCount);
                writeJsonResponse(res, 200, { ok: true, workers });
                return;
            }

            if (method === "POST" && pathname === "/workers/start") {
                const body = await readRequestBody(req);
                const input = WorkerStartRequestSchema.parse(body);
                const worker = await service.startWorker(input);
                writeJsonResponse(res, 200, { ok: true, worker });
                return;
            }

            const workerCommandMatch = /^\/workers\/([^/]+)\/(start|stop)$/.exec(pathname);
            if (method === "POST" && workerCommandMatch) {
                const workerId = decodeURIComponent(workerCommandMatch[1]);
                const action = workerCommandMatch[2];
                if (action === "start") {
                    const body = await readRequestBody(req);
                    const input = WorkerStartRequestSchema.parse(body);
                    const worker = await service.startWorker({
                        ...input,
                        workerId,
                    });
                    writeJsonResponse(res, 200, { ok: true, worker });
                    return;
                }
                if (action === "stop") {
                    const body = await readRequestBody(req);
                    const input = WorkerStopRequestSchema.parse(body);
                    const worker = await service.stopWorker(
                        workerId,
                        parseWorkerStopSignal(input.signal),
                    );
                    writeJsonResponse(res, 200, { ok: true, worker });
                    return;
                }
            }

            notFound(res);
        } catch (error) {
            console.error("[WORKER-MANAGER] Request error:", error);
            const message = error instanceof Error ? error.message : String(error);
            writeJsonResponse(res, 500, {
                ok: false,
                error: message,
            });
        }
    });

    const microservice = createHttpMicroserviceRuntime({
        id: "worker-manager",
        name: "worker-manager",
        kind: "worker-manager",
        host: resolveWorkerManagerHost(),
        port: resolveWorkerManagerPort(),
        server,
        hooks: {
            onStopping: async () => {
                await service.close();
            },
            metadata: () => ({
                desiredWorkers,
            }),
        },
    });

    const host = resolveWorkerManagerHost();
    const port = resolveWorkerManagerPort();

    const close = async (signal?: NodeJS.Signals): Promise<void> => {
        await MicroserviceTrait.stop(microservice.runtime as any, signal);
    };

    process.on("SIGINT", () => {
        void close("SIGINT")
            .catch((error) => {
                console.error("[WORKER-MANAGER] Shutdown failed:", error);
            })
            .finally(() => {
                process.exit(0);
            });
    });
    process.on("SIGTERM", () => {
        void close("SIGTERM")
            .catch((error) => {
                console.error("[WORKER-MANAGER] Shutdown failed:", error);
            })
            .finally(() => {
                process.exit(0);
            });
    });

    await MicroserviceTrait.start(microservice.runtime as any);
    console.log(`[WORKER-MANAGER] Listening on http://${host}:${port}`);
    return microservice.server;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
    startWorkerManagerServer().catch((error) => {
        console.error("[WORKER-MANAGER] Fatal startup error:", error);
        process.exit(1);
    });
}
