// TODO: This file is too complex (1092 lines) and should be refactored into several modules.
// Current concerns mixed: Profile definitions, profile state management, metrics calculation,
// multiple profile implementations (ProductManager, Developer, QA, etc.), system prompts.
//
// Proposed structure:
// - profiles/types.ts - Core profile interfaces and types
// - profiles/base-profile.ts - Abstract base profile class
// - profiles/implementations/ - Individual profile implementations
//   - product-manager-profile.ts, developer-profile.ts, qa-profile.ts, etc.
// - profiles/state-manager.ts - Profile state tracking and management
// - profiles/metrics-service.ts - Profile metrics calculation and reporting
// - profiles/prompt-service.ts - System prompt management and templates
// - profiles/index.ts - Profile factory and registration

/* eslint-disable no-unused-vars, @typescript-eslint/no-unused-vars */
import { existsSync } from "node:fs";
import path from "node:path";
import { Level } from "level";

export type ProfilePrincipalType = "agent" | "service" | "user";

export interface ACPProfile {
    getTaskPrompt: (context: Record<string, unknown>) => string;
    name: string;
    role: string;
    systemPrompt: string;
    principalType: ProfilePrincipalType;
    modelName?: string;
    runtimeName?: string;
    acpMode?: string;
    acpSandbox?: string;
    acpApprovalPolicy?: string;
    mcpServers?: ProfileMcpServerEntry[];
    capabilities?: string[];
    maxConcurrentTasks?: number;
    priority?: number;
    color?: string;
    icon?: string;
}

export type ProfileMcpServerEntry = {
    name: string;
    command?: string;
    args?: string[];
    env?: Record<string, string> | Array<{ name: string; value: string }>;
    type?: "http" | "sse";
    url?: string;
    headers?: Record<string, string> | Array<{ name: string; value: string }>;
    tools?: string[];
};

const defaultProfileMcpTools: string[] = [
    "check_daemon_status",
    "start_daemon",
    "create_task",
    "list_tasks",
    "get_task",
    "update_task",
    "update_task_status",
    "update_task_priority",
    "delete_task",
    "create_context",
    "get_context",
    "get_file_context",
    "update_context",
    "replace_context",
    "delete_context",
    "list_contexts",
    "restart_daemon",
    "create_template",
    "list_templates",
    "get_template",
    "create_task_from_template",
    "initialize_templates",
    "create_automation_rule",
    "list_automation_rules",
    "update_automation_rule",
    "delete_automation_rule",
    "reload_automation_rules",
];

const resolveDefaultMcpHttpUrl = (): string => {
    const fromEnv =
        process.env.ISOMORPHIQ_MCP_SERVER_URL
        ?? process.env.MCP_SERVER_URL
        ?? process.env.ISOMORPHIQ_MCP_HTTP_URL
        ?? process.env.MCP_HTTP_URL;
    if (fromEnv && fromEnv.trim().length > 0) {
        return fromEnv.trim();
    }
    const host =
        process.env.ISOMORPHIQ_MCP_HTTP_HOST
        ?? process.env.MCP_HTTP_HOST
        ?? "localhost";
    const portRaw =
        process.env.ISOMORPHIQ_MCP_HTTP_PORT
        ?? process.env.MCP_HTTP_PORT
        ?? "3100";
    const port = Number.parseInt(portRaw, 10);
    const pathValue =
        process.env.ISOMORPHIQ_MCP_HTTP_PATH
        ?? process.env.MCP_HTTP_PATH
        ?? "/mcp";
    const normalizedPath = pathValue.startsWith("/") ? pathValue : `/${pathValue}`;
    const resolvedPort = Number.isFinite(port) && port > 0 ? port : 3100;
    return `http://${host}:${resolvedPort}${normalizedPath}`;
};

const defaultProfileMcpServers: ProfileMcpServerEntry[] = [
    {
        name: "task-manager",
        type: "sse",
        url: resolveDefaultMcpHttpUrl(),
        command: "node",
        args: ["--experimental-strip-types", "packages/mcp/src/mcp-server.ts"],
        tools: defaultProfileMcpTools,
    },
];

const mcpToolNameRule = [
    "MCP tool-name SOP:",
    "- The ACP-exposed tool list for this turn is authoritative.",
    "- Resolve each base operation to the exact visible tool name before calling it.",
    "- In Codex ACP sessions, the exact names are typically `functions.mcp__task-manager__<tool>`.",
    "- Common mappings: list_tasks -> functions.mcp__task-manager__list_tasks, get_task -> functions.mcp__task-manager__get_task, create_task -> functions.mcp__task-manager__create_task, update_task_status -> functions.mcp__task-manager__update_task_status, get_file_context -> functions.mcp__task-manager__get_file_context.",
    "- Do not call bare names like `list_tasks` unless that exact bare name is visible in the turn.",
    "- MCP arguments must be a JSON object.",
].join("\n");

type PrioritizationSopPromptInput = {
    itemType: "theme" | "initiative" | "feature" | "story";
    itemLabelPlural: string;
    changedBy: string;
};

const buildPrioritizationSopPrompt = ({
    itemType,
    itemLabelPlural,
    changedBy,
}: PrioritizationSopPromptInput): string =>
    [
        `SOP: prioritize ${itemLabelPlural}.`,
        "",
        "Objective:",
        `- Set priority for at most 3 active ${itemLabelPlural}: high, medium, low.`,
        "- Never create tasks in this step.",
        "",
        "Procedure:",
        `1) If prefetched list_tasks output is present, use it. Otherwise call list_tasks with filters { \"type\": \"${itemType}\", \"status\": [\"todo\", \"in-progress\"] }.`,
        "2) Build candidate list from returned tasks only. Do not invent items.",
        "3) Rank candidates with deterministic tie-breakers:",
        "   a) Existing priority: high > medium > low > unspecified",
        "   b) Lower dependency count first",
        "   c) Lexicographic task id (stable final tie-break)",
        "4) Select top 3 (or fewer if fewer exist).",
        "5) Assign selected tasks to high, medium, low in rank order.",
        "6) Call update_task_priority only for selected tasks whose priority actually changes.",
        "7) Do not call list_tasks a second time unless the first read fails.",
        "",
        "Tool calls (JSON):",
        mcpToolNameRule,
        `- list_tasks: { \"filters\": { \"type\": \"${itemType}\", \"status\": [\"todo\", \"in-progress\"] } }`,
        `- update_task_priority: { \"id\": \"<task_id>\", \"priority\": \"high|medium|low\", \"changedBy\": \"${changedBy}\" }`,
        "",
        "Return exactly these lines:",
        "Summary: <one sentence>",
        `Top ${itemLabelPlural}: <id1>:high, <id2>:medium, <id3>:low (or \"none\")`,
        "Changes applied: <id>:<old>-><new>, ... (or \"none\")",
    ].join("\n");

const buildTaskValidityReviewPrompt = (
    title: string,
    description: string,
): string =>
    [
        "SOP: review ticket validity for implementation readiness.",
        "",
        "Task:",
        `${title} - ${description}`,
        "",
        "Decision checklist:",
        "- CLOSE if task appears synthetic/test-only/sample/placeholder.",
        "- CLOSE if no concrete problem, no expected outcome, or no acceptance criteria.",
        "- CLOSE if no real user or production impact is stated.",
        "- Otherwise PROCEED.",
        "",
        "Return exactly two lines:",
        "Decision: proceed | close",
        "Reason: <one concise sentence>",
    ].join("\n");

const buildCloseInvalidTaskPrompt = (
    title: string,
    description: string,
): string =>
    [
        "SOP: close this task as invalid and record one clear reason.",
        "",
        "Task:",
        `${title} - ${description}`,
        "",
        "Do this now:",
        "- Call update_task_status with status \"invalid\" and changedBy \"project-manager\".",
        mcpToolNameRule,
        "",
        "Return exactly two lines:",
        "Decision: close",
        "Reason: <one concise sentence>",
    ].join("\n");

const buildStoryCoveragePrompt = (
    title: string,
    description: string,
): string =>
    [
        "SOP: evaluate story coverage by existing implementation tasks.",
        "",
        "Task:",
        `${title} - ${description}`,
        "",
        "Decision checklist:",
        "- Choose proceed when acceptance criteria are fully covered by existing tasks.",
        "- Choose need-more-tasks only when specific acceptance criteria are missing or only partially covered.",
        "- Reference the concrete missing criteria in the reason.",
        "",
        "Return exactly two lines:",
        "Decision: proceed | need-more-tasks",
        "Reason: <one concise sentence>",
    ].join("\n");

export interface ProfileState {
	name: string;
	isActive: boolean;
	currentTasks: number;
	completedTasks: number;
	failedTasks: number;
	averageProcessingTime: number;
	lastActivity: Date;
	queueSize: number;
	isProcessing: boolean;
}

export interface ProfileMetrics {
	throughput: number; // tasks per hour
	successRate: number; // percentage
	averageTaskDuration: number; // in seconds
	queueWaitTime: number; // average time in queue
	errorRate: number; // percentage
}

export type EditableProfileConfiguration = {
    runtimeName?: string;
    modelName?: string;
    systemPrompt?: string;
    taskPromptPrefix?: string;
};

type PersistedProfileConfiguration = EditableProfileConfiguration & {
    updatedAt: string;
};

type ProfileDefaults = {
    runtimeName?: string;
    modelName?: string;
    systemPrompt: string;
    getTaskPrompt: (context: Record<string, unknown>) => string;
};

export type ProfileConfigurationSnapshot = {
    name: string;
    defaults: EditableProfileConfiguration;
    overrides: EditableProfileConfiguration;
    effective: EditableProfileConfiguration;
    updatedAt?: string;
};

const isLevelLockedError = (error: unknown): boolean => {
    if (!error || typeof error !== "object") {
        return false;
    }
    const record = error as Record<string, unknown>;
    if (record.code === "LEVEL_LOCKED") {
        return true;
    }
    const cause =
        record.cause && typeof record.cause === "object"
            ? (record.cause as Record<string, unknown>)
            : undefined;
    return cause?.code === "LEVEL_LOCKED";
};

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

const resolveProfileConfigDatabasePath = (): string => {
    const workspaceRoot = findWorkspaceRoot(process.env.INIT_CWD ?? process.cwd());
    const configuredDbBase = process.env.DB_PATH;
    const absoluteDbBase = configuredDbBase
        ? (path.isAbsolute(configuredDbBase)
            ? configuredDbBase
            : path.join(workspaceRoot, configuredDbBase))
        : path.join(workspaceRoot, "db");
    return path.join(absoluteDbBase, "profile-config");
};

/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class ProductManagerProfile implements ACPProfile {
	name = "product-manager";
	role = "Product Manager";
	principalType: ProfilePrincipalType = "agent";
    modelName = "lmstudio/qwen/qwen3-coder-next";
    runtimeName = "opencode";
    mcpServers = defaultProfileMcpServers;
	capabilities = ["analysis", "feature-identification", "user-story-creation", "prioritization"];
	maxConcurrentTasks = 3;
	priority = 1;
	color = "#3b82f6";
	icon = "📋";

	systemPrompt = `You are a Product Manager AI assistant. Your role is to:

1. Analyze the current codebase and understand its functionality
2. Think about how users would want to interact with this system
3. Identify valuable features that would improve user experience
4. Create clear, actionable feature tickets

Focus on:
- User experience improvements
- Missing functionality that users would expect
- Integration opportunities
- Quality of life enhancements

Create feature tickets with:
- Clear title and description
- User value proposition
- Acceptance criteria
- Priority level (high/medium/low)

Return your response as a structured list of feature tickets.

Consider what rules and conventions apply to this work, and under what circumstances breaking a rule or taking a shortcut might result in better quality, efficiency, or accuracy. When you identify such opportunities, explain your reasoning and proceed with the improved approach.

Take an aggressive posture in meeting your responsibilities. Defend your decisions and recommendations by any means necessary. Do not be passive—actively pursue the best outcomes even when it requires pushing boundaries or challenging assumptions.`;

	getTaskPrompt(context: Record<string, unknown>): string {
		const workflow = context?.workflow as { state?: string } | undefined;
        const transition =
            typeof context?.workflowTransition === "string"
                ? context.workflowTransition
                : undefined;
        const isProductResearch =
            transition === "retry-product-research" ||
            transition === "research-new-features" ||
            workflow?.state === "new-feature-proposed";
        const isFeaturePrioritization = transition === "prioritize-features";
        const isStoryPrioritization = transition === "prioritize-stories";
        if (isFeaturePrioritization) {
            return buildPrioritizationSopPrompt({
                itemType: "feature",
                itemLabelPlural: "features",
                changedBy: "product-manager",
            });
        }
        if (isStoryPrioritization) {
            return buildPrioritizationSopPrompt({
                itemType: "story",
                itemLabelPlural: "stories",
                changedBy: "product-manager",
            });
        }
        if (isProductResearch) {
            return `As a Product Manager, propose product features for the backlog.

Use MCP tool calls (create_task, list_tasks).
${mcpToolNameRule}
Do NOT output ticket text before tool calls.

Step-by-step:
1) Call create_task exactly once with JSON:
   { "title": "<feature request title>", "description": "<user value + acceptance criteria>", "type": "feature", "priority": "low|medium|high", "createdBy": "product-manager", "dependencies": ["<initiative_id_if_provided>"] }
2) Call list_tasks to confirm it exists.

If a Selected task context is provided and it is an initiative, include its id in the dependencies array.
If no initiative id is provided, omit dependencies or use an empty array.

Only if a required tool name is absent from the visible ACP tool list, say so explicitly.

Return a short summary after the tool calls.`;
		}
        return `As a Product Manager, analyze this task manager system and create feature tickets.

Current System Overview:
- Task manager daemon with ACP protocol execution
- Database storage with LevelDB
- TCP API on port 3001
- Continuous task processing loop
- Modular architecture with separate concerns

Please:
1. Examine the codebase structure and functionality
2. Identify user experience gaps and improvement opportunities
3. Create 3-5 feature tickets with clear descriptions and priorities
4. Focus on features that would make this system more useful for users

You MUST use MCP tool calls to create the feature tickets (create_task, list_tasks).
${mcpToolNameRule}
Do NOT output ticket text before tool calls.

- Call create_task once per feature.
- Include title and description (description is required by the tool).
- Include type: "feature", createdBy: "product-manager", and priority: low|medium|high.
- Put acceptance criteria in the description body.
- After creating, call list_tasks to confirm.

Only if a required tool name is absent from the visible ACP tool list, say so explicitly.

Return a short summary after the tool calls.`;
	}
}

/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class PortfolioManagerProfile implements ACPProfile {
    name = "portfolio-manager";
    role = "Portfolio Manager";
    principalType: ProfilePrincipalType = "agent";
    modelName = "lmstudio/qwen/qwen3-coder-next";
    runtimeName = "opencode";
    mcpServers = defaultProfileMcpServers;
    capabilities = ["portfolio-planning", "theme-identification", "initiative-definition", "prioritization"];
    maxConcurrentTasks = 2;
    priority = 1;
    color = "#14b8a6";
    icon = "🧭";

    systemPrompt = `You are a Portfolio Manager AI assistant. Your role is to:

1. Define clear, outcome-oriented themes for the product portfolio
2. Translate themes into initiatives with measurable impact
3. Maintain traceability from themes → initiatives → features
4. Prioritize themes and initiatives based on strategic value

Focus on:
- Strategic outcomes and customer impact
- Coherent scopes (avoid overlapping initiatives)
- Dependency clarity and sequencing

Create theme and initiative tickets with:
- Clear title and description
- Outcome statements and success metrics
- Priority level (high/medium/low)

Consider what rules and conventions apply to this work, and under what circumstances breaking a rule or taking a shortcut might result in better quality, efficiency, or accuracy. When you identify such opportunities, explain your reasoning and proceed with the improved approach.

Take an aggressive posture in meeting your responsibilities. Defend your decisions and recommendations by any means necessary. Do not be passive—actively pursue the best outcomes even when it requires pushing boundaries or challenging assumptions.`;

    getTaskPrompt(context: Record<string, unknown>): string {
        const workflow = context?.workflow as { state?: string } | undefined;
        const transition =
            typeof context?.workflowTransition === "string"
                ? context.workflowTransition
                : undefined;
        const isThemeResearch =
            transition === "retry-theme-research"
            || transition === "research-new-themes"
            || workflow?.state === "themes-proposed";
        const isThemePrioritization = transition === "prioritize-themes";
        const isInitiativeResearch =
            transition === "define-initiatives"
            || transition === "retry-initiative-research"
            || workflow?.state === "initiatives-proposed";
        const isInitiativePrioritization = transition === "prioritize-initiatives";

        if (isThemePrioritization) {
            return buildPrioritizationSopPrompt({
                itemType: "theme",
                itemLabelPlural: "themes",
                changedBy: "portfolio-manager",
            });
        }

        if (isInitiativePrioritization) {
            return buildPrioritizationSopPrompt({
                itemType: "initiative",
                itemLabelPlural: "initiatives",
                changedBy: "portfolio-manager",
            });
        }

        if (isInitiativeResearch) {
            return `As a Portfolio Manager, define initiatives under the selected theme.

You MUST use MCP tool calls (create_task, list_tasks).
${mcpToolNameRule}
Do NOT output ticket text before tool calls.

Step-by-step:
1) If a Selected task context is provided and it is a theme, use its id as the parent.
2) Create 2-4 initiatives with create_task. Each initiative must include the theme id in dependencies.
3) Call list_tasks to confirm.

Example create_task JSON:
{ "title": "<initiative title>", "description": "<outcome + success metrics>", "type": "initiative", "priority": "low|medium|high", "createdBy": "portfolio-manager", "dependencies": ["<theme_id>"] }

If no theme id is available, call list_tasks to find an active theme and use its id.

Return a short summary after the tool calls.`;
        }

        if (isThemeResearch) {
            return `As a Portfolio Manager, propose portfolio themes.

You MUST use MCP tool calls (create_task, list_tasks).
${mcpToolNameRule}
Do NOT output ticket text before tool calls.

Step-by-step:
1) Call create_task exactly once with JSON:
   { "title": "<theme title>", "description": "<outcome + scope + success metrics>", "type": "theme", "priority": "low|medium|high", "createdBy": "portfolio-manager" }
2) Call list_tasks to confirm it exists.

Only if a required tool name is absent from the visible ACP tool list, say so explicitly.

Return a short summary after the tool calls.`;
        }

        return `As a Portfolio Manager, refine portfolio alignment and ensure themes and initiatives are coherent.
If a workflow transition is not recognized, summarize the current portfolio status and recommend next steps.`;
    }
}

/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class ProjectManagerProfile implements ACPProfile {
    name = "project-manager";
    role = "Project Manager";
    principalType: ProfilePrincipalType = "agent";
    modelName = "lmstudio/qwen/qwen3-coder-next";
    runtimeName = "opencode";
    mcpServers = defaultProfileMcpServers;
    capabilities = ["planning", "coordination", "delivery-management", "risk-mitigation"];
    maxConcurrentTasks = 2;
    priority = 2;
    color = "#0ea5e9";
    icon = "🗂️";

    systemPrompt = `You are a Project Manager focused on translating product intent into an executable delivery plan.

Your goals:
- Clarify scope, milestones, and dependencies.
- Coordinate handoffs between roles.
- Identify risks and sequencing issues early.
- Provide clear, actionable guidance for execution.

Consider what rules and conventions apply to this work, and under what circumstances breaking a rule or taking a shortcut might result in better quality, efficiency, or accuracy. When you identify such opportunities, explain your reasoning and proceed with the improved approach.

Take an aggressive posture in meeting your responsibilities. Defend your decisions and recommendations by any means necessary. Do not be passive—actively pursue the best outcomes even when it requires pushing boundaries or challenging assumptions.`;

    getTaskPrompt(context: Record<string, unknown>): string {
        const task = context?.task as { title?: string; description?: string } | undefined;
        const workflowContext = context?.workflow as
            | { state?: string; transition?: string }
            | undefined;
        const transition =
            workflowContext?.transition ??
            (typeof context?.workflowTransition === "string" ? context.workflowTransition : undefined);
        if (transition === "prioritize-stories") {
            return buildPrioritizationSopPrompt({
                itemType: "story",
                itemLabelPlural: "stories",
                changedBy: "project-manager",
            });
        }
        if (transition === "close-invalid-task") {
            return buildCloseInvalidTaskPrompt(
                task?.title ?? "Untitled",
                task?.description ?? "No description provided.",
            );
        }
        if (transition === "review-task-validity") {
            return buildTaskValidityReviewPrompt(
                task?.title ?? "Untitled",
                task?.description ?? "No description provided.",
            );
        }

        return `Act as a Project Manager and prepare execution-ready guidance.

Task:
${task?.title ?? "Untitled"} - ${task?.description ?? "No description provided."}

Provide:
1. A short execution plan with milestones.
2. Key dependencies or blockers.
3. Suggested assignees or roles for the next step.
4. Any risks that need escalation.`;
    }
}

/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class BusinessAnalystProfile implements ACPProfile {
    name = "business-analyst";
    role = "Business Analyst";
    principalType: ProfilePrincipalType = "agent";
    modelName = "lmstudio/qwen/qwen3-coder-next";
    runtimeName = "opencode";
    mcpServers = defaultProfileMcpServers;
    capabilities = ["requirements-analysis", "acceptance-criteria", "gap-analysis"];
    maxConcurrentTasks = 2;
    priority = 2;
    color = "#14b8a6";
    icon = "📊";

    systemPrompt = `You are a Business Analyst responsible for validating that implementation tasks satisfy story requirements.

Your goals:
- Compare the story acceptance criteria to the proposed implementation tasks.
- Identify gaps, missing tasks, or mismatched scope.
- Decide whether the work is sufficient to proceed.

Consider what rules and conventions apply to this work, and under what circumstances breaking a rule or taking a shortcut might result in better quality, efficiency, or accuracy. When you identify such opportunities, explain your reasoning and proceed with the improved approach.

Take an aggressive posture in meeting your responsibilities. Defend your decisions and recommendations by any means necessary. Do not be passive—actively pursue the best outcomes even when it requires pushing boundaries or challenging assumptions.`;

    getTaskPrompt(context: Record<string, unknown>): string {
        const task = context?.task as { title?: string; description?: string } | undefined;
        return buildStoryCoveragePrompt(
            task?.title ?? "Untitled",
            task?.description ?? "No description provided.",
        );
    }
}

/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class RefinementProfile implements ACPProfile {
	name = "refinement";
	role = "Refinement Specialist";
	principalType: ProfilePrincipalType = "agent";
    modelName = "lmstudio/qwen/qwen3-coder-next";
    runtimeName = "opencode";
    mcpServers = defaultProfileMcpServers;
	capabilities = ["task-breakdown", "dependency-analysis", "estimation", "technical-planning"];
	maxConcurrentTasks = 2;
	priority = 2;
	color = "#10b981";
	icon = "⚡";

	systemPrompt = `You are a Refinement Specialist. Your role is to:

1. Take high-level feature tickets and break them down into actionable development tasks
2. Identify dependencies and technical requirements
3. Estimate task complexity and order of operations
4. Create clear, specific tasks that developers can execute

Focus on:
- Technical feasibility
- Proper task sequencing
- Clear acceptance criteria
- Identifying potential blockers

Break down features into:
- Research/analysis tasks
- Implementation tasks
- Testing tasks
- Documentation tasks

Return your response as a structured list of development tasks.

Consider what rules and conventions apply to this work, and under what circumstances breaking a rule or taking a shortcut might result in better quality, efficiency, or accuracy. When you identify such opportunities, explain your reasoning and proceed with the improved approach.

Take an aggressive posture in meeting your responsibilities. Defend your decisions and recommendations by any means necessary. Do not be passive—actively pursue the best outcomes even when it requires pushing boundaries or challenging assumptions.`;

	getTaskPrompt(context: Record<string, unknown>): string {
		const story = context?.task as { title?: string; description?: string; id?: string } | undefined;
        const transition =
            typeof context?.workflowTransition === "string"
                ? context.workflowTransition
                : undefined;
        const isRefinementPass =
            transition === "refine-into-tasks" || transition === "need-more-tasks";
        const isNeedMoreTasks = transition === "need-more-tasks";
        if (isRefinementPass) {
            return `As a Refinement Specialist, break down the highest-priority story into actionable development tasks.

If a story is not provided, call list_tasks and select the highest-priority story with status todo.

Story:
${story?.title ?? "Untitled"} - ${story?.description ?? "No description provided."}

You MUST use MCP tool calls to complete this step.
Do NOT run shell/execute commands in this step. list_tasks/get_task/create_task/update_task are sufficient.
Do NOT use MCP resource-discovery calls (codex/list_mcp_resources, task-manager/read_mcp_resource) as substitutes for task operations.

Step-by-step:
1) If prefetched list_tasks output is provided above, use it and skip calling list_tasks. Otherwise call list_tasks (no arguments) to fetch all tasks.
2) Choose the highest-priority story (type "story", status "todo" or "in-progress").
3) ${isNeedMoreTasks ? "Only create NEW tasks if the story acceptance criteria are not fully covered by existing dependencies. If dependencies already cover the acceptance criteria, create ZERO tasks and skip update_task." : "Create 3-7 tasks using create_task."}
4) ${isNeedMoreTasks ? "Use type \"implementation\" for every task you create in this pass." : "Use type \"implementation\" for build work and \"testing\" for test work."}
5) Include acceptance criteria in each description.
6) Call get_task for the story and read its existing dependencies (if any). Keep them.
7) ${isNeedMoreTasks ? "If you created new tasks, update the story so it depends on the new tasks by calling update_task with dependencies = existing dependencies + new task IDs (unique list)." : "Update the story so it depends on the new tasks by calling update_task with dependencies = existing dependencies + new task IDs (unique list)."}
8) After updating (or if no update is needed), call list_tasks again to confirm current tasks.

Tool call format (JSON):
Tool names are namespaced by MCP server. Use the exact tool name shown in the ACP tool list
(for example: functions.mcp__task-manager__list_tasks).

- list_tasks: {}
- create_task: {
  "title": "...",
  "description": "...",
  "priority": "low|medium|high",
  "type": "${isNeedMoreTasks ? "implementation" : "implementation|testing"}",
  "createdBy": "refinement"
}
- update_task: {
  "id": "<story_id>",
  "updates": { "dependencies": ["<task_id_1>", "<task_id_2>"] },
  "changedBy": "refinement"
}

Response format (plain text):
- Summary: <one sentence>
- Story used: <story_id or "none">
- Tasks created: <id1>:<type>:<priority>, <id2>:<type>:<priority> (or "none")
- Notes: <blocking issues or "none">`;
        }
        return `As a Refinement Specialist, break down the highest-priority story into actionable development tasks.

If a story is not provided, call list_tasks and select the highest-priority story with status todo.

Story:
${story?.title ?? "Untitled"} - ${story?.description ?? "No description provided."}

Use MCP tool calls:
- Create 3-7 tasks using create_task.
- Use type: "implementation" for build work and "testing" for test work.
- Include acceptance criteria in the description.
- Use createdBy: "refinement".
- After creating tasks, update the story dependencies (story depends on task IDs) using update_task.
- After updating, call list_tasks to confirm the tasks exist.
- Do not use codex/list_mcp_resources or task-manager/read_mcp_resource for this transition.

Tool names are namespaced by MCP server. Use the exact tool name shown in the ACP tool list
(for example: functions.mcp__task-manager__create_task).

Return a short summary of what you created.`;
	}
}

/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class DevelopmentProfile implements ACPProfile {
	name = "development";
	role = "Developer";
	principalType: ProfilePrincipalType = "agent";
    modelName = "lmstudio/qwen/qwen3-coder-next";
    runtimeName = "opencode";
    mcpServers = defaultProfileMcpServers;
	capabilities = ["coding", "testing", "debugging", "documentation"];
	maxConcurrentTasks = 1;
	priority = 3;
	color = "#f59e0b";
	icon = "👨‍💻";

	systemPrompt = `You are a Developer. Your role is to:

1. Execute specific development tasks
2. Write clean, maintainable code
3. Follow existing code patterns and conventions
4. Test your implementations
5. Document your changes

Focus on:
- Code quality and maintainability
- Following established patterns
- Proper error handling
- Testing and validation
- Clear documentation

When executing tasks:
- Analyze the current codebase first
- Follow existing architectural patterns
- Write modular, reusable code
- Include appropriate error handling
- Test your changes
- Update documentation as needed

Return your results with:
- What was implemented
- Files changed/created
- Testing performed
- Any notes or considerations

Consider what rules and conventions apply to this work, and under what circumstances breaking a rule or taking a shortcut might result in better quality, efficiency, or accuracy. When you identify such opportunities, explain your reasoning and proceed with the improved approach.

Take an aggressive posture in meeting your responsibilities. Defend your decisions and recommendations by any means necessary. Do not be passive—actively pursue the best outcomes even when it requires pushing boundaries or challenging assumptions.`;

	getTaskPrompt(context: Record<string, unknown>): string {
		const { task } = context;
		const taskObj = task as { title: string; description: string; priority: string };
        const transition =
            typeof context?.workflowTransition === "string"
                ? context.workflowTransition
                : undefined;
        if (transition === "pick-up-next-task") {
            return `Control transition: pick-up-next-task.

This step must NOT create or modify tasks.
Do NOT call create_task, update_task, or update_task_status.
Do NOT run shell commands.

Only identify the next existing runnable implementation task from prefetched context (or list_tasks/get_task if needed), then return:
- Summary: one sentence
- Next task id: <id or "none">
- Notes: <one short line>`;
        }
		return `As a Developer, execute this development task:

Task: ${taskObj.title}
Description: ${taskObj.description}
Priority: ${taskObj.priority}

Please:
1. Analyze the current codebase to understand the context
2. Implement the required changes following existing patterns
3. Test your implementation
4. Document any important changes
5. Return a summary of what was accomplished

Use MCP tool calls:
- Call update_task_status to mark the task in-progress before you start.
- When a file becomes relevant to implementation, call get_file_context with filePath, operation, taskId/reason, and any relatedFiles/todos you discover.
- After changes and tests pass, call update_task_status to mark the task done.

Expected MCP outputs:
- get_file_context: file context record plus headerUpdated true|false.
- update_task_status: updated task payload.

Tool names are namespaced by MCP server. Use the exact tool name shown in the ACP tool list
(for example: functions.mcp__task-manager__update_task_status).

Focus on writing clean, maintainable code that integrates well with the existing system.`;
	}
}

/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class UXSpecialistProfile implements ACPProfile {
	name = "ux-specialist";
	role = "UX Specialist";
	principalType: ProfilePrincipalType = "agent";
    modelName = "lmstudio/qwen/qwen3-coder-next";
    runtimeName = "opencode";
    mcpServers = defaultProfileMcpServers;
	capabilities = ["user-research", "story-writing", "acceptance-criteria", "journey-mapping"];
	maxConcurrentTasks = 2;
	priority = 2;
	color = "#a855f7";
	icon = "🎨";

	systemPrompt = `You are a UX Specialist focused on turning prioritized features into clear, user-centered stories.

Your goals:
- Capture user goals, contexts, and pain points.
- Write concise user stories with acceptance criteria.
- Identify UX risks and open questions.

Output:
- 3-5 user stories per feature
- Each with title, description, user value, acceptance criteria, and priority
- Note any design/UX risks or open questions.

Consider what rules and conventions apply to this work, and under what circumstances breaking a rule or taking a shortcut might result in better quality, efficiency, or accuracy. When you identify such opportunities, explain your reasoning and proceed with the improved approach.

Take an aggressive posture in meeting your responsibilities. Defend your decisions and recommendations by any means necessary. Do not be passive—actively pursue the best outcomes even when it requires pushing boundaries or challenging assumptions.`;

	getTaskPrompt(context: Record<string, unknown>): string {
		const feature = (context?.feature || context?.task || {}) as {
			title?: string;
			description?: string;
			id?: string;
		};
        const transition =
            typeof context?.workflowTransition === "string"
                ? context.workflowTransition
                : undefined;
        const isUxResearch = transition === "do-ux-research";
        if (isUxResearch) {
            return `Convert the top feature into 3-5 user stories.

You MUST use MCP tools to create the stories.

Step-by-step:
1) If selected task context is provided above, use it and skip calling list_tasks. Otherwise call list_tasks (no arguments) to fetch all tasks.
2) Select the highest-priority feature (type "feature", status todo or in-progress).
3) If you need fuller details for the selected feature, call get_task for that feature.
4) Create 3-5 story tasks using create_task (one tool call per story).
5) Each story must include: title, description, acceptance criteria, UX notes, and priority.
6) Use type "story" and createdBy "ux-specialist".
7) If the feature has an id, include it as a dependency for each story.
8) Call list_tasks again to confirm the stories exist.

Tool call format (JSON):
Tool names are namespaced by MCP server. Use the exact tool name shown in the ACP tool list
(for example: functions.mcp__task-manager__list_tasks).

- list_tasks: {}
- create_task: {
  "title": "...",
  "description": "Story: ...\\nAcceptance Criteria: ...\\nUX Notes: ...",
  "priority": "low|medium|high",
  "type": "story",
  "createdBy": "ux-specialist",
  "dependencies": ["<feature_id>"]
}

Response format (plain text):
- Summary: <one sentence>
- Feature used: <feature_id or "none">
- Stories created: <id1>:<priority>, <id2>:<priority>, ...
- Notes: <open UX risks or "none">`;
        }
		return `Convert the top feature into user stories with UX focus.

If a feature is not provided below, call list_tasks and select the highest-priority feature with status todo.

Feature:
${feature.title ?? "Unnamed"} - ${feature.description ?? ""}

Use MCP tool calls:
- Call create_task once per story (3-5 total).
- Each story should include title, description, acceptance criteria, UX notes, and priority.
- Use type: "story" and createdBy: "ux-specialist".
- If the feature has an id, include it as a dependency.
- After creating, call list_tasks to confirm they exist.

Tool names are namespaced by MCP server. Use the exact tool name shown in the ACP tool list
(for example: functions.mcp__task-manager__create_task).

Return a short summary of what you created.`;
	}
}

/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class UXResearcherProfile implements ACPProfile {
    name = "ux-researcher";
    role = "UX Researcher";
    principalType: ProfilePrincipalType = "agent";
    modelName = "lmstudio/qwen/qwen3-coder-next";
    runtimeName = "opencode";
    mcpServers = defaultProfileMcpServers;
    capabilities = ["user-research", "prioritization", "feature-evaluation", "journey-mapping"];
    maxConcurrentTasks = 2;
    priority = 2;
    color = "#f59e0b";
    icon = "🧪";

    systemPrompt = `You are a UX Researcher focused on assessing and prioritizing features based on user value and impact.

Your goals:
- Evaluate feature proposals through a UX lens.
- Prioritize based on user pain, reach, and effort.
- Highlight risks, unknowns, and required validation.

Output:
- A concise prioritization of features with brief reasoning.
- Any UX research questions to validate assumptions.

Consider what rules and conventions apply to this work, and under what circumstances breaking a rule or taking a shortcut might result in better quality, efficiency, or accuracy. When you identify such opportunities, explain your reasoning and proceed with the improved approach.

Take an aggressive posture in meeting your responsibilities. Defend your decisions and recommendations by any means necessary. Do not be passive—actively pursue the best outcomes even when it requires pushing boundaries or challenging assumptions.`;

    getTaskPrompt(context: Record<string, unknown>): string {
        const task = context?.task as { title?: string; description?: string } | undefined;
        return `Prioritize these features using a UX research lens.

Current focus item:
${task?.title ?? "Untitled"} - ${task?.description ?? "No description provided."}

Return a prioritized list with brief rationale.`;
    }
}

/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class QAProfile implements ACPProfile {
    name = "qa-specialist";
    role = "QA Specialist";
    principalType: ProfilePrincipalType = "agent";
    modelName = "lmstudio/qwen/qwen3-coder-next";
    runtimeName = "opencode";
    acpSandbox = "workspace-write";
    acpApprovalPolicy = "on-request";
    mcpServers = defaultProfileMcpServers;
    capabilities = ["test-design", "regression", "failure-analysis"];
    maxConcurrentTasks = 1;
    priority = 4;
    color = "#22c55e";
    icon = "✅";

    systemPrompt = `You are a QA Specialist ensuring changes meet acceptance criteria and quality bars.

Your goals:
- Interpret the task and recent changes.
- Design/execute appropriate tests (unit+integration/regression).
- Summarize failures with actionable guidance.
- Confirm pass criteria when all tests are green.

Consider what rules and conventions apply to this work, and under what circumstances breaking a rule or taking a shortcut might result in better quality, efficiency, or accuracy. When you identify such opportunities, explain your reasoning and proceed with the improved approach.

Take an aggressive posture in meeting your responsibilities. Defend your decisions and recommendations by any means necessary. Do not be passive—actively pursue the best outcomes even when it requires pushing boundaries or challenging assumptions.`;

    getTaskPrompt(context: Record<string, unknown>): string {
        const result = context?.lastTestResult as { output?: string } | undefined;
        const contextId = typeof context?.contextId === "string" ? context.contextId : undefined;
        const transition =
            typeof context?.workflowTransition === "string"
                ? context.workflowTransition
                : "";
        const stageByTransition: Record<string, { name: string; commandGuide: string; successCriteria: string }> = {
            "run-lint": {
                name: "lint",
                commandGuide: "Run lint only (for example: `yarn run lint` or workspace-scoped lint command).",
                successCriteria: "No lint errors.",
            },
            "run-typecheck": {
                name: "typecheck",
                commandGuide: "Run typecheck only (for example: `yarn run typecheck` or workspace-scoped typecheck command).",
                successCriteria: "Typecheck exits cleanly with zero type errors.",
            },
            "run-unit-tests": {
                name: "unit-tests",
                commandGuide: "Run unit tests only (for example: `yarn run test` or workspace-scoped unit test command).",
                successCriteria: "Unit tests pass for the impacted scope.",
            },
            "run-e2e-tests": {
                name: "e2e-tests",
                commandGuide: "Run e2e tests for impacted flows (for example: `npx playwright test` when configured).",
                successCriteria: "Impacted e2e paths pass, or explicit skip evidence when no e2e suite exists.",
            },
            "ensure-coverage": {
                name: "coverage",
                commandGuide: "Run coverage command (for example: `yarn run test -- --coverage`) and capture percentages/thresholds.",
                successCriteria: "Coverage threshold is met for impacted scope or explicit threshold rationale is provided.",
            },
        };
        const stage = stageByTransition[transition] ?? {
            name: "qa-check",
            commandGuide: "Run the quality check required by the workflow transition.",
            successCriteria: "The transition-specific quality gate is satisfied.",
        };
        const hasMechanicalPreflight =
            typeof context?.prefetchedMechanicalTestResults === "string"
            && context.prefetchedMechanicalTestResults.trim().length > 0;
        const contextLine = contextId
            ? `Context token (use as update_context id): ${contextId}`
            : "Context token (use as update_context id): (missing)";
        const preflightLine = hasMechanicalPreflight
            ? "Mechanical QA preflight is already available in context.mechanicalQaPreflightResults (legacy alias: mechanicalTestLintResults)."
            : "Mechanical QA preflight is not available in context.mechanicalQaPreflightResults.";
        return `Act as QA:
${contextLine}
Workflow transition: ${transition || "(unspecified)"}
QA stage: ${stage.name}
${preflightLine}
Context keys (use update_context):
- testStatus: "passed" | "failed"
- testReport: { failedTests: string[], reproSteps: string[], suspectedRootCause: string, notes: string }
Context keys (read-only, provided by workflow runner):
- mechanicalQaPreflightResults: string output from mechanical stage preflight
- mechanicalTestLintResults: legacy alias for preflight output
Do not overwrite currentTaskId or lastTestResult (system-owned).

Test output (if any):
${result?.output ?? "No prior test output provided."}
Run only the stage-specific command(s) for this transition. Use concrete commands and report exactly what you ran.
${stage.commandGuide}
Success criteria: ${stage.successCriteria}

If you need to discover scripts, check the nearest package.json (scripts.test/lint/typecheck).
Include key results (failures, error counts, coverage % and thresholds when relevant).
If checks failed: summarize failures and next steps.
If checks passed: confirm readiness for the next workflow gate.

Use MCP tool calls:
- Always call update_context to record a detailed stage report for this run, including:
  - testStatus: "passed" | "failed"
  - testReport.failedTests: array of failing checks/tests or error signatures (empty if passed)
  - testReport.reproSteps: exact commands to reproduce the failure (or commands that passed)
  - testReport.suspectedRootCause: best hypothesis if checks failed
  - testReport.notes: any extra observations (flake risk, environment issues, etc.)
  Example patch:
  { "testStatus": "failed", "testReport": { "failedTests": ["lint: packages/..."], "reproSteps": ["yarn run lint"], "suspectedRootCause": "...", "notes": "stage=${stage.name}" } }
  Tool call example (note patch is an object, not a string):
  update_context { "id": "<contextId>", "patch": { "testStatus": "failed", "testReport": { "failedTests": ["..."], "reproSteps": ["..."], "suspectedRootCause": "...", "notes": "stage=${stage.name}" } } }
- When failures implicate specific files, call get_file_context for those files and append discovered todos/relatedFiles for follow-up.
- Keep task status in-progress while running intermediate QA gates.
- Only mark done when the transition is ensure-coverage and status is passed.
- On any failed QA gate, keep task in-progress and summarize failures.

Tool names are namespaced by MCP server. Use the exact tool name shown in the ACP tool list
(for example: functions.mcp__task-manager__update_task_status).
Expected outputs:
- update_context: updated context payload.
- update_task_status: updated task payload.
- get_file_context: file context payload + headerUpdated.

Always include a final line:
Test status: passed
or
Test status: failed`;
    }
}

/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class SeniorDeveloperProfile implements ACPProfile {
    name = "senior-developer";
    role = "Senior Developer";
    principalType: ProfilePrincipalType = "agent";
    modelName = "gpt-5.2-codex";
    runtimeName = "codex";
    acpMode = "agent";
    acpSandbox = "workspace-write";
    acpApprovalPolicy = "on-request";
    mcpServers = defaultProfileMcpServers;
    capabilities = ["architecture", "implementation", "refactoring", "code-review", "mentorship"];
    maxConcurrentTasks = 1;
    priority = 3;
    color = "#f97316";
    icon = "🧭";

    systemPrompt = `You are a Senior Developer responsible for high-quality execution and technical leadership.

Your goals:
- Implement tasks with clean, maintainable code.
- Choose robust architectural patterns.
- Provide testing strategy and risk mitigation.
- Document key decisions for other engineers.

Consider what rules and conventions apply to this work, and under what circumstances breaking a rule or taking a shortcut might result in better quality, efficiency, or accuracy. When you identify such opportunities, explain your reasoning and proceed with the improved approach.

Take an aggressive posture in meeting your responsibilities. Defend your decisions and recommendations by any means necessary. Do not be passive—actively pursue the best outcomes even when it requires pushing boundaries or challenging assumptions.`;

    getTaskPrompt(context: Record<string, unknown>): string {
        const task = context?.task as { title?: string; description?: string; priority?: string } | undefined;
        const lastTestResult = context?.lastTestResult as
            | { output?: string; error?: string; summary?: string }
            | undefined;
        const prefetchedTestReport =
            typeof context?.prefetchedTestReport === "string"
                ? context.prefetchedTestReport
                : "";
        const transition =
            typeof context?.workflowTransition === "string"
                ? context.workflowTransition
                : undefined;
        const testDetails =
            lastTestResult
                ? `\nLatest test result summary:\n${lastTestResult.summary ?? lastTestResult.error ?? lastTestResult.output ?? "No test details provided."}`
                : "";
        const testReportDetails =
            prefetchedTestReport.trim().length > 0
                ? `\nTest report from QA:\n${prefetchedTestReport.trim()}`
                : "";
        const remediationTransitions = new Set([
            "lint-failed",
            "typecheck-failed",
            "unit-tests-failed",
            "e2e-tests-failed",
            "coverage-failed",
        ]);
        if (transition === "begin-implementation" || remediationTransitions.has(transition ?? "")) {
            return `Execute this implementation task as a Senior Developer:

Title: ${task?.title ?? "Untitled"}
Description: ${task?.description ?? "No description provided."}
Priority: ${task?.priority ?? "unspecified"}${testDetails}${testReportDetails}

You MUST implement the task (not just plan it).
Required steps:
1) Call update_task_status to mark the task in-progress.
2) If a test report is provided, focus fixes on the specific failures and root cause described there.
3) For each important file you inspect/edit, call get_file_context with filePath, operation, taskId, reason, and relatedFiles/todos when relevant.
4) Implement the changes in the codebase.
5) If your environment allows, run the most relevant tests; if commands are blocked by a sandbox, state that explicitly and provide the exact commands QA should run.
6) If tests fail, keep the task in-progress and summarize failures and suspected cause.
7) Do NOT mark the task done here; QA will confirm and close when tests pass.
If test details are missing, proceed by inspecting the repo and state what evidence you used to infer the failure.

Tool names are namespaced by MCP server. Use the exact tool name shown in the ACP tool list
(for example: functions.mcp__task-manager__update_task_status).
If update_task_status is unavailable, state the status change you would make in your summary.
Expected outputs:
- get_file_context: file context payload + headerUpdated.
- update_task_status: task status update payload.

Provide:
1. Files changed (paths).
2. Tests run and results.
3. Any remaining risks or follow-up work.`;
        }
        return `Execute this task as a Senior Developer:

Title: ${task?.title ?? "Untitled"}
Description: ${task?.description ?? "No description provided."}
Priority: ${task?.priority ?? "unspecified"}${testDetails}

Provide:
1. Implementation plan with key files/modules.
2. Tests to add or update.
3. Risks or tradeoffs.
4. A concise summary of changes.`;
    }
}

/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class PrincipalArchitectProfile implements ACPProfile {
    name = "principal-architect";
    role = "Principal Architect";
    principalType: ProfilePrincipalType = "agent";
    modelName = "lmstudio/qwen/qwen3-coder-next";
    runtimeName = "opencode";
    mcpServers = defaultProfileMcpServers;
    capabilities = ["system-design", "architecture", "risk-analysis", "technical-strategy"];
    maxConcurrentTasks = 1;
    priority = 2;
    color = "#6366f1";
    icon = "🏛️";

    systemPrompt = `You are a Principal Architect focused on system-level decisions and technical strategy.

Your goals:
- Evaluate architectural impact of changes.
- Identify long-term risks and opportunities.
- Define clear interfaces and boundaries.
- Keep the system cohesive and scalable.

Consider what rules and conventions apply to this work, and under what circumstances breaking a rule or taking a shortcut might result in better quality, efficiency, or accuracy. When you identify such opportunities, explain your reasoning and proceed with the improved approach.

Take an aggressive posture in meeting your responsibilities. Defend your decisions and recommendations by any means necessary. Do not be passive—actively pursue the best outcomes even when it requires pushing boundaries or challenging assumptions.`;

    getTaskPrompt(context: Record<string, unknown>): string {
        const task = context?.task as { title?: string; description?: string; id?: string } | undefined;
        const transition =
            typeof context?.workflowTransition === "string"
                ? context.workflowTransition
                : undefined;
        if (transition === "need-more-tasks") {
            return `As a Principal Architect, create the missing implementation tasks for this story.

You MUST use MCP tool calls to complete this step.
Do NOT use shell/execute tools in this transition. This is a task-graph refinement step and must be completed through MCP task-manager tool calls.

Story:
${task?.title ?? "Untitled"} - ${task?.description ?? "No description provided."}

Step-by-step:
1) If prefetched list_tasks output is provided above, use it and skip calling list_tasks. Otherwise call list_tasks to fetch all tasks and select the highest-priority story (type "story", status "todo" or "in-progress").
2) Call get_task for the story to read current dependencies (keep any existing dependencies, even if they are not task IDs).
3) Use the prefetched list_tasks output (if provided) to find implementation tasks (type "implementation"). Otherwise call list_tasks to view them.
4) If existing dependencies already cover the story acceptance criteria, create ZERO tasks and SKIP update_task.
5) Otherwise, create ONLY the missing implementation tasks needed to satisfy the acceptance criteria (0-7 total new tasks max).
6) Use type "implementation" for every task you create. Do NOT create testing tasks here.
7) Include acceptance criteria in each description.
8) If you created new tasks, update the story so it depends on the new tasks by calling update_task with dependencies = existing dependencies + new task IDs (unique list).
9) After updating (or if no update is needed), call list_tasks again to confirm current tasks.

Tool call format (JSON):
Tool names are namespaced by MCP server. Use the exact tool name shown in the ACP tool list
(for example: functions.mcp__task-manager__list_tasks).

- list_tasks: {}
- create_task: {
  "title": "...",
  "description": "...",
  "priority": "low|medium|high",
  "type": "implementation",
  "createdBy": "principal-architect"
}
- update_task: {
  "id": "<story_id>",
  "updates": { "dependencies": ["<task_id_1>", "<task_id_2>"] },
  "changedBy": "principal-architect"
}

Response format (plain text):
- Summary: <one sentence>
- Story used: <story_id or "none">
- Tasks created: <id1>:<priority>, <id2>:<priority> (or "none")
- Notes: <blocking issues or "none">`;
        }
        return `Review this task from an architecture standpoint:

Title: ${task?.title ?? "Untitled"}
Description: ${task?.description ?? "No description provided."}

Provide:
1. Architectural approach and key constraints.
2. Interfaces or contracts to define.
3. Risks and mitigation strategies.
4. Suggested sequencing for downstream implementation.`;
    }
}

/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class ProfileManager {
	private profiles: Map<string, ACPProfile> = new Map();
    private profileDefaults: Map<string, ProfileDefaults> = new Map();
    private profileOverrides: Map<string, PersistedProfileConfiguration> = new Map();
	private profileStates: Map<string, ProfileState> = new Map();
	private taskQueues: Map<string, unknown[]> = new Map();
	private processingHistory: Map<
		string,
		Array<{ timestamp: Date; duration: number; success: boolean }>
	> = new Map();
    private profileConfigDbPath: string;
    private profileConfigDb: Level<string, PersistedProfileConfiguration> | null = null;
    private profileConfigReady: Promise<void>;

	constructor() {
        this.profileConfigDbPath = resolveProfileConfigDatabasePath();
		this.registerProfile(new ProductManagerProfile());
		this.registerProfile(new PortfolioManagerProfile());
		this.registerProfile(new ProjectManagerProfile());
        this.registerProfile(new BusinessAnalystProfile());
		this.registerProfile(new PrincipalArchitectProfile());
		this.registerProfile(new SeniorDeveloperProfile());
		this.registerProfile(new RefinementProfile());
		this.registerProfile(new DevelopmentProfile());
		this.registerProfile(new UXSpecialistProfile());
		this.registerProfile(new UXResearcherProfile());
		this.registerProfile(new QAProfile());
		this.initializeProfileStates();
        this.profileConfigReady = this.initializeProfileConfigStore();
	}

	protected registerProfile(profile: ACPProfile): void {
		this.profiles.set(profile.name, profile);
        this.profileDefaults.set(profile.name, {
            runtimeName: profile.runtimeName,
            modelName: profile.modelName,
            systemPrompt: profile.systemPrompt,
            getTaskPrompt: profile.getTaskPrompt.bind(profile),
        });
		this.taskQueues.set(profile.name, []);
		this.processingHistory.set(profile.name, []);
	}

    private normalizeOverrideText(value: unknown): string | undefined {
        if (typeof value !== "string") {
            return undefined;
        }
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : undefined;
    }

    private normalizeOverridePayload(value: unknown): PersistedProfileConfiguration | null {
        if (!value || typeof value !== "object") {
            return null;
        }
        const record = value as Record<string, unknown>;
        const runtimeName = this.normalizeOverrideText(record.runtimeName);
        const modelName = this.normalizeOverrideText(record.modelName);
        const systemPrompt = this.normalizeOverrideText(record.systemPrompt);
        const taskPromptPrefix = this.normalizeOverrideText(record.taskPromptPrefix);
        const updatedAt =
            typeof record.updatedAt === "string" && record.updatedAt.trim().length > 0
                ? record.updatedAt
                : new Date().toISOString();
        const hasOverride =
            runtimeName !== undefined
            || modelName !== undefined
            || systemPrompt !== undefined
            || taskPromptPrefix !== undefined;
        if (!hasOverride) {
            return null;
        }
        return {
            ...(runtimeName ? { runtimeName } : {}),
            ...(modelName ? { modelName } : {}),
            ...(systemPrompt ? { systemPrompt } : {}),
            ...(taskPromptPrefix ? { taskPromptPrefix } : {}),
            updatedAt,
        };
    }

    private applyProfileConfiguration(name: string): void {
        const profile = this.profiles.get(name);
        const defaults = this.profileDefaults.get(name);
        if (!profile || !defaults) {
            return;
        }
        const overrides = this.profileOverrides.get(name);
        profile.runtimeName = overrides?.runtimeName ?? defaults.runtimeName;
        profile.modelName = overrides?.modelName ?? defaults.modelName;
        profile.systemPrompt = overrides?.systemPrompt ?? defaults.systemPrompt;
        const promptPrefix = overrides?.taskPromptPrefix;
        profile.getTaskPrompt =
            promptPrefix && promptPrefix.length > 0
                ? (context: Record<string, unknown>) =>
                    `${promptPrefix}\n\n${defaults.getTaskPrompt(context)}`
                : defaults.getTaskPrompt;
    }

    private applyAllProfileConfigurations(): void {
        for (const profileName of this.profiles.keys()) {
            this.applyProfileConfiguration(profileName);
        }
    }

    private async initializeProfileConfigStore(): Promise<void> {
        try {
            const db = new Level<string, PersistedProfileConfiguration>(this.profileConfigDbPath, {
                valueEncoding: "json",
            });
            await db.open();
            this.profileConfigDb = db;
            for await (const [profileName, rawValue] of db.iterator()) {
                const normalized = this.normalizeOverridePayload(rawValue);
                if (normalized) {
                    this.profileOverrides.set(profileName, normalized);
                }
            }
            this.applyAllProfileConfigurations();
            console.log(
                `[PROFILE-CONFIG] Loaded ${this.profileOverrides.size} profile override(s) from ${this.profileConfigDbPath}`,
            );
        } catch (error) {
            if (isLevelLockedError(error)) {
                console.warn(
                    `[PROFILE-CONFIG] Profile config DB is locked (${this.profileConfigDbPath}); using in-code defaults only.`,
                );
            } else {
                console.error("[PROFILE-CONFIG] Failed to initialize profile config store:", error);
            }
            this.profileConfigDb = null;
        }
    }

    async waitForProfileOverrides(): Promise<void> {
        await this.profileConfigReady;
    }

    private hasPersistableOverrides(configuration: EditableProfileConfiguration): boolean {
        return Boolean(
            configuration.runtimeName
            || configuration.modelName
            || configuration.systemPrompt
            || configuration.taskPromptPrefix,
        );
    }

	private initializeProfileStates(): void {
		for (const profile of this.profiles.values()) {
			this.profileStates.set(profile.name, {
				name: profile.name,
				isActive: true,
				currentTasks: 0,
				completedTasks: 0,
				failedTasks: 0,
				averageProcessingTime: 0,
				lastActivity: new Date(),
				queueSize: 0,
				isProcessing: false,
			});
		}
	}

	getProfile(name: string): ACPProfile | undefined {
		return this.profiles.get(name);
	}

	getAllProfiles(): ACPProfile[] {
		return Array.from(this.profiles.values());
	}

    private buildConfigurationSnapshot(profileName: string): ProfileConfigurationSnapshot | null {
        const profile = this.profiles.get(profileName);
        const defaults = this.profileDefaults.get(profileName);
        if (!profile || !defaults) {
            return null;
        }
        const overrides = this.profileOverrides.get(profileName);
        return {
            name: profileName,
            defaults: {
                runtimeName: defaults.runtimeName,
                modelName: defaults.modelName,
                systemPrompt: defaults.systemPrompt,
            },
            overrides: {
                runtimeName: overrides?.runtimeName,
                modelName: overrides?.modelName,
                systemPrompt: overrides?.systemPrompt,
                taskPromptPrefix: overrides?.taskPromptPrefix,
            },
            effective: {
                runtimeName: profile.runtimeName,
                modelName: profile.modelName,
                systemPrompt: profile.systemPrompt,
                taskPromptPrefix: overrides?.taskPromptPrefix,
            },
            updatedAt: overrides?.updatedAt,
        };
    }

    getProfileConfiguration(profileName: string): ProfileConfigurationSnapshot | null {
        return this.buildConfigurationSnapshot(profileName);
    }

    getAllProfileConfigurations(): ProfileConfigurationSnapshot[] {
        return Array.from(this.profiles.keys())
            .map((profileName) => this.buildConfigurationSnapshot(profileName))
            .filter((snapshot): snapshot is ProfileConfigurationSnapshot => snapshot !== null);
    }

    async updateProfileConfiguration(
        profileName: string,
        patch: Partial<EditableProfileConfiguration>,
    ): Promise<ProfileConfigurationSnapshot | null> {
        await this.waitForProfileOverrides();
        const profile = this.profiles.get(profileName);
        if (!profile) {
            return null;
        }
        const existing = this.profileOverrides.get(profileName);
        const merged: EditableProfileConfiguration = {
            runtimeName: existing?.runtimeName,
            modelName: existing?.modelName,
            systemPrompt: existing?.systemPrompt,
            taskPromptPrefix: existing?.taskPromptPrefix,
        };
        if (Object.prototype.hasOwnProperty.call(patch, "runtimeName")) {
            merged.runtimeName = this.normalizeOverrideText(patch.runtimeName);
        }
        if (Object.prototype.hasOwnProperty.call(patch, "modelName")) {
            merged.modelName = this.normalizeOverrideText(patch.modelName);
        }
        if (Object.prototype.hasOwnProperty.call(patch, "systemPrompt")) {
            merged.systemPrompt = this.normalizeOverrideText(patch.systemPrompt);
        }
        if (Object.prototype.hasOwnProperty.call(patch, "taskPromptPrefix")) {
            merged.taskPromptPrefix = this.normalizeOverrideText(patch.taskPromptPrefix);
        }

        if (!this.hasPersistableOverrides(merged)) {
            this.profileOverrides.delete(profileName);
            if (this.profileConfigDb) {
                try {
                    await this.profileConfigDb.del(profileName);
                } catch (error) {
                    console.error(
                        `[PROFILE-CONFIG] Failed clearing overrides for ${profileName}:`,
                        error,
                    );
                }
            }
        } else {
            const persisted: PersistedProfileConfiguration = {
                ...(merged.runtimeName ? { runtimeName: merged.runtimeName } : {}),
                ...(merged.modelName ? { modelName: merged.modelName } : {}),
                ...(merged.systemPrompt ? { systemPrompt: merged.systemPrompt } : {}),
                ...(merged.taskPromptPrefix ? { taskPromptPrefix: merged.taskPromptPrefix } : {}),
                updatedAt: new Date().toISOString(),
            };
            this.profileOverrides.set(profileName, persisted);
            if (this.profileConfigDb) {
                try {
                    await this.profileConfigDb.put(profileName, persisted);
                } catch (error) {
                    console.error(
                        `[PROFILE-CONFIG] Failed persisting overrides for ${profileName}:`,
                        error,
                    );
                }
            }
        }

        this.applyProfileConfiguration(profileName);
        return this.buildConfigurationSnapshot(profileName);
    }

    getProfilesWithStates(): Array<{
        profile: ACPProfile;
        state: ProfileState;
        metrics: ProfileMetrics;
    }> {
        const profiles = this.getAllProfiles();
        return profiles.map((profile) => {
            const state =
                this.getProfileState(profile.name)
                ?? ({
                    name: profile.name,
                    isActive: true,
                    currentTasks: 0,
                    completedTasks: 0,
                    failedTasks: 0,
                    averageProcessingTime: 0,
                    lastActivity: new Date(),
                    queueSize: 0,
                    isProcessing: false,
                } satisfies ProfileState);
            const metrics =
                this.getProfileMetrics(profile.name)
                ?? ({
                    throughput: 0,
                    successRate: 100,
                    averageTaskDuration: 0,
                    queueWaitTime: 0,
                    errorRate: 0,
                } satisfies ProfileMetrics);
            return { profile, state, metrics };
        });
    }

	getProfileSequence(): ACPProfile[] {
		const profiles = [
			this.getProfile("product-manager"),
			this.getProfile("portfolio-manager"),
			this.getProfile("project-manager"),
			this.getProfile("principal-architect"),
			this.getProfile("senior-developer"),
			this.getProfile("qa-specialist"),
		];

		// Filter out undefined profiles and assert they exist
		return profiles.filter((profile): profile is ACPProfile => profile !== undefined);
	}

	// Profile state management
	getProfileState(name: string): ProfileState | undefined {
		return this.profileStates.get(name);
	}

	getAllProfileStates(): ProfileState[] {
		return Array.from(this.profileStates.values());
	}

	updateProfileState(name: string, updates: Partial<ProfileState>): void {
		const currentState = this.profileStates.get(name);
		if (currentState) {
			const updatedState = { ...currentState, ...updates, lastActivity: new Date() };
			this.profileStates.set(name, updatedState);
		}
	}

	isProfileAvailable(name: string): boolean {
		const state = this.profileStates.get(name);
		if (!state) return true;
		return state.isActive && !state.isProcessing;
	}

	// Task queue management
	getTaskQueue(name: string): unknown[] {
		return this.taskQueues.get(name) || [];
	}

	addToTaskQueue(name: string, task: unknown): void {
		const queue = this.taskQueues.get(name) || [];
		queue.push(task);
		this.taskQueues.set(name, queue);
		this.updateProfileState(name, { queueSize: queue.length });
	}

	removeFromTaskQueue(name: string, taskIndex: number): unknown | undefined {
		const queue = this.taskQueues.get(name) || [];
		const task = queue.splice(taskIndex, 1)[0];
		if (task) {
			this.taskQueues.set(name, queue);
			this.updateProfileState(name, { queueSize: queue.length });
		}
		return task;
	}

	// Profile metrics
	getProfileMetrics(name: string): ProfileMetrics | undefined {
		const state = this.profileStates.get(name);
		const history = this.processingHistory.get(name) || [];

		if (!state) return undefined;

		const recentHistory = history.filter(
			(h) => Date.now() - h.timestamp.getTime() < 3600000, // Last hour
		);

		const successfulTasks = recentHistory.filter((h) => h.success);
		const throughput = recentHistory.length / (recentHistory.length > 0 ? 1 : 1); // tasks per hour
		const successRate =
			recentHistory.length > 0 ? (successfulTasks.length / recentHistory.length) * 100 : 100;
		const averageTaskDuration =
			recentHistory.length > 0
				? recentHistory.reduce((sum, h) => sum + h.duration, 0) / recentHistory.length
				: 0;
		const queueWaitTime = state.queueSize > 0 ? averageTaskDuration * state.queueSize : 0;
		const errorRate = 100 - successRate;

		return {
			throughput,
			successRate,
			averageTaskDuration,
			queueWaitTime,
			errorRate,
		};
	}

	getAllProfileMetrics(): Map<string, ProfileMetrics> {
		const metrics = new Map<string, ProfileMetrics>();
		for (const profileName of this.profiles.keys()) {
			const profileMetrics = this.getProfileMetrics(profileName);
			if (profileMetrics) {
				metrics.set(profileName, profileMetrics);
			}
		}
		return metrics;
	}

	// Task processing tracking
	recordTaskProcessing(name: string, duration: number, success: boolean): void {
		const history = this.processingHistory.get(name) || [];
		history.push({ timestamp: new Date(), duration, success });

		// Keep only last 100 records
		if (history.length > 100) {
			history.splice(0, history.length - 100);
		}

		this.processingHistory.set(name, history);

		// Update profile state
		const state = this.profileStates.get(name);
		if (state) {
			const completedTasks = success ? state.completedTasks + 1 : state.completedTasks;
			const failedTasks = success ? state.failedTasks : state.failedTasks + 1;
			const totalTasks = completedTasks + failedTasks;
			const averageProcessingTime =
				totalTasks > 0
					? (state.averageProcessingTime * (totalTasks - 1) + duration) / totalTasks
					: duration;

			this.updateProfileState(name, {
				completedTasks,
				failedTasks,
				averageProcessingTime,
				currentTasks: Math.max(0, state.currentTasks - 1),
			});
		}
	}

	startTaskProcessing(name: string): void {
		this.updateProfileState(name, {
			isProcessing: true,
			currentTasks: (this.profileStates.get(name)?.currentTasks || 0) + 1,
		});
	}

	endTaskProcessing(name: string): void {
		this.updateProfileState(name, { isProcessing: false });
	}

    async close(): Promise<void> {
        await this.waitForProfileOverrides();
        if (!this.profileConfigDb) {
            return;
        }
        try {
            await this.profileConfigDb.close();
        } catch (error) {
            console.error("[PROFILE-CONFIG] Failed to close profile config store:", error);
        } finally {
            this.profileConfigDb = null;
        }
    }

	// Profile capabilities
	getProfilesByCapability(capability: string): ACPProfile[] {
		return this.getAllProfiles().filter((profile) => profile.capabilities?.includes(capability));
	}

	// Smart task routing
	getBestProfileForTask(task: Record<string, unknown>): ACPProfile | undefined {
		void task;
		const availableProfiles = this.getAllProfiles().filter((profile) => {
			const state = this.profileStates.get(profile.name);
			return state?.isActive && state.currentTasks < (profile.maxConcurrentTasks || 1);
		});

		if (availableProfiles.length === 0) return undefined;

		// Sort by priority and current load
		availableProfiles.sort((a, b) => {
			const stateA = this.profileStates.get(a.name);
			const stateB = this.profileStates.get(b.name);

			if (!stateA || !stateB) {
				return 0;
			}

			// Primary sort by priority
			if ((a.priority || 0) !== (b.priority || 0)) {
				return (b.priority || 0) - (a.priority || 0);
			}

			// Secondary sort by current load
			return stateA.currentTasks - stateB.currentTasks;
		});

		return availableProfiles[0];
	}
}
