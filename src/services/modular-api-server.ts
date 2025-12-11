import cors from "cors";
import type { NextFunction, Request, Response } from "express";
import express from "express";
import type { ProductManager } from "../index.ts";
import type { AuthCredentials, TaskStatus, User } from "../types.ts";
import type { UserManager } from "../user-manager.ts";

type AuthenticatedRequest = Request & { user?: User };

// Base route handler interface
export type RouteHandler = (
	req: Request,
	res: Response,
	next: NextFunction,
) => Promise<void> | void;

// Middleware interface
export type Middleware = (req: Request, res: Response, next: NextFunction) => void | Promise<void>;

// Route configuration
export interface RouteConfig {
	method: "get" | "post" | "put" | "delete" | "patch";
	path: string;
	handler: RouteHandler;
	middlewares?: Middleware[];
}

// API module interface
export interface ApiModule {
	registerRoutes(app: express.Application): void;
	getPathPrefix(): string;
}

// Authentication middleware factory
export function createAuthMiddleware(userManager: UserManager): Middleware {
	return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
		const authHeader = req.headers.authorization;
		const token = authHeader?.split(" ")[1]; // Bearer TOKEN

		if (!token) {
			res.status(401).json({ error: "Access token required" });
			return;
		}

		try {
			const user = await userManager.validateSession(token);

			if (!user) {
				res.status(401).json({ error: "Invalid or expired token" });
				return;
			}

			// Attach user to request
			req.user = user;
			next();
		} catch (error) {
			console.error("[HTTP API] Authentication error:", error);
			res.status(500).json({ error: "Authentication failed" });
		}
	};
}

// Authorization middleware factory
export function createAuthorizationMiddleware(
	userManager: UserManager,
	resource: string,
	action: string,
): Middleware {
	return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
		const user = req.user;

		if (!user) {
			res.status(401).json({ error: "Authentication required" });
			return;
		}

		try {
			const hasPermission = await userManager.hasPermission(user, resource, action);

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
}

// Validation middleware factory
export function createValidationMiddleware(validator: (body: unknown) => void): Middleware {
	return (req: Request, res: Response, next: NextFunction) => {
		try {
			validator(req.body);
			next();
		} catch (error) {
			res.status(400).json({ error: (error as Error).message });
		}
	};
}

// Error handling middleware
export function errorHandler(
	err: unknown,
	_req: express.Request,
	res: express.Response,
	_next: express.NextFunction,
): void {
	console.error("[HTTP API] Error:", err);
	const message = err instanceof Error ? err.message : "Internal server error";
	res.status(500).json({ error: message });
}

// Rate limiting middleware (simple in-memory implementation)
export function createRateLimitMiddleware(options: { windowMs: number; max: number }): Middleware {
	const requests = new Map<string, { count: number; resetTime: number }>();

	return (req: Request, res: Response, next: NextFunction) => {
		const key = req.ip || "unknown";
		const now = Date.now();
		const windowMs = options.windowMs;

		let requestData = requests.get(key);

		if (!requestData || now > requestData.resetTime) {
			requestData = { count: 0, resetTime: now + windowMs };
			requests.set(key, requestData);
		}

		requestData.count++;

		if (requestData.count > options.max) {
			return res.status(429).json({
				error: "Too many requests",
				retryAfter: Math.ceil((requestData.resetTime - now) / 1000),
			});
		}

		next();
	};
}

// Request logging middleware
export function requestLogger(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
	const start = Date.now();

	res.on("finish", () => {
		const duration = Date.now() - start;
		const user = req.user;
		const userId = user ? user.id : "anonymous";

		console.log(
			`[HTTP API] ${req.method} ${req.path} - ${res.statusCode} - ${duration}ms - User: ${userId}`,
		);
	});

	next();
}

// Health check module
export class HealthModule implements ApiModule {
	getPathPrefix(): string {
		return "/health";
	}

	registerRoutes(app: express.Application): void {
		app.get("/health", (_req, res) => {
			res.json({
				status: "healthy",
				timestamp: new Date().toISOString(),
				service: "Opencode Task Manager REST API",
				uptime: process.uptime(),
				memory: process.memoryUsage(),
			});
		});

		app.get("/health/ready", (_req, res) => {
			// Check if all critical services are ready
			res.json({
				status: "ready",
				timestamp: new Date().toISOString(),
			});
		});

		app.get("/health/live", (_req, res) => {
			// Simple liveness check
			res.json({
				status: "live",
				timestamp: new Date().toISOString(),
			});
		});
	}
}

// Authentication module
export class AuthModule implements ApiModule {
	private userManager: UserManager;

	constructor(userManager: UserManager) {
		this.userManager = userManager;
	}

	getPathPrefix(): string {
		return "/api/auth";
	}

	registerRoutes(app: express.Application): void {
		const authMiddleware = createAuthMiddleware(this.userManager);

		// POST /api/auth/login - User login
		app.post("/login", async (req, res, next) => {
			try {
				const { username, password } = req.body as AuthCredentials;
				console.log(`[HTTP API] POST /api/auth/login - Login attempt: ${username}`);

				if (!username || !password) {
					return res.status(400).json({ error: "Username and password are required" });
				}

				const result = await this.userManager.authenticateUser({
					username,
					password,
				});

				if (result.success) {
					res.json({
						user: result.user,
						token: result.token,
						message: "Login successful",
					});
				} else {
					res.status(401).json({ error: result.error || "Login failed" });
				}
			} catch (error) {
				next(error);
			}
		});

		// POST /api/auth/logout - User logout
		app.post("/logout", async (req, res, next) => {
			try {
				const authHeader = req.headers.authorization;
				const token = authHeader?.split(" ")[1];

				if (!token) {
					return res.status(400).json({ error: "Token required" });
				}

				const success = await this.userManager.logoutUser(token);

				if (success) {
					res.json({ message: "Logout successful" });
				} else {
					res.status(400).json({ error: "Invalid token" });
				}
			} catch (error) {
				next(error);
			}
		});

		// GET /api/auth/me - Get current user info
		app.get("/me", authMiddleware, async (req: AuthenticatedRequest, res, next) => {
			try {
				const user = req.user;
				if (!user) {
					return res.status(401).json({ error: "Authentication required" });
				}
				res.json({ user: { ...user, passwordHash: undefined } });
			} catch (error) {
				next(error);
			}
		});

		// POST /api/auth/refresh - Refresh access token
		app.post("/refresh", async (req, res, next) => {
			try {
				const { refreshToken } = req.body;

				if (!refreshToken) {
					return res.status(400).json({ error: "Refresh token is required" });
				}

				const result = await this.userManager.refreshToken(refreshToken);

				if (result.success) {
					res.json(result);
				} else {
					res.status(401).json({
						error: result.error || "Token refresh failed",
					});
				}
			} catch (error) {
				next(error);
			}
		});
	}
}

// Tasks module
export class TasksModule implements ApiModule {
	private productManager: ProductManager;
	private userManager: UserManager;

	constructor(productManager: ProductManager, userManager: UserManager) {
		this.productManager = productManager;
		this.userManager = userManager;
	}

	getPathPrefix(): string {
		return "/api/tasks";
	}

	registerRoutes(app: express.Application): void {
		const authMiddleware = createAuthMiddleware(this.userManager);
		const createTaskAuth = createAuthorizationMiddleware(this.userManager, "tasks", "create");
		const readTaskAuth = createAuthorizationMiddleware(this.userManager, "tasks", "read");
		const updateTaskAuth = createAuthorizationMiddleware(this.userManager, "tasks", "update");
		const deleteTaskAuth = createAuthorizationMiddleware(this.userManager, "tasks", "delete");

		// GET /api/tasks - List all tasks
		app.get("/", authMiddleware, readTaskAuth, async (req: AuthenticatedRequest, res, next) => {
			try {
				const user = req.user;
				if (!user) {
					return res.status(401).json({ error: "Authentication required" });
				}
				console.log(`[HTTP API] GET /api/tasks - Listing all tasks for user: ${user.username}`);

				// Filter tasks based on user permissions
				const allTasks = await this.productManager.getAllTasks();
				const hasAdminPermission = await this.userManager.hasPermission(user, "tasks", "read");

				let tasks = allTasks;
				if (!hasAdminPermission) {
					// Non-admin users can only see their own tasks
					tasks = await this.productManager.getTasksForUser(user.id);
				}

				res.json({ tasks, count: tasks.length });
			} catch (error) {
				next(error);
			}
		});

		// GET /api/tasks/:id - Get a specific task
		app.get("/:id", authMiddleware, readTaskAuth, async (req: AuthenticatedRequest, res, next) => {
			try {
				const { id } = req.params;
				const user = req.user;
				if (!user) {
					return res.status(401).json({ error: "Authentication required" });
				}
				if (!id) {
					return res.status(400).json({ error: "Task id is required" });
				}

				const tasks = await this.productManager.getAllTasks();
				const task = tasks.find((t) => t.id === id);

				if (!task) {
					return res.status(404).json({ error: "Task not found" });
				}

				// Check if user has permission to read this task
				const hasAccess = await this.productManager.hasTaskAccess(user.id, id, "read");
				if (!hasAccess) {
					return res.status(403).json({
						error: "Insufficient permissions to view this task",
					});
				}

				res.json({ task });
			} catch (error) {
				next(error);
			}
		});

		// POST /api/tasks - Create a new task
		app.post("/", authMiddleware, createTaskAuth, async (req: AuthenticatedRequest, res, next) => {
			try {
				const user = req.user;
				if (!user) {
					return res.status(401).json({ error: "Authentication required" });
				}
				const {
					title,
					description,
					priority = "medium",
					assignedTo,
					collaborators,
					watchers,
					dependencies = [],
				} = req.body;

				console.log(
					`[HTTP API] POST /api/tasks - Creating task: ${title} by user: ${user.username}`,
				);

				// Validation
				if (!title || typeof title !== "string" || title.trim().length === 0) {
					return res
						.status(400)
						.json({ error: "Title is required and must be a non-empty string" });
				}
				if (!description || typeof description !== "string" || description.trim().length === 0) {
					return res
						.status(400)
						.json({ error: "Description is required and must be a non-empty string" });
				}
				if (priority && !["low", "medium", "high"].includes(priority)) {
					return res.status(400).json({ error: "Priority must be one of: low, medium, high" });
				}
				if (!Array.isArray(dependencies)) {
					return res.status(400).json({
						error: "dependencies must be an array of task IDs",
					});
				}

				const task = await this.productManager.createTask(
					title,
					description,
					priority as "low" | "medium" | "high",
					dependencies,
					user.id,
					assignedTo || undefined,
					collaborators || undefined,
					watchers || undefined,
				);
				res.status(201).json({ task });
			} catch (error) {
				next(error);
			}
		});

		// PUT /api/tasks/:id/status - Update task status
		app.put(
			"/:id/status",
			authMiddleware,
			updateTaskAuth,
			async (req: AuthenticatedRequest, res, next) => {
				try {
					const { id } = req.params;
					const user = req.user;
					if (!user) {
						return res.status(401).json({ error: "Authentication required" });
					}
					const { status } = req.body;

					if (!["todo", "in-progress", "done"].includes(status)) {
						return res
							.status(400)
							.json({ error: "Status must be one of: todo, in-progress, done" });
					}

					// Check if user has permission to update this task
					const hasAccess = await this.productManager.hasTaskAccess(user.id, id, "write");
					if (!hasAccess) {
						return res.status(403).json({
							error: "Insufficient permissions to update this task",
						});
					}

					const task = await this.productManager.updateTaskStatus(id, status as TaskStatus);
					res.json({ task });
				} catch (error) {
					next(error);
				}
			},
		);

		// PUT /api/tasks/:id/priority - Update task priority
		app.put(
			"/:id/priority",
			authMiddleware,
			updateTaskAuth,
			async (req: AuthenticatedRequest, res, next) => {
				try {
					const { id } = req.params;
					const user = req.user;
					if (!user) {
						return res.status(401).json({ error: "Authentication required" });
					}
					const { priority } = req.body;

					if (!["low", "medium", "high"].includes(priority)) {
						return res.status(400).json({ error: "Priority must be one of: low, medium, high" });
					}

					// Check if user has permission to update this task
					const hasAccess = await this.productManager.hasTaskAccess(user.id, id, "write");
					if (!hasAccess) {
						return res.status(403).json({
							error: "Insufficient permissions to update this task",
						});
					}

					const task = await this.productManager.updateTaskPriority(
						id,
						priority as "low" | "medium" | "high",
					);
					res.json({ task });
				} catch (error) {
					next(error);
				}
			},
		);

		// DELETE /api/tasks/:id - Delete a task
		app.delete(
			"/:id",
			authMiddleware,
			deleteTaskAuth,
			async (req: AuthenticatedRequest, res, next) => {
				try {
					const { id } = req.params;
					const user = req.user;
					if (!user) {
						return res.status(401).json({ error: "Authentication required" });
					}

					// First check if task exists
					const tasks = await this.productManager.getAllTasks();
					const task = tasks.find((t) => t.id === id);

					if (!task) {
						return res.status(404).json({ error: "Task not found" });
					}

					// Check if user has permission to delete this task
					const hasAccess = await this.productManager.hasTaskAccess(user.id, id, "delete");
					if (!hasAccess) {
						return res.status(403).json({
							error: "Insufficient permissions to delete this task",
						});
					}

					await this.productManager.deleteTask(id);
					res.json({
						success: true,
						message: "Task deleted successfully",
					});
				} catch (error) {
					next(error);
				}
			},
		);
	}
}

// API Server class that orchestrates all modules
export class ModularApiServer {
	private app: express.Application;
	private modules: ApiModule[] = [];
	private productManager: ProductManager;
	private userManager: UserManager;

	constructor(productManager: ProductManager, userManager: UserManager) {
		this.app = express();
		this.productManager = productManager;
		this.userManager = userManager;
		this.setupMiddleware();
		this.registerDefaultModules();
	}

	// Setup global middleware
	private setupMiddleware(): void {
		// CORS
		this.app.use(cors());

		// JSON parsing
		this.app.use(express.json({ limit: "10mb" }));

		// Request logging
		this.app.use(requestLogger);

		// Rate limiting
		this.app.use(
			createRateLimitMiddleware({
				windowMs: 15 * 60 * 1000, // 15 minutes
				max: 100, // limit each IP to 100 requests per windowMs
			}),
		);
	}

	// Register default modules
	private registerDefaultModules(): void {
		this.registerModule(new HealthModule());
		this.registerModule(new AuthModule(this.userManager));
		this.registerModule(new TasksModule(this.productManager, this.userManager));
	}

	// Register a new module
	registerModule(module: ApiModule): void {
		this.modules.push(module);
		const router = express.Router();

		// Register all routes from the module
		module.registerRoutes(router);

		// Mount the router with the module's path prefix
		this.app.use(module.getPathPrefix(), router);

		console.log(
			`[HTTP API] Registered module: ${module.constructor.name} at ${module.getPathPrefix()}`,
		);
	}

	// Get the Express app (for external configuration)
	getApp(): express.Application {
		return this.app;
	}

	// Start the server
	async start(port: number): Promise<void> {
		return new Promise((resolve, reject) => {
			const server = this.app.listen(port, () => {
				console.log(`[HTTP API] Modular API server listening on port ${port}`);
				console.log(`[HTTP API] Registered modules:`);
				this.modules.forEach((module) => {
					console.log(`  - ${module.constructor.name}: ${module.getPathPrefix()}`);
				});
				resolve();
			});

			server.on("error", (err) => {
				console.error("[HTTP API] Failed to start server:", err);
				reject(err);
			});
		});
	}
}
