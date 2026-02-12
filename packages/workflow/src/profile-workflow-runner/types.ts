import type { TaskActionLog, TaskStatus } from "@isomorphiq/types";
import type { WorkflowStateName } from "../workflow-factory.ts";
import type { WorkflowTask, WorkflowTaskExecutor } from "../agent-runner.ts";

export type WorkflowTaskUpdateInput = {
    branch?: string;
};

export type ProfileWorkflowRunnerOptions = {
    taskProvider: () => Promise<WorkflowTask[]>;
    taskExecutor: WorkflowTaskExecutor;
    initialState?: WorkflowStateName;
    environment?: string;
    pollIntervalMs?: number;
    contextId?: string;
    updateTaskStatus?: (id: string, status: TaskStatus, updatedBy?: string) => Promise<void>;
    updateTask?: (
        id: string,
        updates: WorkflowTaskUpdateInput,
        updatedBy?: string,
    ) => Promise<WorkflowTask>;
    appendTaskActionLogEntry?: (
        taskId: string,
        entry: TaskActionLog,
        fallbackLog?: TaskActionLog[],
    ) => Promise<void>;
    workerId?: string;
    claimTask?: (taskId: string) => Promise<WorkflowTask | null>;
};

export type WorkflowContextToken = {
    contextId: string;
};
