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
    type: "feature" | "story" | "task" | "integration" | "research";
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
    priority: z.enum(["low", "medium", "high"]),
    type: z.enum(["feature", "story", "task", "integration", "research"]),
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
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
        return trimmed;
    }
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end < 0 || end <= start) {
        return null;
    }
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

const parseSeedSpec = (text: string): WorkflowSeedSpec | null => {
    const jsonText = extractJsonObject(text);
    if (!jsonText) {
        return null;
    }
    try {
        const parsed = JSON.parse(jsonText);
        const validated = SeedSpecSchema.safeParse(parsed);
        return validated.success ? validated.data : null;
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
        "ux-research": "project-manager",
        planning: "project-manager",
        refinement: "principal-architect",
        development: "senior-developer",
        "integration-testing": "qa-specialist",
    };
    return mapping[normalized] ?? profileName;
};

const resolveProfile = (
    profileManager: ProfileManager,
    profileName: string,
): ACPProfile | undefined => {
    const mapped = resolveWorkflowProfileName(profileName);
    return profileManager.getProfile(mapped) ?? profileManager.getProfile(profileName);
};

const selectPromptFiles = (profile: ACPProfile, task: WorkflowTask): string[] => {
    const basePrompts = ["quick-reference.md"];
    const profilePrompts =
        profile.name === "senior-developer"
            ? ["implementation-development.md", "testing-quality.md"]
            : profile.name === "qa-specialist"
              ? ["testing-quality.md"]
              : profile.name === "project-manager"
                ? ["architecture-planning.md", "documentation-knowledge.md"]
                : profile.name === "principal-architect"
                  ? ["architecture-planning.md"]
                  : profile.name === "product-manager"
                    ? ["architecture-planning.md"]
                    : profile.name === "ux-specialist"
                      ? ["documentation-knowledge.md"]
                      : [];

    const title = task.title ?? "";
    const description = task.description ?? "";
    const taskPrompts = [
        task.type === "integration" ? "architecture-planning.md" : null,
        task.type === "research" ? "documentation-knowledge.md" : null,
        /refactor|cleanup|maintenance/i.test(`${title} ${description}`)
            ? "refactoring-maintenance.md"
            : null,
        /doc|documentation|readme/i.test(`${title} ${description}`)
            ? "documentation-knowledge.md"
            : null,
        /test|coverage|qa/i.test(`${title} ${description}`)
            ? "testing-quality.md"
            : null,
        /architecture|design/i.test(`${title} ${description}`)
            ? "architecture-planning.md"
            : null,
    ].filter((entry): entry is string => entry !== null);

    const allPrompts = [...basePrompts, ...profilePrompts, ...taskPrompts];
    return allPrompts.reduce<string[]>((acc, file) => (acc.includes(file) ? acc : [...acc, file]), []);
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
): Promise<string> => {
    const promptFiles = selectPromptFiles(profile, task);
    const promptBlocks = await loadPromptBlocks(root, promptFiles);
    const workflowHint = workflowState?.promptHint
        ? `Workflow hint: ${workflowState.promptHint}`
        : "";
    const instructions = [
        profile.systemPrompt.trim(),
        "",
        workflowHint,
        "Before acting, orient yourself in the repo:",
        "- Read AGENTS.md and follow the workflow rules.",
        "- Review root package.json scripts to understand how services are started.",
        "- Skim README.md and any relevant docs in docs/ and packages/**/docs.",
        "- Survey existing packages to avoid duplicating implemented features.",
        "Never kill or restart the daemon process directly; use the restart_daemon MCP tool if a restart is required.",
        "If you discover the task is already implemented, say so and propose a better-scoped follow-up.",
        "If you lack permission to read files, say so and proceed with the task using the context available.",
        "At the end of your response, include `Summary:` with 1-2 sentences describing what you completed.",
        "",
        promptBlocks.length > 0
            ? ["Project prompt templates (apply as relevant):", ...promptBlocks, ""].join("\n")
            : "",
        profile.getTaskPrompt({
            task,
            workflow: workflowState
                ? {
                        state: workflowState.name,
                        profile: workflowState.profile,
                        promptHint: workflowState.promptHint,
                    }
                : undefined,
        }),
    ];
    return instructions.filter((line) => line.length > 0).join("\n");
};

type FsAccessMode = "default" | "read-only" | "read-write";

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

const executePrompt = async (
    profileName: string,
    prompt: string,
    fsMode: FsAccessMode,
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
    );
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
        "  \"type\": \"feature|story|task|integration|research\",",
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

    const executeTask: WorkflowTaskExecutor = async ({ task, workflowState }) => {
        const enforceWorkflowProfile = workflowState?.name === "tests-completed";
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

        const prompt = await buildProfilePrompt(workspaceRoot, profile, task, workflowState);
        const startTime = Date.now();
        profileManager.startTaskProcessing(profile.name);
        try {
            const completion = await executePrompt(profile.name, prompt, "read-write");
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
            const message = error instanceof Error ? error.message : String(error);
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
            const completion = await executePrompt(profile.name, prompt, "read-only");
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
            return {
                ...parsed,
                assignedTo: parsed.assignedTo ?? "senior-developer",
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
