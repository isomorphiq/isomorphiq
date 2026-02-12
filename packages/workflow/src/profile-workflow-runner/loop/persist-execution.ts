import type { TaskActionLog } from "@isomorphiq/types";
import type { WorkflowExecutionResult, WorkflowTask } from "../../agent-runner.ts";
import { loadContextData, updateContextData } from "../runner-context.ts";
import {
    createProceduralQaActivityLogEntry,
    type ProceduralQaOutcome,
} from "../shared/qa-procedural.ts";
import { buildTaskContextSnapshot } from "../shared/task-context.ts";
import { inferTestReportFromExecution } from "../shared/test-report.ts";
import {
    type ProceduralQaTransition,
    isQaRunTransition,
    QA_TRACKED_TRANSITIONS,
} from "../transitions/qa-transitions.ts";

type PersistExecutionInput = {
    contextClient: Parameters<typeof updateContextData>[0];
    contextId: string;
    transition: string;
    execution: WorkflowExecutionResult;
    task: WorkflowTask;
    currentTaskId?: string;
    inferredTaskId?: string;
    proceduralQaOutcome: ProceduralQaOutcome | null;
    transitionStartedAtMs: number;
    appendTaskActionLogEntry?: (
        taskId: string,
        entry: TaskActionLog,
        fallbackLog?: TaskActionLog[],
    ) => Promise<void>;
};

export const persistExecutionResult = async (input: PersistExecutionInput): Promise<void> => {
    const shouldTrackTask = QA_TRACKED_TRANSITIONS.includes(
        input.transition as (typeof QA_TRACKED_TRANSITIONS)[number],
    );
    const shouldClearLastTestResult =
        input.transition === "begin-implementation"
        || (!shouldTrackTask && !isQaRunTransition(input.transition));
    const shouldClearTestReport = shouldClearLastTestResult;
    const trackedTaskId =
        input.task.id
        ?? input.currentTaskId
        ?? input.inferredTaskId;
    const nextCurrentTaskId = shouldTrackTask
        ? (trackedTaskId ?? null)
        : null;
    const taskSnapshot =
        typeof nextCurrentTaskId === "string"
            ? buildTaskContextSnapshot(input.task, nextCurrentTaskId)
            : null;

    let inferredTestPatchResult: Record<string, unknown> = {};
    if (input.proceduralQaOutcome) {
        inferredTestPatchResult = input.proceduralQaOutcome.patch;
    } else if (isQaRunTransition(input.transition)) {
        const inferred = inferTestReportFromExecution(input.execution);
        const latestContext = await loadContextData(input.contextClient, input.contextId);
        const latestTestStatus =
            typeof latestContext.testStatus === "string"
                ? latestContext.testStatus.trim()
                : "";
        const latestTestReport =
            latestContext.testReport && typeof latestContext.testReport === "object"
                ? (latestContext.testReport as Record<string, unknown>)
                : null;
        const testStatusPatch =
            latestTestStatus.length === 0 && inferred.testStatus
                ? { testStatus: inferred.testStatus }
                : {};
        const testReportPatch =
            !latestTestReport && inferred.testReport
                ? { testReport: inferred.testReport }
                : {};
        inferredTestPatchResult = { ...testStatusPatch, ...testReportPatch };
    }

    const contextPatch: Record<string, unknown> = {
        ...(typeof nextCurrentTaskId === "string"
            ? { currentTaskId: nextCurrentTaskId }
            : { currentTaskId: null }),
        ...(taskSnapshot
            ? {
                currentTask: taskSnapshot,
                currentTaskBranch:
                    typeof taskSnapshot.branch === "string"
                        ? taskSnapshot.branch
                        : null,
            }
            : {
                currentTask: null,
                currentTaskBranch: null,
            }),
        ...(isQaRunTransition(input.transition)
            ? { lastTestResult: input.execution }
            : shouldClearLastTestResult
                ? { lastTestResult: null }
                : {}),
        ...(shouldClearTestReport
            ? {
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
            }
            : {}),
        ...inferredTestPatchResult,
    };
    await updateContextData(input.contextClient, input.contextId, contextPatch);

    if (input.proceduralQaOutcome && input.task.id && input.appendTaskActionLogEntry) {
        const logEntry = createProceduralQaActivityLogEntry(
            input.transition as ProceduralQaTransition,
            input.execution.success,
            Date.now() - input.transitionStartedAtMs,
            input.proceduralQaOutcome.qaReport,
        );
        try {
            await input.appendTaskActionLogEntry(input.task.id, logEntry, input.task.actionLog);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.warn(
                `[WORKFLOW] Failed to append procedural activity log for task ${input.task.id}: ${message}`,
            );
        }
    }
};
