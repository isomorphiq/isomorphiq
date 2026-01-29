import type { TaskActionLog, TaskStatus } from "@isomorphiq/types";
import type { WorkflowExecutionResult, WorkflowTaskExecutor } from "./agent-runner.ts";
import type { RuntimeState, WorkflowTask } from "./workflow-factory.ts";
import { isWorkflowTaskActionable, isWorkflowTaskTextComplete } from "./task-readiness.ts";

const normalizeTaskType = (value: string | undefined): string => (value ?? "").trim().toLowerCase();

const isImplementationTask = (task: WorkflowTask): boolean => {
    const type = normalizeTaskType(task.type);
    return type === "implementation" || type === "task";
};

export type TaskValidityServices = {
    taskExecutor?: WorkflowTaskExecutor;
    createActionLogEntry?: (
        profileName: string,
        durationMs: number,
        execution: WorkflowExecutionResult,
        workflowTransition: string | null,
    ) => TaskActionLog;
    appendActionLogEntry?: (
        taskId: string,
        entry: TaskActionLog,
        fallbackLog?: TaskActionLog[],
    ) => Promise<void>;
    updateTaskStatus?: (taskId: string, status: TaskStatus, actor?: string) => Promise<void>;
};

export type TaskValidityPayload = {
    tasks?: WorkflowTask[];
    services?: TaskValidityServices;
};

type TaskReviewDecision = {
    decision: "proceed" | "close";
    reason: string;
    execution?: WorkflowExecutionResult;
    durationMs: number;
};

const normalizeLines = (text: string): string[] =>
    text
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

const formatExecutionLine = (text: string, fallback: string): string => {
    const line = text
        .split("\n")
        .map((part) => part.trim())
        .find((part) => part.length > 0);
    if (!line) {
        return fallback;
    }
    const compact = line.replace(/\s+/g, " ");
    const maxLength = 180;
    const clipped =
        compact.length > maxLength ? `${compact.slice(0, maxLength - 3)}...` : compact;
    const trimmed = clipped.replace(/[.!?]+$/, "");
    return trimmed.length > 0 ? trimmed : fallback;
};

const parseReviewDecision = (
    text: string,
): { decision: "proceed" | "close"; reason: string } | null => {
    const lines = normalizeLines(text);
    const decisionLine = lines.find((line) => /^decision\s*:/i.test(line));
    if (!decisionLine) {
        return null;
    }
    const decisionMatch = decisionLine.match(/decision\s*:\s*(proceed|close)/i);
    if (!decisionMatch) {
        return null;
    }
    const decision = decisionMatch[1].toLowerCase() as "proceed" | "close";
    const reasonLine = lines.find((line) => /^reason\s*:/i.test(line));
    const reason = reasonLine ? reasonLine.replace(/^reason\s*:\s*/i, "").trim() : "";
    return { decision, reason };
};

const getDecisionFromLog = (
    task: WorkflowTask,
): { decision: "proceed" | "close"; reason: string } | null => {
    const log = task.actionLog ?? [];
    if (log.length === 0) {
        return null;
    }
    const recent = [...log].reverse();
    const closeEntry = recent.find((entry) => entry.transition === "close-invalid-task");
    if (closeEntry) {
        return { decision: "close", reason: closeEntry.summary };
    }
    const reviewEntry = recent.find((entry) => entry.transition === "review-task-validity");
    if (!reviewEntry) {
        return null;
    }
    const parsed = parseReviewDecision(reviewEntry.summary);
    if (parsed) {
        return parsed;
    }
    return { decision: "proceed", reason: reviewEntry.summary };
};

const resolveServices = (context: unknown): TaskValidityServices => {
    if (!context || typeof context !== "object") {
        return {};
    }
    const record = context as Record<string, unknown>;
    const candidate =
        record.services && typeof record.services === "object"
            ? (record.services as Record<string, unknown>)
            : record;
    return {
        taskExecutor:
            typeof candidate.taskExecutor === "function"
                ? (candidate.taskExecutor as WorkflowTaskExecutor)
                : undefined,
        createActionLogEntry:
            typeof candidate.createActionLogEntry === "function"
                ? (candidate.createActionLogEntry as TaskValidityServices["createActionLogEntry"])
                : undefined,
        appendActionLogEntry:
            typeof candidate.appendActionLogEntry === "function"
                ? (candidate.appendActionLogEntry as TaskValidityServices["appendActionLogEntry"])
                : undefined,
        updateTaskStatus:
            typeof candidate.updateTaskStatus === "function"
                ? (candidate.updateTaskStatus as TaskValidityServices["updateTaskStatus"])
                : undefined,
    };
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

const dependenciesSatisfied = (task: WorkflowTask, tasks: WorkflowTask[]): boolean => {
    const deps = task.dependencies ?? [];
    if (deps.length === 0) {
        return true;
    }
    return deps.every((depId) => {
        const dep = tasks.find((candidate) => candidate.id === depId);
        return !dep || dep.status === "done" || dep.status === "invalid";
    });
};

const selectReviewCandidate = (tasks: WorkflowTask[]): WorkflowTask | null => {
    const candidates = tasks.filter(
        (task) =>
            isImplementationTask(task) &&
            task.status === "todo" &&
            dependenciesSatisfied(task, tasks),
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

const buildProjectManagerState = (
    baseState: RuntimeState,
    promptHint: string,
): RuntimeState => ({
    ...baseState,
    profile: "project-manager",
    promptHint,
});

const reviewTaskValidity = async (
    task: WorkflowTask,
    baseState: RuntimeState,
    services: TaskValidityServices,
): Promise<TaskReviewDecision | null> => {
    if (!services.taskExecutor) {
        const fallbackDecision = isWorkflowTaskTextComplete(task) ? "proceed" : "close";
        const fallbackReason =
            fallbackDecision === "close"
                ? "Ticket lacks required detail for implementation"
                : "Ticket appears implementation-ready";
        return { decision: fallbackDecision, reason: fallbackReason, durationMs: 0 };
    }

    const reviewState = buildProjectManagerState(
        baseState,
        "Review the ticket for readiness. Provide Decision: proceed|close and Reason: <one sentence>.",
    );
    const startTime = Date.now();
    const execution = await services.taskExecutor({
        task,
        workflowState: reviewState,
        workflowTransition: "review-task-validity",
    });
    const durationMs = Date.now() - startTime;
    const parsed =
        parseReviewDecision(execution.output) ??
        parseReviewDecision(execution.summary ?? "");
    const fallbackDecision = isWorkflowTaskTextComplete(task) ? "proceed" : "close";
    const decision = parsed?.decision ?? fallbackDecision;
    const reason =
        parsed?.reason && parsed.reason.length > 0
            ? parsed.reason
            : formatExecutionLine(
                execution.output || execution.error,
                decision === "close"
                    ? "Ticket lacks required detail for implementation"
                    : "Ticket appears implementation-ready",
            );

    if (services.createActionLogEntry && services.appendActionLogEntry && task.id) {
        const reviewSummary = `Decision: ${decision}. Reason: ${reason}`;
        const reviewResult: WorkflowExecutionResult = {
            success: execution.success,
            output: execution.output,
            error: execution.error,
            profileName: "project-manager",
            prompt: execution.prompt,
            summary: reviewSummary,
            modelName: execution.modelName,
        };
        const reviewLogEntry = services.createActionLogEntry(
            "project-manager",
            durationMs,
            reviewResult,
            "review-task-validity",
        );
        await services.appendActionLogEntry(task.id, reviewLogEntry, task.actionLog);
    }

    return { decision, reason, execution, durationMs };
};

export const decideTasksPreparedTransition = async (
    tasks: WorkflowTask[],
    context: unknown,
    baseState: RuntimeState,
): Promise<string> => {
    const services = resolveServices(context);
    const candidate = selectReviewCandidate(tasks);
    if (candidate) {
        const decision = await reviewTaskValidity(candidate, baseState, services);
        if (decision?.decision === "close") {
            return "close-invalid-task";
        }
        if (decision?.decision === "proceed") {
            return "begin-implementation";
        }
    }

    const hasActionableTasks = tasks.some(
        (task) =>
            isImplementationTask(task) &&
            isWorkflowTaskActionable(task) &&
            dependenciesSatisfied(task, tasks),
    );
    return hasActionableTasks ? "begin-implementation" : "need-more-tasks";
};

const selectInvalidTaskForClosure = (tasks: WorkflowTask[]): WorkflowTask | null => {
    const candidates = tasks.filter(
        (task) => isImplementationTask(task) && task.status === "todo",
    );
    const withDecision = candidates.find((task) => {
        const decision = getDecisionFromLog(task);
        return decision?.decision === "close";
    });
    if (withDecision) {
        return withDecision;
    }
    const fallback = candidates.find((task) => !isWorkflowTaskTextComplete(task));
    return fallback ?? null;
};

export const handleCloseInvalidTaskTransition = async (
    payload: unknown,
    baseState: RuntimeState,
): Promise<void> => {
    const payloadRecord: TaskValidityPayload =
        payload && typeof payload === "object" ? (payload as TaskValidityPayload) : {};
    const tasks = payloadRecord.tasks ?? [];
    if (tasks.length === 0) {
        return;
    }
    const services = resolveServices(payloadRecord);
    if (!services.updateTaskStatus) {
        return;
    }
    const candidate = selectInvalidTaskForClosure(tasks);
    if (!candidate || !candidate.id) {
        return;
    }

    const priorDecision = getDecisionFromLog(candidate);
    const fallbackReason =
        priorDecision?.reason?.trim().length > 0
            ? priorDecision.reason
            : "Ticket lacks required detail for implementation";

    let execution: WorkflowExecutionResult | null = null;
    let durationMs = 0;
    if (services.taskExecutor) {
        const closeState = buildProjectManagerState(
            baseState,
            "Close this invalid task. Explain why it is being closed in one sentence.",
        );
        const start = Date.now();
        execution = await services.taskExecutor({
            task: candidate,
            workflowState: closeState,
            workflowTransition: "close-invalid-task",
        });
        durationMs = Date.now() - start;
    }

    const reason = execution
        ? formatExecutionLine(execution.output || execution.error, fallbackReason)
        : fallbackReason;
    const summary = `Closed as invalid: ${reason}`;

    if (services.createActionLogEntry && services.appendActionLogEntry) {
        const result: WorkflowExecutionResult = execution
            ? {
                ...execution,
                summary,
                profileName: "project-manager",
            }
            : {
                success: true,
                output: "",
                error: "",
                profileName: "project-manager",
                summary,
            };
        const logEntry = services.createActionLogEntry(
            "project-manager",
            durationMs,
            result,
            "close-invalid-task",
        );
        await services.appendActionLogEntry(candidate.id, logEntry, candidate.actionLog);
    }

    await services.updateTaskStatus(candidate.id, "invalid", "project-manager");
};
