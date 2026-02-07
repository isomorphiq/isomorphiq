import type { DeciderContext, RuntimeState } from "../../workflow-factory.ts";
import type { WorkflowTask } from "../../agent-runner.ts";

export type TransitionResult = {
    transition: string;
    isDecider: boolean;
};

export const resolveTransition = async (
    state: RuntimeState,
    tasks: WorkflowTask[],
    context: Record<string, unknown>,
): Promise<TransitionResult | null> => {
    const transitions = Object.keys(state.transitions);
    const isValid = (transition: string | null | undefined): transition is string =>
        typeof transition === "string"
        && transition.length > 0
        && Boolean(state.transitions[transition]);

    const deciderContext: DeciderContext = {
        ...context,
        tasks,
    };
    for (const deciderEntry of state.deciders) {
        const shouldTransition = await deciderEntry.decider(deciderContext);
        if (!shouldTransition) {
            continue;
        }
        const transition = deciderEntry.transitionName;
        if (isValid(transition)) {
            return { transition, isDecider: true };
        }
        console.warn(
            `[WORKFLOW] Invalid transition '${transition}' for state ${state.name}; continuing decider scan.`,
        );
    }

    if (isValid(state.defaultTransition)) {
        return { transition: state.defaultTransition, isDecider: false };
    }

    return transitions.length > 0 ? { transition: transitions[0], isDecider: false } : null;
};
