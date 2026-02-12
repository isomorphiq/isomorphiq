import type { TaskPriority, TaskStatus, Task } from "./types.ts";

export type TaskEventType =
    | "task_created"
    | "task_updated"
    | "task_deleted"
    | "task_status_changed"
    | "task_priority_changed"
    | "task_assigned"
    | "task_collaborators_changed"
    | "task_watchers_changed"
    | "task_dependencies_changed";

export type TaskEvent = {
    environment: string;
    type: TaskEventType;
    timestamp: string;
    task?: Task;
    taskId?: string;
    updatedBy?: string;
    oldStatus?: TaskStatus;
    newStatus?: TaskStatus;
    oldPriority?: TaskPriority;
    newPriority?: TaskPriority;
};
