import type { WorkflowTask } from "../../agent-runner.ts";
import { normalizeTaskStatus, normalizeTaskType } from "./task-normalization.ts";

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

    if (transition.length > 0 && summary.length > 0) {
        return `${transition}: ${summary}`;
    }
    return transition.length > 0 ? transition : summary;
};

const readTaskBranch = (task: WorkflowTask): string | null => {
    if (typeof task.branch !== "string") {
        return null;
    }
    const trimmed = task.branch.trim();
    return trimmed.length > 0 ? trimmed : null;
};

export const buildTaskContextSnapshot = (
    task: WorkflowTask,
    fallbackTaskId?: string,
): Record<string, unknown> | null => {
    const taskId = typeof task.id === "string" && task.id.length > 0 ? task.id : fallbackTaskId;
    if (!taskId) {
        return null;
    }

    const title =
        typeof task.title === "string" && task.title.trim().length > 0
            ? task.title.trim()
            : "Untitled";
    const status = normalizeTaskStatus(task.status) || "unknown";
    const type = normalizeTaskType(task.type) || "unknown";
    const priority = (task.priority ?? "unspecified").toLowerCase();
    const dependencies = Array.isArray(task.dependencies) ? task.dependencies : [];
    const branch = readTaskBranch(task);

    return {
        id: taskId,
        title,
        status,
        type,
        priority,
        dependencies,
        branch,
    };
};

export const formatTaskLine = (task: WorkflowTask): string => {
    const id = task.id ?? "unknown";
    const title = (task.title ?? "Untitled").trim();
    const type = normalizeTaskType(task.type) || "unknown";
    const status = normalizeTaskStatus(task.status) || "unknown";
    const priority = (task.priority ?? "unspecified").toLowerCase();
    const branch = readTaskBranch(task) ?? "none";
    const dependencies = task.dependencies ?? [];
    const depsCount = Array.isArray(dependencies) ? dependencies.length : 0;
    return `- ${id} | ${title} | ${type} | ${status} | ${priority} | branch=${branch} | deps=${depsCount}`;
};

export const summarizeTaskList = (
    tasks: WorkflowTask[],
    limit: number,
): { lines: string[]; truncated: boolean } => {
    const clipped = tasks.slice(0, Math.max(limit, 0));
    return {
        lines: clipped.map((task) => formatTaskLine(task)),
        truncated: tasks.length > clipped.length,
    };
};

export const buildSelectedTaskContext = (
    task: WorkflowTask,
    tasks: WorkflowTask[],
    options?: { includeDescription?: boolean },
): string => {
    const hasId = (entry: WorkflowTask): entry is WorkflowTask & { id: string } =>
        typeof entry.id === "string" && entry.id.length > 0;

    const taskId = task.id ?? "unknown";
    const taskTitle = (task.title ?? "Untitled").trim();
    const descriptionRaw = (task.description ?? "").trim();
    const description =
        descriptionRaw.length > 600 ? `${descriptionRaw.slice(0, 597)}...` : descriptionRaw;
    const taskType = normalizeTaskType(task.type) || "unknown";
    const taskStatus = normalizeTaskStatus(task.status) || "unknown";
    const taskPriority = (task.priority ?? "unspecified").toLowerCase();
    const taskBranch = readTaskBranch(task);

    const dependencyList = Array.isArray(task.dependencies) ? task.dependencies : [];
    const taskMap = new Map(tasks.filter(hasId).map((entry) => [entry.id, entry]));
    const dependencyLines =
        dependencyList.length > 0
            ? ["Dependencies:", ...buildDependencyStatusLines(dependencyList, taskMap)]
            : ["Dependencies: none"];

    const descriptionLines =
        options?.includeDescription && description.length > 0
            ? [`Description: ${description}`]
            : [];
    const lastAction = extractLastActionSummary(task);
    const lastActionLine = lastAction ? [`Last action: ${lastAction}`] : [];

    return [
        `ID: ${taskId}`,
        `Title: ${taskTitle}`,
        `Type: ${taskType}`,
        `Status: ${taskStatus}`,
        `Priority: ${taskPriority}`,
        `Branch: ${taskBranch ?? "none"}`,
        ...descriptionLines,
        ...dependencyLines,
        ...lastActionLine,
    ].join("\n");
};
