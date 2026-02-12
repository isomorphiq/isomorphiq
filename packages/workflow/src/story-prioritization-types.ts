import { z } from "zod";
import { struct } from "@tsimpl/runtime";
import type { StructSelf } from "@tsimpl/runtime";
import { TaskPrioritySchema } from "@isomorphiq/types";

export const PriorityCriterionTypeSchema = z.enum([
    "businessValue",
    "userImpact",
    "effort",
    "risk",
    "dependencies",
    "strategicAlignment",
]);

export type PriorityCriterionType = z.output<typeof PriorityCriterionTypeSchema>;

export const PriorityCriterionSchema = z.object({
    type: PriorityCriterionTypeSchema,
    score: z.number().min(0).max(10),
    weight: z.number().min(0).max(1),
    justification: z.string().optional(),
    evaluatedBy: z.string(),
    evaluatedAt: z.date(),
});

export const PriorityCriterionStruct = struct.name("PriorityCriterion")<
    z.output<typeof PriorityCriterionSchema>,
    z.input<typeof PriorityCriterionSchema>
>(PriorityCriterionSchema);

export type PriorityCriterion = StructSelf<typeof PriorityCriterionStruct>;

export const PriorityScoreSchema = z.object({
    storyId: z.string(),
    totalScore: z.number().min(0).max(10),
    weightedScore: z.number(),
    priority: TaskPrioritySchema,
    confidence: z.number().min(0).max(1),
    criteria: z.array(PriorityCriterionSchema),
    calculatedAt: z.date(),
    calculatedBy: z.string(),
    version: z.number().default(1),
});

export const PriorityScoreStruct = struct.name("PriorityScore")<
    z.output<typeof PriorityScoreSchema>,
    z.input<typeof PriorityScoreSchema>
>(PriorityScoreSchema);

export type PriorityScore = StructSelf<typeof PriorityScoreStruct>;

export const PriorityEvaluationStatusSchema = z.enum([
    "pending",
    "in_progress",
    "completed",
    "failed",
    "approved",
    "rejected",
]);

export type PriorityEvaluationStatus = z.output<typeof PriorityEvaluationStatusSchema>;

export const StoryPriorityEvaluationSchema = z.object({
    id: z.string(),
    storyId: z.string(),
    status: PriorityEvaluationStatusSchema,
    score: PriorityScoreSchema.optional(),
    requestedBy: z.string(),
    requestedAt: z.date(),
    completedAt: z.date().optional(),
    approvers: z.array(z.string()).optional(),
    rejectionReason: z.string().optional(),
    metadata: z.record(z.unknown()).optional(),
});

export const StoryPriorityEvaluationStruct = struct.name("StoryPriorityEvaluation")<
    z.output<typeof StoryPriorityEvaluationSchema>,
    z.input<typeof StoryPriorityEvaluationSchema>
>(StoryPriorityEvaluationSchema);

export type StoryPriorityEvaluation = StructSelf<typeof StoryPriorityEvaluationStruct>;

export const PriorityConflictTypeSchema = z.enum([
    "dependency_conflict",
    "resource_conflict",
    "priority_override",
    "concurrent_modification",
]);

export type PriorityConflictType = z.output<typeof PriorityConflictTypeSchema>;

export const PriorityConflictSchema = z.object({
    id: z.string(),
    type: PriorityConflictTypeSchema,
    storyId: z.string(),
    conflictingStoryId: z.string().optional(),
    description: z.string(),
    detectedAt: z.date(),
    detectedBy: z.string(),
    severity: z.enum(["low", "medium", "high", "critical"]),
    resolution: z.enum(["pending", "resolved", "escalated"]).default("pending"),
    resolutionStrategy: z.enum([
        "auto_resolve",
        "manual_review",
        "stakeholder_vote",
        "escalate_to_leadership",
    ]).optional(),
    resolvedAt: z.date().optional(),
    resolvedBy: z.string().optional(),
});

export const PriorityConflictStruct = struct.name("PriorityConflict")<
    z.output<typeof PriorityConflictSchema>,
    z.input<typeof PriorityConflictSchema>
>(PriorityConflictSchema);

export type PriorityConflict = StructSelf<typeof PriorityConflictStruct>;

export const PriorityHistoryEntrySchema = z.object({
    id: z.string(),
    storyId: z.string(),
    previousPriority: TaskPrioritySchema.optional(),
    newPriority: TaskPrioritySchema,
    previousScore: z.number().optional(),
    newScore: z.number(),
    changedBy: z.string(),
    changedAt: z.date(),
    reason: z.string(),
    evaluationId: z.string().optional(),
});

export const PriorityHistoryEntryStruct = struct.name("PriorityHistoryEntry")<
    z.output<typeof PriorityHistoryEntrySchema>,
    z.input<typeof PriorityHistoryEntrySchema>
>(PriorityHistoryEntrySchema);

export type PriorityHistoryEntry = StructSelf<typeof PriorityHistoryEntryStruct>;

export const StoryWorkflowTriggerTypeSchema = z.enum([
    "story_created",
    "story_priority_changed",
    "story_dependencies_changed",
    "story_status_changed",
    "batch_priority_update",
    "evaluation_requested",
    "evaluation_completed",
]);

export type StoryWorkflowTriggerType = z.output<typeof StoryWorkflowTriggerTypeSchema>;

export const StoryWorkflowTriggerSchema = z.object({
    id: z.string(),
    type: StoryWorkflowTriggerTypeSchema,
    storyId: z.string().optional(),
    storyIds: z.array(z.string()).optional(),
    workflowId: z.string(),
    triggeredAt: z.date(),
    triggeredBy: z.string(),
    data: z.record(z.unknown()).optional(),
});

export const StoryWorkflowTriggerStruct = struct.name("StoryWorkflowTrigger")<
    z.output<typeof StoryWorkflowTriggerSchema>,
    z.input<typeof StoryWorkflowTriggerSchema>
>(StoryWorkflowTriggerSchema);

export type StoryWorkflowTrigger = StructSelf<typeof StoryWorkflowTriggerStruct>;

export const PriorityRecommendationSchema = z.object({
    storyId: z.string(),
    currentPriority: TaskPrioritySchema,
    recommendedPriority: TaskPrioritySchema,
    currentScore: z.number(),
    recommendedScore: z.number(),
    confidence: z.number().min(0).max(1),
    reasoning: z.array(z.string()),
    factors: z.array(z.object({
        factor: z.string(),
        impact: z.enum(["positive", "negative", "neutral"]),
        weight: z.number(),
    })),
    generatedAt: z.date(),
    generatedBy: z.string(),
});

export const PriorityRecommendationStruct = struct.name("PriorityRecommendation")<
    z.output<typeof PriorityRecommendationSchema>,
    z.input<typeof PriorityRecommendationSchema>
>(PriorityRecommendationSchema);

export type PriorityRecommendation = StructSelf<typeof PriorityRecommendationStruct>;
