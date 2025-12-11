import type http from "node:http";
import path from "node:path";
import { initTRPC } from "@trpc/server";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { applyWSSHandler } from "@trpc/server/adapters/ws";
import { observable } from "@trpc/server/observable";
import cors from "cors";
import express from "express";
import { WebSocketServer } from "ws";
import { ProductManager } from "./index.ts";
import { InMemoryTaskRepository } from "./repositories/task-repository.ts";
import { createSchedulingRoutes } from "./routes/scheduling-routes.ts";
import { createSecurityRoutes } from "./routes/security-routes.ts";
import { setupWorkflowRoutes } from "./routes/workflow-routes.ts";
import type {
	AuthCredentials,
	ChangePasswordInput,
	CreateUserInput,
	Task,
	TaskStatus,
	UpdateProfileInput,
	UpdateUserInput,
	User,
	WebSocketEvent,
} from "./types.ts";
import { getUserManager } from "./user-manager.ts";
import type { WebSocketManager } from "./websocket-server.ts";

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

// Validation helpers
const validateTaskInput = (title: string, description: string, priority?: string) => {
	if (!title || typeof title !== "string" || title.trim().length === 0) {
		throw new Error("Title is required and must be a non-empty string");
	}
	if (!description || typeof description !== "string" || description.trim().length === 0) {
		throw new Error("Description is required and must be a non-empty string");
	}
	if (priority && !["low", "medium", "high"].includes(priority)) {
		throw new Error("Priority must be one of: low, medium, high");
	}
};

const validateTaskStatus = (status: string) => {
	if (!["todo", "in-progress", "done"].includes(status)) {
		throw new Error("Status must be one of: todo, in-progress, done");
	}
};

const priorityWeight: Record<Task["priority"], number> = {
	high: 0,
	medium: 1,
	low: 2,
};

type AuthenticatedRequest = express.Request & { user?: User };

// Search and filter types
interface SearchQuery {
	q?: string; // Full-text search query
	status?: TaskStatus[];
	priority?: Task["priority"][];
	dateFrom?: string; // ISO date string
	dateTo?: string; // ISO date string
	limit?: number;
	offset?: number;
}

interface SearchResult {
	tasks: Task[];
	total: number;
	query: SearchQuery;
	highlights?: {
		taskId: string;
		titleMatches?: number[];
		descriptionMatches?: number[];
	};
}

// Simple text search and relevance scoring
function searchTasks(
	tasks: Task[],
	query: string,
): {
	task: Task;
	score: number;
	matches?: { title: number[]; description: number[] };
}[] {
	if (!query || query.trim().length === 0) {
		return tasks.map((task) => ({ task, score: 0 }));
	}

	const searchTerms = query
		.toLowerCase()
		.split(/\s+/)
		.filter((term) => term.length > 0);

	return tasks
		.map((task) => {
			const title = task.title.toLowerCase();
			const description = task.description.toLowerCase();

			let score = 0;
			const titleMatches: number[] = [];
			const descriptionMatches: number[] = [];

			searchTerms.forEach((term) => {
				// Title matches (higher weight)
				let titleIndex = title.indexOf(term);
				while (titleIndex !== -1) {
					score += 10; // Title matches get 10 points
					titleMatches.push(titleIndex);
					titleIndex = title.indexOf(term, titleIndex + 1);
				}

				// Description matches (lower weight)
				let descIndex = description.indexOf(term);
				while (descIndex !== -1) {
					score += 5; // Description matches get 5 points
					descriptionMatches.push(descIndex);
					descIndex = description.indexOf(term, descIndex + 1);
				}
			});

			// Exact phrase match bonus
			if (title.includes(query.toLowerCase()) || description.includes(query.toLowerCase())) {
				score += 20;
			}

			const result: {
				task: Task;
				score: number;
				matches?: { title: number[]; description: number[] };
			} = {
				task,
				score,
			};

			if (titleMatches.length > 0 || descriptionMatches.length > 0) {
				result.matches = {
					title: titleMatches,
					description: descriptionMatches,
				};
			}

			return result;
		})
		.filter((result) => result.score > 0)
		.sort((a, b) => b.score - a.score);
}

// tRPC setup
type TrpcContext = { pm: ProductManager; wsManager?: WebSocketManager };

const t = initTRPC.context<TrpcContext>().create();

const appRouter = t.router({
	tasks: t.procedure.query(async ({ ctx }) => ctx.pm.getAllTasks()),
	queue: t.procedure.query(async ({ ctx }) => ctx.pm.getTasksSortedByDependencies()),
	searchTasks: t.procedure
		.input((query: unknown) => query as SearchQuery)
		.query(async ({ ctx, input }) => {
			const allTasks = (await ctx.pm.getAllTasks()) ?? [];
			let filteredTasks = allTasks;

			// Apply filters
			if (input.status && input.status.length > 0) {
				filteredTasks = filteredTasks.filter((task) => input.status?.includes(task.status));
			}

			if (input.priority && input.priority.length > 0) {
				filteredTasks = filteredTasks.filter((task) => input.priority?.includes(task.priority));
			}

			if (input.dateFrom) {
				const fromDate = new Date(input.dateFrom);
				filteredTasks = filteredTasks.filter((task) => new Date(task.createdAt) >= fromDate);
			}

			if (input.dateTo) {
				const toDate = new Date(input.dateTo);
				filteredTasks = filteredTasks.filter((task) => new Date(task.createdAt) <= toDate);
			}

			// Apply text search
			let searchResults: {
				task: Task;
				score: number;
				matches?: { title: number[]; description: number[] };
			}[];
			if (input.q && input.q.trim().length > 0) {
				searchResults = searchTasks(filteredTasks, input.q);
			} else {
				searchResults = filteredTasks.map((task) => ({
					task,
					score: 0,
				}));
			}

			// Apply pagination
			const total = searchResults.length;
			const offset = input.offset || 0;
			const limit = input.limit || 50;
			const paginatedResults = searchResults.slice(offset, offset + limit);

			// Prepare highlights
			const highlights: Record<string, { titleMatches?: number[]; descriptionMatches?: number[] }> =
				{};
			paginatedResults.forEach((result) => {
				if (result.matches) {
					highlights[result.task.id] = {
						titleMatches: result.matches.title,
						descriptionMatches: result.matches.description,
					};
				}
			});

			return {
				tasks: paginatedResults.map((result) => result.task),
				total,
				query: input,
				highlights: Object.keys(highlights).length > 0 ? highlights : undefined,
			} as SearchResult;
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

// Authentication middleware
const authenticateToken = async (
	req: AuthenticatedRequest,
	res: express.Response,
	next: express.NextFunction,
) => {
	const authHeader = req.headers.authorization;
	const token = authHeader?.split(" ")[1]; // Bearer TOKEN

	if (!token) {
		return res.status(401).json({ error: "Access token required" });
	}

	try {
		const userManager = getUserManager();
		const user = await userManager.validateSession(token);

		if (!user) {
			return res.status(401).json({ error: "Invalid or expired token" });
		}

		req.user = user;
		next();
	} catch (error) {
		console.error("[HTTP API] Authentication error:", error);
		return res.status(500).json({ error: "Authentication failed" });
	}
};

// Authorization middleware
const requirePermission = (resource: string, action: string) => {
	return async (req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) => {
		const user = req.user;

		if (!user) {
			return res.status(401).json({ error: "Authentication required" });
		}

		try {
			const userManager = getUserManager();
			const hasPermission = await userManager.hasPermission(user, resource, action);

			if (!hasPermission) {
				return res.status(403).json({ error: "Insufficient permissions" });
			}

			next();
		} catch (error) {
			console.error("[HTTP API] Authorization error:", error);
			return res.status(500).json({ error: "Authorization failed" });
		}
	};
};

// Factory to build an Express app bound to an existing ProductManager instance
export function buildHttpApiApp(pm: ProductManager) {
	const app = express();

	// Middleware
	app.use(cors());
	app.use(express.json());

	// REST API Endpoints

	// Authentication endpoints

	// GET /api/auth/registration-status - Public status endpoint
	app.get("/api/auth/registration-status", (_req, res) => {
		const disabled = process.env.DISABLE_REGISTRATION === "true";
		return res.json({
			disabled,
			message: disabled
				? "Registration is currently disabled while we are in beta."
				: "Registration is open.",
		});
	});

	// POST /api/auth/register - Public user registration
	app.post("/api/auth/register", async (req, res, next) => {
		try {
			if (process.env.DISABLE_REGISTRATION === "true") {
				return res
					.status(403)
					.json({ error: "Registration is currently disabled while we are in beta." });
			}

			const { username, email, password, role } = req.body as Partial<CreateUserInput> & {
				role?: string;
			};

			if (!username || !email || !password) {
				return res.status(400).json({ error: "Username, email, and password are required" });
			}

			const userManager = getUserManager();
			const user = await userManager.createUser({
				username,
				email,
				password,
				role: role && typeof role === "string" ? role : "developer",
			});

			// Immediately authenticate to return a token
			const auth = await userManager.authenticateUser({ username, password });
			if (!auth.success || !auth.token) {
				return res.status(500).json({ error: "Authentication failed after registration" });
			}

			return res.status(201).json({
				user: { ...user, passwordHash: undefined },
				token: auth.token,
				message: "Registration successful",
			});
		} catch (error) {
			if (error instanceof Error) {
				return res.status(400).json({ error: error.message });
			}
			next(error);
		}
	});

	// POST /api/auth/login - User login
	app.post("/api/auth/login", async (req, res, next) => {
		try {
			const { username, password } = req.body as AuthCredentials;
			console.log(`[HTTP API] POST /api/auth/login - Login attempt: ${username}`);

			if (!username || !password) {
				return res.status(400).json({ error: "Username and password are required" });
			}

			const userManager = getUserManager();
			const result = await userManager.authenticateUser({
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
	app.post("/api/auth/logout", async (req, res, next) => {
		try {
			const authHeader = req.headers.authorization;
			const token = authHeader?.split(" ")[1];

			if (!token) {
				return res.status(400).json({ error: "Token required" });
			}

			const userManager = getUserManager();
			const success = await userManager.logoutUser(token);

			if (success) {
				res.json({ message: "Logout successful" });
			} else {
				res.status(400).json({ error: "Invalid token" });
			}
		} catch (error) {
			next(error);
		}
	});

	// GET /api/auth/me - Get current user info (fresh from DB)
	app.get("/api/auth/me", authenticateToken, async (req: AuthenticatedRequest, res, next) => {
		try {
			const requestUser = req.user;
			const userManager = getUserManager();
			const fresh = await userManager.getUserById(requestUser.id);
			if (!fresh) {
				return res.status(404).json({ error: "User not found" });
			}
			res.json({ user: { ...fresh, passwordHash: undefined } });
		} catch (error) {
			next(error);
		}
	});

	// POST /api/auth/refresh - Refresh access token
	app.post("/api/auth/refresh", async (req, res, next) => {
		try {
			const { refreshToken } = req.body;

			if (!refreshToken) {
				return res.status(400).json({ error: "Refresh token is required" });
			}

			const userManager = getUserManager();
			const result = await userManager.refreshToken(refreshToken);

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

	// PUT /api/auth/profile - Update user profile
	app.put("/api/auth/profile", authenticateToken, async (req: AuthenticatedRequest, res, next) => {
		try {
			const user = req.user;
			const { profile, preferences } = req.body as UpdateProfileInput;

			const userManager = getUserManager();
			const updateData: UpdateProfileInput = { userId: user.id };
			if (profile) updateData.profile = profile;
			if (preferences) updateData.preferences = preferences;

			const updatedUser = await userManager.updateProfile(updateData);

			res.json({ user: { ...updatedUser, passwordHash: undefined } });
		} catch (error) {
			next(error);
		}
	});

	// PUT /api/auth/password - Change password
	app.put("/api/auth/password", authenticateToken, async (req: AuthenticatedRequest, res, next) => {
		try {
			const user = req.user;
			const { currentPassword, newPassword } = req.body as ChangePasswordInput;

			if (!currentPassword || !newPassword) {
				return res.status(400).json({
					error: "Current password and new password are required",
				});
			}

			const userManager = getUserManager();
			await userManager.changePassword({
				userId: user.id,
				currentPassword,
				newPassword,
			});

			res.json({ message: "Password changed successfully" });
		} catch (error) {
			next(error);
		}
	});

	// GET /api/auth/sessions - Get user sessions
	app.get("/api/auth/sessions", authenticateToken, async (req: AuthenticatedRequest, res, next) => {
		try {
			const user = req.user;

			const userManager = getUserManager();
			const sessions = await userManager.getUserSessions(user.id);

			res.json({ sessions });
		} catch (error) {
			next(error);
		}
	});

	// DELETE /api/auth/sessions - Invalidate all user sessions
	app.delete(
		"/api/auth/sessions",
		authenticateToken,
		async (req: AuthenticatedRequest, res, next) => {
			try {
				const user = req.user;

				const userManager = getUserManager();
				await userManager.invalidateAllUserSessions(user.id);

				res.json({ message: "All sessions invalidated successfully" });
			} catch (error) {
				next(error);
			}
		},
	);

	// GET /api/auth/permissions - Get permission matrix
	app.get(
		"/api/auth/permissions",
		authenticateToken,
		async (req: AuthenticatedRequest, res, next) => {
			try {
				const user = req.user;

				const userManager = getUserManager();
				const permissions = await userManager.getUserPermissions(user);
				const matrix = userManager.getPermissionMatrix();

				res.json({
					userPermissions: permissions,
					permissionMatrix: matrix,
					availableResources: userManager.getAvailableResources(),
				});
			} catch (error) {
				next(error);
			}
		},
	);

	// User management endpoints (admin only)

	// GET /api/users - List all users (admin only)
	app.get(
		"/api/users",
		authenticateToken,
		requirePermission("users", "read"),
		async (_req, res, next) => {
			try {
				console.log("[HTTP API] GET /api/users - Listing all users");
				const userManager = getUserManager();
				const users = await userManager.getAllUsers();
				const usersWithoutPasswords = users.map((user: User) => ({
					...user,
					passwordHash: undefined,
				}));
				res.json({
					users: usersWithoutPasswords,
					count: usersWithoutPasswords.length,
				});
			} catch (error) {
				next(error);
			}
		},
	);

	// POST /api/users - Create new user (admin only)
	app.post(
		"/api/users",
		authenticateToken,
		requirePermission("users", "create"),
		async (req, res, next) => {
			try {
				const { username, email, password, role } = req.body as CreateUserInput;
				console.log(`[HTTP API] POST /api/users - Creating user: ${username}`);

				const userManager = getUserManager();
				const user = await userManager.createUser({
					username,
					email,
					password,
					...(role && { role }),
				});
				res.status(201).json({
					user: { ...user, passwordHash: undefined },
				});
			} catch (error) {
				next(error);
			}
		},
	);

	// PUT /api/users/:id - Update user (admin only)
	app.put(
		"/api/users/:id",
		authenticateToken,
		requirePermission("users", "update"),
		async (req, res, next) => {
			try {
				const { id } = req.params;
				if (!id) {
					return res.status(400).json({ error: "User ID is required" });
				}
				const { username, email, role, isActive } = req.body as UpdateUserInput;
				console.log(`[HTTP API] PUT /api/users/${id} - Updating user`);

				const userManager = getUserManager();
				const user = await userManager.updateUser({
					id,
					...(username && { username }),
					...(email && { email }),
					...(role && { role }),
					...(isActive !== undefined && { isActive }),
				});
				res.json({ user: { ...user, passwordHash: undefined } });
			} catch (error) {
				next(error);
			}
		},
	);

	// DELETE /api/users/:id - Delete user (admin only)
	app.delete(
		"/api/users/:id",
		authenticateToken,
		requirePermission("users", "delete"),
		async (req, res, next) => {
			try {
				const { id } = req.params;
				if (!id) {
					return res.status(400).json({ error: "User ID is required" });
				}
				console.log(`[HTTP API] DELETE /api/users/${id} - Deleting user`);

				const userManager = getUserManager();
				await userManager.deleteUser(id);
				res.json({
					success: true,
					message: "User deleted successfully",
				});
			} catch (error) {
				next(error);
			}
		},
	);

	// POST /api/users/:id/unlock - Unlock user account (admin only)
	app.post(
		"/api/users/:id/unlock",
		authenticateToken,
		requirePermission("users", "update"),
		async (req, res, next) => {
			try {
				const { id } = req.params;
				if (!id) {
					return res.status(400).json({ error: "User ID is required" });
				}
				console.log(`[HTTP API] POST /api/users/${id}/unlock - Unlocking user account`);

				const userManager = getUserManager();

				// Get the user first
				const user = await userManager.getUserById(id);
				if (!user) {
					return res.status(404).json({ error: "User not found" });
				}

				// Reset failed login attempts and remove lock
				const updatedUser = {
					...user,
					failedLoginAttempts: 0,
					updatedAt: new Date(),
				};

				// Remove lockedUntil property if it exists
				delete updatedUser.lockedUntil;

				try {
					const updatedUserResult = await userManager.updateUser(updatedUser);
					res.json({
						success: true,
						message: "User account unlocked successfully",
						user: { ...updatedUserResult, passwordHash: undefined },
					});
				} catch (error) {
					res.status(400).json({
						error: error instanceof Error ? error.message : "Failed to unlock user",
					});
				}
			} catch (error) {
				next(error);
			}
		},
	);

	// POST /api/admin/unlock-all - Unlock all user accounts (admin only)
	app.post(
		"/api/admin/unlock-all",
		authenticateToken,
		requirePermission("users", "update"),
		async (_req, res, next) => {
			try {
				console.log(`[HTTP API] POST /api/admin/unlock-all - Unlocking all user accounts`);

				const userManager = getUserManager();
				const users = await userManager.getAllUsers();

				let unlockedCount = 0;
				const errors: string[] = [];

				for (const user of users) {
					if (user.lockedUntil || user.failedLoginAttempts > 0) {
						try {
							// Reset failed login attempts and remove lock
							const updatedUser = {
								...user,
								failedLoginAttempts: 0,
								updatedAt: new Date(),
							};

							// Remove lockedUntil property if it exists
							delete updatedUser.lockedUntil;

							try {
								await userManager.updateUser(updatedUser);
								unlockedCount++;
							} catch (error) {
								errors.push(
									`Failed to unlock ${user.username}: ${error instanceof Error ? error.message : String(error)}`,
								);
							}
						} catch (error) {
							errors.push(
								`Error unlocking ${user.username}: ${error instanceof Error ? error.message : String(error)}`,
							);
						}
					}
				}

				res.json({
					success: true,
					message: `Unlocked ${unlockedCount} user accounts`,
					unlockedCount,
					totalUsers: users.length,
					errors: errors.length > 0 ? errors : undefined,
				});
			} catch (error) {
				next(error);
			}
		},
	);

	// Task endpoints (with authentication)

	// GET /api/tasks - List all tasks (requires authentication)
	app.get("/api/tasks", authenticateToken, async (req: AuthenticatedRequest, res, next) => {
		try {
			const user = req.user;
			if (!user) {
				return res.status(401).json({ error: "Authentication required" });
			}
			console.log(`[HTTP API] GET /api/tasks - Listing all tasks for user: ${user.username}`);

			// Filter tasks based on user permissions
			const allTasks = await pm.getAllTasks();
			const userManager = getUserManager();
			const hasAdminPermission = await userManager.hasPermission(user, "tasks", "read");

			let tasks = allTasks;
			if (!hasAdminPermission) {
				// Non-admin users can only see their own tasks (created, assigned, or collaborating)
				tasks = await pm.getTasksForUser(user.id);
			}

			res.json({ tasks, count: tasks.length });
		} catch (error) {
			next(error);
		}
	});

	// GET /api/queue - Show prioritized task queue (next up for ACP)
	app.get("/api/queue", async (_req, res, next) => {
		try {
			console.log("[HTTP API] GET /api/queue - Getting prioritized queue");

			const allTasks = await pm.getAllTasks();
			const queue = allTasks
				.filter((t) => t.status === "todo")
				.sort((a, b) => {
					const byPriority = priorityWeight[a.priority] - priorityWeight[b.priority];
					if (byPriority !== 0) return byPriority;
					return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
				});

			res.json({
				nextTask: queue[0] || null,
				count: queue.length,
				queue,
			});
		} catch (error) {
			next(error);
		}
	});

	// GET /api/tasks/:id - Get a specific task (requires authentication)
	app.get("/api/tasks/:id", authenticateToken, async (req: AuthenticatedRequest, res, next) => {
		try {
			const { id } = req.params;
			if (!id) {
				return res.status(400).json({ error: "Task ID is required" });
			}
			const user = req.user;
			if (!user) {
				return res.status(401).json({ error: "Authentication required" });
			}
			console.log(`[HTTP API] GET /api/tasks/${id} - Getting task by user: ${user.username}`);

			const tasks = await pm.getAllTasks();
			const task = tasks.find((t) => t.id === id);

			if (!task) {
				return res.status(404).json({ error: "Task not found" });
			}

			// Check if user has permission to read this task
			const hasAccess = await pm.hasTaskAccess(user.id, id, "read");
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

	// POST /api/tasks - Create a new task (requires authentication)
	app.post(
		"/api/tasks",
		authenticateToken,
		requirePermission("tasks", "create"),
		async (req: AuthenticatedRequest, res, next) => {
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
					type = "task",
				} = req.body;
				console.log(
					`[HTTP API] POST /api/tasks - Creating task: ${title} by user: ${user.username}`,
				);

				validateTaskInput(title, description, priority);
				if (!Array.isArray(dependencies)) {
					return res.status(400).json({
						error: "dependencies must be an array of task IDs",
					});
				}
				if (!["feature", "story", "task", "integration", "research"].includes(type)) {
					return res.status(400).json({ error: "Invalid task type" });
				}

				const task = await pm.createTask(
					title,
					description,
					priority as "low" | "medium" | "high",
					dependencies,
					user.id,
					assignedTo || undefined,
					collaborators || undefined,
					watchers || undefined,
					type,
				);
				res.status(201).json({ task });
			} catch (error) {
				next(error);
			}
		},
	);

	// PUT /api/tasks/:id/dependencies - Update task dependencies
	app.put(
		"/api/tasks/:id/dependencies",
		authenticateToken,
		requirePermission("tasks", "update"),
		async (req: AuthenticatedRequest, res, next) => {
			try {
				const { id } = req.params;
				if (!id) {
					return res.status(400).json({ error: "Task ID is required" });
				}
				const user = req.user;
				if (!user) {
					return res.status(401).json({ error: "Authentication required" });
				}
				const { dependencies } = req.body;
				console.log(
					`[HTTP API] PUT /api/tasks/${id}/dependencies - Updating dependencies by user: ${user.username}`,
				);

				if (!Array.isArray(dependencies)) {
					return res.status(400).json({
						error: "dependencies must be an array of task IDs",
					});
				}

				// Check if user has permission to update this task
				const hasAccess = await pm.hasTaskAccess(user.id, id, "write");
				if (!hasAccess) {
					return res.status(403).json({
						error: "Insufficient permissions to update this task",
					});
				}

				const task = await pm.updateTaskDependencies(id, dependencies);
				res.json({ task });
			} catch (error) {
				next(error);
			}
		},
	);

	// PUT /api/tasks/:id/status - Update task status (requires authentication)
	app.put(
		"/api/tasks/:id/status",
		authenticateToken,
		requirePermission("tasks", "update"),
		async (req: AuthenticatedRequest, res, next) => {
			try {
				const { id } = req.params;
				if (!id) {
					return res.status(400).json({ error: "Task ID is required" });
				}
				const user = req.user;
				if (!user) {
					return res.status(401).json({ error: "Authentication required" });
				}
				const { status } = req.body;
				console.log(
					`[HTTP API] PUT /api/tasks/${id}/status - Updating status to: ${status} by user: ${user.username}`,
				);

				validateTaskStatus(status);

				// Check if user has permission to update this task
				const hasAccess = await pm.hasTaskAccess(user.id, id, "write");
				if (!hasAccess) {
					return res.status(403).json({
						error: "Insufficient permissions to update this task",
					});
				}

				const task = await pm.updateTaskStatus(id, status as TaskStatus);
				res.json({ task });
			} catch (error) {
				next(error);
			}
		},
	);

	// PUT /api/tasks/:id/priority - Update task priority (requires authentication)
	app.put(
		"/api/tasks/:id/priority",
		authenticateToken,
		requirePermission("tasks", "update"),
		async (req: AuthenticatedRequest, res, next) => {
			try {
				const { id } = req.params;
				if (!id) {
					return res.status(400).json({ error: "Task ID is required" });
				}
				const user = req.user;
				if (!user) {
					return res.status(401).json({ error: "Authentication required" });
				}
				const { priority } = req.body;
				console.log(
					`[HTTP API] PUT /api/tasks/${id}/priority - Updating priority to: ${priority} by user: ${user.username}`,
				);

				if (!["low", "medium", "high"].includes(priority)) {
					throw new Error("Priority must be one of: low, medium, high");
				}

				// Check if user has permission to update this task
				const hasAccess = await pm.hasTaskAccess(user.id, id, "write");
				if (!hasAccess) {
					return res.status(403).json({
						error: "Insufficient permissions to update this task",
					});
				}

				const task = await pm.updateTaskPriority(id, priority as "low" | "medium" | "high");
				res.json({ task });
			} catch (error) {
				next(error);
			}
		},
	);

	// DELETE /api/tasks/:id - Delete a task (requires authentication)
	app.delete(
		"/api/tasks/:id",
		authenticateToken,
		requirePermission("tasks", "delete"),
		async (req: AuthenticatedRequest, res, next) => {
			try {
				const { id } = req.params;
				if (!id) {
					return res.status(400).json({ error: "Task ID is required" });
				}
				const user = req.user;
				if (!user) {
					return res.status(401).json({ error: "Authentication required" });
				}
				console.log(`[HTTP API] DELETE /api/tasks/${id} - Deleting task by user: ${user.username}`);

				// First check if task exists
				const tasks = await pm.getAllTasks();
				const task = tasks.find((t) => t.id === id);

				if (!task) {
					return res.status(404).json({ error: "Task not found" });
				}

				// Check if user has permission to delete this task
				const hasAccess = await pm.hasTaskAccess(user.id, id, "delete");
				if (!hasAccess) {
					return res.status(403).json({
						error: "Insufficient permissions to delete this task",
					});
				}

				await pm.deleteTask(id);
				res.json({
					success: true,
					message: "Task deleted successfully",
				});
			} catch (error) {
				next(error);
			}
		},
	);

	// PUT /api/tasks/:id/assign - Assign task to user
	app.put(
		"/api/tasks/:id/assign",
		authenticateToken,
		requirePermission("tasks", "update"),
		async (req: AuthenticatedRequest, res, next) => {
			try {
				const { id } = req.params;
				if (!id) {
					return res.status(400).json({ error: "Task ID is required" });
				}
				const user = req.user;
				if (!user) {
					return res.status(401).json({ error: "Authentication required" });
				}
				const { assignedTo } = req.body;
				console.log(
					`[HTTP API] PUT /api/tasks/${id}/assign - Assigning task to: ${assignedTo} by user: ${user.username}`,
				);

				if (!assignedTo) {
					return res.status(400).json({ error: "assignedTo is required" });
				}

				// Check if user has permission to update this task
				const hasAccess = await pm.hasTaskAccess(user.id, id, "write");
				if (!hasAccess) {
					return res.status(403).json({
						error: "Insufficient permissions to assign this task",
					});
				}

				const updatedTask = await pm.assignTask(id, assignedTo, user.id);
				res.json({ task: updatedTask });
			} catch (error) {
				next(error);
			}
		},
	);

	// PUT /api/tasks/:id/collaborators - Update task collaborators
	app.put(
		"/api/tasks/:id/collaborators",
		authenticateToken,
		requirePermission("tasks", "update"),
		async (req: AuthenticatedRequest, res, next) => {
			try {
				const { id } = req.params;
				if (!id) {
					return res.status(400).json({ error: "Task ID is required" });
				}
				const user = req.user;
				if (!user) {
					return res.status(401).json({ error: "Authentication required" });
				}
				const { collaborators } = req.body;
				console.log(
					`[HTTP API] PUT /api/tasks/${id}/collaborators - Updating collaborators by user: ${user.username}`,
				);

				if (!Array.isArray(collaborators)) {
					return res.status(400).json({ error: "collaborators must be an array" });
				}

				// First check if task exists
				const tasks = await pm.getAllTasks();
				const task = tasks.find((t) => t.id === id);

				if (!task) {
					return res.status(404).json({ error: "Task not found" });
				}

				// Check if user has permission to update this task
				const hasAccess = await pm.hasTaskAccess(user.id, id, "write");
				if (!hasAccess) {
					return res.status(403).json({
						error: "Insufficient permissions to update this task",
					});
				}

				const updatedTask = await pm.updateTaskCollaborators(id, collaborators, user.id);
				res.json({ task: updatedTask });
			} catch (error) {
				next(error);
			}
		},
	);

	// PUT /api/tasks/:id/watchers - Update task watchers
	app.put(
		"/api/tasks/:id/watchers",
		authenticateToken,
		requirePermission("tasks", "update"),
		async (req: AuthenticatedRequest, res, next) => {
			try {
				const { id } = req.params;
				if (!id) {
					return res.status(400).json({ error: "Task ID is required" });
				}
				const user = req.user;
				if (!user) {
					return res.status(401).json({ error: "Authentication required" });
				}
				const { watchers } = req.body;
				console.log(
					`[HTTP API] PUT /api/tasks/${id}/watchers - Updating watchers by user: ${user.username}`,
				);

				if (!Array.isArray(watchers)) {
					return res.status(400).json({ error: "watchers must be an array" });
				}

				// First check if task exists
				const tasks = await pm.getAllTasks();
				const task = tasks.find((t) => t.id === id);

				if (!task) {
					return res.status(404).json({ error: "Task not found" });
				}

				// Check if user has permission to update this task
				const hasAccess = await pm.hasTaskAccess(user.id, id, "write");
				if (!hasAccess) {
					return res.status(403).json({
						error: "Insufficient permissions to update this task",
					});
				}

				const updatedTask = await pm.updateTaskWatchers(id, watchers, user.id);
				res.json({ task: updatedTask });
			} catch (error) {
				next(error);
			}
		},
	);

	// GET /api/users/:userId/tasks - Get tasks for a specific user
	app.get(
		"/api/users/:userId/tasks",
		authenticateToken,
		async (req: AuthenticatedRequest, res, next) => {
			try {
				const { userId } = req.params;
				if (!userId) {
					return res.status(400).json({ error: "User ID is required" });
				}
				const user = req.user;
				if (!user) {
					return res.status(401).json({ error: "Authentication required" });
				}
				const { include = "created,assigned,collaborating" } = req.query;
				console.log(
					`[HTTP API] GET /api/users/${userId}/tasks - Getting tasks for user: ${userId}`,
				);

				// Users can only see their own tasks unless they have admin permissions
				if (userId !== user.id) {
					const userManager = getUserManager();
					const hasPermission = await userManager.hasPermission(user, "users", "read");
					if (!hasPermission) {
						return res.status(403).json({
							error: "Insufficient permissions to view other users tasks",
						});
					}
				}

				const includeTypes = (include as string).split(",").map((s) => s.trim()) as (
					| "created"
					| "assigned"
					| "collaborating"
					| "watching"
				)[];
				const tasks = await pm.getTasksForUser(userId, includeTypes);

				res.json({ tasks, count: tasks.length });
			} catch (error) {
				next(error);
			}
		},
	);

	// GET /api/tasks/status/:status - Get tasks by status
	app.get("/api/tasks/status/:status", async (req, res, next) => {
		try {
			const { status } = req.params;
			console.log(`[HTTP API] GET /api/tasks/status/${status} - Getting tasks by status`);

			validateTaskStatus(status);

			const allTasks = await pm.getAllTasks();
			const tasks = allTasks.filter((t) => t.status === status);

			res.json({ tasks, count: tasks.length });
		} catch (error) {
			next(error);
		}
	});

	// GET /api/tasks/priority/:priority - Get tasks by priority
	app.get("/api/tasks/priority/:priority", async (req, res, next) => {
		try {
			const { priority } = req.params;
			console.log(`[HTTP API] GET /api/tasks/priority/${priority} - Getting tasks by priority`);

			if (!["low", "medium", "high"].includes(priority)) {
				throw new Error("Priority must be one of: low, medium, high");
			}

			const allTasks = await pm.getAllTasks();
			const tasks = allTasks.filter((t) => t.priority === priority);

			res.json({ tasks, count: tasks.length });
		} catch (error) {
			next(error);
		}
	});

	// Critical path and dependency analysis endpoints

	// GET /api/tasks/critical-path - Get critical path analysis
	app.get("/api/tasks/critical-path", authenticateToken, async (_req, res, next) => {
		try {
			console.log("[HTTP API] GET /api/tasks/critical-path - Getting critical path analysis");

			const allTasks = await pm.getAllTasks();
			const { CriticalPathService } = await import("./services/critical-path-service");
			const criticalPathResult = CriticalPathService.calculateCriticalPath(allTasks);

			res.json(criticalPathResult);
		} catch (error) {
			next(error);
		}
	});

	// GET /api/tasks/available - Get tasks that can be started
	app.get("/api/tasks/available", authenticateToken, async (_req, res, next) => {
		try {
			console.log("[HTTP API] GET /api/tasks/available - Getting available tasks");

			const allTasks = await pm.getAllTasks();
			const { CriticalPathService } = await import("./services/critical-path-service");
			const availableTasks = CriticalPathService.getAvailableTasks(allTasks);

			res.json({ tasks: availableTasks, count: availableTasks.length });
		} catch (error) {
			next(error);
		}
	});

	// GET /api/tasks/blocking - Get tasks that are blocking others
	app.get("/api/tasks/blocking", authenticateToken, async (_req, res, next) => {
		try {
			console.log("[HTTP API] GET /api/tasks/blocking - Getting blocking tasks");

			const allTasks = await pm.getAllTasks();
			const { CriticalPathService } = await import("./services/critical-path-service");
			const blockingTasks = CriticalPathService.getBlockingTasks(allTasks);

			res.json({ tasks: blockingTasks, count: blockingTasks.length });
		} catch (error) {
			next(error);
		}
	});

	// POST /api/tasks/:taskId/impact - Analyze impact of task delay
	app.post("/api/tasks/:taskId/impact", authenticateToken, async (req, res, next) => {
		try {
			const { taskId } = req.params;
			if (!taskId) {
				return res.status(400).json({ error: "Task ID is required" });
			}
			const { delayDays = 1 } = req.body as { delayDays?: number };

			console.log(
				`[HTTP API] POST /api/tasks/${taskId}/impact - Analyzing impact with ${delayDays} days delay`,
			);

			const allTasks = await pm.getAllTasks();
			const { CriticalPathService } = await import("./services/critical-path-service");
			const impactAnalysis = CriticalPathService.analyzeDelayImpact(allTasks, taskId, delayDays);

			res.json(impactAnalysis);
		} catch (error) {
			next(error);
		}
	});

	// Profile management endpoints
	app.get("/api/profiles/with-states", async (_req, res, next) => {
		try {
			const profiles = pm.getProfilesWithStates();
			res.json(profiles);
		} catch (error) {
			next(error);
		}
	});

	app.get("/api/profiles/states", async (_req, res, next) => {
		try {
			const states = pm.getAllProfileStates();
			res.json(states);
		} catch (error) {
			next(error);
		}
	});

	app.get("/api/profiles/:name/state", async (req, res, next) => {
		try {
			const state = pm.getProfileState(req.params.name);
			if (!state) {
				return res.status(404).json({ error: "Profile not found" });
			}
			res.json(state);
		} catch (error) {
			next(error);
		}
	});

	app.get("/api/profiles/:name/metrics", async (req, res, next) => {
		try {
			const metrics = pm.getProfileMetrics(req.params.name);
			if (!metrics) {
				return res.status(404).json({ error: "Profile not found" });
			}
			res.json(metrics);
		} catch (error) {
			next(error);
		}
	});

	app.get("/api/profiles/metrics", async (_req, res, next) => {
		try {
			const metrics = Object.fromEntries(pm.getAllProfileMetrics());
			res.json(metrics);
		} catch (error) {
			next(error);
		}
	});

	app.get("/api/profiles/:name/queue", async (req, res, next) => {
		try {
			const queue = pm.getProfileTaskQueue(req.params.name);
			res.json(queue);
		} catch (error) {
			next(error);
		}
	});

	app.put("/api/profiles/:name/status", async (req, res, next) => {
		try {
			const { isActive } = req.body;
			if (typeof isActive !== "boolean") {
				return res.status(400).json({ error: "isActive must be a boolean" });
			}

			const success = pm.updateProfileStatus(req.params.name, isActive);
			if (!success) {
				return res.status(404).json({ error: "Profile not found" });
			}

			res.json({ success: true });
		} catch (error) {
			next(error);
		}
	});

	app.post("/api/profiles/:name/assign-task", async (req, res, next) => {
		try {
			const { task } = req.body;
			if (!task || !task.title || !task.description) {
				return res.status(400).json({ error: "Task must have title and description" });
			}

			const success = pm.assignTaskToProfile(req.params.name, task);
			if (!success) {
				return res.status(404).json({ error: "Profile not found" });
			}

			res.json({ success: true });
		} catch (error) {
			next(error);
		}
	});

	app.post("/api/profiles/best-for-task", async (req, res, next) => {
		try {
			const { task } = req.body;
			if (!task || !task.title) {
				return res.status(400).json({ error: "Task must have title" });
			}

			const bestProfile = pm.getBestProfileForTask(task);
			res.json({ bestProfile });
		} catch (error) {
			next(error);
		}
	});

	// GET /api/health - Health check endpoint
	app.get("/api/health", (_req, res) => {
		console.log("[HTTP API] GET /api/health - Health check");
		res.json({
			status: "healthy",
			timestamp: new Date().toISOString(),
			service: "Opencode Task Manager REST API",
		});
	});

	// GET /api/stats - Get task statistics
	app.get("/api/stats", async (_req, res, next) => {
		try {
			console.log("[HTTP API] GET /api/stats - Getting task statistics");

			const allTasks = await pm.getAllTasks();

			const stats = {
				total: allTasks.length,
				byStatus: {
					todo: allTasks.filter((t) => t.status === "todo").length,
					"in-progress": allTasks.filter((t) => t.status === "in-progress").length,
					done: allTasks.filter((t) => t.status === "done").length,
				},
				byPriority: {
					low: allTasks.filter((t) => t.priority === "low").length,
					medium: allTasks.filter((t) => t.priority === "medium").length,
					high: allTasks.filter((t) => t.priority === "high").length,
				},
			};

			res.json({ stats });
		} catch (error) {
			next(error);
		}
	});

	// GET /api/analytics - Get advanced analytics data
	app.get("/api/analytics", async (_req, res, next) => {
		try {
			console.log("[HTTP API] GET /api/analytics - Getting advanced analytics");

			const allTasks = await pm.getAllTasks();
			const now = new Date();
			const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
			const tomorrow = new Date(today);
			tomorrow.setDate(tomorrow.getDate() + 1);

			// Basic stats
			const totalTasks = allTasks.length;
			const completedTasks = allTasks.filter((t) => t.status === "done").length;
			const inProgressTasks = allTasks.filter((t) => t.status === "in-progress").length;
			const todoTasks = allTasks.filter((t) => t.status === "todo").length;
			const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

			// Today's stats
			const todayCreated = allTasks.filter((t) => {
				const taskDate = new Date(t.createdAt);
				return taskDate >= today && taskDate < tomorrow;
			}).length;

			const todayCompleted = allTasks.filter((t) => {
				if (t.status !== "done") return false;
				const taskDate = new Date(t.updatedAt);
				return taskDate >= today && taskDate < tomorrow;
			}).length;

			// Priority breakdown
			const highPriorityTasks = allTasks.filter((t) => t.priority === "high").length;
			const mediumPriorityTasks = allTasks.filter((t) => t.priority === "medium").length;
			const lowPriorityTasks = allTasks.filter((t) => t.priority === "low").length;

			// Timeline data for last 30 days
			const timelineData = [];
			for (let i = 29; i >= 0; i--) {
				const date = new Date();
				date.setDate(date.getDate() - i);
				date.setHours(0, 0, 0, 0);

				const nextDate = new Date(date);
				nextDate.setDate(nextDate.getDate() + 1);

				const dayCreated = allTasks.filter((t) => {
					const taskDate = new Date(t.createdAt);
					return taskDate >= date && taskDate < nextDate;
				}).length;

				const dayCompleted = allTasks.filter((t) => {
					if (t.status !== "done") return false;
					const taskDate = new Date(t.updatedAt);
					return taskDate >= date && taskDate < nextDate;
				}).length;

				timelineData.push({
					date: date.toISOString().split("T")[0],
					created: dayCreated,
					completed: dayCompleted,
				});
			}

			// Recent activity (last 10 tasks)
			const recentActivity = allTasks
				.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
				.slice(0, 10)
				.map((task) => ({
					id: task.id,
					title: task.title,
					status: task.status,
					priority: task.priority,
					updatedAt: task.updatedAt,
					createdAt: task.createdAt,
				}));

			// Performance metrics (simulated)
			const avgCompletionTime = completedTasks > 0 ? 2.3 : 0; // days
			const productivityScore =
				totalTasks > 0
					? Math.min(100, Math.round((completedTasks / totalTasks) * 100 + todayCompleted * 10))
					: 0;

			const analytics = {
				overview: {
					totalTasks,
					completedTasks,
					inProgressTasks,
					todoTasks,
					completionRate,
				},
				today: {
					created: todayCreated,
					completed: todayCompleted,
				},
				priority: {
					high: highPriorityTasks,
					medium: mediumPriorityTasks,
					low: lowPriorityTasks,
				},
				timeline: timelineData,
				recentActivity,
				performance: {
					avgCompletionTime: `${avgCompletionTime.toFixed(1)} days`,
					productivityScore: `${productivityScore}%`,
					totalActiveTasks: inProgressTasks + todoTasks,
				},
				generatedAt: now.toISOString(),
			};

			res.json({ analytics });
		} catch (error) {
			next(error);
		}
	});

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
			console.log(`[HTTP API] Available endpoints:`);
			console.log(`[HTTP API]   GET    /api/tasks - List all tasks`);
			console.log(`[HTTP API]   GET    /api/queue - Prioritized task queue (next up)`);
			console.log(`[HTTP API]   GET    /api/tasks/:id - Get specific task`);
			console.log(`[HTTP API]   POST   /api/tasks - Create new task`);
			console.log(`[HTTP API]   PUT    /api/tasks/:id/status - Update task status`);
			console.log(`[HTTP API]   PUT    /api/tasks/:id/priority - Update task priority`);
			console.log(`[HTTP API]   DELETE /api/tasks/:id - Delete task`);
			console.log(`[HTTP API]   GET    /api/tasks/status/:status - Get tasks by status`);
			console.log(`[HTTP API]   GET    /api/tasks/priority/:priority - Get tasks by priority`);
			console.log(`[HTTP API]   GET    /api/health - Health check`);
			console.log(`[HTTP API]   GET    /api/stats - Task statistics`);
			console.log(`[HTTP API]   GET    /api/analytics - Advanced analytics`);
			console.log(`[HTTP API]   tRPC   /trpc (http & ws) - tasks, queue, taskUpdates subscription`);
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

		server.on("upgrade", (request, socket, head) => {
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
