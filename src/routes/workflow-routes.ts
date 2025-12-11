import type { Application, Request, Response } from "express";
import { WorkflowExecutionEngine } from "../services/workflow-execution-engine.ts";
import { WorkflowService } from "../services/workflow-service.ts";
import type { WorkflowDefinition } from "../types/workflow-types.ts";

/**
 * API routes for workflow management
 */
export function setupWorkflowRoutes(app: Application) {
	const workflowService = new WorkflowService();
	const executionEngine = new WorkflowExecutionEngine();

	// Get all workflows
	app.get("/api/workflows", async (req: Request, res: Response) => {
		try {
			const { category, enabled } = req.query as { category?: string; enabled?: string };
			const workflows = await workflowService.listWorkflows(
				category,
				enabled !== undefined ? enabled === "true" : undefined,
			);

			return res.json({ success: true, data: workflows });
		} catch (error) {
			return res.status(500).json({
				success: false,
				error: error instanceof Error ? error.message : "Unknown error",
			});
		}
	});

	// Get a specific workflow
	app.get("/api/workflows/:id", async (req: Request, res: Response) => {
		try {
			const { id } = req.params as { id: string };
			const workflow = await workflowService.getWorkflow(id);

			if (!workflow) {
				return res.status(404).json({
					success: false,
					error: "Workflow not found",
				});
			}

			return res.json({ success: true, data: workflow });
		} catch (error) {
			return res.status(500).json({
				success: false,
				error: error instanceof Error ? error.message : "Unknown error",
			});
		}
	});

	// Create a new workflow
	app.post("/api/workflows", async (req: Request, res: Response) => {
		try {
			const workflowData = req.body as Omit<WorkflowDefinition, "id" | "createdAt" | "updatedAt">;

			// Validate workflow before creating
			const validation = await workflowService.validateWorkflow(workflowData as WorkflowDefinition);
			if (!validation.valid) {
				return res.status(400).json({
					success: false,
					error: "Workflow validation failed",
					details: validation.errors,
				});
			}

			const workflow = await workflowService.createWorkflow(workflowData);
			return res.status(201).json({ success: true, data: workflow });
		} catch (error) {
			return res.status(500).json({
				success: false,
				error: error instanceof Error ? error.message : "Unknown error",
			});
		}
	});

	// Update a workflow
	app.put("/api/workflows/:id", async (req: Request, res: Response) => {
		try {
			const { id } = req.params as { id: string };
			const updates = req.body as Partial<WorkflowDefinition>;

			// Validate updated workflow
			const existing = await workflowService.getWorkflow(id);
			if (!existing) {
				return res.status(404).json({
					success: false,
					error: "Workflow not found",
				});
			}

			const updatedWorkflow = { ...existing, ...updates };
			const validation = await workflowService.validateWorkflow(updatedWorkflow);
			if (!validation.valid) {
				return res.status(400).json({
					success: false,
					error: "Workflow validation failed",
					details: validation.errors,
				});
			}

			const workflow = await workflowService.updateWorkflow(id, updates);
			return res.json({ success: true, data: workflow });
		} catch (error) {
			return res.status(500).json({
				success: false,
				error: error instanceof Error ? error.message : "Unknown error",
			});
		}
	});

	// Delete a workflow
	app.delete("/api/workflows/:id", async (req: Request, res: Response) => {
		try {
			const { id } = req.params as { id: string };
			const success = await workflowService.deleteWorkflow(id);

			if (!success) {
				return res.status(404).json({
					success: false,
					error: "Workflow not found",
				});
			}

			return res.json({ success: true });
		} catch (error) {
			return res.status(500).json({
				success: false,
				error: error instanceof Error ? error.message : "Unknown error",
			});
		}
	});

	// Execute a workflow
	app.post("/api/workflows/:id/execute", async (req: Request, res: Response) => {
		try {
			const { id } = req.params as { id: string };
			const { triggerData, context } = req.body as {
				triggerData?: Record<string, unknown>;
				context?: Record<string, unknown>;
			};

			const workflow = await workflowService.getWorkflow(id);
			if (!workflow) {
				return res.status(404).json({
					success: false,
					error: "Workflow not found",
				});
			}

			if (!workflow.enabled) {
				return res.status(400).json({
					success: false,
					error: "Workflow is disabled",
				});
			}

			const execution = await executionEngine.executeWorkflow(workflow, triggerData || {}, context);

			// Save execution
			await workflowService.saveExecution(execution);

			return res.json({ success: true, data: execution });
		} catch (error) {
			return res.status(500).json({
				success: false,
				error: error instanceof Error ? error.message : "Unknown error",
			});
		}
	});

	// Get workflow executions
	app.get("/api/workflows/:id/executions", async (req: Request, res: Response) => {
		try {
			const { id } = req.params as { id: string };
			const { limit } = req.query as { limit?: string };

			const executions = await workflowService.listExecutions(id, limit ? parseInt(limit, 10) : 50);
			return res.json({ success: true, data: executions });
		} catch (error) {
			return res.status(500).json({
				success: false,
				error: error instanceof Error ? error.message : "Unknown error",
			});
		}
	});

	// Get workflow statistics
	app.get("/api/workflows/:id/statistics", async (req: Request, res: Response) => {
		try {
			const { id } = req.params as { id: string };
			const statistics = await workflowService.getWorkflowStatistics(id);
			return res.json({ success: true, data: statistics });
		} catch (error) {
			return res.status(500).json({
				success: false,
				error: error instanceof Error ? error.message : "Unknown error",
			});
		}
	});

	// Validate workflow
	app.post("/api/workflows/:id/validate", async (req: Request, res: Response) => {
		try {
			const { id } = req.params as { id: string };
			const workflow = await workflowService.getWorkflow(id);

			if (!workflow) {
				return res.status(404).json({
					success: false,
					error: "Workflow not found",
				});
			}

			const validation = await workflowService.validateWorkflow(workflow);
			return res.json({ success: true, data: validation });
		} catch (error) {
			return res.status(500).json({
				success: false,
				error: error instanceof Error ? error.message : "Unknown error",
			});
		}
	});

	// Get all workflow templates
	app.get("/api/workflow-templates", async (req: Request, res: Response) => {
		try {
			const { category } = req.query as { category?: string };
			const templates = await workflowService.listTemplates(category);
			return res.json({ success: true, data: templates });
		} catch (error) {
			return res.status(500).json({
				success: false,
				error: error instanceof Error ? error.message : "Unknown error",
			});
		}
	});

	// Get a specific workflow template
	app.get("/api/workflow-templates/:id", async (req: Request, res: Response) => {
		try {
			const { id } = req.params as { id: string };
			const template = await workflowService.getTemplate(id);

			if (!template) {
				return res.status(404).json({
					success: false,
					error: "Template not found",
				});
			}

			return res.json({ success: true, data: template });
		} catch (error) {
			return res.status(500).json({
				success: false,
				error: error instanceof Error ? error.message : "Unknown error",
			});
		}
	});

	// Create workflow from template
	app.post("/api/workflow-templates/:id/create", async (req: Request, res: Response) => {
		try {
			const { id } = req.params as { id: string };
			const { name, description, variables } = req.body as {
				name: string;
				description: string;
				variables: Record<string, unknown>;
			};

			const workflow = await workflowService.createFromTemplate(id, name, description, variables);

			if (!workflow) {
				return res.status(404).json({
					success: false,
					error: "Template not found",
				});
			}

			return res.status(201).json({ success: true, data: workflow });
		} catch (error) {
			return res.status(500).json({
				success: false,
				error: error instanceof Error ? error.message : "Unknown error",
			});
		}
	});

	// Get all executions
	app.get("/api/executions", async (req: Request, res: Response) => {
		try {
			const { workflowId, limit } = req.query as { workflowId?: string; limit?: string };
			const executions = await workflowService.listExecutions(
				workflowId,
				limit ? parseInt(limit, 10) : 50,
			);
			return res.json({ success: true, data: executions });
		} catch (error) {
			return res.status(500).json({
				success: false,
				error: error instanceof Error ? error.message : "Unknown error",
			});
		}
	});

	// Get a specific execution
	app.get("/api/executions/:id", async (req: Request, res: Response) => {
		try {
			const { id } = req.params as { id: string };
			const execution = await workflowService.getExecution(id);

			if (!execution) {
				return res.status(404).json({
					success: false,
					error: "Execution not found",
				});
			}

			return res.json({ success: true, data: execution });
		} catch (error) {
			return res.status(500).json({
				success: false,
				error: error instanceof Error ? error.message : "Unknown error",
			});
		}
	});

	// Cancel an execution
	app.post("/api/executions/:id/cancel", async (req: Request, res: Response) => {
		try {
			const { id } = req.params as { id: string };
			const success = executionEngine.cancelExecution(id);

			if (!success) {
				return res.status(404).json({
					success: false,
					error: "Execution not found or already completed",
				});
			}

			return res.json({ success: true });
		} catch (error) {
			return res.status(500).json({
				success: false,
				error: error instanceof Error ? error.message : "Unknown error",
			});
		}
	});

	// Get workflow node types (for the builder UI)
	app.get("/api/workflow-node-types", async (_req: Request, res: Response) => {
		try {
			const nodeTypes = [
				{
					type: "trigger",
					label: "Trigger",
					description: "Start point for the workflow",
					category: "control",
					icon: "play",
					color: "#10b981",
					inputs: [],
					outputs: [{ id: "output", name: "Output", type: "output", dataType: "object" }],
					parameters: [
						{
							name: "eventType",
							type: "select",
							label: "Event Type",
							description: "The event that triggers this workflow",
							required: true,
							options: [
								{ label: "Task Created", value: "task_created" },
								{ label: "Task Updated", value: "task_updated" },
								{ label: "Task Completed", value: "task_completed" },
								{ label: "Manual", value: "manual" },
								{ label: "Scheduled", value: "scheduled" },
							],
						},
					],
				},
				{
					type: "condition",
					label: "Condition",
					description: "Conditional logic for workflow branching",
					category: "logic",
					icon: "git-branch",
					color: "#3b82f6",
					inputs: [
						{ id: "input", name: "Input", type: "input", dataType: "object", required: true },
					],
					outputs: [
						{ id: "true", name: "True", type: "output", dataType: "object" },
						{ id: "false", name: "False", type: "output", dataType: "object" },
					],
					parameters: [
						{
							name: "operator",
							type: "select",
							label: "Operator",
							description: "How to combine multiple conditions",
							required: true,
							defaultValue: "and",
							options: [
								{ label: "AND", value: "and" },
								{ label: "OR", value: "or" },
							],
						},
						{
							name: "conditions",
							type: "json",
							label: "Conditions",
							description: "Array of conditions to evaluate",
							required: true,
						},
					],
				},
				{
					type: "task_create",
					label: "Create Task",
					description: "Create a new task",
					category: "action",
					icon: "plus-circle",
					color: "#8b5cf6",
					inputs: [{ id: "input", name: "Input", type: "input", dataType: "object" }],
					outputs: [{ id: "output", name: "Task", type: "output", dataType: "object" }],
					parameters: [
						{
							name: "title",
							type: "string",
							label: "Title",
							description: "Task title",
							required: true,
						},
						{
							name: "description",
							type: "string",
							label: "Description",
							description: "Task description",
						},
						{
							name: "priority",
							type: "select",
							label: "Priority",
							description: "Task priority",
							defaultValue: "medium",
							options: [
								{ label: "Low", value: "low" },
								{ label: "Medium", value: "medium" },
								{ label: "High", value: "high" },
							],
						},
						{
							name: "assignedTo",
							type: "string",
							label: "Assigned To",
							description: "User ID to assign the task to",
						},
					],
				},
				{
					type: "task_update",
					label: "Update Task",
					description: "Update an existing task",
					category: "action",
					icon: "edit",
					color: "#f59e0b",
					inputs: [{ id: "input", name: "Input", type: "input", dataType: "object" }],
					outputs: [{ id: "output", name: "Updated Task", type: "output", dataType: "object" }],
					parameters: [
						{
							name: "taskId",
							type: "string",
							label: "Task ID",
							description: "ID of the task to update",
							required: true,
						},
						{
							name: "updates",
							type: "json",
							label: "Updates",
							description: "Fields to update on the task",
							required: true,
						},
					],
				},
				{
					type: "notification",
					label: "Send Notification",
					description: "Send a notification to users",
					category: "communication",
					icon: "bell",
					color: "#ef4444",
					inputs: [{ id: "input", name: "Input", type: "input", dataType: "object" }],
					outputs: [{ id: "output", name: "Result", type: "output", dataType: "object" }],
					parameters: [
						{
							name: "recipients",
							type: "multiselect",
							label: "Recipients",
							description: "Users to notify",
							required: true,
						},
						{
							name: "message",
							type: "string",
							label: "Message",
							description: "Notification message",
							required: true,
						},
						{
							name: "type",
							type: "select",
							label: "Type",
							description: "Notification type",
							defaultValue: "info",
							options: [
								{ label: "Info", value: "info" },
								{ label: "Success", value: "success" },
								{ label: "Warning", value: "warning" },
								{ label: "Error", value: "error" },
							],
						},
					],
				},
				{
					type: "delay",
					label: "Delay",
					description: "Wait for a specified duration",
					category: "utility",
					icon: "clock",
					color: "#6b7280",
					inputs: [{ id: "input", name: "Input", type: "input", dataType: "object" }],
					outputs: [{ id: "output", name: "Output", type: "output", dataType: "object" }],
					parameters: [
						{
							name: "duration",
							type: "number",
							label: "Duration",
							description: "Amount of time to wait",
							required: true,
							validation: { min: 1 },
						},
						{
							name: "unit",
							type: "select",
							label: "Unit",
							description: "Time unit",
							defaultValue: "seconds",
							options: [
								{ label: "Seconds", value: "seconds" },
								{ label: "Minutes", value: "minutes" },
								{ label: "Hours", value: "hours" },
								{ label: "Days", value: "days" },
							],
						},
					],
				},
				{
					type: "webhook",
					label: "Webhook",
					description: "Call an external webhook",
					category: "integration",
					icon: "link",
					color: "#06b6d4",
					inputs: [{ id: "input", name: "Input", type: "input", dataType: "object" }],
					outputs: [{ id: "output", name: "Response", type: "output", dataType: "object" }],
					parameters: [
						{
							name: "url",
							type: "string",
							label: "URL",
							description: "Webhook URL to call",
							required: true,
						},
						{
							name: "method",
							type: "select",
							label: "Method",
							description: "HTTP method",
							defaultValue: "POST",
							options: [
								{ label: "GET", value: "GET" },
								{ label: "POST", value: "POST" },
								{ label: "PUT", value: "PUT" },
								{ label: "DELETE", value: "DELETE" },
							],
						},
						{
							name: "headers",
							type: "json",
							label: "Headers",
							description: "HTTP headers to send",
						},
						{
							name: "body",
							type: "json",
							label: "Body",
							description: "Request body (for POST/PUT)",
						},
					],
				},
				{
					type: "script",
					label: "Script",
					description: "Execute custom script",
					category: "utility",
					icon: "code",
					color: "#84cc16",
					inputs: [{ id: "input", name: "Input", type: "input", dataType: "object" }],
					outputs: [{ id: "output", name: "Result", type: "output", dataType: "object" }],
					parameters: [
						{
							name: "script",
							type: "string",
							label: "Script",
							description: "Script code to execute",
							required: true,
						},
						{
							name: "language",
							type: "select",
							label: "Language",
							description: "Script language",
							defaultValue: "javascript",
							options: [
								{ label: "JavaScript", value: "javascript" },
								{ label: "Python", value: "python" },
							],
						},
						{
							name: "timeout",
							type: "number",
							label: "Timeout (seconds)",
							description: "Maximum execution time",
							defaultValue: 30,
							validation: { min: 1, max: 300 },
						},
					],
				},
			];

			return res.json({ success: true, data: nodeTypes });
		} catch (error) {
			return res.status(500).json({
				success: false,
				error: error instanceof Error ? error.message : "Unknown error",
			});
		}
	});
}
