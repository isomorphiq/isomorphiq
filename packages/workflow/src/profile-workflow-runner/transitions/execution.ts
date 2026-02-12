import type { WorkflowTask } from "../../agent-runner.ts";
import { normalizeTaskStatus } from "../shared/task-normalization.ts";
import { canRunWithoutTask } from "./transition-metadata.ts";

export const shouldClaimTaskBeforeExecution = (transition: string, task: WorkflowTask): boolean => {
    if (!task.id) {
        return false;
    }
    if (canRunWithoutTask(transition)) {
        return false;
    }
    return normalizeTaskStatus(task.status) === "todo";
};

export const buildVirtualTask = (
    transition: string,
    targetType: string | undefined,
): WorkflowTask => ({
    title: `Workflow context (${transition})`,
    description: "Virtual task context for workflow execution. Do not create a task for this.",
    status: "todo",
    priority: "medium",
    type: targetType ?? "task",
});
