import { createToken, type WorkflowToken } from "./workflow-engine.ts";
import type { RuntimeState, WorkflowStateName } from "./workflow-factory.ts";
import { getNextStateFrom, WORKFLOW } from "./workflow.ts";
import type { WorkflowTask, WorkflowTaskExecutor } from "./agent-runner.ts";

export type ProfileWorkflowRunnerOptions = {
    taskProvider: () => Promise<WorkflowTask[]>;
    taskExecutor: WorkflowTaskExecutor;
    initialState?: WorkflowStateName;
    environment?: string;
    pollIntervalMs?: number;
};

const sleep = (durationMs: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, durationMs));

const normalizeTaskType = (value: string | undefined): string => (value ?? "").trim().toLowerCase();

const isImplementationTaskType = (value: string | undefined): boolean => {
    const type = normalizeTaskType(value);
    return type === "implementation" || type === "task";
};

const isTestingTaskType = (value: string | undefined): boolean => {
    const type = normalizeTaskType(value);
    return type === "testing" || type === "integration";
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

const selectTaskForState = (
    tasks: WorkflowTask[],
    state: RuntimeState | null,
    targetTypeOverride?: string,
): WorkflowTask | null => {
    if (tasks.length === 0) {
        return null;
    }

    const activeTasks = tasks.filter(
        (task) => task.status !== "done" && task.status !== "invalid",
    );
    const targetType = targetTypeOverride ?? state?.targetType;
    if (!targetType) {
        return activeTasks[0] ?? tasks[0] ?? null;
    }

    const normalizedTarget = normalizeTaskType(targetType);
    const matchesTarget = (task: WorkflowTask): boolean => {
        const normalizedType = normalizeTaskType(task.type);
        if (normalizedTarget === "implementation" || normalizedTarget === "task") {
            return isImplementationTaskType(task.type);
        }
        if (normalizedTarget === "testing" || normalizedTarget === "integration") {
            return isTestingTaskType(task.type);
        }
        return normalizedType === normalizedTarget;
    };

    const candidates = activeTasks.filter(matchesTarget);
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

const resolveTargetTypeForTransition = (
    state: RuntimeState,
    transition: string,
): string | undefined => {
    const overrides: Record<string, string> = {
        "retry-product-research": "feature",
        "research-new-features": "feature",
        "prioritize-features": "feature",
        "do-ux-research": "feature",
        "prioritize-stories": "story",
        "refine-into-tasks": "story",
        "need-more-tasks": "story",
        "begin-implementation": "implementation",
        "additional-implementation": "implementation",
        "run-tests": "testing",
        "tests-passing": "testing",
        "tests-failed": "testing",
    };
    return overrides[transition] ?? state.targetType;
};

const canRunWithoutTask = (transition: string): boolean =>
    transition === "retry-product-research" || transition === "research-new-features";

const buildVirtualTask = (transition: string, targetType: string | undefined): WorkflowTask => ({
    title: `Workflow context (${transition})`,
    description: "Virtual task context for workflow execution. Do not create a task for this.",
    status: "todo",
    priority: "medium",
    type: targetType ?? "task",
});

const resolveTransition = (
    state: RuntimeState,
    tasks: WorkflowTask[],
    context: Record<string, unknown>,
): Promise<string | null> | string | null => {
    if (state.decider) {
        return state.decider(tasks, context);
    }
    if (state.defaultTransition) {
        return state.defaultTransition;
    }
    const transitions = Object.keys(state.transitions);
    return transitions.length > 0 ? transitions[0] : null;
};

const resolveProfileForTransition = (state: RuntimeState, transition: string): string => {
    const overrides: Record<string, string> = {
        "retry-product-research": "product-manager",
        "research-new-features": "product-manager",
        "prioritize-features": "product-manager",
        "do-ux-research": "ux-specialist",
        "prioritize-stories": "ux-specialist",
        "request-feature": "ux-specialist",
        "refine-into-tasks": "refinement",
        "need-more-tasks": "refinement",
        "refine-task": "refinement",
        "begin-implementation": "development",
        "additional-implementation": "development",
        "run-tests": "qa-specialist",
        "tests-passing": "qa-specialist",
        "tests-failed": "qa-specialist",
        "pick-up-next-task": "development",
    };
    return overrides[transition] ?? state.profile;
};

export class ProfileWorkflowRunner {
    private taskProvider: () => Promise<WorkflowTask[]>;
    private taskExecutor: WorkflowTaskExecutor;
    private token: WorkflowToken<Record<string, unknown>>;
    private environment: string | undefined;
    private pollIntervalMs: number;

    constructor(options: ProfileWorkflowRunnerOptions) {
        this.taskProvider = options.taskProvider;
        this.taskExecutor = options.taskExecutor;
        this.environment = options.environment;
        this.pollIntervalMs = options.pollIntervalMs ?? 10000;
        this.token = createToken<Record<string, unknown>>(options.initialState ?? "new-feature-proposed");
    }

    async runLoop(): Promise<void> {
        console.log("[WORKFLOW] Starting profile-driven workflow loop");
        while (true) {
            try {
                const tasks = await this.taskProvider();
                const state = WORKFLOW[this.token.state];
                if (!state) {
                    console.warn(`[WORKFLOW] Unknown workflow state: ${this.token.state}`);
                    await sleep(this.pollIntervalMs);
                    continue;
                }

                const transition = await resolveTransition(state, tasks, {
                    workflow: { state: state.name },
                });
                if (!transition) {
                    console.warn(`[WORKFLOW] No transition chosen for state ${state.name}`);
                    await sleep(this.pollIntervalMs);
                    continue;
                }

                const nextStateName =
                    getNextStateFrom(WORKFLOW, this.token.state, transition) ?? this.token.state;
                const targetState = WORKFLOW[nextStateName] ?? state;
                const targetType = resolveTargetTypeForTransition(targetState, transition);
                const taskCandidate = selectTaskForState(tasks, state, targetType);
                if (!taskCandidate && !canRunWithoutTask(transition)) {
                    console.log(
                        `[WORKFLOW] No ${targetType ?? "matching"} tasks for ${transition}; waiting.`,
                    );
                    await sleep(this.pollIntervalMs);
                    continue;
                }
                const task = taskCandidate ?? buildVirtualTask(transition, targetType);

                console.log(
                    `[WORKFLOW] state=${state.name} transition=${transition} tasks=${tasks.length}`,
                );
                const runState = {
                    ...targetState,
                    profile: resolveProfileForTransition(targetState, transition),
                };
                await this.taskExecutor({
                    task,
                    workflowState: runState,
                    workflowTransition: transition,
                    environment: this.environment,
                });

                this.token = { ...this.token, state: nextStateName };
            } catch (error) {
                console.error("[WORKFLOW] Error in profile workflow loop:", error);
            }

            await sleep(this.pollIntervalMs);
        }
    }
}
