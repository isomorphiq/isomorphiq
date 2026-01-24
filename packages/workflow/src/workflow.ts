import { logTransition, noopEffect } from "./transition-effects.ts";
import type { Task } from "@isomorphiq/tasks";
import {
	assembleWorkflow,
	createTransition,
	type RuntimeState,
	type StateDefinition,
	type TransitionEffect,
} from "./workflow-factory.ts";

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

// Canonical workflow assembled via factories.
const baseStateDefs: Array<StateDefinition> = [
	{
		name: "new-feature-proposed",
		description: "Backlog is empty of net-new features; time to propose one.",
		profile: "product-research",
		targetType: "feature",
		promptHint:
			"Produce exactly one feature: title, rich description, user value, acceptance criteria, priority.",
		transitions: [
			createTransition("retry-product-research", "new-feature-proposed"),
			createTransition("prioritize-features", "features-prioritized"),
		],
		decider: (tasks) => {
			// Treat obvious feature-shaped records as features, even if type was mis-labeled as task.
			const isFeatureLike = (t: Task) =>
				(t.type === "feature" ||
					(t.type === "task" &&
						(/feature/i.test(t.title ?? "") || /feature/i.test(t.description ?? "")))) &&
				t.status === "todo";

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
		profile: "roadmapping",
		targetType: "feature",
		promptHint: "Return reordered/prioritized feature list (IDs + priority).",
		transitions: [
			createTransition("do-ux-research", "stories-created"),
			createTransition("prioritize-stories", "stories-prioritized"),
		],
		decider: (tasks) => {
			const hasStories = tasks.some((t) => t.type === "story" && t.status === "todo");
			// Prefer to consume existing stories before generating more.
			if (hasStories) return "prioritize-stories";
			return "do-ux-research";
		},
	},
	{
		name: "stories-created",
		description: "Stories have been drafted from a feature.",
		profile: "ux-research",
		targetType: "story",
		promptHint: "Produce 3-5 stories with AC for the selected feature.",
		transitions: [
			createTransition("prioritize-stories", "stories-prioritized"),
			createTransition("request-feature", "new-feature-proposed"),
		],
		decider: (tasks) => {
			const hasStories = tasks.some((t) => t.type === "story" && t.status === "todo");
			if (hasStories) return "prioritize-stories";
			// If stories somehow vanished, ask for a feature to restart the pipeline.
			const hasFeature = tasks.some((t) => t.type === "feature" && t.status === "todo");
			return hasFeature ? "prioritize-stories" : "request-feature";
		},
	},
	{
		name: "stories-prioritized",
		description: "Stories ordered for execution.",
		profile: "planning",
		targetType: "story",
		promptHint: "Return ordered story IDs (highest priority first).",
		transitions: [createTransition("refine-into-tasks", "tasks-prepared")],
		decider: () => "refine-into-tasks",
	},
	{
		name: "tasks-prepared",
		description: "Tasks exist and are ready for implementation.",
		profile: "refinement",
		targetType: "task",
		promptHint: "Produce 3-7 tasks with AC and priority for the story.",
		transitions: [
			createTransition("begin-implementation", "task-in-progress"),
			createTransition("need-more-tasks", "stories-prioritized"),
		],
		decider: (tasks) => {
			const hasTasks = tasks.some((t) => t.type === "task" && t.status === "todo");
			if (hasTasks) return "begin-implementation";
			return "need-more-tasks";
		},
	},
	{
		name: "task-in-progress",
		description: "Implement Task tickets with TDD: write tests, implement, rerun until green.",
		profile: "development",
		targetType: "task",
		promptHint:
			"Write tests first; then code to make them pass. Report failing output if not green.",
		transitions: [
			createTransition("run-tests", "tests-completed"),
			createTransition("refine-task", "tasks-prepared"),
		],
		decider: (tasks) => {
			const hasTask = tasks.some((t) => t.type === "task" && t.status === "todo");
			// If nothing to work on, go upstream to request refinement; otherwise keep the test loop moving.
			return hasTask ? "run-tests" : "refine-task";
		},
	},
	{
		name: "tests-completed",
		description: "Run unit + integration/regression tests for the completed task.",
		profile: "integration-testing",
		targetType: "integration",
		promptHint:
			"Run unit + integration suite; suggest fixes. Up to 3 attempts; if failures shrink, continue.",
		transitions: [
			createTransition("tests-passing", "task-completed"),
			createTransition("tests-failed", "task-in-progress"),
		],
		// Runtime code overrides this using actual test results; keep default deterministic.
		decider: () => "tests-passing",
	},
	{
		name: "task-completed",
		description: "Task closed; notify and pick up another.",
		profile: "development",
		promptHint: "Trigger follow-up actions such as notifications/closure.",
		transitions: [
			createTransition("pick-up-next-task", "tasks-prepared", () =>
				logTransition("tasks-prepared"),
			),
			createTransition("research-new-features", "new-feature-proposed", noopEffect),
			createTransition("prioritize-features", "features-prioritized", noopEffect),
			createTransition("prioritize-stories", "stories-prioritized", noopEffect),
		],
		decider: (tasks) => {
			const hasTasksReady = tasks.some((t) => t.type === "task" && t.status === "todo");
			if (hasTasksReady) return "pick-up-next-task";

			const hasStories = tasks.some((t) => t.type === "story" && t.status === "todo");
			if (hasStories) return "prioritize-stories";

			// No tasks and no stories to feed refinement; go back to product research.
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
