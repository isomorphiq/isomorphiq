import type { Task } from "./types.ts";
import type { WorkflowStateName } from "./workflow.ts";

export type TransitionEffect = (payload?: unknown) => Promise<unknown> | unknown | Generator;

export interface TransitionDefinition<
	Name extends string = string,
	Next extends WorkflowStateName = WorkflowStateName,
> {
	name: Name;
	next: Next;
	effect?: TransitionEffect;
}

export interface StateDefinition<
	Name extends WorkflowStateName = WorkflowStateName,
	TDefs extends readonly TransitionDefinition[] = readonly TransitionDefinition[],
> {
	name: Name;
	description: string;
	profile: string;
	targetType?: string;
	promptHint?: string;
	transitions: TDefs;
	decider?: (tasks: Task[]) => TDefs[number]["name"];
}

export interface RuntimeTransition {
	next: WorkflowStateName;
	run: TransitionEffect;
}

type TransitionRecord<TNames extends string> = Record<TNames, RuntimeTransition> &
	Record<string, RuntimeTransition>;

export interface RuntimeState<
	Name extends WorkflowStateName = WorkflowStateName,
	TNames extends string = string,
> {
	name: Name;
	description: string;
	profile: string;
	targetType?: string;
	promptHint?: string;
	transitions: TransitionRecord<TNames>;
	decider?: (tasks: Task[]) => TNames;
}

export function createTransition<Name extends string, Next extends WorkflowStateName>(
	name: Name,
	next: Next,
	effect?: TransitionEffect,
): TransitionDefinition<Name, Next> {
	return { name, next, effect };
}

export function createState<
	Name extends WorkflowStateName,
	TDefs extends readonly TransitionDefinition[],
>(def: StateDefinition<Name, TDefs>): RuntimeState<Name, TDefs[number]["name"]> {
	const transitions: Partial<Record<TDefs[number]["name"], RuntimeTransition>> = {};
	for (const t of def.transitions) {
		transitions[t.name] = {
			next: t.next,
			run: t.effect ?? (() => {}),
		};
	}
	return {
		name: def.name,
		description: def.description,
		profile: def.profile,
		targetType: def.targetType,
		promptHint: def.promptHint,
		transitions: transitions as TransitionRecord<TDefs[number]["name"]>,
		decider: def.decider,
	};
}

export function assembleWorkflow(defs: StateDefinition[]): Record<WorkflowStateName, RuntimeState> {
	const workflow: Partial<Record<WorkflowStateName, RuntimeState>> = {};
	for (const def of defs) {
		workflow[def.name] = createState(def);
	}
	return workflow as Record<WorkflowStateName, RuntimeState>;
}

export type { WorkflowStateName } from "./workflow.ts";
