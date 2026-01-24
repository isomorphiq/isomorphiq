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
import { createSchedulingRoutes } from "@isomorphiq/http-api";
import { createTrpcMiddleware, appRouter, type TrpcContext } from "@isomorphiq/http-api";
import { setupWorkflowRoutes } from "@isomorphiq/workflow";
import { createSecurityRoutes } from "@isomorphiq/auth";
import { requestLogger, errorHandler } from "@isomorphiq/api-prelude";
import { ProductManager, InMemoryTaskRepository } from "@isomorphiq/tasks";

export type { AppRouter } from "@isomorphiq/http-api";

export function buildHttpServer(pm: ProductManager): express.Application {
    const app = express();

    app.use(cors());
    app.use(express.json());
    app.use(softAuthContext);
    app.use(requestLogger);

    registerAuthRoutes(app);
    registerAdminRoutes(app);
    registerTaskRoutes(app, pm);
    registerSearchRoutes(app, pm);
    registerProfileRoutes(app, pm);
    registerUserRoutes(app);
    registerMetricsRoutes(app, pm);

    const integrationService = pm.getIntegrationService();
    if (integrationService) {
        app.use("/api/integrations", createIntegrationRoutes(integrationService));
    }

    const taskRepository = new InMemoryTaskRepository();
    app.use("/api/schedule", createSchedulingRoutes(taskRepository));

    app.use("/api/security", createSecurityRoutes());
    setupWorkflowRoutes(app);

    return app;
}

export async function startHttpServer(
    pm: ProductManager,
    port: number = Number(process.env.HTTP_PORT) || 3003,
): Promise<http.Server> {
    const app = buildHttpServer(pm);

    const publicDir = path.join(process.cwd(), "dist");
    app.use(express.static(publicDir));

    const createContext = (): TrpcContext => ({
        pm,
        wsManager: pm.getWebSocketManager(),
    });
    app.use("/trpc", createTrpcMiddleware(pm));

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
        applyWSSHandler({ wss: trpcWss, router: appRouter, createContext });

        server.on("upgrade", (request: http.IncomingMessage, socket: Socket, head: Buffer) => {
            const url = new URL(request.url ?? "", `http://${request.headers.host}`);
            if (url.pathname === "/trpc") {
                trpcWss.handleUpgrade(request, socket, head, (ws) => {
                    trpcWss.emit("connection", ws, request);
                });
                return;
            }

            const wsMgr = pm.getWebSocketManager();
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
    startHttpServer(pm).catch((err) => {
        console.error("[HTTP] Startup error:", err);
        process.exit(1);
    });
}
