import type { ContextClient } from "@isomorphiq/context";
import type { TaskActionLog, TaskStatus } from "@isomorphiq/types";
import type {
    WorkflowExecutionResult,
    WorkflowTask,
    WorkflowTaskExecutor,
} from "../../agent-runner.ts";
import type { RuntimeState, WorkflowStateName } from "../../workflow-factory.ts";
import type { NoTaskWaitLogState } from "../runner-context.ts";
import type { WorkflowTaskUpdateInput } from "../types.ts";

export type PreparedTransition = {
    transition: string;
    isDecider: boolean;
    prefetchedListTasksOutput: string | null;
    nextStateName: WorkflowStateName;
    targetState: RuntimeState;
    targetType: string | undefined;
    preferPreferredTask: boolean;
    currentTaskId: string | undefined;
    lastTestResult: unknown;
    inferredTaskId: string | undefined;
};

export type ResolveTaskInput = {
    tokenState: WorkflowStateName;
    state: RuntimeState;
    tasks: WorkflowTask[];
    transition: PreparedTransition;
    claimModeEnabled: boolean;
    claimTask?: (taskId: string) => Promise<WorkflowTask | null>;
    workerId: string;
    noTaskWaitState: NoTaskWaitLogState;
    noTaskWaitHeartbeatMs: number;
};

export type TaskResolutionResult = {
    kind: "resolved";
    noTaskWaitState: NoTaskWaitLogState;
    transition: PreparedTransition;
    taskCandidate: WorkflowTask | null;
    task: WorkflowTask;
} | {
    kind: "wait";
    noTaskWaitState: NoTaskWaitLogState;
};

export type ExecuteTransitionInput = {
    contextClient: ContextClient;
    contextId: string;
    tokenState: WorkflowStateName;
    tokenContext: Record<string, unknown>;
    transition: PreparedTransition;
    task: WorkflowTask;
    taskCandidate: WorkflowTask | null;
    tasks: WorkflowTask[];
    taskExecutor: WorkflowTaskExecutor;
    environment?: string;
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
};

export type ExecuteTransitionResult = {
    nextStateName: string;
    execution?: WorkflowExecutionResult;
};
