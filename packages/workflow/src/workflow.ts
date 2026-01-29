import { logTransition } from "./transition-effects.ts";
import { handleProductResearchTransition } from "./feature-creation.ts";
import { handleUxResearchTransition } from "./story-creation.ts";
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

const isTestingTask = (task: WorkflowTask): boolean => {
    const type = normalizeTaskType(task.type);
    return type === "testing" || type === "integration";
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

export type WorkflowStateName =
	| "new-feature-proposed"
	| "features-prioritized"
	| "stories-created"
	| "stories-prioritized"
	| "tasks-prepared"
	| "task-in-progress"
	| "integration-ready"
	| "task-completed"
	| "tests-completed";

const transitionEffects: Partial<
	Record<WorkflowStateName, Partial<Record<string, TransitionEffect>>>
> = {
	"new-feature-proposed": {
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
		"research-new-features": (payload?: unknown) =>
			handleProductResearchTransition(
				payload,
				WORKFLOW["new-feature-proposed"],
				"research-new-features",
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
		name: "new-feature-proposed",
		description: "Backlog is empty of net-new features; time to propose one.",
		profile: "product-manager",
		targetType: "feature",
		promptHint:
			"Produce exactly one feature: title, rich description, user value, acceptance criteria, priority.",
		defaultTransition: "retry-product-research",
		transitions: buildTransitionsFor("new-feature-proposed"),
		decider: (tasks: WorkflowTask[]) => {
			// Treat obvious feature-shaped records as features, even if type was mis-labeled as task.
			const isFeatureLike = (t: WorkflowTask) => {
				const type = normalizeTaskType(t.type);
				const status = normalizeTaskStatus(t.status);
				const isFeature =
					type === "feature"
					|| (type === "task"
						&& (/feature/i.test(t.title ?? "")
							|| /feature/i.test(t.description ?? "")));
				const isActive = status === "todo" || status === "in-progress";
				return isFeature && isActive;
			};

			const featureCount = tasks.filter(isFeatureLike).length;

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
		promptHint: "Return reordered/prioritized feature list (IDs + priority).",
		transitions: buildTransitionsFor("features-prioritized"),
		decider: (tasks: WorkflowTask[]) => {
			const isFeatureLike = (t: WorkflowTask): boolean => {
				const type = normalizeTaskType(t.type);
				const isFeature =
					type === "feature"
					|| (type === "task"
						&& (/feature/i.test(t.title ?? "")
							|| /feature/i.test(t.description ?? "")));
				return isFeature && isActiveStatus(t.status);
			};
			const activeFeatures = tasks.filter(isFeatureLike);
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
			const hasFeature = tasks.some(
				(t) => normalizeTaskType(t.type) === "feature" && isActiveStatus(t.status),
			);
			return hasFeature ? "prioritize-stories" : "request-feature";
		},
	},
	{
		name: "stories-prioritized",
		description: "Stories ordered for execution.",
		profile: "project-manager",
		targetType: "story",
		promptHint: "Return ordered story IDs (highest priority first).",
		transitions: buildTransitionsFor("stories-prioritized"),
		decider: () => "refine-into-tasks",
	},
	{
		name: "tasks-prepared",
		description: "Tasks exist and are ready for implementation.",
		profile: "principal-architect",
		targetType: "implementation",
		promptHint: "Produce 3-7 tasks with AC and priority for the story.",
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
		decider: (tasks: WorkflowTask[]) => {
			const hasActionableTesting = tasks.some(
				(task) =>
					isTestingTask(task) &&
					isWorkflowTaskActionable(task) &&
					dependenciesSatisfied(task, tasks),
			);
			if (hasActionableTesting) return "run-tests";

			const hasInProgressTask = tasks.some(
				(task) => isImplementationTask(task) && task.status === "in-progress",
			);
			if (hasInProgressTask) return "additional-implementation";

			const hasActionableImplementation = tasks.some(
				(task) =>
					isImplementationTask(task) &&
					isWorkflowTaskActionable(task) &&
					dependenciesSatisfied(task, tasks),
			);
			if (hasActionableImplementation) return "additional-implementation";

			// If no active task but work exists, go back to tasks-prepared for PM review.
			return "refine-task";
		},
	},
	{
		name: "tests-completed",
		description: "Run unit + integration/regression tests for the completed task.",
		profile: "qa-specialist",
		targetType: "testing",
		promptHint:
			"Run unit + integration suite; suggest fixes. Up to 3 attempts; if failures shrink, continue.",
		transitions: buildTransitionsFor("tests-completed"),
		decider: (tasks: WorkflowTask[]) => {
			const testingTasks = tasks.filter((task) => isTestingTask(task));
			if (testingTasks.length === 0) {
				return "tests-passing";
			}
			const hasOpenTesting = testingTasks.some(
				(task) => task.status !== "done" && task.status !== "invalid",
			);
			return hasOpenTesting ? "tests-failed" : "tests-passing";
		},
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
				(task) => isImplementationTask(task) && isWorkflowTaskActionable(task),
			);
			if (hasTasksReady) return "pick-up-next-task";

			const hasStories = tasks.some(
				(t) => t.type === "story" && isWorkflowTaskActionable(t),
			);
			if (hasStories) return "prioritize-stories";

            const normalizeValue = (value: string | undefined): string =>
                (value ?? "").trim().toLowerCase();
            const isFeatureCandidate = (task: WorkflowTask): boolean => {
                const status = normalizeValue(task.status);
                const statusOk = status === "todo" || status === "in-progress";
                if (!statusOk) {
                    return false;
                }
                const type = normalizeValue(task.type);
                if (type === "feature") {
                    return true;
                }
                if (type === "task") {
                    const text = `${task.title ?? ""} ${task.description ?? ""}`.toLowerCase();
                    return text.includes("feature");
                }
                return false;
            };
            if (tasks.some(isFeatureCandidate)) {
                return "prioritize-features";
            }

			// No tasks, stories, or features to feed refinement; go back to product research.
			return "research-new-features";
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
