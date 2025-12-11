export type TaskPriority = "low" | "medium" | "high";

/**
 * Team member skills and expertise levels
 */
export interface Skill {
	name: string;
	level: 1 | 2 | 3 | 4 | 5; // 1=Beginner, 5=Expert
	category: "technical" | "domain" | "soft" | "tool";
	lastUsed?: Date;
	certifications?: string[];
}

/**
 * Team member availability and working preferences
 */
export interface Availability {
	timezone: string;
	workingHours: {
		start: string; // HH:mm format
		end: string; // HH:mm format
	};
	workingDays: number[]; // 0=Sunday, 6=Saturday
	vacationDates: Date[];
	unavailableDates: Date[];
	maxHoursPerDay: number;
	maxHoursPerWeek: number;
	preferredWorkload: number; // percentage of full capacity
}

/**
 * Team member workload and capacity information
 */
export interface Workload {
	userId: string;
	currentTasks: number;
	estimatedHours: number;
	availableHours: number;
	utilizationRate: number; // percentage
	overloaded: boolean;
	skillUtilization: Record<string, number>; // skill name -> utilization percentage
}

/**
 * Task requirements for scheduling
 */
export interface TaskRequirements {
	estimatedHours: number;
	requiredSkills: Skill[];
	priority: TaskPriority;
	deadline?: Date;
	dependencies: string[];
	preferredTimezone?: string;
	requiredAvailability?: {
		start: Date;
		end: Date;
	};
	constraints?: {
		maxAssignees?: number;
		minAssignees?: number;
		requiredRoles?: UserRole[];
		excludedUsers?: string[];
		preferredUsers?: string[];
	};
}

/**
 * Scheduling conflict types
 */
export type ConflictType =
	| "double_booking"
	| "skill_mismatch"
	| "overload"
	| "deadline_conflict"
	| "dependency_conflict"
	| "availability_conflict"
	| "timezone_conflict";

/**
 * Scheduling conflict information
 */
export interface ScheduleConflict {
	id: string;
	type: ConflictType;
	taskId: string;
	userId: string;
	description: string;
	severity: "low" | "medium" | "high" | "critical";
	resolution?: ConflictResolution;
	detectedAt: Date;
}

/**
 * Conflict resolution strategies
 */
export interface ConflictResolution {
	strategy: "reassign" | "reschedule" | "add_resources" | "extend_deadline" | "manual";
	proposedSolution: string;
	requiresApproval: boolean;
	resolvedAt?: Date;
	resolvedBy?: string;
}

/**
 * Assignment recommendation with confidence score
 */
export interface AssignmentRecommendation {
	userId: string;
	confidence: number; // 0-100
	reasons: string[];
	potentialConflicts: ScheduleConflict[];
	estimatedCompletionTime: Date;
	cost?: number;
}

/**
 * Scheduling algorithm configuration
 */
export interface SchedulingConfig {
	algorithm: "priority_first" | "load_balanced" | "deadline_driven" | "skill_optimized" | "hybrid";
	weights: {
		priority: number;
		skills: number;
		availability: number;
		workload: number;
		deadline: number;
	};
	conflictResolution: "auto" | "manual" | "hybrid";
	maxConflictsPerTask: number;
	schedulingHorizon: number; // days
	bufferTime: number; // percentage of estimated time to add as buffer
}

/**
 * Schedule optimization result
 */
export interface ScheduleOptimization {
	optimized: boolean;
	improvements: string[];
	conflictsResolved: number;
	newAssignments: Array<{
		taskId: string;
		userId: string;
		oldUserId?: string;
		reason: string;
	}>;
	metrics: {
		totalUtilization: number;
		averageCompletionTime: number;
		conflictCount: number;
		skillMatchScore: number;
	};
}

/**
 * Team capacity and availability snapshot
 */
export interface TeamCapacity {
	date: Date;
	totalMembers: number;
	availableMembers: number;
	totalAvailableHours: number;
	totalScheduledHours: number;
	utilizationRate: number;
	skillCoverage: Record<string, number>; // skill name -> coverage percentage
	overloadedMembers: string[];
	underutilizedMembers: string[];
}

/**
 * Scheduling request input
 */
export interface AutoAssignRequest {
	taskIds?: string[]; // specific tasks to assign, or empty for all unassigned
	config?: Partial<SchedulingConfig>;
	forceReassign?: boolean; // whether to reassign already assigned tasks
	notifyUsers?: boolean;
	scheduledBy?: string;
}

/**
 * Scheduling result
 */
export interface AutoAssignResult {
	success: boolean;
	assignedTasks: Array<{
		taskId: string;
		userId: string;
		confidence: number;
		reasons: string[];
	}>;
	conflicts: ScheduleConflict[];
	errors: string[];
	skippedTasks: Array<{
		taskId: string;
		reason: string;
	}>;
	metrics: {
		tasksProcessed: number;
		tasksAssigned: number;
		conflictsDetected: number;
		conflictsResolved: number;
		averageConfidence: number;
	};
}

/**
 * Team availability calendar data
 */
export interface TeamAvailabilityCalendar {
	userId: string;
	date: Date;
	available: boolean;
	workingHours: number;
	scheduledHours: number;
	utilization: number;
	tasks: Array<{
		taskId: string;
		title: string;
		hours: number;
		priority: TaskPriority;
	}>;
}

/**
 * Resource allocation metrics
 */
export interface ResourceAllocationMetrics {
	teamId: string;
	date: Date;
	totalTasks: number;
	assignedTasks: number;
	unassignedTasks: number;
	averageUtilization: number;
	skillUtilization: Record<string, number>;
	workloadDistribution: Record<string, number>; // userId -> workload percentage
	conflictRate: number;
	completionRate: number;
	averageTaskDuration: number;
}

/**
 * Scheduling engine interface
 */
export interface ISchedulingEngine {
	// Core scheduling operations
	autoAssign(request: AutoAssignRequest): Promise<AutoAssignResult>;
	optimizeSchedule(config?: Partial<SchedulingConfig>): Promise<ScheduleOptimization>;
	detectConflicts(): Promise<ScheduleConflict[]>;
	resolveConflicts(conflictIds: string[]): Promise<ScheduleConflict[]>;

	// Assignment recommendations
	getRecommendations(taskId: string): Promise<AssignmentRecommendation[]>;
	getBestAssignee(taskId: string): Promise<AssignmentRecommendation | null>;

	// Team capacity and availability
	getTeamCapacity(startDate: Date, endDate: Date): Promise<TeamCapacity[]>;
	getTeamAvailability(
		userId: string,
		startDate: Date,
		endDate: Date,
	): Promise<TeamAvailabilityCalendar[]>;
	getWorkloads(): Promise<Workload[]>;

	// Resource management
	updateSkills(userId: string, skills: Skill[]): Promise<void>;
	updateAvailability(userId: string, availability: Availability): Promise<void>;
	getResourceMetrics(startDate?: Date, endDate?: Date): Promise<ResourceAllocationMetrics>;
}

/**
 * Scheduling service interface
 */
export interface ISchedulingService extends ISchedulingEngine {
	// Configuration management
	getConfig(): SchedulingConfig;
	updateConfig(config: Partial<SchedulingConfig>): Promise<void>;
	resetConfig(): Promise<void>;

	// Bulk operations
	bulkAssign(taskIds: string[], userIds: string[]): Promise<AutoAssignResult>;
	bulkReassign(taskIds: string[]): Promise<AutoAssignResult>;

	// Analytics and reporting
	getSchedulingAnalytics(period: "day" | "week" | "month"): Promise<{
		efficiency: number;
		utilization: number;
		conflictRate: number;
		compliance: number;
		trends: Array<{
			date: Date;
			metric: string;
			value: number;
		}>;
	}>;

	// Integration with task system
	syncWithTasks(): Promise<void>;
	validateAssignments(): Promise<{
		valid: boolean;
		issues: Array<{
			taskId: string;
			issue: string;
			severity: "low" | "medium" | "high";
		}>;
	}>;
}
