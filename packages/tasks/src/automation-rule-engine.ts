/* eslint-disable no-unused-vars, @typescript-eslint/no-unused-vars */
import { z } from "zod";
import {
    TaskPrioritySchema,
    TaskSchema,
    TaskStatusSchema,
    TaskStruct,
} from "./types.ts";
import type {
    AutomationRule,
    RuleAction,
    RuleCondition,
    RuleExecutionContext,
    RuleExecutionResult,
    RuleTrigger,
    Task,
    TaskPriority,
    TaskStatus,
} from "./types.ts";
import type { WebSocketEventType } from "@isomorphiq/realtime";

type TaskEventData = unknown;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type TaskEventCallback = (eventType: WebSocketEventType, data: TaskEventData) => void;

const taskCreatedPayloadSchema = z.object({ task: TaskSchema }).passthrough();
const taskUpdatedPayloadSchema = z.object({ task: TaskSchema }).passthrough();
const taskStatusChangedPayloadSchema = z
    .object({
        task: TaskSchema,
        oldStatus: TaskStatusSchema,
        newStatus: TaskStatusSchema,
    })
    .passthrough();
const taskPriorityChangedPayloadSchema = z
    .object({
        task: TaskSchema,
        oldPriority: TaskPrioritySchema,
        newPriority: TaskPrioritySchema,
    })
    .passthrough();
const taskDeletedPayloadSchema = z
    .object({
        taskId: z.string(),
        task: TaskSchema.optional(),
    })
    .passthrough();

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null;

const toStringArray = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

/**
 * Automation rule engine for processing task events and executing rules
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class AutomationRuleEngine {
	private rules: AutomationRule[] = [];
	private taskEventCallbacks: TaskEventCallback[] = [];

	constructor() {
		console.log("[AUTOMATION] Automation rule engine initialized");
	}

	// Add a new automation rule
	addRule(rule: AutomationRule): void {
		this.rules.push(rule);
		console.log(`[AUTOMATION] Added rule: ${rule.name}`);
	}

	// Remove an automation rule
	removeRule(ruleId: string): void {
		this.rules = this.rules.filter((rule) => rule.id !== ruleId);
		console.log(`[AUTOMATION] Removed rule: ${ruleId}`);
	}

	// Get all rules
	getRules(): AutomationRule[] {
		return [...this.rules];
	}

	// Replace rules with provided list (used during initialization)
	loadRules(rules: AutomationRule[]): void {
		this.rules = [...rules];
	}

	// Register for task events
	onTaskEvent(callback: TaskEventCallback): void {
		this.taskEventCallbacks.push(callback);
	}

	// Process a task event and evaluate rules
	async processTaskEvent(
		eventType: WebSocketEventType,
		data: TaskEventData,
		allTasks: Task[],
	): Promise<RuleExecutionResult[]> {
		console.log(`[AUTOMATION] Processing event: ${eventType}`);

		const results: RuleExecutionResult[] = [];

		for (const rule of this.rules) {
			if (this.shouldEvaluateRule(rule, eventType)) {
				const result = await this.evaluateRule(rule, eventType, data, allTasks);
				results.push(result);
			}
		}

		return results;
	}

	// Check if a rule should be evaluated for an event type
	private shouldEvaluateRule(rule: AutomationRule, eventType: WebSocketEventType): boolean {
		return rule.trigger.eventType === eventType && rule.enabled;
	}

	// Evaluate a single rule
	private async evaluateRule(
		rule: AutomationRule,
		eventType: WebSocketEventType,
		data: TaskEventData,
		allTasks: Task[],
	): Promise<RuleExecutionResult> {
		console.log(`[AUTOMATION] Evaluating rule: ${rule.name}`);

		try {
			const context = this.createExecutionContext(rule.trigger, eventType, data, allTasks);

			// Evaluate conditions
			const conditionsMet = await this.evaluateConditions(rule.conditions, context);

			if (!conditionsMet) {
				return {
					ruleId: rule.id,
					ruleName: rule.name,
					success: false,
					error: "Conditions not met",
				};
			}

			// Execute actions
			const actionResults = [];
			for (const action of rule.actions) {
				const result = await this.executeAction(action, context);
				actionResults.push(result);
			}

			return {
				ruleId: rule.id,
				ruleName: rule.name,
				success: true,
				result: { actions: actionResults },
			};
		} catch (error) {
			return {
				ruleId: rule.id,
				ruleName: rule.name,
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	// Create execution context
	private createExecutionContext(
		trigger: RuleTrigger,
		eventType: WebSocketEventType,
		data: TaskEventData,
		allTasks: Task[],
	): RuleExecutionContext {
		let task: Task;
		let oldStatus: TaskStatus | undefined;
		let newStatus: TaskStatus | undefined;
		let oldPriority: TaskPriority | undefined;
		let newPriority: TaskPriority | undefined;

		switch (eventType) {
			case "task_created": {
				const createdPayload = taskCreatedPayloadSchema.safeParse(data);
				if (createdPayload.success) {
					task = TaskStruct.from(createdPayload.data.task);
				} else {
					const directTask = TaskSchema.safeParse(data);
					if (!directTask.success) {
						throw new Error("Invalid task_created payload");
					}
					task = TaskStruct.from(directTask.data);
				}
				break;
			}
			case "task_status_changed": {
				const statusPayload = taskStatusChangedPayloadSchema.safeParse(data);
				if (!statusPayload.success) {
					throw new Error("Invalid task_status_changed payload");
				}
				task = TaskStruct.from(statusPayload.data.task);
				oldStatus = statusPayload.data.oldStatus;
				newStatus = statusPayload.data.newStatus;
				break;
			}
			case "task_priority_changed": {
				const priorityPayload = taskPriorityChangedPayloadSchema.safeParse(data);
				if (!priorityPayload.success) {
					throw new Error("Invalid task_priority_changed payload");
				}
				task = TaskStruct.from(priorityPayload.data.task);
				oldPriority = priorityPayload.data.oldPriority;
				newPriority = priorityPayload.data.newPriority;
				break;
			}
			case "task_updated": {
				const updatedPayload = taskUpdatedPayloadSchema.safeParse(data);
				if (updatedPayload.success) {
					task = TaskStruct.from(updatedPayload.data.task);
					break;
				}

				const directTask = TaskSchema.safeParse(data);
				if (!directTask.success) {
					throw new Error("Invalid task_updated payload");
				}
				task = TaskStruct.from(directTask.data);
				break;
			}
			case "task_deleted": {
				const deletedPayload = taskDeletedPayloadSchema.safeParse(data);
				if (!deletedPayload.success) {
					throw new Error("Invalid task_deleted payload");
				}
				if (deletedPayload.data.task) {
					task = TaskStruct.from(deletedPayload.data.task);
					break;
				}
				const taskId = deletedPayload.data.taskId;
				task =
					allTasks.find((candidate) => candidate.id === taskId) ||
					TaskStruct.from({
						id: taskId,
						title: "Deleted Task",
						description: "",
						status: "done",
						priority: "low",
						type: "task",
						dependencies: [],
						createdBy: "system",
						createdAt: new Date(),
						updatedAt: new Date(),
					});
				break;
			}
			default: {
				const fallbackTask = TaskSchema.safeParse(data);
				if (!fallbackTask.success) {
					throw new Error("Invalid task event payload");
				}
				task = TaskStruct.from(fallbackTask.data);
			}
		}

		return {
			trigger,
			task,
			relatedTasks: allTasks,
			oldStatus,
			newStatus,
			oldPriority,
			newPriority,
		};
	}

	// Evaluate rule conditions
	private async evaluateConditions(
		conditions: RuleCondition[],
		context: RuleExecutionContext,
	): Promise<boolean> {
		if (conditions.length === 0) {
			return true;
		}

		for (const condition of conditions) {
			const result = await this.evaluateCondition(condition, context);
			if (!result) {
				console.log(
					`[AUTOMATION] Condition failed: ${condition.field} ${condition.operator} ${condition.value}`,
				);
				return false;
			}
		}

		return true;
	}

	// Evaluate a single condition
	private async evaluateCondition(
		condition: RuleCondition,
		context: RuleExecutionContext,
	): Promise<boolean> {
		const fieldValue = this.getFieldValue(condition.field, context);
		const conditionValue = condition.value;

		switch (condition.operator) {
			case "equals":
				return fieldValue === conditionValue;
			case "not_equals":
				return fieldValue !== conditionValue;
			case "contains":
				return (
					typeof fieldValue === "string" &&
					typeof conditionValue === "string" &&
					fieldValue.includes(conditionValue)
				);
			case "greater_than":
				return (
					typeof fieldValue === "number" &&
					typeof conditionValue === "number" &&
					fieldValue > conditionValue
				);
			case "less_than":
				return (
					typeof fieldValue === "number" &&
					typeof conditionValue === "number" &&
					fieldValue < conditionValue
				);
			default:
				return false;
		}
	}

	// Get field value from context
	private getFieldValue(field: string, context: RuleExecutionContext): unknown {
		const fieldPath = field.split(".");
		let value: unknown = context;

		for (const part of fieldPath) {
			if (isRecord(value) && part in value) {
				value = value[part];
			} else {
				return null;
			}
		}

		return value;
	}

	// Execute an action
	private async executeAction(
		action: RuleAction,
		context: RuleExecutionContext,
	): Promise<Record<string, unknown>> {
		console.log(`[AUTOMATION] Executing action: ${action.type}`);

		switch (action.type) {
			case "create_task":
				return await this.executeCreateTaskAction(action, context);
			case "update_task":
				return await this.executeUpdateTaskAction(action, context);
			case "send_notification":
				return await this.executeSendNotificationAction(action, context);
			case "set_priority":
				return await this.executeSetPriorityAction(action, context);
			case "assign_user":
				return await this.executeAssignUserAction(action, context);
			default:
				throw new Error(`Unknown action type: ${action.type}`);
		}
	}

	// Execute create task action
	private async executeCreateTaskAction(
		action: RuleAction,
		context: RuleExecutionContext,
	): Promise<Record<string, unknown>> {
		const params = action.parameters;
		const titleTemplate = typeof params.title === "string" ? params.title : "";
		const descriptionTemplate =
			typeof params.description === "string" ? params.description : "";
		const title = this.substituteVariables(titleTemplate, context);
		const description = this.substituteVariables(descriptionTemplate, context);
		const priorityResult = TaskPrioritySchema.safeParse(params.priority);
		const priority = priorityResult.success ? priorityResult.data : "medium";
		const dependencies = toStringArray(params.dependencies);

		const taskData = {
			title,
			description,
			priority,
			dependencies,
			createdBy: "automation",
		};

		// Notify listeners that a new task was created
		this.taskEventCallbacks.forEach((callback) => {
			callback("task_created", taskData);
		});

		return { taskData };
	}

	// Execute update task action
	private async executeUpdateTaskAction(
		action: RuleAction,
		context: RuleExecutionContext,
	): Promise<Record<string, unknown>> {
		const params = action.parameters;
		const taskId = typeof params.taskId === "string" ? params.taskId : context.task.id;
		const updates: Record<string, unknown> = {};

		const statusResult = TaskStatusSchema.safeParse(params.status);
		if (statusResult.success) {
			updates.status = statusResult.data;
		}

		const priorityResult = TaskPrioritySchema.safeParse(params.priority);
		if (priorityResult.success) {
			updates.priority = priorityResult.data;
		}

		// Notify listeners that task should be updated
		this.taskEventCallbacks.forEach((callback) => {
			callback("task_updated", {
				taskId,
				updates,
			});
		});

		return { taskId, updates };
	}

	// Execute send notification action
	private async executeSendNotificationAction(
		action: RuleAction,
		context: RuleExecutionContext,
	): Promise<Record<string, unknown>> {
		const params = action.parameters;
		const messageTemplate = typeof params.message === "string" ? params.message : "";
		const message = this.substituteVariables(messageTemplate, context);
		const recipient = typeof params.recipient === "string" ? params.recipient : "system";

		console.log(`[AUTOMATION] Notification to ${recipient}: ${message}`);

		// In a real implementation, this would send to a notification service
		// For now, we'll just log it
		return { message, recipient, timestamp: new Date() };
	}

	// Execute set priority action
	private async executeSetPriorityAction(
		action: RuleAction,
		context: RuleExecutionContext,
	): Promise<Record<string, unknown>> {
		const params = action.parameters;
		const taskId = typeof params.taskId === "string" ? params.taskId : context.task.id;
		const priorityResult = TaskPrioritySchema.safeParse(params.priority);
		const priority = priorityResult.success ? priorityResult.data : context.task.priority;

		// Notify listeners that task priority should be updated
		this.taskEventCallbacks.forEach((callback) => {
			callback("task_priority_changed", {
				taskId,
				priority,
			});
		});

		return { taskId, priority };
	}

	// Execute assign user action
	private async executeAssignUserAction(
		action: RuleAction,
		context: RuleExecutionContext,
	): Promise<Record<string, unknown>> {
		const params = action.parameters;
		const taskId = typeof params.taskId === "string" ? params.taskId : context.task.id;
		const assignedTo = typeof params.assignedTo === "string" ? params.assignedTo : undefined;

		// Notify listeners that task should be assigned
		this.taskEventCallbacks.forEach((callback) => {
			callback("task_updated", {
				taskId,
				assignedTo,
			});
		});

		return { taskId, assignedTo };
	}

	// Substitute variables in template strings
	private substituteVariables(template: string, context: RuleExecutionContext): string {
		return template
			.replace(/\{task\.id\}/g, context.task.id)
			.replace(/\{task\.title\}/g, context.task.title)
			.replace(/\{task\.status\}/g, context.task.status)
			.replace(/\{task\.priority\}/g, context.task.priority);
	}

	// Get rule statistics
	getRuleStats(): { total: number; enabled: number; disabled: number } {
		const total = this.rules.length;
		const enabled = this.rules.filter((rule) => rule.enabled).length;
		const disabled = total - enabled;

		return { total, enabled, disabled };
	}
}

