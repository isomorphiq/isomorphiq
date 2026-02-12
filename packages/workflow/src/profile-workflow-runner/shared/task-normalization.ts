import { isWorkflowTaskActionable, isWorkflowTaskTextComplete } from "../../task-readiness.ts";
import type { WorkflowTask } from "../../agent-runner.ts";

export const normalizeTaskType = (value: string | undefined): string =>
    (value ?? "").trim().toLowerCase();

export const normalizeTaskStatus = (value: string | undefined): string =>
    (value ?? "").trim().toLowerCase().replace(/[_\s]+/g, "-");

export const isActiveStatus = (value: string | undefined): boolean => {
    const status = normalizeTaskStatus(value);
    return status === "todo" || status === "in-progress";
};

export const isImplementationTaskType = (value: string | undefined): boolean => {
    const type = normalizeTaskType(value);
    return type === "implementation" || type === "task";
};

export const isTestingTaskType = (value: string | undefined): boolean => {
    const type = normalizeTaskType(value);
    return type === "testing" || type === "integration";
};

export const priorityScore = (priority: string | undefined): number => {
    switch ((priority ?? "").toLowerCase()) {
        case "high":
            return 3;
        case "medium":
            return 2;
        case "low":
            return 1;
        default:
            return 0;
    }
};

export const dependenciesSatisfied = (task: WorkflowTask, tasks: WorkflowTask[]): boolean => {
    const deps = task.dependencies ?? [];
    if (deps.length === 0) {
        return true;
    }
    return deps.every((depId) => {
        const depTask = tasks.find((candidate) => candidate.id === depId);
        return !depTask || depTask.status === "done" || depTask.status === "invalid";
    });
};

export const isRunnableImplementationTask = (
    task: WorkflowTask,
    tasks: WorkflowTask[],
): boolean =>
    isImplementationTaskType(task.type)
    && isWorkflowTaskActionable(task)
    && dependenciesSatisfied(task, tasks);

export const hasRunnableImplementationTasks = (tasks: WorkflowTask[]): boolean =>
    tasks.some(
        (task) =>
            normalizeTaskStatus(task.status) === "in-progress"
            || isRunnableImplementationTask(task, tasks),
    );

export const isTaskInvalidForImplementation = (task: WorkflowTask): boolean =>
    isImplementationTaskType(task.type) && task.status === "todo" && !isWorkflowTaskTextComplete(task);
