import cors from "cors";
import type { Request, Response } from "express";
import express from "express";
import type { ProductManager } from "../index.ts";
import type { TaskStatus, User } from "../types.ts";
import type { UserManager } from "../user-manager.ts";

type AuthenticatedRequest = Request & { user?: User };

// Simple modular API server
export class SimpleModularApiServer {
	private app: express.Application;
	private productManager: ProductManager;
	private userManager: UserManager;

	constructor(productManager: ProductManager, userManager: UserManager) {
		this.app = express();
		this.productManager = productManager;
		this.userManager = userManager;
		this.setupMiddleware();
		this.registerRoutes();
	}

	// Setup global middleware
	private setupMiddleware(): void {
		this.app.use(cors());
		this.app.use(express.json({ limit: "10mb" }));
		this.app.use(this.requestLogger.bind(this));
	}

	// Request logging middleware
	private requestLogger(req: Request, res: Response, next: () => void): void {
		const start = Date.now();

		res.on("finish", () => {
			const duration = Date.now() - start;
			console.log(`[HTTP API] ${req.method} ${req.path} - ${res.statusCode} - ${duration}ms`);
		});

		next();
	}

	// Authentication middleware
	private authenticate = async (
		req: AuthenticatedRequest,
		res: Response,
		next: () => void,
	): Promise<void> => {
		const authHeader = req.headers.authorization;
		const token = authHeader?.split(" ")[1];

		if (!token) {
			res.status(401).json({ error: "Access token required" });
			return;
		}

		try {
			const user = await this.userManager.validateSession(token);
			if (!user) {
				res.status(401).json({ error: "Invalid or expired token" });
				return;
			}

			req.user = user;
			next();
		} catch (error) {
			console.error("[HTTP API] Authentication error:", error);
			res.status(500).json({ error: "Authentication failed" });
		}
	};

	// Authorization middleware
	private authorize = (resource: string, action: string) => {
		return async (req: AuthenticatedRequest, res: Response, next: () => void): Promise<void> => {
			const user = req.user;
			if (!user) {
				res.status(401).json({ error: "Authentication required" });
				return;
			}

			try {
				const hasPermission = await this.userManager.hasPermission(user, resource, action);
				if (!hasPermission) {
					res.status(403).json({ error: "Insufficient permissions" });
					return;
				}
				next();
			} catch (error) {
				console.error("[HTTP API] Authorization error:", error);
				res.status(500).json({ error: "Authorization failed" });
			}
		};
	};

	// Register all routes
	private registerRoutes(): void {
		// Health check routes
		this.app.get("/health", (_req, res) => {
			res.json({
				status: "healthy",
				timestamp: new Date().toISOString(),
				service: "Isomorphiq Task Manager REST API",
				uptime: process.uptime(),
				memory: process.memoryUsage(),
			});
		});

		// Authentication routes
		this.app.post("/api/auth/login", async (req, res) => {
			try {
				const { username, password } = req.body;
				if (!username || !password) {
					return res.status(400).json({ error: "Username and password are required" });
				}

				const result = await this.userManager.authenticateUser({ username, password });
				if (result.success) {
					res.json({ user: result.user, token: result.token, message: "Login successful" });
				} else {
					res.status(401).json({ error: result.error || "Login failed" });
				}
			} catch (error) {
				console.error("[HTTP API] Login error:", error);
				res.status(500).json({ error: "Login failed" });
			}
		});

		// Task routes
		this.app.get(
			"/api/tasks",
			this.authenticate,
			this.authorize("tasks", "read"),
			async (req: AuthenticatedRequest, res: Response) => {
				try {
					const user = req.user;
					if (!user) {
						return res.status(401).json({ error: "Authentication required" });
					}
					const allTasks = await this.productManager.getAllTasks();
					const hasAdminPermission = await this.userManager.hasPermission(user, "tasks", "read");

					let tasks = allTasks;
					if (!hasAdminPermission) {
						tasks = await this.productManager.getTasksForUser(user.id);
					}

					res.json({ tasks, count: tasks.length });
				} catch (error) {
					console.error("[HTTP API] Get tasks error:", error);
					res.status(500).json({ error: "Failed to get tasks" });
				}
			},
		);

		this.app.post(
			"/api/tasks",
			this.authenticate,
			this.authorize("tasks", "create"),
			async (req: AuthenticatedRequest, res: Response) => {
				try {
					const user = req.user;
					if (!user) {
						return res.status(401).json({ error: "Authentication required" });
					}
					const { title, description, priority = "medium", dependencies = [] } = req.body;

					if (!title || !description) {
						return res.status(400).json({ error: "Title and description are required" });
					}

					if (!["low", "medium", "high"].includes(priority)) {
						return res.status(400).json({ error: "Priority must be low, medium, or high" });
					}

					if (!Array.isArray(dependencies)) {
						return res.status(400).json({ error: "Dependencies must be an array" });
					}

					const task = await this.productManager.createTask(
						title,
						description,
						priority,
						dependencies,
						user.id,
					);

					res.status(201).json({ task });
				} catch (error) {
					console.error("[HTTP API] Create task error:", error);
					res.status(500).json({ error: "Failed to create task" });
				}
			},
		);

		this.app.get(
			"/api/tasks/:id",
			this.authenticate,
			this.authorize("tasks", "read"),
			async (req: AuthenticatedRequest, res: Response) => {
				try {
					const { id } = req.params;
					const user = req.user;
					if (!user) {
						return res.status(401).json({ error: "Authentication required" });
					}

					const tasks = await this.productManager.getAllTasks();
					const task = tasks.find((t) => t.id === id);

					if (!task) {
						return res.status(404).json({ error: "Task not found" });
					}

					const hasAccess = await this.productManager.hasTaskAccess(user.id, id, "read");
					if (!hasAccess) {
						return res.status(403).json({ error: "Insufficient permissions" });
					}

					res.json({ task });
				} catch (error) {
					console.error("[HTTP API] Get task error:", error);
					res.status(500).json({ error: "Failed to get task" });
				}
			},
		);

		this.app.put(
			"/api/tasks/:id/status",
			this.authenticate,
			this.authorize("tasks", "update"),
			async (req: AuthenticatedRequest, res: Response) => {
				try {
					const { id } = req.params;
					const user = req.user;
					if (!user) {
						return res.status(401).json({ error: "Authentication required" });
					}
					const { status } = req.body;

					if (!["todo", "in-progress", "done"].includes(status)) {
						return res.status(400).json({ error: "Invalid status" });
					}

					const hasAccess = await this.productManager.hasTaskAccess(user.id, id, "write");
					if (!hasAccess) {
						return res.status(403).json({ error: "Insufficient permissions" });
					}

					const task = await this.productManager.updateTaskStatus(id, status as TaskStatus);
					res.json({ task });
				} catch (error) {
					console.error("[HTTP API] Update task status error:", error);
					res.status(500).json({ error: "Failed to update task status" });
				}
			},
		);

		this.app.put(
			"/api/tasks/:id/priority",
			this.authenticate,
			this.authorize("tasks", "update"),
			async (req: AuthenticatedRequest, res: Response) => {
				try {
					const { id } = req.params;
					const user = req.user;
					if (!user) {
						return res.status(401).json({ error: "Authentication required" });
					}
					const { priority } = req.body;

					if (!["low", "medium", "high"].includes(priority)) {
						return res.status(400).json({ error: "Invalid priority" });
					}

					const hasAccess = await this.productManager.hasTaskAccess(user.id, id, "write");
					if (!hasAccess) {
						return res.status(403).json({ error: "Insufficient permissions" });
					}

					const task = await this.productManager.updateTaskPriority(
						id,
						priority as "low" | "medium" | "high",
					);
					res.json({ task });
				} catch (error) {
					console.error("[HTTP API] Update task priority error:", error);
					res.status(500).json({ error: "Failed to update task priority" });
				}
			},
		);

		this.app.delete(
			"/api/tasks/:id",
			this.authenticate,
			this.authorize("tasks", "delete"),
			async (req: AuthenticatedRequest, res: Response) => {
				try {
					const { id } = req.params;
					const user = req.user;
					if (!user) {
						return res.status(401).json({ error: "Authentication required" });
					}

					const tasks = await this.productManager.getAllTasks();
					const task = tasks.find((t) => t.id === id);

					if (!task) {
						return res.status(404).json({ error: "Task not found" });
					}

					const hasAccess = await this.productManager.hasTaskAccess(user.id, id, "delete");
					if (!hasAccess) {
						return res.status(403).json({ error: "Insufficient permissions" });
					}

					await this.productManager.deleteTask(id);
					res.json({ success: true, message: "Task deleted successfully" });
				} catch (error) {
					console.error("[HTTP API] Delete task error:", error);
					res.status(500).json({ error: "Failed to delete task" });
				}
			},
		);

		// 404 handler
		this.app.use((_req, res) => {
			res.status(404).json({ error: "Endpoint not found" });
		});

		// Error handler
		this.app.use((err: unknown, _req: Request, res: Response, _next: () => void) => {
			console.error("[HTTP API] Error:", err);
			const message = err instanceof Error ? err.message : "Internal server error";
			res.status(500).json({ error: message });
		});
	}

	// Get the Express app
	getApp(): express.Application {
		return this.app;
	}

	// Start the server
	async start(port: number): Promise<void> {
		return new Promise((resolve, reject) => {
			const server = this.app.listen(port, () => {
				console.log(`[HTTP API] Simple modular API server listening on port ${port}`);
				console.log("[HTTP API] Available endpoints:");
				console.log("[HTTP API]   GET    /health - Health check");
				console.log("[HTTP API]   POST   /api/auth/login - User login");
				console.log("[HTTP API]   GET    /api/tasks - List tasks");
				console.log("[HTTP API]   POST   /api/tasks - Create task");
				console.log("[HTTP API]   GET    /api/tasks/:id - Get task");
				console.log("[HTTP API]   PUT    /api/tasks/:id/status - Update task status");
				console.log("[HTTP API]   PUT    /api/tasks/:id/priority - Update task priority");
				console.log("[HTTP API]   DELETE /api/tasks/:id - Delete task");
				resolve();
			});

			server.on("error", (err) => {
				console.error("[HTTP API] Failed to start server:", err);
				reject(err);
			});
		});
	}
}
