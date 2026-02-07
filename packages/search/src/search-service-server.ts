import http from "node:http";
import path from "node:path";
import { nodeHTTPRequestHandler } from "@trpc/server/adapters/node-http";
import { ConfigManager, resolveEnvironmentFromHeaders } from "@isomorphiq/core";
import { createSearchService, type SearchService } from "./search-service.ts";
import { searchServiceRouter, type SearchServiceContext } from "./search-service-router.ts";

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

const configManager = ConfigManager.getInstance();
const environmentConfig = configManager.getEnvironmentConfig();
const environmentNames = Array.from(new Set(environmentConfig.available));

const resolveBasePath = (): string => {
    const basePath = configManager.getDatabaseConfig().path;
    return path.isAbsolute(basePath) ? basePath : path.join(process.cwd(), basePath);
};

const createEnvironmentService = async (environment: string): Promise<SearchService> => {
    const basePath = resolveBasePath();
    const envPath = path.join(basePath, environment);
    const savedSearchesPath = path.join(envPath, "search", "saved-searches");
    const service = createSearchService({
        savedSearchesPath,
        environment,
    });
    await service.open();
    return service;
};

const resolveEnvironment = (req: http.IncomingMessage): string =>
    resolveEnvironmentFromHeaders(req.headers, environmentConfig);

export async function startSearchServiceServer(): Promise<http.Server> {
    console.log("[SEARCH] Starting search service microservice");

    const environmentServices = new Map<string, SearchService>();
    for (const environment of environmentNames) {
        try {
            const service = await createEnvironmentService(environment);
            environmentServices.set(environment, service);
        } catch (error) {
            if (isLevelLockedError(error)) {
                console.error(
                    `[SEARCH] Saved searches database locked for ${environment}; another service may be running. Exiting.`,
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
        throw new Error("No environments configured for search service");
    }

    const resolveService = (environment: string): SearchService =>
        environmentServices.get(environment) ?? fallbackService;

    const createContext = (opts: { req: http.IncomingMessage }): SearchServiceContext => {
        const environment = resolveEnvironment(opts.req);
        const service = resolveService(environment);
        return {
            environment,
            searchService: service,
        };
    };

    const host = process.env.SEARCH_HOST ?? "127.0.0.1";
    const portRaw = process.env.SEARCH_HTTP_PORT ?? process.env.SEARCH_PORT ?? "3007";
    const port = Number.parseInt(portRaw, 10);
    const resolvedPort = Number.isFinite(port) && port > 0 ? port : 3007;

    const server = http.createServer(async (req, res) => {
        const url = req.url ?? "/";
        const parsed = new URL(url, `http://${req.headers.host ?? "localhost"}`);

        if (req.method === "GET" && parsed.pathname === "/health") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
                JSON.stringify({
                    status: "ok",
                    service: "search-service",
                }),
            );
            return;
        }

        if (!parsed.pathname.startsWith("/trpc")) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Not found" }));
            return;
        }
        const basePath = "/trpc";
        const path =
            parsed.pathname === basePath
                ? ""
                : parsed.pathname.startsWith(`${basePath}/`)
                    ? parsed.pathname.slice(basePath.length + 1)
                    : parsed.pathname.slice(1);
        if (!path) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Procedure path missing" }));
            return;
        }
        await nodeHTTPRequestHandler({
            req,
            res,
            router: searchServiceRouter,
            createContext,
            path,
        });
    });

    return await new Promise((resolve, reject) => {
        server.listen(resolvedPort, host, () => {
            console.log(`[SEARCH] Search service listening on http://${host}:${resolvedPort}/trpc`);
            resolve(server);
        });
        server.on("error", (error) => {
            console.error("[SEARCH] Failed to start search service:", error);
            reject(error);
        });
    });
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
    startSearchServiceServer().catch((error) => {
        console.error("[SEARCH] Fatal error during startup:", error);
        process.exit(1);
    });
}
