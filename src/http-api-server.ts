import type http from "node:http";
import type { Socket } from "node:net";
import path from "node:path";
import { initTRPC } from "@trpc/server";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { applyWSSHandler } from "@trpc/server/adapters/ws";
import { observable } from "@trpc/server/observable";
import cors from "cors";
import express from "express";
import { WebSocketServer } from "ws";
import { registerAuthRoutes } from "./http/routes/auth-routes.ts";
import { registerAdminRoutes } from "./http/routes/admin-routes.ts";
import { registerTaskRoutes } from "./http/routes/task-routes.ts";
import { registerSearchRoutes } from "./http/routes/search-routes.ts";
import { registerProfileRoutes } from "./http/routes/profile-routes.ts";
import { registerUserRoutes } from "./http/routes/user-routes.ts";
import { registerMetricsRoutes } from "./http/routes/metrics-routes.ts";
import { authenticateToken, softAuthContext, type AuthContextRequest } from "./http/middleware.ts";
import { ProductManager } from "./index.ts";
import { InMemoryTaskRepository } from "./repositories/task-repository.ts";
import { createSchedulingRoutes } from "./routes/scheduling-routes.ts";
import { createSecurityRoutes } from "./routes/security-routes.ts";
import { setupWorkflowRoutes } from "./routes/workflow-routes.ts";
import type {
    CreateSavedSearchInput,
    SearchQuery,
    UpdateSavedSearchInput,
    User,
    WebSocketEvent,
} from "./types.ts";
import type { WebSocketManager } from "./websocket-server.ts";
import { getUserManager } from "./user-manager.ts";

// Error handling middleware
const errorHandler = (
	err: unknown,
	_req: express.Request,
	res: express.Response,
	_next: express.NextFunction,
) => {
	const message = err instanceof Error ? err.message : String(err);
	console.error("[HTTP API] Error:", err);
	res.status(500).json({ error: message || "Internal server error" });
};

type AuthenticatedRequest = AuthContextRequest;

// tRPC setup
type TrpcContext = { pm: ProductManager; wsManager?: WebSocketManager };

const t = initTRPC.context<TrpcContext>().create();

const appRouter: ReturnType<typeof t.router> = t.router({
	tasks: t.procedure.query(async ({ ctx }) => ctx.pm.getAllTasks()),
	queue: t.procedure.query(async ({ ctx }) => ctx.pm.getTasksSortedByDependencies()),
	// Advanced search endpoint
	advancedSearch: t.procedure
		.input((query: unknown) => query as SearchQuery)
		.query(async ({ ctx, input }) => {
			return await ctx.pm.searchTasks(input);
		}),
	// Saved searches endpoints
	getSavedSearches: t.procedure
		.input((input: unknown) => input as { userId?: string })
		.query(async ({ ctx, input }) => {
			return await ctx.pm.getSavedSearches(input.userId);
		}),
	getSavedSearch: t.procedure
		.input((input: unknown) => input as { id: string; userId?: string })
		.query(async ({ ctx, input }) => {
			return await ctx.pm.getSavedSearch(input.id, input.userId);
		}),
	createSavedSearch: t.procedure
		.input((input: unknown) => input as { search: CreateSavedSearchInput; userId: string })
		.mutation(async ({ ctx, input }) => {
			return await ctx.pm.createSavedSearch(input.search, input.userId);
		}),
	updateSavedSearch: t.procedure
		.input((input: unknown) => input as { search: UpdateSavedSearchInput; userId: string })
		.mutation(async ({ ctx, input }) => {
			return await ctx.pm.updateSavedSearch(input.search, input.userId);
		}),
	deleteSavedSearch: t.procedure
		.input((input: unknown) => input as { id: string; userId: string })
		.mutation(async ({ ctx, input }) => {
			await ctx.pm.deleteSavedSearch(input.id, input.userId);
			return { success: true };
		}),
	taskUpdates: t.procedure.subscription(({ ctx }) => {
		return observable<WebSocketEvent>((emit) => {
			const wsMgr = ctx.wsManager;
			if (!wsMgr || typeof wsMgr.addListener !== "function") {
				emit.complete();
				return () => {};
			}

			const unsubscribe = wsMgr.addListener((event: WebSocketEvent) => emit.next(event));
			return () => unsubscribe();
		});
	}),
});

export type AppRouter = typeof appRouter;

// Factory to build an Express app bound to an existing ProductManager instance
export function buildHttpApiApp(pm: ProductManager) {
	const app = express();

	// Middleware
	app.use(cors());
	app.use(express.json());
	// Soft auth context to mark authenticated requests for downstream middleware/logging
	app.use(softAuthContext);

	// REST API Endpoints

	// Authentication endpoints
	registerAuthRoutes(app);
	registerAdminRoutes(app);
	registerTaskRoutes(app, pm);
	registerSearchRoutes(app, pm);
	registerProfileRoutes(app, pm);
	registerUserRoutes(app);
	registerMetricsRoutes(app, pm);

	// Scheduling endpoints
	const taskRepository = new InMemoryTaskRepository();
	app.use("/api/schedule", createSchedulingRoutes(taskRepository));

	// Security endpoints
	app.use("/api/security", createSecurityRoutes());

	// Setup workflow routes
	setupWorkflowRoutes(app);

	return app;
}

// Start server helper (used by daemon)
export async function startHttpApi(
	pm: ProductManager,
	port: number = Number(process.env.HTTP_PORT) || 3003,
): Promise<http.Server> {
	const app = buildHttpApiApp(pm);

	// Serve built static assets if present (rsbuild outputs to /dist)
	const publicDir = path.join(process.cwd(), "dist");
	app.use(express.static(publicDir));

	// tRPC HTTP middleware
	const createContext = (): TrpcContext => ({
		pm,
		wsManager: pm.getWebSocketManager(),
	});
	app.use("/trpc", createExpressMiddleware({ router: appRouter, createContext }));

	// 404 handler (placed after API/static)
	app.use((_req, res) => {
		res.status(404).json({ error: "Endpoint not found" });
	});

	// Error handler
	app.use(errorHandler);

	return new Promise((resolve, reject) => {
		const server = app.listen(port, () => {
			console.log(`[HTTP API] REST API server listening on port ${port}`);
			console.log("[HTTP API] Available endpoints:");
			console.log("[HTTP API]   GET    /api/tasks - List all tasks");
			console.log("[HTTP API]   GET    /api/queue - Prioritized task queue (next up)");
			console.log("[HTTP API]   GET    /api/tasks/:id - Get specific task");
			console.log("[HTTP API]   POST   /api/tasks - Create new task");
			console.log("[HTTP API]   PUT    /api/tasks/:id/status - Update task status");
			console.log("[HTTP API]   PUT    /api/tasks/:id/priority - Update task priority");
			console.log("[HTTP API]   DELETE /api/tasks/:id - Delete task");
			console.log("[HTTP API]   GET    /api/tasks/status/:status - Get tasks by status");
			console.log("[HTTP API]   GET    /api/tasks/priority/:priority - Get tasks by priority");
			console.log("[HTTP API]   GET    /api/admin/settings - Get admin settings (admin only)");
			console.log("[HTTP API]   PUT    /api/admin/settings - Update admin settings (admin only)");
			console.log("[HTTP API]   GET    /api/users - List users (admin only)");
			console.log("[HTTP API]   POST   /api/users - Create user (admin only)");
			console.log("[HTTP API]   PUT    /api/users/:id - Update user (admin only)");
			console.log("[HTTP API]   DELETE /api/users/:id - Delete user (admin only)");
			console.log("[HTTP API]   POST   /api/users/:id/unlock - Unlock user (admin only)");
			console.log("[HTTP API]   POST   /api/admin/unlock-all - Unlock all users (admin only)");
			console.log("[HTTP API]   POST   /api/search/advanced - Advanced task search with filtering");
			console.log("[HTTP API]   GET    /api/search/suggestions - Get search suggestions");
			console.log("[HTTP API]   GET    /api/saved-searches - Get saved searches");
			console.log("[HTTP API]   POST   /api/saved-searches - Create saved search");
			console.log("[HTTP API]   GET    /api/saved-searches/:id - Get specific saved search");
			console.log("[HTTP API]   PUT    /api/saved-searches/:id - Update saved search");
			console.log("[HTTP API]   DELETE /api/saved-searches/:id - Delete saved search");
			console.log("[HTTP API]   GET    /api/health - Health check");
			console.log("[HTTP API]   GET    /api/stats - Task statistics");
			console.log("[HTTP API]   GET    /api/analytics - Advanced analytics");
			console.log("[HTTP API]   tRPC   /trpc (http & ws) - tasks, queue, advancedSearch, savedSearches, taskUpdates subscription");
			resolve(server);
		});

		server.on("error", (err) => {
			console.error("[HTTP API] Failed to start server:", err);
			reject(err);
		});

		// tRPC WebSocket handler (shares HTTP server). We also need to let the custom
		// WebSocketManager participate without conflicting upgrade handling. To do that
		// we handle the upgrade event manually and dispatch based on pathname.
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

// Standalone runner (usable via `npm run http-api`)
// Guarded so importing this module (e.g., from the daemon) doesn't auto-start a server.
import { fileURLToPath } from "node:url";

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const pm = new ProductManager();
	startHttpApi(pm).catch((err) => {
		console.error("[HTTP API] Startup error:", err);
		process.exit(1);
	});
}
