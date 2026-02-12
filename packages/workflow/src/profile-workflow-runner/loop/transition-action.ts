import type {
    WorkflowExecutionResult,
    WorkflowTask,
    WorkflowTaskExecutor,
} from "../../agent-runner.ts";
import { loadContextData, updateContextData } from "../runner-context.ts";
import { truncateForContext } from "../shared/basic-utils.ts";
import {
    createFailedMechanicalQaPreflightResult,
    type MechanicalQaPreflightResult,
    runMechanicalQaPreflight,
} from "../shared/qa-preflight.ts";
import {
    buildProceduralQaOutcome,
    type ProceduralQaOutcome,
} from "../shared/qa-procedural.ts";
import { buildSelectedTaskContext } from "../shared/task-context.ts";
import { buildFailurePacketSection, buildTestReportSection } from "../shared/test-report.ts";
import {
    isProceduralQaTransition,
    isQaFailureTransition,
    shouldRunQaPreflightForTransition,
} from "../transitions/qa-transitions.ts";
import {
    resolveProfileForTransition,
    shouldIncludeTaskContextForTransition,
    shouldIncludeTaskDescriptionForTransition,
} from "../transitions/transition-metadata.ts";
import type { PreparedTransition } from "./types.ts";

type TransitionActionInput = {
    contextClient: Parameters<typeof updateContextData>[0];
    contextId: string;
    tokenState: string;
    tokenContext: Record<string, unknown>;
    transition: PreparedTransition;
    task: WorkflowTask;
    tasks: WorkflowTask[];
    taskExecutor: WorkflowTaskExecutor;
    environment?: string;
};

export type TransitionActionResult = {
    execution: WorkflowExecutionResult;
    proceduralQaOutcome: ProceduralQaOutcome | null;
};

const E2E_INVESTIGATION_REPORT_LIMIT = 20_000;

const normalizeStringArray = (value: unknown): string[] => {
    if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed.length > 0 ? [trimmed] : [];
    }
    if (Array.isArray(value)) {
        return value
            .filter((entry): entry is string => typeof entry === "string")
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0);
    }
    return [];
};

const uniqueStrings = (values: string[]): string[] =>
    values.reduce<string[]>(
        (acc, value) => (acc.includes(value) ? acc : [...acc, value]),
        [],
    );

const readE2eFailureReportFromContext = (context: Record<string, unknown>): string | null => {
    const direct =
        typeof context.e2eTestFailureInvestigationReport === "string"
            ? context.e2eTestFailureInvestigationReport.trim()
            : "";
    if (direct.length > 0) {
        return direct;
    }
    const dashed =
        typeof context["e2e-test-failure-investigation-report"] === "string"
            ? String(context["e2e-test-failure-investigation-report"]).trim()
            : "";
    if (dashed.length > 0) {
        return dashed;
    }
    return null;
};

const readE2eFailureData = (context: Record<string, unknown>): {
    status: string | null;
    failedTests: string[];
    reproSteps: string[];
    suspectedRootCause: string;
    e2eResults: Record<string, unknown> | null;
} => {
    const statusDirect =
        typeof context.e2eTestResultStatus === "string"
            ? context.e2eTestResultStatus.trim().toUpperCase()
            : "";
    const statusDashed =
        typeof context["e2e-test-result-status"] === "string"
            ? String(context["e2e-test-result-status"]).trim().toUpperCase()
            : "";
    const status =
        statusDirect === "PASSED" || statusDirect === "FAILED"
            ? statusDirect
            : statusDashed === "PASSED" || statusDashed === "FAILED"
                ? statusDashed
                : null;
    const e2eResults =
        context.e2eTestResults && typeof context.e2eTestResults === "object"
            ? (context.e2eTestResults as Record<string, unknown>)
            : context["e2e-test-results"] && typeof context["e2e-test-results"] === "object"
                ? (context["e2e-test-results"] as Record<string, unknown>)
                : null;
    const testReport =
        context.testReport && typeof context.testReport === "object"
            ? (context.testReport as Record<string, unknown>)
            : null;
    const failedTests = uniqueStrings([
        ...normalizeStringArray(e2eResults?.failedTests),
        ...normalizeStringArray(testReport?.failedTests),
    ]);
    const reproSteps = uniqueStrings([
        ...normalizeStringArray(e2eResults?.reproSteps),
        ...normalizeStringArray(testReport?.reproSteps),
    ]);
    const suspectedRootCause =
        typeof e2eResults?.suspectedRootCause === "string"
            ? e2eResults.suspectedRootCause.trim()
            : typeof testReport?.suspectedRootCause === "string"
                ? testReport.suspectedRootCause.trim()
                : "";
    return {
        status,
        failedTests,
        reproSteps,
        suspectedRootCause,
        e2eResults,
    };
};

const buildFallbackE2eFailureInvestigationReport = (input: {
    status: string | null;
    failedTests: string[];
    reproSteps: string[];
    suspectedRootCause: string;
    investigationExecution: WorkflowExecutionResult;
}): string => {
    const status = input.status ?? "FAILED";
    const failedTestsSection =
        input.failedTests.length > 0 ? input.failedTests.join("; ") : "not explicitly identified";
    const reproSection =
        input.reproSteps.length > 0 ? input.reproSteps.join("; ") : "not provided";
    const rootCause =
        input.suspectedRootCause.length > 0
            ? input.suspectedRootCause
            : "Root cause not explicitly captured by investigation session.";
    const executionEvidence = truncateForContext(
        [
            input.investigationExecution.summary ?? "",
            input.investigationExecution.error ?? "",
            input.investigationExecution.output ?? "",
        ]
            .filter((entry) => typeof entry === "string" && entry.trim().length > 0)
            .join("\n"),
        E2E_INVESTIGATION_REPORT_LIMIT,
    );
    return truncateForContext(
        [
            "E2E failure investigation report",
            `Status: ${status}`,
            `Failing tests: ${failedTestsSection}`,
            `Repro steps: ${reproSection}`,
            `Likely cause: ${rootCause}`,
            "Investigation evidence:",
            executionEvidence.length > 0 ? executionEvidence : "(no additional evidence returned)",
        ].join("\n"),
        E2E_INVESTIGATION_REPORT_LIMIT,
    );
};

export const runTransitionAction = async (
    input: TransitionActionInput,
): Promise<TransitionActionResult> => {
    const isVirtualTask =
        !input.task.id
        && typeof input.task.title === "string"
        && input.task.title.startsWith("Workflow context");
    const includeTaskContext =
        shouldIncludeTaskContextForTransition(input.transition.transition) && !isVirtualTask;
    const selectedTaskContext = includeTaskContext
        ? buildSelectedTaskContext(input.task, input.tasks, {
            includeDescription: shouldIncludeTaskDescriptionForTransition(input.transition.transition),
        })
        : "";

    const testReportSection =
        isQaFailureTransition(input.transition.transition)
            ? buildTestReportSection(input.tokenContext, input.transition.lastTestResult)
            : null;
    const failurePacketSection =
        isQaFailureTransition(input.transition.transition)
            ? buildFailurePacketSection(input.tokenContext, input.transition.lastTestResult)
            : null;

    let mechanicalTestLintResults =
        typeof input.tokenContext.mechanicalTestLintResults === "string"
            ? input.tokenContext.mechanicalTestLintResults
            : "";
    let mechanicalQaPreflightResults =
        typeof input.tokenContext.mechanicalQaPreflightResults === "string"
            ? input.tokenContext.mechanicalQaPreflightResults
            : "";
    let mechanicalQaPreflightResult: MechanicalQaPreflightResult | null = null;

    if (shouldRunQaPreflightForTransition(input.transition.transition)) {
        try {
            mechanicalQaPreflightResult = await runMechanicalQaPreflight(input.transition.transition);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            mechanicalQaPreflightResult = createFailedMechanicalQaPreflightResult(
                input.transition.transition,
                message,
            );
        }

        const resolvedPreflightResult =
            mechanicalQaPreflightResult
                ?? createFailedMechanicalQaPreflightResult(
                    input.transition.transition,
                    "No preflight result was produced.",
                );
        mechanicalQaPreflightResult = resolvedPreflightResult;
        mechanicalQaPreflightResults = resolvedPreflightResult.output;
        mechanicalTestLintResults = mechanicalQaPreflightResults;
        const isE2eTransition = input.transition.transition === "run-e2e-tests";
        await updateContextData(input.contextClient, input.contextId, {
            testStatus: null,
            testReport: null,
            ...(isE2eTransition
                ? {
                    e2eTestResultStatus: null,
                    "e2e-test-result-status": null,
                    e2eTestResults: null,
                    "e2e-test-results": null,
                    e2eTestFailureInvestigationReport: null,
                    "e2e-test-failure-investigation-report": null,
                }
                : {}),
            mechanicalTestLintResults,
            mechanicalQaPreflightResults,
            mechanicalQaPreflightStage: input.transition.transition,
            mechanicalQaPreflightUpdatedAt: new Date().toISOString(),
            mechanicalTestLintResultsUpdatedAt: new Date().toISOString(),
        });
    }

    const proceduralQaOutcome =
        isProceduralQaTransition(input.transition.transition)
            ? buildProceduralQaOutcome(
                input.transition.transition,
                mechanicalQaPreflightResult
                    ?? createFailedMechanicalQaPreflightResult(
                        input.transition.transition,
                        "No preflight result was produced for procedural transition.",
                    ),
            )
            : null;

    if (proceduralQaOutcome) {
        return {
            execution: proceduralQaOutcome.execution,
            proceduralQaOutcome,
        };
    }

    const baseExecutionContext = {
        contextId: input.contextId,
        currentTaskId: input.transition.currentTaskId,
        lastTestResult: input.transition.lastTestResult,
        prefetchedMcpOutput: input.transition.prefetchedListTasksOutput,
        prefetchedTaskContext: selectedTaskContext,
        prefetchedTestReport: testReportSection,
        prefetchedFailurePacket: failurePacketSection,
        prefetchedMechanicalTestResults:
            mechanicalQaPreflightResults.length > 0
                ? mechanicalQaPreflightResults
                : mechanicalTestLintResults,
    };

    if (input.transition.transition === "e2e-tests-failed") {
        const failureData = readE2eFailureData(input.tokenContext);
        const investigationState = {
            ...input.transition.targetState,
            profile: "qa-e2e-failure-investigation-specialist",
        };
        const investigationExecution = await input.taskExecutor({
            task: input.task,
            workflowState: investigationState,
            workflowTransition: "e2e-failure-investigation",
            environment: input.environment,
            workflowSourceState: input.tokenState,
            workflowTargetState: input.transition.nextStateName,
            executionContext: {
                ...baseExecutionContext,
                e2eTestResultStatus: failureData.status,
                e2eTestResults: failureData.e2eResults,
                e2eFailedTests: failureData.failedTests,
                e2eReproSteps: failureData.reproSteps,
                e2eSuspectedRootCause: failureData.suspectedRootCause,
            },
            isDecider: input.transition.isDecider,
        });
        const latestContextAfterInvestigation = await loadContextData(
            input.contextClient,
            input.contextId,
        );
        const reportFromContext = readE2eFailureReportFromContext(latestContextAfterInvestigation);
        const investigationReport =
            reportFromContext
            ?? buildFallbackE2eFailureInvestigationReport({
                status: failureData.status,
                failedTests: failureData.failedTests,
                reproSteps: failureData.reproSteps,
                suspectedRootCause: failureData.suspectedRootCause,
                investigationExecution,
            });
        await updateContextData(input.contextClient, input.contextId, {
            e2eTestFailureInvestigationReport: investigationReport,
            "e2e-test-failure-investigation-report": investigationReport,
        });

        const remediationState = {
            ...input.transition.targetState,
            profile: "senior-developer",
        };
        const remediationExecution = await input.taskExecutor({
            task: input.task,
            workflowState: remediationState,
            workflowTransition: input.transition.transition,
            environment: input.environment,
            workflowSourceState: input.tokenState,
            workflowTargetState: input.transition.nextStateName,
            executionContext: {
                ...baseExecutionContext,
                e2eTestResultStatus: failureData.status,
                e2eTestResults: failureData.e2eResults,
                e2eFailedTests: failureData.failedTests,
                e2eReproSteps: failureData.reproSteps,
                e2eSuspectedRootCause: failureData.suspectedRootCause,
                e2eTestFailureInvestigationReport: investigationReport,
                "e2e-test-failure-investigation-report": investigationReport,
                prefetchedE2eFailureInvestigationReport: investigationReport,
            },
            isDecider: input.transition.isDecider,
        });

        return {
            execution: remediationExecution,
            proceduralQaOutcome: null,
        };
    }

    const runState = {
        ...input.transition.targetState,
        profile: resolveProfileForTransition(
            input.transition.targetState,
            input.transition.transition,
        ),
    };

    const execution = await input.taskExecutor({
        task: input.task,
        workflowState: runState,
        workflowTransition: input.transition.transition,
        environment: input.environment,
        workflowSourceState: input.tokenState,
        workflowTargetState: input.transition.nextStateName,
        executionContext: baseExecutionContext,
        isDecider: input.transition.isDecider,
    });

    return {
        execution,
        proceduralQaOutcome: null,
    };
};
