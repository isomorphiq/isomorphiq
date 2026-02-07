import type http from "node:http";
import { EventBus, Logger } from "@isomorphiq/core";
import { impl, method } from "@tsimpl/runtime";
import {
    HttpMicroserviceStartOptionsSchema,
    type HttpMicroserviceStartOptions,
    type MicroserviceHealthSnapshot,
    type MicroserviceLifecycleStatus,
} from "./domain.ts";
import { MicroserviceTrait } from "./traits.ts";

type HttpMicroserviceHooks = {
    onStarting?: () => Promise<void>;
    onStarted?: (_server: http.Server) => Promise<void>;
    onStopping?: (signal?: NodeJS.Signals) => Promise<void>;
    onStopped?: () => Promise<void>;
    onError?: (_error: Error) => Promise<void>;
    metadata?: () => Record<string, unknown> | undefined;
};

export type HttpMicroserviceRuntimeOptions = HttpMicroserviceStartOptions & {
    server: http.Server;
    logger?: Logger;
    eventBus?: EventBus;
    hooks?: HttpMicroserviceHooks;
};

export type HttpMicroserviceRuntime = {
    runtime: object;
    server: http.Server;
    logger: Logger;
    eventBus: EventBus;
};

const nowIso = (): string => new Date().toISOString();

const buildEventId = (id: string, eventType: string): string =>
    `${id}-${eventType}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const endpointFrom = (host: string, port: number): string => `http://${host}:${port}`;

const listenServer = (
    server: http.Server,
    host: string,
    port: number,
): Promise<void> =>
    new Promise((resolve, reject) => {
        server.listen(port, host, () => resolve());
        server.once("error", reject);
    });

const closeServer = (server: http.Server): Promise<void> =>
    new Promise((resolve, reject) => {
        server.close((error) => {
            if (error) {
                reject(error);
                return;
            }
            resolve();
        });
    });

export const createHttpMicroserviceRuntime = (
    options: HttpMicroserviceRuntimeOptions,
): HttpMicroserviceRuntime => {
    const normalized = HttpMicroserviceStartOptionsSchema.parse(options);
    const server = options.server;
    const logger = options.logger ?? Logger.create(normalized.id, "microservice");
    const eventBus =
        options.eventBus
        ?? new EventBus({
            enableMetrics: true,
            enablePersistence: false,
            maxListeners: 200,
        });
    const hooks = options.hooks ?? {};
    let status: MicroserviceLifecycleStatus = "stopped";
    let startedAt: string | undefined;

    const publishSystemEvent = async (
        eventType: "system_started" | "system_shutdown" | "error_occurred",
        data: Record<string, unknown>,
    ): Promise<void> => {
        try {
            await eventBus.publish({
                id: buildEventId(normalized.id, eventType),
                type: eventType,
                timestamp: new Date(),
                data,
                metadata: {
                    source: normalized.id,
                    version: "1.0.0",
                },
            });
        } catch (error) {
            logger.warn("Failed to publish microservice event", {
                eventType,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    };

    const readHealth = async (): Promise<MicroserviceHealthSnapshot> => {
        const startedMs = startedAt ? Date.parse(startedAt) : NaN;
        const uptimeMs =
            Number.isFinite(startedMs) && status === "running"
                ? Math.max(0, Date.now() - startedMs)
                : 0;
        return {
            id: normalized.id,
            name: normalized.name,
            kind: normalized.kind,
            status,
            host: normalized.host,
            port: normalized.port,
            endpoint: endpointFrom(normalized.host, normalized.port),
            startedAt,
            updatedAt: nowIso(),
            uptimeMs,
            pid: process.pid,
            metadata: hooks.metadata?.(),
        };
    };

    const runtime = {
        _service: normalized,
        _server: server,
        _eventBus: eventBus,
        _logger: logger,
    };

    impl(MicroserviceTrait).for(runtime, {
        id: method(() => normalized.id),
        name: method(() => normalized.name),
        kind: method(() => normalized.kind),
        status: method(() => status),
        endpoint: method(() => endpointFrom(normalized.host, normalized.port)),
        start: method(async () => {
            if (server.listening) {
                status = "running";
                return;
            }
            status = "starting";
            logger.info(`Starting microservice ${normalized.name}`, {
                host: normalized.host,
                port: normalized.port,
            });
            await hooks.onStarting?.();
            await listenServer(server, normalized.host, normalized.port);
            status = "running";
            startedAt = startedAt ?? nowIso();
            await hooks.onStarted?.(server);
            await publishSystemEvent("system_started", {
                serviceId: normalized.id,
                endpoint: endpointFrom(normalized.host, normalized.port),
                pid: process.pid,
            });
        }),
        stop: method(async (_self: unknown, signal?: NodeJS.Signals) => {
            if (status === "stopped") {
                return;
            }
            status = "stopping";
            logger.info(`Stopping microservice ${normalized.name}`, {
                signal: signal ?? "SIGTERM",
            });
            await hooks.onStopping?.(signal);
            if (server.listening) {
                await closeServer(server);
            }
            status = "stopped";
            await hooks.onStopped?.();
            await publishSystemEvent("system_shutdown", {
                serviceId: normalized.id,
                pid: process.pid,
            });
        }),
        health: method(async () => await readHealth()),
    });

    server.on("error", (error) => {
        status = "error";
        const resolved = error instanceof Error ? error : new Error(String(error));
        logger.error(`Microservice ${normalized.name} server error`, resolved);
        void hooks.onError?.(resolved);
        void publishSystemEvent("error_occurred", {
            serviceId: normalized.id,
            error: resolved.message,
            pid: process.pid,
        });
    });

    server.on("close", () => {
        if (status !== "error") {
            status = "stopped";
        }
    });

    return {
        runtime,
        server,
        logger,
        eventBus,
    };
};

export const startHttpMicroservice = async (
    options: HttpMicroserviceRuntimeOptions,
): Promise<HttpMicroserviceRuntime> => {
    const runtime = createHttpMicroserviceRuntime(options);
    await MicroserviceTrait.start(runtime.runtime as any);
    return runtime;
};
