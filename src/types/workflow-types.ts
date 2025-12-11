export interface WorkflowNode {
	id: string;
	type: WorkflowNodeType;
	position: { x: number; y: number };
	data: Record<string, unknown>;
	config?: WorkflowNodeConfig;
}

export type WorkflowNodeType =
	| "trigger"
	| "condition"
	| "action"
	| "delay"
	| "branch"
	| "merge"
	| "notification"
	| "task_create"
	| "task_update"
	| "task_assign"
	| "webhook"
	| "script";

export interface WorkflowNodeConfig {
	inputs?: WorkflowNodePort[];
	outputs?: WorkflowNodePort[];
	parameters?: WorkflowNodeParameter[];
	validation?: WorkflowNodeValidation;
}

export interface WorkflowNodePort {
	id: string;
	name: string;
	type: "input" | "output";
	dataType: "string" | "number" | "boolean" | "object" | "array";
	required?: boolean;
	multiple?: boolean;
}

export interface WorkflowNodeParameter {
	name: string;
	type: "string" | "number" | "boolean" | "select" | "multiselect" | "json";
	label: string;
	description?: string;
	required?: boolean;
	defaultValue?: unknown;
	options?: Array<{ label: string; value: unknown }>;
	validation?: {
		min?: number;
		max?: number;
		pattern?: string;
	};
}

export interface WorkflowNodeValidation {
	rules: Array<{
		type: "required" | "pattern" | "min" | "max" | "custom";
		field: string;
		value?: unknown;
		message: string;
	}>;
}

export interface WorkflowConnection {
	id: string;
	sourceNodeId: string;
	sourcePortId: string;
	targetNodeId: string;
	targetPortId: string;
}

export interface WorkflowDefinition {
	id: string;
	name: string;
	description: string;
	version: string;
	category: WorkflowCategory;
	nodes: WorkflowNode[];
	connections: WorkflowConnection[];
	variables: WorkflowVariable[];
	settings: WorkflowSettings;
	metadata: WorkflowMetadata;
	enabled: boolean;
	createdAt: Date;
	updatedAt: Date;
	createdBy: string;
	updatedBy: string;
}

export type WorkflowCategory =
	| "task_management"
	| "approval"
	| "notification"
	| "integration"
	| "scheduling"
	| "custom";

export interface WorkflowVariable {
	name: string;
	type: "string" | "number" | "boolean" | "object" | "array";
	description?: string;
	defaultValue?: unknown;
	scope: "global" | "local" | "session";
}

export interface WorkflowSettings {
	timeout?: number; // in seconds
	retryPolicy?: {
		maxAttempts: number;
		backoffMultiplier: number;
		maxDelay: number;
	};
	errorHandling?: "stop" | "continue" | "retry";
	logging?: {
		enabled: boolean;
		level: "debug" | "info" | "warn" | "error";
		includeData: boolean;
	};
}

export interface WorkflowMetadata {
	tags: string[];
	author: string;
	documentation?: string;
	examples?: Array<{
		name: string;
		description: string;
		data: Record<string, unknown>;
	}>;
}

export interface WorkflowExecution {
	id: string;
	workflowId: string;
	workflowVersion: string;
	status: WorkflowExecutionStatus;
	startedAt: Date;
	completedAt?: Date;
	duration?: number; // in milliseconds
	triggerData: Record<string, unknown>;
	context: WorkflowExecutionContext;
	nodes: WorkflowNodeExecution[];
	error?: WorkflowExecutionError;
	result?: Record<string, unknown>;
	metadata: WorkflowExecutionMetadata;
}

export type WorkflowExecutionStatus =
	| "pending"
	| "running"
	| "completed"
	| "failed"
	| "cancelled"
	| "paused";

export interface WorkflowExecutionContext {
	variables: Record<string, unknown>;
	tasks: Array<{ id: string; status: string; data: Record<string, unknown> }>;
	user?: { id: string; username: string; role: string };
	timestamp: Date;
	environment: "development" | "staging" | "production";
}

export interface WorkflowNodeExecution {
	nodeId: string;
	status: WorkflowExecutionStatus;
	startedAt: Date;
	completedAt?: Date;
	duration?: number;
	input: Record<string, unknown>;
	output?: Record<string, unknown>;
	error?: WorkflowExecutionError;
	logs: WorkflowExecutionLog[];
}

export interface WorkflowExecutionLog {
	timestamp: Date;
	level: "debug" | "info" | "warn" | "error";
	message: string;
	data?: Record<string, unknown>;
	nodeId?: string;
}

export interface WorkflowExecutionError {
	code: string;
	message: string;
	details?: Record<string, unknown>;
	stack?: string;
	nodeId?: string;
	timestamp: Date;
}

export interface WorkflowExecutionMetadata {
	triggeredBy: string;
	source: "manual" | "api" | "scheduled" | "event";
	ipAddress?: string;
	userAgent?: string;
	sessionId?: string;
}

export interface WorkflowTemplate {
	id: string;
	name: string;
	description: string;
	category: WorkflowCategory;
	tags: string[];
	definition: Omit<
		WorkflowDefinition,
		"id" | "createdAt" | "updatedAt" | "createdBy" | "updatedBy"
	>;
	variables: WorkflowTemplateVariable[];
	documentation?: string;
	examples?: Array<{
		name: string;
		description: string;
		variables: Record<string, unknown>;
	}>;
	createdAt: Date;
	createdBy: string;
}

export interface WorkflowTemplateVariable {
	name: string;
	type: "string" | "number" | "boolean" | "select" | "multiselect";
	label: string;
	description?: string;
	required: boolean;
	defaultValue?: unknown;
	options?: Array<{ label: string; value: unknown }>;
}

export interface WorkflowTrigger {
	id: string;
	type: "event" | "schedule" | "webhook" | "manual";
	config: Record<string, unknown>;
	enabled: boolean;
	workflowId: string;
}

export interface WorkflowSchedule {
	id: string;
	workflowId: string;
	cron: string;
	timezone: string;
	enabled: boolean;
	nextRun?: Date;
	lastRun?: Date;
	metadata?: Record<string, unknown>;
}

export interface WorkflowWebhook {
	id: string;
	workflowId: string;
	path: string;
	method: "GET" | "POST" | "PUT" | "DELETE";
	secret?: string;
	enabled: boolean;
	headers?: Record<string, string>;
	metadata?: Record<string, unknown>;
}

export interface WorkflowStatistics {
	totalExecutions: number;
	successfulExecutions: number;
	failedExecutions: number;
	averageExecutionTime: number;
	lastExecution?: WorkflowExecution;
	popularNodes: Array<{
		nodeType: WorkflowNodeType;
		count: number;
	}>;
	errorRate: number;
}

export interface WorkflowValidationResult {
	valid: boolean;
	errors: WorkflowValidationError[];
	warnings: WorkflowValidationWarning[];
}

export interface WorkflowValidationError {
	type: "connection" | "node" | "variable" | "logic";
	message: string;
	nodeId?: string;
	connectionId?: string;
	severity: "error" | "warning";
}

export interface WorkflowValidationWarning {
	type: "performance" | "logic" | "best_practice";
	message: string;
	nodeId?: string;
	suggestion?: string;
}

// Node type definitions for specific workflow nodes
export interface TriggerNodeData extends WorkflowNode {
	type: "trigger";
	data: {
		eventType: string;
		conditions?: Record<string, unknown>;
	};
}

export interface ConditionNodeData extends WorkflowNode {
	type: "condition";
	data: {
		operator: "and" | "or";
		conditions: Array<{
			field: string;
			operator: string;
			value: unknown;
		}>;
	};
}

export interface ActionNodeData extends WorkflowNode {
	type: "action";
	data: {
		actionType: string;
		parameters: Record<string, unknown>;
	};
}

export interface TaskCreateNodeData extends WorkflowNode {
	type: "task_create";
	data: {
		title: string;
		description?: string;
		priority?: string;
		assignedTo?: string;
		dependencies?: string[];
	};
}

export interface TaskUpdateNodeData extends WorkflowNode {
	type: "task_update";
	data: {
		taskId?: string;
		updates: {
			status?: string;
			priority?: string;
			assignedTo?: string;
		};
	};
}

export interface NotificationNodeData extends WorkflowNode {
	type: "notification";
	data: {
		recipients: string[];
		subject?: string;
		message: string;
		type?: "email" | "push" | "sms";
	};
}

export interface DelayNodeData extends WorkflowNode {
	type: "delay";
	data: {
		duration: number;
		unit: "seconds" | "minutes" | "hours" | "days";
	};
}

export interface BranchNodeData extends WorkflowNode {
	type: "branch";
	data: {
		branches: Array<{
			condition?: Record<string, unknown>;
			label: string;
		}>;
	};
}

export interface WebhookNodeData extends WorkflowNode {
	type: "webhook";
	data: {
		url: string;
		method: "GET" | "POST" | "PUT" | "DELETE";
		headers?: Record<string, string>;
		body?: Record<string, unknown>;
	};
}

export interface ScriptNodeData extends WorkflowNode {
	type: "script";
	data: {
		script: string;
		language: "javascript" | "python";
		timeout?: number;
	};
}
