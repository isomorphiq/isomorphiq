import { z } from "zod";
import { impl, method, struct, trait } from "@tsimpl/runtime";
import type { StructSelf } from "@tsimpl/runtime";
import type { Self } from "@tsimpl/core";

export const AutomaticTransitionTypeSchema = z.enum([
    "pipeline_triggered",
    "stage_completed",
    "stage_failed",
    "stage_recovered",
    "condition_evaluated",
    "action_executed",
    "workflow_completed",
    "workflow_failed",
    "threshold_met",
    "threshold_not_met",
    "dependency_satisfied",
    "priority_changed",
]);

export type AutomaticTransitionType = z.output<typeof AutomaticTransitionTypeSchema>;

export const AutomaticTransitionReasonSchema = z.enum([
    "priority_threshold_met",
    "dependency_resolved",
    "scheduled_execution",
    "event_triggered",
    "condition_passed",
    "condition_failed",
    "retry_attempt",
    "recovery_action",
    "manual_intervention",
    "system_initiated",
]);

export type AutomaticTransitionReason = z.output<typeof AutomaticTransitionReasonSchema>;

export const AutomaticTransitionStatusSchema = z.enum([
    "pending",
    "in_progress",
    "completed",
    "failed",
    "recovered",
    "cancelled",
]);

export type AutomaticTransitionStatus = z.output<typeof AutomaticTransitionStatusSchema>;

export const AutomaticTransitionLogEntrySchema = z.object({
    id: z.string(),
    timestamp: z.date(),
    transitionType: AutomaticTransitionTypeSchema,
    reason: AutomaticTransitionReasonSchema,
    status: AutomaticTransitionStatusSchema,
    executionId: z.string(),
    pipelineId: z.string().optional(),
    stageId: z.string().optional(),
    storyId: z.string().optional(),
    taskId: z.string().optional(),
    workflowId: z.string().optional(),
    nodeId: z.string().optional(),
    details: z.record(z.unknown()).optional(),
    metadata: z.object({
        triggeredBy: z.string().optional(),
        source: z.enum(["manual", "automatic", "scheduled", "event"]).optional(),
        correlationId: z.string().optional(),
        parentExecutionId: z.string().optional(),
    }).optional(),
    duration: z.number().optional(),
    error: z.object({
        code: z.string(),
        message: z.string(),
        stack: z.string().optional(),
    }).optional(),
});

export const AutomaticTransitionLogEntryStruct = struct.name("AutomaticTransitionLogEntry")<
    z.output<typeof AutomaticTransitionLogEntrySchema>,
    z.input<typeof AutomaticTransitionLogEntrySchema>
>(AutomaticTransitionLogEntrySchema);

export type AutomaticTransitionLogEntry = StructSelf<typeof AutomaticTransitionLogEntryStruct>;

export const AutomaticTransitionLogQuerySchema = z.object({
    executionId: z.string().optional(),
    pipelineId: z.string().optional(),
    storyId: z.string().optional(),
    taskId: z.string().optional(),
    workflowId: z.string().optional(),
    transitionType: AutomaticTransitionTypeSchema.optional(),
    status: AutomaticTransitionStatusSchema.optional(),
    reason: AutomaticTransitionReasonSchema.optional(),
    fromDate: z.date().optional(),
    toDate: z.date().optional(),
    limit: z.number().optional(),
    offset: z.number().optional(),
});

export type AutomaticTransitionLogQuery = z.output<typeof AutomaticTransitionLogQuerySchema>;

export const AutomaticTransitionLogStatsSchema = z.object({
    totalTransitions: z.number(),
    completedTransitions: z.number(),
    failedTransitions: z.number(),
    recoveredTransitions: z.number(),
    averageDuration: z.number(),
    transitionsByType: z.record(z.number()),
    transitionsByReason: z.record(z.number()),
    lastTransitionAt: z.date().optional(),
});

export type AutomaticTransitionLogStats = z.output<typeof AutomaticTransitionLogStatsSchema>;

export const IdentifiableTrait = trait({
    id: method<Self, string>(),
});

impl(IdentifiableTrait).for(AutomaticTransitionLogEntryStruct, {
    id: method((self: AutomaticTransitionLogEntry) => self.id),
});
