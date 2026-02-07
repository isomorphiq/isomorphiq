import type { WorkflowTask, WorkflowTaskExecutor } from "../../agent-runner.ts";
import type { RuntimeState, WorkflowStateName } from "../../workflow-factory.ts";
import { getNextStateFrom, WORKFLOW } from "../../workflow.ts";
import { resolveTransition } from "../deciders/resolve-transition.ts";
import { selectInProgressImplementationTask } from "../shared/task-selection.ts";
import { buildPrefetchedListTasksOutput } from "../transitions/prefetch-output.ts";
import { QA_TRACKED_TRANSITIONS } from "../transitions/qa-transitions.ts";
import { resolveTargetTypeForTransition } from "../transitions/transition-metadata.ts";
import type { PreparedTransition } from "./types.ts";

type PrepareTransitionInput = {
    state: RuntimeState;
    tasks: WorkflowTask[];
    tokenState: WorkflowStateName;
    tokenContext: Record<string, unknown>;
    contextId: string;
    environment?: string;
    taskExecutor: WorkflowTaskExecutor;
};

export const prepareTransition = async (
    input: PrepareTransitionInput,
): Promise<PreparedTransition | null> => {
    const currentTaskId =
        typeof input.tokenContext.currentTaskId === "string"
            ? input.tokenContext.currentTaskId
            : undefined;
    const lastTestResult = input.tokenContext.lastTestResult;

    const transitionResult = await resolveTransition(input.state, input.tasks, {
        ...input.tokenContext,
        workflow: { state: input.state.name },
        services: {
            taskExecutor: input.taskExecutor,
        },
        contextId: input.contextId,
        currentTaskId,
        lastTestResult,
        environment: input.environment,
    });
    if (!transitionResult) {
        console.warn(`[WORKFLOW] No transition chosen for state ${input.state.name}`);
        return null;
    }

    const transition = transitionResult.transition;
    const nextStateName = getNextStateFrom(WORKFLOW, input.tokenState, transition) ?? input.tokenState;
    const targetState = WORKFLOW[nextStateName] ?? input.state;
    const targetType = resolveTargetTypeForTransition(targetState, transition);
    const preferPreferredTask = QA_TRACKED_TRANSITIONS.includes(
        transition as (typeof QA_TRACKED_TRANSITIONS)[number],
    );
    const inferredTaskId = currentTaskId ?? selectInProgressImplementationTask(input.tasks)?.id;

    return {
        transition,
        isDecider: transitionResult.isDecider,
        prefetchedListTasksOutput: buildPrefetchedListTasksOutput(transition, input.tasks),
        nextStateName,
        targetState,
        targetType,
        preferPreferredTask,
        currentTaskId,
        lastTestResult,
        inferredTaskId,
    };
};
