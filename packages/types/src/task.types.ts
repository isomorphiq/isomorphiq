import { z } from "zod";
import { impl, method, struct, trait } from "@tsimpl/runtime";
import type { StructSelf } from "@tsimpl/runtime";
import type { Self } from "@tsimpl/core";

export const IdentifiableTrait = trait({
    id: method<Self, string>(),
});

export const TimestampedTrait = trait({
    createdAt: method<Self, Date>(),
    updatedAt: method<Self, Date>(),
});

export const TaskStatusSchema = z.enum(["todo", "in-progress", "done", "invalid"]);
export type TaskStatus = z.output<typeof TaskStatusSchema>;

export const TaskTypeSchema = z.enum([
    "theme",
    "initiative",
    "feature",
    "story",
    "task",
    "implementation",
    "integration",
    "testing",
    "research",
]);
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

export const TaskActionLogSchema = z.object({
    id: z.string(),
    summary: z.string(),
    profile: z.string(),
    durationMs: z.number(),
    createdAt: z.date(),
    success: z.boolean(),
    transition: z.string().optional(),
    prompt: z.string().optional(),
    modelName: z.string().optional(),
}).passthrough();

export const TaskActionLogStruct = struct.name("TaskActionLog")<
    z.output<typeof TaskActionLogSchema>,
    z.input<typeof TaskActionLogSchema>
>(TaskActionLogSchema);
export type TaskActionLog = StructSelf<typeof TaskActionLogStruct>;

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
    actionLog: z.array(TaskActionLogSchema).optional(),
}).passthrough();

export const TaskStruct = struct.name("Task")<z.output<typeof TaskSchema>, z.input<typeof TaskSchema>>(TaskSchema);
export type Task = StructSelf<typeof TaskStruct>;

impl(IdentifiableTrait).for(TaskIdentityStruct, {
    id: method((self: TaskIdentity) => self.id),
});

impl(IdentifiableTrait).for(TaskStruct, {
    id: method((self: Task) => self.id),
});

impl(TimestampedTrait).for(TaskIdentityStruct, {
    createdAt: method((self: TaskIdentity) => self.createdAt),
    updatedAt: method((self: TaskIdentity) => self.updatedAt),
});

impl(TimestampedTrait).for(TaskStruct, {
    createdAt: method((self: Task) => self.createdAt),
    updatedAt: method((self: Task) => self.updatedAt),
});
