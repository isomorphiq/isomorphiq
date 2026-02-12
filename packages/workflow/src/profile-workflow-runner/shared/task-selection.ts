import type { RuntimeState, WorkflowStateName } from "../../workflow-factory.ts";
import type { WorkflowTask } from "../../agent-runner.ts";
import {
    dependenciesSatisfied,
    hasRunnableImplementationTasks,
    isActiveStatus,
    isImplementationTaskType,
    isTaskInvalidForImplementation,
    isTestingTaskType,
    normalizeTaskStatus,
    normalizeTaskType,
    priorityScore,
} from "./task-normalization.ts";

const isExcluded = (
    task: WorkflowTask,
    excludedTaskIds?: ReadonlySet<string>,
): boolean => Boolean(task.id && excludedTaskIds?.has(task.id));

export const selectInvalidTaskForClosure = (
    tasks: WorkflowTask[],
    excludedTaskIds?: ReadonlySet<string>,
): WorkflowTask | null => {
    const invalid = tasks.filter(
        (task) => isTaskInvalidForImplementation(task) && !isExcluded(task, excludedTaskIds),
    );
    if (invalid.length === 0) {
        return null;
    }

    const sorted = [...invalid].sort((left, right) => {
        const leftScore = priorityScore(left.priority);
        const rightScore = priorityScore(right.priority);
        if (leftScore !== rightScore) {
            return rightScore - leftScore;
        }
        return (left.title ?? "").localeCompare(right.title ?? "");
    });
    return sorted[0] ?? null;
};

export const selectInProgressImplementationTask = (tasks: WorkflowTask[]): WorkflowTask | null => {
    const inProgress = tasks.filter(
        (task) => isImplementationTaskType(task.type) && task.status === "in-progress",
    );
    if (inProgress.length === 0) {
        return null;
    }

    const sorted = [...inProgress].sort((left, right) => {
        const leftScore = priorityScore(left.priority);
        const rightScore = priorityScore(right.priority);
        if (leftScore !== rightScore) {
            return rightScore - leftScore;
        }
        return (left.title ?? "").localeCompare(right.title ?? "");
    });
    return sorted[0] ?? null;
};

export const deriveStateFromTasks = (
    tasks: WorkflowTask[],
): { state: WorkflowStateName; currentTaskId?: string } | null => {
    const inProgress = selectInProgressImplementationTask(tasks);
    if (inProgress?.id) {
        return { state: "task-in-progress", currentTaskId: inProgress.id };
    }

    const hasActionableImplementation = tasks.some(
        (task) =>
            isImplementationTaskType(task.type)
            && task.status === "todo"
            && dependenciesSatisfied(task, tasks),
    );
    if (hasActionableImplementation) {
        return { state: "tasks-prepared" };
    }

    const stateByType: Array<{ type: string; state: WorkflowStateName }> = [
        { type: "story", state: "stories-prioritized" },
        { type: "feature", state: "features-prioritized" },
        { type: "initiative", state: "initiatives-prioritized" },
        { type: "theme", state: "themes-prioritized" },
    ];
    const matched = stateByType.find(({ type }) =>
        tasks.some((task) => normalizeTaskType(task.type) === type && isActiveStatus(task.status)),
    );
    return matched ? { state: matched.state } : null;
};

export const selectTaskForState = (
    tasks: WorkflowTask[],
    state: RuntimeState | null,
    targetTypeOverride?: string,
    preferredTaskId?: string,
    preferPreferredTask?: boolean,
    restrictInProgressToPreferred?: boolean,
    excludedTaskIds?: ReadonlySet<string>,
): WorkflowTask | null => {
    if (tasks.length === 0) {
        return null;
    }

    const activeTasks = tasks.filter(
        (task) =>
            (normalizeTaskType(task.type) === "theme" || task.status !== "done")
            && task.status !== "invalid"
            && !isExcluded(task, excludedTaskIds)
            && (
                !restrictInProgressToPreferred
                || normalizeTaskStatus(task.status) !== "in-progress"
                || (preferredTaskId ? task.id === preferredTaskId : false)
            ),
    );
    const targetType = targetTypeOverride ?? state?.targetType;
    if (!targetType) {
        return activeTasks[0] ?? tasks[0] ?? null;
    }

    const normalizedTarget = normalizeTaskType(targetType);
    const requiresDependencies = ["implementation", "task", "testing", "integration"].includes(
        normalizedTarget,
    );
    const isDependencyEligible = (task: WorkflowTask): boolean =>
        !requiresDependencies || dependenciesSatisfied(task, tasks);
    const matchesTarget = (task: WorkflowTask): boolean => {
        if (normalizedTarget === "implementation" || normalizedTarget === "task") {
            return isImplementationTaskType(task.type);
        }
        if (normalizedTarget === "testing" || normalizedTarget === "integration") {
            return isTestingTaskType(task.type);
        }
        return normalizeTaskType(task.type) === normalizedTarget;
    };

    const preferredTask = preferredTaskId ? activeTasks.find((task) => task.id === preferredTaskId) : undefined;
    if (
        preferredTask
        && (preferPreferredTask || matchesTarget(preferredTask))
        && (preferredTask.status === "in-progress" || isDependencyEligible(preferredTask))
    ) {
        return preferredTask;
    }

    const candidates = activeTasks.filter((task) => matchesTarget(task) && isDependencyEligible(task));
    const fallbackCandidates =
        candidates.length === 0 && normalizedTarget === "testing"
            ? activeTasks.filter(
                (task) => isImplementationTaskType(task.type) && isDependencyEligible(task),
            )
            : [];
    const eligible = candidates.length > 0 ? candidates : fallbackCandidates;
    if (eligible.length === 0) {
        return null;
    }

    const sorted = [...eligible].sort((left, right) => {
        const leftScore = priorityScore(left.priority);
        const rightScore = priorityScore(right.priority);
        if (leftScore !== rightScore) {
            return rightScore - leftScore;
        }
        return (left.title ?? "").localeCompare(right.title ?? "");
    });
    return sorted[0] ?? null;
};

export { hasRunnableImplementationTasks };
