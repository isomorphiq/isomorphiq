import { v4 as uuidv4 } from "uuid";
import type {
	WorkflowDefinition,
	WorkflowExecution,
	WorkflowExecutionContext,
	WorkflowExecutionLog,
	WorkflowNode,
	WorkflowNodeExecution,
	WorkflowValidationError,
	WorkflowValidationResult,
	WorkflowValidationWarning,
} from "../types/workflow-types.ts";
import type { Task } from "../types.ts";

const toRecord = (value: unknown): Record<string, unknown> =>
	value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};

const toArray = <T>(value: unknown, fallback: T[] = []): T[] =>
	Array.isArray(value) ? (value as T[]) : fallback;

const toStringOr = (value: unknown, fallback: string): string =>
	typeof value === "string" ? value : fallback;

const toNumberOr = (value: unknown, fallback: number): number =>
	typeof value === "number" ? value : fallback;

/**
 * Workflow execution engine for processing workflow definitions
 */
export class WorkflowExecutionEngine {
	private executions: Map<string, WorkflowExecution> = new Map();
	private nodeExecutors: Map<string, WorkflowNodeExecutor> = new Map();

	constructor() {
		this.initializeNodeExecutors();
		console.log("[WORKFLOW] Workflow execution engine initialized");
	}

	// Execute a workflow
	async executeWorkflow(
		workflow: WorkflowDefinition,
		triggerData: Record<string, unknown>,
		context?: Partial<WorkflowExecutionContext>,
	): Promise<WorkflowExecution> {
		const executionId = uuidv4();
		const execution: WorkflowExecution = {
			id: executionId,
			workflowId: workflow.id,
			workflowVersion: workflow.version,
			status: "running",
			startedAt: new Date(),
			triggerData,
			context: {
				variables: { ...workflow.variables, ...triggerData },
				tasks: [],
				timestamp: new Date(),
				environment: "development",
				...context,
			},
			nodes: [],
			metadata: {
				triggeredBy: "system",
				source: "event",
			},
		};

		this.executions.set(executionId, execution);
		console.log(`[WORKFLOW] Started execution ${executionId} for workflow ${workflow.id}`);

		try {
			await this.executeNodes(workflow, execution);
			execution.status = "completed";
			execution.completedAt = new Date();
			execution.duration = execution.completedAt.getTime() - execution.startedAt.getTime();
		} catch (error) {
			execution.status = "failed";
			execution.completedAt = new Date();
			execution.duration = execution.completedAt.getTime() - execution.startedAt.getTime();
			execution.error = {
				code: "EXECUTION_ERROR",
				message: error instanceof Error ? error.message : String(error),
				timestamp: new Date(),
			};
		}

		return execution;
	}

	// Execute all nodes in a workflow
	private async executeNodes(
		workflow: WorkflowDefinition,
		execution: WorkflowExecution,
	): Promise<void> {
		const startNodes = this.findStartNodes(workflow);
		const executedNodes = new Set<string>();

		for (const startNode of startNodes) {
			await this.executeNode(workflow, startNode, execution, executedNodes);
		}
	}

	// Execute a single node and its downstream nodes
	private async executeNode(
		workflow: WorkflowDefinition,
		node: WorkflowNode,
		execution: WorkflowExecution,
		executedNodes: Set<string>,
	): Promise<void> {
		if (executedNodes.has(node.id)) {
			return;
		}

		executedNodes.add(node.id);
		console.log(`[WORKFLOW] Executing node ${node.id} (${node.type})`);

		const nodeExecution: WorkflowNodeExecution = {
			nodeId: node.id,
			status: "running",
			startedAt: new Date(),
			input: {},
			logs: [],
		};

		execution.nodes.push(nodeExecution);

		try {
			const executor = this.nodeExecutors.get(node.type);
			if (!executor) {
				throw new Error(`No executor found for node type: ${node.type}`);
			}

			const result = await executor.execute(node, execution.context, execution);
			nodeExecution.status = "completed";
			nodeExecution.completedAt = new Date();
			nodeExecution.duration =
				nodeExecution.completedAt.getTime() - nodeExecution.startedAt.getTime();
			nodeExecution.output = result;

			// Update context with node output
			if (result) {
				execution.context.variables[`node_${node.id}_output`] = result;
			}

			// Execute downstream nodes
			const downstreamNodes = this.findDownstreamNodes(workflow, node.id);
			for (const downstreamNode of downstreamNodes) {
				await this.executeNode(workflow, downstreamNode, execution, executedNodes);
			}
		} catch (error) {
			nodeExecution.status = "failed";
			nodeExecution.completedAt = new Date();
			nodeExecution.duration =
				nodeExecution.completedAt.getTime() - nodeExecution.startedAt.getTime();
			nodeExecution.error = {
				code: "NODE_EXECUTION_ERROR",
				message: error instanceof Error ? error.message : String(error),
				nodeId: node.id,
				timestamp: new Date(),
			};

			// Log error
			this.log(
				execution,
				"error",
				`Node ${node.id} failed: ${nodeExecution.error.message}`,
				node.id,
			);

			// Determine if workflow should continue
			if (workflow.settings.errorHandling === "stop") {
				throw error;
			}
		}
	}

	// Find start nodes (nodes with no incoming connections)
	private findStartNodes(workflow: WorkflowDefinition): WorkflowNode[] {
		const nodesWithIncoming = new Set<string>();

		for (const connection of workflow.connections) {
			nodesWithIncoming.add(connection.targetNodeId);
		}

		return workflow.nodes.filter((node) => !nodesWithIncoming.has(node.id));
	}

	// Find downstream nodes for a given node
	private findDownstreamNodes(workflow: WorkflowDefinition, nodeId: string): WorkflowNode[] {
		const downstreamNodeIds = new Set<string>();

		for (const connection of workflow.connections) {
			if (connection.sourceNodeId === nodeId) {
				downstreamNodeIds.add(connection.targetNodeId);
			}
		}

		return workflow.nodes.filter((node) => downstreamNodeIds.has(node.id));
	}

	// Add a log entry to execution
	private log(
		execution: WorkflowExecution,
		level: "debug" | "info" | "warn" | "error",
		message: string,
		nodeId?: string,
		data?: Record<string, unknown>,
	): void {
		const log: WorkflowExecutionLog = {
			timestamp: new Date(),
			level,
			message,
			...(nodeId && { nodeId }),
			...(data && { data }),
		};

		// Add to the most recent node execution if nodeId is provided
		if (nodeId) {
			const nodeExecution = execution.nodes.find((n) => n.nodeId === nodeId);
			if (nodeExecution) {
				nodeExecution.logs.push(log);
			}
		}

		console.log(`[WORKFLOW] ${level.toUpperCase()}: ${message}`);
	}

	// Get execution by ID
	getExecution(executionId: string): WorkflowExecution | undefined {
		return this.executions.get(executionId);
	}

	// Get all executions
	getAllExecutions(): WorkflowExecution[] {
		return Array.from(this.executions.values());
	}

	// Cancel an execution
	cancelExecution(executionId: string): boolean {
		const execution = this.executions.get(executionId);
		if (!execution || execution.status === "completed") {
			return false;
		}

		execution.status = "cancelled";
		execution.completedAt = new Date();
		if (execution.startedAt) {
			execution.duration = execution.completedAt.getTime() - execution.startedAt.getTime();
		}

		return true;
	}

	// Initialize node executors
	private initializeNodeExecutors(): void {
		this.nodeExecutors.set("trigger", new TriggerNodeExecutor());
		this.nodeExecutors.set("condition", new ConditionNodeExecutor());
		this.nodeExecutors.set("action", new ActionNodeExecutor());
		this.nodeExecutors.set("delay", new DelayNodeExecutor());
		this.nodeExecutors.set("notification", new NotificationNodeExecutor());
		this.nodeExecutors.set("task_create", new TaskCreateNodeExecutor());
		this.nodeExecutors.set("task_update", new TaskUpdateNodeExecutor());
		this.nodeExecutors.set("webhook", new WebhookNodeExecutor());
		this.nodeExecutors.set("script", new ScriptNodeExecutor());
	}

	// Validate workflow definition
	validateWorkflow(workflow: WorkflowDefinition): WorkflowValidationResult {
		const errors: WorkflowValidationError[] = [];
		const warnings: WorkflowValidationWarning[] = [];

		// Check for required fields
		if (!workflow.name) {
			errors.push({
				type: "node",
				message: "Workflow name is required",
				severity: "error",
			});
		}

		// Check for nodes
		if (workflow.nodes.length === 0) {
			errors.push({
				type: "node",
				message: "Workflow must have at least one node",
				severity: "error",
			});
		}

		// Check for start nodes
		const startNodes = this.findStartNodes(workflow);
		if (startNodes.length === 0) {
			errors.push({
				type: "logic",
				message: "Workflow must have at least one start node (node with no incoming connections)",
				severity: "error",
			});
		}

		// Check connections
		const nodeIds = new Set(workflow.nodes.map((n) => n.id));
		for (const connection of workflow.connections) {
			if (!nodeIds.has(connection.sourceNodeId)) {
				errors.push({
					type: "connection",
					message: `Connection source node ${connection.sourceNodeId} does not exist`,
					connectionId: connection.id,
					severity: "error",
				});
			}
			if (!nodeIds.has(connection.targetNodeId)) {
				errors.push({
					type: "connection",
					message: `Connection target node ${connection.targetNodeId} does not exist`,
					connectionId: connection.id,
					severity: "error",
				});
			}
		}

		// Check for circular dependencies
		if (this.hasCircularDependency(workflow)) {
			errors.push({
				type: "logic",
				message: "Workflow contains circular dependencies",
				severity: "error",
			});
		}

		return {
			valid: errors.length === 0,
			errors,
			warnings,
		};
	}

	// Check for circular dependencies
	private hasCircularDependency(workflow: WorkflowDefinition): boolean {
		const visited = new Set<string>();
		const recursionStack = new Set<string>();

		const hasCycle = (nodeId: string): boolean => {
			if (recursionStack.has(nodeId)) {
				return true;
			}
			if (visited.has(nodeId)) {
				return false;
			}

			visited.add(nodeId);
			recursionStack.add(nodeId);

			const downstreamNodes = this.findDownstreamNodes(workflow, nodeId);
			for (const downstreamNode of downstreamNodes) {
				if (hasCycle(downstreamNode.id)) {
					return true;
				}
			}

			recursionStack.delete(nodeId);
			return false;
		};

		for (const node of workflow.nodes) {
			if (!visited.has(node.id) && hasCycle(node.id)) {
				return true;
			}
		}

		return false;
	}
}

/**
 * Base interface for workflow node executors
 */
export interface WorkflowNodeExecutor {
	execute(
		node: WorkflowNode,
		context: WorkflowExecutionContext,
		execution: WorkflowExecution,
	): Promise<Record<string, unknown>>;
}

/**
 * Trigger node executor
 */
export class TriggerNodeExecutor implements WorkflowNodeExecutor {
	async execute(
		node: WorkflowNode,
		_context: WorkflowExecutionContext,
	): Promise<Record<string, unknown>> {
		console.log(`[WORKFLOW] Trigger node ${node.id} executed`);
		return { triggered: true, timestamp: new Date() };
	}
}

/**
 * Condition node executor
 */
export class ConditionNodeExecutor implements WorkflowNodeExecutor {
	async execute(
		node: WorkflowNode,
		_context: WorkflowExecutionContext,
	): Promise<Record<string, unknown>> {
		const data = toRecord(node.data);
		const rawConditions = toArray<Record<string, unknown>>(data.conditions);
		const conditions = rawConditions
			.map((condition) => ({
				field: condition.field,
				operator: condition.operator,
				value: condition.value,
			}))
			.filter(
				(condition): condition is { field: string; operator: string; value: unknown } =>
					typeof condition.field === "string" && typeof condition.operator === "string",
			);
		const operator = data.operator === "or" ? "or" : "and";

		let result = true;
		for (const condition of conditions) {
			const fieldValue = this.getFieldValue(condition.field, context);
			const conditionResult = this.evaluateCondition(
				fieldValue,
				condition.operator,
				condition.value,
			);

			if (operator === "and") {
				result = result && conditionResult;
			} else {
				result = result || conditionResult;
			}
		}

		console.log(`[WORKFLOW] Condition node ${node.id} evaluated: ${result}`);
		return { result, conditions: conditions.length };
	}

	private getFieldValue(field: string, context: WorkflowExecutionContext): unknown {
		const fieldPath = field.split(".");
		let value: unknown = context;

		for (const part of fieldPath) {
			if (value && typeof value === "object" && part in value) {
				value = (value as Record<string, unknown>)[part];
			} else {
				return null;
			}
		}

		return value;
	}

	private evaluateCondition(
		fieldValue: unknown,
		operator: string,
		conditionValue: unknown,
	): boolean {
		switch (operator) {
			case "equals":
				return fieldValue === conditionValue;
			case "not_equals":
				return fieldValue !== conditionValue;
			case "contains":
				return typeof fieldValue === "string" && fieldValue.includes(conditionValue as string);
			case "greater_than":
				return typeof fieldValue === "number" && fieldValue > (conditionValue as number);
			case "less_than":
				return typeof fieldValue === "number" && fieldValue < (conditionValue as number);
			default:
				return false;
		}
	}
}

/**
 * Action node executor
 */
export class ActionNodeExecutor implements WorkflowNodeExecutor {
	async execute(
		node: WorkflowNode,
		_context: WorkflowExecutionContext,
	): Promise<Record<string, unknown>> {
		const data = toRecord(node.data);
		const actionType = toStringOr(data.actionType, "unknown_action");
		const parameters = toRecord(data.parameters);

		console.log(`[WORKFLOW] Action node ${node.id} executing: ${actionType}`);

		// This would integrate with the existing automation rule engine
		// For now, we'll just log the action
		return {
			actionType,
			parameters,
			executed: true,
			timestamp: new Date(),
		};
	}
}

/**
 * Delay node executor
 */
export class DelayNodeExecutor implements WorkflowNodeExecutor {
	async execute(node: WorkflowNode): Promise<Record<string, unknown>> {
		const data = toRecord(node.data);
		const duration = toNumberOr(data.duration, 1000);
		const unit = toStringOr(data.unit, "milliseconds");

		let delayMs = duration;
		switch (unit) {
			case "seconds":
				delayMs = duration * 1000;
				break;
			case "minutes":
				delayMs = duration * 60 * 1000;
				break;
			case "hours":
				delayMs = duration * 60 * 60 * 1000;
				break;
			case "days":
				delayMs = duration * 24 * 60 * 60 * 1000;
				break;
		}

		console.log(`[WORKFLOW] Delay node ${node.id} waiting ${delayMs}ms`);
		await new Promise((resolve) => setTimeout(resolve, delayMs));

		return { delayed: true, duration: delayMs };
	}
}

/**
 * Notification node executor
 */
export class NotificationNodeExecutor implements WorkflowNodeExecutor {
	async execute(
		node: WorkflowNode,
		_context: WorkflowExecutionContext,
	): Promise<Record<string, unknown>> {
		const data = toRecord(node.data);
		const recipients = toArray<string>(data.recipients);
		const message = toStringOr(data.message, "No message provided");
		const type = toStringOr(data.type, "info");

		console.log(
			`[WORKFLOW] Notification node ${node.id} sending to ${recipients.length} recipients`,
		);

		// This would integrate with a notification service
		// For now, we'll just log the notification
		return {
			recipients,
			message,
			type,
			sent: true,
			timestamp: new Date(),
		};
	}
}

/**
 * Task create node executor
 */
export class TaskCreateNodeExecutor implements WorkflowNodeExecutor {
	async execute(
		node: WorkflowNode,
		_context: WorkflowExecutionContext,
	): Promise<Record<string, unknown>> {
		const data = toRecord(node.data);
		const title = toStringOr(data.title, "Untitled task");
		const description = toStringOr(data.description, "No description provided");
		const priority = toStringOr(data.priority, "medium") as Task["priority"];
		const assignedTo = typeof data.assignedTo === "string" ? data.assignedTo : undefined;

		console.log(`[WORKFLOW] Task create node ${node.id} creating task: ${title}`);

		// This would integrate with the task management system
		// For now, we'll simulate task creation
		const task = {
			id: `task_${Date.now()}`,
			title,
			description,
			priority,
			assignedTo,
			status: "todo",
			createdAt: new Date(),
		};

		// Add to context for reference
		context.tasks.push({
			id: task.id,
			status: task.status as string,
			data: task,
		});

		return { task, created: true };
	}
}

/**
 * Task update node executor
 */
export class TaskUpdateNodeExecutor implements WorkflowNodeExecutor {
	async execute(
		node: WorkflowNode,
		_context: WorkflowExecutionContext,
	): Promise<Record<string, unknown>> {
		const data = toRecord(node.data);
		const taskId = toStringOr(data.taskId, "");
		const updates = toRecord(data.updates);

		console.log(`[WORKFLOW] Task update node ${node.id} updating task: ${taskId}`);

		// This would integrate with the task management system
		// For now, we'll simulate task update
		return {
			taskId,
			updates,
			updated: true,
			timestamp: new Date(),
		};
	}
}

/**
 * Webhook node executor
 */
export class WebhookNodeExecutor implements WorkflowNodeExecutor {
	async execute(
		node: WorkflowNode,
		_context: WorkflowExecutionContext,
	): Promise<Record<string, unknown>> {
		const data = toRecord(node.data);
		const url = toStringOr(data.url, "");
		const method = toStringOr(data.method, "POST");
		const _headers = toRecord(data.headers);
		const _body = data.body;

		console.log(`[WORKFLOW] Webhook node ${node.id} calling ${method} ${url}`);

		try {
			// This would make an actual HTTP call
			// For now, we'll simulate the webhook call
			const response = {
				status: 200,
				body: { success: true },
				headers: { "content-type": "application/json" },
			};

			return {
				url,
				method,
				response,
				success: true,
				timestamp: new Date(),
			};
		} catch (error) {
			return {
				url,
				method,
				error: error instanceof Error ? error.message : String(error),
				success: false,
				timestamp: new Date(),
			};
		}
	}
}

/**
 * Script node executor
 */
export class ScriptNodeExecutor implements WorkflowNodeExecutor {
	async execute(
		node: WorkflowNode,
		_context: WorkflowExecutionContext,
	): Promise<Record<string, unknown>> {
		const data = toRecord(node.data);
		const script = toStringOr(data.script, "");
		const language = toStringOr(data.language, "javascript");
		const _timeout = toNumberOr(data.timeout, 30000);

		console.log(`[WORKFLOW] Script node ${node.id} executing ${language} script`);

		try {
			// This would execute the script in a sandboxed environment
			// For now, we'll simulate script execution
			const result = {
				output: "Script executed successfully",
				exitCode: 0,
				executionTime: 100,
			};

			return {
				script,
				language,
				result,
				success: true,
				timestamp: new Date(),
			};
		} catch (error) {
			return {
				script,
				language,
				error: error instanceof Error ? error.message : String(error),
				success: false,
				timestamp: new Date(),
			};
		}
	}
}
