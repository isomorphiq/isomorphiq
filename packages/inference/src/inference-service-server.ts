import http from "node:http";
import { nodeHTTPRequestHandler } from "@trpc/server/adapters/node-http";
import {
    createHttpMicroserviceRuntime,
    MicroserviceTrait,
    resolveTrpcProcedurePath,
    tryHandleMicroserviceHealthRequest,
    writeJsonNotFound,
    writeJsonResponse,
} from "@isomorphiq/core-microservice";
import {
    createInferenceSupervisorService,
    type InferenceSupervisorService,
    type InferenceSupervisorServiceOptions,
} from "./inference-supervisor-service.ts";
import {
    inferenceServiceRouter,
    type InferenceServiceContext,
} from "./inference-service-router.ts";

export type InferenceServiceServerOptions = {
    host?: string;
    port?: number;
    service?: InferenceSupervisorService;
    serviceOptions?: InferenceSupervisorServiceOptions;
};

export type InferenceServiceServerHandle = {
    server: http.Server;
    baseUrl: string;
    trpcUrl: string;
    service: InferenceSupervisorService;
    stop: (signal?: NodeJS.Signals) => Promise<void>;
};

const normalizeHost = (hostRaw: string): string =>
    hostRaw === "0.0.0.0" || hostRaw === "::" ? "127.0.0.1" : hostRaw;

const resolveHost = (host: string | undefined): string =>
    normalizeHost(host ?? process.env.INFERENCE_HOST ?? "127.0.0.1");

const resolvePort = (port: number | undefined): number => {
    if (typeof port === "number" && Number.isFinite(port) && port > 0) {
        return Math.floor(port);
    }
    const raw = process.env.INFERENCE_HTTP_PORT ?? process.env.INFERENCE_PORT ?? "3022";
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 3022;
};

export async function startInferenceServiceServer(
    options: InferenceServiceServerOptions = {},
): Promise<InferenceServiceServerHandle> {
    const service =
        options.service
        ?? createInferenceSupervisorService(options.serviceOptions);
    const host = resolveHost(options.host);
    const port = resolvePort(options.port);

    let microservice:
        | ReturnType<typeof createHttpMicroserviceRuntime>
        | null = null;

    const createContext = (): InferenceServiceContext => ({
        inferenceService: service,
    });

    const server = http.createServer(async (req, res) => {
        const parsed = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
        const pathname = parsed.pathname;

        const healthHandled = await tryHandleMicroserviceHealthRequest(
            req,
            res,
            pathname,
            async () => {
                if (!microservice) {
                    throw new Error("Microservice runtime not initialized");
                }
                return await MicroserviceTrait.health(microservice.runtime as any);
            },
        );
        if (healthHandled) {
            return;
        }

        if (!pathname.startsWith("/trpc")) {
            writeJsonNotFound(res);
            return;
        }

        const procedurePath = resolveTrpcProcedurePath(pathname, "/trpc");
        if (!procedurePath) {
            writeJsonResponse(res, 404, {
                error: "Procedure path missing",
            });
            return;
        }

        await nodeHTTPRequestHandler({
            req,
            res,
            router: inferenceServiceRouter,
            createContext,
            path: procedurePath,
        });
    });

    microservice = createHttpMicroserviceRuntime({
        id: "inference-service",
        name: "inference-service",
        kind: "trpc",
        host,
        port,
        server,
        hooks: {
            onStarting: async () => {
                await service.open();
            },
            onStopping: async () => {
                await service.close();
            },
            metadata: () => ({
                trpcPath: "/trpc",
            }),
        },
    });

    await MicroserviceTrait.start(microservice.runtime as any);

    const stop = async (signal?: NodeJS.Signals): Promise<void> => {
        if (!microservice) {
            return;
        }
        await MicroserviceTrait.stop(microservice.runtime as any, signal);
    };

    const baseUrl = `http://${host}:${port}`;
    return {
        server: microservice.server,
        baseUrl,
        trpcUrl: `${baseUrl}/trpc`,
        service,
        stop,
    };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
    startInferenceServiceServer()
        .then((handle) => {
            console.log(`[INFERENCE] Inference service listening on ${handle.trpcUrl}`);
            const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
                await handle.stop(signal);
                process.exit(0);
            };
            process.on("SIGINT", () => {
                void shutdown("SIGINT");
            });
            process.on("SIGTERM", () => {
                void shutdown("SIGTERM");
            });
        })
        .catch((error) => {
            console.error("[INFERENCE] Fatal startup error:", error);
            process.exit(1);
        });
}
