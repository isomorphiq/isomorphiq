import { logTransition } from "./transition-effects.ts";
import { handleProductResearchTransition } from "./feature-creation.ts";
import { handleUxResearchTransition } from "./story-creation.ts";
import { handleInitiativeResearchTransition, handleThemeResearchTransition } from "./portfolio-creation.ts";
import {
	assembleWorkflow,
	createTransition,
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
    normalizeTaskType(task.type) === "theme" && isActiveStatus(task.status);

const isInitiativeTask = (task: WorkflowTask): boolean =>
    normalizeTaskType(task.type) === "initiative" && isActiveStatus(task.status);

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

const decideQaTransition = (
    context: unknown,
    passTransition: string,
    failTransition: string,
): string => {
    const record =
        context && typeof context === "object" ? (context as Record<string, unknown>) : {};
    const qaStatus = resolveQaStatusFromContext(record);
    if (qaStatus === "passed") {
        return passTransition;
    }
    if (qaStatus === "failed") {
        return failTransition;
    }
    return failTransition;
};

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
		decider: (tasks: WorkflowTask[]) => {
			const themeCount = tasks.filter(isThemeTask).length;
			if (themeCount === 0) return "retry-theme-research";
			return "prioritize-themes";
		},
	},
	{
		name: "themes-prioritized",
		description: "Themes are ordered for roadmap planning.",
		profile: "portfolio-manager",
		targetType: "theme",
		promptHint:
			"Prioritize up to 3 active themes using deterministic ranking (existing priority, dependency count, stable id tie-break). Apply high/medium/low and return Summary, Top themes, Changes applied.",
		transitions: buildTransitionsFor("themes-prioritized"),
		decider: (tasks: WorkflowTask[], context?: unknown) => {
			const environment =
				context && typeof context === "object"
					? (context as Record<string, unknown>).environment
					: undefined;
			const themeTasks = tasks.filter((task) => normalizeTaskType(task.type) === "theme");
			const themeCount = themeTasks.length;
			console.log(
				`[WORKFLOW] themes-prioritized: found ${themeCount} theme(s) (env=${environment ?? "n/a"})`,
			);
			console.log(
				`[WORKFLOW] themes-prioritized: theme statuses = ${themeTasks
					.map((task) => normalizeTaskStatus(task.status))
					.join(", ")}`,
			);
			const comparison = themeCount > 3;
			console.log(`[WORKFLOW] themes-prioritized: comparison >3 => ${comparison}`);
			if (comparison) {
				console.log("[WORKFLOW] themes-prioritized: branching to define-initiatives");
				return "define-initiatives";
			}
			console.log("[WORKFLOW] themes-prioritized: branching to request-theme");
			return "request-theme";
		},
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
		decider: (tasks: WorkflowTask[]) => {
			const themes = tasks.filter(isThemeTask);
			if (themes.length === 0) return "request-theme";
			const initiatives = tasks.filter(isInitiativeTask);
			if (initiatives.length === 0) return "retry-initiative-research";
			return "prioritize-initiatives";
		},
	},
	{
		name: "initiatives-prioritized",
		description: "Initiatives ordered for feature discovery.",
		profile: "portfolio-manager",
		targetType: "initiative",
		promptHint:
			"Prioritize up to 3 active initiatives using deterministic ranking (existing priority, dependency count, stable id tie-break). Apply high/medium/low and return Summary, Top initiatives, Changes applied.",
		transitions: buildTransitionsFor("initiatives-prioritized"),
		decider: (tasks: WorkflowTask[]) => {
			const initiatives = tasks.filter(isInitiativeTask);
            if (initiatives.length < 5) return "define-initiatives";
			const featureCount = tasks.filter(isFeatureLikeTask).length;
			return featureCount > 0 ? "prioritize-features" : "research-new-features";
		},
	},
	{
		name: "new-feature-proposed",
		description: "Backlog is empty of net-new features; time to propose one.",
		profile: "product-manager",
		targetType: "feature",
		promptHint:
			"Produce exactly one feature: title, rich description, user value, acceptance criteria, priority. If an initiative is provided, include its id as a dependency.",
		defaultTransition: "retry-product-research",
		transitions: buildTransitionsFor("new-feature-proposed"),
		decider: (tasks: WorkflowTask[]) => {
			const initiativeCount = tasks.filter(isInitiativeTask).length;
			if (initiativeCount === 0) return "define-initiatives";

			const featureCount = tasks.filter(isFeatureLikeTask).length;
			if (featureCount === 0) return "retry-product-research";

			// If we already have plenty queued, stop generating more and proceed to prioritization.
			if (featureCount > 10) return "prioritize-features";

			return "prioritize-features";
		},
	},
	{
		name: "features-prioritized",
		description: "Feature ideas exist and are prioritized.",
		profile: "ux-researcher",
		targetType: "feature",
		promptHint:
			"Prioritize up to 3 active features using deterministic ranking (existing priority, dependency count, stable id tie-break). Apply high/medium/low and return Summary, Top features, Changes applied.",
		transitions: buildTransitionsFor("features-prioritized"),
		decider: (tasks: WorkflowTask[]) => {
			const activeFeatures = tasks.filter(isFeatureLikeTask);
			const storyTasks = tasks.filter(
				(t) => normalizeTaskType(t.type) === "story" && isActiveStatus(t.status),
			);
			if (activeFeatures.length === 1) {
				const feature = activeFeatures[0];
				const featureId = feature.id;
				const featureTitle = (feature.title ?? "").trim().toLowerCase();
				const hasStoriesForFeature = storyTasks.some((story) => {
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
				return hasStoriesForFeature ? "prioritize-stories" : "do-ux-research";
			}
			// Prefer to consume existing stories before generating more.
			if (storyTasks.length > 0) return "prioritize-stories";
			return "do-ux-research";
		},
	},
	{
		name: "stories-created",
		description: "Stories have been drafted from a feature.",
		profile: "ux-specialist",
		targetType: "story",
		promptHint:
			"Use MCP tools to create 3-5 stories for the selected feature. Call create_task once per story (type: \"story\", createdBy: \"ux-specialist\", include feature id as dependency). Call list_tasks after creation. Do not return JSON; return a short summary instead.",
		transitions: buildTransitionsFor("stories-created"),
		decider: (tasks: WorkflowTask[]) => {
			const hasStories = tasks.some(
				(t) => normalizeTaskType(t.type) === "story" && isActiveStatus(t.status),
			);
			if (hasStories) return "prioritize-stories";
			// If stories somehow vanished, ask for a feature to restart the pipeline.
			const hasFeature = tasks.some(isFeatureLikeTask);
			return hasFeature ? "prioritize-stories" : "request-feature";
		},
	},
	{
		name: "stories-prioritized",
		description: "Stories ordered for execution.",
		profile: "project-manager",
		targetType: "story",
		promptHint:
			"Prioritize up to 3 active stories using deterministic ranking (existing priority, dependency count, stable id tie-break). Apply high/medium/low and return Summary, Top stories, Changes applied.",
		transitions: buildTransitionsFor("stories-prioritized"),
		decider: () => "refine-into-tasks",
	},
	{
		name: "tasks-prepared",
		description: "Tasks exist and are ready for implementation.",
		profile: "principal-architect",
		targetType: "implementation",
		promptHint:
			"SOP: create only missing implementation tasks for the selected story. Preserve existing dependencies, add new task ids only when criteria are uncovered, and return Summary/Story used/Tasks created/Notes.",
		transitions: buildTransitionsFor("tasks-prepared"),
		decider: async (tasks: WorkflowTask[], context?: unknown) =>
			decideTasksPreparedTransition(tasks, context, WORKFLOW["tasks-prepared"]),
	},
	{
		name: "task-in-progress",
		description: "Implement Task tickets with TDD: write tests, implement, rerun until green.",
		profile: "senior-developer",
		targetType: "implementation",
		promptHint:
			"Write tests first; then code to make them pass. Report failing output if not green.",
		transitions: buildTransitionsFor("task-in-progress"),
		decider: () => "run-lint",
	},
	{
		name: "lint-completed",
		description: "Lint checks completed for the current implementation task.",
		profile: "qa-specialist",
		targetType: "testing",
		promptHint:
			"Run lint only. If lint fails, return precise failure details and repro command.",
		transitions: buildTransitionsFor("lint-completed"),
		decider: (_tasks: WorkflowTask[], context?: unknown) =>
			decideQaTransition(context, "run-typecheck", "lint-failed"),
	},
	{
		name: "typecheck-completed",
		description: "Typecheck completed for the current implementation task.",
		profile: "qa-specialist",
		targetType: "testing",
		promptHint:
			"Run typecheck only. If typecheck fails, return exact diagnostics and repro command.",
		transitions: buildTransitionsFor("typecheck-completed"),
		decider: (_tasks: WorkflowTask[], context?: unknown) =>
			decideQaTransition(context, "run-unit-tests", "typecheck-failed"),
	},
	{
		name: "unit-tests-completed",
		description: "Unit tests completed for the current implementation task.",
		profile: "qa-specialist",
		targetType: "testing",
		promptHint:
			"Run unit tests only. Keep repro steps deterministic and minimal.",
		transitions: buildTransitionsFor("unit-tests-completed"),
		decider: (_tasks: WorkflowTask[], context?: unknown) =>
			decideQaTransition(context, "run-e2e-tests", "unit-tests-failed"),
	},
	{
		name: "e2e-tests-completed",
		description: "End-to-end tests completed for the current implementation task.",
		profile: "qa-specialist",
		targetType: "testing",
		promptHint:
			"Run e2e tests for impacted paths. If no e2e suite exists, report explicit skip evidence.",
		transitions: buildTransitionsFor("e2e-tests-completed"),
		decider: (_tasks: WorkflowTask[], context?: unknown) =>
			decideQaTransition(context, "ensure-coverage", "e2e-tests-failed"),
	},
	{
		name: "coverage-completed",
		description: "Coverage verification completed for the current implementation task.",
		profile: "qa-specialist",
		targetType: "testing",
		promptHint:
			"Verify coverage output and thresholds for impacted scope; include concrete percentages.",
		transitions: buildTransitionsFor("coverage-completed"),
		decider: (_tasks: WorkflowTask[], context?: unknown) =>
			decideQaTransition(context, "tests-passing", "coverage-failed"),
	},
	{
		name: "task-completed",
		description: "Task closed; notify and pick up another.",
		profile: "senior-developer",
		promptHint: "Trigger follow-up actions such as notifications/closure.",
		transitions: buildTransitionsFor("task-completed"),
		decider: (tasks: WorkflowTask[]) => {
			const hasInProgress = tasks.some(
				(task) => isImplementationTask(task) && task.status === "in-progress",
			);
			if (hasInProgress) return "pick-up-next-task";
			const hasTasksReady = tasks.some(
				(task) =>
					isImplementationTask(task)
					&& isWorkflowTaskActionable(task)
					&& dependenciesSatisfied(task, tasks),
			);
			if (hasTasksReady) return "pick-up-next-task";

			const hasStories = tasks.some(
				(t) => t.type === "story" && isWorkflowTaskActionable(t),
			);
			if (hasStories) return "prioritize-stories";

			if (tasks.some(isFeatureLikeTask)) {
				return "prioritize-features";
			}
			if (tasks.some(isInitiativeTask)) {
				return "prioritize-initiatives";
			}
			if (tasks.some(isThemeTask)) {
				return "prioritize-themes";
			}

			// No tasks, stories, features, or initiatives; return to theme discovery.
			return "research-new-themes";
		},
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
