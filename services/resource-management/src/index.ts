import type {
    AssignmentRecommendation,
    ScheduleConflict,
    Skill,
    TaskRequirements,
    Workload,
} from "@isomorphiq/scheduling";
import type { Task } from "@isomorphiq/tasks";
import type { User, UserRole } from "@isomorphiq/auth";
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
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
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
		const scoredCandidates = await this.scoreCandidates(taskId, candidates, requirements, strategy);

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
		const userManager = getUserManager();
		const users = await userManager.getAllUsers();
		const userById = new Map(users.map((user) => [user.id, user]));
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
					const candidates = underutilizedUsers
						.map((workload) => ({
							workload,
							user: userById.get(workload.userId),
						}))
						.filter(
							(result) =>
								result.user
								&&
								(!requirements.requiredSkills.length
									|| this.hasRequiredSkills(result.user, requirements.requiredSkills)),
						)
						.map((result) => result.workload);

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

        const workloadResults: Array<Workload | null> = await Promise.all(
            activeUsers.map(async (user) => {
                const userTasksResult = await this.taskService.getTasksByUser(user.id);
                if (!userTasksResult.success) return null;

                const activeTasks = userTasksResult.data.filter(
                    (task) => task.status === "in-progress",
                );
                const requirements = await Promise.all(
                    activeTasks.map((task) => this.inferTaskRequirements(task)),
                );
                const estimatedHours = requirements.reduce(
                    (sum, requirement) => sum + requirement.estimatedHours,
                    0,
                );
                const availableHours = 40 * 4; // 40 hours/week for 4 weeks
                const utilizationRate = (estimatedHours / availableHours) * 100;

                return {
                    userId: user.id,
                    currentTasks: activeTasks.length,
                    estimatedHours,
                    availableHours,
                    utilizationRate,
                    overloaded: utilizationRate > this.balancingConfig.maxUtilization,
                    skillUtilization: this.calculateSkillUtilization(requirements),
                };
            }),
        );

        return workloadResults.flatMap((workload) => (workload ? [workload] : []));
	}

    private calculateSkillUtilization(requirements: TaskRequirements[]): Record<string, number> {
        const weightedSkills = requirements.flatMap((requirement) =>
            requirement.requiredSkills.map((skill) => ({
                name: skill.name,
                weight: requirement.estimatedHours,
            })),
        );
        const skillWeights = weightedSkills.reduce<Record<string, number>>(
            (acc, { name, weight }) => ({
                ...acc,
                [name]: (acc[name] ?? 0) + weight,
            }),
            {},
        );
        const totalWeight = Object.values(skillWeights).reduce(
            (sum, weight) => sum + weight,
            0,
        );

        if (totalWeight === 0) {
            return {};
        }

        return Object.entries(skillWeights).reduce<Record<string, number>>(
            (acc, [name, weight]) => ({
                ...acc,
                [name]: (weight / totalWeight) * 100,
            }),
            {},
        );
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
		requirements: TaskRequirements,
		constraints?: ResourceAllocationRequest["constraints"],
	): Promise<User[]> {
		const userManager = getUserManager();
		const allUsers = await userManager.getAllUsers();
		const activeUsers = allUsers.filter((user) => user.isActive);
		const workloads = await this.getCurrentWorkloads();
		const workloadByUserId = workloads.reduce<Record<string, Workload>>((acc, workload) => {
			acc[workload.userId] = workload;
			return acc;
		}, {});

		const maxUtilization =
			constraints?.maxUtilization ?? this.balancingConfig.maxUtilization;

		const requirementRoles = requirements.constraints?.requiredRoles ?? [];

		return activeUsers.filter((user) => {
			if (constraints?.excludedUsers?.includes(user.id)) return false;

			if (
				constraints?.preferredUsers &&
				constraints.preferredUsers.length > 0 &&
				!constraints.preferredUsers.includes(user.id)
			) {
				return false;
			}

			if (requirementRoles.length > 0 && !requirementRoles.includes(user.role)) {
				return false;
			}

			if (!this.hasRequiredSkills(user, requirements.requiredSkills)) {
				return false;
			}

			const workload = workloadByUserId[user.id];
			if (workload && workload.utilizationRate >= maxUtilization) {
				return false;
			}

			return true;
		});
	}

	private async scoreCandidates(
		taskId: string,
		candidates: User[],
		requirements: TaskRequirements,
		strategy: string,
	): Promise<AssignmentRecommendation[]> {
		const recommendations: AssignmentRecommendation[] = [];
		const workloads = await this.getCurrentWorkloads();
		const workloadByUserId = workloads.reduce<Record<string, Workload>>(
			(acc, workload) => ({
				...acc,
				[workload.userId]: workload,
			}),
			{},
		);
		const maxUtilization = this.balancingConfig.maxUtilization;
		const requiredRoles = requirements.constraints?.requiredRoles ?? [];

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
			const workload = workloadByUserId[candidate.id];
			const overloadConflict: ScheduleConflict[] =
				workload && workload.utilizationRate > maxUtilization
					? [
							{
								id: `overload-${taskId}-${candidate.id}`,
								type: "overload",
								taskId,
								userId: candidate.id,
								description: `User ${candidate.username} is over the utilization threshold`,
								severity: "high",
								detectedAt: new Date(),
							},
						]
					: [];
			const roleConflict: ScheduleConflict[] =
				requiredRoles.length > 0 && !requiredRoles.includes(candidate.role)
					? [
							{
								id: `role-${taskId}-${candidate.id}`,
								type: "skill_mismatch",
								taskId,
								userId: candidate.id,
								description: `User role ${candidate.role} does not match required roles`,
								severity: "medium",
								detectedAt: new Date(),
							},
						]
					: [];
			const timezoneConflict: ScheduleConflict[] =
				requirements.preferredTimezone
					&& candidate.profile.timezone
					&& candidate.profile.timezone !== requirements.preferredTimezone
					? [
							{
								id: `timezone-${taskId}-${candidate.id}`,
								type: "timezone_conflict",
								taskId,
								userId: candidate.id,
								description: `User timezone ${candidate.profile.timezone} differs from preferred ${requirements.preferredTimezone}`,
								severity: "low",
								detectedAt: new Date(),
							},
						]
					: [];
			const potentialConflicts = [
				...overloadConflict,
				...roleConflict,
				...timezoneConflict,
			];

			recommendations.push({
				userId: candidate.id,
				confidence,
				reasons,
				potentialConflicts,
				estimatedCompletionTime: estimatedCompletion,
			});
		}

		return recommendations.sort((a, b) => b.confidence - a.confidence);
	}

	private async calculateAssignmentConfidence(
		user: User,
		requirements: TaskRequirements,
		strategy: string,
	): Promise<number> {
		const workloads = await this.getCurrentWorkloads();
		const userWorkload = workloads.find((w) => w.userId === user.id);

		// 1. Calculate skill matching score (0-100)
		const skillMatchScore = this.calculateSkillMatchScore(user, requirements.requiredSkills);

		// 2. Calculate availability score (0-100)
		const availabilityScore = this.calculateAvailabilityScore(userWorkload);

		// 3. Calculate workload score (0-100)
		const workloadScore = this.calculateWorkloadScore(userWorkload, requirements.estimatedHours);

		// 4. Apply strategy-specific weights
		const weights = this.getStrategyWeights(strategy);

		// Calculate weighted confidence
		const confidence =
			skillMatchScore * weights.skill +
			availabilityScore * weights.availability +
			workloadScore * weights.workload;

		return Math.min(100, Math.max(0, confidence));
	}

	private calculateSkillMatchScore(user: User, requiredSkills: Skill[]): number {
		if (!requiredSkills.length) {
			return 100; // No skills required = perfect match
		}

		const matchingSkills = requiredSkills.filter((skill) =>
			this.roleSupportsSkill(user.role, skill),
		);

		// Calculate match percentage based on role category support
		return (matchingSkills.length / requiredSkills.length) * 100;
	}

	private calculateAvailabilityScore(workload?: Workload): number {
		if (!workload) {
			return 100; // No workload data = assume fully available
		}

		// Score decreases as utilization increases
		if (workload.utilizationRate < this.balancingConfig.minUtilization) {
			return 90 + (10 * (1 - workload.utilizationRate / this.balancingConfig.minUtilization));
		}

		if (workload.utilizationRate <= this.balancingConfig.maxUtilization) {
			return 70 + (20 * (1 - (workload.utilizationRate - this.balancingConfig.minUtilization) /
				(this.balancingConfig.maxUtilization - this.balancingConfig.minUtilization)));
		}

		return Math.max(0, 70 - (workload.utilizationRate - this.balancingConfig.maxUtilization));
	}

	private calculateWorkloadScore(workload: Workload | undefined, taskHours: number): number {
		if (!workload) {
			return 80; // Neutral score when no workload data
		}

		const projectedUtilization =
			((workload.estimatedHours + taskHours) / workload.availableHours) * 100;

		// Score based on how well this task balances the workload
		if (projectedUtilization < this.balancingConfig.minUtilization) {
			return 60 + (40 * (projectedUtilization / this.balancingConfig.minUtilization));
		}

		if (projectedUtilization <= this.balancingConfig.maxUtilization) {
			return 100;
		}

		return Math.max(0, 100 - (projectedUtilization - this.balancingConfig.maxUtilization) * 2);
	}

	private getStrategyWeights(strategy: string): {
		skill: number;
		availability: number;
		workload: number;
	} {
		switch (strategy) {
			case "optimal":
				return { skill: 0.5, availability: 0.25, workload: 0.25 };
			case "balanced":
				return { skill: 0.3, availability: 0.2, workload: 0.5 };
			case "fastest":
				return { skill: 0.3, availability: 0.6, workload: 0.1 };
			case "cost_effective":
				return { skill: 0.4, availability: 0.4, workload: 0.2 };
			default:
				return { skill: 0.4, availability: 0.3, workload: 0.3 };
		}
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
        const baseHoursByType: Record<string, number> = {
            feature: 40,
            story: 24,
            task: 8,
            implementation: 24,
            integration: 20,
            testing: 16,
            research: 12,
        };
        const priorityMultiplierByLevel: Record<string, number> = {
            low: 0.75,
            medium: 1,
            high: 1.25,
        };
        const baseHours = baseHoursByType[task.type] ?? 8;
        const dependencyHours = Math.min((task.dependencies?.length ?? 0) * 2, 16);
        const priorityMultiplier = priorityMultiplierByLevel[task.priority] ?? 1;
        const estimatedHours = Math.max(
            2,
            Math.round((baseHours + dependencyHours) * priorityMultiplier),
        );

        const skillFor = (
            name: string,
            category: Skill["category"],
            level: Skill["level"] = 3,
        ): Skill => ({
            name,
            category,
            level,
        });

        const typeSkills: Record<string, Skill[]> = {
            feature: [
                skillFor("TypeScript", "technical"),
                skillFor("Requirements Analysis", "domain"),
            ],
            story: [
                skillFor("TypeScript", "technical"),
                skillFor("Requirements Analysis", "domain"),
            ],
            task: [skillFor("TypeScript", "technical")],
            implementation: [
                skillFor("TypeScript", "technical"),
                skillFor("Architecture", "technical"),
            ],
            integration: [
                skillFor("API Integration", "technical"),
                skillFor("TypeScript", "technical"),
            ],
            testing: [
                skillFor("Testing", "technical"),
                skillFor("Quality Assurance", "domain"),
            ],
            research: [
                skillFor("Research", "domain"),
                skillFor("Analysis", "domain"),
            ],
        };

        const searchableText = `${task.title} ${task.description}`.toLowerCase();
        const keywordSkills = [
            { keyword: "frontend", skill: skillFor("Frontend Development", "technical") },
            { keyword: "ui", skill: skillFor("UI Design", "technical") },
            { keyword: "ux", skill: skillFor("UX Design", "domain") },
            { keyword: "backend", skill: skillFor("Backend Development", "technical") },
            { keyword: "database", skill: skillFor("Database Design", "technical") },
            { keyword: "api", skill: skillFor("API Design", "technical") },
            { keyword: "integration", skill: skillFor("System Integration", "technical") },
            { keyword: "testing", skill: skillFor("Testing", "technical") },
            { keyword: "security", skill: skillFor("Security", "domain") },
            { keyword: "performance", skill: skillFor("Performance Optimization", "technical") },
            { keyword: "docs", skill: skillFor("Documentation", "domain") },
            { keyword: "documentation", skill: skillFor("Documentation", "domain") },
            { keyword: "devops", skill: skillFor("DevOps", "tool") },
            { keyword: "deployment", skill: skillFor("Deployment", "tool") },
        ];
        const matchedSkills = keywordSkills
            .filter(({ keyword }) => searchableText.includes(keyword))
            .map(({ skill }) => skill);
        const combinedSkills = [...(typeSkills[task.type] ?? []), ...matchedSkills];
        const requiredSkills = combinedSkills.reduce<Skill[]>(
            (acc, skill) =>
                acc.some((existing) => existing.name === skill.name) ? acc : [...acc, skill],
            [],
        );

        return {
            estimatedHours,
            requiredSkills,
            priority: task.priority,
            dependencies: task.dependencies,
        };
	}

	private hasRequiredSkills(user: User, requiredSkills: Skill[]): boolean {
		if (!requiredSkills.length) {
			return true;
		}
		return requiredSkills.every((skill) => this.roleSupportsSkill(user.role, skill));
	}

	private roleSupportsSkill(role: UserRole, skill: Skill): boolean {
		const categoryRoles: Record<Skill["category"], UserRole[]> = {
			technical: ["admin", "manager", "developer"],
			domain: ["admin", "manager"],
			soft: ["admin", "manager", "viewer"],
			tool: ["admin", "developer"],
		};
		return categoryRoles[skill.category]?.includes(role) ?? false;
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
