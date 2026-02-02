import http from "node:http";
import path from "node:path";
import { nodeHTTPRequestHandler } from "@trpc/server/adapters/node-http";
import { ConfigManager, resolveEnvironmentFromHeaders, resolveEnvironmentValue } from "@isomorphiq/core";
import { createContextService, type ContextService } from "./context-service.ts";
import { contextServiceRouter, type ContextServiceContext } from "./context-service-router.ts";

const isLevelLockedError = (error: unknown): boolean => {
    if (!error || typeof error !== "object") {
        return false;
    }
    const record = error as Record<string, unknown>;
    const code = record.code;
    if (code === "LEVEL_LOCKED") {
        return true;
    }
    const cause = record.cause as Record<string, unknown> | undefined;
    return Boolean(cause && cause.code === "LEVEL_LOCKED");
};

const readConnectionEnvironment = (info: { connectionParams?: Record<string, unknown> | null } | undefined):
    string | undefined => {
    const params = info?.connectionParams;
    if (!params || typeof params !== "object") {
        return undefined;
    }
    const value = (params as Record<string, unknown>).environment;
    return typeof value === "string" ? value : undefined;
};

const configManager = ConfigManager.getInstance();
const environmentConfig = configManager.getEnvironmentConfig();
const environmentNames = Array.from(new Set(environmentConfig.available));

const resolveBasePath = (): string => {
    const basePath = configManager.getDatabaseConfig().path;
    return path.isAbsolute(basePath) ? basePath : path.join(process.cwd(), basePath);
};

const createEnvironmentService = async (environment: string): Promise<ContextService> => {
    const basePath = resolveBasePath();
    const envPath = path.join(basePath, environment);
    const contextPath = path.join(envPath, "context");
    const service = createContextService({ contextPath });
    await service.open();

    const warmup = await service.listContexts().catch((error) => error as Error);
    if (warmup instanceof Error) {
        if (isLevelLockedError(warmup)) {
            throw warmup;
        }
        console.warn(`[CONTEXT] Failed to warm LevelDB for ${environment}:`, warmup);
    }

    return service;
};

const resolveEnvironment = (
    req: http.IncomingMessage,
    info?: { connectionParams?: Record<string, unknown> | null },
): string => {
    const fromConnection = readConnectionEnvironment(info);
    if (fromConnection) {
        return resolveEnvironmentValue(fromConnection, environmentConfig);
    }
    return resolveEnvironmentFromHeaders(req.headers, environmentConfig);
};

export async function startContextServiceServer(): Promise<http.Server> {
    console.log("[CONTEXT] Starting context service microservice");

    const environmentServices = new Map<string, ContextService>();
    for (const environment of environmentNames) {
        try {
            const service = await createEnvironmentService(environment);
            environmentServices.set(environment, service);
        } catch (error) {
            if (isLevelLockedError(error)) {
                console.error(
                    `[CONTEXT] Context database locked for ${environment}; another service may be running. Exiting.`,
                );
                throw error;
            }
            throw error;
        }
    }

    const fallbackEnvironment = environmentConfig.default;
    const fallbackService =
        environmentServices.get(fallbackEnvironment) ?? environmentServices.values().next().value;
    if (!fallbackService) {
        throw new Error("No environments configured for context service");
    }

    const resolveService = (environment: string): ContextService =>
        environmentServices.get(environment) ?? fallbackService;

    const createContext = (opts: { req: http.IncomingMessage; info: { connectionParams?: Record<string, unknown> | null } }):
        ContextServiceContext => {
        const environment = resolveEnvironment(opts.req, opts.info);
        const service = resolveService(environment);
        return {
            environment,
            contextService: service,
        };
    };

    const host = process.env.CONTEXT_HOST ?? "127.0.0.1";
    const portRaw = process.env.CONTEXT_HTTP_PORT ?? process.env.CONTEXT_PORT ?? "3008";
    const port = Number.parseInt(portRaw, 10);
    const resolvedPort = Number.isFinite(port) && port > 0 ? port : 3008;

    const server = http.createServer(async (req, res) => {
        const url = req.url ?? "/";
        if (!url.startsWith("/trpc")) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Not found" }));
            return;
        }
        const parsed = new URL(url, `http://${req.headers.host ?? "localhost"}`);
        const basePath = "/trpc";
        const pathValue =
            parsed.pathname === basePath
                ? ""
                : parsed.pathname.startsWith(`${basePath}/`)
                    ? parsed.pathname.slice(basePath.length + 1)
                    : parsed.pathname.slice(1);
        if (!pathValue) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Procedure path missing" }));
            return;
        }
        await nodeHTTPRequestHandler({
            req,
            res,
            router: contextServiceRouter,
            createContext,
            path: pathValue,
        });
    });

    return await new Promise((resolve, reject) => {
        server.listen(resolvedPort, host, () => {
            console.log(`[CONTEXT] Context service listening on http://${host}:${resolvedPort}/trpc`);
            resolve(server);
        });
        server.on("error", (error) => {
            console.error("[CONTEXT] Failed to start context service:", error);
            reject(error);
        });
    });
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
    startContextServiceServer().catch((error) => {
        console.error("[CONTEXT] Fatal error during startup:", error);
        process.exit(1);
    });
}
