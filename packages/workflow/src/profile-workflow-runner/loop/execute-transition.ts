import { updateContextData } from "../runner-context.ts";
import {
    checkoutMainBranch,
    ensureTaskBranchCheckedOutForTransition,
} from "../shared/git-branch.ts";
import { buildTaskContextSnapshot } from "../shared/task-context.ts";
import { QA_TRACKED_TRANSITIONS } from "../transitions/qa-transitions.ts";
import { runTransitionAction } from "./transition-action.ts";
import { persistExecutionResult } from "./persist-execution.ts";
import type { WorkflowTask } from "../../agent-runner.ts";
import type { ExecuteTransitionInput, ExecuteTransitionResult } from "./types.ts";

const MAX_BRANCH_LENGTH = 120;

const sanitizeBranchSegment = (value: string, maxLength: number): string =>
    value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, maxLength);

const buildTaskBranchName = (taskId: string, taskTitle: string | undefined): string => {
    const idSegment = sanitizeBranchSegment(taskId.replace(/^task-/i, ""), 32);
    const titleSegment = sanitizeBranchSegment(taskTitle ?? "", 48);
    const fallbackId = idSegment.length > 0 ? idSegment : "task";
    const fallbackTitle = titleSegment.length > 0 ? titleSegment : "implementation";
    const fullBranch = `implementation/${fallbackId}-${fallbackTitle}`.slice(0, MAX_BRANCH_LENGTH);
    const normalizedBranch = fullBranch
        .replace(/\/+/g, "/")
        .replace(/\/-+/g, "/")
        .replace(/-+\//g, "/")
        .replace(/^-+|-+$/g, "");
    if (normalizedBranch.length > 0) {
        return normalizedBranch;
    }
    return `implementation/${fallbackId}`;
};

const readTaskBranch = (task: WorkflowTask): string =>
    typeof task.branch === "string" ? task.branch.trim() : "";

const readTaskId = (task: WorkflowTask): string =>
    typeof task.id === "string" ? task.id.trim() : "";

const ensureTaskBranchForBeginImplementation = async (
    input: ExecuteTransitionInput,
): Promise<WorkflowTask> => {
    if (input.transition.transition !== "begin-implementation") {
        return input.task;
    }

    const existingBranch = readTaskBranch(input.task);
    if (existingBranch.length > 0) {
        return input.task;
    }

    const taskId = readTaskId(input.task);
    if (taskId.length === 0) {
        throw new Error("[WORKFLOW] begin-implementation requires a task id to provision branch.");
    }

    if (!input.updateTask) {
        throw new Error(
            `[WORKFLOW] Task ${taskId} has no branch and workflow updateTask callback is not configured.`,
        );
    }

    const generatedBranch = buildTaskBranchName(taskId, input.task.title);
    const persistedTask = await input.updateTask(
        taskId,
        { branch: generatedBranch },
        "workflow",
    );
    const persistedBranch = readTaskBranch(persistedTask);
    if (persistedBranch.length === 0) {
        throw new Error(
            `[WORKFLOW] Failed to persist implementation branch for task ${taskId}.`,
        );
    }
    return {
        ...input.task,
        ...persistedTask,
        branch: persistedBranch,
    };
};

export const executeTransition = async (
    input: ExecuteTransitionInput,
): Promise<ExecuteTransitionResult> => {
    const transitionName = input.transition.transition;
    if (input.transition.transition === "tests-passing") {
        await checkoutMainBranch("tests-passing");
        const effectiveTaskId =
            input.transition.currentTaskId
            ?? input.taskCandidate?.id
            ?? input.transition.inferredTaskId;
        if (effectiveTaskId && input.updateTaskStatus) {
            await input.updateTaskStatus(effectiveTaskId, "done", "workflow");
        } else if (!input.updateTaskStatus) {
            console.warn("[WORKFLOW] updateTaskStatus not configured; skipping auto-complete");
        }

        await updateContextData(input.contextClient, input.contextId, {
            currentTaskId: null,
            currentTask: null,
            currentTaskBranch: null,
            lastTestResult: null,
            testStatus: null,
            testReport: null,
            e2eTestResultStatus: null,
            "e2e-test-result-status": null,
            e2eTestResults: null,
            "e2e-test-results": null,
            e2eTestFailureInvestigationReport: null,
            "e2e-test-failure-investigation-report": null,
            mechanicalQaPreflightResults: null,
            mechanicalTestLintResults: null,
            mechanicalQaPreflightStage: null,
            mechanicalQaPreflightUpdatedAt: null,
            mechanicalTestLintResultsUpdatedAt: null,
        });
        return {
            nextStateName: input.transition.nextStateName,
        };
    }

    const effectiveTask = await ensureTaskBranchForBeginImplementation(input);
    await ensureTaskBranchCheckedOutForTransition(transitionName, effectiveTask);
    const shouldPersistTaskContext = QA_TRACKED_TRANSITIONS.includes(
        transitionName as (typeof QA_TRACKED_TRANSITIONS)[number],
    );
    if (shouldPersistTaskContext) {
        const taskSnapshot = buildTaskContextSnapshot(
            effectiveTask,
            input.transition.currentTaskId ?? input.transition.inferredTaskId,
        );
        await updateContextData(input.contextClient, input.contextId, {
            currentTaskId:
                taskSnapshot && typeof taskSnapshot.id === "string"
                    ? taskSnapshot.id
                    : null,
            currentTask: taskSnapshot,
            currentTaskBranch:
                taskSnapshot && typeof taskSnapshot.branch === "string"
                    ? taskSnapshot.branch
                    : null,
        });
    }

    const transitionStartedAtMs = Date.now();
    const actionResult = await runTransitionAction({
        contextClient: input.contextClient,
        contextId: input.contextId,
        tokenState: input.tokenState,
        tokenContext: input.tokenContext,
        transition: input.transition,
        task: effectiveTask,
        tasks: input.tasks,
        taskExecutor: input.taskExecutor,
        environment: input.environment,
    });

    await persistExecutionResult({
        contextClient: input.contextClient,
        contextId: input.contextId,
        transition: input.transition.transition,
        execution: actionResult.execution,
        task: effectiveTask,
        currentTaskId: input.transition.currentTaskId,
        inferredTaskId: input.transition.inferredTaskId,
        proceduralQaOutcome: actionResult.proceduralQaOutcome,
        transitionStartedAtMs,
        appendTaskActionLogEntry: input.appendTaskActionLogEntry,
    });

    return {
        nextStateName: input.transition.nextStateName,
        execution: actionResult.execution,
    };
};
