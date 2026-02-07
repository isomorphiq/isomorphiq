import { randomUUID } from "node:crypto";
import type { TaskActionLog } from "@isomorphiq/types";
import type { WorkflowExecutionResult } from "../../agent-runner.ts";
import { truncateForContext } from "./basic-utils.ts";
import type { MechanicalQaPreflightResult, PrecheckCommandResult } from "./qa-preflight.ts";
import type { ProceduralQaTransition } from "../transitions/qa-transitions.ts";

const PRECHECK_STREAM_LIMIT = 8_000;
const PLAYWRIGHT_FAILURE_LIMIT = 24;

const PROCEDURAL_QA_ACTIVITY_LOG_TEMPLATES: Record<
    ProceduralQaTransition,
    { passed: string; failed: string }
> = {
    "run-lint": {
        passed: "lint passed",
        failed: "lint failed",
    },
    "run-typecheck": {
        passed: "typecheck passed",
        failed: "typecheck failed",
    },
    "run-unit-tests": {
        passed: "unit tests passed",
        failed: "unit tests failed",
    },
    "run-e2e-tests": {
        passed: "e2e tests passed",
        failed: "e2e tests failed",
    },
    "ensure-coverage": {
        passed: "coverage passed",
        failed: "coverage failed",
    },
};

const PROCEDURAL_QA_STAGE_CONFIG: Record<
    ProceduralQaTransition,
    { label: string; command: string }
> = {
    "run-lint": { label: "lint", command: "yarn run lint" },
    "run-typecheck": { label: "typecheck", command: "yarn run typecheck" },
    "run-unit-tests": { label: "unit-tests", command: "yarn run test" },
    "run-e2e-tests": { label: "e2e-tests", command: "npx playwright test" },
    "ensure-coverage": { label: "coverage", command: "yarn run test -- --coverage" },
};

export type ProceduralQaOutcome = {
    execution: WorkflowExecutionResult;
    patch: Record<string, unknown>;
    qaReport: ProceduralQaReport;
};

export type ProceduralQaCommandResult = {
    label: string;
    command: string;
    status: "PASS" | "FAIL";
    exitCode: number | null;
    errorMessage: string | null;
    stdout: string;
    stderr: string;
};

export type ProceduralQaTestReport = {
    failedTests: string[];
    reproSteps: string[];
    suspectedRootCause: string;
    notes: string;
};

export type ProceduralQaReport = {
    transition: ProceduralQaTransition;
    stage: string;
    status: "passed" | "failed";
    summary: string;
    output: string;
    testReport: ProceduralQaTestReport;
    commandResults: ProceduralQaCommandResult[];
    coverageReport?: {
        output: string;
        commandResults: ProceduralQaCommandResult[];
    };
};

const normalizeWhitespace = (value: string): string =>
    value.replace(/\s+/g, " ").trim();

const uniqueStrings = (values: string[]): string[] =>
    values.reduce<string[]>(
        (acc, value) => (acc.includes(value) ? acc : [...acc, value]),
        [],
    );

const extractPlaywrightFailedTests = (results: PrecheckCommandResult[]): string[] => {
    const mergedOutput = results
        .flatMap((result) => [result.stdout ?? "", result.stderr ?? ""])
        .join("\n");
    if (mergedOutput.trim().length === 0) {
        return [];
    }
    const lines = mergedOutput
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    const numberedFailures = lines
        .filter((line) => /^\d+\)\s+/.test(line))
        .map((line) => normalizeWhitespace(line.replace(/^\d+\)\s+/, "")));
    const classicFailures = lines
        .filter((line) => /^fail(?:ed)?\b/i.test(line))
        .map((line) => normalizeWhitespace(line));
    const playwrightArrowLines = lines
        .filter((line) => line.includes("]") && (line.includes(">") || line.includes("\u203a")))
        .map((line) => normalizeWhitespace(line));
    return uniqueStrings([...numberedFailures, ...classicFailures, ...playwrightArrowLines]).slice(
        0,
        PLAYWRIGHT_FAILURE_LIMIT,
    );
};

export const createProceduralQaActivityLogEntry = (
    transition: ProceduralQaTransition,
    success: boolean,
    durationMs: number,
    qaReport: ProceduralQaReport,
): TaskActionLog => {
    const template = PROCEDURAL_QA_ACTIVITY_LOG_TEMPLATES[transition];
    const safeDurationMs =
        Number.isFinite(durationMs) && durationMs >= 0 ? Math.round(durationMs) : 0;
    return {
        id: randomUUID(),
        summary: success ? template.passed : template.failed,
        profile: "workflow-procedural",
        durationMs: safeDurationMs,
        createdAt: new Date(),
        success,
        transition,
        modelName: "procedural",
        qaReport,
        testReport: qaReport.testReport,
        ...(qaReport.coverageReport ? { coverageReport: qaReport.coverageReport } : {}),
    };
};

export const buildProceduralQaOutcome = (
    transition: ProceduralQaTransition,
    preflight: MechanicalQaPreflightResult,
): ProceduralQaOutcome => {
    const stage = PROCEDURAL_QA_STAGE_CONFIG[transition];
    const status = preflight.overallStatus === "pass" ? "passed" : "failed";
    const failedResults = preflight.results.filter((result) => !result.ok);
    const failedTests = failedResults.map((result) => {
        const base = `${result.label}: ${result.command}`;
        if (result.errorMessage && result.errorMessage.trim().length > 0) {
            return `${base} (${result.errorMessage.trim()})`;
        }
        if (result.exitCode !== null) {
            return `${base} (exitCode=${String(result.exitCode)})`;
        }
        return base;
    });

    const fallbackFailure =
        status === "failed" && failedTests.length === 0
            ? [`${stage.label}: procedural check failed`]
            : [];
    const allFailures = [...failedTests, ...fallbackFailure];
    const suspectedRootCause =
        allFailures.length > 0 ? allFailures[0] : `${stage.label} completed without errors`;
    const reportNotes = truncateForContext(preflight.output, PRECHECK_STREAM_LIMIT);
    const summary =
        status === "passed"
            ? `Procedural ${stage.label} check passed.`
            : `Procedural ${stage.label} check failed.`;
    const statusUpper = status === "passed" ? "PASSED" : "FAILED";
    const isE2eTransition = transition === "run-e2e-tests";
    const e2eFailedTests = isE2eTransition ? extractPlaywrightFailedTests(preflight.results) : [];
    const mergedFailedTests = uniqueStrings([...allFailures, ...e2eFailedTests]);
    const reproSteps = uniqueStrings([
        stage.command,
        ...preflight.results.map((result) => result.command).filter((value) => value.trim().length > 0),
    ]);
    const commandResultsForContext: ProceduralQaCommandResult[] = preflight.results.map((result) => ({
        label: result.label,
        command: result.command,
        status: result.ok ? "PASS" : "FAIL",
        exitCode: result.exitCode,
        errorMessage: result.errorMessage,
        stdout:
            typeof result.stdout === "string" && result.stdout.length > 0
                ? truncateForContext(result.stdout, PRECHECK_STREAM_LIMIT)
                : "",
        stderr:
            typeof result.stderr === "string" && result.stderr.length > 0
                ? truncateForContext(result.stderr, PRECHECK_STREAM_LIMIT)
                : "",
    }));
    const commandResults: ProceduralQaCommandResult[] = preflight.results.map((result) => ({
        label: result.label,
        command: result.command,
        status: result.ok ? "PASS" : "FAIL",
        exitCode: result.exitCode,
        errorMessage: result.errorMessage,
        stdout:
            typeof result.stdoutFull === "string" && result.stdoutFull.length > 0
                ? result.stdoutFull
                : result.stdout,
        stderr:
            typeof result.stderrFull === "string" && result.stderrFull.length > 0
                ? result.stderrFull
                : result.stderr,
    }));
    const fullQaOutput = commandResults
        .flatMap((result) => [
            `[${result.label}] command: ${result.command}`,
            `[${result.label}] status: ${result.status}`,
            `[${result.label}] exitCode: ${result.exitCode === null ? "n/a" : String(result.exitCode)}`,
            ...(result.errorMessage ? [`[${result.label}] error: ${result.errorMessage}`] : []),
            `[${result.label}] stdout:`,
            result.stdout.length > 0 ? result.stdout : "(empty)",
            `[${result.label}] stderr:`,
            result.stderr.length > 0 ? result.stderr : "(empty)",
            "",
        ])
        .join("\n")
        .trim();
    const qaOutput = fullQaOutput.length > 0 ? fullQaOutput : preflight.output;
    const testReport: ProceduralQaTestReport = {
        failedTests: mergedFailedTests,
        reproSteps,
        suspectedRootCause,
        notes: reportNotes,
    };
    const qaReport: ProceduralQaReport = {
        transition,
        stage: stage.label,
        status,
        summary,
        output: qaOutput,
        testReport,
        commandResults,
        ...(transition === "ensure-coverage"
            ? {
                coverageReport: {
                    output: qaOutput,
                    commandResults,
                },
            }
            : {}),
    };
    const e2ePatch = isE2eTransition
        ? {
            e2eTestResultStatus: statusUpper,
            "e2e-test-result-status": statusUpper,
            e2eTestResults: {
                status: statusUpper,
                failedTests: mergedFailedTests,
                reproSteps,
                suspectedRootCause,
                notes: reportNotes,
                commandResults: commandResultsForContext,
            },
            "e2e-test-results": {
                status: statusUpper,
                failedTests: mergedFailedTests,
                reproSteps,
                suspectedRootCause,
                notes: reportNotes,
                commandResults: commandResultsForContext,
            },
        }
        : {};

    return {
        execution: {
            success: status === "passed",
            output: preflight.output,
            error: status === "failed" ? reportNotes : "",
            profileName: "workflow-procedural",
            summary,
            modelName: "procedural",
        },
        patch: {
            testStatus: status,
            testReport,
            ...e2ePatch,
        },
        qaReport,
    };
};
