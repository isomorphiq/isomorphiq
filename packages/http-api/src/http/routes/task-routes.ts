import type express from "express";
import { CriticalPathService } from "@isomorphiq/tasks/critical-path";
import type { Task, TaskStatus } from "@isomorphiq/tasks";
import type { ProductManager } from "@isomorphiq/tasks";
import { getUserManager } from "@isomorphiq/auth";
import {
    authenticateToken,
    requirePermission,
    type AuthContextRequest,
} from "@isomorphiq/auth";

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

export function registerTaskRoutes(app: express.Application, pm: ProductManager) {
    // GET /api/tasks - List all tasks (requires authentication)
    app.get("/api/tasks", authenticateToken, async (req: AuthContextRequest, res, next) => {
        try {
            const user = req.user;
            if (!user) {
                return res.status(401).json({ error: "Authentication required" });
            }
            console.log(`[HTTP API] GET /api/tasks - Listing all tasks for user: ${user.username}`);

            const allTasks = await pm.getAllTasks();
            const userManager = getUserManager();
            const hasAdminPermission = await userManager.hasPermission(user, "tasks", "read");

            let tasks = allTasks;
            if (!hasAdminPermission) {
                tasks = await pm.getTasksForUser(user.id);
            }

            res.json({ tasks, count: tasks.length });
        } catch (error) {
            next(error);
        }
    });

    // GET /api/users/:userId/tasks - Get tasks for a specific user
    app.get(
        "/api/users/:userId/tasks",
        authenticateToken,
        async (req: AuthContextRequest, res, next) => {
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
    app.get("/api/tasks/:id", authenticateToken, async (req: AuthContextRequest, res, next) => {
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
        async (req: AuthContextRequest, res, next) => {
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
        async (req: AuthContextRequest, res, next) => {
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
        async (req: AuthContextRequest, res, next) => {
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
        async (req: AuthContextRequest, res, next) => {
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
        async (req: AuthContextRequest, res, next) => {
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

                const tasks = await pm.getAllTasks();
                const task = tasks.find((t) => t.id === id);

                if (!task) {
                    return res.status(404).json({ error: "Task not found" });
                }

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
        async (req: AuthContextRequest, res, next) => {
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
                    return res.status(400).json({ error: "Assigned user ID is required" });
                }

                const hasAccess = await pm.hasTaskAccess(user.id, id, "write");
                if (!hasAccess) {
                    return res.status(403).json({
                        error: "Insufficient permissions to assign this task",
                    });
                }

                const task = await pm.updateTaskAssignment(id, assignedTo);
                res.json({ task });
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
        async (req: AuthContextRequest, res, next) => {
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
                    return res.status(400).json({
                        error: "collaborators must be an array of user IDs",
                    });
                }

                const hasAccess = await pm.hasTaskAccess(user.id, id, "write");
                if (!hasAccess) {
                    return res.status(403).json({
                        error: "Insufficient permissions to update collaborators for this task",
                    });
                }

                const task = await pm.updateTaskCollaborators(id, collaborators);
                res.json({ task });
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
        async (req: AuthContextRequest, res, next) => {
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
                    return res.status(400).json({
                        error: "watchers must be an array of user IDs",
                    });
                }

                const hasAccess = await pm.hasTaskAccess(user.id, id, "write");
                if (!hasAccess) {
                    return res.status(403).json({
                        error: "Insufficient permissions to update watchers for this task",
                    });
                }

                const task = await pm.updateTaskWatchers(id, watchers);
                res.json({ task });
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

    // GET /api/tasks/critical-path - Get critical path analysis
    app.get("/api/tasks/critical-path", authenticateToken, async (_req, res, next) => {
        try {
            console.log("[HTTP API] GET /api/tasks/critical-path - Getting critical path analysis");

            const allTasks = await pm.getAllTasks();
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
            const impactAnalysis = CriticalPathService.analyzeDelayImpact(allTasks, taskId, delayDays);

            res.json(impactAnalysis);
        } catch (error) {
            next(error);
        }
    });
}
