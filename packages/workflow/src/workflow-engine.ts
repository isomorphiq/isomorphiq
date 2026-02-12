import { Effect } from "effect";
import type { Effect as EffectType } from "effect/Effect";
import { getNextStateFrom, WORKFLOW } from "./workflow.ts";
import type { RuntimeState, WorkflowStateName } from "./workflow-factory.ts";

export interface FlowContext {
	currentState: WorkflowStateName;
	transition?: string;
	payload?: Record<string, unknown>;
}

/**
 * Petri-token style representation of where the worker is in the workflow.
 * Context can carry any extra per-worker state (e.g., active ACP session, task id).
 */
export interface WorkflowToken<Ctx = Record<string, unknown>> {
	state: WorkflowStateName;
	context?: Ctx;
}

export function createToken<Ctx = Record<string, unknown>>(
	state: WorkflowStateName,
	context?: Ctx,
): WorkflowToken<Ctx> {
	return { state, context };
}

/**
 * runFlow
 * Executes a single transition for the given state using the runtime workflow.
 * - Looks up the transition on the current state.
 * - Runs its effect (if any).
 * - Returns the next state name.
 */
export async function runFlow(
	context: FlowContext,
	workflow: Record<WorkflowStateName, RuntimeState> = WORKFLOW,
): Promise<WorkflowStateName> {
	const { currentState, transition } = context;
	if (!transition) {
		throw new Error("Transition name is required");
	}

	const state = workflow[currentState];
	if (!state) {
		throw new Error(`Unknown state: ${currentState}`);
	}

	const rt = state.transitions[transition];
	if (!rt) {
		throw new Error(`Unknown transition '${transition}' for state '${currentState}'`);
	}

	// Run side-effect if provided
	console.log(`[WORKFLOW] running effect for ${currentState} -> ${transition}`);
	const result = rt.run(context.payload);
	const resultKeys =
		result && typeof result === "object" ? Object.keys(result).slice(0, 5).join(",") : "";
	console.log(`[WORKFLOW] effect result type=${typeof result} keys=${resultKeys}`);

	if (Effect.isEffect?.(result)) {
		await Effect.runPromise(result as unknown as EffectType<never, never, never>);
	} else if (result && typeof result === "object" && "_tag" in result) {
		await Effect.runPromise(result as unknown as EffectType<never, never, never>);
	} else if (result instanceof Promise) {
		await result;
	}

	return getNextStateFrom(workflow, currentState, transition) ?? currentState;
}

/**
 * Advance a token through a transition, returning a new token with updated state.
 * Effects on the transition are executed the same way as runFlow.
 */
export async function advanceToken<Ctx = Record<string, unknown>>(
	token: WorkflowToken<Ctx>,
	transition: string,
	workflow: Record<WorkflowStateName, RuntimeState> = WORKFLOW,
	payload?: Record<string, unknown>,
): Promise<WorkflowToken<Ctx>> {
	const contextPayload: Record<string, unknown> =
		payload ??
		(typeof token.context === "object" && token.context !== null
			? (token.context as Record<string, unknown>)
			: {});
	const nextState = await runFlow(
		{ currentState: token.state, transition, payload: contextPayload },
		workflow,
	);
	return { ...token, state: nextState };
}
