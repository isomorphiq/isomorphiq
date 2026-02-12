import { z } from "zod";
import { impl, method, struct } from "@tsimpl/runtime";
import type { StructSelf } from "@tsimpl/runtime";
import { IdentifiableTrait } from "./types.ts";

const ApprovalMetadataValueSchema = z.union([z.string(), z.number(), z.boolean()]);
const ApprovalMetadataSchema = z.record(ApprovalMetadataValueSchema);

export const ApprovalStatusSchema = z.enum(["pending", "approved", "rejected", "cancelled"]);
export type ApprovalStatus = z.output<typeof ApprovalStatusSchema>;

export const WorkflowStageTypeSchema = z.enum(["sequential", "parallel", "conditional"]);
export type WorkflowStageType = z.output<typeof WorkflowStageTypeSchema>;

export const ApprovalActionSchema = z.enum([
    "approve",
    "reject",
    "request_changes",
    "cancel",
    "escalate",
]);
export type ApprovalAction = z.output<typeof ApprovalActionSchema>;

export const ApproverConfigSchema = z.object({
    id: z.string().optional(),
    type: z.enum(["user", "role", "group"]),
    value: z.string(),
    isRequired: z.boolean(),
    canDelegate: z.boolean(),
    order: z.number().optional(),
});
export const ApproverConfigStruct = struct.name("ApproverConfig")<
    z.output<typeof ApproverConfigSchema>,
    z.input<typeof ApproverConfigSchema>
>(ApproverConfigSchema);
export type ApproverConfig = StructSelf<typeof ApproverConfigStruct>;

export const StageConditionSchema = z.object({
    field: z.string(),
    operator: z.enum([
        "equals",
        "not_equals",
        "contains",
        "greater_than",
        "less_than",
        "in",
        "not_in",
    ]),
    value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]),
});
export const StageConditionStruct = struct.name("StageCondition")<
    z.output<typeof StageConditionSchema>,
    z.input<typeof StageConditionSchema>
>(StageConditionSchema);
export type StageCondition = StructSelf<typeof StageConditionStruct>;

export const EscalationRuleSchema = z.object({
    afterHours: z.number(),
    action: z.enum(["escalate_to_manager", "notify_admin", "auto_approve", "auto_reject"]),
    target: z.string().optional(),
});
export const EscalationRuleStruct = struct.name("EscalationRule")<
    z.output<typeof EscalationRuleSchema>,
    z.input<typeof EscalationRuleSchema>
>(EscalationRuleSchema);
export type EscalationRule = StructSelf<typeof EscalationRuleStruct>;

export const RuleTriggerSchema = z.object({
    type: z.enum(["task_created", "task_status_changed", "task_priority_changed", "manual"]),
    parameters: ApprovalMetadataSchema.optional(),
});
export const RuleTriggerStruct = struct.name("RuleTrigger")<
    z.output<typeof RuleTriggerSchema>,
    z.input<typeof RuleTriggerSchema>
>(RuleTriggerSchema);
export type RuleTrigger = StructSelf<typeof RuleTriggerStruct>;

export const RuleConditionSchema = z.object({
    field: z.string(),
    operator: z.enum(["equals", "not_equals", "contains", "greater_than", "less_than", "in"]),
    value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]),
});
export const RuleConditionStruct = struct.name("RuleCondition")<
    z.output<typeof RuleConditionSchema>,
    z.input<typeof RuleConditionSchema>
>(RuleConditionSchema);
export type RuleCondition = StructSelf<typeof RuleConditionStruct>;

export const RuleActionSchema = z.object({
    type: z.enum(["start_approval", "assign_approvers", "set_priority", "notify_user"]),
    parameters: ApprovalMetadataSchema,
});
export const RuleActionStruct = struct.name("RuleAction")<
    z.output<typeof RuleActionSchema>,
    z.input<typeof RuleActionSchema>
>(RuleActionSchema);
export type RuleAction = StructSelf<typeof RuleActionStruct>;

export const WorkflowStageSchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    type: WorkflowStageTypeSchema,
    approvers: z.array(ApproverConfigSchema),
    conditions: z.array(StageConditionSchema).optional(),
    isRequired: z.boolean(),
    timeoutDays: z.number().optional(),
    escalationRules: z.array(EscalationRuleSchema).optional(),
});
export const WorkflowStageStruct = struct.name("WorkflowStage")<
    z.output<typeof WorkflowStageSchema>,
    z.input<typeof WorkflowStageSchema>
>(WorkflowStageSchema);
export type WorkflowStage = StructSelf<typeof WorkflowStageStruct>;

export const WorkflowRuleSchema = z.object({
    id: z.string(),
    name: z.string(),
    trigger: RuleTriggerSchema,
    conditions: z.array(RuleConditionSchema),
    actions: z.array(RuleActionSchema),
    isActive: z.boolean(),
});
export const WorkflowRuleStruct = struct.name("WorkflowRule")<
    z.output<typeof WorkflowRuleSchema>,
    z.input<typeof WorkflowRuleSchema>
>(WorkflowRuleSchema);
export type WorkflowRule = StructSelf<typeof WorkflowRuleStruct>;

export const ApprovalWorkflowSchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    isActive: z.boolean(),
    stages: z.array(WorkflowStageSchema),
    rules: z.array(WorkflowRuleSchema),
    createdBy: z.string(),
    createdAt: z.date(),
    updatedAt: z.date(),
});
export const ApprovalWorkflowStruct = struct.name("ApprovalWorkflow")<
    z.output<typeof ApprovalWorkflowSchema>,
    z.input<typeof ApprovalWorkflowSchema>
>(ApprovalWorkflowSchema);
export type ApprovalWorkflow = StructSelf<typeof ApprovalWorkflowStruct>;

export const ApproverDecisionSchema = z.object({
    id: z.string(),
    approverId: z.string(),
    approverType: z.enum(["user", "role", "group"]),
    decision: ApprovalActionSchema.optional(),
    comment: z.string().optional(),
    decidedAt: z.date().optional(),
    delegatedTo: z.string().optional(),
    isRequired: z.boolean(),
    canDelegate: z.boolean(),
});
export const ApproverDecisionStruct = struct.name("ApproverDecision")<
    z.output<typeof ApproverDecisionSchema>,
    z.input<typeof ApproverDecisionSchema>
>(ApproverDecisionSchema);
export type ApproverDecision = StructSelf<typeof ApproverDecisionStruct>;

export const StageApprovalSchema = z.object({
    id: z.string(),
    stageId: z.string(),
    stageName: z.string(),
    status: ApprovalStatusSchema,
    approvers: z.array(ApproverDecisionSchema),
    startedAt: z.date(),
    completedAt: z.date().optional(),
    timeoutAt: z.date().optional(),
    isRequired: z.boolean(),
});
export const StageApprovalStruct = struct.name("StageApproval")<
    z.output<typeof StageApprovalSchema>,
    z.input<typeof StageApprovalSchema>
>(StageApprovalSchema);
export type StageApproval = StructSelf<typeof StageApprovalStruct>;

export const ApprovalAuditEntrySchema = z.object({
    id: z.string(),
    timestamp: z.date(),
    action: z.string(),
    userId: z.string(),
    userType: z.enum(["requester", "approver", "system"]),
    details: ApprovalMetadataSchema,
});
export const ApprovalAuditEntryStruct = struct.name("ApprovalAuditEntry")<
    z.output<typeof ApprovalAuditEntrySchema>,
    z.input<typeof ApprovalAuditEntrySchema>
>(ApprovalAuditEntrySchema);
export type ApprovalAuditEntry = StructSelf<typeof ApprovalAuditEntryStruct>;

export const TaskApprovalSchema = z.object({
    id: z.string(),
    taskId: z.string(),
    workflowId: z.string(),
    workflowName: z.string(),
    currentStage: z.number(),
    status: ApprovalStatusSchema,
    requestedBy: z.string(),
    requestedAt: z.date(),
    completedAt: z.date().optional(),
    completedBy: z.string().optional(),
    reason: z.string().optional(),
    stages: z.array(StageApprovalSchema),
    auditTrail: z.array(ApprovalAuditEntrySchema),
    metadata: ApprovalMetadataSchema,
    createdAt: z.date(),
    updatedAt: z.date(),
});
export const TaskApprovalStruct = struct.name("TaskApproval")<
    z.output<typeof TaskApprovalSchema>,
    z.input<typeof TaskApprovalSchema>
>(TaskApprovalSchema);
export type TaskApproval = StructSelf<typeof TaskApprovalStruct>;

const WorkflowStageInputSchema = WorkflowStageSchema.omit({ id: true });
const WorkflowRuleInputSchema = WorkflowRuleSchema.omit({ id: true });

export const CreateApprovalWorkflowInputSchema = z.object({
    name: z.string(),
    description: z.string(),
    stages: z.array(WorkflowStageInputSchema),
    rules: z.array(WorkflowRuleInputSchema).optional(),
});
export const CreateApprovalWorkflowInputStruct = struct.name("CreateApprovalWorkflowInput")<
    z.output<typeof CreateApprovalWorkflowInputSchema>,
    z.input<typeof CreateApprovalWorkflowInputSchema>
>(CreateApprovalWorkflowInputSchema);
export type CreateApprovalWorkflowInput = StructSelf<typeof CreateApprovalWorkflowInputStruct>;

export const UpdateApprovalWorkflowInputSchema = z.object({
    id: z.string(),
    name: z.string().optional(),
    description: z.string().optional(),
    isActive: z.boolean().optional(),
    stages: z.array(WorkflowStageInputSchema).optional(),
    rules: z.array(WorkflowRuleInputSchema).optional(),
});
export const UpdateApprovalWorkflowInputStruct = struct.name("UpdateApprovalWorkflowInput")<
    z.output<typeof UpdateApprovalWorkflowInputSchema>,
    z.input<typeof UpdateApprovalWorkflowInputSchema>
>(UpdateApprovalWorkflowInputSchema);
export type UpdateApprovalWorkflowInput = StructSelf<typeof UpdateApprovalWorkflowInputStruct>;

export const StartTaskApprovalInputSchema = z.object({
    taskId: z.string(),
    workflowId: z.string().optional(),
    requestedBy: z.string(),
    reason: z.string().optional(),
    metadata: ApprovalMetadataSchema.optional(),
});
export const StartTaskApprovalInputStruct = struct.name("StartTaskApprovalInput")<
    z.output<typeof StartTaskApprovalInputSchema>,
    z.input<typeof StartTaskApprovalInputSchema>
>(StartTaskApprovalInputSchema);
export type StartTaskApprovalInput = StructSelf<typeof StartTaskApprovalInputStruct>;

export const ProcessApprovalInputSchema = z.object({
    approvalId: z.string(),
    stageId: z.string(),
    approverId: z.string(),
    action: ApprovalActionSchema,
    comment: z.string().optional(),
    delegatedTo: z.string().optional(),
});
export const ProcessApprovalInputStruct = struct.name("ProcessApprovalInput")<
    z.output<typeof ProcessApprovalInputSchema>,
    z.input<typeof ProcessApprovalInputSchema>
>(ProcessApprovalInputSchema);
export type ProcessApprovalInput = StructSelf<typeof ProcessApprovalInputStruct>;

export const ApprovalTemplateVariableSchema = z.object({
    name: z.string(),
    type: z.enum(["text", "number", "date", "select", "boolean"]),
    description: z.string(),
    required: z.boolean(),
    defaultValue: z.union([z.string(), z.number(), z.boolean(), z.date()]).optional(),
    options: z.array(z.string()).optional(),
});
export const ApprovalTemplateVariableStruct = struct.name("ApprovalTemplateVariable")<
    z.output<typeof ApprovalTemplateVariableSchema>,
    z.input<typeof ApprovalTemplateVariableSchema>
>(ApprovalTemplateVariableSchema);
export type ApprovalTemplateVariable = StructSelf<typeof ApprovalTemplateVariableStruct>;

export const ApprovalTemplateSchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    category: z.enum(["development", "deployment", "access", "financial", "custom"]),
    workflow: ApprovalWorkflowSchema.omit({ id: true, createdAt: true, updatedAt: true }),
    variables: z.array(ApprovalTemplateVariableSchema),
    createdBy: z.string(),
    isPublic: z.boolean(),
    createdAt: z.date(),
    updatedAt: z.date(),
});
export const ApprovalTemplateStruct = struct.name("ApprovalTemplate")<
    z.output<typeof ApprovalTemplateSchema>,
    z.input<typeof ApprovalTemplateSchema>
>(ApprovalTemplateSchema);
export type ApprovalTemplate = StructSelf<typeof ApprovalTemplateStruct>;

export const ApprovalNotificationSchema = z.object({
    id: z.string(),
    type: z.enum([
        "approval_requested",
        "approval_completed",
        "approval_rejected",
        "approval_timeout",
        "approval_escalated",
    ]),
    recipientId: z.string(),
    approvalId: z.string(),
    stageId: z.string().optional(),
    message: z.string(),
    data: ApprovalMetadataSchema,
    sentAt: z.date(),
    readAt: z.date().optional(),
});
export const ApprovalNotificationStruct = struct.name("ApprovalNotification")<
    z.output<typeof ApprovalNotificationSchema>,
    z.input<typeof ApprovalNotificationSchema>
>(ApprovalNotificationSchema);
export type ApprovalNotification = StructSelf<typeof ApprovalNotificationStruct>;

export const ApprovalStatsSchema = z.object({
    totalApprovals: z.number(),
    pendingApprovals: z.number(),
    approvedToday: z.number(),
    rejectedToday: z.number(),
    averageApprovalTime: z.number(),
    approvalsByWorkflow: z.record(z.number()),
    approvalsByUser: z.record(z.number()),
    timeoutRate: z.number(),
    escalationRate: z.number(),
});
export const ApprovalStatsStruct = struct.name("ApprovalStats")<
    z.output<typeof ApprovalStatsSchema>,
    z.input<typeof ApprovalStatsSchema>
>(ApprovalStatsSchema);
export type ApprovalStats = StructSelf<typeof ApprovalStatsStruct>;

impl(IdentifiableTrait).for(WorkflowStageStruct, {
    id: method((self: WorkflowStage) => self.id),
});

impl(IdentifiableTrait).for(WorkflowRuleStruct, {
    id: method((self: WorkflowRule) => self.id),
});

impl(IdentifiableTrait).for(ApprovalWorkflowStruct, {
    id: method((self: ApprovalWorkflow) => self.id),
});

impl(IdentifiableTrait).for(ApproverDecisionStruct, {
    id: method((self: ApproverDecision) => self.id),
});

impl(IdentifiableTrait).for(StageApprovalStruct, {
    id: method((self: StageApproval) => self.id),
});

impl(IdentifiableTrait).for(ApprovalAuditEntryStruct, {
    id: method((self: ApprovalAuditEntry) => self.id),
});

impl(IdentifiableTrait).for(TaskApprovalStruct, {
    id: method((self: TaskApproval) => self.id),
});

impl(IdentifiableTrait).for(ApprovalTemplateStruct, {
    id: method((self: ApprovalTemplate) => self.id),
});

impl(IdentifiableTrait).for(ApprovalNotificationStruct, {
    id: method((self: ApprovalNotification) => self.id),
});
