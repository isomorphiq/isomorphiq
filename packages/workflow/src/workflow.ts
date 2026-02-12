import { logTransition } from "./transition-effects.ts";
import { handleProductResearchTransition } from "./feature-creation.ts";
import { handleUxResearchTransition } from "./story-creation.ts";
import { handleInitiativeResearchTransition, handleThemeResearchTransition, matchesEnvironmentForTask } from "./portfolio-creation.ts";
import {
	assembleWorkflow,
	createTransition,
	type DeciderContext,
	type DeciderFn,
	type TransitionDefinition,
	type RuntimeState,
	type StateDefinition,
	type TransitionEffect,
	type WorkflowTask,
} from "./workflow-factory.ts";
import { workflowLinks } from "./workflow-graph.ts";
import { noopEffect } from "./transition-effects.ts";
import { isWorkflowTaskActionable } from "./task-readiness.ts";
import { decideTasksPreparedTransition, handleCloseInvalidTaskTransition } from "./task-validity.ts";

const normalizeTaskType = (value: string | undefined): string => (value ?? "").trim().toLowerCase();

const normalizeTaskStatus = (value: string | undefined): string =>
    (value ?? "").trim().toLowerCase().replace(/[_\s]+/g, "-");

const isActiveStatus = (value: string | undefined): boolean => {
    const status = normalizeTaskStatus(value);
    return status === "todo" || status === "in-progress";
};

const isImplementationTask = (task: WorkflowTask): boolean => {
    const type = normalizeTaskType(task.type);
    return type === "implementation" || type === "task";
};

const isThemeTask = (task: WorkflowTask): boolean =>
     normalizeTaskType(task.type) === "theme";

const isInitiativeTask = (task: WorkflowTask): boolean =>
     normalizeTaskType(task.type) === "initiative";

const countThemeTasks = (tasks: WorkflowTask[], environment?: string): number => {
    const themeTasks = tasks.filter((task) => normalizeTaskType(task.type) === "theme");
    console.log(
        `[WORKFLOW] countThemeTasks env=${environment ?? "n/a"} totalTasks=${tasks.length} themeCandidates=${themeTasks.length}`,
    );
    console.log(
        `[WORKFLOW] countThemeTasks details=${themeTasks
            .map(
                (task) =>
                    `${task.id ?? "unknown"}/${normalizeTaskStatus(task.status) || "unset"}/${normalizeTaskType(
                        task.type,
                    )}`,
            )
            .join(", ")}`,
    );
    return themeTasks.length;
};

const isFeatureLikeTask = (task: WorkflowTask): boolean => {
	const type = normalizeTaskType(task.type);
	const status = normalizeTaskStatus(task.status);
	const isActive = status === "todo" || status === "in-progress";
	if (!isActive) {
		return false;
	}
	if (type === "feature") {
		return true;
	}
	if (type === "task") {
		const text = `${task.title ?? ""} ${task.description ?? ""}`.toLowerCase();
		return text.includes("feature");
	}
	return false;
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

const parseTestStatus = (value: unknown): "passed" | "failed" | null => {
    const text = typeof value === "string" ? value : "";
    if (!text) {
        return null;
    }
    const match = text.match(/test status\s*:\s*(passed|failed)/i);
    if (!match) {
        return null;
    }
    const status = match[1].toLowerCase();
    return status === "passed" ? "passed" : "failed";
};

const parseTestStatusValue = (value: unknown): "passed" | "failed" | null => {
    if (typeof value !== "string") {
        return null;
    }
    const normalized = value.trim().toLowerCase();
    if (normalized === "passed") {
        return "passed";
    }
    if (normalized === "failed") {
        return "failed";
    }
    return null;
};

const parseE2eResultStatusValue = (value: unknown): "PASSED" | "FAILED" | null => {
    if (typeof value !== "string") {
        return null;
    }
    const normalized = value.trim().toUpperCase();
    if (normalized === "PASSED") {
        return "PASSED";
    }
    if (normalized === "FAILED") {
        return "FAILED";
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

const uniqueStrings = (values: string[]): string[] =>
    values.reduce<string[]>(
        (acc, value) => (acc.includes(value) ? acc : [...acc, value]),
        [],
    );

const resolveE2eResultStatusFromContext = (
    record: Record<string, unknown>,
): "PASSED" | "FAILED" | null => {
    const direct = parseE2eResultStatusValue(record.e2eTestResultStatus);
    if (direct) {
        return direct;
    }
    const dashed = parseE2eResultStatusValue(record["e2e-test-result-status"]);
    if (dashed) {
        return dashed;
    }
    const qaStatus = parseTestStatusValue(record.testStatus);
    if (qaStatus === "passed") {
        return "PASSED";
    }
    if (qaStatus === "failed") {
        return "FAILED";
    }
    return null;
};

const resolveE2eFailedTestsFromContext = (record: Record<string, unknown>): string[] => {
    const e2eResults =
        record.e2eTestResults && typeof record.e2eTestResults === "object"
            ? (record.e2eTestResults as Record<string, unknown>)
            : null;
    const dashedE2eResults =
        record["e2e-test-results"] && typeof record["e2e-test-results"] === "object"
            ? (record["e2e-test-results"] as Record<string, unknown>)
            : null;
    const testReport =
        record.testReport && typeof record.testReport === "object"
            ? (record.testReport as Record<string, unknown>)
            : null;
    return uniqueStrings([
        ...normalizeStringArray(e2eResults?.failedTests),
        ...normalizeStringArray(dashedE2eResults?.failedTests),
        ...normalizeStringArray(testReport?.failedTests),
    ]);
};

const resolveQaStatusFromContext = (
    record: Record<string, unknown>,
): "passed" | "failed" | null => {
    const direct = parseTestStatusValue(record.testStatus);
    if (direct) {
        return direct;
    }
    const report =
        record.testReport && typeof record.testReport === "object"
            ? (record.testReport as Record<string, unknown>)
            : null;
    const reportStatus = parseTestStatusValue(report?.testStatus);
    if (reportStatus) {
        return reportStatus;
    }
    const lastTestResult =
        record.lastTestResult && typeof record.lastTestResult === "object"
            ? (record.lastTestResult as Record<string, unknown>)
            : undefined;
    const statusFromOutput =
        parseTestStatus(lastTestResult?.output)
        ?? parseTestStatus(lastTestResult?.summary)
        ?? parseTestStatus(lastTestResult?.error);
    if (statusFromOutput) {
        return statusFromOutput;
    }
    const success =
        lastTestResult && typeof lastTestResult.success === "boolean"
            ? lastTestResult.success
            : undefined;
    if (success === true) {
        return "passed";
    }
    if (success === false) {
        return "failed";
    }
    return null;
};

const readTasks = (context: DeciderContext): WorkflowTask[] => context.tasks;

const readEnvironment = (context: DeciderContext): string | undefined =>
    typeof context.environment === "string" ? context.environment : undefined;

const alwaysDecide: DeciderFn = () => true;

const hasThemeTasksForEnvironment: DeciderFn = (context) => {
    const tasks = readTasks(context);
    const environment = readEnvironment(context);
    const themeCount = tasks.filter(
        (task) => isThemeTask(task) && matchesEnvironmentForTask(task, environment),
    ).length;
    console.log(
        `[WORKFLOW] themes-proposed decider: ${tasks.length} tasks, ${themeCount} theme tasks (env=${environment ?? "n/a"})`,
    );
    return themeCount > 0;
};

const hasFewerThanThreeThemesForEnvironment: DeciderFn = (context) => {
    const tasks = readTasks(context);
    const environment = readEnvironment(context);
    const themeTasks = tasks.filter(
        (task) => isThemeTask(task) && matchesEnvironmentForTask(task, environment),
    );
    console.log(
        `[WORKFLOW] themes-prioritized: found ${themeTasks.length} theme(s) (env=${environment ?? "n/a"})`,
    );
    console.log(
        `[WORKFLOW] themes-prioritized: theme statuses = ${themeTasks
            .map((task) => normalizeTaskStatus(task.status))
            .join(", ")}`,
    );
    return themeTasks.length < 3;
};

const hasInitiativeTasksForEnvironment: DeciderFn = (context) => {
    const tasks = readTasks(context);
    const environment = readEnvironment(context);
    const initiativeCount = tasks.filter(
        (task) => isInitiativeTask(task) && matchesEnvironmentForTask(task, environment),
    ).length;
    if (initiativeCount > 0) {
        console.log(
            "[WORKFLOW] themes-prioritized: branching to prioritize-initiatives (initiatives already exist)",
        );
    }
    return initiativeCount > 0;
};

const hasNoThemeTasks: DeciderFn = (context) => readTasks(context).filter(isThemeTask).length === 0;

const hasNoInitiativeTasks: DeciderFn = (context) =>
    readTasks(context).filter(isInitiativeTask).length === 0;

const hasFewerThanFiveInitiatives: DeciderFn = (context) =>
    readTasks(context).filter(isInitiativeTask).length < 5;

const hasFeatureLikeTasks = (context: DeciderContext): boolean =>
    readTasks(context).some(isFeatureLikeTask);

const hasNoFeatureLikeTasks = (context: DeciderContext): boolean =>
    !hasFeatureLikeTasks(context);

const shouldPrioritizeStoriesFromFeatures: DeciderFn = (context) => {
    const tasks = readTasks(context);
    const activeFeatures = tasks.filter(isFeatureLikeTask);
    const storyTasks = tasks.filter(
        (task) => normalizeTaskType(task.type) === "story" && isActiveStatus(task.status),
    );
    if (activeFeatures.length === 1) {
        const feature = activeFeatures[0];
        const featureId = feature.id;
        const featureTitle = (feature.title ?? "").trim().toLowerCase();
        return storyTasks.some((story) => {
            const deps = story.dependencies ?? [];
            if (featureId && deps.includes(featureId)) {
                return true;
            }
            if (featureTitle.length === 0) {
                return false;
            }
            const text = `${story.title ?? ""} ${story.description ?? ""}`.toLowerCase();
            return text.includes(featureTitle);
        });
    }
    return storyTasks.length > 0;
};

const hasActiveStories = (context: DeciderContext): boolean =>
    readTasks(context).some(
        (task) => normalizeTaskType(task.type) === "story" && isActiveStatus(task.status),
    );

const hasFeatureAndOrStoriesForPrioritization: DeciderFn = (context) => {
    if (hasActiveStories(context)) {
        return true;
    }
    return readTasks(context).some(isFeatureLikeTask);
};

const hasQaPassed: DeciderFn = (context) =>
    resolveQaStatusFromContext(context as Record<string, unknown>) === "passed";

const hasE2eFailed: DeciderFn = (context) => {
    const record = context as Record<string, unknown>;
    const status = resolveE2eResultStatusFromContext(record);
    const hasE2eFailures = resolveE2eFailedTestsFromContext(record).length > 0;
    return status === "FAILED" || (status === null && hasE2eFailures);
};

const hasE2ePassed: DeciderFn = (context) => {
    const record = context as Record<string, unknown>;
    const status = resolveE2eResultStatusFromContext(record);
    const hasE2eFailures = resolveE2eFailedTestsFromContext(record).length > 0;
    if (status === "FAILED") {
        return false;
    }
    if (status === "PASSED") {
        return !hasE2eFailures;
    }
    return hasQaPassed(context) && !hasE2eFailures;
};

const hasInProgressImplementationTasks: DeciderFn = (context) =>
    readTasks(context).some(
        (task) => isImplementationTask(task) && task.status === "in-progress",
    );

const hasActionableImplementationTasks: DeciderFn = (context) => {
    const tasks = readTasks(context);
    return tasks.some(
        (task) =>
            isImplementationTask(task)
            && isWorkflowTaskActionable(task)
            && dependenciesSatisfied(task, tasks),
    );
};

const hasActionableStories: DeciderFn = (context) =>
    readTasks(context).some(
        (task) => normalizeTaskType(task.type) === "story" && isWorkflowTaskActionable(task),
    );

type TasksPreparedTransitionName =
    | "close-invalid-task"
    | "begin-implementation"
    | "need-more-tasks";

const tasksPreparedDecisionCache = new WeakMap<object, TasksPreparedTransitionName>();

const resolveTasksPreparedTransitionDecision = async (
    context: DeciderContext,
): Promise<TasksPreparedTransitionName> => {
    const cacheKey = context as object;
    const cached = tasksPreparedDecisionCache.get(cacheKey);
    if (cached) {
        return cached;
    }
    const decision = (await decideTasksPreparedTransition(
        readTasks(context),
        context,
        WORKFLOW["tasks-prepared"],
    )) as TasksPreparedTransitionName;
    tasksPreparedDecisionCache.set(cacheKey, decision);
    return decision;
};

const shouldCloseInvalidTask: DeciderFn = async (context) =>
    (await resolveTasksPreparedTransitionDecision(context)) === "close-invalid-task";

const shouldBeginImplementation: DeciderFn = async (context) =>
    (await resolveTasksPreparedTransitionDecision(context)) === "begin-implementation";

export type WorkflowStateName =
	| "themes-proposed"
	| "themes-prioritized"
	| "initiatives-proposed"
	| "initiatives-prioritized"
	| "new-feature-proposed"
	| "features-prioritized"
	| "stories-created"
	| "stories-prioritized"
	| "tasks-prepared"
	| "task-in-progress"
	| "lint-completed"
	| "typecheck-completed"
	| "unit-tests-completed"
	| "e2e-tests-completed"
	| "coverage-completed"
	| "integration-ready"
	| "task-completed";

const transitionEffects: Partial<
	Record<WorkflowStateName, Partial<Record<string, TransitionEffect>>>
> = {
	"themes-proposed": {
		"retry-theme-research": (payload?: unknown) =>
			handleThemeResearchTransition(
				payload,
				WORKFLOW["themes-proposed"],
				"retry-theme-research",
			),
	},
	"themes-prioritized": {
		"define-initiatives": (payload?: unknown) =>
			handleInitiativeResearchTransition(
				payload,
				WORKFLOW["initiatives-proposed"],
				"define-initiatives",
			),
	},
	"initiatives-proposed": {
		"retry-initiative-research": (payload?: unknown) =>
			handleInitiativeResearchTransition(
				payload,
				WORKFLOW["initiatives-proposed"],
				"retry-initiative-research",
			),
	},
	"initiatives-prioritized": {
		"define-initiatives": (payload?: unknown) =>
			handleInitiativeResearchTransition(
				payload,
				WORKFLOW["initiatives-proposed"],
				"define-initiatives",
			),
		"research-new-features": (payload?: unknown) =>
			handleProductResearchTransition(
				payload,
				WORKFLOW["new-feature-proposed"],
				"research-new-features",
			),
	},
	"new-feature-proposed": {
		"define-initiatives": (payload?: unknown) =>
			handleInitiativeResearchTransition(
				payload,
				WORKFLOW["initiatives-proposed"],
				"define-initiatives",
			),
		"retry-product-research": (payload?: unknown) =>
			handleProductResearchTransition(
				payload,
				WORKFLOW["new-feature-proposed"],
				"retry-product-research",
			),
	},
	"features-prioritized": {
		"do-ux-research": (payload?: unknown) =>
			handleUxResearchTransition(payload, WORKFLOW["stories-created"]),
	},
	"tasks-prepared": {
		"close-invalid-task": (payload?: unknown) =>
			handleCloseInvalidTaskTransition(payload, WORKFLOW["tasks-prepared"]),
	},
	"task-completed": {
		"pick-up-next-task": () => logTransition("tasks-prepared"),
		"research-new-themes": (payload?: unknown) =>
			handleThemeResearchTransition(
				payload,
				WORKFLOW["themes-proposed"],
				"research-new-themes",
			),
	},
};

const buildTransitionsFor = (stateName: WorkflowStateName): TransitionDefinition[] => {
	const effectsForState = transitionEffects[stateName] ?? {};
	return workflowLinks
		.filter((link) => link.source === stateName)
		.map((link) =>
			createTransition(link.label, link.target, effectsForState[link.label]),
		);
};

// Canonical workflow assembled via factories.
const baseStateDefs: Array<StateDefinition> = [
	{
		name: "themes-proposed",
		description: "Portfolio themes are identified for strategic direction.",
		profile: "portfolio-manager",
		targetType: "theme",
			promptHint:
				"Produce exactly one theme: title, strategic outcome, scope, and priority.",
			defaultTransition: "retry-theme-research",
			transitions: buildTransitionsFor("themes-proposed"),
			deciders: [
				{
					transitionName: "prioritize-themes",
					decider: hasThemeTasksForEnvironment,
				},
				{
					transitionName: "retry-theme-research",
					decider: alwaysDecide,
				},
			],
		},
	{
		name: "themes-prioritized",
		description: "Themes are ordered for roadmap planning.",
		profile: "portfolio-manager",
		targetType: "theme",
			promptHint:
				"Prioritize up to 3 active themes using deterministic ranking (existing priority, dependency count, stable id tie-break). Apply high/medium/low and return Summary, Top themes, Changes applied.",
			transitions: buildTransitionsFor("themes-prioritized"),
			deciders: [
				{
					transitionName: "request-theme",
					decider: hasFewerThanThreeThemesForEnvironment,
				},
				{
					transitionName: "prioritize-initiatives",
					decider: hasInitiativeTasksForEnvironment,
				},
				{
					transitionName: "define-initiatives",
					decider: alwaysDecide,
				},
			],
		},
	{
		name: "initiatives-proposed",
		description: "Initiatives have been drafted under a theme.",
		profile: "portfolio-manager",
		targetType: "initiative",
			promptHint:
				"Create 2-4 initiatives for the selected theme. Include the theme id as a dependency on each initiative.",
			defaultTransition: "retry-initiative-research",
			transitions: buildTransitionsFor("initiatives-proposed"),
			deciders: [
				{
					transitionName: "request-theme",
					decider: hasNoThemeTasks,
				},
				{
					transitionName: "retry-initiative-research",
					decider: hasNoInitiativeTasks,
				},
				{
					transitionName: "prioritize-initiatives",
					decider: alwaysDecide,
				},
			],
		},
	{
		name: "initiatives-prioritized",
		description: "Initiatives ordered for feature discovery.",
		profile: "portfolio-manager",
		targetType: "initiative",
			promptHint:
				"Prioritize up to 3 active initiatives using deterministic ranking (existing priority, dependency count, stable id tie-break). Apply high/medium/low and return Summary, Top initiatives, Changes applied.",
			transitions: buildTransitionsFor("initiatives-prioritized"),
			deciders: [
				{
					transitionName: "define-initiatives",
					decider: hasFewerThanFiveInitiatives,
				},
				{
					transitionName: "prioritize-features",
					decider: hasFeatureLikeTasks,
				},
				{
					transitionName: "research-new-features",
					decider: alwaysDecide,
				},
			],
		},
	{
		name: "new-feature-proposed",
		description: "Backlog is empty of net-new features; time to propose one.",
		profile: "product-manager",
		targetType: "feature",
			promptHint:
				"Produce exactly one feature: title, concise description, priority, and a full `prd` Product Requirements Document (minimum 2800 words). If an initiative is provided, include its id as a dependency.",
			defaultTransition: "retry-product-research",
			transitions: buildTransitionsFor("new-feature-proposed"),
			deciders: [
				{
					transitionName: "define-initiatives",
					decider: hasNoInitiativeTasks,
				},
				{
					transitionName: "retry-product-research",
					decider: hasNoFeatureLikeTasks,
				},
				{
					transitionName: "prioritize-features",
					decider: alwaysDecide,
				},
			],
		},
	{
		name: "features-prioritized",
		description: "Feature ideas exist and are prioritized.",
		profile: "ux-researcher",
		targetType: "feature",
			promptHint:
				"Prioritize up to 3 active features using deterministic ranking (existing priority, dependency count, stable id tie-break). Apply high/medium/low and return Summary, Top features, Changes applied.",
			transitions: buildTransitionsFor("features-prioritized"),
			deciders: [
				{
					transitionName: "prioritize-stories",
					decider: shouldPrioritizeStoriesFromFeatures,
				},
				{
					transitionName: "do-ux-research",
					decider: alwaysDecide,
				},
			],
		},
	{
		name: "stories-created",
		description: "Stories have been drafted from a feature.",
		profile: "ux-specialist",
		targetType: "story",
			promptHint:
				"Use MCP tools to create 3-5 stories for the selected feature. Call create_task once per story (type: \"story\", createdBy: \"ux-specialist\", include feature id as dependency). Call list_tasks after creation. Do not return JSON; return a short summary instead.",
			transitions: buildTransitionsFor("stories-created"),
			deciders: [
				{
					transitionName: "prioritize-stories",
					decider: hasFeatureAndOrStoriesForPrioritization,
				},
				{
					transitionName: "request-feature",
					decider: alwaysDecide,
				},
			],
		},
	{
		name: "stories-prioritized",
		description: "Stories ordered for execution.",
		profile: "project-manager",
		targetType: "story",
			promptHint:
				"Prioritize up to 3 active stories using deterministic ranking (existing priority, dependency count, stable id tie-break). Apply high/medium/low and return Summary, Top stories, Changes applied.",
			transitions: buildTransitionsFor("stories-prioritized"),
			deciders: [
				{
					transitionName: "refine-into-tasks",
					decider: alwaysDecide,
				},
			],
		},
	{
		name: "tasks-prepared",
		description: "Tasks exist and are ready for implementation.",
		profile: "principal-architect",
		targetType: "implementation",
			promptHint:
				"SOP: create only missing implementation tasks for the selected story. Preserve existing dependencies, add new task ids only when criteria are uncovered, and return Summary/Story used/Tasks created/Notes.",
			transitions: buildTransitionsFor("tasks-prepared"),
			deciders: [
				{
					transitionName: "close-invalid-task",
					decider: shouldCloseInvalidTask,
				},
				{
					transitionName: "begin-implementation",
					decider: shouldBeginImplementation,
				},
				{
					transitionName: "need-more-tasks",
					decider: alwaysDecide,
				},
			],
		},
	{
		name: "task-in-progress",
		description: "Implement Task tickets with TDD: write tests, implement, rerun until green.",
		profile: "senior-developer",
		targetType: "implementation",
			promptHint:
				"Write tests first; then code to make them pass. Report failing output if not green.",
			transitions: buildTransitionsFor("task-in-progress"),
			deciders: [
				{
					transitionName: "run-lint",
					decider: alwaysDecide,
				},
			],
		},
	{
		name: "lint-completed",
		description: "Lint checks completed for the current implementation task.",
		profile: "qa-specialist",
		targetType: "testing",
			promptHint:
				"Run lint only. If lint fails, return precise failure details and repro command.",
			transitions: buildTransitionsFor("lint-completed"),
			deciders: [
				{
					transitionName: "run-typecheck",
					decider: hasQaPassed,
				},
				{
					transitionName: "lint-failed",
					decider: alwaysDecide,
				},
			],
		},
	{
		name: "typecheck-completed",
		description: "Typecheck completed for the current implementation task.",
		profile: "qa-specialist",
		targetType: "testing",
			promptHint:
				"Run typecheck only. If typecheck fails, return exact diagnostics and repro command.",
			transitions: buildTransitionsFor("typecheck-completed"),
			deciders: [
				{
					transitionName: "run-unit-tests",
					decider: hasQaPassed,
				},
				{
					transitionName: "typecheck-failed",
					decider: alwaysDecide,
				},
			],
		},
	{
		name: "unit-tests-completed",
		description: "Unit tests completed for the current implementation task.",
		profile: "qa-specialist",
		targetType: "testing",
			promptHint:
				"Run unit tests only. Keep repro steps deterministic and minimal.",
			transitions: buildTransitionsFor("unit-tests-completed"),
			deciders: [
				{
					transitionName: "run-e2e-tests",
					decider: hasQaPassed,
				},
				{
					transitionName: "unit-tests-failed",
					decider: alwaysDecide,
				},
			],
		},
	{
		name: "e2e-tests-completed",
		description: "End-to-end tests completed for the current implementation task.",
		profile: "qa-specialist",
		targetType: "testing",
			promptHint:
				"Run e2e tests for impacted paths. If no e2e suite exists, report explicit skip evidence.",
			transitions: buildTransitionsFor("e2e-tests-completed"),
			deciders: [
				{
					transitionName: "e2e-tests-failed",
					decider: hasE2eFailed,
				},
				{
					transitionName: "ensure-coverage",
					decider: hasE2ePassed,
				},
			],
		},
	{
		name: "coverage-completed",
		description: "Coverage verification completed for the current implementation task.",
		profile: "qa-specialist",
		targetType: "testing",
			promptHint:
				"Verify coverage output and thresholds for impacted scope; include concrete percentages.",
			transitions: buildTransitionsFor("coverage-completed"),
			deciders: [
				{
					transitionName: "tests-passing",
					decider: hasQaPassed,
				},
				{
					transitionName: "coverage-failed",
					decider: alwaysDecide,
				},
			],
		},
	{
		name: "task-completed",
		description: "Task closed; notify and pick up another.",
			profile: "senior-developer",
			promptHint: "Trigger follow-up actions such as notifications/closure.",
			transitions: buildTransitionsFor("task-completed"),
			deciders: [
				{
					transitionName: "pick-up-next-task",
					decider: hasInProgressImplementationTasks,
				},
				{
					transitionName: "pick-up-next-task",
					decider: hasActionableImplementationTasks,
				},
				{
					transitionName: "prioritize-stories",
					decider: hasActionableStories,
				},
				{
					transitionName: "prioritize-features",
					decider: hasFeatureLikeTasks,
				},
				{
					transitionName: "prioritize-initiatives",
					decider: (context) => readTasks(context).some(isInitiativeTask),
				},
				{
					transitionName: "prioritize-themes",
					decider: (context) => readTasks(context).some(isThemeTask),
				},
				{
					transitionName: "research-new-themes",
					decider: alwaysDecide,
				},
			],
		},
];

const buildWithEffects = (
	effects?: Partial<Record<WorkflowStateName, Partial<Record<string, TransitionEffect>>>>,
): Record<WorkflowStateName, RuntimeState> =>
	assembleWorkflow(
		baseStateDefs.map((state) => {
			const overrides = effects?.[state.name];
			if (!overrides) return state;
			return {
				...state,
				transitions: state.transitions.map((t) =>
					createTransition(t.name, t.next, overrides[t.name] ?? t.effect ?? noopEffect),
				),
			};
		}),
	);

export const WORKFLOW: Record<WorkflowStateName, RuntimeState> = buildWithEffects();

export function buildWorkflowWithEffects(
	effects?: Partial<Record<WorkflowStateName, Partial<Record<string, TransitionEffect>>>>,
): Record<WorkflowStateName, RuntimeState> {
	return buildWithEffects(effects);
}

export function getNextState(
	current: WorkflowStateName,
	transition: string,
): WorkflowStateName | undefined {
	return WORKFLOW[current]?.transitions[transition]?.next;
}

export function getNextStateFrom(
	workflow: Record<WorkflowStateName, RuntimeState>,
	current: WorkflowStateName,
	transition: string,
): WorkflowStateName | undefined {
	return workflow[current]?.transitions[transition]?.next;
}
