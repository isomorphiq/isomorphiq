import type { WorkflowStateName } from "./workflow-factory.ts";

/**
 * Placeholder effect generators for transitions.
 * Once an Effect library is introduced, these can yield real effects.
 */

// Generic no-op effect
export function* noopEffect(): Generator<void, void, unknown> {
	// intentionally empty
}

// Notify that a task was closed
export function* notifyTaskClosed(taskId?: string): Generator<void, void, unknown> {
	yield undefined; // placeholder hook
	console.log(`[EFFECT] Task closed notification${taskId ? ` for ${taskId}` : ""}`);
}

// Trigger ACP turn for a given profile (placeholder)
export function* runAcpTurn(
	profile: string,
	context?: Record<string, unknown>,
): Generator<void, void, unknown> {
	yield undefined; // placeholder for actual ACP invocation
	console.log(
		`[EFFECT] Run ACP turn for profile=${profile} contextKeys=${Object.keys(context || {}).join(",")}`,
	);
}

// Requeue to another state (may be useful for bookkeeping)
export function* logTransition(next: WorkflowStateName): Generator<void, void, unknown> {
	yield undefined;
	console.log(`[EFFECT] Transitioning to ${next}`);
}
