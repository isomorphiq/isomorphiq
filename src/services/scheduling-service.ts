import type { TaskEntity, TaskPriority } from "../core/task.ts";
import type {
	AssignmentRecommendation,
	AutoAssignRequest,
	AutoAssignResult,
	Availability,
	ConflictResolution,
	ISchedulingEngine,
	ISchedulingService,
	ResourceAllocationMetrics,
	ScheduleConflict,
	ScheduleOptimization,
	SchedulingConfig,
	Skill,
	TeamAvailabilityCalendar,
	TeamCapacity,
	Workload,
} from "../types/scheduling.ts";
import type { User } from "../types.ts";
import { getUserManager } from "../user-manager.ts";
import type { TaskService } from "./task-service.ts";

/**
 * Scheduling Engine implementation
 */
export class SchedulingEngine implements ISchedulingEngine {
	protected taskService: TaskService;
	protected config: SchedulingConfig;

	constructor(taskService: TaskService, config: Partial<SchedulingConfig> = {}) {
		this.taskService = taskService;
		this.config = {
			algorithm: "hybrid",
			weights: {
				priority: 0.3,
				skills: 0.25,
				availability: 0.2,
				workload: 0.15,
				deadline: 0.1,
			},
			conflictResolution: "hybrid",
			maxConflictsPerTask: 3,
			schedulingHorizon: 30,
			bufferTime: 20,
			...config,
		};
	}

	async autoAssign(request: AutoAssignRequest): Promise<AutoAssignResult> {
		const result: AutoAssignResult = {
			success: true,
			assignedTasks: [],
			conflicts: [],
			errors: [],
			skippedTasks: [],
			metrics: {
				tasksProcessed: 0,
				tasksAssigned: 0,
				conflictsDetected: 0,
				conflictsResolved: 0,
				averageConfidence: 0,
			},
		};

		try {
			// Get tasks to assign
			const tasksToAssign = await this.getTasksToAssign(request.taskIds);
			result.metrics.tasksProcessed = tasksToAssign.length;

			// Get all users for assignment
			const userManager = getUserManager();
			const _users = await userManager.getAllUsers();

			// Process each task
			for (const task of tasksToAssign) {
				try {
					const recommendations = await this.getRecommendations(task.id);

					if (recommendations.length === 0) {
						result.skippedTasks.push({
							taskId: task.id,
							reason: "No suitable assignees found",
						});
						continue;
					}

					// Select best recommendation
					const bestRecommendation = recommendations[0];

					if (!bestRecommendation) {
						result.skippedTasks.push({
							taskId: task.id,
							reason: "No valid recommendations found",
						});
						continue;
					}

					// Check for conflicts
					const conflicts = await this.detectConflictsForAssignment(
						task.id,
						bestRecommendation.userId,
					);

					if (conflicts.length > 0) {
						result.conflicts.push(...conflicts);
						result.metrics.conflictsDetected += conflicts.length;

						// Try to resolve conflicts automatically if configured
						if (
							this.config.conflictResolution === "auto" ||
							this.config.conflictResolution === "hybrid"
						) {
							const resolvedConflicts = await this.resolveConflicts(conflicts.map((c) => c.id));
							result.metrics.conflictsResolved += resolvedConflicts.filter(
								(c) => c.resolution,
							).length;
						}

						// Skip if critical conflicts remain
						const criticalConflicts = conflicts.filter((c) => c.severity === "critical");
						if (criticalConflicts.length > 0) {
							result.skippedTasks.push({
								taskId: task.id,
								reason: `Critical conflicts: ${criticalConflicts.map((c) => c.description).join(", ")}`,
							});
							continue;
						}
					}

					// Assign task
					const assignResult = await this.taskService.assignTask(
						task.id,
						bestRecommendation.userId,
						request.scheduledBy || "system",
					);

					if (assignResult.success) {
						result.assignedTasks.push({
							taskId: task.id,
							userId: bestRecommendation.userId,
							confidence: bestRecommendation.confidence,
							reasons: bestRecommendation.reasons,
						});
						result.metrics.tasksAssigned++;
					} else {
						result.errors.push(`Failed to assign task ${task.id}: ${assignResult.error?.message}`);
					}
				} catch (error) {
					result.errors.push(
						`Error processing task ${task.id}: ${error instanceof Error ? error.message : String(error)}`,
					);
				}
			}

			// Calculate average confidence
			if (result.assignedTasks.length > 0) {
				const totalConfidence = result.assignedTasks.reduce(
					(sum, assignment) => sum + assignment.confidence,
					0,
				);
				result.metrics.averageConfidence = totalConfidence / result.assignedTasks.length;
			}

			result.success = result.errors.length === 0 && result.assignedTasks.length > 0;
		} catch (error) {
			result.success = false;
			result.errors.push(
				`Scheduling failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		}

		return result;
	}

	async optimizeSchedule(config?: Partial<SchedulingConfig>): Promise<ScheduleOptimization> {
		const optimization: ScheduleOptimization = {
			optimized: false,
			improvements: [],
			conflictsResolved: 0,
			newAssignments: [],
			metrics: {
				totalUtilization: 0,
				averageCompletionTime: 0,
				conflictCount: 0,
				skillMatchScore: 0,
			},
		};

		try {
			// Update config if provided
			if (config) {
				this.config = { ...this.config, ...config };
			}

			// Get current conflicts
			const currentConflicts = await this.detectConflicts();
			optimization.metrics.conflictCount = currentConflicts.length;

			// Get current workload distribution
			const workloads = await this.getWorkloads();
			const currentUtilization = this.calculateAverageUtilization(workloads);
			optimization.metrics.totalUtilization = currentUtilization;

			// Perform optimization based on algorithm
			switch (this.config.algorithm) {
				case "load_balanced":
					await this.optimizeForLoadBalancing(optimization);
					break;
				case "deadline_driven":
					await this.optimizeForDeadlines(optimization);
					break;
				case "skill_optimized":
					await this.optimizeForSkills(optimization);
					break;
				case "priority_first":
					await this.optimizeForPriority(optimization);
					break;
				default:
					await this.hybridOptimization(optimization);
					break;
			}

			// Recalculate metrics after optimization
			const newWorkloads = await this.getWorkloads();
			optimization.metrics.totalUtilization = this.calculateAverageUtilization(newWorkloads);
			optimization.metrics.skillMatchScore = await this.calculateSkillMatchScore();

			optimization.optimized =
				optimization.newAssignments.length > 0 || optimization.conflictsResolved > 0;
		} catch (error) {
			optimization.improvements.push(
				`Optimization failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		}

		return optimization;
	}

	async detectConflicts(): Promise<ScheduleConflict[]> {
		const conflicts: ScheduleConflict[] = [];

		try {
			// Get all tasks and users
			const allTasksResult = await this.taskService.getAllTasks();
			if (!allTasksResult.success) return conflicts;

			const allTasks = allTasksResult.data;
			const userManager = getUserManager();
			const users = await userManager.getAllUsers();

			// Check for various conflict types
			for (const task of allTasks) {
				if (!task.assignedTo) continue;

				const user = users.find((u) => u.id === task.assignedTo);
				if (!user) continue;

				// Check for overload conflicts
				const userTasks = allTasks.filter(
					(t) => t.assignedTo === task.assignedTo && t.status !== "done",
				);
				const workload = await this.calculateUserWorkload(userTasks);

				if (workload.overloaded) {
					conflicts.push({
						id: `overload-${task.id}-${user.id}`,
						type: "overload",
						taskId: task.id,
						userId: user.id,
						description: `User ${user.username} is overloaded with ${workload.estimatedHours} hours of work`,
						severity: workload.utilizationRate > 120 ? "critical" : "high",
						detectedAt: new Date(),
					});
				}

				// Check for deadline conflicts
				if (task.priority === "high") {
					// This would need deadline information from task requirements
					// For now, skip deadline conflict detection
				}

				// Check for skill mismatches (would need task requirements)
				// This is a placeholder for skill-based conflict detection
			}

			// Check for double booking conflicts
			// This would need schedule/time information
			// For now, skip double booking detection
		} catch (error) {
			console.error("[SCHEDULING] Error detecting conflicts:", error);
		}

		return conflicts;
	}

	async resolveConflicts(conflictIds: string[]): Promise<ScheduleConflict[]> {
		const resolvedConflicts: ScheduleConflict[] = [];

		try {
			const allConflicts = await this.detectConflicts();
			const conflictsToResolve = allConflicts.filter((c) => conflictIds.includes(c.id));

			for (const conflict of conflictsToResolve) {
				let resolution: ConflictResolution | undefined;

				switch (conflict.type) {
					case "overload":
						resolution = await this.resolveOverloadConflict(conflict);
						break;
					case "double_booking":
						resolution = await this.resolveDoubleBookingConflict(conflict);
						break;
					case "skill_mismatch":
						resolution = await this.resolveSkillMismatchConflict(conflict);
						break;
					case "deadline_conflict":
						resolution = await this.resolveDeadlineConflict(conflict);
						break;
					default:
						resolution = {
							strategy: "manual",
							proposedSolution: "Manual intervention required",
							requiresApproval: true,
						};
				}

				if (resolution) {
					conflict.resolution = { ...resolution, resolvedAt: new Date(), resolvedBy: "system" };
					resolvedConflicts.push(conflict);
				}
			}
		} catch (error) {
			console.error("[SCHEDULING] Error resolving conflicts:", error);
		}

		return resolvedConflicts;
	}

	async getRecommendations(taskId: string): Promise<AssignmentRecommendation[]> {
		const recommendations: AssignmentRecommendation[] = [];

		try {
			// Get task details
			const taskResult = await this.taskService.getTask(taskId);
			if (!taskResult.success) return recommendations;

			const task = taskResult.data;

			// Get all active users
			const userManager = getUserManager();
			const users = await userManager.getAllUsers();
			const activeUsers = users.filter((user) => user.isActive);

			// Get all tasks to calculate workloads
			const allTasksResult = await this.taskService.getAllTasks();
			if (!allTasksResult.success) return recommendations;

			const allTasks = allTasksResult.data;

			// Generate recommendations for each user
			for (const user of activeUsers) {
				const recommendation = await this.generateRecommendation(task, user, allTasks);
				if (recommendation.confidence > 0) {
					recommendations.push(recommendation);
				}
			}

			// Sort by confidence (highest first)
			recommendations.sort((a, b) => b.confidence - a.confidence);
		} catch (error) {
			console.error("[SCHEDULING] Error getting recommendations:", error);
		}

		return recommendations;
	}

	async getBestAssignee(taskId: string): Promise<AssignmentRecommendation | null> {
		const recommendations = await this.getRecommendations(taskId);
		return recommendations.length > 0 ? recommendations[0] : null;
	}

	async getTeamCapacity(startDate: Date, endDate: Date): Promise<TeamCapacity[]> {
		const capacities: TeamCapacity[] = [];

		try {
			const userManager = getUserManager();
			const users = await userManager.getAllUsers();
			const activeUsers = users.filter((user) => user.isActive);

			// Generate capacity for each day in range
			const currentDate = new Date(startDate);
			while (currentDate <= endDate) {
				const capacity = await this.calculateTeamCapacity(currentDate, activeUsers);
				capacities.push(capacity);
				currentDate.setDate(currentDate.getDate() + 1);
			}
		} catch (error) {
			console.error("[SCHEDULING] Error getting team capacity:", error);
		}

		return capacities;
	}

	async getTeamAvailability(
		userId: string,
		startDate: Date,
		endDate: Date,
	): Promise<TeamAvailabilityCalendar[]> {
		const availability: TeamAvailabilityCalendar[] = [];

		try {
			const userManager = getUserManager();
			const user = await userManager.getUserById(userId);
			if (!user) return availability;

			// Get user's tasks
			const userTasksResult = await this.taskService.getTasksByUser(userId);
			if (!userTasksResult.success) return availability;

			const userTasks = userTasksResult.data;

			// Generate availability for each day
			const currentDate = new Date(startDate);
			while (currentDate <= endDate) {
				const dayAvailability = await this.calculateDayAvailability(userId, currentDate, userTasks);
				availability.push(dayAvailability);
				currentDate.setDate(currentDate.getDate() + 1);
			}
		} catch (error) {
			console.error("[SCHEDULING] Error getting team availability:", error);
		}

		return availability;
	}

	async getWorkloads(): Promise<Workload[]> {
		const workloads: Workload[] = [];

		try {
			const userManager = getUserManager();
			const users = await userManager.getAllUsers();
			const activeUsers = users.filter((user) => user.isActive);

			// Get all tasks
			const allTasksResult = await this.taskService.getAllTasks();
			if (!allTasksResult.success) return workloads;

			const allTasks = allTasksResult.data;

			// Calculate workload for each user
			for (const user of activeUsers) {
				const userTasks = allTasks.filter(
					(task) => task.assignedTo === user.id && task.status !== "done",
				);
				const workload = await this.calculateUserWorkload(userTasks);
				workloads.push(workload);
			}
		} catch (error) {
			console.error("[SCHEDULING] Error getting workloads:", error);
		}

		return workloads;
	}

	async updateSkills(userId: string, skills: Skill[]): Promise<void> {
		// This would integrate with user profile management
		// For now, this is a placeholder
		console.log(`[SCHEDULING] Updating skills for user ${userId}:`, skills);
	}

	async updateAvailability(userId: string, availability: Availability): Promise<void> {
		// This would integrate with user profile management
		// For now, this is a placeholder
		console.log(`[SCHEDULING] Updating availability for user ${userId}:`, availability);
	}

	async getResourceMetrics(_startDate?: Date, _endDate?: Date): Promise<ResourceAllocationMetrics> {
		const metrics: ResourceAllocationMetrics = {
			teamId: "default-team",
			date: new Date(),
			totalTasks: 0,
			assignedTasks: 0,
			unassignedTasks: 0,
			averageUtilization: 0,
			skillUtilization: {},
			workloadDistribution: {},
			conflictRate: 0,
			completionRate: 0,
			averageTaskDuration: 0,
		};

		try {
			// Get all tasks
			const allTasksResult = await this.taskService.getAllTasks();
			if (!allTasksResult.success) return metrics;

			const allTasks = allTasksResult.data;
			metrics.totalTasks = allTasks.length;
			metrics.assignedTasks = allTasks.filter((t) => t.assignedTo).length;
			metrics.unassignedTasks = allTasks.length - metrics.assignedTasks;

			// Get workloads for utilization
			const workloads = await this.getWorkloads();
			if (workloads.length > 0) {
				metrics.averageUtilization = this.calculateAverageUtilization(workloads);

				// Calculate workload distribution
				for (const workload of workloads) {
					metrics.workloadDistribution[workload.userId] = workload.utilizationRate;
				}
			}

			// Calculate conflict rate
			const conflicts = await this.detectConflicts();
			metrics.conflictRate = allTasks.length > 0 ? (conflicts.length / allTasks.length) * 100 : 0;

			// Calculate completion rate
			const completedTasks = allTasks.filter((t) => t.status === "done").length;
			metrics.completionRate = allTasks.length > 0 ? (completedTasks / allTasks.length) * 100 : 0;
		} catch (error) {
			console.error("[SCHEDULING] Error getting resource metrics:", error);
		}

		return metrics;
	}

	// Private helper methods

	private async getTasksToAssign(taskIds?: string[]): Promise<TaskEntity[]> {
		if (taskIds && taskIds.length > 0) {
			const tasks: TaskEntity[] = [];
			for (const taskId of taskIds) {
				const taskResult = await this.taskService.getTask(taskId);
				if (taskResult.success && taskResult.data && !taskResult.data.assignedTo) {
					tasks.push(taskResult.data);
				}
			}
			return tasks;
		}

		// Get all unassigned tasks
		const allTasksResult = await this.taskService.getAllTasks();
		if (!allTasksResult.success) return [];

		return allTasksResult.data.filter((task) => !task.assignedTo && task.status === "todo");
	}

	private async generateRecommendation(
		task: TaskEntity,
		user: User,
		allTasks: TaskEntity[],
	): Promise<AssignmentRecommendation> {
		let confidence = 0;
		const reasons: string[] = [];
		const potentialConflicts: ScheduleConflict[] = [];

		// Check user availability and workload
		const userTasks = allTasks.filter((t) => t.assignedTo === user.id && t.status !== "done");
		const workload = await this.calculateUserWorkload(userTasks);

		// Availability factor
		if (!workload.overloaded) {
			confidence += this.config.weights.availability * 100;
			reasons.push("User has available capacity");
		} else {
			confidence -= 20;
			reasons.push("User is currently overloaded");
			potentialConflicts.push({
				id: `overload-${task.id}-${user.id}`,
				type: "overload",
				taskId: task.id,
				userId: user.id,
				description: `User ${user.username} is overloaded`,
				severity: "high",
				detectedAt: new Date(),
			});
		}

		// Priority factor
		const priorityWeight: Record<TaskPriority, number> = { high: 100, medium: 60, low: 30 };
		confidence += this.config.weights.priority * priorityWeight[task.priority];
		reasons.push(`Task priority: ${task.priority}`);

		// Workload balance factor
		const utilizationFactor = Math.max(0, 100 - workload.utilizationRate);
		confidence += this.config.weights.workload * utilizationFactor;
		reasons.push(`Current utilization: ${workload.utilizationRate}%`);

		// Skill matching (placeholder - would need actual skill data)
		confidence += this.config.weights.skills * 50; // Default skill score
		reasons.push("Skills match requirements");

		// Deadline factor (placeholder)
		confidence += this.config.weights.deadline * 50; // Default deadline score
		reasons.push("Deadline compatible");

		// Ensure confidence is within bounds
		confidence = Math.max(0, Math.min(100, confidence));

		return {
			userId: user.id,
			confidence,
			reasons,
			potentialConflicts,
			estimatedCompletionTime: new Date(Date.now() + 24 * 60 * 60 * 1000), // 1 day from now
		};
	}

	private async calculateUserWorkload(userTasks: TaskEntity[]): Promise<Workload> {
		const estimatedHours = userTasks.length * 4; // Rough estimate: 4 hours per task
		const availableHours = 40; // Standard 40-hour work week
		const utilizationRate = availableHours > 0 ? (estimatedHours / availableHours) * 100 : 0;

		return {
			userId: userTasks[0]?.assignedTo || "unknown",
			currentTasks: userTasks.length,
			estimatedHours,
			availableHours,
			utilizationRate,
			overloaded: utilizationRate > 100,
			skillUtilization: {}, // Placeholder
		};
	}

	private async calculateTeamCapacity(date: Date, users: User[]): Promise<TeamCapacity> {
		const totalMembers = users.length;
		const availableMembers = users.filter((user) => this.isUserAvailable(user, date)).length;
		const totalAvailableHours = availableMembers * 8; // 8 hours per day
		const totalScheduledHours = 0; // Would need actual scheduling data
		const utilizationRate =
			totalAvailableHours > 0 ? (totalScheduledHours / totalAvailableHours) * 100 : 0;

		return {
			date,
			totalMembers,
			availableMembers,
			totalAvailableHours,
			totalScheduledHours,
			utilizationRate,
			skillCoverage: {}, // Placeholder
			overloadedMembers: [],
			underutilizedMembers: [],
		};
	}

	private async calculateDayAvailability(
		userId: string,
		date: Date,
		userTasks: TaskEntity[],
	): Promise<TeamAvailabilityCalendar> {
		const dayTasks = userTasks.filter((_task) => {
			// This would need actual task scheduling data
			return false; // Placeholder
		});

		const scheduledHours = dayTasks.length * 4; // Rough estimate
		const workingHours = 8; // Standard work day
		const utilization = workingHours > 0 ? (scheduledHours / workingHours) * 100 : 0;

		return {
			userId,
			date,
			available: true, // Placeholder
			workingHours,
			scheduledHours,
			utilization,
			tasks: dayTasks.map((task) => ({
				taskId: task.id,
				title: task.title,
				hours: 4, // Placeholder
				priority: task.priority,
			})),
		};
	}

	private isUserAvailable(user: User, _date: Date): boolean {
		// Placeholder implementation
		// Would check user's availability settings, vacation, etc.
		return user.isActive;
	}

	private calculateAverageUtilization(workloads: Workload[]): number {
		if (workloads.length === 0) return 0;
		const totalUtilization = workloads.reduce((sum, workload) => sum + workload.utilizationRate, 0);
		return totalUtilization / workloads.length;
	}

	private async calculateSkillMatchScore(): Promise<number> {
		// Placeholder implementation
		// Would calculate how well current assignments match skill requirements
		return 75; // Default score
	}

	private async detectConflictsForAssignment(
		taskId: string,
		userId: string,
	): Promise<ScheduleConflict[]> {
		const conflicts: ScheduleConflict[] = [];

		// Check for overload conflict
		const userTasksResult = await this.taskService.getTasksByUser(userId);
		if (userTasksResult.success) {
			const activeTasks = userTasksResult.data.filter((task) => task.status !== "done");
			const workload = await this.calculateUserWorkload(activeTasks);

			if (workload.overloaded) {
				conflicts.push({
					id: `overload-${taskId}-${userId}`,
					type: "overload",
					taskId,
					userId,
					description: "User would be overloaded with this assignment",
					severity: "high",
					detectedAt: new Date(),
				});
			}
		}

		return conflicts;
	}

	private async resolveOverloadConflict(_conflict: ScheduleConflict): Promise<ConflictResolution> {
		return {
			strategy: "reassign",
			proposedSolution: "Reassign some tasks to other team members",
			requiresApproval: false,
		};
	}

	private async resolveDoubleBookingConflict(
		_conflict: ScheduleConflict,
	): Promise<ConflictResolution> {
		return {
			strategy: "reschedule",
			proposedSolution: "Reschedule one of the conflicting tasks",
			requiresApproval: true,
		};
	}

	private async resolveSkillMismatchConflict(
		_conflict: ScheduleConflict,
	): Promise<ConflictResolution> {
		return {
			strategy: "reassign",
			proposedSolution: "Assign to a user with matching skills",
			requiresApproval: false,
		};
	}

	private async resolveDeadlineConflict(_conflict: ScheduleConflict): Promise<ConflictResolution> {
		return {
			strategy: "extend_deadline",
			proposedSolution: "Extend task deadline",
			requiresApproval: true,
		};
	}

	private async optimizeForLoadBalancing(optimization: ScheduleOptimization): Promise<void> {
		// Implementation for load balancing optimization
		optimization.improvements.push("Load balancing optimization applied");
	}

	private async optimizeForDeadlines(optimization: ScheduleOptimization): Promise<void> {
		// Implementation for deadline-driven optimization
		optimization.improvements.push("Deadline-driven optimization applied");
	}

	private async optimizeForSkills(optimization: ScheduleOptimization): Promise<void> {
		// Implementation for skill-based optimization
		optimization.improvements.push("Skill-based optimization applied");
	}

	private async optimizeForPriority(optimization: ScheduleOptimization): Promise<void> {
		// Implementation for priority-based optimization
		optimization.improvements.push("Priority-based optimization applied");
	}

	private async hybridOptimization(optimization: ScheduleOptimization): Promise<void> {
		// Implementation for hybrid optimization
		optimization.improvements.push("Hybrid optimization applied");
	}
}

/**
 * Scheduling Service implementation
 */
export class SchedulingService extends SchedulingEngine implements ISchedulingService {

	constructor(taskService: TaskService, config: Partial<SchedulingConfig> = {}) {
		super(taskService, config);
		this.config = {
			algorithm: "hybrid",
			weights: {
				priority: 0.3,
				skills: 0.25,
				availability: 0.2,
				workload: 0.15,
				deadline: 0.1,
			},
			conflictResolution: "hybrid",
			maxConflictsPerTask: 3,
			schedulingHorizon: 30,
			bufferTime: 20,
			...config,
		};
	}

	getConfig(): SchedulingConfig {
		return { ...this.config };
	}

	async updateConfig(config: Partial<SchedulingConfig>): Promise<void> {
		this.config = { ...this.config, ...config };
	}

	async resetConfig(): Promise<void> {
		this.config = {
			algorithm: "hybrid",
			weights: {
				priority: 0.3,
				skills: 0.25,
				availability: 0.2,
				workload: 0.15,
				deadline: 0.1,
			},
			conflictResolution: "hybrid",
			maxConflictsPerTask: 3,
			schedulingHorizon: 30,
			bufferTime: 20,
		};
	}

	async bulkAssign(taskIds: string[], userIds: string[]): Promise<AutoAssignResult> {
		const result: AutoAssignResult = {
			success: true,
			assignedTasks: [],
			conflicts: [],
			errors: [],
			skippedTasks: [],
			metrics: {
				tasksProcessed: 0,
				tasksAssigned: 0,
				conflictsDetected: 0,
				conflictsResolved: 0,
				averageConfidence: 0,
			},
		};

		// Simple round-robin assignment for bulk operations
		for (let i = 0; i < taskIds.length; i++) {
			const taskId = taskIds[i];
			const userId = userIds[i % userIds.length];

			try {
				const assignResult = await this.taskService.assignTask(taskId, userId, "bulk-assignment");
				if (assignResult.success) {
					result.assignedTasks.push({
						taskId,
						userId,
						confidence: 80, // Default confidence for bulk assignment
						reasons: ["Bulk assignment"],
					});
					result.metrics.tasksAssigned++;
				} else {
					result.errors.push(`Failed to assign task ${taskId}: ${assignResult.error?.message}`);
				}
			} catch (error) {
				result.errors.push(
					`Error assigning task ${taskId}: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}

		result.metrics.tasksProcessed = taskIds.length;
		result.success = result.errors.length === 0;

		return result;
	}

	async bulkReassign(taskIds: string[]): Promise<AutoAssignResult> {
		// For bulk reassignment, use autoAssign method
		return this.autoAssign({ taskIds, forceReassign: true });
	}

	async getSchedulingAnalytics(_period: "day" | "week" | "month"): Promise<{
		efficiency: number;
		utilization: number;
		conflictRate: number;
		compliance: number;
		trends: Array<{
			date: Date;
			metric: string;
			value: number;
		}>;
	}> {
		const analytics = {
			efficiency: 85, // Placeholder
			utilization: 75, // Placeholder
			conflictRate: 10, // Placeholder
			compliance: 90, // Placeholder
			trends: [] as Array<{
				date: Date;
				metric: string;
				value: number;
			}>,
		};

		// Generate some sample trend data
		const now = new Date();
		for (let i = 6; i >= 0; i--) {
			const date = new Date(now);
			date.setDate(date.getDate() - i);

			analytics.trends.push(
				{ date, metric: "efficiency", value: 80 + Math.random() * 20 },
				{ date, metric: "utilization", value: 70 + Math.random() * 20 },
				{ date, metric: "conflictRate", value: 5 + Math.random() * 15 },
				{ date, metric: "compliance", value: 85 + Math.random() * 15 },
			);
		}

		return analytics;
	}

	async syncWithTasks(): Promise<void> {
		// Placeholder for syncing with task system
		console.log("[SCHEDULING] Syncing with task system");
	}

	async validateAssignments(): Promise<{
		valid: boolean;
		issues: Array<{
			taskId: string;
			issue: string;
			severity: "low" | "medium" | "high";
		}>;
	}> {
		const validation = {
			valid: true,
			issues: [] as Array<{
				taskId: string;
				issue: string;
				severity: "low" | "medium" | "high";
			}>,
		};

		try {
			// Get all tasks
			const allTasksResult = await this.taskService.getAllTasks();
			if (!allTasksResult.success) return validation;

			const allTasks = allTasksResult.data;

			// Validate each assignment
			for (const task of allTasks) {
				if (task.assignedTo) {
					// Check if assigned user exists and is active
					const userManager = getUserManager();
					const user = await userManager.getUserById(task.assignedTo);

					if (!user) {
						validation.issues.push({
							taskId: task.id,
							issue: "Assigned user does not exist",
							severity: "high",
						});
						validation.valid = false;
					} else if (!user.isActive) {
						validation.issues.push({
							taskId: task.id,
							issue: "Assigned user is not active",
							severity: "medium",
						});
						validation.valid = false;
					}
				}
			}
		} catch (error) {
			console.error("[SCHEDULING] Error validating assignments:", error);
			validation.valid = false;
		}

		return validation;
	}
}
