import { z } from "zod";

export const AutomationOverrideActionSchema = z.enum([
    "pause_all",
    "resume_all",
    "cancel_execution",
    "disable_rule",
    "enable_rule",
    "emergency_stop",
]);

export type AutomationOverrideAction = z.output<typeof AutomationOverrideActionSchema>;

export const AutomationOverrideStatusSchema = z.enum([
    "active",
    "inactive",
    "expired",
]);

export type AutomationOverrideStatus = z.output<typeof AutomationOverrideStatusSchema>;

export const AutomationOverrideSchema = z.object({
    id: z.string(),
    action: AutomationOverrideActionSchema,
    targetId: z.string().optional(),
    reason: z.string(),
    userId: z.string(),
    timestamp: z.date(),
    expiresAt: z.date().optional(),
    status: AutomationOverrideStatusSchema,
});

export type AutomationOverride = z.output<typeof AutomationOverrideSchema>;

export const AutomationExecutionStatusSchema = z.enum([
    "pending",
    "running",
    "completed",
    "failed",
    "cancelled",
]);

export type AutomationExecutionStatus = z.output<typeof AutomationExecutionStatusSchema>;

export const AutomationExecutionSchema = z.object({
    id: z.string(),
    ruleId: z.string(),
    ruleName: z.string(),
    status: AutomationExecutionStatusSchema,
    startedAt: z.date(),
    completedAt: z.date().optional(),
    cancelledAt: z.date().optional(),
    cancelledBy: z.string().optional(),
    cancelReason: z.string().optional(),
    result: z.record(z.unknown()).optional(),
    error: z.string().optional(),
});

export type AutomationExecution = z.output<typeof AutomationExecutionSchema>;

export const CreateOverrideInputSchema = z.object({
    action: AutomationOverrideActionSchema,
    targetId: z.string().optional(),
    reason: z.string(),
    userId: z.string(),
    duration: z.number().optional(),
});

export type CreateOverrideInput = z.output<typeof CreateOverrideInputSchema>;

export const CancelExecutionInputSchema = z.object({
    executionId: z.string(),
    userId: z.string(),
    reason: z.string(),
});

export type CancelExecutionInput = z.output<typeof CancelExecutionInputSchema>;

export const OverrideResultSchema = z.object({
    success: z.boolean(),
    overrideId: z.string().optional(),
    message: z.string(),
    error: z.string().optional(),
});

export type OverrideResult = z.output<typeof OverrideResultSchema>;
