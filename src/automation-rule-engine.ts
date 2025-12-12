import type {
	AutomationRule,
	RuleAction,
	RuleCondition,
	RuleExecutionContext,
	RuleExecutionResult,
	RuleTrigger,
	Task,
	TaskStatus,
	WebSocketEventType,
} from "./types.ts";

type TaskEventData = Task | Record<string, unknown>;
type TaskEventCallback = (eventType: WebSocketEventType, data: TaskEventData) => void;

/**
 * Automation rule engine for processing task events and executing rules
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
		let oldPriority: string | undefined;
		let newPriority: string | undefined;

		switch (eventType) {
			case "task_created":
				task = data as unknown as Task;
				break;
			case "task_status_changed":
				task = (data as { task: Task }).task;
				oldStatus = (data as { oldStatus: TaskStatus }).oldStatus;
				newStatus = (data as { newStatus: TaskStatus }).newStatus;
				break;
			case "task_priority_changed":
				task = (data as { task: Task }).task;
				oldPriority = (data as { oldPriority: string }).oldPriority;
				newPriority = (data as { newPriority: string }).newPriority;
				break;
			case "task_updated":
				task = (data as { task: Task }).task;
				break;
			case "task_deleted": {
				// For deleted tasks, we need to find it in allTasks or create a placeholder
				const taskId = (data as { taskId: string }).taskId;
				task = allTasks.find((t) => t.id === taskId) || {
					id: taskId,
					title: "Deleted Task",
					description: "",
					status: "done",
					priority: "low",
					type: "task" as const,
					dependencies: [],
					createdBy: "system",
					createdAt: new Date(),
					updatedAt: new Date(),
				};
				break;
			}
			default:
				task = data as unknown as Task;
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
				return typeof fieldValue === "string" && fieldValue.includes(conditionValue as string);
			case "greater_than":
				return typeof fieldValue === "number" && fieldValue > (conditionValue as number);
			case "less_than":
				return typeof fieldValue === "number" && fieldValue < (conditionValue as number);
			default:
				return false;
		}
	}

	// Get field value from context
	private getFieldValue(field: string, context: RuleExecutionContext): unknown {
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
		const title = this.substituteVariables(params.title as string, context);
		const description = this.substituteVariables(params.description as string, context);
		const priority = params.priority || "medium";
		const dependencies = params.dependencies || [];

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
		const taskId = params.taskId || context.task.id;
		const updates: Record<string, unknown> = {};

		if (params.status) {
			updates.status = params.status;
		}

		if (params.priority) {
			updates.priority = params.priority;
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
		const message = this.substituteVariables(params.message as string, context);
		const recipient = params.recipient || "system";

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
		const taskId = params.taskId || context.task.id;
		const priority = params.priority;

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
		const taskId = params.taskId || context.task.id;
		const assignedTo = params.assignedTo;

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
