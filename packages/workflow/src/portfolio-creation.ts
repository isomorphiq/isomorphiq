import type { TaskActionLog } from "@isomorphiq/types";
import type { WorkflowExecutionResult, WorkflowTaskExecutor } from "./agent-runner.ts";
import type { RuntimeState, WorkflowTask } from "./workflow-factory.ts";

export type PortfolioCreationServices = {
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
    listTasks?: () => Promise<WorkflowTask[]>;
};

export type PortfolioCreationPayload = {
    tasks?: WorkflowTask[];
    services?: PortfolioCreationServices;
    environment?: string;
};

const matchesEnvironmentForTask = (
    task: WorkflowTask,
    environment?: string,
): boolean => {
    if (!environment) return true;
    const envValue = (task as Record<string, unknown>).environment;
    return typeof envValue !== "string" || envValue === environment;
};

const countThemeTasksForEnvironment = (
    tasks: WorkflowTask[],
    environment?: string,
): number =>
    tasks.filter(
        (task) =>
            normalizeTaskType(task.type) === "theme"
            && matchesEnvironmentForTask(task, environment),
    ).length;

const resolveServices = (payload: unknown): PortfolioCreationServices => {
    if (!payload || typeof payload !== "object") {
        return {};
    }
    const record = payload as Record<string, unknown>;
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
                ? (candidate.createActionLogEntry as PortfolioCreationServices["createActionLogEntry"])
                : undefined,
        appendActionLogEntry:
            typeof candidate.appendActionLogEntry === "function"
                ? (candidate.appendActionLogEntry as PortfolioCreationServices["appendActionLogEntry"])
                : undefined,
        listTasks:
            typeof candidate.listTasks === "function"
                ? (candidate.listTasks as PortfolioCreationServices["listTasks"])
                : undefined,
    };
};

const normalizeTaskType = (value: string | undefined): string => (value ?? "").trim().toLowerCase();
const normalizeTaskStatus = (value: string | undefined): string =>
    (value ?? "").trim().toLowerCase().replace(/[_\s]+/g, "-");

const isActiveStatus = (value: string | undefined): boolean => {
    const status = normalizeTaskStatus(value);
    return status === "todo" || status === "in-progress";
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

const selectThemeCandidate = (tasks: WorkflowTask[]): WorkflowTask | null => {
    const candidates = tasks.filter(
        (task) => normalizeTaskType(task.type) === "theme" && isActiveStatus(task.status),
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

const summarizeExisting = (tasks: WorkflowTask[], type: "theme" | "initiative"): string => {
    const existing = tasks
        .filter((task) => normalizeTaskType(task.type) === type)
        .map((task) => (task.title ?? "").trim())
        .filter((title) => title.length > 0);
    if (existing.length === 0) {
        return `Existing ${type}s: none listed.`;
    }
    const clipped = existing.slice(0, 20);
    const suffix = existing.length > clipped.length ? " (truncated)" : "";
    return `Existing ${type}s${suffix}: ${clipped.join(" | ")}`;
};

const buildPortfolioState = (
    baseState: RuntimeState,
    profile: string,
    targetType: string,
    promptHint: string,
): RuntimeState => ({
    ...baseState,
    profile,
    targetType,
    promptHint,
});

const buildThemeSummary = (count: number): string =>
    `Proposed ${count} ${count === 1 ? "theme" : "themes"} for the portfolio.`;

const buildInitiativeSummary = (
    count: number,
    themeTitle: string | undefined,
): string => {
    const base = `Generated ${count} ${count === 1 ? "initiative" : "initiatives"}`;
    const themeSuffix = themeTitle ? ` for theme "${themeTitle}"` : "";
    return `${base}${themeSuffix}.`;
};

export const handleThemeResearchTransition = async (
    payload: unknown,
    baseState: RuntimeState,
    transitionName: string,
): Promise<void> => {
    const payloadRecord: PortfolioCreationPayload =
        payload && typeof payload === "object" ? (payload as PortfolioCreationPayload) : {};
    const tasks = payloadRecord.tasks ?? [];
    const themeCount = countThemeTasksForEnvironment(tasks, payloadRecord.environment);
    if (themeCount > 3) {
        console.log(
            `[WORKFLOW] retry-theme-research: skipping because ${themeCount} themes already exist (env=${payloadRecord.environment ?? "n/a"})`,
        );
        return;
    }
    const services = resolveServices(payloadRecord);
    if (!services.taskExecutor) {
        return;
    }

    const researchState = buildPortfolioState(
        baseState,
        "portfolio-manager",
        "theme",
        "Use MCP tool calls to create themes. Call create_task with type \"theme\" for each item, then call list_tasks to confirm.",
    );
    const existingSummary = summarizeExisting(tasks, "theme");
    const researchDescription = [
        "Generate 1-2 portfolio themes that capture high-level product outcomes.",
        "Avoid duplicating any existing themes.",
        existingSummary,
    ].join("\n");
    const start = Date.now();
    const execution = await services.taskExecutor({
        task: {
            title: "Theme discovery",
            description: researchDescription,
            type: "research",
            status: "todo",
        },
        workflowState: researchState,
        workflowTransition: transitionName,
        environment: payloadRecord.environment,
    });
    const durationMs = Date.now() - start;

    const beforeIds = new Set(
        tasks.map((task) => task.id).filter((id): id is string => typeof id === "string"),
    );
    const afterTasks = services.listTasks ? await services.listTasks() : tasks;
    const createdThemes = afterTasks.filter(
        (task) =>
            normalizeTaskType(task.type) === "theme"
            && !!task.id
            && !beforeIds.has(task.id),
    );
    if (createdThemes.length === 0) {
        return;
    }

    if (services.createActionLogEntry && services.appendActionLogEntry) {
        const summary = buildThemeSummary(createdThemes.length);
        const result: WorkflowExecutionResult = {
            success: execution.success && createdThemes.length > 0,
            output: execution.output,
            error: execution.error,
            profileName: "portfolio-manager",
            prompt: execution.prompt,
            summary,
            modelName: execution.modelName,
        };
        await Promise.all(
            createdThemes
                .map((theme) => theme.id)
                .filter((id): id is string => typeof id === "string")
                .map((id) => {
                    const logEntry = services.createActionLogEntry?.(
                        "portfolio-manager",
                        durationMs,
                        result,
                        transitionName,
                    );
                    return logEntry
                        ? services.appendActionLogEntry?.(id, logEntry)
                        : Promise.resolve();
                }),
        );
    }
};

export const handleInitiativeResearchTransition = async (
    payload: unknown,
    baseState: RuntimeState,
    transitionName: string,
): Promise<void> => {
    const payloadRecord: PortfolioCreationPayload =
        payload && typeof payload === "object" ? (payload as PortfolioCreationPayload) : {};
    const tasks = payloadRecord.tasks ?? [];
    const services = resolveServices(payloadRecord);
    if (!services.taskExecutor) {
        return;
    }

    const theme = selectThemeCandidate(tasks);
    if (!theme || !theme.title || !theme.description) {
        return;
    }

    const initiativeState = buildPortfolioState(
        baseState,
        "portfolio-manager",
        "initiative",
        "Create initiatives for the selected theme. Use create_task with type \"initiative\" and include the theme id as a dependency.",
    );
    const themeId = theme.id ? theme.id.trim() : "";
    const themeContext = themeId.length > 0 ? `Theme ID: ${themeId}` : "Theme ID: (missing)";
    const initiativeDescription = [
        "Define 2-4 initiatives that deliver on this theme.",
        "Each initiative must include the theme id as a dependency.",
        themeContext,
    ].join("\n");
    const start = Date.now();
    const execution = await services.taskExecutor({
        task: {
            id: theme.id,
            title: theme.title,
            description: `${theme.description}\n\n${initiativeDescription}`,
            type: "theme",
            status: theme.status,
        },
        workflowState: initiativeState,
        workflowTransition: transitionName,
        environment: payloadRecord.environment,
    });
    const durationMs = Date.now() - start;

    const beforeIds = new Set(
        tasks.map((task) => task.id).filter((id): id is string => typeof id === "string"),
    );
    const afterTasks = services.listTasks ? await services.listTasks() : tasks;
    const createdInitiatives = afterTasks.filter((task) => {
        if (!task.id || beforeIds.has(task.id)) {
            return false;
        }
        if (normalizeTaskType(task.type) !== "initiative") {
            return false;
        }
        if (themeId.length === 0) {
            return true;
        }
        const deps = task.dependencies ?? [];
        return Array.isArray(deps) && deps.includes(themeId);
    });
    if (createdInitiatives.length === 0) {
        return;
    }

    if (services.createActionLogEntry && services.appendActionLogEntry) {
        const summary = buildInitiativeSummary(createdInitiatives.length, theme.title);
        const result: WorkflowExecutionResult = {
            success: execution.success && createdInitiatives.length > 0,
            output: execution.output,
            error: execution.error,
            profileName: "portfolio-manager",
            prompt: execution.prompt,
            summary,
            modelName: execution.modelName,
        };
        await Promise.all(
            createdInitiatives
                .map((initiative) => initiative.id)
                .filter((id): id is string => typeof id === "string")
                .map((id) => {
                    const logEntry = services.createActionLogEntry?.(
                        "portfolio-manager",
                        durationMs,
                        result,
                        transitionName,
                    );
                    return logEntry
                        ? services.appendActionLogEntry?.(id, logEntry)
                        : Promise.resolve();
                }),
        );
    }
};
