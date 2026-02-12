import { z } from "zod";
import { impl, method, struct, trait } from "@tsimpl/runtime";
import type { StructSelf } from "@tsimpl/runtime";
import type { Self } from "@tsimpl/core";

export const IdentifiableTrait = trait({
    id: method<Self, string>(),
});

export const WorkflowNodeTypeSchema = z.enum([
    "trigger",
    "condition",
    "action",
    "delay",
    "branch",
    "merge",
    "notification",
    "task_create",
    "task_update",
    "task_assign",
    "webhook",
    "script",
]);

export type WorkflowNodeType = z.output<typeof WorkflowNodeTypeSchema>;

export const WorkflowCategorySchema = z.enum([
    "task_management",
    "approval",
    "notification",
    "integration",
    "scheduling",
    "custom",
]);

export type WorkflowCategory = z.output<typeof WorkflowCategorySchema>;

export const WorkflowExecutionStatusSchema = z.enum([
    "pending",
    "running",
    "completed",
    "failed",
    "cancelled",
    "paused",
]);

export type WorkflowExecutionStatus = z.output<typeof WorkflowExecutionStatusSchema>;

const WorkflowNodePortTypeSchema = z.enum(["input", "output"]);
const WorkflowNodePortDataTypeSchema = z.enum(["string", "number", "boolean", "object", "array"]);
const WorkflowNodeParameterTypeSchema = z.enum([
    "string",
    "number",
    "boolean",
    "select",
    "multiselect",
    "json",
]);
const WorkflowNodeValidationRuleTypeSchema = z.enum([
    "required",
    "pattern",
    "min",
    "max",
    "custom",
]);
const WorkflowExecutionLogLevelSchema = z.enum(["debug", "info", "warn", "error"]);
const WorkflowExecutionEnvironmentSchema = z.enum(["development", "staging", "production"]);
const WorkflowExecutionSourceSchema = z.enum(["manual", "api", "scheduled", "event"]);
const WorkflowWebhookMethodSchema = z.enum(["GET", "POST", "PUT", "DELETE"]);
const WorkflowValidationErrorTypeSchema = z.enum(["connection", "node", "variable", "logic"]);
const WorkflowValidationWarningTypeSchema = z.enum(["performance", "logic", "best_practice"]);

export const WorkflowNodePortSchema = z.object({
    id: z.string(),
    name: z.string(),
    type: WorkflowNodePortTypeSchema,
    dataType: WorkflowNodePortDataTypeSchema,
    required: z.boolean().optional(),
    multiple: z.boolean().optional(),
});

export const WorkflowNodePortStruct = struct.name("WorkflowNodePort")<z.output<typeof WorkflowNodePortSchema>, z.input<typeof WorkflowNodePortSchema>>(WorkflowNodePortSchema);
export type WorkflowNodePort = StructSelf<typeof WorkflowNodePortStruct>;

const WorkflowNodeParameterOptionSchema = z.object({
    label: z.string(),
    value: z.unknown(),
});

const WorkflowNodeParameterValidationSchema = z.object({
    min: z.number().optional(),
    max: z.number().optional(),
    pattern: z.string().optional(),
});

export const WorkflowNodeParameterSchema = z.object({
    name: z.string(),
    type: WorkflowNodeParameterTypeSchema,
    label: z.string(),
    description: z.string().optional(),
    required: z.boolean().optional(),
    defaultValue: z.unknown().optional(),
    options: z.array(WorkflowNodeParameterOptionSchema).optional(),
    validation: WorkflowNodeParameterValidationSchema.optional(),
});

export const WorkflowNodeParameterStruct = struct.name("WorkflowNodeParameter")<z.output<typeof WorkflowNodeParameterSchema>, z.input<typeof WorkflowNodeParameterSchema>>(WorkflowNodeParameterSchema);
export type WorkflowNodeParameter = StructSelf<typeof WorkflowNodeParameterStruct>;

const WorkflowNodeValidationRuleSchema = z.object({
    type: WorkflowNodeValidationRuleTypeSchema,
    field: z.string(),
    value: z.unknown().optional(),
    message: z.string(),
});

export const WorkflowNodeValidationSchema = z.object({
    rules: z.array(WorkflowNodeValidationRuleSchema),
});

export const WorkflowNodeValidationStruct = struct.name("WorkflowNodeValidation")<z.output<typeof WorkflowNodeValidationSchema>, z.input<typeof WorkflowNodeValidationSchema>>(WorkflowNodeValidationSchema);
export type WorkflowNodeValidation = StructSelf<typeof WorkflowNodeValidationStruct>;

export const WorkflowNodeConfigSchema = z.object({
    inputs: z.array(WorkflowNodePortSchema).optional(),
    outputs: z.array(WorkflowNodePortSchema).optional(),
    parameters: z.array(WorkflowNodeParameterSchema).optional(),
    validation: WorkflowNodeValidationSchema.optional(),
});

export const WorkflowNodeConfigStruct = struct.name("WorkflowNodeConfig")<z.output<typeof WorkflowNodeConfigSchema>, z.input<typeof WorkflowNodeConfigSchema>>(WorkflowNodeConfigSchema);
export type WorkflowNodeConfig = StructSelf<typeof WorkflowNodeConfigStruct>;

export const WorkflowNodeSchema = z.object({
    id: z.string(),
    type: WorkflowNodeTypeSchema,
    position: z.object({
        x: z.number(),
        y: z.number(),
    }),
    data: z.record(z.unknown()),
    config: WorkflowNodeConfigSchema.optional(),
});

export const WorkflowNodeStruct = struct.name("WorkflowNode")<z.output<typeof WorkflowNodeSchema>, z.input<typeof WorkflowNodeSchema>>(WorkflowNodeSchema);
export type WorkflowNode = StructSelf<typeof WorkflowNodeStruct>;

export const WorkflowConnectionSchema = z.object({
    id: z.string(),
    sourceNodeId: z.string(),
    sourcePortId: z.string(),
    targetNodeId: z.string(),
    targetPortId: z.string(),
});

export const WorkflowConnectionStruct = struct.name("WorkflowConnection")<z.output<typeof WorkflowConnectionSchema>, z.input<typeof WorkflowConnectionSchema>>(WorkflowConnectionSchema);
export type WorkflowConnection = StructSelf<typeof WorkflowConnectionStruct>;

export const WorkflowVariableSchema = z.object({
    name: z.string(),
    type: z.enum(["string", "number", "boolean", "object", "array"]),
    description: z.string().optional(),
    defaultValue: z.unknown().optional(),
    scope: z.enum(["global", "local", "session"]),
});

export const WorkflowVariableStruct = struct.name("WorkflowVariable")<z.output<typeof WorkflowVariableSchema>, z.input<typeof WorkflowVariableSchema>>(WorkflowVariableSchema);
export type WorkflowVariable = StructSelf<typeof WorkflowVariableStruct>;

export const WorkflowSettingsSchema = z.object({
    timeout: z.number().optional(),
    retryPolicy: z
        .object({
            maxAttempts: z.number(),
            backoffMultiplier: z.number(),
            maxDelay: z.number(),
        })
        .optional(),
    errorHandling: z.enum(["stop", "continue", "retry"]).optional(),
    logging: z
        .object({
            enabled: z.boolean(),
            level: z.enum(["debug", "info", "warn", "error"]),
            includeData: z.boolean(),
        })
        .optional(),
});

export const WorkflowSettingsStruct = struct.name("WorkflowSettings")<z.output<typeof WorkflowSettingsSchema>, z.input<typeof WorkflowSettingsSchema>>(WorkflowSettingsSchema);
export type WorkflowSettings = StructSelf<typeof WorkflowSettingsStruct>;

export const WorkflowMetadataSchema = z.object({
    tags: z.array(z.string()),
    author: z.string(),
    documentation: z.string().optional(),
    examples: z
        .array(
            z.object({
                name: z.string(),
                description: z.string(),
                data: z.record(z.unknown()),
            }),
        )
        .optional(),
});

export const WorkflowMetadataStruct = struct.name("WorkflowMetadata")<z.output<typeof WorkflowMetadataSchema>, z.input<typeof WorkflowMetadataSchema>>(WorkflowMetadataSchema);
export type WorkflowMetadata = StructSelf<typeof WorkflowMetadataStruct>;

export const WorkflowDefinitionSchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    version: z.string(),
    category: WorkflowCategorySchema,
    nodes: z.array(WorkflowNodeSchema),
    connections: z.array(WorkflowConnectionSchema),
    variables: z.array(WorkflowVariableSchema),
    settings: WorkflowSettingsSchema,
    metadata: WorkflowMetadataSchema,
    enabled: z.boolean(),
    createdAt: z.date(),
    updatedAt: z.date(),
    createdBy: z.string(),
    updatedBy: z.string(),
});

export const WorkflowDefinitionStruct = struct.name("WorkflowDefinition")<z.output<typeof WorkflowDefinitionSchema>, z.input<typeof WorkflowDefinitionSchema>>(WorkflowDefinitionSchema);
export type WorkflowDefinition = StructSelf<typeof WorkflowDefinitionStruct>;

const WorkflowExecutionTaskSchema = z.object({
    id: z.string(),
    status: z.string(),
    data: z.record(z.unknown()),
});

export const WorkflowExecutionContextSchema = z.object({
    variables: z.record(z.unknown()),
    tasks: z.array(WorkflowExecutionTaskSchema),
    user: z
        .object({
            id: z.string(),
            username: z.string(),
            role: z.string(),
        })
        .optional(),
    timestamp: z.date(),
    environment: WorkflowExecutionEnvironmentSchema,
});

export const WorkflowExecutionContextStruct = struct.name("WorkflowExecutionContext")<z.output<typeof WorkflowExecutionContextSchema>, z.input<typeof WorkflowExecutionContextSchema>>(WorkflowExecutionContextSchema);
export type WorkflowExecutionContext = StructSelf<typeof WorkflowExecutionContextStruct>;

export const WorkflowExecutionLogSchema = z.object({
    timestamp: z.date(),
    level: WorkflowExecutionLogLevelSchema,
    message: z.string(),
    data: z.record(z.unknown()).optional(),
    nodeId: z.string().optional(),
});

export const WorkflowExecutionLogStruct = struct.name("WorkflowExecutionLog")<z.output<typeof WorkflowExecutionLogSchema>, z.input<typeof WorkflowExecutionLogSchema>>(WorkflowExecutionLogSchema);
export type WorkflowExecutionLog = StructSelf<typeof WorkflowExecutionLogStruct>;

export const WorkflowExecutionErrorSchema = z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
    stack: z.string().optional(),
    nodeId: z.string().optional(),
    timestamp: z.date(),
});

export const WorkflowExecutionErrorStruct = struct.name("WorkflowExecutionError")<z.output<typeof WorkflowExecutionErrorSchema>, z.input<typeof WorkflowExecutionErrorSchema>>(WorkflowExecutionErrorSchema);
export type WorkflowExecutionError = StructSelf<typeof WorkflowExecutionErrorStruct>;

export const WorkflowNodeExecutionSchema = z.object({
    nodeId: z.string(),
    status: WorkflowExecutionStatusSchema,
    startedAt: z.date(),
    completedAt: z.date().optional(),
    duration: z.number().optional(),
    input: z.record(z.unknown()),
    output: z.record(z.unknown()).optional(),
    error: WorkflowExecutionErrorSchema.optional(),
    logs: z.array(WorkflowExecutionLogSchema),
});

export const WorkflowNodeExecutionStruct = struct.name("WorkflowNodeExecution")<z.output<typeof WorkflowNodeExecutionSchema>, z.input<typeof WorkflowNodeExecutionSchema>>(WorkflowNodeExecutionSchema);
export type WorkflowNodeExecution = StructSelf<typeof WorkflowNodeExecutionStruct>;

export const WorkflowExecutionMetadataSchema = z.object({
    triggeredBy: z.string(),
    source: WorkflowExecutionSourceSchema,
    ipAddress: z.string().optional(),
    userAgent: z.string().optional(),
    sessionId: z.string().optional(),
});

export const WorkflowExecutionMetadataStruct = struct.name("WorkflowExecutionMetadata")<z.output<typeof WorkflowExecutionMetadataSchema>, z.input<typeof WorkflowExecutionMetadataSchema>>(WorkflowExecutionMetadataSchema);
export type WorkflowExecutionMetadata = StructSelf<typeof WorkflowExecutionMetadataStruct>;

export const WorkflowExecutionSchema = z.object({
    id: z.string(),
    workflowId: z.string(),
    workflowVersion: z.string(),
    status: WorkflowExecutionStatusSchema,
    startedAt: z.date(),
    completedAt: z.date().optional(),
    duration: z.number().optional(),
    triggerData: z.record(z.unknown()),
    context: WorkflowExecutionContextSchema,
    nodes: z.array(WorkflowNodeExecutionSchema),
    error: WorkflowExecutionErrorSchema.optional(),
    result: z.record(z.unknown()).optional(),
    metadata: WorkflowExecutionMetadataSchema,
});

export const WorkflowExecutionStruct = struct.name("WorkflowExecution")<z.output<typeof WorkflowExecutionSchema>, z.input<typeof WorkflowExecutionSchema>>(WorkflowExecutionSchema);
export type WorkflowExecution = StructSelf<typeof WorkflowExecutionStruct>;

export const WorkflowTemplateVariableSchema = z.object({
    name: z.string(),
    type: z.enum(["string", "number", "boolean", "select", "multiselect"]),
    label: z.string(),
    description: z.string().optional(),
    required: z.boolean(),
    defaultValue: z.unknown().optional(),
    options: z.array(z.object({ label: z.string(), value: z.unknown() })).optional(),
});

export const WorkflowTemplateVariableStruct = struct.name("WorkflowTemplateVariable")<z.output<typeof WorkflowTemplateVariableSchema>, z.input<typeof WorkflowTemplateVariableSchema>>(WorkflowTemplateVariableSchema);
export type WorkflowTemplateVariable = StructSelf<typeof WorkflowTemplateVariableStruct>;

export const WorkflowTemplateDefinitionSchema = WorkflowDefinitionSchema.omit({
    id: true,
    createdAt: true,
    updatedAt: true,
    createdBy: true,
    updatedBy: true,
});

export const WorkflowTemplateDefinitionStruct = struct.name("WorkflowTemplateDefinition")<z.output<typeof WorkflowTemplateDefinitionSchema>, z.input<typeof WorkflowTemplateDefinitionSchema>>(WorkflowTemplateDefinitionSchema);
export type WorkflowTemplateDefinition = StructSelf<typeof WorkflowTemplateDefinitionStruct>;

export const WorkflowTemplateSchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    category: WorkflowCategorySchema,
    tags: z.array(z.string()),
    definition: WorkflowTemplateDefinitionSchema,
    variables: z.array(WorkflowTemplateVariableSchema),
    documentation: z.string().optional(),
    examples: z
        .array(
            z.object({
                name: z.string(),
                description: z.string(),
                variables: z.record(z.unknown()),
            }),
        )
        .optional(),
    createdAt: z.date(),
    createdBy: z.string(),
});

export const WorkflowTemplateStruct = struct.name("WorkflowTemplate")<z.output<typeof WorkflowTemplateSchema>, z.input<typeof WorkflowTemplateSchema>>(WorkflowTemplateSchema);
export type WorkflowTemplate = StructSelf<typeof WorkflowTemplateStruct>;

export const WorkflowTriggerSchema = z.object({
    id: z.string(),
    type: z.enum(["event", "schedule", "webhook", "manual"]),
    config: z.record(z.unknown()),
    enabled: z.boolean(),
    workflowId: z.string(),
});

export const WorkflowTriggerStruct = struct.name("WorkflowTrigger")<z.output<typeof WorkflowTriggerSchema>, z.input<typeof WorkflowTriggerSchema>>(WorkflowTriggerSchema);
export type WorkflowTrigger = StructSelf<typeof WorkflowTriggerStruct>;

export const WorkflowScheduleSchema = z.object({
    id: z.string(),
    workflowId: z.string(),
    cron: z.string(),
    timezone: z.string(),
    enabled: z.boolean(),
    nextRun: z.date().optional(),
    lastRun: z.date().optional(),
    metadata: z.record(z.unknown()).optional(),
});

export const WorkflowScheduleStruct = struct.name("WorkflowSchedule")<z.output<typeof WorkflowScheduleSchema>, z.input<typeof WorkflowScheduleSchema>>(WorkflowScheduleSchema);
export type WorkflowSchedule = StructSelf<typeof WorkflowScheduleStruct>;

export const WorkflowWebhookSchema = z.object({
    id: z.string(),
    workflowId: z.string(),
    path: z.string(),
    method: WorkflowWebhookMethodSchema,
    secret: z.string().optional(),
    enabled: z.boolean(),
    headers: z.record(z.string()).optional(),
    metadata: z.record(z.unknown()).optional(),
});

export const WorkflowWebhookStruct = struct.name("WorkflowWebhook")<z.output<typeof WorkflowWebhookSchema>, z.input<typeof WorkflowWebhookSchema>>(WorkflowWebhookSchema);
export type WorkflowWebhook = StructSelf<typeof WorkflowWebhookStruct>;

export const WorkflowStatisticsSchema = z.object({
    totalExecutions: z.number(),
    successfulExecutions: z.number(),
    failedExecutions: z.number(),
    averageExecutionTime: z.number(),
    lastExecution: WorkflowExecutionSchema.optional(),
    popularNodes: z.array(
        z.object({
            nodeType: WorkflowNodeTypeSchema,
            count: z.number(),
        }),
    ),
    errorRate: z.number(),
});

export const WorkflowStatisticsStruct = struct.name("WorkflowStatistics")<z.output<typeof WorkflowStatisticsSchema>, z.input<typeof WorkflowStatisticsSchema>>(WorkflowStatisticsSchema);
export type WorkflowStatistics = StructSelf<typeof WorkflowStatisticsStruct>;

export const WorkflowValidationErrorSchema = z.object({
    type: WorkflowValidationErrorTypeSchema,
    message: z.string(),
    nodeId: z.string().optional(),
    connectionId: z.string().optional(),
    severity: z.enum(["error", "warning"]),
});

export const WorkflowValidationErrorStruct = struct.name("WorkflowValidationError")<z.output<typeof WorkflowValidationErrorSchema>, z.input<typeof WorkflowValidationErrorSchema>>(WorkflowValidationErrorSchema);
export type WorkflowValidationError = StructSelf<typeof WorkflowValidationErrorStruct>;

export const WorkflowValidationWarningSchema = z.object({
    type: WorkflowValidationWarningTypeSchema,
    message: z.string(),
    nodeId: z.string().optional(),
    suggestion: z.string().optional(),
});

export const WorkflowValidationWarningStruct = struct.name("WorkflowValidationWarning")<z.output<typeof WorkflowValidationWarningSchema>, z.input<typeof WorkflowValidationWarningSchema>>(WorkflowValidationWarningSchema);
export type WorkflowValidationWarning = StructSelf<typeof WorkflowValidationWarningStruct>;

export const WorkflowValidationResultSchema = z.object({
    valid: z.boolean(),
    errors: z.array(WorkflowValidationErrorSchema),
    warnings: z.array(WorkflowValidationWarningSchema),
});

export const WorkflowValidationResultStruct = struct.name("WorkflowValidationResult")<z.output<typeof WorkflowValidationResultSchema>, z.input<typeof WorkflowValidationResultSchema>>(WorkflowValidationResultSchema);
export type WorkflowValidationResult = StructSelf<typeof WorkflowValidationResultStruct>;

export const TriggerNodeDataSchema = WorkflowNodeSchema.extend({
    type: z.literal("trigger"),
    data: z.object({
        eventType: z.string(),
        conditions: z.record(z.unknown()).optional(),
    }),
});

export const TriggerNodeDataStruct = struct.name("TriggerNodeData")<z.output<typeof TriggerNodeDataSchema>, z.input<typeof TriggerNodeDataSchema>>(TriggerNodeDataSchema);
export type TriggerNodeData = StructSelf<typeof TriggerNodeDataStruct>;

export const ConditionNodeDataSchema = WorkflowNodeSchema.extend({
    type: z.literal("condition"),
    data: z.object({
        operator: z.enum(["and", "or"]),
        conditions: z.array(
            z.object({
                field: z.string(),
                operator: z.string(),
                value: z.unknown(),
            }),
        ),
    }),
});

export const ConditionNodeDataStruct = struct.name("ConditionNodeData")<z.output<typeof ConditionNodeDataSchema>, z.input<typeof ConditionNodeDataSchema>>(ConditionNodeDataSchema);
export type ConditionNodeData = StructSelf<typeof ConditionNodeDataStruct>;

export const ActionNodeDataSchema = WorkflowNodeSchema.extend({
    type: z.literal("action"),
    data: z.object({
        actionType: z.string(),
        parameters: z.record(z.unknown()),
    }),
});

export const ActionNodeDataStruct = struct.name("ActionNodeData")<z.output<typeof ActionNodeDataSchema>, z.input<typeof ActionNodeDataSchema>>(ActionNodeDataSchema);
export type ActionNodeData = StructSelf<typeof ActionNodeDataStruct>;

export const TaskCreateNodeDataSchema = WorkflowNodeSchema.extend({
    type: z.literal("task_create"),
    data: z.object({
        title: z.string(),
        description: z.string().optional(),
        priority: z.string().optional(),
        assignedTo: z.string().optional(),
        dependencies: z.array(z.string()).optional(),
    }),
});

export const TaskCreateNodeDataStruct = struct.name("TaskCreateNodeData")<z.output<typeof TaskCreateNodeDataSchema>, z.input<typeof TaskCreateNodeDataSchema>>(TaskCreateNodeDataSchema);
export type TaskCreateNodeData = StructSelf<typeof TaskCreateNodeDataStruct>;

export const TaskUpdateNodeDataSchema = WorkflowNodeSchema.extend({
    type: z.literal("task_update"),
    data: z.object({
        taskId: z.string().optional(),
        updates: z.object({
            status: z.string().optional(),
            priority: z.string().optional(),
            assignedTo: z.string().optional(),
        }),
    }),
});

export const TaskUpdateNodeDataStruct = struct.name("TaskUpdateNodeData")<z.output<typeof TaskUpdateNodeDataSchema>, z.input<typeof TaskUpdateNodeDataSchema>>(TaskUpdateNodeDataSchema);
export type TaskUpdateNodeData = StructSelf<typeof TaskUpdateNodeDataStruct>;

export const NotificationNodeDataSchema = WorkflowNodeSchema.extend({
    type: z.literal("notification"),
    data: z.object({
        recipients: z.array(z.string()),
        subject: z.string().optional(),
        message: z.string(),
        type: z.enum(["email", "push", "sms"]).optional(),
    }),
});

export const NotificationNodeDataStruct = struct.name("NotificationNodeData")<z.output<typeof NotificationNodeDataSchema>, z.input<typeof NotificationNodeDataSchema>>(NotificationNodeDataSchema);
export type NotificationNodeData = StructSelf<typeof NotificationNodeDataStruct>;

export const DelayNodeDataSchema = WorkflowNodeSchema.extend({
    type: z.literal("delay"),
    data: z.object({
        duration: z.number(),
        unit: z.enum(["seconds", "minutes", "hours", "days"]),
    }),
});

export const DelayNodeDataStruct = struct.name("DelayNodeData")<z.output<typeof DelayNodeDataSchema>, z.input<typeof DelayNodeDataSchema>>(DelayNodeDataSchema);
export type DelayNodeData = StructSelf<typeof DelayNodeDataStruct>;

export const BranchNodeDataSchema = WorkflowNodeSchema.extend({
    type: z.literal("branch"),
    data: z.object({
        branches: z.array(
            z.object({
                condition: z.record(z.unknown()).optional(),
                label: z.string(),
            }),
        ),
    }),
});

export const BranchNodeDataStruct = struct.name("BranchNodeData")<z.output<typeof BranchNodeDataSchema>, z.input<typeof BranchNodeDataSchema>>(BranchNodeDataSchema);
export type BranchNodeData = StructSelf<typeof BranchNodeDataStruct>;

export const WebhookNodeDataSchema = WorkflowNodeSchema.extend({
    type: z.literal("webhook"),
    data: z.object({
        url: z.string(),
        method: WorkflowWebhookMethodSchema,
        headers: z.record(z.string()).optional(),
        body: z.record(z.unknown()).optional(),
    }),
});

export const WebhookNodeDataStruct = struct.name("WebhookNodeData")<z.output<typeof WebhookNodeDataSchema>, z.input<typeof WebhookNodeDataSchema>>(WebhookNodeDataSchema);
export type WebhookNodeData = StructSelf<typeof WebhookNodeDataStruct>;

export const ScriptNodeDataSchema = WorkflowNodeSchema.extend({
    type: z.literal("script"),
    data: z.object({
        script: z.string(),
        language: z.enum(["javascript", "python"]),
        timeout: z.number().optional(),
    }),
});

export const ScriptNodeDataStruct = struct.name("ScriptNodeData")<z.output<typeof ScriptNodeDataSchema>, z.input<typeof ScriptNodeDataSchema>>(ScriptNodeDataSchema);
export type ScriptNodeData = StructSelf<typeof ScriptNodeDataStruct>;

impl(IdentifiableTrait).for(WorkflowNodeStruct, {
    id: method((self: WorkflowNode) => self.id),
});

impl(IdentifiableTrait).for(WorkflowConnectionStruct, {
    id: method((self: WorkflowConnection) => self.id),
});

impl(IdentifiableTrait).for(WorkflowDefinitionStruct, {
    id: method((self: WorkflowDefinition) => self.id),
});

impl(IdentifiableTrait).for(WorkflowExecutionStruct, {
    id: method((self: WorkflowExecution) => self.id),
});

impl(IdentifiableTrait).for(WorkflowTemplateStruct, {
    id: method((self: WorkflowTemplate) => self.id),
});

impl(IdentifiableTrait).for(WorkflowTriggerStruct, {
    id: method((self: WorkflowTrigger) => self.id),
});

impl(IdentifiableTrait).for(WorkflowScheduleStruct, {
    id: method((self: WorkflowSchedule) => self.id),
});

impl(IdentifiableTrait).for(WorkflowWebhookStruct, {
    id: method((self: WorkflowWebhook) => self.id),
});
