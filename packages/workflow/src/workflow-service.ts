import { v4 as uuidv4 } from "uuid";
import type {
    WorkflowDefinition,
    WorkflowExecution,
    WorkflowStatistics,
    WorkflowTemplate,
    WorkflowValidationError,
    WorkflowValidationResult,
    WorkflowValidationWarning,
} from "./types.ts";

/**
 * Service for managing workflow definitions and templates
 */
export class WorkflowService {
	private workflows: Map<string, WorkflowDefinition> = new Map();
	private templates: Map<string, WorkflowTemplate> = new Map();
	private executions: Map<string, WorkflowExecution> = new Map();

	constructor() {
		console.log("[WORKFLOW] Workflow service initialized with in-memory storage");
	}

	// Create a new workflow
	async createWorkflow(
		workflow: Omit<WorkflowDefinition, "id" | "createdAt" | "updatedAt">,
	): Promise<WorkflowDefinition> {
		const id = uuidv4();
		const now = new Date();

		const newWorkflow: WorkflowDefinition = {
			...workflow,
			id,
			createdAt: now,
			updatedAt: now,
		};

		this.workflows.set(id, newWorkflow);
		console.log(`[WORKFLOW] Created workflow: ${id}`);

		return newWorkflow;
	}

	// Get a workflow by ID
	async getWorkflow(id: string): Promise<WorkflowDefinition | null> {
		const workflow = this.workflows.get(id);
		return workflow || null;
	}

	// Update a workflow
	async updateWorkflow(
		id: string,
		updates: Partial<WorkflowDefinition>,
	): Promise<WorkflowDefinition | null> {
		const existing = this.workflows.get(id);
		if (!existing) {
			return null;
		}

		const updated: WorkflowDefinition = {
			...existing,
			...updates,
			id,
			updatedAt: new Date(),
		};

		this.workflows.set(id, updated);
		console.log(`[WORKFLOW] Updated workflow: ${id}`);

		return updated;
	}

	// Delete a workflow
	async deleteWorkflow(id: string): Promise<boolean> {
		const existing = this.workflows.get(id);
		if (!existing) {
			return false;
		}

		this.workflows.delete(id);
		console.log(`[WORKFLOW] Deleted workflow: ${id}`);

		return true;
	}

	// List all workflows
	async listWorkflows(category?: string, enabled?: boolean): Promise<WorkflowDefinition[]> {
		const workflows = Array.from(this.workflows.values());

		let filtered = workflows;
		if (category) {
			filtered = filtered.filter((w) => w.category === category);
		}
		if (enabled !== undefined) {
			filtered = filtered.filter((w) => w.enabled === enabled);
		}

		return filtered.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
	}

	// Create a workflow template
	async createTemplate(
		template: Omit<WorkflowTemplate, "id" | "createdAt">,
	): Promise<WorkflowTemplate> {
		const id = uuidv4();
		const now = new Date();

		const newTemplate: WorkflowTemplate = {
			...template,
			id,
			createdAt: now,
		};

		this.templates.set(id, newTemplate);
		console.log(`[WORKFLOW] Created template: ${id}`);

		return newTemplate;
	}

	// Get a template by ID
	async getTemplate(id: string): Promise<WorkflowTemplate | null> {
		const template = this.templates.get(id);
		return template || null;
	}

	// List all templates
	async listTemplates(category?: string): Promise<WorkflowTemplate[]> {
		const templates = Array.from(this.templates.values());

		let filtered = templates;
		if (category) {
			filtered = filtered.filter((t) => t.category === category);
		}

		return filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
	}

	// Create workflow from template
	async createFromTemplate(
		templateId: string,
		name: string,
		description: string,
		variables: Record<string, unknown>,
	): Promise<WorkflowDefinition | null> {
		const template = this.templates.get(templateId);
		if (!template) {
			return null;
		}

		// Substitute variables in the workflow definition
		const workflowDefinition = this.substituteVariables(template.definition, variables);

		const workflow = await this.createWorkflow({
			...workflowDefinition,
			name,
			description,
			createdBy: "user",
			updatedBy: "user",
		});

		return workflow;
	}

	// Substitute variables in workflow definition
	private substituteVariables(
		definition: Omit<
			WorkflowDefinition,
			"id" | "createdAt" | "updatedAt" | "createdBy" | "updatedBy"
		>,
		variables: Record<string, unknown>,
	): Omit<WorkflowDefinition, "id" | "createdAt" | "updatedAt" | "createdBy" | "updatedBy"> {
		const jsonString = JSON.stringify(definition);

		let substituted = jsonString;
		for (const [key, value] of Object.entries(variables)) {
			const placeholder = `{{${key}}}`;
			substituted = substituted.replace(new RegExp(placeholder, "g"), String(value));
		}

		return JSON.parse(substituted);
	}

	// Save workflow execution
	async saveExecution(execution: WorkflowExecution): Promise<void> {
		this.executions.set(execution.id, execution);
		console.log(`[WORKFLOW] Saved execution: ${execution.id}`);
	}

	// Get workflow execution
	async getExecution(id: string): Promise<WorkflowExecution | null> {
		const execution = this.executions.get(id);
		return execution || null;
	}

	// List workflow executions
	async listExecutions(workflowId?: string, limit: number = 50): Promise<WorkflowExecution[]> {
		const executions = Array.from(this.executions.values());

		let filtered = executions;
		if (workflowId) {
			filtered = filtered.filter((e) => e.workflowId === workflowId);
		}

		return filtered.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime()).slice(0, limit);
	}

	// Get workflow statistics
	async getWorkflowStatistics(workflowId?: string): Promise<WorkflowStatistics> {
		const executions = await this.listExecutions(workflowId, 1000);

		const totalExecutions = executions.length;
		const successfulExecutions = executions.filter((e) => e.status === "completed").length;
		const failedExecutions = executions.filter((e) => e.status === "failed").length;

		const completedExecutions = executions.filter((e) => e.status === "completed" && e.duration);
		const averageExecutionTime =
			completedExecutions.length > 0
				? completedExecutions.reduce((sum, e) => sum + (e.duration || 0), 0) /
					completedExecutions.length
				: 0;

		const lastExecution = executions[0];

		// Count node types
		const nodeTypeCount = new Map<string, number>();
		for (const execution of executions) {
			for (const _nodeExecution of execution.nodes) {
				const nodeType = "unknown"; // Would need to fetch from workflow definition
				nodeTypeCount.set(nodeType, (nodeTypeCount.get(nodeType) || 0) + 1);
			}
		}

		const popularNodes = Array.from(nodeTypeCount.entries())
			.map(([nodeType, count]) => ({
				nodeType: nodeType as
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
					| "script",
				count,
			}))
			.sort((a, b) => b.count - a.count)
			.slice(0, 5);

		const errorRate = totalExecutions > 0 ? failedExecutions / totalExecutions : 0;

		const statistics: WorkflowStatistics = {
			totalExecutions,
			successfulExecutions,
			failedExecutions,
			averageExecutionTime,
			popularNodes,
			errorRate,
		};

		if (lastExecution) {
			statistics.lastExecution = lastExecution;
		}

		return statistics;
	}

	// Validate workflow
	async validateWorkflow(workflow: WorkflowDefinition): Promise<WorkflowValidationResult> {
		// Basic validation
		const errors: WorkflowValidationError[] = [];
		const warnings: WorkflowValidationWarning[] = [];

		if (!workflow.name || workflow.name.trim() === "") {
			errors.push({
				type: "node",
				message: "Workflow name is required",
				severity: "error",
			});
		}

		if (!workflow.nodes || workflow.nodes.length === 0) {
			errors.push({
				type: "node",
				message: "Workflow must have at least one node",
				severity: "error",
			});
		}

		// Check for start nodes
		const nodeIds = new Set(workflow.nodes.map((n) => n.id));
		const targetNodeIds = new Set(workflow.connections?.map((c) => c.targetNodeId) || []);
		const startNodes = workflow.nodes.filter((n) => !targetNodeIds.has(n.id));

		if (startNodes.length === 0) {
			errors.push({
				type: "logic",
				message: "Workflow must have at least one start node",
				severity: "error",
			});
		}

		// Check connections
		if (workflow.connections) {
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
		}

		return {
			valid: errors.length === 0,
			errors,
			warnings,
		};
	}

	// Close database connection
	async close(): Promise<void> {
		this.workflows.clear();
		this.templates.clear();
		this.executions.clear();
		console.log("[WORKFLOW] Workflow service closed");
	}
}
