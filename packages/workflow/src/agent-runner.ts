import { cleanupConnection, createConnection, sendPrompt, waitForTaskCompletion } from "@isomorphiq/acp";
import { ProfileManager } from "@isomorphiq/user-profile";
import type { ACPProfile } from "@isomorphiq/user-profile";
import { z } from "zod";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import type { RuntimeState } from "./workflow-factory.ts";

export type WorkflowTask = {
    id?: string;
    title?: string;
    description?: string;
    priority?: string;
    type?: string;
    status?: string;
    assignedTo?: string;
};

export type WorkflowSeedSpec = {
    title: string;
    description: string;
    priority: "low" | "medium" | "high";
    type:
        | "feature"
        | "story"
        | "task"
        | "implementation"
        | "integration"
        | "testing"
        | "research";
    assignedTo?: string;
    createdBy?: string;
    dependencies?: string[];
};

export type WorkflowExecutionResult = {
    success: boolean;
    output: string;
    error: string;
    profileName: string;
    prompt?: string;
    summary?: string;
    modelName?: string;
};

export type WorkflowTaskExecutor = (context: {
    task: WorkflowTask;
    workflowState: RuntimeState | null;
    workflowTransition?: string | null;
    environment?: string;
}) => Promise<WorkflowExecutionResult>;

export type WorkflowTaskSeedProvider = (context: {
    workflowState: RuntimeState | null;
    tasks: WorkflowTask[];
}) => Promise<WorkflowSeedSpec | null>;

export type WorkflowAgentRunnerOptions = {
    profileManager?: ProfileManager;
    workspaceRoot?: string;
};

const SeedSpecSchema = z.object({
    title: z.string().min(1),
    description: z.string().min(1),
    priority: z.enum(["low", "medium", "high"]).optional().default("medium"),
    type: z
        .enum([
            "feature",
            "story",
            "task",
            "implementation",
            "integration",
            "testing",
            "research",
        ])
        .optional()
        .default("feature"),
    assignedTo: z.string().min(1).optional(),
    createdBy: z.string().min(1).optional(),
    dependencies: z.array(z.string()).optional(),
});

const findWorkspaceRoot = (startDir: string): string => {
    const hasPrompts = existsSync(path.join(startDir, "prompts"));
    const hasPackageJson = existsSync(path.join(startDir, "package.json"));
    if (hasPrompts && hasPackageJson) {
        return startDir;
    }
    const parentDir = path.dirname(startDir);
    if (parentDir === startDir) {
        return startDir;
    }
    return findWorkspaceRoot(parentDir);
};

const extractJsonObject = (text: string): string | null => {
    const trimmed = text.trim();
    if (!trimmed) {
        return null;
    }
    if (
        (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
        (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
        return trimmed;
    }
    const startBrace = trimmed.indexOf("{");
    const startBracket = trimmed.indexOf("[");
    const starts = [startBrace, startBracket].filter((value) => value >= 0);
    if (starts.length === 0) {
        return null;
    }
    const start = Math.min(...starts);
    const endBrace = trimmed.lastIndexOf("}");
    const endBracket = trimmed.lastIndexOf("]");
    const ends = [endBrace, endBracket].filter((value) => value > start);
    if (ends.length === 0) {
        return null;
    }
    const end = Math.max(...ends);
    return trimmed.slice(start, end + 1);
};

const extractSummaryBlock = (text: string): string | null => {
    const match = text.match(/(?:^|\n)\s*summary\s*[:\-]\s*/i);
    if (!match) {
        return null;
    }
    const start = (match.index ?? 0) + match[0].length;
    const remaining = text.slice(start).trim();
    if (!remaining) {
        return null;
    }
    const end = remaining.indexOf("\n\n");
    const block = end >= 0 ? remaining.slice(0, end) : remaining;
    return block.trim();
};

const splitSentences = (text: string): string[] => {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (!normalized) {
        return [];
    }
    return normalized
        .split(/(?<=[.!?])\s+/)
        .map((sentence) => sentence.trim())
        .filter((sentence) => sentence.length > 0);
};

const summarizeText = (text: string): string => {
    const source = extractSummaryBlock(text) ?? text;
    const sentences = splitSentences(source);
    if (sentences.length === 0) {
        return "No summary provided.";
    }
    const combined = sentences.slice(0, 2).join(" ");
    if (combined.length <= 400) {
        return combined;
    }
    return `${combined.slice(0, 397).trim()}...`;
};

const isSeedRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value);

const parseSeedSpec = (text: string): WorkflowSeedSpec | null => {
    const jsonText = extractJsonObject(text);
    if (!jsonText) {
        return null;
    }
    try {
        const parsed = JSON.parse(jsonText);
        const asSeed = (value: unknown): WorkflowSeedSpec | null => {
            const validated = SeedSpecSchema.safeParse(value);
            return validated.success ? (validated.data as WorkflowSeedSpec) : null;
        };
        if (Array.isArray(parsed)) {
            return parsed.reduce<WorkflowSeedSpec | null>(
                (acc, item) => acc ?? asSeed(item),
                null,
            );
        }
        if (isSeedRecord(parsed)) {
            const direct = asSeed(parsed);
            if (direct) {
                return direct;
            }
            const listKeys = ["features", "tickets", "items", "stories", "tasks"];
            const lists = listKeys
                .map((key) => parsed[key])
                .filter((value): value is unknown[] => Array.isArray(value));
            return lists.reduce<WorkflowSeedSpec | null>(
                (acc, list) =>
                    acc ??
                    list.reduce<WorkflowSeedSpec | null>(
                        (innerAcc, item) => innerAcc ?? asSeed(item),
                        null,
                    ),
                null,
            );
        }
        return null;
    } catch (error) {
        void error;
        return null;
    }
};

const resolveWorkflowProfileName = (profileName: string): string => {
    const normalized = profileName.trim().toLowerCase();
    const mapping: Record<string, string> = {
        "product-research": "product-manager",
        roadmapping: "product-manager",
        "ux-research": "ux-specialist",
        "ux-researcher": "ux-researcher",
        planning: "project-manager",
        refinement: "principal-architect",
        development: "senior-developer",
        "integration-testing": "qa-specialist",
    };
    return mapping[normalized] ?? profileName;
};

const resolveTransitionModelOverride = (transition?: string | null): string | null => {
    if (!transition) {
        return null;
    }
    switch (transition) {
        case "prioritize-features":
            return "lmstudio/nvidia/nemotron-3-nano";
        default:
            return null;
    }
};

const shouldEnforceWorkflowProfile = (
    workflowState: RuntimeState | null,
    workflowTransition?: string | null,
): boolean => {
    if (workflowState?.profile) {
        return true;
    }
    if (workflowState?.name === "tests-completed") {
        return true;
    }
    if (workflowState?.name === "features-prioritized") {
        return true;
    }
    return (
        workflowTransition === "review-task-validity" ||
        workflowTransition === "close-invalid-task" ||
        workflowTransition === "prioritize-features"
    );
};

const resolveProfile = (
    profileManager: ProfileManager,
    profileName: string,
): ACPProfile | undefined => {
    const mapped = resolveWorkflowProfileName(profileName);
    return profileManager.getProfile(mapped) ?? profileManager.getProfile(profileName);
};

const selectPromptFiles = (profile: ACPProfile, task: WorkflowTask): string[] => {
    const title = task.title ?? "";
    const description = task.description ?? "";
    const text = `${title} ${description}`;

    const hasRefactor = /refactor|cleanup|maintenance/i.test(text);
    const hasDocs = /doc|documentation|readme/i.test(text);
    const hasTests = /test|coverage|qa|regression/i.test(text);
    const hasArchitecture = /architecture|design/i.test(text);

    const unique = (files: string[]): string[] =>
        files.reduce<string[]>((acc, file) => (acc.includes(file) ? acc : [...acc, file]), []);

    switch (profile.name) {
        case "senior-developer": {
            const files = ["implementation-development.md"];
            if (hasRefactor) files.push("refactoring-maintenance.md");
            if (hasDocs) files.push("documentation-knowledge.md");
            if (hasTests) files.push("testing-quality.md");
            if (hasArchitecture) files.push("architecture-planning.md");
            return unique(files);
        }
        case "qa-specialist": {
            return ["testing-quality.md"];
        }
        case "principal-architect": {
            return ["architecture-planning.md"];
        }
        case "project-manager": {
            return hasArchitecture ? ["architecture-planning.md"] : [];
        }
        case "ux-specialist": {
            return hasDocs ? ["documentation-knowledge.md"] : [];
        }
        case "ux-researcher": {
            return hasDocs ? ["documentation-knowledge.md"] : [];
        }
        case "product-manager": {
            return [];
        }
        default:
            return [];
    }
};

const readPromptFile = async (root: string, fileName: string): Promise<string | null> => {
    try {
        const promptPath = path.join(root, "prompts", fileName);
        return await fs.readFile(promptPath, "utf-8");
    } catch (error) {
        void error;
        return null;
    }
};

const loadPromptBlocks = async (root: string, files: string[]): Promise<string[]> => {
    const blocks = await Promise.all(
        files.map(async (file) => {
            const content = await readPromptFile(root, file);
            if (!content) {
                return null;
            }
            return [`--- ${file} ---`, content.trim(), "---"].join("\n");
        }),
    );
    return blocks.filter((block): block is string => block !== null);
};

const buildProfilePrompt = async (
    root: string,
    profile: ACPProfile,
    task: WorkflowTask,
    workflowState: RuntimeState | null,
    workflowTransition?: string | null,
): Promise<string> => {
    const workflowHint =
        workflowState?.promptHint && workflowState.profile === profile.name
            ? `Workflow hint: ${workflowState.promptHint}`
            : "";
    const projectRules = [
        "Project rules:",
        "- Follow AGENTS.md and the repository conventions.",
        "- Node ESM with no transpilation: include `.ts` on local imports.",
        "- Do not restart the daemon directly; use the restart_daemon MCP tool.",
    ].join("\n");
    const instructions = [
        profile.systemPrompt.trim(),
        "",
        workflowHint,
        projectRules,
        "If you discover the task is already implemented, say so and propose a better-scoped follow-up.",
        "If you lack permission to read files, say so and proceed with the task using the context available.",
        "At the end of your response, include `Summary:` with 1-2 sentences describing what you completed.",
        "",
        profile.getTaskPrompt({
            task,
            workflow: workflowState
                ? {
                        state: workflowState.name,
                        profile: workflowState.profile,
                        promptHint: workflowState.promptHint,
                        transition: workflowTransition ?? undefined,
                    }
                : undefined,
            workflowTransition: workflowTransition ?? undefined,
        }),
    ];
    return instructions.filter((line) => line.length > 0).join("\n");
};

type FsAccessMode = "default" | "read-only" | "read-write";

type TurnContext = {
    taskId?: string;
    taskTitle?: string;
    taskType?: string;
    taskStatus?: string;
    workflowState?: string;
    workflowTransition?: string;
};

const resolveModelFromEnv = (): string | null => {
    const candidates = [
        process.env.ACP_MODEL,
        process.env.OPENAI_MODEL,
        process.env.MODEL,
        process.env.LLM_MODEL,
    ];
    const match = candidates.find((value) => typeof value === "string" && value.trim().length > 0);
    return match ? match.trim() : null;
};

const isTestMode = (): boolean =>
    process.env.ISOMORPHIQ_TEST_MODE === "true" || process.env.NODE_ENV === "test";

const readModelNameFromResult = (result: Record<string, unknown>): string | null => {
    const direct = result.model ?? result.modelName ?? result.model_name;
    if (typeof direct === "string" && direct.trim().length > 0) {
        return direct.trim();
    }
    const response = result.response;
    if (response && typeof response === "object") {
        const responseModel = (response as Record<string, unknown>).model;
        if (typeof responseModel === "string" && responseModel.trim().length > 0) {
            return responseModel.trim();
        }
    }
    return null;
};

const safeStringify = (value: unknown): string | null => {
    const seen = new WeakSet();
    try {
        const json = JSON.stringify(value, (_key, val) => {
            if (typeof val === "bigint") {
                return val.toString();
            }
            if (typeof val === "object" && val !== null) {
                if (seen.has(val)) {
                    return "[Circular]";
                }
                seen.add(val);
            }
            return val;
        });
        return typeof json === "string" ? json : null;
    } catch (error) {
        void error;
        return null;
    }
};

const extractErrorDetails = (error: Error): Record<string, unknown> | null => {
    const standardKeys = ["name", "message", "stack", "cause"];
    const ownKeys = Object.getOwnPropertyNames(error).filter(
        (key) => !standardKeys.includes(key),
    );
    const ownSymbols = Object.getOwnPropertySymbols(error);
    if (ownKeys.length === 0 && ownSymbols.length === 0) {
        return null;
    }
    const base = ownKeys.reduce<Record<string, unknown>>((acc, key) => {
        const value = (error as unknown as Record<string, unknown>)[key];
        return { ...acc, [key]: value };
    }, {});
    return ownSymbols.reduce<Record<string, unknown>>((acc, key) => {
        return { ...acc, [key.toString()]: (error as unknown as Record<symbol, unknown>)[key] };
    }, base);
};

const normalizeErrorMessage = (value: unknown): string => {
    if (typeof value === "string") {
        return value;
    }
    if (value instanceof Error) {
        const errorCode = (value as { code?: unknown }).code;
        const rawMessage = value.message ?? "";
        const isPlaceholderMessage = rawMessage.trim() === "" || rawMessage === "[object Object]";
        const errorDetails = extractErrorDetails(value);
        const detailsJson = errorDetails ? safeStringify(errorDetails) : null;
        const details =
            detailsJson && detailsJson !== "{}" ? `details=${detailsJson}` : "";
        const parts = [
            value.name && !isPlaceholderMessage
                ? `${value.name}: ${rawMessage}`
                : !isPlaceholderMessage
                    ? rawMessage
                    : value.name || "",
            errorCode !== undefined ? `code=${String(errorCode)}` : "",
            value.cause ? `cause=${normalizeErrorMessage(value.cause)}` : "",
            details,
            value.stack ?? "",
        ].filter((part) => part.length > 0);
        return parts.join(" | ");
    }
    if (
        typeof value === "number" ||
        typeof value === "boolean" ||
        typeof value === "bigint" ||
        typeof value === "symbol" ||
        value === null ||
        value === undefined
    ) {
        return String(value);
    }
    if (typeof value === "object") {
        const record = value as Record<string, unknown>;
        const name = typeof record.name === "string" ? record.name : null;
        const message = typeof record.message === "string" ? record.message : null;
        const code =
            typeof record.code === "string" || typeof record.code === "number"
                ? String(record.code)
                : null;
        const stack = typeof record.stack === "string" ? record.stack : null;
        const cause =
            record.cause !== undefined ? normalizeErrorMessage(record.cause) : null;
        const details = safeStringify(record);
        const parts = [
            name && message ? `${name}: ${message}` : message ?? name ?? "",
            code ? `code=${code}` : "",
            cause ? `cause=${cause}` : "",
            details && details !== "{}" ? `details=${details}` : "",
            stack ?? "",
        ].filter((part) => part.length > 0);
        return parts.join(" | ");
    }
    return String(value);
};

const executePrompt = async (
    profileName: string,
    prompt: string,
    fsMode: FsAccessMode,
    environment: string | undefined,
    modelName: string | undefined,
    turnContext?: TurnContext,
): Promise<{ output: string; error: string; modelName: string }> => {
    const session = await createConnection(
        fsMode === "default"
            ? undefined
            : {
                    fs: {
                        readTextFile: true,
                        writeTextFile: fsMode === "read-write",
                    },
                },
        { environment, modelName },
    );
    session.taskClient.profileName = profileName;
    if (turnContext) {
        session.taskClient.taskId = turnContext.taskId ?? null;
        session.taskClient.taskTitle = turnContext.taskTitle ?? null;
        session.taskClient.taskType = turnContext.taskType ?? null;
        session.taskClient.taskStatus = turnContext.taskStatus ?? null;
        session.taskClient.workflowState = turnContext.workflowState ?? null;
        session.taskClient.workflowTransition = turnContext.workflowTransition ?? null;
    }
    await session.taskClient.sessionUpdate({
        sessionId: session.sessionId,
        update: {
            sessionUpdate: "session_meta",
            modelName: session.taskClient.modelName ?? undefined,
            mcpTools: session.taskClient.mcpTools ?? undefined,
        },
    });
    try {
        const promptResult = await sendPrompt(
            session.connection,
            session.sessionId,
            prompt,
            session.taskClient,
        );
        const completion = await waitForTaskCompletion(session.taskClient, 600000, profileName);
        const modelName =
            (promptResult && readModelNameFromResult(promptResult)) ??
            resolveModelFromEnv() ??
            "unknown-model";
        session.taskClient.modelName = modelName;
        await session.taskClient.sessionUpdate({
            sessionId: session.sessionId,
            update: {
                sessionUpdate: "session_meta",
                modelName,
                mcpTools: session.taskClient.mcpTools ?? undefined,
            },
        });
        return {
            output: completion.output ?? "",
            error: completion.error ?? "",
            modelName,
        };
    } finally {
        await cleanupConnection(session.connection, session.processResult);
    }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value);

const toStringOrNull = (value: unknown): string | null =>
    typeof value === "string" ? value : null;

const readJsonFile = async (filePath: string): Promise<Record<string, unknown> | null> => {
    try {
        const content = await fs.readFile(filePath, "utf-8");
        const parsed = JSON.parse(content);
        return isRecord(parsed) ? parsed : null;
    } catch (error) {
        void error;
        return null;
    }
};

const readDirEntries = async (dirPath: string): Promise<string[]> => {
    try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    } catch (error) {
        void error;
        return [];
    }
};

const readFileEntries = async (dirPath: string): Promise<string[]> => {
    try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
    } catch (error) {
        void error;
        return [];
    }
};

const collectPackageSummaries = async (
    rootDir: string,
): Promise<Array<{ name: string; testScript: string | null }>> => {
    const dirNames = await readDirEntries(rootDir);
    const summaries = await Promise.all(
        dirNames.map(async (dirName) => {
            const packagePath = path.join(rootDir, dirName, "package.json");
            const packageJson = await readJsonFile(packagePath);
            if (!packageJson) {
                return null;
            }
            const name = toStringOrNull(packageJson.name);
            if (!name) {
                return null;
            }
            const scripts = isRecord(packageJson.scripts) ? packageJson.scripts : null;
            const testScript = scripts ? toStringOrNull(scripts.test) : null;
            return { name, testScript };
        }),
    );
    return summaries.filter((entry): entry is { name: string; testScript: string | null } => entry !== null);
};

const collectRepositoryContext = async (root: string): Promise<string> => {
    const packagesRoot = path.join(root, "packages");
    const servicesRoot = path.join(root, "services");
    const webPagesRoot = path.join(root, "web", "src", "pages");

    const [packages, services, webPages] = await Promise.all([
        collectPackageSummaries(packagesRoot),
        collectPackageSummaries(servicesRoot),
        readFileEntries(webPagesRoot),
    ]);

    const packageNames = packages.map((entry) => entry.name);
    const serviceNames = services.map((entry) => entry.name);
    const packagesMissingTests = packages
        .filter((entry) => {
            const script = entry.testScript?.toLowerCase() ?? "";
            return script.length === 0 || script.includes("not configured") || script.startsWith("echo ");
        })
        .map((entry) => entry.name);

    const lines = [
        packageNames.length > 0
            ? `Packages (${packageNames.length}): ${packageNames.join(", ")}`
            : "Packages: none found",
        serviceNames.length > 0
            ? `Services (${serviceNames.length}): ${serviceNames.join(", ")}`
            : "Services: none found",
        webPages.length > 0
            ? `Web pages (${webPages.length}): ${webPages.slice(0, 15).join(", ")}`
            : "Web pages: none found",
        packagesMissingTests.length > 0
            ? `Packages missing tests: ${packagesMissingTests.join(", ")}`
            : "",
    ];

    return lines.filter((line) => line.length > 0).join("\n");
};

const buildSeedPrompt = async (
    root: string,
    profile: ACPProfile,
    workflowState: RuntimeState | null,
): Promise<string> => {
    const repositoryContext = await collectRepositoryContext(root);
    const baseTaskPrompt = profile.getTaskPrompt({});
    const workflowHint = workflowState?.promptHint
        ? `Workflow hint: ${workflowState.promptHint}`
        : "";
    const stateLabel = workflowState?.name ?? "new-feature-proposed";
    return [
        profile.systemPrompt.trim(),
        "",
        baseTaskPrompt,
        "",
        workflowHint,
        `You are operating in workflow state "${stateLabel}".`,
        "Before proposing work, orient yourself in the repo:",
        "- Read AGENTS.md and follow the workflow rules.",
        "- Read root package.json scripts to understand how the app runs.",
        "- Skim README.md and any relevant docs in docs/ and packages/**/docs.",
        "- Survey existing packages to avoid duplicating implemented features.",
        "If you lack permission to read files, return a research task that documents what needs review.",
        "",
        "Repository context (use this as a starting point):",
        repositoryContext,
        "",
        "Pick one scoped task to keep the workflow moving forward.",
        "Return only JSON with this exact shape:",
        "{",
        "  \"title\": \"...\",",
        "  \"description\": \"...\",",
        "  \"priority\": \"low|medium|high\",",
        "  \"type\": \"feature|story|implementation|testing|task|integration|research\",",
        "  \"assignedTo\": \"senior-developer\"",
        "}",
        "Description should include: problem, requirements/acceptance criteria, evidence (file paths reviewed), impacted packages/files, and testing notes.",
        "Do not include markdown fences or extra text.",
    ].join("\n");
};

export type WorkflowAgentRunner = {
    executeTask: WorkflowTaskExecutor;
    seedTask: WorkflowTaskSeedProvider;
    profileManager: ProfileManager;
};

export const createWorkflowAgentRunner = (
    options: WorkflowAgentRunnerOptions = {},
): WorkflowAgentRunner => {
    const workspaceRoot =
        options.workspaceRoot ?? findWorkspaceRoot(process.env.INIT_CWD ?? process.cwd());
    const profileManager = options.profileManager ?? new ProfileManager();

    const executeTask: WorkflowTaskExecutor = async ({
        task,
        workflowState,
        workflowTransition,
        environment,
    }) => {
        const enforceWorkflowProfile = shouldEnforceWorkflowProfile(
            workflowState,
            workflowTransition,
        );
        const assignedProfile = !enforceWorkflowProfile && task.assignedTo
            ? profileManager.getProfile(task.assignedTo) ?? resolveProfile(profileManager, task.assignedTo)
            : undefined;
        const workflowProfileName = workflowState?.profile ?? "senior-developer";
        const profile = assignedProfile ?? resolveProfile(profileManager, workflowProfileName);
        const profileName = profile?.name ?? task.assignedTo ?? workflowProfileName;
        if (!profile) {
            return {
                success: false,
                output: "",
                error: `Unknown profile: ${profileName}`,
                profileName: profileName,
            };
        }

        const prompt = await buildProfilePrompt(
            workspaceRoot,
            profile,
            task,
            workflowState,
            workflowTransition,
        );
        const startTime = Date.now();
        profileManager.startTaskProcessing(profile.name);
        try {
            const completion = await executePrompt(
                profile.name,
                prompt,
                "read-write",
                environment,
                resolveTransitionModelOverride(workflowTransition) ?? profile.modelName,
                {
                taskId: task.id,
                taskTitle: task.title,
                taskType: task.type,
                taskStatus: task.status,
                workflowState: workflowState?.name,
                workflowTransition: workflowTransition ?? undefined,
                },
            );
            const summarySource = completion.error.length > 0 ? completion.error : completion.output;
            const summary = summarizeText(summarySource);
            const duration = Date.now() - startTime;
            profileManager.endTaskProcessing(profile.name);
            profileManager.recordTaskProcessing(
                profile.name,
                duration,
                completion.error.length === 0,
            );
            if (completion.error) {
                return {
                    success: false,
                    output: completion.output,
                    error: completion.error,
                    profileName: profile.name,
                    prompt,
                    summary,
                    modelName: completion.modelName,
                };
            }
            return {
                success: true,
                output: completion.output,
                error: "",
                profileName: profile.name,
                prompt,
                summary,
                modelName: completion.modelName,
            };
        } catch (error) {
            const duration = Date.now() - startTime;
            profileManager.endTaskProcessing(profile.name);
            profileManager.recordTaskProcessing(profile.name, duration, false);
            const message = normalizeErrorMessage(error);
            return {
                success: false,
                output: "",
                error: message,
                profileName: profile.name,
                prompt,
                summary: summarizeText(message),
                modelName: resolveModelFromEnv() ?? "unknown-model",
            };
        }
    };

    const seedTask: WorkflowTaskSeedProvider = async ({ workflowState, tasks }) => {
        void tasks;
        const profileName = workflowState?.profile ?? "product-manager";
        const profile = resolveProfile(profileManager, profileName);
        if (!profile) {
            return null;
        }

        const prompt = await buildSeedPrompt(workspaceRoot, profile, workflowState);
        const startTime = Date.now();
        profileManager.startTaskProcessing(profile.name);
        try {
            const completion = await executePrompt(profile.name, prompt, "read-only", undefined, undefined, {
                taskType: workflowState?.targetType,
                workflowState: workflowState?.name,
                workflowTransition: workflowState?.defaultTransition,
            });
            const duration = Date.now() - startTime;
            profileManager.endTaskProcessing(profile.name);
            profileManager.recordTaskProcessing(
                profile.name,
                duration,
                completion.error.length === 0,
            );
            if (completion.error) {
                return null;
            }
            const parsed = parseSeedSpec(completion.output);
            if (!parsed) {
                return null;
            }
            const shouldAssign = !isTestMode();
            return {
                ...parsed,
                assignedTo: shouldAssign ? parsed.assignedTo ?? "senior-developer" : undefined,
                createdBy: profile.name,
            };
        } catch (error) {
            const duration = Date.now() - startTime;
            profileManager.endTaskProcessing(profile.name);
            profileManager.recordTaskProcessing(profile.name, duration, false);
            void error;
            return null;
        }
    };

    return { executeTask, seedTask, profileManager };
};

export const createWorkflowTaskExecutor = (
    options: WorkflowAgentRunnerOptions = {},
): WorkflowTaskExecutor => createWorkflowAgentRunner(options).executeTask;

export const createWorkflowTaskSeedProvider = (
    options: WorkflowAgentRunnerOptions = {},
): WorkflowTaskSeedProvider => createWorkflowAgentRunner(options).seedTask;
