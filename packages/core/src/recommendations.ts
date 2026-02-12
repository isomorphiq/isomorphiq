import { z } from "zod";
import { impl, struct } from "@tsimpl/runtime";
import type { StructSelf } from "@tsimpl/runtime";

export const RecommendationTypeSchema = z.enum([
    "related_task",
    "dependency_suggestion", 
    "priority_adjustment",
    "assignment_suggestion",
    "template_suggestion",
    "workflow_optimization",
    "task_sequence",
    "deadline_adjustment",
    "skill_match",
    "resource_allocation"
]);

export type RecommendationType = z.output<typeof RecommendationTypeSchema>;

export const RecommendationPrioritySchema = z.enum(["critical", "high", "medium", "low"]);

export type RecommendationPriority = z.output<typeof RecommendationPrioritySchema>;

export const RecommendationContextSchema = z.object({
    taskId: z.string().optional(),
    userId: z.string().optional(),
    projectId: z.string().optional(),
    teamId: z.string().optional(),
    taskTitle: z.string().optional(),
    taskDescription: z.string().optional(),
    currentPriority: z.string().optional(),
    currentAssignee: z.string().optional(),
    dueDate: z.string().optional(),
    tags: z.array(z.string()).optional(),
});

export type RecommendationContext = z.output<typeof RecommendationContextSchema>;

export const TaskRecommendationSchema = z.object({
    id: z.string(),
    type: RecommendationTypeSchema,
    title: z.string(),
    description: z.string(),
    priority: RecommendationPrioritySchema,
    confidence: z.number().min(0).max(1),
    context: RecommendationContextSchema,
    suggestedTask: z.object({
        title: z.string().optional(),
        description: z.string().optional(),
        priority: z.string().optional(),
        assignee: z.string().optional(),
        dependencies: z.array(z.string()).optional(),
        estimatedDuration: z.number().optional(),
        tags: z.array(z.string()).optional(),
    }).optional(),
    reason: z.string(),
    impact: z.string(),
    implementation: z.object({
        steps: z.array(z.string()),
        effort: z.enum(["trivial", "easy", "medium", "hard", "complex"]),
        timeEstimate: z.string().optional(),
    }).optional(),
    metadata: z.record(z.unknown()).optional(),
    createdAt: z.date(),
    expiresAt: z.date().optional(),
    applied: z.boolean().optional(),
    dismissed: z.boolean().optional(),
});

export const TaskRecommendationStruct = struct.name("TaskRecommendation")<z.output<typeof TaskRecommendationSchema>, z.input<typeof TaskRecommendationSchema>>(TaskRecommendationSchema);
export type TaskRecommendation = StructSelf<typeof TaskRecommendationStruct>;

export const RecommendationFilterSchema = z.object({
    type: RecommendationTypeSchema.optional(),
    priority: RecommendationPrioritySchema.optional(),
    taskId: z.string().optional(),
    userId: z.string().optional(),
    applied: z.boolean().optional(),
    dismissed: z.boolean().optional(),
    minConfidence: z.number().optional(),
    maxAge: z.number().optional(), // in hours
});

export const RecommendationFilterStruct = struct.name("RecommendationFilter")<z.output<typeof RecommendationFilterSchema>, z.input<typeof RecommendationFilterSchema>>(RecommendationFilterSchema);
export type RecommendationFilter = StructSelf<typeof RecommendationFilterStruct>;

export const RecommendationRequestSchema = z.object({
    context: RecommendationContextSchema,
    maxRecommendations: z.number().default(5),
    types: z.array(RecommendationTypeSchema).optional(),
    minConfidence: z.number().default(0.3),
});

export const RecommendationRequestStruct = struct.name("RecommendationRequest")<z.output<typeof RecommendationRequestSchema>, z.input<typeof RecommendationRequestSchema>>(RecommendationRequestSchema);
export type RecommendationRequest = StructSelf<typeof RecommendationRequestStruct>;

export const RecommendationResponseSchema = z.object({
    recommendations: z.array(TaskRecommendationSchema),
    total: z.number(),
    context: RecommendationContextSchema,
    generatedAt: z.date(),
    processingTime: z.number(),
    metadata: z.object({
        algorithms: z.array(z.string()),
        dataPoints: z.number(),
        confidence: z.number(),
    }).optional(),
});

export const RecommendationResponseStruct = struct.name("RecommendationResponse")<z.output<typeof RecommendationResponseSchema>, z.input<typeof RecommendationResponseSchema>>(RecommendationResponseSchema);
export type RecommendationResponse = StructSelf<typeof RecommendationResponseStruct>;

export const RecommendationAnalyticsSchema = z.object({
    totalRecommendations: z.number(),
    appliedRecommendations: z.number(),
    dismissedRecommendations: z.number(),
    averageConfidence: z.number(),
    recommendationTypes: z.record(z.number()),
    userEngagement: z.object({
        applied: z.array(z.string()),
        dismissed: z.array(z.string()),
        viewed: z.array(z.string()),
    }),
    timeToApply: z.record(z.number()), // recommendationId -> time in hours
    effectiveness: z.object({
        taskCompletionImprovement: z.number(),
        accuracy: z.number(),
        userSatisfaction: z.number(),
    }),
});

export const RecommendationAnalyticsStruct = struct.name("RecommendationAnalytics")<z.output<typeof RecommendationAnalyticsSchema>, z.input<typeof RecommendationAnalyticsSchema>>(RecommendationAnalyticsSchema);
export type RecommendationAnalytics = StructSelf<typeof RecommendationAnalyticsStruct>;

export const TaskPatternSchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    type: z.enum(["sequential", "parallel", "dependency", "recurring", "skill_based"]),
    frequency: z.number(),
    confidence: z.number(),
    tasks: z.array(z.string()), // task IDs or patterns
    conditions: z.array(z.string()),
    outcomes: z.object({
        successRate: z.number(),
        averageDuration: z.number(),
        commonIssues: z.array(z.string()),
    }),
    createdAt: z.date(),
    lastSeen: z.date(),
    isActive: z.boolean(),
});

export const TaskPatternStruct = struct.name("TaskPattern")<z.output<typeof TaskPatternSchema>, z.input<typeof TaskPatternSchema>>(TaskPatternSchema);
export type TaskPattern = StructSelf<typeof TaskPatternStruct>;

export const RecommendationLearningDataSchema = z.object({
    taskId: z.string(),
    recommendationId: z.string(),
    action: z.enum(["applied", "dismissed", "modified", "ignored"]),
    timestamp: z.date(),
    outcome: z.object({
        success: z.boolean(),
        impact: z.string(),
        userFeedback: z.string().optional(),
        metrics: z.record(z.number()).optional(),
    }).optional(),
    timeToAction: z.number().optional(), // in minutes
});

export const RecommendationLearningDataStruct = struct.name("RecommendationLearningData")<z.output<typeof RecommendationLearningDataSchema>, z.input<typeof RecommendationLearningDataSchema>>(RecommendationLearningDataSchema);
export type RecommendationLearningData = StructSelf<typeof RecommendationLearningDataStruct>;

// Trait implementations will be imported from @isomorphiq/types