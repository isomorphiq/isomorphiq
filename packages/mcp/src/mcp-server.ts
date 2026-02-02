// TODO: This file is too complex (1500 lines) and should be refactored into several modules.
// Current concerns mixed: MCP server setup, transport management, tool definitions,
// resource handlers, daemon client communication, command execution.
// 
// Proposed structure:
// - mcp/server.ts - MCP server initialization and configuration
// - mcp/transports/ - Transport implementations (stdio, SSE, HTTP)
// - mcp/tools/ - Individual tool handler modules
// - mcp/resources/ - Resource provider implementations
// - mcp/daemon-client.ts - Daemon TCP client communication
// - mcp/command-executor.ts - Shell command execution utilities
// - mcp/types.ts - MCP-specific types and schemas
// - mcp/index.ts - Main MCP server composition

import { exec } from "node:child_process";
import { randomUUID } from "node:crypto";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createContextClient } from "@isomorphiq/context";
import { createTaskClient } from "@isomorphiq/tasks";
import type { TaskSearchOptions, TaskSort } from "@isomorphiq/tasks";
import {
    CallToolRequestSchema,
    ListResourcesRequestSchema,
    ListToolsRequestSchema,
    ReadResourceRequestSchema,
    type Resource,
    type Tool,
} from "@modelcontextprotocol/sdk/types.js";

// TCP client to communicate with the daemon
/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
class DaemonClient {
	private port: number;
	private host: string;

	constructor() {
		const envPort = Number(process.env.TCP_PORT ?? process.env.DAEMON_PORT);
		this.port = Number.isFinite(envPort) && envPort > 0 ? envPort : 3001;
		this.host = process.env.DAEMON_HOST ?? "localhost";
	}

	async sendCommand<T = unknown, R = unknown>(
		command: string,
		data: T,
		environment?: string,
	): Promise<R> {
		return new Promise((resolve, reject) => {
			const client = createConnection({ port: this.port, host: this.host }, () => {
				console.log("[MCP] Connected to daemon");
				const message = `${JSON.stringify({ command, data, environment })}\n`;
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

const resolveEnvironmentHeaderName = (): string =>
	process.env.ENVIRONMENT_HEADER
	|| process.env.ISOMORPHIQ_ENVIRONMENT_HEADER
	|| "Environment";

const resolveDefaultEnvironment = (): string =>
	process.env.DEFAULT_ENVIRONMENT
	|| process.env.ISOMORPHIQ_DEFAULT_ENVIRONMENT
	|| "production";

const normalizeEnvironmentName = (value: string): string => value.trim().toLowerCase();

const readEnvironmentFromHeaders = (
	headers: Record<string, string> | undefined,
	headerName: string,
): string | undefined => {
	if (!headers) return undefined;
	const key = headerName.toLowerCase();
	const direct = headers[key];
	if (direct && direct.trim().length > 0) {
		return direct;
	}
	const match = Object.entries(headers).find(([name]) => name.toLowerCase() === key);
	if (!match) return undefined;
	const [, value] = match;
	return value && value.trim().length > 0 ? value : undefined;
};

const resolveRequestEnvironment = (headers?: Record<string, string>): string => {
	const headerName = resolveEnvironmentHeaderName();
	const fromHeader = readEnvironmentFromHeaders(headers, headerName);
	const isTestMode =
		process.env.ISOMORPHIQ_TEST_MODE === "true" || process.env.NODE_ENV === "test";
	const fromEnv =
		process.env.ISOMORPHIQ_ENVIRONMENT
		|| (isTestMode ? process.env.ISOMORPHIQ_TEST_ENVIRONMENT : undefined);
	const raw = fromHeader || fromEnv || resolveDefaultEnvironment();
	return normalizeEnvironmentName(raw);
};

const resolveTaskServiceBaseUrl = (): string => {
	const direct = process.env.TASKS_SERVICE_URL ?? process.env.TASKS_HTTP_URL;
	if (direct && direct.trim().length > 0) {
		return direct.trim();
	}
	const host = process.env.TASKS_HOST ?? "127.0.0.1";
	const portRaw = process.env.TASKS_HTTP_PORT ?? process.env.TASKS_PORT ?? "3006";
	const port = Number.parseInt(portRaw, 10);
	const resolvedPort = Number.isFinite(port) && port > 0 ? port : 3006;
	return `http://${host}:${resolvedPort}`;
};

const logTaskServiceTarget = (baseUrl: string): void => {
	const logLevel = (process.env.LOG_LEVEL ?? "").toLowerCase();
	if (logLevel !== "debug") return;
	console.log(`[MCP] Task service URL: ${baseUrl}`);
};

const resolveContextServiceBaseUrl = (): string => {
	const direct = process.env.CONTEXT_SERVICE_URL ?? process.env.CONTEXT_HTTP_URL;
	if (direct && direct.trim().length > 0) {
		return direct.trim();
	}
	const host = process.env.CONTEXT_HOST ?? "127.0.0.1";
	const portRaw = process.env.CONTEXT_HTTP_PORT ?? process.env.CONTEXT_PORT ?? "3008";
	const port = Number.parseInt(portRaw, 10);
	const resolvedPort = Number.isFinite(port) && port > 0 ? port : 3008;
	return `http://${host}:${resolvedPort}`;
};

const logContextServiceTarget = (baseUrl: string): void => {
	const logLevel = (process.env.LOG_LEVEL ?? "").toLowerCase();
	if (logLevel !== "debug") return;
	console.log(`[MCP] Context service URL: ${baseUrl}`);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value);

const resolveDaemonResult = <T>(value: unknown): T => {
	if (isRecord(value) && "success" in value) {
		const success = Boolean(value.success);
		if (!success) {
			const errorValue = value.error;
			const message =
				typeof errorValue === "string"
					? errorValue
					: isRecord(errorValue) && typeof errorValue.message === "string"
						? errorValue.message
						: "Daemon command failed";
			throw new Error(message);
		}
		return value.data as T;
	}
	return value as T;
};

const resolveHeadersFromExtra = (extra: unknown): Record<string, string> | undefined => {
	if (!isRecord(extra)) return undefined;
	const requestInfo = extra.requestInfo;
	if (!isRecord(requestInfo)) return undefined;
	const headers = requestInfo.headers;
	if (!isRecord(headers)) return undefined;
	const entries = Object.entries(headers).filter(
		(entry): entry is [string, string] => typeof entry[1] === "string",
	);
	return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

const normalizeStringArray = (value: unknown): string[] | undefined => {
	if (typeof value === "string" && value.trim().length > 0) {
		return [value];
	}
	if (Array.isArray(value)) {
		const filtered = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
		return filtered.length > 0 ? filtered : undefined;
	}
	return undefined;
};

const taskStatusValues = ["todo", "in-progress", "done", "invalid"] as const;
type TaskStatusValue = (typeof taskStatusValues)[number];

const taskPriorityValues = ["low", "medium", "high"] as const;
type TaskPriorityValue = (typeof taskPriorityValues)[number];

const taskTypeValues = [
	"task",
	"integration",
	"implementation",
	"theme",
	"initiative",
	"feature",
	"story",
	"testing",
	"research",
] as const;
type TaskTypeValue = (typeof taskTypeValues)[number];

const normalizeEnumArray = <T extends string>(
	value: unknown,
	allowed: readonly T[],
): T[] | undefined => {
	const normalized = normalizeStringArray(value);
	if (!normalized) return undefined;
	const allowedSet = new Set(allowed);
	const filtered = normalized.filter((entry): entry is T => allowedSet.has(entry as T));
	return filtered.length > 0 ? filtered : undefined;
};

const normalizeTaskType = (value: unknown): TaskTypeValue | undefined => {
	if (typeof value !== "string") return undefined;
	return (taskTypeValues as readonly string[]).includes(value) ? (value as TaskTypeValue) : undefined;
};

const normalizeTaskSort = (value: unknown): TaskSort | undefined => {
	if (!isRecord(value)) {
		return undefined;
	}
	const field = typeof value.field === "string" ? value.field : undefined;
	const direction = typeof value.direction === "string" ? value.direction : undefined;
	if (!field || !direction) {
		return undefined;
	}
	if (!["title", "createdAt", "updatedAt", "priority", "status"].includes(field)) {
		return undefined;
	}
	if (!["asc", "desc"].includes(direction)) {
		return undefined;
	}
	return {
		field: field as TaskSort["field"],
		direction: direction as TaskSort["direction"],
	};
};

const normalizeTaskSearchOptions = (value: unknown): TaskSearchOptions => {
	if (!isRecord(value)) {
		return {};
	}
	const filtersSource = isRecord(value.filters) ? value.filters : value;
	const status = normalizeEnumArray(filtersSource.status, taskStatusValues);
	const priority = normalizeEnumArray(filtersSource.priority, taskPriorityValues);
	const assignedTo = normalizeStringArray(filtersSource.assignedTo);
	const createdBy = normalizeStringArray(filtersSource.createdBy);
	const collaborators = normalizeStringArray(filtersSource.collaborators);
	const watchers = normalizeStringArray(filtersSource.watchers);
	const dateFrom = typeof filtersSource.dateFrom === "string" ? filtersSource.dateFrom : undefined;
	const dateTo = typeof filtersSource.dateTo === "string" ? filtersSource.dateTo : undefined;

	const filters =
		status || priority || assignedTo || createdBy || collaborators || watchers || dateFrom || dateTo
			? {
				status,
				priority,
				assignedTo,
				createdBy,
				collaborators,
				watchers,
				dateFrom,
				dateTo,
			}
			: undefined;

	return {
		query:
			typeof value.search === "string"
				? value.search
				: typeof value.q === "string"
					? value.q
					: typeof value.query === "string"
						? value.query
						: undefined,
		filters,
		sort: normalizeTaskSort(value.sort),
		limit: typeof value.limit === "number" ? value.limit : undefined,
		offset: typeof value.offset === "number" ? value.offset : undefined,
	};
};
const gbnfResourcePath = resolve(process.cwd(), "resources", "mcp-tool-calls.gbnf");
const gbnfResourceUri = "file://resources/mcp-tool-calls.gbnf";
const mcpResources: Resource[] = [
    {
        name: "MCP tool call grammar",
        uri: gbnfResourceUri,
        description: "GBNF grammar describing the TCP JSON payloads accepted by the daemon",
        mimeType: "text/plain",
        annotations: {
            audience: ["assistant"],
            priority: 1,
        },
    },
];

// Define the MCP server
const server = new Server(
    {
        name: "task-manager-mcp",
        version: "1.0.0",
    },
    {
        capabilities: {
            tools: {},
            resources: {},
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
				type: {
					type: "string",
					enum: [
						"task",
						"theme",
						"initiative",
						"feature",
						"story",
						"implementation",
						"integration",
						"testing",
						"research",
					],
					description: "The task type",
				},
				createdBy: {
					type: "string",
					description: "Optional creator identifier",
				},
				assignedTo: {
					type: "string",
					description: "Optional assignee",
				},
				dependencies: {
					type: "array",
					items: { type: "string" },
					description: "Optional dependency task IDs",
				},
				collaborators: {
					type: "array",
					items: { type: "string" },
					description: "Optional collaborator user IDs",
				},
				watchers: {
					type: "array",
					items: { type: "string" },
					description: "Optional watcher user IDs",
				},
			},
			required: ["title", "description"],
		},
	},
	{
		name: "list_tasks",
		description: "List tasks in the database (optionally filtered)",
		inputSchema: {
			type: "object",
			properties: {
				filters: {
					type: "object",
					description: "Optional task filters",
					properties: {
						status: {
							oneOf: [
								{ type: "string" },
								{ type: "array", items: { type: "string" } },
							],
						},
						priority: {
							oneOf: [
								{ type: "string" },
								{ type: "array", items: { type: "string" } },
							],
						},
						createdBy: {
							oneOf: [
								{ type: "string" },
								{ type: "array", items: { type: "string" } },
							],
						},
						assignedTo: {
							oneOf: [
								{ type: "string" },
								{ type: "array", items: { type: "string" } },
							],
						},
						collaborators: {
							oneOf: [
								{ type: "string" },
								{ type: "array", items: { type: "string" } },
							],
						},
						watchers: {
							oneOf: [
								{ type: "string" },
								{ type: "array", items: { type: "string" } },
							],
						},
						dateFrom: { type: "string" },
						dateTo: { type: "string" },
						type: { type: "string" },
						limit: { type: "number" },
						offset: { type: "number" },
						search: { type: "string" },
					},
				},
			},
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
		name: "update_task",
		description: "Update task fields (including dependencies)",
		inputSchema: {
			type: "object",
			properties: {
				id: {
					type: "string",
					description: "The ID of the task to update",
				},
				updates: {
					type: "object",
					description: "Fields to update",
					properties: {
						title: { type: "string" },
						description: { type: "string" },
						status: {
							type: "string",
							enum: ["todo", "in-progress", "done", "invalid"],
						},
						priority: {
							type: "string",
							enum: ["low", "medium", "high"],
						},
						type: { type: "string" },
						assignedTo: { type: "string" },
						dependencies: {
							type: "array",
							items: { type: "string" },
						},
						collaborators: {
							type: "array",
							items: { type: "string" },
						},
						watchers: {
							type: "array",
							items: { type: "string" },
						},
					},
				},
				changedBy: {
					type: "string",
					description: "Optional user updating the task",
				},
			},
			required: ["id", "updates"],
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
					enum: ["todo", "in-progress", "done", "invalid"],
					description: "The new status of the task",
				},
				changedBy: {
					type: "string",
					description: "Optional user updating the task",
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
				changedBy: {
					type: "string",
					description: "Optional user updating the task",
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
		name: "create_context",
		description: "Create a new workflow context record (returns context token/id)",
		inputSchema: {
			type: "object",
			properties: {
				id: {
					type: "string",
					description: "Optional context ID to use",
				},
				data: {
					type: "object",
					description: "Optional initial context data",
					additionalProperties: true,
				},
			},
		},
	},
	{
		name: "get_context",
		description: "Fetch a context record by ID",
		inputSchema: {
			type: "object",
			properties: {
				id: {
					type: "string",
					description: "The context ID to retrieve",
				},
			},
			required: ["id"],
		},
	},
	{
		name: "update_context",
		description: "Merge a patch into an existing context record",
		inputSchema: {
			type: "object",
			properties: {
				id: {
					type: "string",
					description: "The context ID to update",
				},
				patch: {
					type: "object",
					description: "Partial context data to merge",
					additionalProperties: true,
				},
			},
			required: ["id", "patch"],
		},
	},
	{
		name: "replace_context",
		description: "Replace the full context data for a context record",
		inputSchema: {
			type: "object",
			properties: {
				id: {
					type: "string",
					description: "The context ID to update",
				},
				data: {
					type: "object",
					description: "Full context data payload",
					additionalProperties: true,
				},
			},
			required: ["id", "data"],
		},
	},
	{
		name: "delete_context",
		description: "Delete a context record by ID",
		inputSchema: {
			type: "object",
			properties: {
				id: {
					type: "string",
					description: "The context ID to delete",
				},
			},
			required: ["id"],
		},
	},
	{
		name: "list_contexts",
		description: "List all context records (admin/debug)",
		inputSchema: {
			type: "object",
			properties: {},
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
	{
		name: "search_tasks",
		description: "Search tasks with advanced filtering, sorting, and pagination",
		inputSchema: {
			type: "object",
			properties: {
				query: {
					type: "object",
					description: "Search query with filters and options",
					properties: {
						q: {
							type: "string",
							description: "Text search term to match in title, description, assignedTo, or createdBy",
						},
						status: {
							type: "array",
							items: { type: "string", enum: ["todo", "in-progress", "done", "invalid"] },
							description: "Filter by task status",
						},
						priority: {
							type: "array",
							items: { type: "string", enum: ["low", "medium", "high"] },
							description: "Filter by task priority",
						},
						type: {
							type: "array",
							items: {
								type: "string",
								enum: [
									"feature",
									"story",
									"task",
									"implementation",
									"integration",
									"testing",
									"research",
								],
							},
							description: "Filter by task type",
						},
						assignedTo: {
							type: "array",
							items: { type: "string" },
							description: "Filter by assigned users",
						},
						createdBy: {
							type: "array",
							items: { type: "string" },
							description: "Filter by creator users",
						},
						collaborators: {
							type: "array",
							items: { type: "string" },
							description: "Filter by collaborators",
						},
						watchers: {
							type: "array",
							items: { type: "string" },
							description: "Filter by watchers",
						},
						dateFrom: {
							type: "string",
							description: "Filter tasks created after this date (ISO format)",
						},
						dateTo: {
							type: "string",
							description: "Filter tasks created before this date (ISO format)",
						},
						updatedFrom: {
							type: "string",
							description: "Filter tasks updated after this date (ISO format)",
						},
						updatedTo: {
							type: "string",
							description: "Filter tasks updated before this date (ISO format)",
						},
						tags: {
							type: "array",
							items: { type: "string" },
							description: "Filter by tags",
						},
						dependencies: {
							type: "array",
							items: { type: "string" },
							description: "Filter by dependency task IDs",
						},
						hasDependencies: {
							type: "boolean",
							description: "Filter tasks with or without dependencies",
						},
						sort: {
							type: "object",
							description: "Sort options",
							properties: {
								field: {
									type: "string",
									enum: ["relevance", "title", "createdAt", "updatedAt", "priority", "status"],
									description: "Field to sort by",
								},
								direction: {
									type: "string",
									enum: ["asc", "desc"],
									description: "Sort direction",
								},
							},
							required: ["field", "direction"],
						},
						limit: {
							type: "number",
							description: "Maximum number of results to return",
							default: 50,
						},
						offset: {
							type: "number",
							description: "Number of results to skip",
							default: 0,
						},
					},
				},
			},
			required: [],
		},
	},
	{
		name: "create_saved_search",
		description: "Create a saved search for later use",
		inputSchema: {
			type: "object",
			properties: {
				name: {
					type: "string",
					description: "Name of the saved search",
				},
				description: {
					type: "string",
					description: "Optional description of what this search finds",
				},
				query: {
					type: "object",
					description: "Search query to save (same format as search_tasks query)",
				},
				isPublic: {
					type: "boolean",
					description: "Whether this saved search is visible to all users",
					default: false,
				},
				createdBy: {
					type: "string",
					description: "User creating this saved search",
				},
			},
			required: ["name", "query"],
		},
	},
	{
		name: "get_saved_search",
		description: "Get a specific saved search by ID",
		inputSchema: {
			type: "object",
			properties: {
				id: {
					type: "string",
					description: "ID of the saved search to retrieve",
				},
			},
			required: ["id"],
		},
	},
	{
		name: "list_saved_searches",
		description: "List all saved searches, optionally filtered by creator",
		inputSchema: {
			type: "object",
			properties: {
				createdBy: {
					type: "string",
					description: "Optional filter to only show searches by specific user",
				},
			},
		},
	},
	{
		name: "update_saved_search",
		description: "Update an existing saved search",
		inputSchema: {
			type: "object",
			properties: {
				id: {
					type: "string",
					description: "ID of the saved search to update",
				},
				name: {
					type: "string",
					description: "New name for the saved search",
				},
				description: {
					type: "string",
					description: "New description for the saved search",
				},
				query: {
					type: "object",
					description: "New search query",
				},
				isPublic: {
					type: "boolean",
					description: "New visibility setting",
				},
			},
			required: ["id"],
		},
	},
	{
		name: "delete_saved_search",
		description: "Delete a saved search",
		inputSchema: {
			type: "object",
			properties: {
				id: {
					type: "string",
					description: "ID of the saved search to delete",
				},
			},
			required: ["id"],
		},
	},
	{
		name: "execute_saved_search",
		description: "Execute a saved search and return the results",
		inputSchema: {
			type: "object",
			properties: {
				id: {
					type: "string",
					description: "ID of the saved search to execute",
				},
			},
			required: ["id"],
		},
	},
 ];

server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return { resources: mcpResources };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const resource = mcpResources.find((entry) => entry.uri === request.params.uri);
    if (!resource) {
        throw new Error(`Resource not found: ${request.params.uri}`);
    }
    const contents = await readFile(gbnfResourcePath, "utf8");
    return {
        contents: [
            {
                uri: resource.uri,
                mimeType: resource.mimeType ?? "text/plain",
                text: contents,
            },
        ],
    };
});

// Handle tool listing
server.setRequestHandler(ListToolsRequestSchema, async () => {
	return { tools };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
	const { name, arguments: args } = request.params;
	const environment = resolveRequestEnvironment(resolveHeadersFromExtra(extra));
	const sendDaemonCommand = async <T = unknown, R = unknown>(command: string, data: T): Promise<R> => {
		const response = await daemonClient.sendCommand(command, data, environment);
		return resolveDaemonResult<R>(response);
	};

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

	// TODO: Route MCP task/context operations through the gateway once it exposes orchestration endpoints.
	// For now we talk directly to the microservices to avoid daemon-held LevelDB locks.
	const taskServiceUrl = resolveTaskServiceBaseUrl();
	logTaskServiceTarget(taskServiceUrl);
	const taskClient = createTaskClient({
		environment,
		enableSubscriptions: false,
		url: taskServiceUrl,
	});
	const contextServiceUrl = resolveContextServiceBaseUrl();
	logContextServiceTarget(contextServiceUrl);
	const contextClient = createContextClient({
		environment,
		url: contextServiceUrl,
	});

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
				const newTask = await taskClient.createTask(
					{
						title: args.title as string,
						description: args.description as string,
						priority: (args.priority as "low" | "medium" | "high") || "medium",
						type: normalizeTaskType(args.type),
						assignedTo: args.assignedTo as string | undefined,
						dependencies: args.dependencies as string[] | undefined,
						collaborators: args.collaborators as string[] | undefined,
						watchers: args.watchers as string[] | undefined,
					},
					args.createdBy as string | undefined,
				);
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
				const options = normalizeTaskSearchOptions(
					isRecord(args.filters) ? args.filters : {},
				);
				const shouldSearch = Boolean(
					options.query || options.filters || options.sort || options.limit || options.offset,
				);
				const result = shouldSearch
					? await taskClient.searchTasks(options)
					: { tasks: await taskClient.listTasks(), total: 0 };
				const taskList = result.tasks;
				const total = shouldSearch ? result.total : taskList.length;
				return {
					content: [
						{
							type: "text",
							text: `Found ${total} tasks:\n${JSON.stringify(taskList, null, 2)}`,
						},
					],
				};
			}

			case "get_task": {
				const task = await taskClient.getTask(args.id as string);
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

			case "update_task": {
				const updatedTask = await taskClient.updateTask(
					args.id as string,
					(args.updates as Record<string, unknown>) ?? {},
					args.changedBy as string | undefined,
				);
				return {
					content: [
						{
							type: "text",
							text: `Task updated successfully: ${JSON.stringify(updatedTask, null, 2)}`,
						},
					],
				};
			}

			case "update_task_status": {
				const updatedTask = await taskClient.updateTaskStatus(
					args.id as string,
					args.status as "todo" | "in-progress" | "done" | "invalid",
					args.changedBy as string | undefined,
				);
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
				const priorityUpdatedTask = await taskClient.updateTaskPriority(
					args.id as string,
					args.priority as "low" | "medium" | "high",
					args.changedBy as string | undefined,
				);
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
				await taskClient.deleteTask(args.id as string);
				return {
					content: [
						{
							type: "text",
							text: `Task ${args.id} deleted successfully`,
						},
					],
				};

			case "create_context": {
				const data = isRecord(args.data) ? args.data : undefined;
				const id = typeof args.id === "string" ? args.id : undefined;
				const created = await contextClient.createContext({
					...(id ? { id } : {}),
					...(data ? { data } : {}),
				});
				return {
					content: [
						{
							type: "text",
							text: `Context created: ${JSON.stringify(created, null, 2)}`,
						},
					],
				};
			}

			case "get_context": {
				const id = typeof args.id === "string" ? args.id : "";
				if (!id) {
					throw new Error("Context id is required");
				}
				const record = await contextClient.getContext(id);
				if (!record) {
					throw new Error(`Context ${id} not found`);
				}
				return {
					content: [
						{
							type: "text",
							text: `Context:\n${JSON.stringify(record, null, 2)}`,
						},
					],
				};
			}

			case "update_context": {
				const id = typeof args.id === "string" ? args.id : "";
				if (!id) {
					throw new Error("Context id is required");
				}
				let patch: Record<string, unknown> | null = null;
				if (isRecord(args.patch)) {
					patch = args.patch as Record<string, unknown>;
				} else if (typeof args.patch === "string") {
					try {
						const parsed = JSON.parse(args.patch) as unknown;
						patch = isRecord(parsed) ? parsed : null;
					} catch {
						patch = null;
					}
				}
				if (!patch) {
					throw new Error(
						"Context patch must be an object. Example: {\"id\":\"context-...\",\"patch\":{\"testStatus\":\"failed\"}}",
					);
				}
				const updated = await contextClient.updateContext(
					id,
					patch,
				);
				return {
					content: [
						{
							type: "text",
							text: `Context updated: ${JSON.stringify(updated, null, 2)}`,
						},
					],
				};
			}

			case "replace_context": {
				const id = typeof args.id === "string" ? args.id : "";
				if (!id) {
					throw new Error("Context id is required");
				}
				if (!isRecord(args.data)) {
					throw new Error("Context data must be an object");
				}
				const updated = await contextClient.replaceContext(
					id,
					args.data as Record<string, unknown>,
				);
				return {
					content: [
						{
							type: "text",
							text: `Context replaced: ${JSON.stringify(updated, null, 2)}`,
						},
					],
				};
			}

			case "delete_context": {
				const id = typeof args.id === "string" ? args.id : "";
				if (!id) {
					throw new Error("Context id is required");
				}
				await contextClient.deleteContext(id);
				return {
					content: [
						{
							type: "text",
							text: `Context ${id} deleted successfully`,
						},
					],
				};
			}

			case "list_contexts": {
				const records = await contextClient.listContexts();
				return {
					content: [
						{
							type: "text",
							text: `Found ${records.length} contexts:\n${JSON.stringify(records, null, 2)}`,
						},
					],
				};
			}

			case "restart_daemon":
				await sendDaemonCommand("restart", {});
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
					exec("yarn run daemon &", { cwd: process.cwd(), env: process.env });
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
				const newTemplate = await sendDaemonCommand("create_template", {
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
				const templates = await sendDaemonCommand("list_templates", {});
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
				const template = await sendDaemonCommand("get_template", { id: args.id as string });
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
				const taskFromTemplate = await sendDaemonCommand("create_task_from_template", {
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
				const initResult = await sendDaemonCommand("initialize_templates", {});
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
				const newAutomationRule = await sendDaemonCommand("create_automation_rule", {
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
					const automationRules = await sendDaemonCommand("list_automation_rules", {});
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
				const updatedAutomationRule = await sendDaemonCommand("update_automation_rule", {
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
				await sendDaemonCommand("delete_automation_rule", { id: args.id as string });
				return {
					content: [
						{
							type: "text",
							text: `Automation rule ${args.id} deleted successfully`,
						},
					],
				};

			case "reload_automation_rules": {
				const reloadResult = await sendDaemonCommand("reload_automation_rules", {});
				return {
					content: [
						{
							type: "text",
							text: `Automation rules reloaded: ${JSON.stringify(reloadResult, null, 2)}`,
						},
					],
				};
			}

			case "search_tasks": {
				const searchResult = await taskClient.searchTasks(
					normalizeTaskSearchOptions(args.query),
				);
				return {
					content: [
						{
							type: "text",
							text: `Search results: ${JSON.stringify(searchResult, null, 2)}`,
						},
					],
				};
			}

			case "create_saved_search": {
				const savedSearch = await sendDaemonCommand("create_saved_search", {
					name: args.name as string,
					description: args.description as string,
					query: args.query as object,
					isPublic: args.isPublic as boolean,
					createdBy: args.createdBy as string,
				});
				return {
					content: [
						{
							type: "text",
							text: `Saved search created: ${JSON.stringify(savedSearch, null, 2)}`,
						},
					],
				};
			}

			case "get_saved_search": {
				const savedSearch = await sendDaemonCommand("get_saved_search", {
					id: args.id as string,
				});
				return {
					content: [
						{
							type: "text",
							text: `Saved search: ${JSON.stringify(savedSearch, null, 2)}`,
						},
					],
				};
			}

			case "list_saved_searches": {
				const savedSearches = await sendDaemonCommand("list_saved_searches", {
					createdBy: args.createdBy as string,
				});
				return {
					content: [
						{
							type: "text",
							text: `Saved searches: ${JSON.stringify(savedSearches, null, 2)}`,
						},
					],
				};
			}

			case "update_saved_search": {
				const savedSearch = await sendDaemonCommand("update_saved_search", {
					id: args.id as string,
					name: args.name as string,
					description: args.description as string,
					query: args.query as object,
					isPublic: args.isPublic as boolean,
				});
				return {
					content: [
						{
							type: "text",
							text: `Saved search updated: ${JSON.stringify(savedSearch, null, 2)}`,
						},
					],
				};
			}

			case "delete_saved_search": {
				const deleteResult = await sendDaemonCommand("delete_saved_search", {
					id: args.id as string,
				});
				return {
					content: [
						{
							type: "text",
							text: `Saved search deleted: ${JSON.stringify(deleteResult, null, 2)}`,
						},
					],
				};
			}

			case "execute_saved_search": {
				const searchResult = await sendDaemonCommand("execute_saved_search", {
					id: args.id as string,
				});
				return {
					content: [
						{
							type: "text",
							text: `Saved search executed: ${JSON.stringify(searchResult, null, 2)}`,
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
	} finally {
		await taskClient.close();
	}
});

export type McpServerOptions = {
	transport?: "stdio" | "http" | "sse";
	host?: string;
	port?: number;
	path?: string;
};

const resolveHttpOptions = (options: McpServerOptions): { host: string; port: number; path: string } => {
	const host =
		options.host
		?? process.env.ISOMORPHIQ_MCP_HTTP_HOST
		?? process.env.MCP_HTTP_HOST
		?? "localhost";
	const portRaw =
		options.port?.toString()
		?? process.env.ISOMORPHIQ_MCP_HTTP_PORT
		?? process.env.MCP_HTTP_PORT
		?? "3100";
	const port = Number.parseInt(portRaw, 10);
	const pathValue =
		options.path
		?? process.env.ISOMORPHIQ_MCP_HTTP_PATH
		?? process.env.MCP_HTTP_PATH
		?? "/mcp";
	const normalizedPath = pathValue.startsWith("/") ? pathValue : `/${pathValue}`;
	const resolvedPort = Number.isFinite(port) && port > 0 ? port : 3100;
	return { host, port: resolvedPort, path: normalizedPath };
};

const readRequestBody = async (req: http.IncomingMessage): Promise<string> => {
	return new Promise((resolve, reject) => {
		let data = "";
		req.on("data", (chunk) => {
			data += chunk.toString();
		});
		req.on("end", () => resolve(data));
		req.on("error", (error) => reject(error));
	});
};

const handleHttpRequest = async (
	req: http.IncomingMessage,
	res: http.ServerResponse,
	transport: StreamableHTTPServerTransport,
	path: string,
): Promise<void> => {
	const host = req.headers.host ?? "localhost";
	const url = new URL(req.url ?? "", `http://${host}`);
	if (url.pathname === "/health") {
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ ok: true }));
		return;
	}
	if (url.pathname !== path) {
		res.statusCode = 404;
		res.end("Not Found");
		return;
	}
	if (req.method === "OPTIONS") {
		res.writeHead(204, {
			"Access-Control-Allow-Origin": "*",
			"Access-Control-Allow-Headers": "*",
			"Access-Control-Allow-Methods": "GET,POST,OPTIONS",
		});
		res.end();
		return;
	}
	try {
		if (req.method === "POST") {
			const bodyText = await readRequestBody(req);
			const parsedBody = bodyText.trim().length > 0 ? JSON.parse(bodyText) : undefined;
			await transport.handleRequest(req, res, parsedBody);
			return;
		}
		await transport.handleRequest(req, res, undefined);
	} catch (error) {
		console.error("[MCP] HTTP transport error:", error);
		if (!res.headersSent) {
			res.statusCode = 500;
			res.end("Internal Server Error");
		}
	}
};

// Start the server
export async function startMcpServer(options: McpServerOptions = {}): Promise<void> {
	const transport =
		options.transport
		?? process.env.ISOMORPHIQ_MCP_TRANSPORT
		?? process.env.MCP_TRANSPORT
		?? "stdio";

	if (transport === "sse") {
		const { host, port, path } = resolveHttpOptions(options);
		const sessionTransports = new Map<string, SSEServerTransport>();
		const messagePath = `${path.replace(/\/$/, "")}/messages`;
		const httpServer = http.createServer(async (req, res) => {
			const hostHeader = req.headers.host ?? host;
			const url = new URL(req.url ?? "", `http://${hostHeader}`);
			if (url.pathname === "/health") {
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ ok: true }));
				return;
			}
			if (req.method === "GET" && url.pathname === path) {
				try {
					const sseTransport = new SSEServerTransport(messagePath, res);
					const sessionId = sseTransport.sessionId;
					sessionTransports.set(sessionId, sseTransport);
					sseTransport.onclose = () => {
						sessionTransports.delete(sessionId);
					};
					await server.connect(sseTransport);
				} catch (error) {
					console.error("[MCP] SSE transport error:", error);
					if (!res.headersSent) {
						res.statusCode = 500;
						res.end("Error establishing SSE stream");
					}
				}
				return;
			}
			if (req.method === "POST" && url.pathname === messagePath) {
				const sessionId = url.searchParams.get("sessionId") ?? "";
				const sseTransport = sessionTransports.get(sessionId);
				if (!sseTransport) {
					res.statusCode = 404;
					res.end("Session not found");
					return;
				}
				try {
					await sseTransport.handlePostMessage(req, res, undefined);
				} catch (error) {
					console.error("[MCP] SSE post error:", error);
					if (!res.headersSent) {
						res.statusCode = 500;
						res.end("Error handling message");
					}
				}
				return;
			}
			res.statusCode = 404;
			res.end("Not Found");
		});
		await new Promise<void>((resolve) => {
			httpServer.listen(port, host, () => resolve());
		});
		console.error(`Task Manager MCP SSE server started on http://${host}:${port}${path}`);
		return;
	}

	if (transport === "http") {
		const { host, port, path } = resolveHttpOptions(options);
		const httpTransport = new StreamableHTTPServerTransport({
			sessionIdGenerator: () => randomUUID(),
		});
		await server.connect(httpTransport);
		const httpServer = http.createServer((req, res) => {
			void handleHttpRequest(req, res, httpTransport, path);
		});
		await new Promise<void>((resolve) => {
			httpServer.listen(port, host, () => resolve());
		});
		console.error(`Task Manager MCP HTTP server started on http://${host}:${port}${path}`);
		return;
	}

	const stdioTransport = new StdioServerTransport();
	await server.connect(stdioTransport);
	console.error("Task Manager MCP server started (stdio)");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    startMcpServer().catch((error) => {
        console.error("MCP server error:", error);
        process.exit(1);
    });
}
