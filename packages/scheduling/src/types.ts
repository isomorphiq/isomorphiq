import { z } from "zod";
import { impl, method, struct, trait } from "@tsimpl/runtime";
import type { StructSelf } from "@tsimpl/runtime";
import type { Self } from "@tsimpl/core";
import { TaskPrioritySchema } from "@isomorphiq/tasks";
import { UserRoleSchema } from "@isomorphiq/auth";

export const HasUserIdTrait = trait({
    userId: method<Self, string>(),
});

export const SkillSchema = z.object({
    name: z.string(),
    level: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
    category: z.enum(["technical", "domain", "soft", "tool"]),
    lastUsed: z.date().optional(),
    certifications: z.array(z.string()).optional(),
});

export const SkillStruct = struct.name("Skill")<z.output<typeof SkillSchema>, z.input<typeof SkillSchema>>(SkillSchema);
export type Skill = StructSelf<typeof SkillStruct>;

export const AvailabilitySchema = z.object({
    timezone: z.string(),
    workingHours: z.object({
        start: z.string(),
        end: z.string(),
    }),
    workingDays: z.array(z.number()),
    vacationDates: z.array(z.date()),
    unavailableDates: z.array(z.date()),
    maxHoursPerDay: z.number(),
    maxHoursPerWeek: z.number(),
    preferredWorkload: z.number(),
});

export const AvailabilityStruct = struct.name("Availability")<z.output<typeof AvailabilitySchema>, z.input<typeof AvailabilitySchema>>(AvailabilitySchema);
export type Availability = StructSelf<typeof AvailabilityStruct>;

export const WorkloadSchema = z.object({
    userId: z.string(),
    currentTasks: z.number(),
    estimatedHours: z.number(),
    availableHours: z.number(),
    utilizationRate: z.number(),
    overloaded: z.boolean(),
    skillUtilization: z.record(z.number()),
});

export const WorkloadStruct = struct.name("Workload")<z.output<typeof WorkloadSchema>, z.input<typeof WorkloadSchema>>(WorkloadSchema);
export type Workload = StructSelf<typeof WorkloadStruct>;

export const TaskRequirementsSchema = z.object({
    estimatedHours: z.number(),
    requiredSkills: z.array(SkillSchema),
    priority: TaskPrioritySchema,
    deadline: z.date().optional(),
    dependencies: z.array(z.string()),
    preferredTimezone: z.string().optional(),
    requiredAvailability: z
        .object({
            start: z.date(),
            end: z.date(),
        })
        .optional(),
    constraints: z
        .object({
            maxAssignees: z.number().optional(),
            minAssignees: z.number().optional(),
            requiredRoles: z.array(UserRoleSchema).optional(),
            excludedUsers: z.array(z.string()).optional(),
            preferredUsers: z.array(z.string()).optional(),
        })
        .optional(),
});

export const TaskRequirementsStruct = struct.name("TaskRequirements")<z.output<typeof TaskRequirementsSchema>, z.input<typeof TaskRequirementsSchema>>(TaskRequirementsSchema);
export type TaskRequirements = StructSelf<typeof TaskRequirementsStruct>;

export const ConflictTypeSchema = z.enum([
    "double_booking",
    "skill_mismatch",
    "overload",
    "deadline_conflict",
    "dependency_conflict",
    "availability_conflict",
    "timezone_conflict",
]);

export type ConflictType = z.output<typeof ConflictTypeSchema>;

export const ConflictResolutionSchema = z.object({
    strategy: z.enum(["reassign", "reschedule", "add_resources", "extend_deadline", "manual"]),
    proposedSolution: z.string(),
    requiresApproval: z.boolean(),
    resolvedAt: z.date().optional(),
    resolvedBy: z.string().optional(),
});

export const ConflictResolutionStruct = struct.name("ConflictResolution")<z.output<typeof ConflictResolutionSchema>, z.input<typeof ConflictResolutionSchema>>(ConflictResolutionSchema);
export type ConflictResolution = StructSelf<typeof ConflictResolutionStruct>;

export const ScheduleConflictSchema = z.object({
    id: z.string(),
    type: ConflictTypeSchema,
    taskId: z.string(),
    userId: z.string(),
    description: z.string(),
    severity: z.enum(["low", "medium", "high", "critical"]),
    resolution: ConflictResolutionSchema.optional(),
    detectedAt: z.date(),
});

export const ScheduleConflictStruct = struct.name("ScheduleConflict")<z.output<typeof ScheduleConflictSchema>, z.input<typeof ScheduleConflictSchema>>(ScheduleConflictSchema);
export type ScheduleConflict = StructSelf<typeof ScheduleConflictStruct>;

export const AssignmentRecommendationSchema = z.object({
    userId: z.string(),
    confidence: z.number(),
    reasons: z.array(z.string()),
    potentialConflicts: z.array(ScheduleConflictSchema),
    estimatedCompletionTime: z.date(),
    cost: z.number().optional(),
});

export const AssignmentRecommendationStruct = struct.name("AssignmentRecommendation")<z.output<typeof AssignmentRecommendationSchema>, z.input<typeof AssignmentRecommendationSchema>>(AssignmentRecommendationSchema);
export type AssignmentRecommendation = StructSelf<typeof AssignmentRecommendationStruct>;

export const SchedulingConfigSchema = z.object({
    algorithm: z.enum([
        "priority_first",
        "load_balanced",
        "deadline_driven",
        "skill_optimized",
        "hybrid",
    ]),
    weights: z.object({
        priority: z.number(),
        skills: z.number(),
        availability: z.number(),
        workload: z.number(),
        deadline: z.number(),
    }),
    conflictResolution: z.enum(["auto", "manual", "hybrid"]),
    maxConflictsPerTask: z.number(),
    schedulingHorizon: z.number(),
    bufferTime: z.number(),
});

export const SchedulingConfigStruct = struct.name("SchedulingConfig")<z.output<typeof SchedulingConfigSchema>, z.input<typeof SchedulingConfigSchema>>(SchedulingConfigSchema);
export type SchedulingConfig = StructSelf<typeof SchedulingConfigStruct>;

export const ScheduleOptimizationSchema = z.object({
    optimized: z.boolean(),
    improvements: z.array(z.string()),
    conflictsResolved: z.number(),
    newAssignments: z.array(
        z.object({
            taskId: z.string(),
            userId: z.string(),
            oldUserId: z.string().optional(),
            reason: z.string(),
        }),
    ),
    metrics: z.object({
        totalUtilization: z.number(),
        averageCompletionTime: z.number(),
        conflictCount: z.number(),
        skillMatchScore: z.number(),
    }),
});

export const ScheduleOptimizationStruct = struct.name("ScheduleOptimization")<z.output<typeof ScheduleOptimizationSchema>, z.input<typeof ScheduleOptimizationSchema>>(ScheduleOptimizationSchema);
export type ScheduleOptimization = StructSelf<typeof ScheduleOptimizationStruct>;

export const TeamCapacitySchema = z.object({
    date: z.date(),
    totalMembers: z.number(),
    availableMembers: z.number(),
    totalAvailableHours: z.number(),
    totalScheduledHours: z.number(),
    utilizationRate: z.number(),
    skillCoverage: z.record(z.number()),
    overloadedMembers: z.array(z.string()),
    underutilizedMembers: z.array(z.string()),
});

export const TeamCapacityStruct = struct.name("TeamCapacity")<z.output<typeof TeamCapacitySchema>, z.input<typeof TeamCapacitySchema>>(TeamCapacitySchema);
export type TeamCapacity = StructSelf<typeof TeamCapacityStruct>;

export const AutoAssignRequestSchema = z.object({
    taskIds: z.array(z.string()).optional(),
    config: SchedulingConfigSchema.partial().optional(),
    forceReassign: z.boolean().optional(),
    notifyUsers: z.boolean().optional(),
    scheduledBy: z.string().optional(),
});

export const AutoAssignRequestStruct = struct.name("AutoAssignRequest")<z.output<typeof AutoAssignRequestSchema>, z.input<typeof AutoAssignRequestSchema>>(AutoAssignRequestSchema);
export type AutoAssignRequest = StructSelf<typeof AutoAssignRequestStruct>;

export const AutoAssignResultSchema = z.object({
    success: z.boolean(),
    assignedTasks: z.array(
        z.object({
            taskId: z.string(),
            userId: z.string(),
            confidence: z.number(),
            reasons: z.array(z.string()),
        }),
    ),
    conflicts: z.array(ScheduleConflictSchema),
    errors: z.array(z.string()),
    skippedTasks: z.array(
        z.object({
            taskId: z.string(),
            reason: z.string(),
        }),
    ),
    metrics: z.object({
        tasksProcessed: z.number(),
        tasksAssigned: z.number(),
        conflictsDetected: z.number(),
        conflictsResolved: z.number(),
        averageConfidence: z.number(),
    }),
});

export const AutoAssignResultStruct = struct.name("AutoAssignResult")<z.output<typeof AutoAssignResultSchema>, z.input<typeof AutoAssignResultSchema>>(AutoAssignResultSchema);
export type AutoAssignResult = StructSelf<typeof AutoAssignResultStruct>;

export const TeamAvailabilityCalendarSchema = z.object({
    userId: z.string(),
    date: z.date(),
    available: z.boolean(),
    workingHours: z.number(),
    scheduledHours: z.number(),
    utilization: z.number(),
    tasks: z.array(
        z.object({
            taskId: z.string(),
            title: z.string(),
            hours: z.number(),
            priority: TaskPrioritySchema,
        }),
    ),
});

export const TeamAvailabilityCalendarStruct = struct.name("TeamAvailabilityCalendar")<z.output<typeof TeamAvailabilityCalendarSchema>, z.input<typeof TeamAvailabilityCalendarSchema>>(TeamAvailabilityCalendarSchema);
export type TeamAvailabilityCalendar = StructSelf<typeof TeamAvailabilityCalendarStruct>;

export const ResourceAllocationMetricsSchema = z.object({
    teamId: z.string(),
    date: z.date(),
    totalTasks: z.number(),
    assignedTasks: z.number(),
    unassignedTasks: z.number(),
    averageUtilization: z.number(),
    skillUtilization: z.record(z.number()),
    workloadDistribution: z.record(z.number()),
    conflictRate: z.number(),
    completionRate: z.number(),
    averageTaskDuration: z.number(),
});

export const ResourceAllocationMetricsStruct = struct.name("ResourceAllocationMetrics")<z.output<typeof ResourceAllocationMetricsSchema>, z.input<typeof ResourceAllocationMetricsSchema>>(ResourceAllocationMetricsSchema);
export type ResourceAllocationMetrics = StructSelf<typeof ResourceAllocationMetricsStruct>;

export interface ISchedulingEngine {
    autoAssign(request: AutoAssignRequest): Promise<AutoAssignResult>;
    optimizeSchedule(config?: Partial<SchedulingConfig>): Promise<ScheduleOptimization>;
    detectConflicts(): Promise<ScheduleConflict[]>;
    resolveConflicts(conflictIds: string[]): Promise<ScheduleConflict[]>;
    getRecommendations(taskId: string): Promise<AssignmentRecommendation[]>;
    getBestAssignee(taskId: string): Promise<AssignmentRecommendation | null>;
    getTeamCapacity(startDate: Date, endDate: Date): Promise<TeamCapacity[]>;
    getTeamAvailability(
        userId: string,
        startDate: Date,
        endDate: Date,
    ): Promise<TeamAvailabilityCalendar[]>;
    getWorkloads(): Promise<Workload[]>;
    updateSkills(userId: string, skills: Skill[]): Promise<void>;
    updateAvailability(userId: string, availability: Availability): Promise<void>;
    getResourceMetrics(startDate?: Date, endDate?: Date): Promise<ResourceAllocationMetrics>;
}

export interface ISchedulingService extends ISchedulingEngine {
    getConfig(): SchedulingConfig;
    updateConfig(config: Partial<SchedulingConfig>): Promise<void>;
    resetConfig(): Promise<void>;
    bulkAssign(taskIds: string[], userIds: string[]): Promise<AutoAssignResult>;
    bulkReassign(taskIds: string[]): Promise<AutoAssignResult>;
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

impl(HasUserIdTrait).for(WorkloadStruct, {
    userId: method((self: Workload) => self.userId),
});

impl(HasUserIdTrait).for(AssignmentRecommendationStruct, {
    userId: method((self: AssignmentRecommendation) => self.userId),
});

impl(HasUserIdTrait).for(TeamAvailabilityCalendarStruct, {
    userId: method((self: TeamAvailabilityCalendar) => self.userId),
});

impl(HasUserIdTrait).for(ScheduleConflictStruct, {
    userId: method((self: ScheduleConflict) => self.userId),
});
