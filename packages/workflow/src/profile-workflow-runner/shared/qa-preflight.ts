import { exec as execCallback } from "node:child_process";
import { promisify } from "node:util";
import { truncateForContext } from "./basic-utils.ts";
import { hasPlaywrightConfig, resolveWorkspaceRoot } from "./workspace-utils.ts";
import type { QaRunTransition } from "../transitions/qa-transitions.ts";

const execAsync = promisify(execCallback);

const PRECHECK_OUTPUT_LIMIT = 20_000;
const PRECHECK_STREAM_LIMIT = 8_000;

export type PrecheckCommandResult = {
    label: string;
    command: string;
    ok: boolean;
    exitCode: number | null;
    stdout: string;
    stderr: string;
    stdoutFull: string;
    stderrFull: string;
    errorMessage: string | null;
};

type QaRunStageConfig = {
    label: string;
    command: string;
    timeoutMs: number;
};

const QA_STAGE_CONFIG: Record<QaRunTransition, QaRunStageConfig> = {
    "run-lint": { label: "lint", command: "yarn run lint", timeoutMs: 300_000 },
    "run-typecheck": {
        label: "typecheck",
        command: "yarn run typecheck",
        timeoutMs: 300_000,
    },
    "run-unit-tests": { label: "unit-tests", command: "yarn run test", timeoutMs: 600_000 },
    "run-e2e-tests": { label: "e2e-tests", command: "npx playwright test", timeoutMs: 900_000 },
    "ensure-coverage": {
        label: "coverage",
        command: "yarn run test -- --coverage",
        timeoutMs: 900_000,
    },
};

export type MechanicalQaPreflightResult = {
    transition: QaRunTransition;
    output: string;
    overallStatus: "pass" | "fail";
    results: PrecheckCommandResult[];
};

export const createFailedMechanicalQaPreflightResult = (
    transition: QaRunTransition,
    message: string,
): MechanicalQaPreflightResult => {
    const output = [
        "Mechanical QA preflight failed to execute.",
        `Transition: ${transition}`,
        `Error: ${message}`,
    ].join("\n");
    return {
        transition,
        output,
        overallStatus: "fail",
        results: [],
    };
};

const runPrecheckCommand = async (
    workspaceRoot: string,
    input: { label: string; command: string; timeoutMs: number },
): Promise<PrecheckCommandResult> => {
    try {
        const result = await execAsync(input.command, {
            cwd: workspaceRoot,
            timeout: input.timeoutMs,
            maxBuffer: 10 * 1024 * 1024,
        });
        return {
            label: input.label,
            command: input.command,
            ok: true,
            exitCode: 0,
            stdout: truncateForContext((result.stdout ?? "").toString(), PRECHECK_STREAM_LIMIT),
            stderr: truncateForContext((result.stderr ?? "").toString(), PRECHECK_STREAM_LIMIT),
            stdoutFull: (result.stdout ?? "").toString(),
            stderrFull: (result.stderr ?? "").toString(),
            errorMessage: null,
        };
    } catch (error) {
        const commandError = error as {
            code?: string | number;
            stdout?: string;
            stderr?: string;
            message?: string;
        };
        const exitCode = typeof commandError.code === "number" ? commandError.code : null;
        const errorCodeText = typeof commandError.code === "string" ? commandError.code : undefined;
        return {
            label: input.label,
            command: input.command,
            ok: false,
            exitCode,
            stdout: truncateForContext(commandError.stdout ?? "", PRECHECK_STREAM_LIMIT),
            stderr: truncateForContext(commandError.stderr ?? "", PRECHECK_STREAM_LIMIT),
            stdoutFull: commandError.stdout ?? "",
            stderrFull: commandError.stderr ?? "",
            errorMessage:
                commandError.message
                ?? errorCodeText
                ?? (exitCode !== null ? `Exit code ${String(exitCode)}` : String(error)),
        };
    }
};

export const runMechanicalQaPreflight = async (
    transition: QaRunTransition,
): Promise<MechanicalQaPreflightResult> => {
    const workspaceRoot = resolveWorkspaceRoot();
    const timestamp = new Date().toISOString();
    const isE2eTransition = transition === "run-e2e-tests";
    if (isE2eTransition && !hasPlaywrightConfig(workspaceRoot)) {
        return {
            transition,
            overallStatus: "pass",
            results: [],
            output: [
                "Mechanical QA preflight executed by workflow runner before agent session.",
                `Timestamp: ${timestamp}`,
                `Workspace: ${workspaceRoot}`,
                `Transition: ${transition}`,
                "Overall status: pass (e2e preflight skipped: no playwright config found)",
                "",
                "[e2e-tests] command: npx playwright test",
                "[e2e-tests] status: skipped",
                "[e2e-tests] note: no playwright.config.ts/js/mjs in workspace root",
            ].join("\n"),
        };
    }

    const commands = [QA_STAGE_CONFIG[transition]];
    const results: PrecheckCommandResult[] = [];
    for (const command of commands) {
        results.push(await runPrecheckCommand(workspaceRoot, command));
    }

    const summaryStatus: "pass" | "fail" = results.every((result) => result.ok) ? "pass" : "fail";
    const compactStatuses = results.map((result) => `${result.label}=${result.ok ? "pass" : "fail"}`).join(", ");
    const lines = [
        "Mechanical QA preflight executed by workflow runner before agent session.",
        `Timestamp: ${timestamp}`,
        `Workspace: ${workspaceRoot}`,
        `Transition: ${transition}`,
        `Overall status: ${summaryStatus}${compactStatuses.length > 0 ? ` (${compactStatuses})` : ""}`,
        "",
        ...results.flatMap((result) => [
            `[${result.label}] command: ${result.command}`,
            `[${result.label}] status: ${result.ok ? "pass" : "fail"}`,
            `[${result.label}] exitCode: ${result.exitCode === null ? "n/a" : String(result.exitCode)}`,
            ...(result.errorMessage ? [`[${result.label}] error: ${result.errorMessage}`] : []),
            `[${result.label}] stdout:`,
            result.stdout.length > 0 ? result.stdout : "(empty)",
            `[${result.label}] stderr:`,
            result.stderr.length > 0 ? result.stderr : "(empty)",
            "",
        ]),
    ];

    return {
        transition,
        overallStatus: summaryStatus,
        results,
        output: truncateForContext(lines.join("\n"), PRECHECK_OUTPUT_LIMIT),
    };
};
