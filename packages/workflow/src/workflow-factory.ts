import type { WorkflowStateName } from "./workflow.ts";
import type { TaskActionLog } from "@isomorphiq/types";

export type WorkflowTask = {
	id?: string;
	title?: string;
	description?: string;
	type?: string;
	status?: string;
	priority?: string;
	dependencies?: string[];
	actionLog?: TaskActionLog[];
};

export type TransitionEffect = (payload?: unknown) => Promise<unknown> | unknown | Generator;

export type MaybePromise<T> = T | Promise<T>;

export type DeciderContext = Record<string, unknown> & {
    tasks: WorkflowTask[];
};

export type DeciderFn<Context extends DeciderContext = DeciderContext> = (
    context: Context,
) => MaybePromise<boolean>;

export type StateDecider<
    TransitionName extends string = string,
    Context extends DeciderContext = DeciderContext,
> = {
    transitionName: TransitionName;
    decider: DeciderFn<Context>;
};

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
	defaultTransition?: string;
	transitions: TDefs;
	deciders: Array<StateDecider<TDefs[number]["name"]>>;
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
	defaultTransition?: string;
	transitions: TransitionRecord<TNames>;
	deciders: Array<StateDecider<TNames>>;
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
		defaultTransition: def.defaultTransition,
		transitions: transitions as TransitionRecord<TDefs[number]["name"]>,
		deciders: def.deciders,
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
