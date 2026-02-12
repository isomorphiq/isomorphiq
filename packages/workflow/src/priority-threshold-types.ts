import { z } from "zod";
import { struct } from "@tsimpl/runtime";
import type { StructSelf } from "@tsimpl/runtime";
import { TaskPrioritySchema } from "@isomorphiq/types";

/**
 * Priority threshold levels for trigger evaluation
 */
export const PriorityThresholdLevelSchema = z.enum([
    "low",
    "medium",
    "high",
    "critical",
]);

export type PriorityThresholdLevel = z.output<typeof PriorityThresholdLevelSchema>;

/**
 * Priority threshold configuration
 * Defines when a pipeline should be automatically triggered based on priority
 */
export const PriorityThresholdConfigSchema = z.object({
     id: z.string(),
     name: z.string(),
     description: z.string().optional(),
     thresholdLevel: PriorityThresholdLevelSchema,
     comparison: z.enum(["equals", "greater_than_or_equal", "greater_than"]).default("greater_than_or_equal"),
     pipelineId: z.string(),
     enabled: z.boolean().default(true),
     debounceMs: z.number().min(0).max(60000).default(1000),
     maxTriggersPerStory: z.number().min(1).max(100).default(10),
     cooldownMs: z.number().min(0).max(86400000).default(3600000),
     requireConfirmation: z.boolean().default(false),
     requiredStatus: z.array(z.string()).optional(),
     requiredAssignee: z.string().optional(),
     requiredTags: z.array(z.string()).optional(),
     createdAt: z.date(),
     updatedAt: z.date(),
     createdBy: z.string(),
 });

export const PriorityThresholdConfigStruct = struct.name("PriorityThresholdConfig")<
    z.output<typeof PriorityThresholdConfigSchema>,
    z.input<typeof PriorityThresholdConfigSchema>
>(PriorityThresholdConfigSchema);

export type PriorityThresholdConfig = StructSelf<typeof PriorityThresholdConfigStruct>;

/**
 * Priority weight mapping for comparison operations
 */
export const PriorityWeightSchema = z.object({
    low: z.number().default(1),
    medium: z.number().default(2),
    high: z.number().default(3),
    critical: z.number().default(4),
});

export const PriorityWeightStruct = struct.name("PriorityWeight")<
    z.output<typeof PriorityWeightSchema>,
    z.input<typeof PriorityWeightSchema>
>(PriorityWeightSchema);

export type PriorityWeight = StructSelf<typeof PriorityWeightStruct>;

/**
 * Trigger event log entry
 * Records each time a threshold trigger is evaluated or fires
 */
export const PriorityTriggerEventLogSchema = z.object({
    id: z.string(),
    storyId: z.string(),
    thresholdConfigId: z.string(),
    previousPriority: TaskPrioritySchema.optional(),
    newPriority: TaskPrioritySchema,
    triggered: z.boolean(),
    pipelineExecutionId: z.string().optional(),
    timestamp: z.date(),
    reason: z.string(),
    metadata: z.record(z.unknown()).optional(),
});

export const PriorityTriggerEventLogStruct = struct.name("PriorityTriggerEventLog")<
    z.output<typeof PriorityTriggerEventLogSchema>,
    z.input<typeof PriorityTriggerEventLogSchema>
>(PriorityTriggerEventLogSchema);

export type PriorityTriggerEventLog = StructSelf<typeof PriorityTriggerEventLogStruct>;

/**
 * Story trigger state tracking
 * Prevents duplicate triggers and manages cooldown periods
 */
export const StoryTriggerStateSchema = z.object({
    storyId: z.string(),
    thresholdConfigId: z.string(),
    triggerCount: z.number().default(0),
    lastTriggeredAt: z.date().optional(),
    lastPriority: TaskPrioritySchema.optional(),
    pendingExecution: z.boolean().default(false),
    pipelineExecutionIds: z.array(z.string()).default([]),
});

export const StoryTriggerStateStruct = struct.name("StoryTriggerState")<
    z.output<typeof StoryTriggerStateSchema>,
    z.input<typeof StoryTriggerStateSchema>
>(StoryTriggerStateSchema);

export type StoryTriggerState = StructSelf<typeof StoryTriggerStateStruct>;

/**
 * Pipeline execution request
 * Created when a threshold is met and pipeline needs to run
 */
export const PipelineExecutionRequestSchema = z.object({
    id: z.string(),
    storyId: z.string(),
    thresholdConfigId: z.string(),
    pipelineId: z.string(),
    priority: TaskPrioritySchema,
    requestedAt: z.date(),
    status: z.enum(["pending", "scheduled", "running", "completed", "failed"]).default("pending"),
    scheduledAt: z.date().optional(),
    completedAt: z.date().optional(),
    error: z.string().optional(),
});

export const PipelineExecutionRequestStruct = struct.name("PipelineExecutionRequest")<
    z.output<typeof PipelineExecutionRequestSchema>,
    z.input<typeof PipelineExecutionRequestSchema>
>(PipelineExecutionRequestSchema);

export type PipelineExecutionRequest = StructSelf<typeof PipelineExecutionRequestStruct>;

/**
 * Service configuration options
 */
export const PriorityThresholdServiceConfigSchema = z.object({
    defaultDebounceMs: z.number().min(0).max(60000).default(1000),
    defaultCooldownMs: z.number().min(0).max(86400000).default(3600000),
    defaultMaxTriggersPerStory: z.number().min(1).max(100).default(10),
    enableLogging: z.boolean().default(true),
    maxLogEntries: z.number().min(100).max(10000).default(1000),
    batchProcessingIntervalMs: z.number().min(100).max(60000).default(500),
    enableRealTimeEvaluation: z.boolean().default(true),
});

export const PriorityThresholdServiceConfigStruct = struct.name("PriorityThresholdServiceConfig")<
    z.output<typeof PriorityThresholdServiceConfigSchema>,
    z.input<typeof PriorityThresholdServiceConfigSchema>
>(PriorityThresholdServiceConfigSchema);

export type PriorityThresholdServiceConfig = StructSelf<typeof PriorityThresholdServiceConfigStruct>;

/**
 * Evaluation result for a priority change
 */
export const PriorityThresholdEvaluationResultSchema = z.object({
    storyId: z.string(),
    thresholdConfigId: z.string(),
    shouldTrigger: z.boolean(),
    reason: z.string(),
    priorityWeight: z.number(),
    thresholdWeight: z.number(),
    comparison: z.enum(["equals", "greater_than_or_equal", "greater_than"]),
    cooldownActive: z.boolean(),
    maxTriggersReached: z.boolean(),
});

export const PriorityThresholdEvaluationResultStruct = struct.name("PriorityThresholdEvaluationResult")<
    z.output<typeof PriorityThresholdEvaluationResultSchema>,
    z.input<typeof PriorityThresholdEvaluationResultSchema>
>(PriorityThresholdEvaluationResultSchema);

export type PriorityThresholdEvaluationResult = StructSelf<typeof PriorityThresholdEvaluationResultStruct>;

/**
 * Statistics for the priority threshold service
 */
export const PriorityThresholdServiceStatsSchema = z.object({
    totalConfigs: z.number(),
    enabledConfigs: z.number(),
    totalTriggers: z.number(),
    totalEvaluations: z.number(),
    averageTriggersPerStory: z.number(),
    lastEvaluationAt: z.date().optional(),
    lastTriggerAt: z.date().optional(),
});

export const PriorityThresholdServiceStatsStruct = struct.name("PriorityThresholdServiceStats")<
    z.output<typeof PriorityThresholdServiceStatsSchema>,
    z.input<typeof PriorityThresholdServiceStatsSchema>
>(PriorityThresholdServiceStatsSchema);

export type PriorityThresholdServiceStats = StructSelf<typeof PriorityThresholdServiceStatsStruct>;
