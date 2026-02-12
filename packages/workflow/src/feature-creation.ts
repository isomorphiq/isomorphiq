import type { TaskActionLog } from "@isomorphiq/types";
import type { WorkflowExecutionResult, WorkflowTaskExecutor } from "./agent-runner.ts";
import type { RuntimeState, WorkflowTask } from "./workflow-factory.ts";

export type FeatureCreationServices = {
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

export type FeatureCreationPayload = {
    tasks?: WorkflowTask[];
    services?: FeatureCreationServices;
    environment?: string;
};

const resolveServices = (payload: unknown): FeatureCreationServices => {
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
                ? (candidate.createActionLogEntry as FeatureCreationServices["createActionLogEntry"])
                : undefined,
        appendActionLogEntry:
            typeof candidate.appendActionLogEntry === "function"
                ? (candidate.appendActionLogEntry as FeatureCreationServices["appendActionLogEntry"])
                : undefined,
        listTasks:
            typeof candidate.listTasks === "function"
                ? (candidate.listTasks as FeatureCreationServices["listTasks"])
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

const selectInitiativeCandidate = (tasks: WorkflowTask[]): WorkflowTask | null => {
    const candidates = tasks.filter(
        (task) => normalizeTaskType(task.type) === "initiative" && isActiveStatus(task.status),
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

const buildProductResearchState = (baseState: RuntimeState): RuntimeState => ({
    ...baseState,
    profile: "product-manager",
    targetType: "feature",
    promptHint:
        "Use MCP tool calls to create features. Call create_task with type \"feature\" for each item, include a comprehensive `prd` (Product Requirements Document, minimum 2800 words), then call list_tasks to confirm. If an initiative context is provided, include its id as a dependency.",
});

const summarizeExistingFeatures = (tasks: WorkflowTask[]): string => {
    const existing = tasks
        .filter((task) => task.type === "feature")
        .map((task) => task.title ?? "")
        .map((title) => title.trim())
        .filter((title) => title.length > 0);
    if (existing.length === 0) {
        return "Existing features: none listed.";
    }
    const clipped = existing.slice(0, 20);
    const suffix = existing.length > clipped.length ? " (truncated)" : "";
    return `Existing features${suffix}: ${clipped.join(" | ")}`;
};

const buildFeatureSummary = (count: number): string =>
    `Proposed ${count} ${count === 1 ? "feature" : "features"} via product research.`;

export const handleProductResearchTransition = async (
    payload: unknown,
    baseState: RuntimeState,
    transitionName: string,
): Promise<void> => {
    const payloadRecord: FeatureCreationPayload =
        payload && typeof payload === "object" ? (payload as FeatureCreationPayload) : {};
    const tasks = payloadRecord.tasks ?? [];
    const services = resolveServices(payloadRecord);
    if (!services.taskExecutor) {
        return;
    }

    const initiative = selectInitiativeCandidate(tasks);
    const researchState = buildProductResearchState(baseState);
    const existingSummary = summarizeExistingFeatures(tasks);
    const initiativeSummary =
        initiative?.id && initiative.title
            ? `Selected initiative: ${initiative.title} (id: ${initiative.id}). Include this id as a dependency on each feature.`
            : "No initiative selected; create features without initiative dependencies if none are provided.";
    const researchDescription = [
        "Generate one or more high-value features for the product backlog.",
        "Do not propose duplicates of existing features.",
        "Every created feature must include a `prd` field with a long-form Product Requirements Document (minimum 2800 words).",
        existingSummary,
        initiativeSummary,
    ].join("\n");
    const start = Date.now();
    const execution = await services.taskExecutor({
        task: {
            title: "Feature discovery",
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
    const createdFeatures = afterTasks.filter(
        (task) => task.type === "feature" && !!task.id && !beforeIds.has(task.id),
    );
    if (createdFeatures.length === 0) {
        return;
    }

    if (services.createActionLogEntry && services.appendActionLogEntry) {
        const summary = buildFeatureSummary(createdFeatures.length);
        const result: WorkflowExecutionResult = {
            success: execution.success && createdFeatures.length > 0,
            output: execution.output,
            error: execution.error,
            profileName: "product-manager",
            prompt: execution.prompt,
            summary,
            modelName: execution.modelName,
        };
        await Promise.all(
            createdFeatures
                .map((feature) => feature.id)
                .filter((id): id is string => typeof id === "string")
                .map((id) => {
                    const logEntry = services.createActionLogEntry?.(
                        "product-manager",
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
