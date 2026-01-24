import { z } from "zod";
import { impl, method, struct, trait } from "@tsimpl/runtime";
import type { StructSelf } from "@tsimpl/runtime";
import type { Self } from "@tsimpl/core";
import {
    type CreateSavedSearchInput as BaseCreateSavedSearchInput,
    type SavedSearch as BaseSavedSearch,
    type SearchFacets as BaseSearchFacets,
    type SearchQuery as BaseSearchQuery,
    type SearchResult as BaseSearchResult,
    type SearchSort as BaseSearchSort,
    type UpdateSavedSearchInput as BaseUpdateSavedSearchInput,
    CreateSavedSearchInputSchema,
    SavedSearchSchema,
    SearchFacetsSchema,
    SearchHighlightsSchema,
    SearchQuerySchema,
    SearchResultSchema,
    SearchSortDirectionSchema,
    UpdateSavedSearchInputSchema,
} from "@isomorphiq/search";

export const IdentifiableTrait = trait({
    id: method<Self, string>(),
});

export const TimestampedTrait = trait({
    createdAt: method<Self, Date>(),
    updatedAt: method<Self, Date>(),
});

export const TaskStatusSchema = z.enum(["todo", "in-progress", "done"]);
export type TaskStatus = z.output<typeof TaskStatusSchema>;

export const TaskTypeSchema = z.enum(["feature", "story", "task", "integration", "research"]);
export type TaskType = z.output<typeof TaskTypeSchema>;

export const TaskPrioritySchema = z.enum(["low", "medium", "high"]);
export type TaskPriority = z.output<typeof TaskPrioritySchema>;

export const TaskIdentitySchema = z.object({
    id: z.string(),
    createdAt: z.date(),
    updatedAt: z.date(),
});

export const TaskIdentityStruct = struct.name("TaskIdentity")<z.output<typeof TaskIdentitySchema>, z.input<typeof TaskIdentitySchema>>(TaskIdentitySchema);
export type TaskIdentity = StructSelf<typeof TaskIdentityStruct>;

export const TaskSchema = TaskIdentitySchema.extend({
    title: z.string(),
    description: z.string(),
    status: TaskStatusSchema,
    priority: TaskPrioritySchema,
    type: TaskTypeSchema,
    dependencies: z.array(z.string()),
    createdBy: z.string(),
    assignedTo: z.string().optional(),
    collaborators: z.array(z.string()).optional(),
    watchers: z.array(z.string()).optional(),
}).passthrough();

export const TaskStruct = struct.name("Task")<z.output<typeof TaskSchema>, z.input<typeof TaskSchema>>(TaskSchema);
export type Task = StructSelf<typeof TaskStruct>;

export const CreateTaskInputSchema = z.object({
    title: z.string(),
    description: z.string(),
    dependencies: z.array(z.string()).optional(),
    assignedTo: z.string().optional(),
    collaborators: z.array(z.string()).optional(),
    watchers: z.array(z.string()).optional(),
});

export const CreateTaskInputStruct = struct.name("CreateTaskInput")<z.output<typeof CreateTaskInputSchema>, z.input<typeof CreateTaskInputSchema>>(CreateTaskInputSchema);
export type CreateTaskInput = StructSelf<typeof CreateTaskInputStruct>;

export const UpdateTaskInputSchema = z.object({
    id: z.string(),
    status: TaskStatusSchema.optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    priority: TaskPrioritySchema.optional(),
    dependencies: z.array(z.string()).optional(),
    assignedTo: z.string().optional(),
    collaborators: z.array(z.string()).optional(),
    watchers: z.array(z.string()).optional(),
});

export const UpdateTaskInputStruct = struct.name("UpdateTaskInput")<z.output<typeof UpdateTaskInputSchema>, z.input<typeof UpdateTaskInputSchema>>(UpdateTaskInputSchema);
export type UpdateTaskInput = StructSelf<typeof UpdateTaskInputStruct>;

export const TemplateCategorySchema = z.enum([
    "development",
    "testing",
    "documentation",
    "bug-fix",
    "feature",
    "maintenance",
    "deployment",
    "custom",
]);
export type TemplateCategory = z.output<typeof TemplateCategorySchema>;

export const TemplateVariableSchema = z.object({
    name: z.string(),
    type: z.enum(["text", "number", "date", "select", "boolean"]),
    description: z.string(),
    required: z.boolean(),
    defaultValue: z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.date(),
        z.array(z.string()),
        z.null(),
    ]).optional(),
    options: z.array(z.string()).optional(),
});

export const TemplateVariableStruct = struct.name("TemplateVariable")<z.output<typeof TemplateVariableSchema>, z.input<typeof TemplateVariableSchema>>(TemplateVariableSchema);
export type TemplateVariable = StructSelf<typeof TemplateVariableStruct>;

export const SubtaskTemplateSchema = z.object({
    titleTemplate: z.string(),
    descriptionTemplate: z.string(),
    priority: TaskPrioritySchema.optional(),
});

export const SubtaskTemplateStruct = struct.name("SubtaskTemplate")<z.output<typeof SubtaskTemplateSchema>, z.input<typeof SubtaskTemplateSchema>>(SubtaskTemplateSchema);
export type SubtaskTemplate = StructSelf<typeof SubtaskTemplateStruct>;

export const RuleTriggerSchema = z.object({
    eventType: z.enum(["task_created", "task_status_changed", "task_completed", "scheduled", "manual"]),
    type: z.enum(["task_created", "task_status_changed", "task_completed", "scheduled", "manual"]),
    parameters: z.record(z.unknown()).optional(),
});

export const RuleTriggerStruct = struct.name("RuleTrigger")<z.output<typeof RuleTriggerSchema>, z.input<typeof RuleTriggerSchema>>(RuleTriggerSchema);
export type RuleTrigger = StructSelf<typeof RuleTriggerStruct>;

export const RuleConditionSchema = z.object({
    field: z.string(),
    operator: z.enum([
        "equals",
        "not_equals",
        "contains",
        "not_contains",
        "greater_than",
        "less_than",
    ]),
    value: z.unknown(),
});

export const RuleConditionStruct = struct.name("RuleCondition")<z.output<typeof RuleConditionSchema>, z.input<typeof RuleConditionSchema>>(RuleConditionSchema);
export type RuleCondition = StructSelf<typeof RuleConditionStruct>;

export const RuleActionSchema = z.object({
    type: z.enum(["create_task", "update_task", "send_notification", "set_priority", "assign_user"]),
    parameters: z.record(z.unknown()),
});

export const RuleActionStruct = struct.name("RuleAction")<z.output<typeof RuleActionSchema>, z.input<typeof RuleActionSchema>>(RuleActionSchema);
export type RuleAction = StructSelf<typeof RuleActionStruct>;

export const AutomationRuleSchema = z.object({
    id: z.string(),
    name: z.string(),
    trigger: RuleTriggerSchema,
    conditions: z.array(RuleConditionSchema),
    actions: z.array(RuleActionSchema),
    enabled: z.boolean(),
    createdAt: z.date(),
});

export const AutomationRuleStruct = struct.name("AutomationRule")<z.output<typeof AutomationRuleSchema>, z.input<typeof AutomationRuleSchema>>(AutomationRuleSchema);
export type AutomationRule = StructSelf<typeof AutomationRuleStruct>;

export const TaskTemplateSchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    category: TemplateCategorySchema,
    titleTemplate: z.string(),
    descriptionTemplate: z.string(),
    priority: TaskPrioritySchema,
    variables: z.array(TemplateVariableSchema),
    subtasks: z.array(SubtaskTemplateSchema).optional(),
    automationRules: z.array(AutomationRuleSchema).optional(),
    createdAt: z.date(),
    updatedAt: z.date(),
});

export const TaskTemplateStruct = struct.name("TaskTemplate")<z.output<typeof TaskTemplateSchema>, z.input<typeof TaskTemplateSchema>>(TaskTemplateSchema);
export type TaskTemplate = StructSelf<typeof TaskTemplateStruct>;

export const CreateTaskFromTemplateInputSchema = z.object({
    templateId: z.string(),
    variables: z.record(z.unknown()),
    subtasks: z.boolean().optional(),
});

export const CreateTaskFromTemplateInputStruct = struct.name("CreateTaskFromTemplateInput")<z.output<typeof CreateTaskFromTemplateInputSchema>, z.input<typeof CreateTaskFromTemplateInputSchema>>(CreateTaskFromTemplateInputSchema);
export type CreateTaskFromTemplateInput = StructSelf<typeof CreateTaskFromTemplateInputStruct>;

export const TaskFiltersSchema = z.object({
    status: z.array(TaskStatusSchema).optional(),
    priority: z.array(TaskPrioritySchema).optional(),
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
    assignedTo: z.array(z.string()).optional(),
    createdBy: z.array(z.string()).optional(),
    collaborators: z.array(z.string()).optional(),
    watchers: z.array(z.string()).optional(),
});

export const TaskFiltersStruct = struct.name("TaskFilters")<z.output<typeof TaskFiltersSchema>, z.input<typeof TaskFiltersSchema>>(TaskFiltersSchema);
export type TaskFilters = StructSelf<typeof TaskFiltersStruct>;

export const TaskSortSchema = z.object({
    field: z.enum(["title", "createdAt", "updatedAt", "priority", "status"]),
    direction: SearchSortDirectionSchema,
});

export const TaskSortStruct = struct.name("TaskSort")<z.output<typeof TaskSortSchema>, z.input<typeof TaskSortSchema>>(TaskSortSchema);
export type TaskSort = StructSelf<typeof TaskSortStruct>;

export const TaskSearchOptionsSchema = z.object({
    query: z.string().optional(),
    filters: TaskFiltersSchema.optional(),
    sort: TaskSortSchema.optional(),
    limit: z.number().optional(),
    offset: z.number().optional(),
});

export const TaskSearchOptionsStruct = struct.name("TaskSearchOptions")<z.output<typeof TaskSearchOptionsSchema>, z.input<typeof TaskSearchOptionsSchema>>(TaskSearchOptionsSchema);
export type TaskSearchOptions = StructSelf<typeof TaskSearchOptionsStruct>;

export const TaskSearchSortFieldSchema = z.enum([
    "relevance",
    "title",
    "createdAt",
    "updatedAt",
    "priority",
    "status",
]);
export type TaskSearchSortField = z.output<typeof TaskSearchSortFieldSchema>;

export const TaskSearchSortSchema = z.object({
    field: TaskSearchSortFieldSchema,
    direction: SearchSortDirectionSchema,
});

export const TaskSearchSortStruct = struct.name("TaskSearchSort")<z.output<typeof TaskSearchSortSchema>, z.input<typeof TaskSearchSortSchema>>(TaskSearchSortSchema);
export type TaskSearchSort = StructSelf<typeof TaskSearchSortStruct>;
export type SearchSort = BaseSearchSort<TaskSearchSortField>;

export const TaskSearchQuerySchema = SearchQuerySchema.extend({
    status: z.array(TaskStatusSchema).optional(),
    priority: z.array(TaskPrioritySchema).optional(),
    type: z.array(TaskTypeSchema).optional(),
    sort: TaskSearchSortSchema.optional(),
});

export const TaskSearchQueryStruct = struct.name("TaskSearchQuery")<z.output<typeof TaskSearchQuerySchema>, z.input<typeof TaskSearchQuerySchema>>(TaskSearchQuerySchema);
export type TaskSearchQuery = StructSelf<typeof TaskSearchQueryStruct>;
export type SearchQuery = BaseSearchQuery<TaskStatus, TaskPriority, TaskType, TaskSearchSortField>;

export const TaskSearchFacetsSchema = SearchFacetsSchema.extend({
    status: z.record(z.number()),
    priority: z.record(z.number()),
    type: z.record(z.number()),
});

export const TaskSearchFacetsStruct = struct.name("TaskSearchFacets")<z.output<typeof TaskSearchFacetsSchema>, z.input<typeof TaskSearchFacetsSchema>>(TaskSearchFacetsSchema);
export type TaskSearchFacets = StructSelf<typeof TaskSearchFacetsStruct>;
export type SearchFacets = BaseSearchFacets<TaskStatus, TaskPriority, TaskType>;

export const TaskSearchResultSchema = SearchResultSchema.extend({
    tasks: z.array(TaskSchema),
    query: TaskSearchQuerySchema,
    highlights: SearchHighlightsSchema.optional(),
    facets: TaskSearchFacetsSchema.optional(),
});

export const TaskSearchResultStruct = struct.name("TaskSearchResult")<z.output<typeof TaskSearchResultSchema>, z.input<typeof TaskSearchResultSchema>>(TaskSearchResultSchema);
export type TaskSearchResult = StructSelf<typeof TaskSearchResultStruct>;
export type SearchResult = BaseSearchResult<Task, TaskStatus, TaskPriority, TaskType, TaskSearchSortField>;

export const TaskSavedSearchSchema = SavedSearchSchema.extend({
    query: TaskSearchQuerySchema,
});

export const TaskSavedSearchStruct = struct.name("TaskSavedSearch")<z.output<typeof TaskSavedSearchSchema>, z.input<typeof TaskSavedSearchSchema>>(TaskSavedSearchSchema);
export type TaskSavedSearch = StructSelf<typeof TaskSavedSearchStruct>;
export type SavedSearch = BaseSavedSearch<TaskStatus, TaskPriority, TaskType, TaskSearchSortField>;

export const TaskCreateSavedSearchInputSchema = CreateSavedSearchInputSchema.extend({
    query: TaskSearchQuerySchema,
});

export const TaskCreateSavedSearchInputStruct = struct.name("TaskCreateSavedSearchInput")<z.output<typeof TaskCreateSavedSearchInputSchema>, z.input<typeof TaskCreateSavedSearchInputSchema>>(TaskCreateSavedSearchInputSchema);
export type TaskCreateSavedSearchInput = StructSelf<typeof TaskCreateSavedSearchInputStruct>;
export type CreateSavedSearchInput = BaseCreateSavedSearchInput<
    TaskStatus,
    TaskPriority,
    TaskType,
    TaskSearchSortField
>;

export const TaskUpdateSavedSearchInputSchema = UpdateSavedSearchInputSchema.extend({
    query: TaskSearchQuerySchema.optional(),
});

export const TaskUpdateSavedSearchInputStruct = struct.name("TaskUpdateSavedSearchInput")<z.output<typeof TaskUpdateSavedSearchInputSchema>, z.input<typeof TaskUpdateSavedSearchInputSchema>>(TaskUpdateSavedSearchInputSchema);
export type TaskUpdateSavedSearchInput = StructSelf<typeof TaskUpdateSavedSearchInputStruct>;
export type UpdateSavedSearchInput = BaseUpdateSavedSearchInput<
    TaskStatus,
    TaskPriority,
    TaskType,
    TaskSearchSortField
>;

export const RuleExecutionContextSchema = z.object({
    trigger: RuleTriggerSchema,
    task: TaskSchema,
    relatedTasks: z.array(TaskSchema).optional(),
    oldStatus: TaskStatusSchema.optional(),
    newStatus: TaskStatusSchema.optional(),
    oldPriority: TaskPrioritySchema.optional(),
    newPriority: TaskPrioritySchema.optional(),
});

export const RuleExecutionContextStruct = struct.name("RuleExecutionContext")<z.output<typeof RuleExecutionContextSchema>, z.input<typeof RuleExecutionContextSchema>>(RuleExecutionContextSchema);
export type RuleExecutionContext = StructSelf<typeof RuleExecutionContextStruct>;

export const RuleExecutionResultSchema = z.object({
    ruleId: z.string(),
    ruleName: z.string(),
    success: z.boolean(),
    result: z.record(z.unknown()).optional(),
    error: z.string().optional(),
});

export const RuleExecutionResultStruct = struct.name("RuleExecutionResult")<z.output<typeof RuleExecutionResultSchema>, z.input<typeof RuleExecutionResultSchema>>(RuleExecutionResultSchema);
export type RuleExecutionResult = StructSelf<typeof RuleExecutionResultStruct>;

impl(IdentifiableTrait).for(TaskIdentityStruct, {
    id: method((self: TaskIdentity) => self.id),
});

impl(IdentifiableTrait).for(TaskStruct, {
    id: method((self: Task) => self.id),
});

impl(IdentifiableTrait).for(AutomationRuleStruct, {
    id: method((self: AutomationRule) => self.id),
});

impl(IdentifiableTrait).for(TaskTemplateStruct, {
    id: method((self: TaskTemplate) => self.id),
});

impl(IdentifiableTrait).for(TaskSavedSearchStruct, {
    id: method((self: TaskSavedSearch) => self.id),
});

impl(TimestampedTrait).for(TaskIdentityStruct, {
    createdAt: method((self: TaskIdentity) => self.createdAt),
    updatedAt: method((self: TaskIdentity) => self.updatedAt),
});

impl(TimestampedTrait).for(TaskStruct, {
    createdAt: method((self: Task) => self.createdAt),
    updatedAt: method((self: Task) => self.updatedAt),
});

impl(TimestampedTrait).for(TaskTemplateStruct, {
    createdAt: method((self: TaskTemplate) => self.createdAt),
    updatedAt: method((self: TaskTemplate) => self.updatedAt),
});

impl(TimestampedTrait).for(TaskSavedSearchStruct, {
    createdAt: method((self: TaskSavedSearch) => self.createdAt),
    updatedAt: method((self: TaskSavedSearch) => self.updatedAt),
});
