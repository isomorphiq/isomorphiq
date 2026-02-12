import type { NextFunction, Request, Response } from "express";
import express from "express";
import type { TaskRepository } from "@isomorphiq/tasks";
import { TaskService } from "@isomorphiq/tasks";
import { SchedulingService } from "@isomorphiq/scheduling";
import type { AutoAssignRequest, SchedulingConfig } from "@isomorphiq/scheduling";

// Validation helpers
const validateAutoAssignRequest = (body: unknown): AutoAssignRequest => {
	const request: AutoAssignRequest = {};
	if (!body || typeof body !== "object") return request;
	const data = body as Record<string, unknown>;

	if (Array.isArray(data.taskIds)) {
		request.taskIds = data.taskIds as string[];
	}

	if (data.config && typeof data.config === "object") {
		request.config = data.config as SchedulingConfig;
	}

	if (typeof data.forceReassign === "boolean") {
		request.forceReassign = data.forceReassign;
	}

	if (typeof data.notifyUsers === "boolean") {
		request.notifyUsers = data.notifyUsers;
	}

	if (typeof data.scheduledBy === "string") {
		request.scheduledBy = data.scheduledBy;
	}

	return request;
};

const validateSchedulingConfig = (body: unknown): Partial<SchedulingConfig> => {
	const config: Partial<SchedulingConfig> = {};
	if (!body || typeof body !== "object") return config;
	const data = body as Record<string, unknown>;

	const algorithms = [
		"priority_first",
		"load_balanced",
		"deadline_driven",
		"skill_optimized",
		"hybrid",
	];
	if (typeof data.algorithm === "string" && algorithms.includes(data.algorithm)) {
		config.algorithm = data.algorithm as SchedulingConfig["algorithm"];
	}

	if (data.weights && typeof data.weights === "object") {
		const weights = data.weights as Record<string, unknown>;
		config.weights = {
			priority: typeof weights.priority === "number" ? weights.priority : 0.3,
			skills: typeof weights.skills === "number" ? weights.skills : 0.25,
			availability: typeof weights.availability === "number" ? weights.availability : 0.2,
			workload: typeof weights.workload === "number" ? weights.workload : 0.15,
			deadline: typeof weights.deadline === "number" ? weights.deadline : 0.1,
		};
	}

	if (
		typeof data.conflictResolution === "string" &&
		["auto", "manual", "hybrid"].includes(data.conflictResolution)
	) {
		config.conflictResolution = data.conflictResolution as SchedulingConfig["conflictResolution"];
	}

	if (typeof data.maxConflictsPerTask === "number") {
		config.maxConflictsPerTask = data.maxConflictsPerTask;
	}

	if (typeof data.schedulingHorizon === "number") {
		config.schedulingHorizon = data.schedulingHorizon;
	}

	if (typeof data.bufferTime === "number") {
		config.bufferTime = data.bufferTime;
	}

	return config;
};

// Factory function to create scheduling routes
export function createSchedulingRoutes(taskRepository: TaskRepository): express.Router {
	const router = express.Router();
	const taskService = new TaskService(taskRepository);
	const schedulingService = new SchedulingService(taskService);

	// POST /api/schedule/auto-assign - Automatic task assignment
	router.post("/auto-assign", async (req: Request, res: Response, next: NextFunction) => {
		try {
			console.log("[SCHEDULING API] POST /api/schedule/auto-assign - Auto-assigning tasks");

			const request = validateAutoAssignRequest(req.body);
			const result = await schedulingService.autoAssign(request);

			res.json({
				success: result.success,
				data: result,
				message: result.success ? "Tasks auto-assigned successfully" : "Auto-assignment failed",
			});
		} catch (error) {
			console.error("[SCHEDULING API] Error in auto-assign:", error);
			next(error);
		}
	});

	// PUT /api/schedule/optimize - Schedule optimization
	router.put("/optimize", async (req: Request, res: Response, next: NextFunction) => {
		try {
			console.log("[SCHEDULING API] PUT /api/schedule/optimize - Optimizing schedule");

			const config = validateSchedulingConfig(req.body);
			const result = await schedulingService.optimizeSchedule(config);

			res.json({
				success: result.optimized,
				data: result,
				message: result.optimized ? "Schedule optimized successfully" : "No optimizations needed",
			});
		} catch (error) {
			console.error("[SCHEDULING API] Error in optimize:", error);
			next(error);
		}
	});

	// GET /api/schedule/conflicts - Schedule conflicts
	router.get("/conflicts", async (_req: Request, res: Response, next: NextFunction) => {
		try {
			console.log("[SCHEDULING API] GET /api/schedule/conflicts - Getting schedule conflicts");

			const conflicts = await schedulingService.detectConflicts();

			res.json({
				success: true,
				data: conflicts,
				count: conflicts.length,
			});
		} catch (error) {
			console.error("[SCHEDULING API] Error getting conflicts:", error);
			next(error);
		}
	});

	// POST /api/schedule/conflicts/resolve - Resolve conflicts
	router.post("/conflicts/resolve", async (req: Request, res: Response, next: NextFunction) => {
		try {
			console.log("[SCHEDULING API] POST /api/schedule/conflicts/resolve - Resolving conflicts");

			const { conflictIds } = req.body;
			if (!Array.isArray(conflictIds)) {
				return res.status(400).json({
					success: false,
					error: "conflictIds must be an array",
				});
			}

			const resolvedConflicts = await schedulingService.resolveConflicts(conflictIds);

			res.json({
				success: true,
				data: resolvedConflicts,
				resolved: resolvedConflicts.length,
				message: `Resolved ${resolvedConflicts.length} conflicts`,
			});
		} catch (error) {
			console.error("[SCHEDULING API] Error resolving conflicts:", error);
			next(error);
		}
	});

	// GET /api/schedule/recommendations/:taskId - Get assignment recommendations
	router.get(
		"/recommendations/:taskId",
		async (req: Request, res: Response, next: NextFunction) => {
			try {
				const { taskId } = req.params;
				console.log(
					`[SCHEDULING API] GET /api/schedule/recommendations/${taskId} - Getting recommendations`,
				);

				const recommendations = await schedulingService.getRecommendations(taskId);

				res.json({
					success: true,
					data: recommendations,
					count: recommendations.length,
				});
			} catch (error) {
				console.error("[SCHEDULING API] Error getting recommendations:", error);
				next(error);
			}
		},
	);

	// GET /api/schedule/best-assignee/:taskId - Get best assignee
	router.get("/best-assignee/:taskId", async (req: Request, res: Response, next: NextFunction) => {
		try {
			const { taskId } = req.params;
			console.log(
				`[SCHEDULING API] GET /api/schedule/best-assignee/${taskId} - Getting best assignee`,
			);

			const bestAssignee = await schedulingService.getBestAssignee(taskId);

			if (!bestAssignee) {
				return res.status(404).json({
					success: false,
					error: "No suitable assignee found",
				});
			}

			res.json({
				success: true,
				data: bestAssignee,
			});
		} catch (error) {
			console.error("[SCHEDULING API] Error getting best assignee:", error);
			next(error);
		}
	});

	// GET /api/schedule/team-capacity - Get team capacity
	router.get("/team-capacity", async (req: Request, res: Response, next: NextFunction) => {
		try {
			const { startDate, endDate } = req.query;

			if (!startDate || !endDate) {
				return res.status(400).json({
					success: false,
					error: "startDate and endDate query parameters are required",
				});
			}

			const start = new Date(startDate as string);
			const end = new Date(endDate as string);

			if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
				return res.status(400).json({
					success: false,
					error: "Invalid date format",
				});
			}

			console.log(
				`[SCHEDULING API] GET /api/schedule/team-capacity - Getting capacity from ${start.toISOString()} to ${end.toISOString()}`,
			);

			const capacity = await schedulingService.getTeamCapacity(start, end);

			res.json({
				success: true,
				data: capacity,
				count: capacity.length,
			});
		} catch (error) {
			console.error("[SCHEDULING API] Error getting team capacity:", error);
			next(error);
		}
	});

	// GET /api/schedule/team-availability/:userId - Get team availability
	router.get(
		"/team-availability/:userId",
		async (req: Request, res: Response, next: NextFunction) => {
			try {
				const { userId } = req.params;
				const { startDate, endDate } = req.query;

				if (!startDate || !endDate) {
					return res.status(400).json({
						success: false,
						error: "startDate and endDate query parameters are required",
					});
				}

				const start = new Date(startDate as string);
				const end = new Date(endDate as string);

				if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
					return res.status(400).json({
						success: false,
						error: "Invalid date format",
					});
				}

				console.log(
					`[SCHEDULING API] GET /api/schedule/team-availability/${userId} - Getting availability from ${start.toISOString()} to ${end.toISOString()}`,
				);

				const availability = await schedulingService.getTeamAvailability(userId, start, end);

				res.json({
					success: true,
					data: availability,
					count: availability.length,
				});
			} catch (error) {
				console.error("[SCHEDULING API] Error getting team availability:", error);
				next(error);
			}
		},
	);

	// GET /api/schedule/workloads - Get workloads
	router.get("/workloads", async (_req: Request, res: Response, next: NextFunction) => {
		try {
			console.log("[SCHEDULING API] GET /api/schedule/workloads - Getting workloads");

			const workloads = await schedulingService.getWorkloads();

			res.json({
				success: true,
				data: workloads,
				count: workloads.length,
			});
		} catch (error) {
			console.error("[SCHEDULING API] Error getting workloads:", error);
			next(error);
		}
	});

	// GET /api/schedule/metrics - Get resource allocation metrics
	router.get("/metrics", async (req: Request, res: Response, next: NextFunction) => {
		try {
			const { startDate, endDate } = req.query;

			const start = startDate ? new Date(startDate as string) : undefined;
			const end = endDate ? new Date(endDate as string) : undefined;

			console.log("[SCHEDULING API] GET /api/schedule/metrics - Getting resource metrics");

			const metrics = await schedulingService.getResourceMetrics(start, end);

			res.json({
				success: true,
				data: metrics,
			});
		} catch (error) {
			console.error("[SCHEDULING API] Error getting metrics:", error);
			next(error);
		}
	});

	// GET /api/schedule/config - Get scheduling configuration
	router.get("/config", async (_req: Request, res: Response, next: NextFunction) => {
		try {
			console.log("[SCHEDULING API] GET /api/schedule/config - Getting scheduling config");

			const config = schedulingService.getConfig();

			res.json({
				success: true,
				data: config,
			});
		} catch (error) {
			console.error("[SCHEDULING API] Error getting config:", error);
			next(error);
		}
	});

	// PUT /api/schedule/config - Update scheduling configuration
	router.put("/config", async (req: Request, res: Response, next: NextFunction) => {
		try {
			console.log("[SCHEDULING API] PUT /api/schedule/config - Updating scheduling config");

			const config = validateSchedulingConfig(req.body);
			await schedulingService.updateConfig(config);

			const updatedConfig = schedulingService.getConfig();

			res.json({
				success: true,
				data: updatedConfig,
				message: "Scheduling configuration updated successfully",
			});
		} catch (error) {
			console.error("[SCHEDULING API] Error updating config:", error);
			next(error);
		}
	});

	// POST /api/schedule/bulk-assign - Bulk assign tasks
	router.post("/bulk-assign", async (req: Request, res: Response, next: NextFunction) => {
		try {
			const { taskIds, userIds } = req.body;

			if (!Array.isArray(taskIds) || !Array.isArray(userIds)) {
				return res.status(400).json({
					success: false,
					error: "taskIds and userIds must be arrays",
				});
			}

			console.log(
				`[SCHEDULING API] POST /api/schedule/bulk-assign - Bulk assigning ${taskIds.length} tasks to ${userIds.length} users`,
			);

			const result = await schedulingService.bulkAssign(taskIds, userIds);

			res.json({
				success: result.success,
				data: result,
				message: result.success ? "Tasks bulk assigned successfully" : "Bulk assignment failed",
			});
		} catch (error) {
			console.error("[SCHEDULING API] Error in bulk assign:", error);
			next(error);
		}
	});

	// POST /api/schedule/bulk-reassign - Bulk reassign tasks
	router.post("/bulk-reassign", async (req: Request, res: Response, next: NextFunction) => {
		try {
			const { taskIds } = req.body;

			if (!Array.isArray(taskIds)) {
				return res.status(400).json({
					success: false,
					error: "taskIds must be an array",
				});
			}

			console.log(
				`[SCHEDULING API] POST /api/schedule/bulk-reassign - Bulk reassigning ${taskIds.length} tasks`,
			);

			const result = await schedulingService.bulkReassign(taskIds);

			res.json({
				success: result.success,
				data: result,
				message: result.success ? "Tasks bulk reassigned successfully" : "Bulk reassignment failed",
			});
		} catch (error) {
			console.error("[SCHEDULING API] Error in bulk reassign:", error);
			next(error);
		}
	});

	// GET /api/schedule/analytics - Get scheduling analytics
	router.get("/analytics", async (req: Request, res: Response, next: NextFunction) => {
		try {
			const { period = "week" } = req.query;

			if (!["day", "week", "month"].includes(period as string)) {
				return res.status(400).json({
					success: false,
					error: "period must be one of: day, week, month",
				});
			}

			console.log(`[SCHEDULING API] GET /api/schedule/analytics - Getting ${period} analytics`);

			const analytics = await schedulingService.getSchedulingAnalytics(
				period as "day" | "week" | "month",
			);

			res.json({
				success: true,
				data: analytics,
			});
		} catch (error) {
			console.error("[SCHEDULING API] Error getting analytics:", error);
			next(error);
		}
	});

	// POST /api/schedule/sync - Sync with task system
	router.post("/sync", async (_req: Request, res: Response, next: NextFunction) => {
		try {
			console.log("[SCHEDULING API] POST /api/schedule/sync - Syncing with task system");

			await schedulingService.syncWithTasks();

			res.json({
				success: true,
				message: "Synced with task system successfully",
			});
		} catch (error) {
			console.error("[SCHEDULING API] Error syncing:", error);
			next(error);
		}
	});

	// GET /api/schedule/validate - Validate assignments
	router.get("/validate", async (_req: Request, res: Response, next: NextFunction) => {
		try {
			console.log("[SCHEDULING API] GET /api/schedule/validate - Validating assignments");

			const validation = await schedulingService.validateAssignments();

			res.json({
				success: true,
				data: validation,
			});
		} catch (error) {
			console.error("[SCHEDULING API] Error validating assignments:", error);
			next(error);
		}
	});

	// POST /api/schedule/skills/:userId - Update user skills
	router.post("/skills/:userId", async (req: Request, res: Response, next: NextFunction) => {
		try {
			const { userId } = req.params;
			const { skills } = req.body;

			if (!Array.isArray(skills)) {
				return res.status(400).json({
					success: false,
					error: "skills must be an array",
				});
			}

			console.log(`[SCHEDULING API] POST /api/schedule/skills/${userId} - Updating skills`);

			await schedulingService.updateSkills(userId, skills);

			res.json({
				success: true,
				message: "Skills updated successfully",
			});
		} catch (error) {
			console.error("[SCHEDULING API] Error updating skills:", error);
			next(error);
		}
	});

	// POST /api/schedule/availability/:userId - Update user availability
	router.post("/availability/:userId", async (req: Request, res: Response, next: NextFunction) => {
		try {
			const { userId } = req.params;
			const { availability } = req.body;

			if (!availability || typeof availability !== "object") {
				return res.status(400).json({
					success: false,
					error: "availability is required and must be an object",
				});
			}

			console.log(
				`[SCHEDULING API] POST /api/schedule/availability/${userId} - Updating availability`,
			);

			await schedulingService.updateAvailability(userId, availability);

			res.json({
				success: true,
				message: "Availability updated successfully",
			});
		} catch (error) {
			console.error("[SCHEDULING API] Error updating availability:", error);
			next(error);
		}
	});

	return router;
}
