import { createToken, type WorkflowToken } from "./workflow-engine.ts";
import type { RuntimeState, WorkflowStateName } from "./workflow-factory.ts";
import { getNextStateFrom, WORKFLOW } from "./workflow.ts";
import { isWorkflowTaskActionable, isWorkflowTaskTextComplete } from "./task-readiness.ts";
import type {
    WorkflowExecutionResult,
    WorkflowTask,
    WorkflowTaskExecutor,
} from "./agent-runner.ts";
import { createContextClient, type ContextClient } from "@isomorphiq/context";
import type { TaskActionLog, TaskStatus } from "@isomorphiq/types";
import { exec as execCallback } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

export type ProfileWorkflowRunnerOptions = {
    taskProvider: () => Promise<WorkflowTask[]>;
    taskExecutor: WorkflowTaskExecutor;
    initialState?: WorkflowStateName;
    environment?: string;
    pollIntervalMs?: number;
    contextId?: string;
    updateTaskStatus?: (id: string, status: TaskStatus, updatedBy?: string) => Promise<void>;
    appendTaskActionLogEntry?: (
        taskId: string,
        entry: TaskActionLog,
        fallbackLog?: TaskActionLog[],
    ) => Promise<void>;
    workerId?: string;
    claimTask?: (taskId: string) => Promise<WorkflowTask | null>;
};

type WorkflowContextToken = {
    contextId: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value);

const normalizeContextData = (value: unknown): Record<string, unknown> =>
    isRecord(value) ? value : {};

const sleep = (durationMs: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, durationMs));

const execAsync = promisify(execCallback);

const PRECHECK_OUTPUT_LIMIT = 20_000;
const PRECHECK_STREAM_LIMIT = 8_000;

const truncateForContext = (value: string, limit: number): string => {
    if (value.length <= limit) {
        return value;
    }
    const omitted = value.length - limit;
    return `${value.slice(0, limit)}\n...[truncated ${omitted} chars]`;
};

const hasWorkspaceMarkers = (candidateDir: string): boolean => {
    const hasMcpConfig = existsSync(
        path.join(candidateDir, "packages", "mcp", "config", "mcp-server-config.json"),
    );
    if (hasMcpConfig) {
        return true;
    }
    const hasPrompts = existsSync(path.join(candidateDir, "prompts"));
    const hasPackageJson = existsSync(path.join(candidateDir, "package.json"));
    return hasPrompts && hasPackageJson;
};

const findWorkspaceRoot = (startDir: string): string => {
    let currentDir = path.resolve(startDir);
    while (true) {
        if (hasWorkspaceMarkers(currentDir)) {
            return currentDir;
        }
        const parentDir = path.dirname(currentDir);
        if (parentDir === currentDir) {
            return path.resolve(startDir);
        }
        currentDir = parentDir;
    }
};

const resolveWorkspaceRoot = (): string => {
    const candidates = [
        process.env.INIT_CWD,
        process.cwd(),
    ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
    const resolvedCandidates = candidates.map((value) => path.resolve(value.trim()));
    const uniqueCandidates = resolvedCandidates.reduce<string[]>(
        (acc, candidate) => (acc.includes(candidate) ? acc : [...acc, candidate]),
        [],
    );
    for (const candidate of uniqueCandidates) {
        const resolved = findWorkspaceRoot(candidate);
        if (hasWorkspaceMarkers(resolved)) {
            return resolved;
        }
    }
    return uniqueCandidates[0] ?? process.cwd();
};

type PrecheckCommandResult = {
    label: string;
    command: string;
    ok: boolean;
    exitCode: number | null;
    stdout: string;
    stderr: string;
    errorMessage: string | null;
};

type QaRunTransition =
    | "run-lint"
    | "run-typecheck"
    | "run-unit-tests"
    | "run-e2e-tests"
    | "ensure-coverage";

type ProceduralQaTransition = "run-lint" | "run-typecheck";

const QA_RUN_TRANSITIONS: QaRunTransition[] = [
    "run-lint",
    "run-typecheck",
    "run-unit-tests",
    "run-e2e-tests",
    "ensure-coverage",
];

const PROCEDURAL_QA_TRANSITIONS: ProceduralQaTransition[] = ["run-lint", "run-typecheck"];

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
};

const isProceduralQaTransition = (transition: string): transition is ProceduralQaTransition =>
    PROCEDURAL_QA_TRANSITIONS.includes(transition as ProceduralQaTransition);

const QA_FAIL_TRANSITIONS = [
    "lint-failed",
    "typecheck-failed",
    "unit-tests-failed",
    "e2e-tests-failed",
    "coverage-failed",
] as const;

const QA_TRACKED_TRANSITIONS = [
    "begin-implementation",
    ...QA_RUN_TRANSITIONS,
    ...QA_FAIL_TRANSITIONS,
    "tests-passing",
] as const;

const shouldRunQaPreflightForTransition = (transition: string): transition is QaRunTransition =>
    QA_RUN_TRANSITIONS.includes(transition as QaRunTransition);

const isQaRunTransition = (transition: string): transition is QaRunTransition =>
    QA_RUN_TRANSITIONS.includes(transition as QaRunTransition);

const isQaFailureTransition = (transition: string): boolean =>
    QA_FAIL_TRANSITIONS.includes(transition as (typeof QA_FAIL_TRANSITIONS)[number]);

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

type MechanicalQaPreflightResult = {
    transition: QaRunTransition;
    output: string;
    overallStatus: "pass" | "fail";
    results: PrecheckCommandResult[];
};

const createFailedMechanicalQaPreflightResult = (
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

type ProceduralQaOutcome = {
    execution: WorkflowExecutionResult;
    patch: Record<string, unknown>;
};

const createProceduralQaActivityLogEntry = (
    transition: ProceduralQaTransition,
    success: boolean,
    durationMs: number,
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
    };
};

const buildProceduralQaOutcome = (
    transition: ProceduralQaTransition,
    preflight: MechanicalQaPreflightResult,
): ProceduralQaOutcome => {
    const stage = QA_STAGE_CONFIG[transition];
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
        allFailures.length > 0
            ? allFailures[0]
            : `${stage.label} completed without errors`;
    const reportNotes = truncateForContext(preflight.output, PRECHECK_STREAM_LIMIT);
    const summary =
        status === "passed"
            ? `Procedural ${stage.label} check passed.`
            : `Procedural ${stage.label} check failed.`;
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
            testReport: {
                failedTests: allFailures,
                reproSteps: [stage.command],
                suspectedRootCause,
                notes: reportNotes,
            },
        },
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
        const errorCodeText =
            typeof commandError.code === "string" ? commandError.code : undefined;
        return {
            label: input.label,
            command: input.command,
            ok: false,
            exitCode,
            stdout: truncateForContext(commandError.stdout ?? "", PRECHECK_STREAM_LIMIT),
            stderr: truncateForContext(commandError.stderr ?? "", PRECHECK_STREAM_LIMIT),
            errorMessage:
                commandError.message
                ?? errorCodeText
                ?? (exitCode !== null ? `Exit code ${String(exitCode)}` : String(error)),
        };
    }
};

const runMechanicalQaPreflight = async (
    transition: QaRunTransition,
): Promise<MechanicalQaPreflightResult> => {
    const workspaceRoot = resolveWorkspaceRoot();
    const timestamp = new Date().toISOString();
    const e2eTransition = transition === "run-e2e-tests";
    if (e2eTransition) {
        const hasPlaywrightConfig =
            existsSync(path.join(workspaceRoot, "playwright.config.ts"))
            || existsSync(path.join(workspaceRoot, "playwright.config.js"))
            || existsSync(path.join(workspaceRoot, "playwright.config.mjs"));
        if (!hasPlaywrightConfig) {
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
    }
    const commands = [QA_STAGE_CONFIG[transition]];
    const results: PrecheckCommandResult[] = [];
    for (const command of commands) {
        results.push(await runPrecheckCommand(workspaceRoot, command));
    }
    const summaryStatus: "pass" | "fail" = results.every((result) => result.ok) ? "pass" : "fail";
    const compactStatuses = results
        .map((result) => `${result.label}=${result.ok ? "pass" : "fail"}`)
        .join(", ");
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

const normalizeTaskType = (value: string | undefined): string => (value ?? "").trim().toLowerCase();
const normalizeTaskStatus = (value: string | undefined): string =>
    (value ?? "").trim().toLowerCase().replace(/[_\s]+/g, "-");

const isActiveStatus = (value: string | undefined): boolean => {
    const status = normalizeTaskStatus(value);
    return status === "todo" || status === "in-progress";
};

const isImplementationTaskType = (value: string | undefined): boolean => {
    const type = normalizeTaskType(value);
    return type === "implementation" || type === "task";
};

const isTestingTaskType = (value: string | undefined): boolean => {
    const type = normalizeTaskType(value);
    return type === "testing" || type === "integration";
};

const priorityScore = (priority: string | undefined): number => {
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

const parseTestStatusLine = (value: string): "passed" | "failed" | null => {
    const match = value.match(/test status\s*:\s*(passed|failed)/i);
    if (!match) {
        return null;
    }
    return match[1].toLowerCase() === "passed" ? "passed" : "failed";
};

const normalizeTextLines = (value: string): string[] =>
    value
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

const extractInlineList = (lines: string[], label: string): string[] => {
    const prefix = label.toLowerCase();
    const line = lines.find((entry) => entry.toLowerCase().startsWith(prefix));
    if (!line) {
        return [];
    }
    const remainder = line.slice(label.length).replace(/^:\s*/, "").trim();
    if (remainder.length === 0) {
        return [];
    }
    return remainder
        .split(/,|\s*\|\s*|\s*;\s*/)
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
};

const extractListAfterLabel = (lines: string[], label: string): string[] => {
    const prefix = label.toLowerCase();
    const index = lines.findIndex((entry) => entry.toLowerCase().startsWith(prefix));
    if (index < 0) {
        return [];
    }
    const items = lines
        .slice(index + 1)
        .filter((entry) => entry.startsWith("-"))
        .map((entry) => entry.replace(/^-+\s*/, "").trim())
        .filter((entry) => entry.length > 0);
    return items;
};

const extractInlineValue = (lines: string[], label: string): string => {
    const prefix = label.toLowerCase();
    const line = lines.find((entry) => entry.toLowerCase().startsWith(prefix));
    if (!line) {
        return "";
    }
    return line.slice(label.length).replace(/^:\s*/, "").trim();
};

const inferTestReportFromExecution = (
    execution: { summary?: string; output?: string; error?: string } | null | undefined,
): { testStatus?: "passed" | "failed"; testReport?: Record<string, unknown> } => {
    const combined = [execution?.summary, execution?.output, execution?.error]
        .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
        .join("\n");
    if (combined.length === 0) {
        return {};
    }
    const status = parseTestStatusLine(combined);
    const lines = normalizeTextLines(combined);
    const failedTests = [
        ...extractInlineList(lines, "Failed tests"),
        ...extractListAfterLabel(lines, "Failed tests"),
    ].filter((value, index, list) => list.indexOf(value) === index);
    const reproSteps = [
        ...extractInlineList(lines, "Repro steps"),
        ...extractListAfterLabel(lines, "Repro steps"),
        ...extractInlineList(lines, "Repro commands"),
        ...extractListAfterLabel(lines, "Repro commands"),
    ].filter((value, index, list) => list.indexOf(value) === index);
    const suspectedRootCause =
        extractInlineValue(lines, "Suspected root cause")
        || extractInlineValue(lines, "Root cause");
    const notes = extractInlineValue(lines, "Notes");
    const hasReport =
        failedTests.length > 0
        || reproSteps.length > 0
        || suspectedRootCause.length > 0
        || notes.length > 0;
    return {
        ...(status ? { testStatus: status } : {}),
        ...(hasReport
            ? {
                testReport: {
                    failedTests,
                    reproSteps,
                    suspectedRootCause,
                    notes,
                },
            }
            : {}),
    };
};

const dependenciesSatisfied = (task: WorkflowTask, tasks: WorkflowTask[]): boolean => {
    const deps = task.dependencies ?? [];
    if (deps.length === 0) {
        return true;
    }
    return deps.every((depId) => {
        const depTask = tasks.find((candidate) => candidate.id === depId);
        return !depTask || depTask.status === "done" || depTask.status === "invalid";
    });
};

const isRunnableImplementationTask = (
    task: WorkflowTask,
    tasks: WorkflowTask[],
): boolean =>
    isImplementationTaskType(task.type)
    && isWorkflowTaskActionable(task)
    && dependenciesSatisfied(task, tasks);

const hasRunnableImplementationTasks = (tasks: WorkflowTask[]): boolean =>
    tasks.some(
        (task) =>
            normalizeTaskStatus(task.status) === "in-progress"
            || isRunnableImplementationTask(task, tasks),
    );

const formatTaskLine = (task: WorkflowTask): string => {
    const id = task.id ?? "unknown";
    const title = (task.title ?? "Untitled").trim();
    const type = normalizeTaskType(task.type) || "unknown";
    const status = normalizeTaskStatus(task.status) || "unknown";
    const priority = (task.priority ?? "unspecified").toLowerCase();
    const dependencies = task.dependencies ?? [];
    const depsCount = Array.isArray(dependencies) ? dependencies.length : 0;
    return `- ${id} | ${title} | ${type} | ${status} | ${priority} | deps=${depsCount}`;
};

const summarizeTaskList = (
    tasks: WorkflowTask[],
    limit: number,
): { lines: string[]; truncated: boolean } => {
    const clipped = tasks.slice(0, Math.max(limit, 0));
    return {
        lines: clipped.map((task) => formatTaskLine(task)),
        truncated: tasks.length > clipped.length,
    };
};

const buildPrefetchedListTasksOutput = (
    transition: string,
    tasks: WorkflowTask[],
): string | null => {
    const normalizedTransition = transition.trim().toLowerCase();
    const baseOutput = (filtered: WorkflowTask[]): string => {
        const { lines, truncated } = summarizeTaskList(filtered, 25);
        const header = `Found ${filtered.length} tasks${truncated ? ` (showing first ${lines.length})` : ""}:`;
        const truncationNote = truncated
            ? "Note: list truncated; call list_tasks for the full set if needed."
            : "";
        return [header, ...lines, truncationNote].filter((line) => line.length > 0).join("\n");
    };

    if (normalizedTransition === "prioritize-features") {
        const filtered = tasks.filter(
            (task) =>
                normalizeTaskType(task.type) === "feature" && isActiveStatus(task.status),
        );
        const filters = { type: "feature", status: ["todo", "in-progress"] };
        return `Prefetched list_tasks output (filters ${JSON.stringify(filters)}):\n${baseOutput(filtered)}`;
    }
    if (normalizedTransition === "prioritize-themes") {
        const filtered = tasks.filter(
            (task) =>
                normalizeTaskType(task.type) === "theme" && isActiveStatus(task.status),
        );
        const filters = { type: "theme", status: ["todo", "in-progress"] };
        return `Prefetched list_tasks output (filters ${JSON.stringify(filters)}):\n${baseOutput(filtered)}`;
    }
    if (normalizedTransition === "prioritize-initiatives") {
        const filtered = tasks.filter(
            (task) =>
                normalizeTaskType(task.type) === "initiative" && isActiveStatus(task.status),
        );
        const filters = { type: "initiative", status: ["todo", "in-progress"] };
        return `Prefetched list_tasks output (filters ${JSON.stringify(filters)}):\n${baseOutput(filtered)}`;
    }
    if (normalizedTransition === "prioritize-stories") {
        const filtered = tasks.filter(
            (task) =>
                normalizeTaskType(task.type) === "story" && isActiveStatus(task.status),
        );
        const filters = { type: "story", status: ["todo", "in-progress"] };
        return `Prefetched list_tasks output (filters ${JSON.stringify(filters)}):\n${baseOutput(filtered)}`;
    }
    if (normalizedTransition === "refine-into-tasks" || normalizedTransition === "need-more-tasks") {
        return `Prefetched list_tasks output (no filters):\n${baseOutput(tasks)}`;
    }
    return null;
};

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

const appendSection = (lines: string[], label: string, items: string[]): string[] => {
    if (items.length === 0) {
        return lines;
    }
    return [...lines, `${label}:`, ...items.map((item) => `- ${item}`)];
};

const buildTestReportSection = (
    context: Record<string, unknown>,
    lastTestResult: unknown,
): string | null => {
    const rawStatus = typeof context.testStatus === "string" ? context.testStatus.trim() : "";
    const report =
        context.testReport && typeof context.testReport === "object"
            ? (context.testReport as Record<string, unknown>)
            : null;
    const failedTests = normalizeStringArray(report?.failedTests);
    const reproSteps = normalizeStringArray(report?.reproSteps);
    const suspectedRootCause =
        typeof report?.suspectedRootCause === "string" ? report.suspectedRootCause.trim() : "";
    const notes = typeof report?.notes === "string" ? report.notes.trim() : "";

    const lastResultRecord =
        lastTestResult && typeof lastTestResult === "object"
            ? (lastTestResult as Record<string, unknown>)
            : null;
    const lastSummary =
        typeof lastResultRecord?.summary === "string" ? lastResultRecord.summary.trim() : "";
    const lastError =
        typeof lastResultRecord?.error === "string" ? lastResultRecord.error.trim() : "";
    const lastOutput =
        typeof lastResultRecord?.output === "string" ? lastResultRecord.output.trim() : "";

    let lines: string[] = [];
    if (rawStatus.length > 0) {
        lines = [...lines, `Test status: ${rawStatus}`];
    }
    lines = appendSection(lines, "Failed tests", failedTests);
    lines = appendSection(lines, "Repro steps", reproSteps);
    if (suspectedRootCause.length > 0) {
        lines = [...lines, `Suspected root cause: ${suspectedRootCause}`];
    }
    if (notes.length > 0) {
        lines = [...lines, `Notes: ${notes}`];
    }
    if (lastSummary.length > 0) {
        lines = [...lines, `Last test summary: ${lastSummary}`];
    }
    if (lastError.length > 0) {
        lines = [...lines, `Last test error: ${lastError}`];
    }
    if (lastOutput.length > 0) {
        lines = [...lines, `Last test output:\n${lastOutput}`];
    }
    if (lines.length === 0 && (lastSummary.length > 0 || lastError.length > 0 || lastOutput.length > 0)) {
        const outputLines =
            lastSummary.length > 0
                ? [`Last test summary: ${lastSummary}`]
                : [];
        const errorLines = lastError.length > 0 ? [`Last test error: ${lastError}`] : [];
        const outputBlock = lastOutput.length > 0 ? [`Last test output:\n${lastOutput}`] : [];
        lines = [...outputLines, ...errorLines, ...outputBlock];
    }

    return lines.length > 0 ? lines.join("\n") : null;
};

const buildDependencyStatusLines = (
    dependencies: string[],
    taskMap: Map<string, WorkflowTask>,
): string[] =>
    dependencies.map((dependencyId) => {
        const dependency = taskMap.get(dependencyId);
        const status = normalizeTaskStatus(dependency?.status) || "unknown";
        const title = dependency?.title ? ` (${dependency.title.trim()})` : "";
        return `- ${dependencyId}: ${status}${title}`;
    });

const extractLastActionSummary = (task: WorkflowTask): string | null => {
    const entries = task.actionLog ?? [];
    if (!Array.isArray(entries) || entries.length === 0) {
        return null;
    }
    const last = entries[entries.length - 1];
    const summary = last?.summary?.trim() ?? "";
    const transition = last?.transition?.trim() ?? "";
    if (summary.length === 0 && transition.length === 0) {
        return null;
    }
    return transition.length > 0 && summary.length > 0
        ? `${transition}: ${summary}`
        : transition.length > 0
            ? transition
            : summary;
};

const buildSelectedTaskContext = (
    task: WorkflowTask,
    tasks: WorkflowTask[],
    options?: { includeDescription?: boolean },
): string => {
    const hasId = (entry: WorkflowTask): entry is WorkflowTask & { id: string } =>
        typeof entry.id === "string" && entry.id.length > 0;
    const taskId = task.id ?? "unknown";
    const taskTitle = (task.title ?? "Untitled").trim();
    const descriptionRaw = (task.description ?? "").trim();
    const description = descriptionRaw.length > 0
        ? descriptionRaw.length > 600
            ? `${descriptionRaw.slice(0, 597)}...`
            : descriptionRaw
        : "";
    const taskType = normalizeTaskType(task.type) || "unknown";
    const taskStatus = normalizeTaskStatus(task.status) || "unknown";
    const taskPriority = (task.priority ?? "unspecified").toLowerCase();
    const dependencies = task.dependencies ?? [];
    const dependencyList = Array.isArray(dependencies) ? dependencies : [];
    const taskMap = new Map(
        tasks.filter(hasId).map((entry) => [entry.id, entry]),
    );
    const dependencyLines = dependencyList.length > 0
        ? ["Dependencies:", ...buildDependencyStatusLines(dependencyList, taskMap)]
        : ["Dependencies: none"];
    const lastAction = extractLastActionSummary(task);
    const lastActionLine = lastAction ? [`Last action: ${lastAction}`] : [];
    const descriptionLines =
        options?.includeDescription && description.length > 0
            ? [`Description: ${description}`]
            : [];
    return [
        `ID: ${taskId}`,
        `Title: ${taskTitle}`,
        `Type: ${taskType}`,
        `Status: ${taskStatus}`,
        `Priority: ${taskPriority}`,
        ...descriptionLines,
        ...dependencyLines,
        ...lastActionLine,
    ].join("\n");
};

const TRANSITIONS_NEEDING_CONTEXT = new Set([
    "define-initiatives",
    "retry-initiative-research",
    "retry-product-research",
    "research-new-features",
    "do-ux-research",
    "refine-into-tasks",
    "need-more-tasks",
    "begin-implementation",
    "close-invalid-task",
    "run-lint",
    "run-typecheck",
    "run-unit-tests",
    "run-e2e-tests",
    "ensure-coverage",
    "lint-failed",
    "typecheck-failed",
    "unit-tests-failed",
    "e2e-tests-failed",
    "coverage-failed",
    "tests-passing",
]);

const TRANSITIONS_NEEDING_DESCRIPTION = new Set([
    "define-initiatives",
    "retry-initiative-research",
    "retry-product-research",
    "research-new-features",
    "do-ux-research",
    "refine-into-tasks",
    "need-more-tasks",
    "begin-implementation",
    "close-invalid-task",
    "run-lint",
    "run-typecheck",
    "run-unit-tests",
    "run-e2e-tests",
    "ensure-coverage",
    "lint-failed",
    "typecheck-failed",
    "unit-tests-failed",
    "e2e-tests-failed",
    "coverage-failed",
    "tests-passing",
]);

const selectInvalidTaskForClosure = (tasks: WorkflowTask[]): WorkflowTask | null => {
    const candidates = tasks.filter(
        (task) => isImplementationTaskType(task.type) && task.status === "todo",
    );
    if (candidates.length === 0) {
        return null;
    }
    const invalid = candidates.filter((task) => !isWorkflowTaskTextComplete(task));
    if (invalid.length === 0) {
        return null;
    }
    const sorted = [...invalid].sort((left, right) => {
        const leftScore = priorityScore(left.priority);
        const rightScore = priorityScore(right.priority);
        if (leftScore !== rightScore) {
            return rightScore - leftScore;
        }
        const leftTitle = left.title ?? "";
        const rightTitle = right.title ?? "";
        return leftTitle.localeCompare(rightTitle);
    });
    return sorted[0] ?? null;
};

const selectInProgressImplementationTask = (tasks: WorkflowTask[]): WorkflowTask | null => {
    const candidates = tasks.filter(
        (task) => isImplementationTaskType(task.type) && task.status === "in-progress",
    );
    if (candidates.length === 0) {
        return null;
    }
    const sorted = [...candidates].sort((left, right) => {
        const leftScore = priorityScore(left.priority);
        const rightScore = priorityScore(right.priority);
        if (leftScore !== rightScore) {
            return rightScore - leftScore;
        }
        const leftTitle = left.title ?? "";
        const rightTitle = right.title ?? "";
        return leftTitle.localeCompare(rightTitle);
    });
    return sorted[0] ?? null;
};

const deriveStateFromTasks = (
    tasks: WorkflowTask[],
): { state: WorkflowStateName; currentTaskId?: string } | null => {
    const inProgress = selectInProgressImplementationTask(tasks);
    if (inProgress?.id) {
        return { state: "task-in-progress", currentTaskId: inProgress.id };
    }
    const actionableImplementation = tasks.some(
        (task) =>
            isImplementationTaskType(task.type)
            && task.status === "todo"
            && dependenciesSatisfied(task, tasks),
    );
    if (actionableImplementation) {
        return { state: "tasks-prepared" };
    }
    const hasStories = tasks.some(
        (task) => normalizeTaskType(task.type) === "story" && isActiveStatus(task.status),
    );
    if (hasStories) {
        return { state: "stories-prioritized" };
    }
    const hasFeatures = tasks.some(
        (task) => normalizeTaskType(task.type) === "feature" && isActiveStatus(task.status),
    );
    if (hasFeatures) {
        return { state: "features-prioritized" };
    }
    const hasInitiatives = tasks.some(
        (task) => normalizeTaskType(task.type) === "initiative" && isActiveStatus(task.status),
    );
    if (hasInitiatives) {
        return { state: "initiatives-prioritized" };
    }
    const hasThemes = tasks.some(
        (task) => normalizeTaskType(task.type) === "theme" && isActiveStatus(task.status),
    );
    if (hasThemes) {
        return { state: "themes-prioritized" };
    }
    return null;
};

const selectTaskForState = (
    tasks: WorkflowTask[],
    state: RuntimeState | null,
    targetTypeOverride?: string,
    preferredTaskId?: string,
    preferPreferredTask?: boolean,
    restrictInProgressToPreferred?: boolean,
): WorkflowTask | null => {
    if (tasks.length === 0) {
        return null;
    }

    const activeTasks = tasks.filter(
        (task) =>
            task.status !== "done"
            && task.status !== "invalid"
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
    const requiresDependencies =
        normalizedTarget === "implementation"
        || normalizedTarget === "task"
        || normalizedTarget === "testing"
        || normalizedTarget === "integration";
    const isDependencyEligible = (task: WorkflowTask): boolean =>
        !requiresDependencies || dependenciesSatisfied(task, tasks);
    const matchesTarget = (task: WorkflowTask): boolean => {
        const normalizedType = normalizeTaskType(task.type);
        if (normalizedTarget === "implementation" || normalizedTarget === "task") {
            return isImplementationTaskType(task.type);
        }
        if (normalizedTarget === "testing" || normalizedTarget === "integration") {
            return isTestingTaskType(task.type);
        }
        return normalizedType === normalizedTarget;
    };

    const preferredTask =
        preferredTaskId
            ? activeTasks.find((task) => task.id === preferredTaskId)
            : undefined;
    if (
        preferredTask
        && (preferPreferredTask || matchesTarget(preferredTask))
        && (preferredTask.status === "in-progress" || isDependencyEligible(preferredTask))
    ) {
        return preferredTask;
    }

    const candidates = activeTasks.filter(
        (task) => matchesTarget(task) && isDependencyEligible(task),
    );
    const fallbackCandidates =
        candidates.length === 0 && normalizedTarget === "testing"
            ? activeTasks.filter(
                (task) => isImplementationTaskType(task.type) && isDependencyEligible(task),
            )
            : [];
    const eligibleCandidates = candidates.length > 0 ? candidates : fallbackCandidates;
    if (eligibleCandidates.length === 0) {
        return null;
    }

    const sorted = [...eligibleCandidates].sort((left, right) => {
        const leftScore = priorityScore(left.priority);
        const rightScore = priorityScore(right.priority);
        if (leftScore !== rightScore) {
            return rightScore - leftScore;
        }
        const leftTitle = left.title ?? "";
        const rightTitle = right.title ?? "";
        return leftTitle.localeCompare(rightTitle);
    });

    return sorted[0] ?? null;
};

const resolveTargetTypeForTransition = (
    state: RuntimeState,
    transition: string,
): string | undefined => {
    const overrides: Record<string, string> = {
        "retry-theme-research": "theme",
        "research-new-themes": "theme",
        "prioritize-themes": "theme",
        "define-initiatives": "theme",
        "retry-initiative-research": "theme",
        "prioritize-initiatives": "initiative",
        "retry-product-research": "initiative",
        "research-new-features": "initiative",
        "prioritize-features": "feature",
        "do-ux-research": "feature",
        "prioritize-stories": "story",
        "refine-into-tasks": "story",
        "need-more-tasks": "story",
        "begin-implementation": "implementation",
        "run-lint": "testing",
        "run-typecheck": "testing",
        "run-unit-tests": "testing",
        "run-e2e-tests": "testing",
        "ensure-coverage": "testing",
        "tests-passing": "testing",
        "lint-failed": "implementation",
        "typecheck-failed": "implementation",
        "unit-tests-failed": "implementation",
        "e2e-tests-failed": "implementation",
        "coverage-failed": "implementation",
    };
    return overrides[transition] ?? state.targetType;
};

const canRunWithoutTask = (transition: string): boolean =>
    transition === "retry-theme-research"
    || transition === "research-new-themes"
    || transition === "request-theme"
    || transition === "retry-product-research"
    || transition === "research-new-features";

const resolveNoTaskFallbackTransition = (
    state: RuntimeState,
    transition: string,
): string | null => {
    const fallbackByTransition: Record<string, string[]> = {
        "prioritize-themes": ["request-theme", "retry-theme-research", "research-new-themes"],
        "prioritize-initiatives": ["define-initiatives", "request-theme"],
        "define-initiatives": [
            "request-theme",
            "retry-theme-research",
            "research-new-themes",
            "research-new-features",
        ],
        "prioritize-features": ["research-new-features", "define-initiatives", "request-theme"],
        "prioritize-stories": ["do-ux-research", "request-feature", "prioritize-features"],
    };
    const candidates = fallbackByTransition[transition] ?? [];
    const next = candidates.find((candidate) => Boolean(state.transitions[candidate]));
    return next ?? null;
};

const shouldClaimTaskBeforeExecution = (transition: string, task: WorkflowTask): boolean => {
    if (!task.id) {
        return false;
    }
    if (canRunWithoutTask(transition)) {
        return false;
    }
    return normalizeTaskStatus(task.status) === "todo";
};

const buildVirtualTask = (transition: string, targetType: string | undefined): WorkflowTask => ({
    title: `Workflow context (${transition})`,
    description: "Virtual task context for workflow execution. Do not create a task for this.",
    status: "todo",
    priority: "medium",
    type: targetType ?? "task",
});

type TransitionResult = {
    transition: string;
    isDecider: boolean;
};

const resolveTransition = async (
    state: RuntimeState,
    tasks: WorkflowTask[],
    context: Record<string, unknown>,
): Promise<TransitionResult | null> => {
    const transitions = Object.keys(state.transitions);
    const isValid = (transition: string | null | undefined): transition is string =>
        typeof transition === "string" &&
        transition.length > 0 &&
        Boolean(state.transitions[transition]);

    const deciderChoice = state.decider ? await state.decider(tasks, context) : null;
    if (isValid(deciderChoice)) {
        return { transition: deciderChoice, isDecider: true };
    }
    if (deciderChoice) {
        console.warn(
            `[WORKFLOW] Invalid transition '${deciderChoice}' for state ${state.name}; falling back.`,
        );
    }

    if (isValid(state.defaultTransition)) {
        return { transition: state.defaultTransition, isDecider: false };
    }

    return transitions.length > 0 ? { transition: transitions[0], isDecider: false } : null;
};

const resolveProfileForTransition = (state: RuntimeState, transition: string): string => {
    const overrides: Record<string, string> = {
        "retry-theme-research": "portfolio-manager",
        "research-new-themes": "portfolio-manager",
        "prioritize-themes": "portfolio-manager",
        "define-initiatives": "portfolio-manager",
        "retry-initiative-research": "portfolio-manager",
        "prioritize-initiatives": "portfolio-manager",
        "request-theme": "portfolio-manager",
        "retry-product-research": "product-manager",
        "research-new-features": "product-manager",
        "prioritize-features": "product-manager",
        "do-ux-research": "ux-specialist",
        "prioritize-stories": "project-manager",
        "request-feature": "ux-specialist",
        "refine-into-tasks": "refinement",
        "need-more-tasks": "principal-architect",
        "close-invalid-task": "project-manager",
        "refine-task": "refinement",
        "begin-implementation": "senior-developer",
        "run-lint": "qa-specialist",
        "run-typecheck": "qa-specialist",
        "run-unit-tests": "qa-specialist",
        "run-e2e-tests": "qa-specialist",
        "ensure-coverage": "qa-specialist",
        "tests-passing": "qa-specialist",
        "lint-failed": "senior-developer",
        "typecheck-failed": "senior-developer",
        "unit-tests-failed": "senior-developer",
        "e2e-tests-failed": "senior-developer",
        "coverage-failed": "senior-developer",
        "pick-up-next-task": "development",
    };
    return overrides[transition] ?? state.profile;
};

/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class ProfileWorkflowRunner {
    private static readonly NO_TASK_WAIT_HEARTBEAT_MS = 60_000;
    private taskProvider: () => Promise<WorkflowTask[]>;
    private taskExecutor: WorkflowTaskExecutor;
    private token: WorkflowToken<WorkflowContextToken>;
    private environment: string | undefined;
    private pollIntervalMs: number;
    private contextClient: ContextClient;
    private updateTaskStatus?: (id: string, status: TaskStatus, updatedBy?: string) => Promise<void>;
    private appendTaskActionLogEntry?: (
        taskId: string,
        entry: TaskActionLog,
        fallbackLog?: TaskActionLog[],
    ) => Promise<void>;
    private workerId: string;
    private claimTask?: (taskId: string) => Promise<WorkflowTask | null>;
    private noTaskWaitLogKey: string | null = null;
    private noTaskWaitLogRepeats = 0;
    private noTaskWaitLogLastAtMs = 0;

    constructor(options: ProfileWorkflowRunnerOptions) {
        this.taskProvider = options.taskProvider;
        this.taskExecutor = options.taskExecutor;
        this.environment = options.environment;
        this.pollIntervalMs = options.pollIntervalMs ?? 10000;
        this.contextClient = createContextClient({ environment: options.environment });
        this.updateTaskStatus = options.updateTaskStatus;
        this.appendTaskActionLogEntry = options.appendTaskActionLogEntry;
        this.workerId = options.workerId ?? `worker-${process.pid}-${randomUUID().slice(0, 8)}`;
        this.claimTask = options.claimTask;
        this.token = createToken<WorkflowContextToken>(
            options.initialState ?? "themes-proposed",
            options.contextId ? { contextId: options.contextId } : undefined,
        );
    }

    private resetNoTaskWaitLogging(): void {
        this.noTaskWaitLogKey = null;
        this.noTaskWaitLogRepeats = 0;
        this.noTaskWaitLogLastAtMs = 0;
    }

    private logNoTaskWait(transition: string, targetType: string | undefined): void {
        const now = Date.now();
        const resolvedTargetType = targetType ?? "matching";
        const key = `${transition}:${resolvedTargetType}`;
        if (this.noTaskWaitLogKey !== key) {
            this.noTaskWaitLogKey = key;
            this.noTaskWaitLogRepeats = 0;
            this.noTaskWaitLogLastAtMs = now;
            console.log(
                `[WORKFLOW] No ${resolvedTargetType} tasks for ${transition}; waiting.`,
            );
            return;
        }

        this.noTaskWaitLogRepeats += 1;
        if (
            this.noTaskWaitLogLastAtMs > 0
            && now - this.noTaskWaitLogLastAtMs >= ProfileWorkflowRunner.NO_TASK_WAIT_HEARTBEAT_MS
        ) {
            console.log(
                `[WORKFLOW] Still waiting for ${resolvedTargetType} tasks for ${transition} (retries=${this.noTaskWaitLogRepeats}).`,
            );
            this.noTaskWaitLogLastAtMs = now;
            this.noTaskWaitLogRepeats = 0;
        }
    }

    private async ensureContextId(): Promise<string> {
        const existingId =
            this.token.context && typeof this.token.context.contextId === "string"
                ? this.token.context.contextId
                : undefined;
        if (existingId) {
            return existingId;
        }
        const created = await this.contextClient.createContext();
        const contextId = created.id;
        this.token = { ...this.token, context: { contextId } };
        return contextId;
    }

    private async loadContextData(contextId: string): Promise<Record<string, unknown>> {
        const existing = await this.contextClient.getContext(contextId);
        if (existing) {
            return normalizeContextData(existing.data);
        }
        const created = await this.contextClient.createContext({ id: contextId, data: {} });
        return normalizeContextData(created.data);
    }

    private async updateContextData(
        contextId: string,
        patch: Record<string, unknown>,
    ): Promise<void> {
        if (Object.keys(patch).length === 0) {
            return;
        }
        await this.contextClient.updateContext(contextId, patch);
    }

    async runLoop(): Promise<void> {
        console.log("[WORKFLOW] Starting profile-driven workflow loop");
        while (true) {
            try {
                const tasks = await this.taskProvider();
                const contextId = await this.ensureContextId();
                const baseContext = await this.loadContextData(contextId);
                const claimModeEnabled = typeof this.claimTask === "function";
                const shouldRecover =
                    !claimModeEnabled
                    && (
                    (this.token.state === "themes-proposed"
                        || this.token.state === "new-feature-proposed")
                    && baseContext.autoRecovered !== true
                    );
                const derived = shouldRecover ? deriveStateFromTasks(tasks) : null;
                const recoveryPatch =
                    derived && derived.state !== this.token.state
                        ? {
                            autoRecovered: true,
                            ...(derived.currentTaskId ? { currentTaskId: derived.currentTaskId } : {}),
                        }
                        : null;
                const tokenContext = recoveryPatch ? { ...baseContext, ...recoveryPatch } : baseContext;
                if (recoveryPatch) {
                    await this.updateContextData(contextId, recoveryPatch);
                    this.token = { ...this.token, state: derived?.state ?? this.token.state, context: { contextId } };
                    console.log(
                        `[WORKFLOW] Auto-recovered state=${derived?.state ?? this.token.state} currentTaskId=${derived?.currentTaskId ?? "none"}`,
                    );
                }

                const state = WORKFLOW[this.token.state];
                if (!state) {
                    console.warn(`[WORKFLOW] Unknown workflow state: ${this.token.state}`);
                    await sleep(this.pollIntervalMs);
                    continue;
                }
                const currentTaskId =
                    typeof tokenContext.currentTaskId === "string"
                        ? tokenContext.currentTaskId
                        : undefined;
                const lastTestResult = tokenContext.lastTestResult;

                const transitionResult = await resolveTransition(state, tasks, {
                    ...tokenContext,
                    workflow: { state: state.name },
                    services: {
                        taskExecutor: this.taskExecutor,
                    },
                    contextId,
                    currentTaskId,
                    lastTestResult,
                    environment: this.environment,
                });
                if (!transitionResult) {
                    console.warn(`[WORKFLOW] No transition chosen for state ${state.name}`);
                    await sleep(this.pollIntervalMs);
                    continue;
                }
                let transition = transitionResult.transition;
                const isDecider = transitionResult.isDecider;
                let prefetchedListTasksOutput = buildPrefetchedListTasksOutput(
                    transition,
                    tasks,
                );

                let nextStateName =
                    getNextStateFrom(WORKFLOW, this.token.state, transition) ?? this.token.state;
                let targetState = WORKFLOW[nextStateName] ?? state;
                let targetType = resolveTargetTypeForTransition(targetState, transition);
                let preferPreferredTask = QA_TRACKED_TRANSITIONS.includes(
                    transition as (typeof QA_TRACKED_TRANSITIONS)[number],
                );
                if (transition === "pick-up-next-task") {
                    const hasRunnableWork = hasRunnableImplementationTasks(tasks);
                    if (!hasRunnableWork) {
                        console.warn(
                            "[WORKFLOW] Skipping pick-up-next-task: no runnable implementation task is available",
                        );
                        await sleep(this.pollIntervalMs);
                        continue;
                    }
                    await this.updateContextData(contextId, {
                        currentTaskId: null,
                        lastTestResult: null,
                        testStatus: null,
                        testReport: null,
                    });
                    this.token = { ...this.token, state: nextStateName, context: { contextId } };
                    continue;
                }
                const inferredTaskId =
                    currentTaskId ??
                    selectInProgressImplementationTask(tasks)?.id;
                let invalidCandidate =
                    transition === "close-invalid-task"
                        ? selectInvalidTaskForClosure(tasks)
                        : null;
                let taskCandidate =
                    transition === "close-invalid-task"
                        ? invalidCandidate
                        : selectTaskForState(
                            tasks,
                            state,
                            targetType,
                            inferredTaskId,
                            preferPreferredTask,
                            claimModeEnabled,
                        );
                if (
                    !taskCandidate
                    && transition === "begin-implementation"
                    && Boolean(state.transitions["need-more-tasks"])
                ) {
                    transition = "need-more-tasks";
                    prefetchedListTasksOutput = buildPrefetchedListTasksOutput(
                        transition,
                        tasks,
                    );
                    nextStateName =
                        getNextStateFrom(WORKFLOW, this.token.state, transition) ?? this.token.state;
                    targetState = WORKFLOW[nextStateName] ?? state;
                    targetType = resolveTargetTypeForTransition(targetState, transition);
                    preferPreferredTask = QA_TRACKED_TRANSITIONS.includes(
                        transition as (typeof QA_TRACKED_TRANSITIONS)[number],
                    );
                    invalidCandidate =
                        transition === "close-invalid-task"
                            ? selectInvalidTaskForClosure(tasks)
                            : null;
                    taskCandidate =
                        transition === "close-invalid-task"
                            ? invalidCandidate
                            : selectTaskForState(
                                tasks,
                                state,
                                targetType,
                                inferredTaskId,
                                preferPreferredTask,
                                claimModeEnabled,
                            );
                    console.warn(
                        "[WORKFLOW] No runnable implementation task; falling back to need-more-tasks",
                    );
                }
                const attemptedFallbackTransitions = new Set<string>([transition]);
                while (!taskCandidate && !canRunWithoutTask(transition)) {
                    const fallbackTransition = resolveNoTaskFallbackTransition(state, transition);
                    if (
                        !fallbackTransition
                        || fallbackTransition === transition
                        || attemptedFallbackTransitions.has(fallbackTransition)
                    ) {
                        break;
                    }
                    attemptedFallbackTransitions.add(fallbackTransition);
                    const missingTargetType = targetType ?? "matching";
                    console.log(
                        `[WORKFLOW] No ${missingTargetType} tasks for ${transition}; transitioning via ${fallbackTransition}.`,
                    );
                    transition = fallbackTransition;
                    prefetchedListTasksOutput = buildPrefetchedListTasksOutput(
                        transition,
                        tasks,
                    );
                    nextStateName =
                        getNextStateFrom(WORKFLOW, this.token.state, transition) ?? this.token.state;
                    targetState = WORKFLOW[nextStateName] ?? state;
                    targetType = resolveTargetTypeForTransition(targetState, transition);
                    preferPreferredTask = QA_TRACKED_TRANSITIONS.includes(
                        transition as (typeof QA_TRACKED_TRANSITIONS)[number],
                    );
                    invalidCandidate =
                        transition === "close-invalid-task"
                            ? selectInvalidTaskForClosure(tasks)
                            : null;
                    taskCandidate =
                        transition === "close-invalid-task"
                            ? invalidCandidate
                            : selectTaskForState(
                                tasks,
                                state,
                                targetType,
                                inferredTaskId,
                                preferPreferredTask,
                                claimModeEnabled,
                            );
                }

                if (!taskCandidate && !canRunWithoutTask(transition)) {
                    this.logNoTaskWait(transition, targetType);
                    await sleep(this.pollIntervalMs);
                    continue;
                }
                this.resetNoTaskWaitLogging();
                let claimedTaskCandidate = taskCandidate;
                if (
                    claimModeEnabled
                    && this.claimTask
                    && claimedTaskCandidate
                    && shouldClaimTaskBeforeExecution(transition, claimedTaskCandidate)
                    && claimedTaskCandidate.id
                ) {
                    const claimedTask = await this.claimTask(claimedTaskCandidate.id);
                    if (!claimedTask) {
                        console.log(
                            `[WORKFLOW] ${this.workerId} skipped task ${claimedTaskCandidate.id}; already claimed by another worker.`,
                        );
                        await sleep(this.pollIntervalMs);
                        continue;
                    }
                    claimedTaskCandidate = claimedTask;
                }
                const task = claimedTaskCandidate ?? buildVirtualTask(transition, targetType);
                const transitionStartedAtMs = Date.now();

                console.log(
                    `[WORKFLOW] state=${state.name} transition=${transition} tasks=${tasks.length}`,
                );
                if (transition === "tests-passing") {
                    const effectiveTaskId =
                        currentTaskId ?? taskCandidate?.id ?? inferredTaskId;
                    if (effectiveTaskId && this.updateTaskStatus) {
                        await this.updateTaskStatus(effectiveTaskId, "done", "workflow");
                    } else if (!this.updateTaskStatus) {
                        console.warn("[WORKFLOW] updateTaskStatus not configured; skipping auto-complete");
                    }
                    await this.updateContextData(contextId, {
                        currentTaskId: null,
                        lastTestResult: null,
                        testStatus: null,
                        testReport: null,
                    });
                    this.token = { ...this.token, state: nextStateName, context: { contextId } };
                    continue;
                }
                const runState = {
                    ...targetState,
                    profile: resolveProfileForTransition(targetState, transition),
                };
                const isVirtualTask =
                    !task.id && typeof task.title === "string" && task.title.startsWith("Workflow context");
                const includeTaskContext =
                    TRANSITIONS_NEEDING_CONTEXT.has(transition) && !isVirtualTask;
                const selectedTaskContext = includeTaskContext
                    ? buildSelectedTaskContext(task, tasks, {
                        includeDescription: TRANSITIONS_NEEDING_DESCRIPTION.has(transition),
                    })
                    : "";
                const testReportSection =
                    isQaFailureTransition(transition)
                        ? buildTestReportSection(tokenContext, lastTestResult)
                        : null;
                let mechanicalTestLintResults =
                    typeof tokenContext.mechanicalTestLintResults === "string"
                        ? tokenContext.mechanicalTestLintResults
                        : "";
                let mechanicalQaPreflightResults =
                    typeof tokenContext.mechanicalQaPreflightResults === "string"
                        ? tokenContext.mechanicalQaPreflightResults
                        : "";
                let mechanicalQaPreflightResult: MechanicalQaPreflightResult | null = null;
                if (shouldRunQaPreflightForTransition(transition)) {
                    try {
                        mechanicalQaPreflightResult = await runMechanicalQaPreflight(transition);
                    } catch (error) {
                        const message = error instanceof Error ? error.message : String(error);
                        mechanicalQaPreflightResult = createFailedMechanicalQaPreflightResult(
                            transition,
                            message,
                        );
                    }
                    const resolvedPreflightResult =
                        mechanicalQaPreflightResult
                            ?? createFailedMechanicalQaPreflightResult(
                                transition,
                                "No preflight result was produced.",
                            );
                    mechanicalQaPreflightResult = resolvedPreflightResult;
                    mechanicalQaPreflightResults = resolvedPreflightResult.output;
                    mechanicalTestLintResults = mechanicalQaPreflightResults;
                    await this.updateContextData(contextId, {
                        testStatus: null,
                        testReport: null,
                        mechanicalTestLintResults,
                        mechanicalQaPreflightResults,
                        mechanicalQaPreflightStage: transition,
                        mechanicalQaPreflightUpdatedAt: new Date().toISOString(),
                        mechanicalTestLintResultsUpdatedAt: new Date().toISOString(),
                    });
                }
                const proceduralQaOutcome =
                    isProceduralQaTransition(transition)
                        ? buildProceduralQaOutcome(
                            transition,
                            mechanicalQaPreflightResult
                                ?? createFailedMechanicalQaPreflightResult(
                                    transition,
                                    "No preflight result was produced for procedural transition.",
                                ),
                        )
                        : null;
                const execution: WorkflowExecutionResult =
                    proceduralQaOutcome
                        ? proceduralQaOutcome.execution
                        : await this.taskExecutor({
                            task,
                            workflowState: runState,
                            workflowTransition: transition,
                            environment: this.environment,
                            workflowSourceState: this.token.state,
                            workflowTargetState: nextStateName,
                            executionContext: {
                                contextId,
                                currentTaskId,
                                lastTestResult,
                                prefetchedMcpOutput: prefetchedListTasksOutput,
                                prefetchedTaskContext: selectedTaskContext,
                                prefetchedTestReport: testReportSection,
                                prefetchedMechanicalTestResults:
                                    mechanicalQaPreflightResults.length > 0
                                        ? mechanicalQaPreflightResults
                                        : mechanicalTestLintResults,
                            },
                            isDecider,
                        });

                const shouldTrackTask = QA_TRACKED_TRANSITIONS.includes(
                    transition as (typeof QA_TRACKED_TRANSITIONS)[number],
                );
                const shouldClearLastTestResult =
                    transition === "begin-implementation"
                    || (!shouldTrackTask && !isQaRunTransition(transition));
                const shouldClearTestReport = shouldClearLastTestResult;
                const nextCurrentTaskId =
                    shouldTrackTask && task.id ? task.id : null;
                let inferredTestPatchResult: Record<string, unknown> = {};
                if (proceduralQaOutcome) {
                    inferredTestPatchResult = proceduralQaOutcome.patch;
                } else if (isQaRunTransition(transition)) {
                    const inferred = inferTestReportFromExecution(execution);
                    const latestContext = await this.loadContextData(contextId);
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
                    ...(isQaRunTransition(transition)
                        ? { lastTestResult: execution }
                        : shouldClearLastTestResult
                            ? { lastTestResult: null }
                            : {}),
                    ...(shouldClearTestReport
                        ? {
                            testStatus: null,
                            testReport: null,
                        }
                        : {}),
                    ...inferredTestPatchResult,
                };

                await this.updateContextData(contextId, contextPatch);
                if (proceduralQaOutcome && task.id && this.appendTaskActionLogEntry) {
                    const proceduralTransition = transition as ProceduralQaTransition;
                    const logEntry = createProceduralQaActivityLogEntry(
                        proceduralTransition,
                        execution.success,
                        Date.now() - transitionStartedAtMs,
                    );
                    try {
                        await this.appendTaskActionLogEntry(task.id, logEntry, task.actionLog);
                    } catch (error) {
                        const message = error instanceof Error ? error.message : String(error);
                        console.warn(
                            `[WORKFLOW] Failed to append procedural activity log for task ${task.id}: ${message}`,
                        );
                    }
                }

                this.token = { ...this.token, state: nextStateName, context: { contextId } };
            } catch (error) {
                console.error("[WORKFLOW] Error in profile workflow loop:", error);
            }

            await sleep(this.pollIntervalMs);
        }
    }
}
