// FILE_CONTEXT: "context-41992560-1f4d-42d3-9c12-d5ad095e6962"

// TODO: This file is too complex (987 lines) and should be refactored into several modules.
// Current concerns mixed: ACP connection management, workflow execution, task creation,
// profile management, file operations, result processing.
// 
// Proposed structure:
// - workflow/agent-runner/index.ts - Main agent runner orchestration
// - workflow/agent-runner/acp-manager.ts - ACP connection lifecycle management
// - workflow/agent-runner/task-executor.ts - Task execution and monitoring
// - workflow/agent-runner/profile-selector.ts - Profile selection and management
// - workflow/agent-runner/file-service.ts - File operation utilities
// - workflow/agent-runner/result-processor.ts - Execution result processing
// - workflow/agent-runner/types.ts - Agent runner types

import { cleanupConnection, createConnection, sendPrompt, waitForTaskCompletion } from "@isomorphiq/acp";
import { ProfileManager } from "@isomorphiq/profiles";
import type { ACPProfile } from "@isomorphiq/profiles";
import { z } from "zod";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import type { RuntimeState } from "./workflow-factory.ts";
import type { TaskActionLog } from "@isomorphiq/types";

export type WorkflowTask = {
    id?: string;
    title?: string;
    description?: string;
    priority?: string;
    type?: string;
    branch?: string;
    status?: string;
    assignedTo?: string;
    dependencies?: string[];
    actionLog?: TaskActionLog[];
};

export type WorkflowSeedSpec = {
    title: string;
    description: string;
    priority: "low" | "medium" | "high";
    type:
        | "theme"
        | "initiative"
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
    workflowSourceState?: string;
    workflowTargetState?: string;
    executionContext?: Record<string, unknown>;
    isDecider?: boolean;
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
            "theme",
            "initiative",
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
        development: "senior-developer",
        "integration-testing": "qa-specialist",
    };
    return mapping[normalized] ?? profileName;
};

const QA_RUN_TRANSITIONS = new Set([
    "run-lint",
    "run-typecheck",
    "run-unit-tests",
    "run-e2e-tests",
    "ensure-coverage",
]);

const QA_FAILURE_TRANSITIONS = new Set([
    "lint-failed",
    "typecheck-failed",
    "unit-tests-failed",
    "e2e-tests-failed",
    "coverage-failed",
]);

const QA_WORKFLOW_STATES = new Set([
    "lint-completed",
    "typecheck-completed",
    "unit-tests-completed",
    "e2e-tests-completed",
    "coverage-completed",
]);

const isQaRunTransition = (transition: string): boolean =>
    QA_RUN_TRANSITIONS.has(transition);

const isQaFailureTransition = (transition: string): boolean =>
    QA_FAILURE_TRANSITIONS.has(transition);

const shouldEnforceWorkflowProfile = (
    workflowState: RuntimeState | null,
    workflowTransition?: string | null,
): boolean => {
    if (workflowState?.profile) {
        return true;
    }
    if (workflowState?.name && QA_WORKFLOW_STATES.has(workflowState.name)) {
        return true;
    }
    if (workflowState?.name === "features-prioritized") {
        return true;
    }
    if (workflowState?.name === "themes-prioritized") {
        return true;
    }
    if (workflowState?.name === "initiatives-prioritized") {
        return true;
    }
    return (
        workflowTransition === "review-task-validity" ||
        workflowTransition === "close-invalid-task" ||
        workflowTransition === "prioritize-features" ||
        workflowTransition === "prioritize-themes" ||
        workflowTransition === "prioritize-initiatives" ||
        workflowTransition === "prioritize-stories"
    );
};

const resolveProfile = (
    profileManager: ProfileManager,
    profileName: string,
): ACPProfile | undefined => {
    const mapped = resolveWorkflowProfileName(profileName);
    return profileManager.getProfile(mapped) ?? profileManager.getProfile(profileName);
};

const selectPromptFiles = (
    profile: ACPProfile,
    task: WorkflowTask,
    workflowTransition?: string | null,
): string[] => {
    const title = task.title ?? "";
    const description = task.description ?? "";
    const text = `${title} ${description}`;
    const transition = (workflowTransition ?? "").trim().toLowerCase();
    const failureTransition = isQaFailureTransition(transition);

    const hasRefactor = /refactor|cleanup|maintenance/i.test(text);
    const hasDocs = /doc|documentation|readme/i.test(text);
    const hasTests = /test|coverage|qa|regression/i.test(text);
    const hasArchitecture = /architecture|design/i.test(text);

    const unique = (files: string[]): string[] =>
        files.reduce<string[]>((acc, file) => (acc.includes(file) ? acc : [...acc, file]), []);
    const baselineFiles = ["mcp-tool-calling.md"];

    switch (profile.name) {
        case "senior-developer": {
            if (failureTransition) {
                return unique([
                    ...baselineFiles,
                    "implementation-development.md",
                    "testing-quality.md",
                ]);
            }
            const files = [...baselineFiles, "implementation-development.md"];
            if (hasRefactor) files.push("refactoring-maintenance.md");
            if (hasDocs) files.push("documentation-knowledge.md");
            if (hasTests) files.push("testing-quality.md");
            if (hasArchitecture) files.push("architecture-planning.md");
            return unique(files);
        }
        case "qa-specialist": {
            return unique([...baselineFiles, "testing-quality.md"]);
        }
        case "principal-architect": {
            return unique([...baselineFiles, "architecture-planning.md", "implementation-development.md"]);
        }
        case "refinement": {
            const files = [...baselineFiles, "implementation-development.md"];
            if (hasArchitecture) files.push("architecture-planning.md");
            if (hasTests) files.push("testing-quality.md");
            return unique(files);
        }
        case "project-manager": {
            return unique(hasArchitecture ? [...baselineFiles, "architecture-planning.md"] : baselineFiles);
        }
        case "ux-specialist": {
            return unique(hasDocs ? [...baselineFiles, "documentation-knowledge.md"] : baselineFiles);
        }
        case "ux-researcher": {
            return unique(hasDocs ? [...baselineFiles, "documentation-knowledge.md"] : baselineFiles);
        }
        case "product-manager": {
            return baselineFiles;
        }
        default:
            return baselineFiles;
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

const isCodingProfile = (profileName: string): boolean => {
    const codingProfiles = new Set([
        "development",
        "senior-developer",
        "qa-specialist",
        "principal-architect",
        "refinement",
    ]);
    return codingProfiles.has(profileName);
};

const buildProjectRules = (profileName: string): string => {
    const rules = [
        "Project rules:",
        "- Follow AGENTS.md and the repository conventions.",
        "- Do not restart the daemon directly; use the restart_daemon MCP tool.",
    ];
    if (isCodingProfile(profileName)) {
        return [
            ...rules,
            "- Use 4-space indentation.",
            "- Use double quotes for strings.",
            "- Prefer functional style; avoid mutating data.",
            "- Prefer @tsimpl struct/trait/impl; avoid interfaces and type casts.",
            "- Node ESM with no transpilation: include `.ts` on local imports.",
        ].join("\n");
    }
    return rules.join("\n");
};

const STRICT_OUTPUT_TRANSITIONS = new Set([
    "review-task-validity",
    "close-invalid-task",
    "review-story-coverage",
]);

const shouldRequireDefaultSummary = (workflowTransition?: string | null): boolean => {
    const normalized = (workflowTransition ?? "").trim().toLowerCase();
    if (normalized.length === 0) {
        return true;
    }
    return !STRICT_OUTPUT_TRANSITIONS.has(normalized);
};

const buildTransitionSopSection = (
    workflowState: RuntimeState | null,
    workflowTransition?: string | null,
    executionContext?: Record<string, unknown>,
): string => {
    const transition = (workflowTransition ?? "").trim();
    if (transition.length === 0) {
        return "";
    }
    const isDeciderTurn = executionContext?.isDecider === true;
    const stateName = workflowState?.name ?? "unknown";
    const role = isDeciderTurn ? "decider" : "transition-executor";
    return [
        "Workflow execution context:",
        `- state: ${stateName}`,
        `- transition: ${transition}`,
        `- role: ${role}`,
        "- Execute this transition only; do not branch to unrelated work.",
        "- Prefer prefetched context/tasks over extra read calls when equivalent.",
        "- Minimize tool calls: one read phase, then required writes.",
        "- Use exact tool names shown by ACP runtime; never invent naming variants.",
    ].join("\n");
};

const collectAvailableMcpTools = (profile: ACPProfile): string[] => {
    const servers = Array.isArray(profile.mcpServers) ? profile.mcpServers : [];
    const toolNames = servers.flatMap((server) =>
        Array.isArray(server.tools) ? server.tools : [],
    );
    return toolNames.reduce<string[]>(
        (acc, tool) => (acc.includes(tool) ? acc : [...acc, tool]),
        [],
    );
};

const uniqueStrings = (values: string[]): string[] =>
    values.reduce<string[]>(
        (acc, value) => (acc.includes(value) ? acc : [...acc, value]),
        [],
    );

const resolveTransitionRequiredBaseTools = (workflowTransition?: string | null): string[] => {
    const transition = (workflowTransition ?? "").trim().toLowerCase();
    if (
        transition === "prioritize-features"
        || transition === "prioritize-themes"
        || transition === "prioritize-initiatives"
        || transition === "prioritize-stories"
    ) {
        return ["list_tasks", "update_task_priority"];
    }
    if (
        transition === "retry-theme-research"
        || transition === "research-new-themes"
        || transition === "define-initiatives"
        || transition === "retry-initiative-research"
        || transition === "retry-product-research"
        || transition === "research-new-features"
        || transition === "do-ux-research"
    ) {
        return ["list_tasks", "get_task", "create_task", "update_task"];
    }
    if (transition === "refine-into-tasks" || transition === "need-more-tasks") {
        return [
            "list_tasks",
            "get_task",
            "get_file_context",
            "create_task",
            "update_task",
            "update_task_status",
        ];
    }
    if (transition === "begin-implementation") {
        return ["update_task_status", "get_file_context", "update_context"];
    }
    if (isQaFailureTransition(transition)) {
        return ["update_task_status", "get_file_context"];
    }
    if (isQaRunTransition(transition)) {
        return ["update_context", "get_file_context"];
    }
    if (transition === "close-invalid-task") {
        return ["update_task_status"];
    }
    if (transition === "review-task-validity" || transition === "review-story-coverage") {
        return ["list_tasks", "get_task"];
    }
    if (transition === "pick-up-next-task") {
        return ["list_tasks", "get_task"];
    }
    return [
        "list_tasks",
        "get_task",
        "create_task",
        "update_task",
        "update_task_status",
        "get_file_context",
        "update_context",
    ];
};

const filterToolsByRequiredSet = (
    tools: string[],
    requiredTools: string[],
): string[] => {
    if (requiredTools.length === 0) {
        return tools;
    }
    const requiredSet = new Set(requiredTools);
    return tools.filter((tool) => requiredSet.has(tool));
};

const collectLikelyExactMcpToolNames = (
    profile: ACPProfile,
    requiredTools: string[] = [],
): string[] => {
    const servers = Array.isArray(profile.mcpServers) ? profile.mcpServers : [];
    const names = servers.flatMap((server) => {
        const serverName = typeof server.name === "string" ? server.name.trim() : "";
        if (serverName.length === 0 || !Array.isArray(server.tools)) {
            return [];
        }
        const filteredTools = filterToolsByRequiredSet(server.tools, requiredTools);
        return filteredTools.flatMap((tool) => {
            if (typeof tool !== "string" || tool.trim().length === 0) {
                return [];
            }
            const base = tool.trim();
            return [
                `functions.mcp__${serverName}__${base}`,
                `functions.mcp__${serverName.replace(/-/g, "_")}__${base}`,
            ];
        });
    });
    return uniqueStrings(names);
};

const collectMcpOperationMappings = (
    profile: ACPProfile,
    requiredTools: string[] = [],
): string[] => {
    const servers = Array.isArray(profile.mcpServers) ? profile.mcpServers : [];
    const mappings = servers.flatMap((server) => {
        const serverName = typeof server.name === "string" ? server.name.trim() : "";
        if (serverName.length === 0 || !Array.isArray(server.tools)) {
            return [];
        }
        const filteredTools = filterToolsByRequiredSet(server.tools, requiredTools);
        return filteredTools.flatMap((tool) => {
            if (typeof tool !== "string" || tool.trim().length === 0) {
                return [];
            }
            const base = tool.trim();
            return [`${base} => functions.mcp__${serverName}__${base}`];
        });
    });
    return uniqueStrings(mappings);
};

const buildTransitionMcpPlaybook = (workflowTransition?: string | null): string => {
    const transition = (workflowTransition ?? "").trim().toLowerCase();
    if (!transition) {
        return [
            "MCP transition playbook:",
            "- Read first, write second, verify last.",
            "- Use list/get tools to gather facts before update/create tools.",
            "- Only call write tools when you know the target id and intended change.",
        ].join("\n");
    }
    if (
        transition === "prioritize-features"
        || transition === "prioritize-themes"
        || transition === "prioritize-initiatives"
        || transition === "prioritize-stories"
    ) {
        return [
            "MCP transition playbook:",
            "- Call list_tasks once to fetch active candidates.",
            "- Expect list output in the form `Found <n> tasks:` followed by JSON task records.",
            "- Call update_task_priority only for selected tasks with changed priority.",
            "- Expect update output: `Task priority updated successfully: {...}`.",
            "- If the read succeeds but no eligible items exist, return `none` output and stop without extra reads.",
        ].join("\n");
    }
    if (transition === "refine-into-tasks" || transition === "need-more-tasks") {
        return [
            "MCP transition playbook:",
            "- Call list_tasks/get_task to inspect the selected story and its child tasks first.",
            "- Use get_file_context for key code paths when available so implementation tickets can cite concrete files and interactions.",
            "- If the story acceptance criteria are already fully covered and all child tasks are done/invalid, call update_task_status to mark the story `done` and create zero tasks.",
            "- Otherwise create only the missing tasks, then use update_task to merge dependencies.",
            "- Expect update_task_status output: `Task status updated successfully: {...}`.",
            "- Expect create/update outputs containing `... successfully: {...}` JSON payloads.",
        ].join("\n");
    }
    if (
        transition === "retry-theme-research"
        || transition === "research-new-themes"
        || transition === "define-initiatives"
        || transition === "retry-initiative-research"
        || transition === "retry-product-research"
        || transition === "research-new-features"
        || transition === "do-ux-research"
    ) {
        return [
            "MCP transition playbook:",
            "- Use create_task for each new item, then list_tasks to verify creation.",
            "- Use get_task when you need current dependencies/details before update_task.",
            "- Use update_task to merge dependencies or metadata after creation.",
            "- Expect create/update outputs containing `... successfully: {...}` JSON payloads.",
        ].join("\n");
    }
    if (transition === "begin-implementation" || isQaFailureTransition(transition)) {
        return [
            "MCP transition playbook:",
            "- Call update_task_status to set `in-progress` at start.",
            "- Start from the provided failure packet; validate root cause before broad code edits.",
            "- When inspecting/editing an important file, call get_file_context with filePath, operation, taskId, reason, relatedFiles, todos.",
            "- Expect get_file_context output with context JSON and `headerUpdated: true|false`.",
            "- Re-run the minimal failing scope first before wider regression checks.",
            "- Keep task status in-progress until QA confirms tests passing.",
        ].join("\n");
    }
    if (isQaRunTransition(transition)) {
        return [
            "MCP transition playbook:",
            "- Run the stage-specific quality command, then call update_context with testStatus/testReport.",
            "- Expect update_context output: `Context updated: {...}`.",
            "- Do not call update_task_status in QA run transitions; workflow controls lifecycle state.",
        ].join("\n");
    }
    if (transition === "close-invalid-task") {
        return [
            "MCP transition playbook:",
            "- Call update_task_status with status `invalid` and changedBy actor.",
            "- Expect output: `Task status updated successfully: {...}`.",
        ].join("\n");
    }
    if (transition === "pick-up-next-task") {
        return [
            "MCP transition playbook:",
            "- This is a control transition: pick the next existing implementation task only.",
            "- Do not call create_task/update_task/update_task_status in this transition.",
            "- If no runnable implementation task exists, do not fabricate work; return control to decider flow.",
        ].join("\n");
    }
    return [
        "MCP transition playbook:",
        "- Read with list/get tools before mutating state.",
        "- Apply minimal writes with update/create tools.",
        "- Verify final state with list/get tools when required by the step.",
    ].join("\n");
};

const buildMcpToolingSection = (
    profile: ACPProfile,
    workflowTransition?: string | null,
): string => {
    const requiredBaseTools = resolveTransitionRequiredBaseTools(workflowTransition);
    const availableTools = filterToolsByRequiredSet(
        collectAvailableMcpTools(profile),
        requiredBaseTools,
    );
    const likelyExactToolNames = collectLikelyExactMcpToolNames(profile, requiredBaseTools);
    const operationMappings = collectMcpOperationMappings(profile, requiredBaseTools);
    const availableToolLine = availableTools.length > 0
        ? `Declared MCP tool intents (${availableTools.length}, base names): ${availableTools.join(", ")}`
        : "Declared MCP tool intents: not declared for this profile.";
    const exactToolLine = likelyExactToolNames.length > 0
        ? `Likely exact MCP tool names for this runtime: ${likelyExactToolNames.join(", ")}`
        : "Likely exact MCP tool names: not available.";
    const operationMappingSection = operationMappings.length > 0
        ? [
            "Base operation -> exact tool mapping:",
            ...operationMappings.map((mapping) => `- ${mapping}`),
        ].join("\n")
        : "Base operation -> exact tool mapping: unavailable.";
    const isOpencodeRuntime = profile.runtimeName === "opencode";
    const callFormat = isOpencodeRuntime
        ? [
            "MCP tool calling SOP (Opencode runtime):",
            "- The ACP-exposed tool list is authoritative; use the bare tool names provided.",
            "- Do not attempt to call functions.mcp__* names; they are not exposed in command transport.",
            "- Only use the visible tool names (e.g., task-manager_list_tasks) with JSON arguments.",
            "- Limit tool calls to those required for the transition.",
            `Transition-required base operations: ${requiredBaseTools.join(", ")}`,
            availableToolLine,
            exactToolLine,
            "Common tool output expectations:",
            "- list_tasks/list_contexts: summary text plus JSON-like record lists.",
            "- get_task/get_context/get_file_context: full record payloads (id, fields, timestamps).",
            "- create_task/create_context: created record payload with generated id.",
            "- update_* / replace_context: updated record payload reflecting applied changes.",
            "",
            buildTransitionMcpPlaybook(workflowTransition),
        ]
        : [
            "MCP tool calling SOP:",
            "- The ACP-exposed tool list is authoritative for this turn.",
            "- Treat that list as available context; do not claim the tool list is inaccessible when tools are visible.",
            "- First, inspect the ACP-exposed tool list for this turn and resolve exact names.",
            "- Map each required base tool name to the exact runtime tool name (often `functions.mcp__<server>__<tool>`, e.g. `functions.mcp__task-manager__list_tasks`).",
            "- Do not call bare base names (like `list_tasks`) unless that exact bare name is visible.",
            "- If a mapped exact tool name is visible, MCP is available for that operation.",
            "- Never report `list_tasks`/`get_task` missing when `functions.mcp__task-manager__list_tasks`/`functions.mcp__task-manager__get_task` are visible.",
            "- For task transitions, do not use MCP resource-discovery calls (`codex/list_mcp_resources`, `*/read_mcp_resource`) as substitutes for task-manager operation tools.",
            "- Call tools only when needed to satisfy this transition.",
            "- Use exactly the tool name exposed in this ACP turn.",
            "- Provide a JSON object as arguments; avoid markdown wrappers or pseudo-code.",
            "- Only report a tool as missing when the specific required name is absent from the visible ACP tool list.",
            `Transition-required base operations: ${requiredBaseTools.join(", ")}`,
            availableToolLine,
            exactToolLine,
            operationMappingSection,
            "",
            "Common tool output expectations:",
            "- list_tasks/list_contexts: summary text plus JSON-like record lists.",
            "- get_task/get_context/get_file_context: full record payloads (id, fields, timestamps).",
            "- create_task/create_context: created record payload with generated id.",
            "- update_* / replace_context: updated record payload reflecting applied changes.",
            "",
            buildTransitionMcpPlaybook(workflowTransition),
        ];
    return callFormat.join("\n");
};

const buildProfilePrompt = async (
    root: string,
    profile: ACPProfile,
    task: WorkflowTask,
    workflowState: RuntimeState | null,
    workflowTransition?: string | null,
    executionContext?: Record<string, unknown>,
): Promise<string> => {
    const transition = (workflowTransition ?? "").trim().toLowerCase();
    const isFailureTransition = isQaFailureTransition(transition);
    const promptFiles = selectPromptFiles(profile, task, workflowTransition);
    const promptBlocks = await loadPromptBlocks(root, promptFiles);
    const workflowHint =
        workflowState?.promptHint && workflowState.profile === profile.name
            ? `Workflow hint: ${workflowState.promptHint}`
            : "";
    const prefetchedOutput =
        executionContext && typeof executionContext.prefetchedMcpOutput === "string"
            ? executionContext.prefetchedMcpOutput.trim()
            : "";
    const prefetchedSection =
        prefetchedOutput.length > 0
            ? [
                "Prefetched MCP data (latest output; equivalent to running list_tasks now):",
                prefetchedOutput,
                "If you need fresher data, you may call list_tasks again.",
            ].join("\n")
            : "";
    const prefetchedTaskContext =
        executionContext && typeof executionContext.prefetchedTaskContext === "string"
            ? executionContext.prefetchedTaskContext.trim()
            : "";
    const prefetchedTaskSection =
        prefetchedTaskContext.length > 0
            ? ["Selected task context:", prefetchedTaskContext].join("\n")
            : "";
    const prefetchedTestReport =
        executionContext && typeof executionContext.prefetchedTestReport === "string"
            ? executionContext.prefetchedTestReport.trim()
            : "";
    const prefetchedTestReportSection =
        prefetchedTestReport.length > 0
            ? ["Test report (from workflow context):", prefetchedTestReport].join("\n")
            : "";
    const prefetchedFailurePacket =
        executionContext && typeof executionContext.prefetchedFailurePacket === "string"
            ? executionContext.prefetchedFailurePacket.trim()
            : "";
    const prefetchedFailurePacketSection =
        prefetchedFailurePacket.length > 0
            ? [
                "High-priority QA failure packet:",
                "Treat this as the primary remediation input for this transition.",
                prefetchedFailurePacket,
            ].join("\n")
            : "";
    const prefetchedMechanicalTestResults =
        executionContext && typeof executionContext.prefetchedMechanicalTestResults === "string"
            ? executionContext.prefetchedMechanicalTestResults.trim()
            : "";
    const prefetchedMechanicalTestResultsSection =
        prefetchedMechanicalTestResults.length > 0
            ? [
                "Mechanical preflight already executed before this agent session.",
                "Context object keys: `mechanicalQaPreflightResults` (primary), `mechanicalTestLintResults` (legacy alias).",
                prefetchedMechanicalTestResults,
            ].join("\n")
            : "";
    const promptSection =
        !isFailureTransition && promptBlocks.length > 0
            ? ["Reference prompts:", ...promptBlocks].join("\n")
            : "";
    const projectRules = buildProjectRules(profile.name);
    const transitionSopSection = buildTransitionSopSection(
        workflowState,
        workflowTransition,
        executionContext,
    );
    const mcpToolingSection = buildMcpToolingSection(profile, workflowTransition);
    const summaryInstruction = shouldRequireDefaultSummary(workflowTransition)
        ? "At the end of your response, include `Summary:` with 1-2 sentences describing what you completed."
        : "";
    const remediationPriorityDirective = isFailureTransition
        ? [
            "Root-cause remediation directive:",
            "- Prioritize fixing the concrete failing checks in the failure packet before unrelated improvements.",
            "- Prefer minimal, targeted changes until the failing scope is green.",
            "- If evidence conflicts, resolve it with the smallest deterministic repro run.",
        ].join("\n")
        : "";
    const profileTaskPrompt = profile.getTaskPrompt({
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
        ...executionContext,
    });
    const resolutionGuardrails = isCodingProfile(profile.name)
        ? [
            "If you discover the task is already implemented, say so and propose a better-scoped follow-up.",
            "If you lack permission to read files, say so and proceed with the task using the context available.",
            "If command execution or tool calls are blocked by a sandbox, say so explicitly and provide exact commands for QA or a human to run.",
        ].join("\n")
        : "If a required MCP tool is genuinely absent from the visible tool list, say which one is missing and proceed with the context available.";
    const instructions = [
        profile.systemPrompt.trim(),
        "",
        transitionSopSection,
        remediationPriorityDirective,
        mcpToolingSection,
        workflowHint,
        prefetchedFailurePacketSection,
        prefetchedTaskSection,
        prefetchedTestReportSection,
        prefetchedMechanicalTestResultsSection,
        prefetchedSection,
        promptSection,
        projectRules,
        resolutionGuardrails,
        summaryInstruction,
        "",
        profileTaskPrompt,
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
    workflowSourceState?: string;
    workflowTargetState?: string;
    workflowTransition?: string;
    isDecider?: boolean;
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

const transitionRequiresMcpExecution = (workflowTransition?: string): boolean => {
    const transition = (workflowTransition ?? "").trim().toLowerCase();
    if (transition.length === 0) {
        return false;
    }
    if (
        transition === "review-task-validity"
        || transition === "review-story-coverage"
        || transition === "pick-up-next-task"
    ) {
        return false;
    }
    return true;
};

type MappedMcpToolCall = {
    server: string;
    tool: string;
};

const normalizeMcpServerName = (value: string): string => {
    const normalized = value.trim().toLowerCase();
    if (normalized === "task_manager") {
        return "task-manager";
    }
    return normalized;
};

const parseMappedMcpToolCallFromTitle = (title: string): MappedMcpToolCall | null => {
    const trimmed = title.trim();
    if (trimmed.length === 0) {
        return null;
    }
    const candidates = [
        trimmed,
        trimmed.replace(/^Tool:\s*/i, "").trim(),
    ].filter((candidate, index, list) => candidate.length > 0 && list.indexOf(candidate) === index);
    for (const candidate of candidates) {
        const cleaned = candidate
            .replace(/^`+|`+$/g, "")
            .replace(/[,:;)\]]+$/, "")
            .trim();
        if (cleaned.length === 0) {
            continue;
        }

        const codexMcpFormatted = cleaned.match(
            /^(?:functions\.)?mcp__([a-z0-9_-]+)__([a-z0-9_-]+)$/i,
        );
        if (codexMcpFormatted) {
            const server = normalizeMcpServerName(codexMcpFormatted[1] ?? "");
            const tool = (codexMcpFormatted[2] ?? "").trim();
            if (server.length > 0 && tool.length > 0) {
                return { server, tool };
            }
        }

        const slashFormatted = cleaned.match(/^([a-z0-9_-]+)\/([a-z0-9_-]+)$/i);
        if (slashFormatted) {
            const server = normalizeMcpServerName(slashFormatted[1] ?? "");
            const tool = (slashFormatted[2] ?? "").trim();
            if (server.length > 0 && tool.length > 0) {
                return { server, tool };
            }
        }

        const taskManagerUnderscore = cleaned.match(/^(task[-_]manager)_([a-z0-9_-]+)$/i);
        if (taskManagerUnderscore) {
            const server = normalizeMcpServerName(taskManagerUnderscore[1] ?? "");
            const tool = (taskManagerUnderscore[2] ?? "").trim();
            if (server.length > 0 && tool.length > 0) {
                return { server, tool };
            }
        }

        const opencodeFormatted = cleaned.match(/^([a-z0-9_-]+)_([a-z0-9_-]+)$/i);
        if (opencodeFormatted) {
            const server = normalizeMcpServerName(opencodeFormatted[1] ?? "");
            const tool = (opencodeFormatted[2] ?? "").trim();
            if (server.length > 0 && tool.length > 0) {
                return { server, tool };
            }
        }
    }
    return null;
};

const extractMcpToolCallFromName = (name: string): MappedMcpToolCall | null =>
    parseMappedMcpToolCallFromTitle(name);

const extractMappedMcpToolCallsFromTitles = (titles: string[]): MappedMcpToolCall[] =>
    titles
        .map((title) => parseMappedMcpToolCallFromTitle(title))
        .filter((entry): entry is MappedMcpToolCall => entry !== null);

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
    runtimeName?: string,
    acpMode?: string,
    acpSandbox?: string,
    acpApprovalPolicy?: string,
    mcpServers?: ACPProfile["mcpServers"],
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
        {
            environment,
            modelName,
            runtimeName,
            modeName: acpMode,
            sandbox: acpSandbox,
            approvalPolicy: acpApprovalPolicy,
            mcpServers,
        },
    );
    session.taskClient.profileName = profileName;
    session.taskClient.sessionId = session.sessionId;
    session.taskClient.requestedModelName = modelName ?? null;
    if (turnContext) {
        session.taskClient.taskId = turnContext.taskId ?? null;
        session.taskClient.taskTitle = turnContext.taskTitle ?? null;
        session.taskClient.taskType = turnContext.taskType ?? null;
        session.taskClient.taskStatus = turnContext.taskStatus ?? null;
        session.taskClient.workflowState = turnContext.workflowState ?? null;
        session.taskClient.workflowSourceState = turnContext.workflowSourceState ?? null;
        session.taskClient.workflowTargetState = turnContext.workflowTargetState ?? null;
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
        const runTurn = async (promptText: string): Promise<{
            completion: { output: string; error: string };
            reportedModelName: string;
            stopReason: string | null;
            mcpToolCallCount: number;
            nonMcpToolCallCount: number;
            toolCallTitles: string[];
        }> => {
            session.taskClient.beginNewTurn();
            const completionCountStart = session.taskClient.turnCompletionCount;
            const promptResult = await sendPrompt(
                session.connection,
                session.sessionId,
                promptText,
                session.taskClient,
            );
            const completion = await waitForTaskCompletion(session.taskClient, 600000, profileName);
            if (session.taskClient.turnCompletionCount === completionCountStart) {
                await session.taskClient.sessionUpdate({
                    sessionId: session.sessionId,
                    update: {
                        sessionUpdate: "turn_complete",
                        status: completion.error ? "error" : "completed",
                        reason: completion.error || undefined,
                    },
                });
            }
            const reportedModelName =
                (promptResult && readModelNameFromResult(promptResult)) ??
                resolveModelFromEnv() ??
                "unknown-model";
            if (reportedModelName === "unknown-model" && modelName) {
                console.warn(
                    `[ACP] Model name not reported by runtime; requested=${modelName}`,
                );
            }
            session.taskClient.modelName = reportedModelName;
            return {
                completion,
                reportedModelName,
                stopReason: session.taskClient.stopReason,
                mcpToolCallCount: session.taskClient.turnMcpToolCallCount,
                nonMcpToolCallCount: session.taskClient.turnNonMcpToolCallCount,
                toolCallTitles: [...session.taskClient.turnToolCallTitles],
            };
        };

        const parsedMcpTools = (session.taskClient.mcpTools ?? [])
            .map((name) => ({
                name,
                mapped: extractMcpToolCallFromName(name),
            }))
            .filter(
                (entry): entry is { name: string; mapped: MappedMcpToolCall } =>
                    entry.mapped !== null,
            );
        const taskManagerToolNames = parsedMcpTools
            .filter((entry) => entry.mapped.server === "task-manager")
            .map((entry) => entry.name);
        const hasTaskManagerTools = taskManagerToolNames.length > 0;
        const requiredBaseToolsForTransition = resolveTransitionRequiredBaseTools(
            turnContext?.workflowTransition,
        );
        const exactTaskManagerNames = taskManagerToolNames;
        const exactRequiredTaskManagerNames = uniqueStrings(
            parsedMcpTools
                .filter(
                    (entry) =>
                        entry.mapped.server === "task-manager"
                        && requiredBaseToolsForTransition.includes(entry.mapped.tool),
                )
                .map((entry) => entry.name),
        );
        const extractTurnTaskManagerTools = (
            currentTurn: {
                toolCallTitles: string[];
            },
        ): string[] =>
            extractMappedMcpToolCallsFromTitles(currentTurn.toolCallTitles)
                .filter((call) => call.server === "task-manager")
                .map((call) => call.tool);
        const hasRequiredTaskManagerToolCall = (
            currentTurn: {
                toolCallTitles: string[];
            },
        ): boolean => {
            const calledTaskManagerTools = extractTurnTaskManagerTools(currentTurn);
            return calledTaskManagerTools.some((tool) => requiredBaseToolsForTransition.includes(tool));
        };
        const turn = await runTurn(prompt);
        const requiresMcpExecution = transitionRequiresMcpExecution(
            turnContext?.workflowTransition,
        );
        const missingRequiredTaskManagerCall =
            requiresMcpExecution
            && hasTaskManagerTools
            && !hasRequiredTaskManagerToolCall(turn)
            && (turn.mcpToolCallCount > 0 || turn.nonMcpToolCallCount > 0);
        const missingRequiredTaskManagerCallWithoutRetry =
            requiresMcpExecution
            && hasTaskManagerTools
            && !hasRequiredTaskManagerToolCall(turn)
            && (missingRequiredTaskManagerCall || turn.mcpToolCallCount === 0);
        if (missingRequiredTaskManagerCallWithoutRetry) {
            const observedMappedCalls = uniqueStrings(
                extractMappedMcpToolCallsFromTitles(turn.toolCallTitles).map(
                    (entry) => `${entry.server}/${entry.tool}`,
                ),
            );
            const combined = `${turn.completion.output}\n${turn.completion.error}`.toLowerCase();
            const likelyFalseMissingMcpDiagnosis =
                hasTaskManagerTools
                && (
                    (
                        /(missing|required|unavailable|cannot|can't|unable|not available)/i.test(
                            combined,
                        )
                        && /(mcp|tool|list_tasks|get_task|task-manager)/i.test(combined)
                    )
                    || /(tool list|turnbox).*?(missing|unavailable|cannot|inaccessible)/i.test(
                        combined,
                    )
                );
            const requiredToolNamesSummary =
                exactRequiredTaskManagerNames.length > 0
                    ? exactRequiredTaskManagerNames.join(", ")
                    : (exactTaskManagerNames.slice(0, 40).join(", ") || "none");
            return {
                output: turn.completion.output,
                error: `MCP-required transition completed without a required task-manager operation call. Auto-retry is disabled; allowing workflow-level retry. Required operations: ${requiredBaseToolsForTransition.join(", ")}. Required exact tool names: ${requiredToolNamesSummary}. Observed tool calls: ${observedMappedCalls.join(", ") || "none"}.${likelyFalseMissingMcpDiagnosis ? " Likely false MCP-missing diagnosis detected in model output." : ""}`,
                modelName: turn.reportedModelName,
            };
        }
        if (
            turn.stopReason === "end_turn"
            && turn.completion.output.trim().length === 0
            && turn.completion.error.length === 0
        ) {
            const requested = modelName ? ` requested=${modelName}` : "";
            return {
                output: "",
                error: `ACP ended the turn without output.${requested} This usually indicates an invalid or unavailable model.`,
                modelName: turn.reportedModelName,
            };
        }
        await session.taskClient.sessionUpdate({
            sessionId: session.sessionId,
            update: {
                sessionUpdate: "session_meta",
                modelName: turn.reportedModelName,
                mcpTools: session.taskClient.mcpTools ?? undefined,
            },
        });
        return {
            output: turn.completion.output ?? "",
            error: turn.completion.error ?? "",
            modelName: turn.reportedModelName,
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
        "  \"type\": \"theme|initiative|feature|story|implementation|testing|task|integration|research\",",
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
        workflowSourceState,
        workflowTargetState,
        executionContext,
        isDecider,
    }) => {
        await profileManager.waitForProfileOverrides();
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

        const promptExecutionContext =
            typeof isDecider === "boolean"
                ? {
                    ...(executionContext ?? {}),
                    isDecider,
                }
                : executionContext;

        const prompt = await buildProfilePrompt(
            workspaceRoot,
            profile,
            task,
            workflowState,
            workflowTransition,
            promptExecutionContext,
        );
        const startTime = Date.now();
        profileManager.startTaskProcessing(profile.name);
        try {
            const completion = await executePrompt(
                profile.name,
                prompt,
                "read-write",
                environment,
                profile.modelName,
                {
                    taskId: task.id,
                    taskTitle: task.title,
                    taskType: task.type,
                    taskStatus: task.status,
                    workflowState: workflowState?.name,
                    workflowSourceState: workflowSourceState ?? workflowState?.name,
                    workflowTargetState: workflowTargetState ?? workflowState?.name,
                    workflowTransition: workflowTransition ?? undefined,
                    isDecider: isDecider ?? undefined,
                },
                profile.runtimeName,
                profile.acpMode,
                profile.acpSandbox,
                profile.acpApprovalPolicy,
                profile.mcpServers,
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
        await profileManager.waitForProfileOverrides();
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
            const completion = await executePrompt(
                profile.name,
                prompt,
                "read-only",
                undefined,
                undefined,
                {
                    taskType: workflowState?.targetType,
                    workflowState: workflowState?.name,
                    workflowTransition: workflowState?.defaultTransition,
                },
                profile.runtimeName,
                profile.acpMode,
                profile.acpSandbox,
                profile.acpApprovalPolicy,
            );
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
