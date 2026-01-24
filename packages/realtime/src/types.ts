import { z } from "zod";
import { impl, method, struct, trait } from "@tsimpl/runtime";
import type { StructSelf } from "@tsimpl/runtime";
import type { Self } from "@tsimpl/core";
import { TaskPrioritySchema, TaskSchema, TaskStatusSchema } from "@isomorphiq/tasks";
import type { Task } from "@isomorphiq/tasks";
import type { WebSocket } from "ws";

export const WebSocketEventTypeSchema = z.enum([
    "task_created",
    "task_updated",
    "task_deleted",
    "task_status_changed",
    "task_priority_changed",
    "task_assigned",
    "task_collaborators_updated",
    "task_watchers_updated",
    "tasks_list",
    "task_archived",
    "task_restored",
    "retention_policy_executed",
    "pong",
]);

export type WebSocketEventType = z.output<typeof WebSocketEventTypeSchema>;

export const WebSocketEventSchema = z.object({
    type: WebSocketEventTypeSchema,
    timestamp: z.date(),
    data: z.unknown(),
});

export const WebSocketEventStruct = struct.name("WebSocketEvent")<z.output<typeof WebSocketEventSchema>, z.input<typeof WebSocketEventSchema>>(WebSocketEventSchema);
export type WebSocketEvent = StructSelf<typeof WebSocketEventStruct>;

export const TaskCreatedEventSchema = WebSocketEventSchema.extend({
    type: z.literal("task_created"),
    data: z.object({
        task: TaskSchema,
        createdBy: z.string(),
    }),
});

export const TaskCreatedEventStruct = struct.name("TaskCreatedEvent")<z.output<typeof TaskCreatedEventSchema>, z.input<typeof TaskCreatedEventSchema>>(TaskCreatedEventSchema);
export type TaskCreatedEvent = StructSelf<typeof TaskCreatedEventStruct>;

export const TaskUpdatedEventSchema = WebSocketEventSchema.extend({
    type: z.literal("task_updated"),
    data: z.object({
        task: TaskSchema,
        changes: TaskSchema.partial(),
        updatedBy: z.string().optional(),
    }),
});

export const TaskUpdatedEventStruct = struct.name("TaskUpdatedEvent")<z.output<typeof TaskUpdatedEventSchema>, z.input<typeof TaskUpdatedEventSchema>>(TaskUpdatedEventSchema);
export type TaskUpdatedEvent = StructSelf<typeof TaskUpdatedEventStruct>;

export const TaskAssignedEventSchema = WebSocketEventSchema.extend({
    type: z.literal("task_assigned"),
    data: z.object({
        task: TaskSchema,
        assignedTo: z.string(),
        assignedBy: z.string(),
    }),
});

export const TaskAssignedEventStruct = struct.name("TaskAssignedEvent")<z.output<typeof TaskAssignedEventSchema>, z.input<typeof TaskAssignedEventSchema>>(TaskAssignedEventSchema);
export type TaskAssignedEvent = StructSelf<typeof TaskAssignedEventStruct>;

export const TaskCollaboratorsUpdatedEventSchema = WebSocketEventSchema.extend({
    type: z.literal("task_collaborators_updated"),
    data: z.object({
        task: TaskSchema,
        collaborators: z.array(z.string()),
        updatedBy: z.string(),
    }),
});

export const TaskCollaboratorsUpdatedEventStruct = struct.name("TaskCollaboratorsUpdatedEvent")<z.output<typeof TaskCollaboratorsUpdatedEventSchema>, z.input<typeof TaskCollaboratorsUpdatedEventSchema>>(TaskCollaboratorsUpdatedEventSchema);
export type TaskCollaboratorsUpdatedEvent = StructSelf<typeof TaskCollaboratorsUpdatedEventStruct>;

export const TaskWatchersUpdatedEventSchema = WebSocketEventSchema.extend({
    type: z.literal("task_watchers_updated"),
    data: z.object({
        task: TaskSchema,
        watchers: z.array(z.string()),
        updatedBy: z.string(),
    }),
});

export const TaskWatchersUpdatedEventStruct = struct.name("TaskWatchersUpdatedEvent")<z.output<typeof TaskWatchersUpdatedEventSchema>, z.input<typeof TaskWatchersUpdatedEventSchema>>(TaskWatchersUpdatedEventSchema);
export type TaskWatchersUpdatedEvent = StructSelf<typeof TaskWatchersUpdatedEventStruct>;

export const TaskDeletedEventSchema = WebSocketEventSchema.extend({
    type: z.literal("task_deleted"),
    data: z.object({
        taskId: z.string(),
        deletedBy: z.string(),
    }),
});

export const TaskDeletedEventStruct = struct.name("TaskDeletedEvent")<z.output<typeof TaskDeletedEventSchema>, z.input<typeof TaskDeletedEventSchema>>(TaskDeletedEventSchema);
export type TaskDeletedEvent = StructSelf<typeof TaskDeletedEventStruct>;

export const TaskStatusChangedEventSchema = WebSocketEventSchema.extend({
    type: z.literal("task_status_changed"),
    data: z.object({
        taskId: z.string(),
        oldStatus: TaskStatusSchema,
        newStatus: TaskStatusSchema,
        task: TaskSchema,
        updatedBy: z.string(),
    }),
});

export const TaskStatusChangedEventStruct = struct.name("TaskStatusChangedEvent")<z.output<typeof TaskStatusChangedEventSchema>, z.input<typeof TaskStatusChangedEventSchema>>(TaskStatusChangedEventSchema);
export type TaskStatusChangedEvent = StructSelf<typeof TaskStatusChangedEventStruct>;

export const TaskPriorityChangedEventSchema = WebSocketEventSchema.extend({
    type: z.literal("task_priority_changed"),
    data: z.object({
        taskId: z.string(),
        oldPriority: TaskPrioritySchema,
        newPriority: TaskPrioritySchema,
        task: TaskSchema,
        updatedBy: z.string(),
    }),
});

export const TaskPriorityChangedEventStruct = struct.name("TaskPriorityChangedEvent")<z.output<typeof TaskPriorityChangedEventSchema>, z.input<typeof TaskPriorityChangedEventSchema>>(TaskPriorityChangedEventSchema);
export type TaskPriorityChangedEvent = StructSelf<typeof TaskPriorityChangedEventStruct>;

export const TasksListEventSchema = WebSocketEventSchema.extend({
    type: z.literal("tasks_list"),
    data: z.object({
        tasks: z.array(TaskSchema),
    }),
});

export const TasksListEventStruct = struct.name("TasksListEvent")<z.output<typeof TasksListEventSchema>, z.input<typeof TasksListEventSchema>>(TasksListEventSchema);
export type TasksListEvent = StructSelf<typeof TasksListEventStruct>;

export const WebSocketMessageSchema = z.object({
    event: WebSocketEventSchema,
    id: z.string().optional(),
});

export const WebSocketMessageStruct = struct.name("WebSocketMessage")<z.output<typeof WebSocketMessageSchema>, z.input<typeof WebSocketMessageSchema>>(WebSocketMessageSchema);
export type WebSocketMessage = StructSelf<typeof WebSocketMessageStruct>;

export type WebSocketClient = {
    id: string;
    socket: WebSocket;
    lastPing: Date;
    subscriptions: Set<WebSocketEventType>;
    userId?: string;
};

export const WebSocketEventTrait = trait({
    type: method<Self, WebSocketEventType>(),
    timestamp: method<Self, Date>(),
});

impl(WebSocketEventTrait).for(WebSocketEventStruct, {
    type: method((self: WebSocketEvent) => self.type),
    timestamp: method((self: WebSocketEvent) => self.timestamp),
});

export type TaskEventData = Task | Record<string, unknown>;
