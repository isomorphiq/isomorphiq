import { v4 as uuidv4 } from "uuid";
import type { WorkflowTemplate } from "./types.ts";

/**
 * Predefined workflow templates for common automation scenarios
 */
export const workflowTemplates: WorkflowTemplate[] = [
	{
		id: uuidv4(),
		name: "Task Assignment Automation",
		description: "Automatically assign tasks to team members based on workload and skills",
		category: "task_management",
		tags: ["automation", "assignment", "productivity"],
		variables: [
			{
				name: "maxTasksPerUser",
				type: "number",
				label: "Maximum Tasks Per User",
				description: "Maximum number of active tasks a user can have",
				required: true,
				defaultValue: 5,
			},
			{
				name: "defaultAssignee",
				type: "string",
				label: "Default Assignee",
				description: "User ID to assign tasks to when no suitable user is found",
				required: true,
				defaultValue: "admin",
			},
		],
		definition: {
			name: "Task Assignment Automation",
			description: "Automatically assign tasks to team members based on workload and skills",
			version: "1.0.0",
			category: "task_management",
			nodes: [
				{
					id: "trigger-node",
					type: "trigger",
					position: { x: 100, y: 100 },
					data: {
						eventType: "task_created",
					},
				},
				{
					id: "condition-node",
					type: "condition",
					position: { x: 300, y: 100 },
					data: {
						operator: "and",
						conditions: [
							{
								field: "task.priority",
								operator: "equals",
								value: "high",
							},
						],
					},
				},
				{
					id: "assign-node",
					type: "task_update",
					position: { x: 500, y: 50 },
					data: {
						taskId: "{{task.id}}",
						updates: {
							assignedTo: "{{defaultAssignee}}",
						},
					},
				},
				{
					id: "notification-node",
					type: "notification",
					position: { x: 700, y: 100 },
					data: {
						recipients: ["{{defaultAssignee}}"],
						message: "New high-priority task assigned: {{task.title}}",
						type: "info",
					},
				},
			],
			connections: [
				{
					id: "conn-1",
					sourceNodeId: "trigger-node",
					sourcePortId: "output",
					targetNodeId: "condition-node",
					targetPortId: "input",
				},
				{
					id: "conn-2",
					sourceNodeId: "condition-node",
					sourcePortId: "true",
					targetNodeId: "assign-node",
					targetPortId: "input",
				},
				{
					id: "conn-3",
					sourceNodeId: "assign-node",
					sourcePortId: "output",
					targetNodeId: "notification-node",
					targetPortId: "input",
				},
			],
			variables: [],
			settings: {
				timeout: 300,
				errorHandling: "stop",
				logging: { enabled: true, level: "info", includeData: false },
			},
			metadata: {
				tags: ["automation", "assignment"],
				author: "system",
			},
			enabled: true,
		},
		createdAt: new Date(),
		createdBy: "system",
	},
];

/**
 * Initialize workflow templates in system
 */
interface IWorkflowService {
	getTemplate(id: string): Promise<WorkflowTemplate | null>;
	createTemplate(template: Omit<WorkflowTemplate, "id" | "createdAt">): Promise<WorkflowTemplate>;
}

export async function initializeWorkflowTemplates(
	workflowService: IWorkflowService,
): Promise<void> {
	console.log("[WORKFLOW] Initializing workflow templates...");

	for (const template of workflowTemplates) {
		try {
			// Check if template already exists
			const existing = await workflowService.getTemplate(template.id);
			if (!existing) {
				await workflowService.createTemplate(template);
				console.log(`[WORKFLOW] Created template: ${template.name}`);
			}
		} catch (error) {
			console.error(`[WORKFLOW] Failed to create template ${template.name}:`, error);
		}
	}

	console.log("[WORKFLOW] Workflow templates initialization complete");
}
