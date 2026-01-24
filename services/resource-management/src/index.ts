import type {
    AssignmentRecommendation,
    ScheduleConflict,
    Skill,
    TaskRequirements,
    Workload,
} from "@isomorphiq/scheduling";
import type { Task } from "@isomorphiq/tasks";
import type { User } from "@isomorphiq/auth";
import { getUserManager } from "@isomorphiq/auth";
import type { TaskService } from "@isomorphiq/tasks";

/**
 * Resource capacity planning interfaces
 */
export interface CapacityForecast {
	userId: string;
	period: "week" | "month" | "quarter";
	currentCapacity: number; // hours
	projectedCapacity: number; // hours
	utilizationTrend: number; // percentage change
	burnoutRisk: "low" | "medium" | "high";
	recommendations: string[];
}

export interface TeamResourceSummary {
	totalMembers: number;
	activeMembers: number;
	averageUtilization: number;
	skillGaps: Array<{
		skill: string;
		required: number;
		available: number;
		gap: number;
	}>;
	overloadedMembers: string[];
	underutilizedMembers: string[];
	capacityForecast: CapacityForecast[];
}

export interface ResourceAllocationRequest {
	taskId: string;
	requirements: TaskRequirements;
	constraints?: {
		preferredUsers?: string[];
		excludedUsers?: string[];
		maxUtilization?: number; // percentage
		balanceWorkload?: boolean;
	};
	strategy?: "optimal" | "balanced" | "fastest" | "cost_effective";
}

export interface ResourceAllocationResult {
	success: boolean;
	assignment?: {
		userId: string;
		confidence: number;
		reasons: string[];
		estimatedCompletion: Date;
	};
	alternatives: AssignmentRecommendation[];
	conflicts: ScheduleConflict[];
	warnings: string[];
	impactAnalysis: {
		utilizationChange: number;
		burnoutRiskChange: "low" | "medium" | "high";
		skillDevelopment: string[];
	};
}

/**
 * Workload balancing algorithms
 */
export interface WorkloadBalancingConfig {
	maxUtilization: number; // percentage (default: 85)
	minUtilization: number; // percentage (default: 40)
	balanceThreshold: number; // percentage difference (default: 20)
	skillWeight: number; // importance of skill matching (default: 0.4)
	availabilityWeight: number; // importance of availability (default: 0.3)
	workloadWeight: number; // importance of workload balance (default: 0.3)
}

/**
 * Resource Management Service
 * Extends the existing scheduling system with advanced capacity planning
 */
export class ResourceManagementService {
	private taskService: TaskService;
	private balancingConfig: WorkloadBalancingConfig;

	constructor(taskService: TaskService, config?: Partial<WorkloadBalancingConfig>) {
		this.taskService = taskService;
		this.balancingConfig = {
			maxUtilization: 85,
			minUtilization: 40,
			balanceThreshold: 20,
			skillWeight: 0.4,
			availabilityWeight: 0.3,
			workloadWeight: 0.3,
			...config,
		};
	}

	/**
	 * Get comprehensive team resource summary
	 */
	async getTeamResourceSummary(): Promise<TeamResourceSummary> {
		const userManager = getUserManager();
		const users = await userManager.getAllUsers();
		const activeUsers = users.filter((user) => user.isActive);

		// Get current workloads
		const workloads = await this.getCurrentWorkloads();
		const utilizationRates = workloads.map((w) => w.utilizationRate);
		const averageUtilization =
			utilizationRates.reduce((sum, rate) => sum + rate, 0) / utilizationRates.length;

		// Analyze skill gaps
		const skillGaps = await this.analyzeSkillGaps();

		// Identify overloaded and underutilized members
		const overloadedMembers = workloads
			.filter((w) => w.utilizationRate > this.balancingConfig.maxUtilization)
			.map((w) => w.userId);

		const underutilizedMembers = workloads
			.filter((w) => w.utilizationRate < this.balancingConfig.minUtilization)
			.map((w) => w.userId);

		// Generate capacity forecasts
		const capacityForecast = await this.generateCapacityForecasts(activeUsers);

		return {
			totalMembers: users.length,
			activeMembers: activeUsers.length,
			averageUtilization,
			skillGaps,
			overloadedMembers,
			underutilizedMembers,
			capacityForecast,
		};
	}

	/**
	 * Allocate resources for a specific task
	 */
	async allocateResources(request: ResourceAllocationRequest): Promise<ResourceAllocationResult> {
		const { taskId, requirements, constraints, strategy = "optimal" } = request;

		// Get task details
		const taskResult = await this.taskService.getTask(taskId);
		if (!taskResult.success) {
			return {
				success: false,
				alternatives: [],
				conflicts: [],
				warnings: ["Task not found"],
				impactAnalysis: {
					utilizationChange: 0,
					burnoutRiskChange: "low",
					skillDevelopment: [],
				},
			};
		}

		// Get candidate users
		const candidates = await this.getCandidateUsers(requirements, constraints);

		// Score candidates based on strategy
		const scoredCandidates = await this.scoreCandidates(candidates, requirements, strategy);

		// Get top recommendation
		const bestCandidate = scoredCandidates[0];

		// Detect potential conflicts
		const conflicts = await this.detectAllocationConflicts(
			taskId,
			bestCandidate?.userId,
			requirements,
		);

		// Analyze impact
		const impactAnalysis: ResourceAllocationResult["impactAnalysis"] = bestCandidate
			? await this.analyzeAllocationImpact(bestCandidate.userId, requirements)
			: {
					utilizationChange: 0,
					burnoutRiskChange: "low",
					skillDevelopment: [],
				};

		// Generate warnings
		const warnings = this.generateAllocationWarnings(bestCandidate, conflicts);

		return {
			success: bestCandidate !== undefined,
			assignment: bestCandidate
				? {
						userId: bestCandidate.userId,
						confidence: bestCandidate.confidence,
						reasons: bestCandidate.reasons,
						estimatedCompletion: bestCandidate.estimatedCompletionTime,
					}
				: undefined,
			alternatives: scoredCandidates.slice(1),
			conflicts,
			warnings,
			impactAnalysis,
		};
	}

	/**
	 * Optimize team workload distribution
	 */
	async optimizeWorkload(): Promise<{
		optimizations: Array<{
			taskId: string;
			fromUserId?: string;
			toUserId: string;
			reason: string;
			impact: number;
		}>;
		totalImpact: number;
		newUtilization: Record<string, number>;
	}> {
		const workloads = await this.getCurrentWorkloads();
		const overloadedUsers = workloads.filter(
			(w) => w.utilizationRate > this.balancingConfig.maxUtilization,
		);
		const underutilizedUsers = workloads.filter(
			(w) => w.utilizationRate < this.balancingConfig.minUtilization,
		);

		const optimizations: Array<{
			taskId: string;
			fromUserId?: string;
			toUserId: string;
			reason: string;
			impact: number;
		}> = [];

		// For each overloaded user, try to reassign tasks
		for (const overloaded of overloadedUsers) {
			const userTasks = await this.taskService.getTasksByUser(overloaded.userId);
			if (!userTasks.success) continue;

			const activeTasks = userTasks.data.filter((task) => task.status === "in-progress");

			// Sort tasks by reassignability (lower priority first)
			const reassignableTasks = activeTasks.sort((a, b) => {
				const priorityOrder = { low: 1, medium: 2, high: 3 };
				return priorityOrder[a.priority] - priorityOrder[b.priority];
			});

			for (const task of reassignableTasks) {
				if (overloaded.utilizationRate <= this.balancingConfig.maxUtilization) break;

				// Find best underutilized user for this task
				const requirements = await this.inferTaskRequirements(task);
				const candidates = underutilizedUsers.filter(
					(u) =>
						!requirements.requiredSkills.length ||
						this.hasRequiredSkills(u.userId, requirements.requiredSkills),
				);

				if (candidates.length === 0) continue;

				const bestCandidate = await this.findBestCandidate(candidates, requirements);
				if (!bestCandidate) continue;

				optimizations.push({
					taskId: task.id,
					fromUserId: overloaded.userId,
					toUserId: bestCandidate.userId,
					reason: `Reduce workload from ${overloaded.utilizationRate.toFixed(1)}% to optimal range`,
					impact: overloaded.utilizationRate - this.balancingConfig.maxUtilization,
				});

				// Update simulated utilization
				overloaded.utilizationRate -= 10; // Estimate task impact
				bestCandidate.utilizationRate += 10;
			}
		}

		const newUtilization = workloads.reduce(
			(acc, workload) => {
				acc[workload.userId] = workload.utilizationRate;
				return acc;
			},
			{} as Record<string, number>,
		);

		return {
			optimizations,
			totalImpact: optimizations.reduce((sum, opt) => sum + opt.impact, 0),
			newUtilization,
		};
	}

	/**
	 * Get capacity forecasts for team members
	 */
	async getCapacityForecasts(
		period: "week" | "month" | "quarter" = "month",
	): Promise<CapacityForecast[]> {
		const userManager = getUserManager();
		const users = await userManager.getAllUsers();
		const activeUsers = users.filter((user) => user.isActive);

		return this.generateCapacityForecasts(activeUsers, period);
	}

	/**
	 * Private helper methods
	 */
	private async getCurrentWorkloads(): Promise<Workload[]> {
		const userManager = getUserManager();
		const users = await userManager.getAllUsers();
		const activeUsers = users.filter((user) => user.isActive);

		const workloads: Workload[] = [];

		for (const user of activeUsers) {
			const userTasksResult = await this.taskService.getTasksByUser(user.id);
			if (!userTasksResult.success) continue;

			const activeTasks = userTasksResult.data.filter((task) => task.status === "in-progress");
			const estimatedHours = activeTasks.length * 8; // Rough estimate
			const availableHours = 40 * 4; // 40 hours/week for 4 weeks
			const utilizationRate = (estimatedHours / availableHours) * 100;

			workloads.push({
				userId: user.id,
				currentTasks: activeTasks.length,
				estimatedHours,
				availableHours,
				utilizationRate,
				overloaded: utilizationRate > this.balancingConfig.maxUtilization,
				skillUtilization: {}, // TODO: Calculate based on task requirements
			});
		}

		return workloads;
	}

	private async analyzeSkillGaps(): Promise<
		Array<{
			skill: string;
			required: number;
			available: number;
			gap: number;
		}>
	> {
		// Get all active tasks and their required skills
		const allTasksResult = await this.taskService.getAllTasks();
		if (!allTasksResult.success) return [];

		const activeTasks = allTasksResult.data.filter(
			(task) => task.status === "todo" || task.status === "in-progress",
		);
		const skillRequirements: Record<string, number> = {};

		// Count required skills across all tasks
		for (const task of activeTasks) {
			const requirements = await this.inferTaskRequirements(task);
			for (const skill of requirements.requiredSkills) {
				skillRequirements[skill.name] = (skillRequirements[skill.name] || 0) + 1;
			}
		}

		// Get available skills from team members
		const userManager = getUserManager();
		const users = await userManager.getAllUsers();
		const availableSkills: Record<string, number> = {};

		// TODO: Implement user skills tracking
		// For now, assume basic skill distribution
		const activeCount = users.filter((u) => u.isActive).length;
		availableSkills.JavaScript = (availableSkills.JavaScript || 0) + activeCount;
		availableSkills.TypeScript = (availableSkills.TypeScript || 0) + activeCount;
		availableSkills.React = (availableSkills.React || 0) + activeCount;

		// Calculate gaps
		const gaps = Object.keys(skillRequirements).map((skill) => ({
			skill,
			required: skillRequirements[skill],
			available: availableSkills[skill] || 0,
			gap: Math.max(0, skillRequirements[skill] - (availableSkills[skill] || 0)),
		}));

		return gaps.filter((gap) => gap.gap > 0);
	}

	private async generateCapacityForecasts(
		users: User[],
		period: "week" | "month" | "quarter" = "month",
	): Promise<CapacityForecast[]> {
		const forecasts: CapacityForecast[] = [];

		for (const user of users) {
			const currentWorkload = await this.getCurrentWorkloads();
			const userWorkload = currentWorkload.find((w) => w.userId === user.id);

			if (!userWorkload) continue;

			const currentCapacity = userWorkload.availableHours;
			const projectedCapacity = currentCapacity * (1 + (Math.random() - 0.5) * 0.2); // ±10% variation
			const utilizationTrend = ((projectedCapacity - currentCapacity) / currentCapacity) * 100;

			const burnoutRisk =
				userWorkload.utilizationRate > 90
					? "high"
					: userWorkload.utilizationRate > 75
						? "medium"
						: "low";

			const recommendations = this.generateCapacityRecommendations(userWorkload, burnoutRisk);

			forecasts.push({
				userId: user.id,
				period,
				currentCapacity,
				projectedCapacity,
				utilizationTrend,
				burnoutRisk,
				recommendations,
			});
		}

		return forecasts;
	}

	private generateCapacityRecommendations(
		workload: Workload,
		burnoutRisk: "low" | "medium" | "high",
	): string[] {
		const recommendations: string[] = [];

		if (burnoutRisk === "high") {
			recommendations.push("Consider redistributing some tasks to prevent burnout");
			recommendations.push("Schedule breaks and time off");
		} else if (burnoutRisk === "medium") {
			recommendations.push("Monitor workload closely");
		}

		if (workload.utilizationRate < 40) {
			recommendations.push("Consider assigning more tasks to increase utilization");
		}

			if (workload.skillUtilization) {
				const underutilizedSkills = Object.entries(workload.skillUtilization)
					.filter(([, utilization]) => utilization < 50)
					.map(([skill]) => skill);

			if (underutilizedSkills.length > 0) {
				recommendations.push(`Consider tasks utilizing: ${underutilizedSkills.join(", ")}`);
			}
		}

		return recommendations;
	}

	private async getCandidateUsers(
		_requirements: TaskRequirements,
		constraints?: ResourceAllocationRequest["constraints"],
	): Promise<User[]> {
		void _requirements;
		const userManager = getUserManager();
		const allUsers = await userManager.getAllUsers();
		const activeUsers = allUsers.filter((user) => user.isActive);

		return activeUsers.filter((user) => {
			// Apply exclusions
			if (constraints?.excludedUsers?.includes(user.id)) return false;

			// TODO: Check skill matching
			// TODO: Check availability
			// TODO: Check workload capacity

			return true;
		});
	}

	private async scoreCandidates(
		candidates: User[],
		requirements: TaskRequirements,
		strategy: string,
	): Promise<AssignmentRecommendation[]> {
		const recommendations: AssignmentRecommendation[] = [];

		for (const candidate of candidates) {
			const confidence = await this.calculateAssignmentConfidence(
				candidate,
				requirements,
				strategy,
			);
			const reasons = await this.generateAssignmentReasons(candidate, requirements);
			const estimatedCompletion = new Date(
				Date.now() + requirements.estimatedHours * 60 * 60 * 1000,
			);

			recommendations.push({
				userId: candidate.id,
				confidence,
				reasons,
				potentialConflicts: [], // TODO: Implement conflict detection
				estimatedCompletionTime: estimatedCompletion,
			});
		}

		return recommendations.sort((a, b) => b.confidence - a.confidence);
	}

	private async calculateAssignmentConfidence(
		_user: User,
		_requirements: TaskRequirements,
		_strategy: string,
	): Promise<number> {
		void _user;
		void _requirements;
		void _strategy;
		const confidence = 50; // Base confidence

		// TODO: Implement skill matching score
		// TODO: Implement availability score
		// TODO: Implement workload score
		// TODO: Apply strategy-specific weights

		return Math.min(100, Math.max(0, confidence));
	}

	private async generateAssignmentReasons(
		_user: User,
		_requirements: TaskRequirements,
	): Promise<string[]> {
		void _user;
		void _requirements;
		const reasons: string[] = [];

		// TODO: Generate specific reasons based on matching criteria
		reasons.push("Available and qualified for the task");

		return reasons;
	}

	private async detectAllocationConflicts(
		_taskId: string,
		_userId?: string,
		_requirements?: TaskRequirements,
	): Promise<ScheduleConflict[]> {
		void _taskId;
		void _userId;
		void _requirements;
		// TODO: Implement conflict detection
		return [];
	}

	private async analyzeAllocationImpact(
		_userId: string,
		_requirements: TaskRequirements,
	): Promise<{
		utilizationChange: number;
		burnoutRiskChange: "low" | "medium" | "high";
		skillDevelopment: string[];
	}> {
		void _userId;
		void _requirements;
		// TODO: Implement impact analysis
		return {
			utilizationChange: 5, // Estimate
			burnoutRiskChange: "low",
			skillDevelopment: [],
		};
	}

	private generateAllocationWarnings(
		candidate?: AssignmentRecommendation,
		conflicts: ScheduleConflict[] = [],
	): string[] {
		const warnings: string[] = [];

		if (!candidate) {
			warnings.push("No suitable candidates found");
			return warnings;
		}

		if (candidate.confidence < 60) {
			warnings.push("Low confidence in assignment match");
		}

		if (conflicts.some((c) => c.severity === "high" || c.severity === "critical")) {
			warnings.push("High-priority conflicts detected");
		}

		return warnings;
	}

	private async inferTaskRequirements(task: Task): Promise<TaskRequirements> {
		// TODO: Implement task requirement inference based on task properties
		return {
			estimatedHours: 8,
			requiredSkills: [],
			priority: task.priority,
			dependencies: task.dependencies,
		};
	}

	private hasRequiredSkills(_userId: string, _requiredSkills: Skill[]): boolean {
		void _userId;
		void _requiredSkills;
		// TODO: Implement skill checking
		return true;
	}

	private async findBestCandidate(
		candidates: Workload[],
		_requirements: TaskRequirements,
	): Promise<Workload | null> {
		void _requirements;
		// Find candidate with lowest utilization that has required skills
		const validCandidates = candidates.filter((w) => !w.overloaded);
		return validCandidates.length > 0 ? validCandidates[0] : null;
	}
}
