import type http from "node:http";
import type { Socket } from "node:net";
import path from "node:path";
import { applyWSSHandler } from "@trpc/server/adapters/ws";
import cors from "cors";
import express from "express";
import { WebSocketServer } from "ws";
import { registerAuthRoutes, registerAdminRoutes, registerUserRoutes, softAuthContext } from "@isomorphiq/auth";
import { createIntegrationRoutes } from "@isomorphiq/integrations";
import { registerTaskRoutes } from "@isomorphiq/http-api";
import { registerSearchRoutes } from "@isomorphiq/http-api";
import { registerProfileRoutes } from "@isomorphiq/http-api";
import { registerMetricsRoutes } from "@isomorphiq/http-api";
import { registerEnvironmentRoutes } from "@isomorphiq/http-api";
import { createSchedulingRoutes } from "@isomorphiq/http-api";
import { createTrpcMiddleware, appRouter, createTrpcContext, type TrpcContext, type ProductManagerResolver } from "@isomorphiq/http-api";
import { setupWorkflowRoutes } from "@isomorphiq/workflow";
import { createSecurityRoutes } from "@isomorphiq/auth";
import { requestLogger, errorHandler } from "@isomorphiq/api-prelude";
import { ProductManager, InMemoryTaskRepository } from "@isomorphiq/tasks";
import type { WebSocketManager } from "@isomorphiq/realtime";
import { ProfileManager } from "@isomorphiq/user-profile";

export type { AppRouter } from "@isomorphiq/http-api";

export type HttpServerResolvers = {
    resolveProductManager: ProductManagerResolver;
    resolveProfileManager?: (req: { headers: http.IncomingHttpHeaders }) => ProfileManager;
    resolveWebSocketManager?: (req: { headers: http.IncomingHttpHeaders }) => WebSocketManager | null;
};

export function buildHttpServer(resolvers: HttpServerResolvers): express.Application {
    const app = express();
    const fallbackProfileManager = new ProfileManager();
    const resolveProfileManager =
        resolvers.resolveProfileManager ?? (() => fallbackProfileManager);

    app.use(cors());
    app.use(express.json());
    app.use(softAuthContext);
    app.use(requestLogger);

    registerAuthRoutes(app);
    registerAdminRoutes(app);
    registerTaskRoutes(app, resolvers.resolveProductManager);
    registerSearchRoutes(app, resolvers.resolveProductManager);
    registerProfileRoutes(app, resolveProfileManager);
    registerUserRoutes(app);
    registerMetricsRoutes(app, resolvers.resolveProductManager);
    registerEnvironmentRoutes(app);

    const integrationRouterCache = new WeakMap<object, express.Router>();
    app.use("/api/integrations", (req, res, next) => {
        const pm = resolvers.resolveProductManager(req);
        const integrationService = pm.getIntegrationService();
        if (!integrationService) {
            res.status(503).json({ error: "Integration service not available" });
            return;
        }
        const cached = integrationRouterCache.get(integrationService as object);
        const router = cached ?? createIntegrationRoutes(integrationService);
        if (!cached) {
            integrationRouterCache.set(integrationService as object, router);
        }
        return router(req, res, next);
    });

    const taskRepository = new InMemoryTaskRepository();
    app.use("/api/schedule", createSchedulingRoutes(taskRepository));

    app.use("/api/security", createSecurityRoutes());
    setupWorkflowRoutes(app);

    return app;
}

export async function startHttpServer(
    resolvers: HttpServerResolvers,
    port: number = Number(process.env.HTTP_PORT) || 3003,
): Promise<http.Server> {
    const app = buildHttpServer(resolvers);

    const publicDir = path.join(process.cwd(), "dist");
    app.use(express.static(publicDir));

    const resolveWsManager =
        resolvers.resolveWebSocketManager
        ?? ((req: { headers: http.IncomingHttpHeaders }) =>
            resolvers.resolveProductManager(req).getWebSocketManager());
    const createContext = (req?: http.IncomingMessage): TrpcContext =>
        createTrpcContext(resolvers.resolveProductManager, req);
    app.use("/trpc", createTrpcMiddleware(resolvers.resolveProductManager));

    app.use((_req, res) => {
        res.status(404).json({ error: "Endpoint not found" });
    });

    app.use(errorHandler);

    return new Promise((resolve, reject) => {
        const server = app.listen(port, () => {
            console.log(`[HTTP] REST API server listening on port ${port}`);
            resolve(server);
        });

        server.on("error", (err) => {
            console.error("[HTTP] Failed to start server:", err);
            reject(err);
        });

        const trpcWss = new WebSocketServer({ noServer: true });
        applyWSSHandler({
            wss: trpcWss,
            router: appRouter,
            createContext: ({ req }) => createContext(req),
        });

        server.on("upgrade", (request: http.IncomingMessage, socket: Socket, head: Buffer) => {
            const url = new URL(request.url ?? "", `http://${request.headers.host}`);
            if (url.pathname === "/trpc") {
                trpcWss.handleUpgrade(request, socket, head, (ws) => {
                    trpcWss.emit("connection", ws, request);
                });
                return;
            }

            const wsMgr = resolveWsManager(request);
            if (wsMgr && typeof wsMgr.handleUpgrade === "function") {
                const handled = wsMgr.handleUpgrade(request, socket, head);
                if (handled) return;
            }

            socket.destroy();
        });
    });
}

import { fileURLToPath } from "node:url";

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const pm = new ProductManager();
    startHttpServer({ resolveProductManager: () => pm }).catch((err) => {
        console.error("[HTTP] Startup error:", err);
        process.exit(1);
    });
}
