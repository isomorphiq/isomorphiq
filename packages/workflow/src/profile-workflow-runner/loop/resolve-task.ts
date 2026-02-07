import type { WorkflowTask } from "../../agent-runner.ts";
import type { WorkflowStateName } from "../../workflow-factory.ts";
import { getNextStateFrom, WORKFLOW } from "../../workflow.ts";
import { logNoTaskWait, resetNoTaskWaitLogging } from "../runner-context.ts";
import {
    selectInvalidTaskForClosure,
    selectTaskForState,
} from "../shared/task-selection.ts";
import { dependenciesSatisfied, normalizeTaskStatus } from "../shared/task-normalization.ts";
import { buildVirtualTask, shouldClaimTaskBeforeExecution } from "../transitions/execution.ts";
import { buildPrefetchedListTasksOutput } from "../transitions/prefetch-output.ts";
import { QA_TRACKED_TRANSITIONS } from "../transitions/qa-transitions.ts";
import {
    canRunWithoutTask,
    resolveNoTaskFallbackTransition,
    resolveTargetTypeForTransition,
} from "../transitions/transition-metadata.ts";
import type { PreparedTransition, ResolveTaskInput, TaskResolutionResult } from "./types.ts";

const describeClaimFailure = (
    task: WorkflowTask,
    workerId: string,
    tasks: WorkflowTask[],
): string => {
    const assignedTo = typeof task.assignedTo === "string" ? task.assignedTo.trim() : "";
    if (assignedTo.length > 0 && assignedTo !== workerId) {
        return `already claimed by worker "${assignedTo}"`;
    }

    const status = normalizeTaskStatus(task.status);
    if (status !== "todo" && status !== "in-progress") {
        return `not claimable because status is "${status}"`;
    }

    if (!dependenciesSatisfied(task, tasks)) {
        return "not claimable because dependencies are unsatisfied";
    }

    return "claim rejected due to concurrent state change";
};

const updateTransition = (
    tokenState: WorkflowStateName,
    baseState: ResolveTaskInput["state"],
    tasks: WorkflowTask[],
    current: PreparedTransition,
    transition: string,
): PreparedTransition => {
    const nextStateName = getNextStateFrom(WORKFLOW, tokenState, transition) ?? tokenState;
    const state = WORKFLOW[nextStateName] ?? baseState;
    const targetType = resolveTargetTypeForTransition(state, transition);
    const preferPreferredTask = QA_TRACKED_TRANSITIONS.includes(
        transition as (typeof QA_TRACKED_TRANSITIONS)[number],
    );

    return {
        ...current,
        transition,
        prefetchedListTasksOutput: buildPrefetchedListTasksOutput(transition, tasks),
        nextStateName,
        targetState: state,
        targetType,
        preferPreferredTask,
    };
};

const selectCandidate = (
    tasks: WorkflowTask[],
    state: ResolveTaskInput["state"],
    transition: PreparedTransition,
    claimModeEnabled: boolean,
    excludedTaskIds?: ReadonlySet<string>,
): WorkflowTask | null =>
    transition.transition === "close-invalid-task"
        ? selectInvalidTaskForClosure(tasks, excludedTaskIds)
        : selectTaskForState(
            tasks,
            state,
            transition.targetType,
            transition.inferredTaskId,
            transition.preferPreferredTask,
            claimModeEnabled,
            excludedTaskIds,
        );

export const resolveTaskForTransition = async (
    input: ResolveTaskInput,
): Promise<TaskResolutionResult> => {
    let transition = input.transition;
    let taskCandidate = selectCandidate(input.tasks, input.state, transition, input.claimModeEnabled);

    if (
        !taskCandidate
        && transition.transition === "begin-implementation"
        && Boolean(input.state.transitions["need-more-tasks"])
    ) {
        transition = updateTransition(
            input.tokenState,
            input.state,
            input.tasks,
            transition,
            "need-more-tasks",
        );
        taskCandidate = selectCandidate(input.tasks, input.state, transition, input.claimModeEnabled);
        console.warn("[WORKFLOW] No runnable implementation task; falling back to need-more-tasks");
    }

    const attemptedFallbackTransitions = new Set<string>([transition.transition]);
    while (!taskCandidate && !canRunWithoutTask(transition.transition)) {
        const fallbackTransition = resolveNoTaskFallbackTransition(input.state, transition.transition);
        if (
            !fallbackTransition
            || fallbackTransition === transition.transition
            || attemptedFallbackTransitions.has(fallbackTransition)
        ) {
            break;
        }
        attemptedFallbackTransitions.add(fallbackTransition);

        const missingTargetType = transition.targetType ?? "matching";
        console.log(
            `[WORKFLOW] No ${missingTargetType} tasks for ${transition.transition}; transitioning via ${fallbackTransition}.`,
        );
        transition = updateTransition(
            input.tokenState,
            input.state,
            input.tasks,
            transition,
            fallbackTransition,
        );
        taskCandidate = selectCandidate(input.tasks, input.state, transition, input.claimModeEnabled);
    }

    if (!taskCandidate && !canRunWithoutTask(transition.transition)) {
        return {
            kind: "wait",
            noTaskWaitState: logNoTaskWait(
                input.noTaskWaitState,
                transition.transition,
                transition.targetType,
                input.noTaskWaitHeartbeatMs,
            ),
        };
    }

    let claimedTaskCandidate = taskCandidate;
    if (
        input.claimModeEnabled
        && input.claimTask
        && claimedTaskCandidate
        && shouldClaimTaskBeforeExecution(transition.transition, claimedTaskCandidate)
        && claimedTaskCandidate.id
    ) {
        const excludedTaskIds = new Set<string>();
        while (
            claimedTaskCandidate
            && shouldClaimTaskBeforeExecution(transition.transition, claimedTaskCandidate)
            && claimedTaskCandidate.id
        ) {
            const claimTargetId = claimedTaskCandidate.id;
            const claimedTask = await input.claimTask(claimTargetId);
            if (claimedTask) {
                claimedTaskCandidate = claimedTask;
                break;
            }

            excludedTaskIds.add(claimTargetId);
            const claimFailureReason = describeClaimFailure(
                claimedTaskCandidate,
                input.workerId,
                input.tasks,
            );
            console.log(
                `[WORKFLOW] ${input.workerId} skipped task ${claimTargetId}; ${claimFailureReason}.`,
            );
            claimedTaskCandidate = selectCandidate(
                input.tasks,
                input.state,
                transition,
                input.claimModeEnabled,
                excludedTaskIds,
            );
        }

        if (!claimedTaskCandidate) {
            return {
                kind: "wait",
                noTaskWaitState: resetNoTaskWaitLogging(input.noTaskWaitState),
            };
        }
    }

    return {
        kind: "resolved",
        noTaskWaitState: resetNoTaskWaitLogging(input.noTaskWaitState),
        transition,
        taskCandidate: claimedTaskCandidate,
        task: claimedTaskCandidate ?? buildVirtualTask(transition.transition, transition.targetType),
    };
};
