import { exec } from "node:child_process";
import { createConnection } from "node:net";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
	type Tool,
} from "@modelcontextprotocol/sdk/types.js";

// TCP client to communicate with the daemon
class DaemonClient {
	private port: number = 3001;
	private host: string = "localhost";

	async sendCommand<T = unknown, R = unknown>(command: string, data: T): Promise<R> {
		return new Promise((resolve, reject) => {
			const client = createConnection({ port: this.port, host: this.host }, () => {
				console.log("[MCP] Connected to daemon");
				const message = `${JSON.stringify({ command, data })}\n`;
				client.write(message);
			});

			let response = "";
			client.on("data", (data) => {
				response += data.toString();
					try {
						const result = JSON.parse(response.trim());
						client.end();
						resolve(result);
					} catch (_e) {
						void _e;
						// Wait for more data
					}
				});

			client.on("error", (err) => {
				console.error("[MCP] Daemon connection error:", err.message);
				reject(new Error("Failed to connect to daemon"));
			});

			client.on("close", () => {
				if (!response) {
					reject(new Error("Connection closed without response"));
				}
			});

			// Timeout after 5 seconds
			setTimeout(() => {
				client.destroy();
				reject(new Error("Request timeout"));
			}, 5000);
		});
	}

	async checkStatus(): Promise<{ running: boolean; message: string }> {
		return new Promise((resolve) => {
			const client = createConnection({ port: this.port, host: this.host }, () => {
				client.end();
				resolve({ running: true, message: "Daemon is running and accepting connections" });
			});

			client.on("error", () => {
				resolve({ running: false, message: "Daemon is not running or not accessible" });
			});

			// Timeout after 2 seconds
			setTimeout(() => {
				client.destroy();
				resolve({ running: false, message: "Daemon connection timeout" });
			}, 2000);
		});
	}
}

// Create daemon client
const daemonClient = new DaemonClient();

// Define the MCP server
const server = new Server(
	{
		name: "task-manager-mcp",
		version: "1.0.0",
	},
	{
		capabilities: {
			tools: {},
		},
	},
);

// Define available tools
const tools: Tool[] = [
	{
		name: "check_daemon_status",
		description: "Check if the task-manager daemon is running and accessible",
		inputSchema: {
			type: "object",
			properties: {},
		},
	},
	{
		name: "start_daemon",
		description: "Start the task-manager daemon if it is not running",
		inputSchema: {
			type: "object",
			properties: {},
		},
	},
	{
		name: "create_task",
		description: "Create a new task with title, description, and priority",
		inputSchema: {
			type: "object",
			properties: {
				title: {
					type: "string",
					description: "The title of the task",
				},
				description: {
					type: "string",
					description: "The description of the task",
				},
				priority: {
					type: "string",
					enum: ["low", "medium", "high"],
					description: "The priority level of the task",
					default: "medium",
				},
			},
			required: ["title", "description"],
		},
	},
	{
		name: "list_tasks",
		description: "List all tasks in the database",
		inputSchema: {
			type: "object",
			properties: {},
		},
	},
	{
		name: "get_task",
		description: "Get a specific task by ID",
		inputSchema: {
			type: "object",
			properties: {
				id: {
					type: "string",
					description: "The ID of the task to retrieve",
				},
			},
			required: ["id"],
		},
	},
	{
		name: "update_task_status",
		description: "Update the status of a task",
		inputSchema: {
			type: "object",
			properties: {
				id: {
					type: "string",
					description: "The ID of the task to update",
				},
				status: {
					type: "string",
					enum: ["todo", "in-progress", "done"],
					description: "The new status of the task",
				},
			},
			required: ["id", "status"],
		},
	},
	{
		name: "update_task_priority",
		description: "Update the priority of a task",
		inputSchema: {
			type: "object",
			properties: {
				id: {
					type: "string",
					description: "The ID of the task to update",
				},
				priority: {
					type: "string",
					enum: ["low", "medium", "high"],
					description: "The new priority of the task",
				},
			},
			required: ["id", "priority"],
		},
	},
	{
		name: "delete_task",
		description: "Delete a task by ID",
		inputSchema: {
			type: "object",
			properties: {
				id: {
					type: "string",
					description: "The ID of the task to delete",
				},
			},
			required: ["id"],
		},
	},
	{
		name: "restart_daemon",
		description: "Gracefully restart the task-manager daemon after finishing current task",
		inputSchema: {
			type: "object",
			properties: {},
		},
	},
	{
		name: "create_template",
		description: "Create a new task template with variables and subtasks",
		inputSchema: {
			type: "object",
			properties: {
				name: {
					type: "string",
					description: "The name of the template",
				},
				description: {
					type: "string",
					description: "The description of the template",
				},
				category: {
					type: "string",
					enum: [
						"development",
						"testing",
						"documentation",
						"bug-fix",
						"feature",
						"maintenance",
						"deployment",
						"custom",
					],
					description: "The category of the template",
				},
				titleTemplate: {
					type: "string",
					description: "The title template with variable placeholders (e.g., \"Fix: {{bugTitle}}\")",
				},
				descriptionTemplate: {
					type: "string",
					description: "The description template with variable placeholders",
				},
				priority: {
					type: "string",
					enum: ["low", "medium", "high"],
					description: "The default priority for tasks created from this template",
					default: "medium",
				},
			},
			required: ["name", "description", "category", "titleTemplate", "descriptionTemplate"],
		},
	},
	{
		name: "list_templates",
		description: "List all available task templates",
		inputSchema: {
			type: "object",
			properties: {},
		},
	},
	{
		name: "get_template",
		description: "Get a specific template by ID",
		inputSchema: {
			type: "object",
			properties: {
				id: {
					type: "string",
					description: "The ID of the template to retrieve",
				},
			},
			required: ["id"],
		},
	},
	{
		name: "create_task_from_template",
		description: "Create a task from a template with variable values",
		inputSchema: {
			type: "object",
			properties: {
				templateId: {
					type: "string",
					description: "The ID of the template to use",
				},
				variables: {
					type: "object",
					description:
						"Object containing variable values (e.g., {\"bugTitle\": \"Login fails\", \"severity\": \"high\"})",
				},
				subtasks: {
					type: "boolean",
					description: "Whether to create subtasks defined in the template",
					default: true,
				},
			},
			required: ["templateId", "variables"],
		},
	},
	{
		name: "initialize_templates",
		description: "Initialize the system with predefined templates for common workflows",
		inputSchema: {
			type: "object",
			properties: {},
		},
	},
	{
		name: "create_automation_rule",
		description: "Create a new automation rule for task management",
		inputSchema: {
			type: "object",
			properties: {
				name: {
					type: "string",
					description: "The name of the automation rule",
				},
				description: {
					type: "string",
					description: "The description of what the automation rule does",
				},
				trigger: {
					type: "object",
					description: "The trigger conditions for the automation rule",
				},
				actions: {
					type: "array",
					description: "The actions to execute when the trigger conditions are met",
				},
				enabled: {
					type: "boolean",
					description: "Whether the automation rule is enabled",
					default: true,
				},
			},
			required: ["name", "description", "trigger", "actions"],
		},
	},
	{
		name: "list_automation_rules",
		description: "List all automation rules",
		inputSchema: {
			type: "object",
			properties: {},
		},
	},
	{
		name: "update_automation_rule",
		description: "Update an existing automation rule",
		inputSchema: {
			type: "object",
			properties: {
				id: {
					type: "string",
					description: "The ID of the automation rule to update",
				},
				updates: {
					type: "object",
					description: "The updates to apply to the automation rule",
				},
			},
			required: ["id", "updates"],
		},
	},
	{
		name: "delete_automation_rule",
		description: "Delete an automation rule",
		inputSchema: {
			type: "object",
			properties: {
				id: {
					type: "string",
					description: "The ID of the automation rule to delete",
				},
			},
			required: ["id"],
		},
	},
	{
		name: "reload_automation_rules",
		description: "Reload automation rules from storage",
		inputSchema: {
			type: "object",
			properties: {},
		},
	},
];

// Handle tool listing
server.setRequestHandler(ListToolsRequestSchema, async () => {
	return { tools };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
	const { name, arguments: args } = request.params;

	if (!args) {
		return {
			content: [
				{
					type: "text",
					text: "Error: No arguments provided",
				},
			],
			isError: true,
		};
	}

	try {
		switch (name) {
			case "check_daemon_status": {
				const status = await daemonClient.checkStatus();
				return {
					content: [
						{
							type: "text",
							text: `Daemon status: ${status.running ? "Running" : "Not running"}\n${status.message}`,
						},
					],
				};
			}

			case "create_task": {
				const newTask = await daemonClient.sendCommand("create_task", {
					title: args.title as string,
					description: args.description as string,
					priority: (args.priority as "low" | "medium" | "high") || "medium",
				});
				return {
					content: [
						{
							type: "text",
							text: `Task created successfully: ${JSON.stringify(newTask, null, 2)}`,
						},
					],
				};
			}

			case "list_tasks": {
				const tasks = await daemonClient.sendCommand("list_tasks", {});
				const taskList = Array.isArray(tasks) ? tasks : [];
				return {
					content: [
						{
							type: "text",
							text: `Found ${taskList.length} tasks:\n${JSON.stringify(taskList, null, 2)}`,
						},
					],
				};
			}

			case "get_task": {
				const task = await daemonClient.sendCommand("get_task", { id: args.id as string });
				if (!task) {
					throw new Error(`Task with ID ${args.id} not found`);
				}
				return {
					content: [
						{
							type: "text",
							text: `Task details:\n${JSON.stringify(task, null, 2)}`,
						},
					],
				};
			}

			case "update_task_status": {
				const updatedTask = await daemonClient.sendCommand("update_task_status", {
					id: args.id as string,
					status: args.status as string,
				});
				return {
					content: [
						{
							type: "text",
							text: `Task status updated successfully: ${JSON.stringify(updatedTask, null, 2)}`,
						},
					],
				};
			}

			case "update_task_priority": {
				const priorityUpdatedTask = await daemonClient.sendCommand("update_task_priority", {
					id: args.id as string,
					priority: args.priority as string,
				});
				return {
					content: [
						{
							type: "text",
							text: `Task priority updated successfully: ${JSON.stringify(priorityUpdatedTask, null, 2)}`,
						},
					],
				};
			}

			case "delete_task":
				await daemonClient.sendCommand("delete_task", { id: args.id as string });
				return {
					content: [
						{
							type: "text",
							text: `Task ${args.id} deleted successfully`,
						},
					],
				};

			case "restart_daemon":
				await daemonClient.sendCommand("restart", {});
				return {
					content: [
						{
							type: "text",
							text: "Daemon restart initiated. It will finish current task and restart gracefully.",
						},
					],
				};

			case "start_daemon": {
				const startStatus = await daemonClient.checkStatus();
				if (startStatus.running) {
					return {
						content: [
							{
								type: "text",
								text: "Daemon is already running.",
							},
						],
					};
				} else {
					exec("npm run daemon &", { cwd: process.cwd(), env: process.env });
					return {
						content: [
							{
								type: "text",
								text: "Daemon start initiated.",
							},
						],
					};
				}
			}

			case "create_template": {
				const newTemplate = await daemonClient.sendCommand("create_template", {
					name: args.name as string,
					description: args.description as string,
					category: args.category as string,
					titleTemplate: args.titleTemplate as string,
					descriptionTemplate: args.descriptionTemplate as string,
					priority: (args.priority as "low" | "medium" | "high") || "medium",
				});
				return {
					content: [
						{
							type: "text",
							text: `Template created successfully: ${JSON.stringify(newTemplate, null, 2)}`,
						},
					],
				};
			}

			case "list_templates": {
				const templates = await daemonClient.sendCommand("list_templates", {});
				const templateList = Array.isArray(templates) ? templates : [];
				return {
					content: [
						{
							type: "text",
							text: `Found ${templateList.length} templates:\n${JSON.stringify(templateList, null, 2)}`,
						},
					],
				};
			}

			case "get_template": {
				const template = await daemonClient.sendCommand("get_template", { id: args.id as string });
				if (!template) {
					throw new Error(`Template with ID ${args.id} not found`);
				}
				return {
					content: [
						{
							type: "text",
							text: `Template details:\n${JSON.stringify(template, null, 2)}`,
						},
					],
				};
			}

			case "create_task_from_template": {
				const taskFromTemplate = await daemonClient.sendCommand("create_task_from_template", {
					templateId: args.templateId as string,
					variables: args.variables as Record<string, unknown>,
					subtasks: (args.subtasks as boolean) ?? true,
				});
				return {
					content: [
						{
							type: "text",
							text: `Task created from template successfully:\n${JSON.stringify(taskFromTemplate, null, 2)}`,
						},
					],
				};
			}

			case "initialize_templates": {
				const initResult = await daemonClient.sendCommand("initialize_templates", {});
				return {
					content: [
						{
							type: "text",
							text: `Template initialization completed: ${JSON.stringify(initResult, null, 2)}`,
						},
					],
				};
			}

			case "create_automation_rule": {
				const newAutomationRule = await daemonClient.sendCommand("create_automation_rule", {
					name: args.name as string,
					description: args.description as string,
					trigger: args.trigger as object,
					actions: args.actions as Array<Record<string, unknown>>,
					enabled: (args.enabled as boolean) ?? true,
				});
				return {
					content: [
						{
							type: "text",
							text: `Automation rule created successfully: ${JSON.stringify(newAutomationRule, null, 2)}`,
						},
					],
				};
			}

				case "list_automation_rules": {
					const automationRules = await daemonClient.sendCommand("list_automation_rules", {});
					const ruleList = Array.isArray(automationRules) ? automationRules : [];
					return {
						content: [
							{
								type: "text",
								text: `Found ${ruleList.length} automation rules:\n${JSON.stringify(ruleList, null, 2)}`,
							},
						],
					};
				}

			case "update_automation_rule": {
				const updatedAutomationRule = await daemonClient.sendCommand("update_automation_rule", {
					id: args.id as string,
					updates: args.updates as object,
				});
				return {
					content: [
						{
							type: "text",
							text: `Automation rule updated successfully: ${JSON.stringify(updatedAutomationRule, null, 2)}`,
						},
					],
				};
			}

			case "delete_automation_rule":
				await daemonClient.sendCommand("delete_automation_rule", { id: args.id as string });
				return {
					content: [
						{
							type: "text",
							text: `Automation rule ${args.id} deleted successfully`,
						},
					],
				};

			case "reload_automation_rules": {
				const reloadResult = await daemonClient.sendCommand("reload_automation_rules", {});
				return {
					content: [
						{
							type: "text",
							text: `Automation rules reloaded: ${JSON.stringify(reloadResult, null, 2)}`,
						},
					],
				};
			}

			default:
				throw new Error(`Unknown tool: ${name}`);
		}
	} catch (error) {
		return {
			content: [
				{
					type: "text",
					text: `Error: ${(error as Error).message}`,
				},
			],
			isError: true,
		};
	}
});

// Start the server
async function main() {
	const transport = new StdioServerTransport();
	await server.connect(transport);
	console.error("Task Manager MCP server started");
}

main().catch((error) => {
	console.error("MCP server error:", error);
	process.exit(1);
});
