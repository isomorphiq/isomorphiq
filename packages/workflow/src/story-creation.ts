import type { TaskActionLog } from "@isomorphiq/types";
import { z } from "zod";
import type { WorkflowExecutionResult, WorkflowTaskExecutor } from "./agent-runner.ts";
import type { RuntimeState, WorkflowTask } from "./workflow-factory.ts";

export type StoryCreationServices = {
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
    createTask?: (
        title: string,
        description: string,
        priority: "low" | "medium" | "high",
        dependencies: string[],
        createdBy?: string,
        assignedTo?: string,
        collaborators?: string[],
        watchers?: string[],
        type?: string,
    ) => Promise<WorkflowTask>;
};

export type StoryCreationPayload = {
    tasks?: WorkflowTask[];
    services?: StoryCreationServices;
    environment?: string;
};

const StorySpecSchema = z.object({
    title: z.string().min(1),
    description: z.string().min(1),
    priority: z.enum(["low", "medium", "high"]).default("medium"),
    acceptanceCriteria: z.array(z.string().min(1)).optional(),
    uxNotes: z.string().optional(),
});

type StorySpec = z.output<typeof StorySpecSchema>;

type StorySpecRecord = {
    title: string;
    description: string;
    priority: "low" | "medium" | "high";
    acceptanceCriteria?: string[];
    uxNotes?: string;
};

const StorySpecListSchema = z.array(StorySpecSchema).min(1);

const resolveServices = (payload: unknown): StoryCreationServices => {
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
                ? (candidate.createActionLogEntry as StoryCreationServices["createActionLogEntry"])
                : undefined,
        appendActionLogEntry:
            typeof candidate.appendActionLogEntry === "function"
                ? (candidate.appendActionLogEntry as StoryCreationServices["appendActionLogEntry"])
                : undefined,
        createTask:
            typeof candidate.createTask === "function"
                ? (candidate.createTask as StoryCreationServices["createTask"])
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

const isFeatureLike = (task: WorkflowTask): boolean => {
    const text = `${task.title ?? ""} ${task.description ?? ""}`.toLowerCase();
    return (
        (task.type === "feature" ||
            (task.type === "task" && text.includes("feature"))) &&
        task.status === "todo"
    );
};

const selectFeatureCandidate = (tasks: WorkflowTask[]): WorkflowTask | null => {
    const candidates = tasks.filter(isFeatureLike);
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

const extractJsonSnippet = (text: string): string | null => {
    const trimmed = text.trim();
    if (!trimmed) {
        return null;
    }
    if (
        (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
        (trimmed.startsWith("{") && trimmed.endsWith("}"))
    ) {
        return trimmed;
    }
    const arrayStart = trimmed.indexOf("[");
    const objectStart = trimmed.indexOf("{");
    const startCandidates = [arrayStart, objectStart].filter((value) => value >= 0);
    if (startCandidates.length === 0) {
        return null;
    }
    const start = Math.min(...startCandidates);
    const endArray = trimmed.lastIndexOf("]");
    const endObject = trimmed.lastIndexOf("}");
    const endCandidates = [endArray, endObject].filter((value) => value > start);
    if (endCandidates.length === 0) {
        return null;
    }
    const end = Math.max(...endCandidates);
    return trimmed.slice(start, end + 1);
};

const parseStorySpecs = (text: string): StorySpec[] => {
    const snippet = extractJsonSnippet(text);
    if (!snippet) {
        return [];
    }
    try {
        const parsed = JSON.parse(snippet) as unknown;
        const storiesCandidate =
            typeof parsed === "object" && parsed !== null && "stories" in parsed
                ? (parsed as { stories?: unknown }).stories
                : parsed;
        const validated = StorySpecListSchema.safeParse(storiesCandidate);
        return validated.success ? validated.data : [];
    } catch (error) {
        void error;
        return [];
    }
};

const buildStoryDescription = (story: StorySpecRecord): string => {
    const base = story.description.trim();
    const criteria = (story.acceptanceCriteria ?? []).filter((item) => item.trim().length > 0);
    const criteriaBlock =
        criteria.length > 0
            ? [`Acceptance Criteria:`, ...criteria.map((item) => `- ${item}`)].join("\n")
            : "";
    const uxNotes = story.uxNotes?.trim() ?? "";
    const uxBlock = uxNotes.length > 0 ? `UX Notes: ${uxNotes}` : "";
    return [base, criteriaBlock, uxBlock].filter((block) => block.length > 0).join("\n\n");
};

const normalizeStorySpec = (story: StorySpec): StorySpecRecord => ({
    title: story.title.trim(),
    description: buildStoryDescription({
        title: story.title,
        description: story.description,
        priority: story.priority,
        acceptanceCriteria: story.acceptanceCriteria,
        uxNotes: story.uxNotes,
    }),
    priority: story.priority,
    acceptanceCriteria: story.acceptanceCriteria,
    uxNotes: story.uxNotes,
});

const uniqueStorySpecs = (
    stories: StorySpecRecord[],
    existingStories: WorkflowTask[],
): StorySpecRecord[] => {
    const normalizeTitle = (title: string | undefined): string =>
        (title ?? "").trim().toLowerCase();
    const existingTitles = new Set(
        existingStories.map((story) => normalizeTitle(story.title)),
    );
    return stories.filter((story) => !existingTitles.has(normalizeTitle(story.title)));
};

const buildUxResearchState = (baseState: RuntimeState): RuntimeState => ({
    ...baseState,
    profile: "ux-specialist",
    targetType: "story",
    promptHint:
        "Return JSON only: { \"stories\": [ { \"title\": \"...\", \"description\": \"...\", \"priority\": \"low|medium|high\", \"acceptanceCriteria\": [\"...\"], \"uxNotes\": \"...\" } ] }",
});

const buildStoryCreationSummary = (
    createdCount: number,
    totalCount: number,
    featureTitle: string | undefined,
): string => {
    const base = `Generated ${createdCount} ${createdCount === 1 ? "story" : "stories"}`;
    const totalSuffix = totalCount > createdCount ? ` (of ${totalCount} suggested)` : "";
    const featureSuffix = featureTitle ? ` for feature "${featureTitle}"` : "";
    return `${base}${totalSuffix}${featureSuffix}.`;
};

export const handleUxResearchTransition = async (
    payload: unknown,
    baseState: RuntimeState,
): Promise<void> => {
    const payloadRecord: StoryCreationPayload =
        payload && typeof payload === "object" ? (payload as StoryCreationPayload) : {};
    const tasks = payloadRecord.tasks ?? [];
    if (tasks.length === 0) {
        return;
    }
    const services = resolveServices(payloadRecord);
    if (!services.taskExecutor || !services.createTask) {
        return;
    }

    const feature = selectFeatureCandidate(tasks);
    if (!feature || !feature.title || !feature.description) {
        return;
    }

    const uxState = buildUxResearchState(baseState);
    const start = Date.now();
    const execution = await services.taskExecutor({
        task: {
            id: feature.id,
            title: feature.title,
            description: feature.description,
            type: "feature",
            status: feature.status,
        },
        workflowState: uxState,
        workflowTransition: "do-ux-research",
        environment: payloadRecord.environment,
    });
    const durationMs = Date.now() - start;

    const parsedStories = parseStorySpecs(execution.output).map(normalizeStorySpec);
    const existingStories = tasks.filter((task) => task.type === "story");
    const uniqueStories = uniqueStorySpecs(parsedStories, existingStories);

    const featureDependency = feature.id ? [feature.id] : [];
    const createdStories = await Promise.all(
        uniqueStories.map(async (story) => {
            try {
                return await services.createTask?.(
                    story.title,
                    story.description,
                    story.priority,
                    [...featureDependency],
                    "ux-specialist",
                    undefined,
                    undefined,
                    undefined,
                    "story",
                );
            } catch (error) {
                console.warn("[WORKFLOW] Failed to create story:", error);
                return null;
            }
        }),
    );
    const createdCount = createdStories.filter((story) => story !== null).length;

    if (
        services.createActionLogEntry &&
        services.appendActionLogEntry &&
        feature.id
    ) {
        const summary = buildStoryCreationSummary(
            createdCount,
            uniqueStories.length,
            feature.title,
        );
        const result: WorkflowExecutionResult = {
            success: execution.success && createdCount > 0,
            output: execution.output,
            error: execution.error,
            profileName: "ux-specialist",
            prompt: execution.prompt,
            summary,
            modelName: execution.modelName,
        };
        const logEntry = services.createActionLogEntry(
            "ux-specialist",
            durationMs,
            result,
            "do-ux-research",
        );
        await services.appendActionLogEntry(feature.id, logEntry, feature.actionLog);
    }
};
