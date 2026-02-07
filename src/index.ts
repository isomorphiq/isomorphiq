// TODO: This file is too complex (2019 lines) and should be refactored into several modules.
// Current concerns mixed: Database initialization, ACP session management, task CRUD operations,
// workflow execution, automation rules, search functionality, WebSocket handling.
// 
// Proposed structure:
// - core/database.ts - LevelDB initialization and connection management
// - core/acp-session.ts - ACP connection and session lifecycle
// - tasks/crud-service.ts - Task create, read, update, delete operations
// - tasks/search-service.ts - Task search and filtering logic
// - tasks/automation-service.ts - Automation rule engine and triggers
// - workflow/engine.ts - Workflow execution and token management
// - websocket/handler.ts - WebSocket event handling
// - api/routes.ts - API endpoint definitions
// - types/index.ts - Centralized type definitions
// - index.ts - Main application composition

import path from "node:path";
import { z } from "zod";
import { Effect } from "effect";
import { Level } from "level";
import { ACPConnectionManager, startAcpSession, type AcpSession } from "@isomorphiq/acp";
import {
    type ACPProfile,
    ProfileManager,
    type ProfileMetrics,
    type ProfileState,
} from "@isomorphiq/profiles";
import { AutomationRuleEngine } from "@isomorphiq/tasks";
import { acpCleanupEffect } from "@isomorphiq/acp";
import { acpTurnEffect } from "@isomorphiq/acp";
import { gitCommitIfChanges } from "./git-utils.ts";
import { TemplateManager, optimizedPriorityService } from "@isomorphiq/tasks";
import { exec as execCallback } from "node:child_process";
import { promisify } from "node:util";
import {
	TaskPrioritySchema,
	TaskSchema,
	TaskStatusSchema,
	TaskStruct,
	TaskTypeSchema,
	type CreateTaskFromTemplateInput,
	type SavedSearch,
	type Task,
    type TaskStatus,
    type TaskType,
    type WebSocketEventType,
} from "./types.ts";
import { buildWorkflowWithEffects } from "@isomorphiq/workflow";
import { advanceToken, createToken } from "@isomorphiq/workflow";
import type { WebSocketManager } from "@isomorphiq/realtime";
import { ArchiveService } from "./services/archive-service.ts";
import { IntegrationService } from "@isomorphiq/integrations";

// Initialize LevelDB
const dbPath = path.join(process.cwd(), "db");
const db = new Level<string, Task>(dbPath, { valueEncoding: "json" });

// Initialize separate database for saved searches
const savedSearchesDbPath = path.join(process.cwd(), "saved-searches-db");
const savedSearchesDb = new Level<string, SavedSearch>(savedSearchesDbPath, { valueEncoding: "json" });

const automationTaskCreatedSchema = z.object({
    title: z.string(),
    description: z.string(),
    priority: TaskPrioritySchema.optional(),
    dependencies: z.array(z.string()).optional(),
    createdBy: z.string().optional(),
    assignedTo: z.string().optional(),
    collaborators: z.array(z.string()).optional(),
    watchers: z.array(z.string()).optional(),
});

const automationTaskUpdatedSchema = z.object({
    taskId: z.string(),
    updates: z.record(z.unknown()),
});

const automationPriorityChangeSchema = z.object({
    taskId: z.string(),
    newPriority: TaskPrioritySchema.optional(),
    priority: TaskPrioritySchema.optional(),
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null;

const readStringArray = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const readDate = (value: unknown): Date | undefined => {
    if (value instanceof Date) {
        return value;
    }
    if (typeof value === "string" || typeof value === "number") {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? undefined : parsed;
    }
    return undefined;
};

const normalizeTask = (value: unknown): Task | null => {
    const parsed = TaskSchema.safeParse(value);
    if (parsed.success) {
        return TaskStruct.from(parsed.data);
    }

    if (!isRecord(value)) {
        return null;
    }

    const priorityResult = TaskPrioritySchema.safeParse(value.priority);
    const statusResult = TaskStatusSchema.safeParse(value.status);
    const typeResult = TaskTypeSchema.safeParse(value.type);

    const normalized = {
        id: typeof value.id === "string" ? value.id : "",
        title: typeof value.title === "string" ? value.title : "",
        description: typeof value.description === "string" ? value.description : "",
        status: statusResult.success ? statusResult.data : "todo",
        priority: priorityResult.success ? priorityResult.data : "medium",
        type: typeResult.success ? typeResult.data : "task",
        dependencies: readStringArray(value.dependencies),
        createdBy: typeof value.createdBy === "string" ? value.createdBy : "system",
        assignedTo: typeof value.assignedTo === "string" ? value.assignedTo : undefined,
        collaborators: readStringArray(value.collaborators),
        watchers: readStringArray(value.watchers),
        createdAt: readDate(value.createdAt) ?? new Date(),
        updatedAt: readDate(value.updatedAt) ?? new Date(),
    };

    const normalizedResult = TaskSchema.safeParse(normalized);
    return normalizedResult.success ? TaskStruct.from(normalizedResult.data) : null;
};

const getContextTaskId = (context: Record<string, unknown>): string | undefined => {
    const taskValue = context.task;
    if (isRecord(taskValue) && typeof taskValue.id === "string") {
        return taskValue.id;
    }
    if (typeof context.taskId === "string") {
        return context.taskId;
    }
    return undefined;
};

const getErrorMessage = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);

const execAsync = promisify(execCallback);

const getLastTestResult = (
    value: unknown,
): { output?: string; passed?: boolean; success?: boolean } | undefined => {
    if (!isRecord(value)) {
        return undefined;
    }
    const output = typeof value.output === "string" ? value.output : undefined;
    const passed = typeof value.passed === "boolean" ? value.passed : undefined;
    const success = typeof value.success === "boolean" ? value.success : undefined;
    if (output === undefined && passed === undefined && success === undefined) {
        return undefined;
    }
    return { output, passed, success };
};

const getLastTestResultFromToken = (
    tokenValue: unknown,
): { output?: string; passed?: boolean; success?: boolean } | undefined => {
    if (!isRecord(tokenValue)) {
        return undefined;
    }
    const contextValue = tokenValue.context;
    return isRecord(contextValue) ? getLastTestResult(contextValue.lastTestResult) : undefined;
};

const getLastTestResultFromPayload = (
    payload: unknown,
): { output?: string; passed?: boolean; success?: boolean } | undefined => {
    if (!isRecord(payload)) {
        return undefined;
    }
    return getLastTestResultFromToken(payload.token);
};

const getErrorCode = (error: unknown): string | undefined => {
    if (!isRecord(error)) {
        return undefined;
    }
    const code = typeof error.code === "string" ? error.code : undefined;
    const cause = isRecord(error.cause) ? error.cause : undefined;
    const causeCode = cause && typeof cause.code === "string" ? cause.code : undefined;
    return code ?? causeCode;
};

// Product Manager class to handle task operations
/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class ProductManager {
	private profileManager: ProfileManager;
	private templateManager: TemplateManager;
	private automationEngine: AutomationRuleEngine;
	private dbReady = false;
	private wsManager: WebSocketManager | null = null;
	private priorityService = optimizedPriorityService;
	private archiveService: ArchiveService;
	private integrationService: IntegrationService;
	private integrationDb: Level<string, unknown>;

	private async ensureDbOpen(): Promise<void> {
		if (this.dbReady) return;
		try {
			await db.open();
			this.dbReady = true;
			console.log("[DB] Database opened successfully");
			await this.integrationDb.open();
			await this.integrationService.initialize();
			console.log("[INTEGRATIONS] Integration service initialized");
		} catch (error) {
			console.error("[DB] Failed to open database:", error);
			// Crash fast so supervisor restarts us; avoids running without persistence
			throw error;
		}
	}

	constructor() {
		this.profileManager = new ProfileManager();
		this.templateManager = new TemplateManager();
		this.automationEngine = new AutomationRuleEngine();
		this.archiveService = new ArchiveService();
		this.integrationDb = new Level(path.join(dbPath, "integrations"), { valueEncoding: "json" });
		this.integrationService = new IntegrationService(this.integrationDb);
		this.setupAutomationEngine();
		// Database will be opened on first use
	}

	// Set WebSocket manager for broadcasting
	setWebSocketManager(wsManager: WebSocketManager): void {
		this.wsManager = wsManager;
	}

	getWebSocketManager(): WebSocketManager | null {
		return this.wsManager;
	}

	getIntegrationService(): IntegrationService {
		return this.integrationService;
	}

	// Setup automation engine with event handlers
	private setupAutomationEngine(): void {
		// Register event handlers for automation
		this.automationEngine.onTaskEvent(
			async (eventType: WebSocketEventType, data: unknown) => {
				console.log(`[AUTOMATION] Received task event: ${eventType}`);

				switch (eventType) {
					case "task_created": {
						const created = automationTaskCreatedSchema.safeParse(data);
						if (!created.success) {
							console.log("[AUTOMATION] Invalid task_created payload");
							break;
						}
						const payload = created.data;
						await this.createTask(
							payload.title,
							payload.description,
							payload.priority ?? "medium",
							payload.dependencies ?? [],
							payload.createdBy,
							payload.assignedTo,
							payload.collaborators,
							payload.watchers,
						);
						break;
					}
					case "task_updated": {
						const updated = automationTaskUpdatedSchema.safeParse(data);
						if (!updated.success) {
							console.log("[AUTOMATION] Invalid task_updated payload");
							break;
						}
						await this.handleTaskUpdate(updated.data.taskId, updated.data.updates);
						break;
					}
					case "task_priority_changed": {
						const priorityChange = automationPriorityChangeSchema.safeParse(data);
						if (!priorityChange.success) {
							console.log("[AUTOMATION] Invalid task_priority_changed payload");
							break;
						}
						const newPriority =
							priorityChange.data.newPriority ?? priorityChange.data.priority;
						if (!newPriority) {
							console.log("[AUTOMATION] Missing priority in task_priority_changed payload");
							break;
						}
						await this.updateTaskPriority(priorityChange.data.taskId, newPriority);
						break;
					}
				}
			},
		);
	}

	// Handle task updates from automation
	private async handleTaskUpdate(taskId: string, updates: Record<string, unknown>): Promise<void> {
		// Ensure database is open
		if (!this.dbReady) {
			await this.ensureDbOpen();
		}

		try {
			const task = await db.get(taskId);
			const updatedTask: Task = {
				...task,
				...updates,
				updatedAt: new Date(),
			};
			await db.put(taskId, updatedTask);

			// Broadcast update to WebSocket clients
			if (this.wsManager) {
				this.wsManager.broadcastTaskUpdated(updatedTask, updates);
			}

			console.log(`[AUTOMATION] Updated task ${taskId}:`, updates);
		} catch (error) {
			console.error(`[AUTOMATION] Failed to update task ${taskId}:`, error);
		}
	}

	// Load automation rules from template manager
	async loadAutomationRules(): Promise<void> {
		try {
			const rules = await this.templateManager.getAllAutomationRules();
			this.automationEngine.loadRules(rules);
			console.log(`[AUTOMATION] Loaded ${rules.length} automation rules`);
		} catch (error) {
			console.error("[AUTOMATION] Failed to load automation rules:", error);
		}
	}

	private hasDependencyCycle(tasks: Task[]): boolean {
		const adj = new Map<string, string[]>();
		for (const task of tasks) {
			adj.set(task.id, task.dependencies || []);
		}

		const visiting = new Set<string>();
		const visited = new Set<string>();

		const dfs = (node: string): boolean => {
			if (visiting.has(node)) return true; // cycle detected
			if (visited.has(node)) return false;

			visiting.add(node);
			const neighbors = adj.get(node) || [];
			for (const next of neighbors) {
				if (!adj.has(next)) continue; // ignore unknown
				if (dfs(next)) return true;
			}
			visiting.delete(node);
			visited.add(node);
			return false;
		};

		for (const id of adj.keys()) {
			if (dfs(id)) return true;
		}
		return false;
	}

	// Create a new task
	async createTask(
		title: string,
		description: string,
		priority: "low" | "medium" | "high" = "medium",
		dependencies: string[] = [],
		createdBy?: string,
		assignedTo?: string,
		collaborators?: string[],
		watchers?: string[],
		type: TaskType = "task",
	): Promise<Task> {
		// Ensure database is open
		await this.ensureDbOpen();

		const id = `task-${Date.now()}`;
		const task: Task = {
			id,
			title,
			description,
			status: "todo",
			priority,
			type,
			dependencies,
			createdBy: createdBy || "system",
			...(assignedTo && { assignedTo }),
			...(collaborators && { collaborators }),
			...(watchers && { watchers }),
			createdAt: new Date(),
			updatedAt: new Date(),
		};

		try {
			// validate dependencies (must exist and cannot include self once id known)
			const uniqueDeps = Array.from(new Set(dependencies || []));
			if (uniqueDeps.length > 0) {
				for (const depId of uniqueDeps) {
					if (depId === id) {
						throw new Error("Task cannot depend on itself");
					}
					const exists = await db.get(depId).catch(() => null);
					if (!exists) {
						throw new Error(`Dependency not found: ${depId}`);
					}
				}
			}

			// Cycle detection including new task
			const existingTasks = await this.getAllTasks();
			const hypotheticalTasks = [...existingTasks, task];
			if (this.hasDependencyCycle(hypotheticalTasks)) {
				throw new Error("Adding these dependencies would create a cycle in the task graph");
			}

			await db.put(id, task);
			console.log(`[DB] Created task: ${id}`);

			// Process automation rules for task creation
			const allTasks = await this.getAllTasks();
			const automationResults = await this.automationEngine.processTaskEvent(
				"task_created",
				task,
				allTasks,
			);
			if (automationResults.length > 0) {
				console.log(
					`[AUTOMATION] Processed ${automationResults.length} automation rules for task creation`,
				);
			}

			// Broadcast task creation to WebSocket clients
			if (this.wsManager) {
				this.wsManager.broadcastTaskCreated(task);
			}

			return task;
		} catch (error) {
			console.error("[DB] Failed to create task:", error);
			throw error;
		}
	}

	// Get all tasks
	async getAllTasks(): Promise<Task[]> {
		// Ensure database is open
		await this.ensureDbOpen();

		const tasks: Task[] = [];
		const iterator = db.iterator();
		try {
			for await (const [, value] of iterator) {
				const normalized = normalizeTask(value);
				if (normalized) {
					tasks.push(normalized);
				}
			}
		} catch (error) {
			console.error("[DB] Error reading tasks:", error);
			throw error;
		} finally {
			try {
				await iterator.close();
			} catch (closeError) {
				console.error("[DB] Error closing iterator:", closeError);
			}
		}
		return tasks;
	}

	// Update task status
	async updateTaskStatus(id: string, status: TaskStatus): Promise<Task> {
		// Ensure database is open
		if (!this.dbReady) {
			await db.open();
			this.dbReady = true;
		}

		const task = await db.get(id);
		const oldStatus = task.status;
		task.status = status;
		task.updatedAt = new Date();
		await db.put(id, task);

		// Process automation rules for status change
		const allTasks = await this.getAllTasks();
		const automationResults = await this.automationEngine.processTaskEvent(
			"task_status_changed",
			{
				taskId: id,
				oldStatus,
				newStatus: status,
				task,
			},
			allTasks,
		);
		if (automationResults.length > 0) {
			console.log(
				`[AUTOMATION] Processed ${automationResults.length} automation rules for status change`,
			);
		}

		// Broadcast status change to WebSocket clients
		if (this.wsManager) {
			this.wsManager.broadcastTaskStatusChanged(id, oldStatus, status, task);
		}

		return task;
	}

	// Update task dependencies
	async updateTaskDependencies(id: string, dependencies: string[]): Promise<Task> {
		// Ensure database is open
		if (!this.dbReady) {
			await db.open();
			this.dbReady = true;
		}

		const task = await db.get(id);

		const uniqueDeps = Array.from(new Set(dependencies || []));
		for (const depId of uniqueDeps) {
			if (depId === id) {
				throw new Error("Task cannot depend on itself");
			}
			const exists = await db.get(depId).catch(() => null);
			if (!exists) {
				throw new Error(`Dependency not found: ${depId}`);
			}
		}

		// Cycle check with updated dependencies
		const allTasks = await this.getAllTasks();
		const updatedTasks = allTasks.map((t) =>
			t.id === id ? { ...t, dependencies: uniqueDeps } : t,
		);
		if (this.hasDependencyCycle(updatedTasks)) {
			throw new Error("Updating dependencies would create a cycle in the task graph");
		}

		task.dependencies = uniqueDeps;
		task.updatedAt = new Date();
		await db.put(id, task);

		if (this.wsManager) {
			this.wsManager.broadcastTaskUpdated(task, { dependencies: uniqueDeps });
		}

		return task;
	}

	// Update task priority with optimized service
	async updateTaskPriority(id: string, priority: "low" | "medium" | "high"): Promise<Task> {
		// Ensure database is open
		if (!this.dbReady) {
			await db.open();
			this.dbReady = true;
		}

		// Get current task for priority comparison
		const currentTask = await db.get(id);
		const oldPriority = currentTask.priority;

		// Use optimized priority service for update
		return await this.priorityService.updateTaskPriority(
			id,
			priority,
			oldPriority,
			async (taskId: string, newPriority: "low" | "medium" | "high") => {
				// Perform the actual database update
				const task = currentTask;
				task.priority = newPriority;
				task.updatedAt = new Date();
				await db.put(taskId, task);

				// Process automation rules for priority change (optimized)
				// Only process if priority actually changed
				if (oldPriority !== newPriority) {
					const automationResults = await this.automationEngine.processTaskEvent(
						"task_priority_changed",
						{
							taskId,
							oldPriority,
							newPriority,
							task,
						},
						[task], // Pass just the updated task to reduce processing
					);
					
					if (automationResults.length > 0) {
						console.log(
							`[AUTOMATION] Processed ${automationResults.length} automation rules for priority change`,
						);
					}

					// Broadcast priority change to WebSocket clients
					if (this.wsManager) {
						this.wsManager.broadcastTaskPriorityChanged(taskId, oldPriority, newPriority, task);
					}
				}

				return task;
			},
		);
	}

	// Delete a task
	async deleteTask(id: string): Promise<void> {
		// Ensure database is open
		if (!this.dbReady) {
			await db.open();
			this.dbReady = true;
		}

		// Get task before deletion for automation
		const task = await db.get(id);
		await db.del(id);

		// Process automation rules for task deletion
		const allTasks = await this.getAllTasks();
		const automationResults = await this.automationEngine.processTaskEvent(
			"task_deleted",
			{
				taskId: id,
				task,
			},
			allTasks,
		);
		if (automationResults.length > 0) {
			console.log(
				`[AUTOMATION] Processed ${automationResults.length} automation rules for task deletion`,
			);
		}

		// Broadcast task deletion to WebSocket clients
		if (this.wsManager) {
			this.wsManager.broadcastTaskDeleted(id);
		}
	}

	// Assign task to user
	async assignTask(id: string, assignedTo: string, assignedBy?: string): Promise<Task> {
		// Ensure database is open
		if (!this.dbReady) {
			await db.open();
			this.dbReady = true;
		}

		const task = await db.get(id);
		task.assignedTo = assignedTo;
		task.updatedAt = new Date();
		await db.put(id, task);

		// Broadcast assignment change to WebSocket clients
		if (this.wsManager) {
			this.wsManager.broadcastTaskAssigned(task, assignedTo, assignedBy || "system");
		}

		return task;
	}

	// Update task assignment (alias for assignTask)
	async updateTaskAssignment(id: string, assignedTo: string, assignedBy?: string): Promise<Task> {
		return await this.assignTask(id, assignedTo, assignedBy);
	}

	// Update task collaborators
	async updateTaskCollaborators(
		id: string,
		collaborators: string[],
		updatedBy?: string,
	): Promise<Task> {
		// Ensure database is open
		if (!this.dbReady) {
			await db.open();
			this.dbReady = true;
		}

		const task = await db.get(id);
		task.collaborators = collaborators;
		task.updatedAt = new Date();
		await db.put(id, task);

		// Broadcast collaborators change to WebSocket clients
		if (this.wsManager) {
			this.wsManager.broadcastTaskCollaboratorsUpdated(task, collaborators, updatedBy || "system");
		}

		return task;
	}

	// Update task watchers
	async updateTaskWatchers(id: string, watchers: string[], updatedBy?: string): Promise<Task> {
		// Ensure database is open
		if (!this.dbReady) {
			await db.open();
			this.dbReady = true;
		}

		const task = await db.get(id);
		task.watchers = watchers;
		task.updatedAt = new Date();
		await db.put(id, task);

		// Broadcast watchers change to WebSocket clients
		if (this.wsManager) {
			this.wsManager.broadcastTaskWatchersUpdated(task, watchers, updatedBy || "system");
		}

		return task;
	}

	// Get tasks for a specific user (created, assigned, or collaborating)
	async getTasksForUser(
		userId: string,
		include: ("created" | "assigned" | "collaborating" | "watching")[] = [
			"created",
			"assigned",
			"collaborating",
		],
	): Promise<Task[]> {
		const allTasks = await this.getAllTasks();

		return allTasks.filter((task) => {
			if (include.includes("created") && task.createdBy === userId) return true;
			if (include.includes("assigned") && task.assignedTo === userId) return true;
			if (include.includes("collaborating") && task.collaborators?.includes(userId)) return true;
			if (include.includes("watching") && task.watchers?.includes(userId)) return true;
			return false;
		});
	}

	// Check if user has access to task (can read/modify)
	async hasTaskAccess(
		userId: string,
		taskId: string,
		action: "read" | "write" | "delete" = "read",
	): Promise<boolean> {
		const task = await db.get(taskId).catch(() => null);
		if (!task) return false;

		// Creator has full access
		if (task.createdBy === userId) return true;

		// Assigned user has read/write access
		if (task.assignedTo === userId && ["read", "write"].includes(action)) return true;

		// Collaborators have read access
		if (task.collaborators?.includes(userId) && action === "read") return true;

		// Watchers have read access
		if (task.watchers?.includes(userId) && action === "read") return true;

		return false;
	}

	// Execute task using ACP protocol with profile
	async runOpencodeWithProfile(
		profileName: string,
		context: Record<string, unknown>,
	): Promise<{ output: string; errorOutput: string }> {
		const profile = this.profileManager.getProfile(profileName);
		if (!profile) {
			return {
				output: "",
				errorOutput: `Unknown profile: ${profileName}`,
			};
		}

		const currentTaskId = getContextTaskId(context) ?? "n/a";
		const prompt = `${profile.systemPrompt}\n\n${profile.getTaskPrompt(context)}`;
		console.log(`[ACP] Starting ${profile.role} profile communication (taskId=${currentTaskId})`);

		try {
			const result = await this.executeWithACP(prompt, profileName);
			console.log(
				`[ACP] ${profile.role} profile communication completed (taskId=${currentTaskId})`,
			);
			return result;
		} catch (error) {
			console.error(
				`[ACP] ${profile.role} profile communication error (taskId=${currentTaskId}): ${error}`,
			);
			const errorMsg = `Task execution failed: ACP connection failed: ${getErrorMessage(error)}`;
			return { output: "", errorOutput: errorMsg };
		}
	}

	// Execute task using ACP protocol only (legacy method)
	async runOpencode(
		prompt: string,
		taskId?: string,
	): Promise<{ output: string; errorOutput: string }> {
		const taggedTask = taskId ?? "n/a";
		console.log(`[ACP] Starting ACP protocol communication (taskId=${taggedTask}): ${prompt}`);

		try {
			// Execute using ACP protocol only
			const result = await this.executeWithACP(prompt);
			console.log(`[ACP] ACP protocol communication completed (taskId=${taggedTask})`);
			return result;
		} catch (error) {
			console.error(`[ACP] ACP communication error (taskId=${taggedTask}): ${error}`);

			// Fail with error - no fallbacks
			const errorMsg = `Task execution failed: ACP connection failed: ${getErrorMessage(error)}`;
			return { output: "", errorOutput: errorMsg };
		}
	}

	// Execute task using ACP protocol
	private async executeWithACP(
		prompt: string,
		profileName: string = "Unknown",
	): Promise<{ output: string; errorOutput: string }> {
		type ConnectionResult = Awaited<ReturnType<typeof ACPConnectionManager.createConnection>>;
		let connectionResult: ConnectionResult | null = null;
        const profile = this.profileManager.getProfile(profileName);
		try {
			// Create ACP connection
			connectionResult = await ACPConnectionManager.createConnection(undefined, {
                modelName: profile?.modelName,
                runtimeName: profile?.runtimeName,
                modeName: profile?.acpMode,
                sandbox: profile?.acpSandbox,
                approvalPolicy: profile?.acpApprovalPolicy,
                mcpServers: profile?.mcpServers,
            });
			connectionResult.taskClient.profileName = profileName;

			// Send prompt
			const promptResult = await ACPConnectionManager.sendPrompt(
				connectionResult.connection,
				connectionResult.sessionId,
				prompt,
			);

			// Mark the task client as complete as soon as the prompt returns a stop reason
			if (promptResult?.stopReason) {
				console.log(`[ACP] Prompt completed with stop reason: ${promptResult.stopReason}`);
				const stopReason =
					typeof promptResult.stopReason === "string"
						? promptResult.stopReason
						: String(promptResult.stopReason);
				connectionResult.taskClient.markTurnComplete(stopReason);
			}

			// Get task client from connection for response checking
			// Wait for completion using the actual task client that receives updates
			const result = await ACPConnectionManager.waitForTaskCompletion(
				connectionResult.taskClient,
				30000,
				profile?.role || "Unknown",
			);

			return { output: result.output, errorOutput: result.error };
		} finally {
			// Clean up connection
			if (connectionResult) {
				await ACPConnectionManager.cleanupConnection(
					connectionResult.connection,
					connectionResult.processResult,
				);
			}
		}
	}

	// TODO: replace with workflow-driven loop; keeping stub for now.
	async processTasksLoop(): Promise<void> {
		console.log("[APP] Starting workflow-driven task processing loop...");
		await this.runWorkflowLoop();
	}

	// Workflow-driven loop placeholder
	private async runWorkflowLoop(): Promise<void> {
		type WorkflowContext = {
			session?: AcpSession;
			lastTestResult?: unknown;
		} & Record<string, unknown>;

		let token = createToken<WorkflowContext>("tasks-prepared");
		const ensureSession = async (profile: string) => {
			if (!token.context) token.context = {};
			const existing = token.context.session;
			if (existing?.profile === profile) return existing;
			if (existing) {
				// cleanup old session if switching profiles
				await Effect.runPromise(acpCleanupEffect(existing));
			}
            const profileConfig = this.profileManager.getProfile(profile);
			const session = await startAcpSession(
                profile,
                { state: token.state },
                undefined,
                {
                    modelName: profileConfig?.modelName,
                    runtimeName: profileConfig?.runtimeName,
                    modeName: profileConfig?.acpMode,
                    sandbox: profileConfig?.acpSandbox,
                    approvalPolicy: profileConfig?.acpApprovalPolicy,
                    mcpServers: profileConfig?.mcpServers,
                },
            );
			token.context.session = session;
			return session;
		};

		const acpEffect = (profile: string, prompt: string) => () =>
			Effect.gen(function* () {
				console.log(`[ACP][${profile}] effect start: ${prompt.slice(0, 60)}...`);
				const session = yield* Effect.promise(() => ensureSession(profile));
				const result = yield* acpTurnEffect({ session, prompt });
				console.log(`[ACP][${profile}] effect done`);
				return result;
			});

			const runQaGateEffect = (
				stage: "lint" | "typecheck" | "unit-tests" | "e2e-tests" | "coverage",
				command: string,
				payload?: { token?: typeof token },
			) =>
				Effect.promise(async () => {
					let output = "";
					let success = false;
					try {
						const result = await execAsync(command, {
							timeout: stage === "lint" || stage === "typecheck" ? 300_000 : 900_000,
							maxBuffer: 10 * 1024 * 1024,
						});
						const stdout = (result.stdout ?? "").toString();
						const stderr = (result.stderr ?? "").toString();
						output = [
							`[${stage}] command: ${command}`,
							`[${stage}] stdout:`,
							stdout.length > 0 ? stdout : "(empty)",
							`[${stage}] stderr:`,
							stderr.length > 0 ? stderr : "(empty)",
						].join("\n");
						success = true;
					} catch (error) {
						const errorRecord = isRecord(error) ? error : {};
						const stdout = typeof errorRecord.stdout === "string" ? errorRecord.stdout : "";
						const stderr = typeof errorRecord.stderr === "string" ? errorRecord.stderr : "";
						const message =
							typeof errorRecord.message === "string"
								? errorRecord.message
								: getErrorMessage(error);
						output = [
							`[${stage}] command: ${command}`,
							`[${stage}] error: ${message}`,
							`[${stage}] stdout:`,
							stdout.length > 0 ? stdout : "(empty)",
							`[${stage}] stderr:`,
							stderr.length > 0 ? stderr : "(empty)",
						].join("\n");
						success = false;
					}
					const statusLine = `Test status: ${success ? "passed" : "failed"}`;
					const qaResult = {
						passed: success,
						success,
						stage,
						output: `${output}\n${statusLine}`.trim(),
					};
					if (payload?.token) {
						if (!payload.token.context) payload.token.context = {};
						payload.token.context.lastTestResult = qaResult;
					}
					console.log(`[QA:${stage}] ${success ? "passed" : "failed"}`);
					return qaResult;
				});

			const runQaFailureEffect = (
				stageLabel: string,
				payload?: unknown,
			) =>
				(() => {
					const lastOutput = getLastTestResultFromPayload(payload)?.output;
					return acpEffect(
						"development",
						`${stageLabel} failed. Here is the output:\n${lastOutput ?? "No output"}\nImplement targeted fixes and summarize what changed.`,
					)();
				})();

		const workflow = buildWorkflowWithEffects({
			"new-feature-proposed": {
				"retry-product-research": () =>
					Effect.gen(function* () {
						const eff = acpEffect(
							"product-manager",
							`Generate exactly ONE feature using MCP tools.

You MUST use MCP tool calls (no XML tags like <parameter>). Do NOT output a plain-text ticket without tool calls.

Step-by-step:
1) Call create_task exactly once with JSON parameters:
   {
     "title": "<feature request title>",
     "description": "<description with user value + acceptance criteria>",
     "type": "feature",
     "priority": "low|medium|high",
     "createdBy": "product-manager"
   }
2) Call list_tasks to confirm it exists.

Tool names are namespaced by MCP server. Use the exact tool name shown in the ACP tool list
(for example: functions.mcp__task-manager__create_task).

Return a short summary after tool calls.`,
						);
						// swallow ACP failures to allow retry via state loop
						yield* Effect.catchAll(eff(), (err) =>
							Effect.sync(() => console.error("[ACP][product-research] turn failed:", err)),
						);
					}),
				"prioritize-features": acpEffect(
					"product-manager",
					"Prioritize newly proposed features and push the top one to UX.",
				),
			},
			"features-prioritized": {
				"do-ux-research": acpEffect(
					"ux-specialist",
					`Select the top Feature and produce UX Stories only.
- Output 3-5 Stories (not tasks) with: title, description, user value, acceptance criteria, priority.
- Titles should read like user stories (e.g., "As a user...").
- Do NOT produce tasks here.`,
				),
				"prioritize-stories": acpEffect(
					"ux-specialist",
					"Re-prioritize existing Stories only; do not create tasks here.",
				),
			},
			"stories-created": {
				"prioritize-stories": acpEffect(
					"ux-specialist",
					"Draft 3-5 user stories (title, description, AC) and rank them.",
				),
				"request-feature": acpEffect(
					"ux-specialist",
					"No available feature. Ask for a feature to work on.",
				),
			},
			"stories-prioritized": {
				"refine-into-tasks": acpEffect(
					"refinement",
					`Take the highest-priority Story and break it into 3-7 executable Tasks.
- Tasks should be implementation-ready, small, and testable.
- Do NOT create new stories or features here.`,
				),
			},
			"tasks-prepared": {
				"begin-implementation": acpEffect(
					"development",
					"Pick the highest-priority task and hand it to development to start implementation.",
				),
				"need-more-tasks": acpEffect(
					"refinement",
					"No stories ready. Request more stories or unblock refinement.",
				),
			},
				"task-in-progress": {
					"run-lint": (payload) =>
						Effect.catchAll(runQaGateEffect("lint", "yarn run lint", payload), (err) =>
							Effect.sync(() => {
								console.error("[QA] run-lint effect failed", err);
							}),
						),
					"refine-task": acpEffect(
						"refinement",
						"No actionable task; request refinement or split work.",
					),
				},
				"lint-completed": {
					"run-typecheck": (payload) =>
						Effect.catchAll(runQaGateEffect("typecheck", "yarn run typecheck", payload), (err) =>
							Effect.sync(() => {
								console.error("[QA] run-typecheck effect failed", err);
							}),
						),
					"lint-failed": (payload) => runQaFailureEffect("Lint", payload),
				},
				"typecheck-completed": {
					"run-unit-tests": (payload) =>
						Effect.catchAll(runQaGateEffect("unit-tests", "yarn run test", payload), (err) =>
							Effect.sync(() => {
								console.error("[QA] run-unit-tests effect failed", err);
							}),
						),
					"typecheck-failed": (payload) => runQaFailureEffect("Typecheck", payload),
				},
				"unit-tests-completed": {
					"run-e2e-tests": (payload) =>
						Effect.catchAll(runQaGateEffect("e2e-tests", "npx playwright test", payload), (err) =>
							Effect.sync(() => {
								console.error("[QA] run-e2e-tests effect failed", err);
							}),
						),
					"unit-tests-failed": (payload) => runQaFailureEffect("Unit tests", payload),
				},
				"e2e-tests-completed": {
					"ensure-coverage": (payload) =>
						Effect.catchAll(
							runQaGateEffect("coverage", "yarn run test -- --coverage", payload),
							(err) =>
								Effect.sync(() => {
									console.error("[QA] ensure-coverage effect failed", err);
								}),
						),
					"e2e-tests-failed": (payload) => runQaFailureEffect("E2E tests", payload),
				},
				"coverage-completed": {
					"tests-passing": () =>
						Effect.gen(function* () {
							const commitMsg = `Automated: tests passing (${new Date().toISOString()})`;
							try {
								const result = yield* Effect.promise(() => gitCommitIfChanges(commitMsg));
								console.log("[GIT] Commit result:", result);
							} catch (err) {
								console.error("[GIT] Commit failed:", err);
							}

							yield* acpEffect(
								"qa-specialist",
								"All QA gates passed. Confirm readiness and summarize what was validated.",
							)();
						}),
					"coverage-failed": (payload) => runQaFailureEffect("Coverage", payload),
				},
				"task-completed": {
				"pick-up-next-task": acpEffect(
					"development",
					"Task closed. Announce completion and request next task.",
				),
				"prioritize-features": acpEffect(
					"product-manager",
					"Revisit feature priorities after recent deliveries.",
				),
				"prioritize-stories": acpEffect(
					"ux-specialist",
					"Re-rank stories based on the latest delivery context.",
				),
			},
		});
		console.log(
			"[WORKFLOW] transition binding check:",
			Object.keys(workflow["new-feature-proposed"].transitions),
		);

		while (true) {
			try {
				const tasks = await this.getAllTasks();

				// Decide transition for the current state
				const decider = workflow[token.state]?.decider;
				let transition = decider ? decider(tasks) : undefined;

					if (!transition) {
						throw new Error(`No transition chosen for state ${token.state}`);
					}
				console.log(
					`[WORKFLOW] Token state=${token.state} transition=${transition} tasks=${tasks.length}`,
				);

				// Run transition effect and advance state
				const payload = { token, tasks };
				token = await advanceToken(token, transition, workflow, payload);

				// Brief pause between steps
				await new Promise((r) => setTimeout(r, 2000));
			} catch (error) {
				console.error("[WORKFLOW] Error in loop:", error);
				// Crash fast if DB is locked/unavailable so supervisor can restart cleanly
				const code = getErrorCode(error);
				if (code === "LEVEL_DATABASE_NOT_OPEN" || code === "LEVEL_LOCKED") {
					throw error;
				}
				await new Promise((r) => setTimeout(r, 5000));
			}
		}
	}

	// Topological sort for dependency resolution
	private topologicalSort(tasks: Task[]): Task[] {
		const taskMap = new Map<string, Task>();
		const inDegree = new Map<string, number>();
		const adjList = new Map<string, string[]>();

		// Initialize data structures
		for (const task of tasks) {
			taskMap.set(task.id, task);
			inDegree.set(task.id, 0);
			adjList.set(task.id, []);
		}

		// Build adjacency list and calculate in-degrees
		for (const task of tasks) {
			for (const depId of task.dependencies) {
				if (taskMap.has(depId)) {
					adjList.get(depId)?.push(task.id);
					inDegree.set(task.id, (inDegree.get(task.id) || 0) + 1);
				} else {
					console.warn(`[DEPENDENCY] Task ${task.id} depends on non-existent task ${depId}`);
				}
			}
		}

		// Queue for tasks with no dependencies
		const queue: string[] = [];
		for (const [taskId, degree] of inDegree) {
			if (degree === 0) {
				queue.push(taskId);
			}
		}

		const result: Task[] = [];
		while (queue.length > 0) {
			// Sort by priority within the same dependency level
			queue.sort((a, b) => {
				const taskA = taskMap.get(a);
				const taskB = taskMap.get(b);
				if (!taskA || !taskB) return 0;
				const priorityOrder = { high: 3, medium: 2, low: 1 };
				return priorityOrder[taskB.priority] - priorityOrder[taskA.priority];
			});

			const currentId = queue.shift();
			if (!currentId) {
				break;
			}
			const currentTask = taskMap.get(currentId);
			if (currentTask) {
				result.push(currentTask);
			}

			// Process neighbors
			for (const neighborId of adjList.get(currentId) || []) {
				const newDegree = (inDegree.get(neighborId) || 0) - 1;
				inDegree.set(neighborId, newDegree);
				if (newDegree === 0) {
					queue.push(neighborId);
				}
			}
		}

		// Check for circular dependencies
		if (result.length !== tasks.length) {
			const remainingTasks = tasks.filter((task) => !result.includes(task));
			throw new Error(
				`Circular dependency detected among tasks: ${remainingTasks.map((t) => t.title).join(", ")}`,
			);
		}

		return result;
	}

	// Enhanced dependency validation with detailed error reporting
	validateDependencies(tasks: Task[]): {
		isValid: boolean;
		errors: string[];
		warnings: string[];
	} {
		const taskMap = new Map<string, Task>();
		const errors: string[] = [];
		const warnings: string[] = [];

		// Build task map
		for (const task of tasks) {
			taskMap.set(task.id, task);
		}

		// Check for circular dependencies using DFS with cycle path tracking
		const visited = new Set<string>();
		const recursionStack = new Set<string>();
		const path: string[] = [];

		const findCycle = (taskId: string): string[] | null => {
			if (recursionStack.has(taskId)) {
				// Found cycle, return the cycle path
				const cycleStart = path.indexOf(taskId);
				return path.slice(cycleStart).concat([taskId]);
			}
			if (visited.has(taskId)) {
				return null; // Already processed, no cycle from this node
			}

			visited.add(taskId);
			recursionStack.add(taskId);
			path.push(taskId);

			const task = taskMap.get(taskId);
			if (task) {
				for (const depId of task.dependencies) {
					const cycle = findCycle(depId);
					if (cycle) {
						return cycle;
					}
				}
			}

			recursionStack.delete(taskId);
			path.pop();
			return null;
		};

		// Check for cycles
		for (const task of tasks) {
			if (!visited.has(task.id)) {
				const cycle = findCycle(task.id);
				if (cycle) {
					const cycleTitles = cycle.map((id) => taskMap.get(id)?.title || id).join(" -> ");
					errors.push(`Circular dependency detected: ${cycleTitles}`);
				}
			}
		}

		// Check for non-existent dependencies
		for (const task of tasks) {
			for (const depId of task.dependencies) {
				if (!taskMap.has(depId)) {
					errors.push(`Task "${task.title}" depends on non-existent task: ${depId}`);
				}
			}
		}

		// Check for self-dependencies
		for (const task of tasks) {
			if (task.dependencies.includes(task.id)) {
				errors.push(`Task "${task.title}" cannot depend on itself`);
			}
		}

		// Check for completed tasks that are dependencies
		for (const task of tasks) {
			for (const depId of task.dependencies) {
				const depTask = taskMap.get(depId);
				if (depTask && depTask.status === "done") {
					warnings.push(`Task "${task.title}" depends on completed task "${depTask.title}"`);
				}
			}
		}

		// Check for dependency depth (potential infinite chains)
		const calculateDepth = (taskId: string, visited: Set<string> = new Set()): number => {
			if (visited.has(taskId)) return 0; // Prevent infinite recursion
			visited.add(taskId);

			const task = taskMap.get(taskId);
			if (!task || task.dependencies.length === 0) return 0;

			let maxDepth = 0;
			for (const depId of task.dependencies) {
				maxDepth = Math.max(maxDepth, calculateDepth(depId, new Set(visited)));
			}

			return maxDepth + 1;
		};

		for (const task of tasks) {
			const depth = calculateDepth(task.id);
			if (depth > 10) {
				warnings.push(
					`Task "${task.title}" has a deep dependency chain (${depth} levels), which may indicate complex dependencies`,
				);
			}
		}

		return {
			isValid: errors.length === 0,
			errors,
			warnings,
		};
	}

	// Get tasks sorted by dependencies and priority
	async getTasksSortedByDependencies(): Promise<Task[]> {
		const allTasks = await this.getAllTasks();
		const todoTasks = allTasks.filter((task) => task.status === "todo");

		if (todoTasks.length === 0) {
			return [];
		}

		// Validate dependencies
		const validation = this.validateDependencies(todoTasks);
		if (!validation.isValid) {
			console.error("[DEPENDENCY] Validation failed:");
			validation.errors.forEach((error) => {
				console.error(`  - ${error}`);
			});
			if (validation.warnings.length > 0) {
				console.warn("[DEPENDENCY] Warnings:");
				validation.warnings.forEach((warning) => {
					console.warn(`  - ${warning}`);
				});
			}
			// Fallback to priority-based sorting if dependency validation fails
			return todoTasks.sort((a, b) => {
				const priorityOrder = { high: 3, medium: 2, low: 1 };
				return priorityOrder[b.priority] - priorityOrder[a.priority];
			});
		} else if (validation.warnings.length > 0) {
			console.warn("[DEPENDENCY] Validation warnings:");
			validation.warnings.forEach((warning) => {
				console.warn(`  - ${warning}`);
			});
		}

		// Sort using topological sort
		try {
			return this.topologicalSort(todoTasks);
		} catch (error) {
			console.error("[DEPENDENCY] Topological sort failed:", error);
			// Fallback to priority-based sorting
			return todoTasks.sort((a, b) => {
				const priorityOrder = { high: 3, medium: 2, low: 1 };
				return priorityOrder[b.priority] - priorityOrder[a.priority];
			});
		}
	}

	// Template Management Methods

	// Get template manager instance
	getTemplateManager(): TemplateManager {
		return this.templateManager;
	}

	// Create task from template
	async createTaskFromTemplate(
		input: CreateTaskFromTemplateInput,
	): Promise<{ mainTask: Task; subtasks: Task[] }> {
		return await this.templateManager.createTaskFromTemplate(input, this.createTask.bind(this));
	}

	// Initialize predefined templates
	async initializeTemplates(): Promise<void> {
		await this.templateManager.createPredefinedTemplates();
		await this.loadAutomationRules();
		console.log("[PRODUCT-MANAGER] Template and automation system initialized successfully");
	}

	// Profile management methods for API access

	// Get all profile states
	getAllProfileStates(): ProfileState[] {
		return this.profileManager.getAllProfileStates();
	}

	// Get specific profile state
	getProfileState(name: string): ProfileState | undefined {
		return this.profileManager.getProfileState(name);
	}

	// Get all profile metrics
	getAllProfileMetrics(): Map<string, ProfileMetrics> {
		return this.profileManager.getAllProfileMetrics();
	}

	// Get specific profile metrics
	getProfileMetrics(name: string): ProfileMetrics | undefined {
		return this.profileManager.getProfileMetrics(name);
	}

	// Get profile task queue
	getProfileTaskQueue(name: string): unknown[] {
		return this.profileManager.getTaskQueue(name);
	}

	// Get all profiles with their states
	getProfilesWithStates(): Array<{
		profile: ACPProfile;
		state: ProfileState | undefined;
		metrics: ProfileMetrics | undefined;
	}> {
		const profiles = this.profileManager.getAllProfiles();
		return profiles.map((profile) => ({
			profile,
			state: this.profileManager.getProfileState(profile.name),
			metrics: this.profileManager.getProfileMetrics(profile.name),
		}));
	}

	// Update profile active status
	updateProfileStatus(name: string, isActive: boolean): boolean {
		try {
			this.profileManager.updateProfileState(name, { isActive });
			console.log(`[PROFILE] Updated ${name} active status to: ${isActive}`);
			return true;
		} catch (error) {
			console.error(`[PROFILE] Failed to update ${name} status:`, error);
			return false;
		}
	}

	// Get best profile for a task
	getBestProfileForTask(task: Task): ACPProfile | undefined {
		return this.profileManager.getBestProfileForTask(task);
	}

	// Assign task to specific profile
	assignTaskToProfile(profileName: string, task: Task): boolean {
		try {
			this.profileManager.addToTaskQueue(profileName, task);
			console.log(`[PROFILE] Assigned task "${task.title}" to profile: ${profileName}`);
			return true;
		} catch (error) {
			console.error(`[PROFILE] Failed to assign task to ${profileName}:`, error);
			return false;
		}
	}

	// Advanced search functionality
	async searchTasks(query: import("./types.ts").SearchQuery): Promise<import("./types.ts").SearchResult> {
		await this.ensureDbOpen();
		
		const allTasks = await this.getAllTasks();
		let filteredTasks = [...allTasks];

		// Apply filters
		if (query.status && query.status.length > 0) {
			filteredTasks = filteredTasks.filter(task => query.status!.includes(task.status));
		}

		if (query.priority && query.priority.length > 0) {
			filteredTasks = filteredTasks.filter(task => query.priority!.includes(task.priority));
		}

		if (query.type && query.type.length > 0) {
			filteredTasks = filteredTasks.filter(task => query.type!.includes(task.type));
		}

		if (query.assignedTo && query.assignedTo.length > 0) {
			filteredTasks = filteredTasks.filter(task => 
				task.assignedTo && query.assignedTo!.includes(task.assignedTo)
			);
		}

		if (query.createdBy && query.createdBy.length > 0) {
			filteredTasks = filteredTasks.filter(task => 
				query.createdBy!.includes(task.createdBy)
			);
		}

		if (query.collaborators && query.collaborators.length > 0) {
			filteredTasks = filteredTasks.filter(task => 
				task.collaborators && task.collaborators.some(col => query.collaborators!.includes(col))
			);
		}

		if (query.watchers && query.watchers.length > 0) {
			filteredTasks = filteredTasks.filter(task => 
				task.watchers && task.watchers.some(watcher => query.watchers!.includes(watcher))
			);
		}

		if (query.dateFrom) {
			const fromDate = new Date(query.dateFrom);
			filteredTasks = filteredTasks.filter(task => new Date(task.createdAt) >= fromDate);
		}

		if (query.dateTo) {
			const toDate = new Date(query.dateTo);
			filteredTasks = filteredTasks.filter(task => new Date(task.createdAt) <= toDate);
		}

		if (query.updatedFrom) {
			const fromDate = new Date(query.updatedFrom);
			filteredTasks = filteredTasks.filter(task => new Date(task.updatedAt) >= fromDate);
		}

		if (query.updatedTo) {
			const toDate = new Date(query.updatedTo);
			filteredTasks = filteredTasks.filter(task => new Date(task.updatedAt) <= toDate);
		}

		if (query.dependencies && query.dependencies.length > 0) {
			filteredTasks = filteredTasks.filter(task => 
				query.dependencies!.some(dep => task.dependencies.includes(dep))
			);
		}

		if (query.hasDependencies !== undefined) {
			filteredTasks = filteredTasks.filter(task => 
				query.hasDependencies ? task.dependencies.length > 0 : task.dependencies.length === 0
			);
		}

		// Apply text search with relevance scoring
		let searchResults: {
			task: import("./types.ts").Task;
			score: number;
			matches?: { title: number[]; description: number[] };
		}[];

		if (query.q && query.q.trim().length > 0) {
			searchResults = this.performTextSearch(filteredTasks, query.q);
		} else {
			searchResults = filteredTasks.map(task => ({ task, score: 0 }));
		}

		// Apply sorting
		if (query.sort) {
			searchResults = this.sortSearchResults(searchResults, query.sort);
		} else {
			// Default sort: relevance (if search query) then priority then creation date
			searchResults.sort((a, b) => {
				if (query.q && query.q.trim().length > 0) {
					if (a.score !== b.score) return b.score - a.score;
				}
				const priorityOrder = { high: 3, medium: 2, low: 1 };
				const priorityDiff = priorityOrder[b.task.priority] - priorityOrder[a.task.priority];
				if (priorityDiff !== 0) return priorityDiff;
				return new Date(b.task.createdAt).getTime() - new Date(a.task.createdAt).getTime();
			});
		}

		// Apply pagination
		const total = searchResults.length;
		const offset = query.offset || 0;
		const limit = query.limit || 50;
		const paginatedResults = searchResults.slice(offset, offset + limit);

		// Prepare highlights
		const highlights: Record<string, { titleMatches?: number[]; descriptionMatches?: number[] }> = {};
		paginatedResults.forEach(result => {
			if (result.matches) {
				highlights[result.task.id] = {
					titleMatches: result.matches.title,
					descriptionMatches: result.matches.description,
				};
			}
		});

		// Generate facets
		const facets = this.generateSearchFacets(allTasks, filteredTasks);

		// Generate suggestions based on query
		const suggestions = this.generateSearchSuggestions(query.q, allTasks);

		return {
			tasks: paginatedResults.map(result => result.task),
			total,
			query,
			highlights: Object.keys(highlights).length > 0 ? highlights : undefined,
			facets,
			suggestions: suggestions.length > 0 ? suggestions : undefined,
		};
	}

	private performTextSearch(
		tasks: import("./types.ts").Task[],
		query: string
	): {
		task: import("./types.ts").Task;
		score: number;
		matches?: { title: number[]; description: number[] };
	}[] {
		const searchTerms = query
			.toLowerCase()
			.split(/\s+/)
			.filter(term => term.length > 0);

		return tasks
			.map(task => {
				const title = task.title.toLowerCase();
				const description = task.description.toLowerCase();

				let score = 0;
				const titleMatches: number[] = [];
				const descriptionMatches: number[] = [];

				searchTerms.forEach(term => {
					// Title matches (higher weight)
					let titleIndex = title.indexOf(term);
					while (titleIndex !== -1) {
						score += 10; // Title matches get 10 points
						titleMatches.push(titleIndex);
						titleIndex = title.indexOf(term, titleIndex + 1);
					}

					// Description matches (lower weight)
					let descIndex = description.indexOf(term);
					while (descIndex !== -1) {
						score += 5; // Description matches get 5 points
						descriptionMatches.push(descIndex);
						descIndex = description.indexOf(term, descIndex + 1);
					}
				});

				// Exact phrase match bonus
				if (title.includes(query.toLowerCase()) || description.includes(query.toLowerCase())) {
					score += 20;
				}

				// Priority bonus
				if (task.priority === "high") score += 2;
				else if (task.priority === "medium") score += 1;

				// Recent task bonus (created in last 7 days)
				const weekAgo = new Date();
				weekAgo.setDate(weekAgo.getDate() - 7);
				if (new Date(task.createdAt) > weekAgo) score += 1;

				const result: {
					task: import("./types.ts").Task;
					score: number;
					matches?: { title: number[]; description: number[] };
				} = {
					task,
					score,
				};

				if (titleMatches.length > 0 || descriptionMatches.length > 0) {
					result.matches = {
						title: titleMatches,
						description: descriptionMatches,
					};
				}

				return result;
			})
			.filter(result => result.score > 0)
			.sort((a, b) => b.score - a.score);
	}

	private sortSearchResults(
		results: {
			task: import("./types.ts").Task;
			score: number;
			matches?: { title: number[]; description: number[] };
		}[], 
		sort: import("./types.ts").SearchSort
	): typeof results {
		const { field, direction } = sort;
		const multiplier = direction === "asc" ? 1 : -1;

		return results.sort((a, b) => {
			let comparison = 0;

			switch (field) {
				case "relevance":
					comparison = a.score - b.score;
					break;
				case "title":
					comparison = a.task.title.localeCompare(b.task.title);
					break;
				case "createdAt":
					comparison = new Date(a.task.createdAt).getTime() - new Date(b.task.createdAt).getTime();
					break;
				case "updatedAt":
					comparison = new Date(a.task.updatedAt).getTime() - new Date(b.task.updatedAt).getTime();
					break;
				case "priority": {
					const priorityOrder = { high: 3, medium: 2, low: 1 };
					comparison = priorityOrder[a.task.priority] - priorityOrder[b.task.priority];
					break;
				}
				case "status": {
					const statusOrder = { "todo": 1, "in-progress": 2, "done": 3 };
					comparison = statusOrder[a.task.status] - statusOrder[b.task.status];
					break;
				}
			}

			return comparison * multiplier;
		});
	}

	private generateSearchFacets(
		allTasks: import("./types.ts").Task[],
		filteredTasks: import("./types.ts").Task[]
	): import("./types.ts").SearchFacets {
		const statusCounts: Record<import("./types.ts").TaskStatus, number> = {
			"todo": 0,
			"in-progress": 0,
			"done": 0,
		};

		const priorityCounts: Record<import("./types.ts").Task["priority"], number> = {
			"low": 0,
			"medium": 0,
			"high": 0,
		};

		const typeCounts: Record<import("./types.ts").TaskType, number> = {
			"theme": 0,
			"initiative": 0,
			"feature": 0,
			"story": 0,
			"task": 0,
			"implementation": 0,
			"integration": 0,
			"testing": 0,
			"research": 0,
		};

		const assignedToCounts: Record<string, number> = {};
		const createdByCounts: Record<string, number> = {};

		filteredTasks.forEach(task => {
			statusCounts[task.status]++;
			priorityCounts[task.priority]++;
			typeCounts[task.type]++;
			
			if (task.assignedTo) {
				assignedToCounts[task.assignedTo] = (assignedToCounts[task.assignedTo] || 0) + 1;
			}
			
			createdByCounts[task.createdBy] = (createdByCounts[task.createdBy] || 0) + 1;
		});

		return {
			status: statusCounts,
			priority: priorityCounts,
			type: typeCounts,
			assignedTo: assignedToCounts,
			createdBy: createdByCounts,
		};
	}

	generateSearchSuggestions(query: string | undefined, tasks: import("./types.ts").Task[]): string[] {
		if (!query || query.trim().length < 2) return [];

		const suggestions = new Set<string>();
		const queryLower = query.toLowerCase();

		// Extract words from task titles and descriptions
		tasks.forEach(task => {
			const titleWords = task.title.toLowerCase().split(/\s+/);
			const descWords = task.description.toLowerCase().split(/\s+/);

			[...titleWords, ...descWords].forEach(word => {
				if (word.includes(queryLower) && word.length > queryLower.length) {
					suggestions.add(word);
				}
			});
		});

		return Array.from(suggestions).slice(0, 10); // Limit to 10 suggestions
	}

	// Saved searches functionality
	private async ensureSavedSearchesDbOpen(): Promise<void> {
		try {
			await savedSearchesDb.open();
		} catch (error) {
			console.error("[SAVED_SEARCHES_DB] Failed to open database:", error);
			throw error;
		}
	}

	async createSavedSearch(input: import("./types.ts").CreateSavedSearchInput, createdBy: string): Promise<import("./types.ts").SavedSearch> {
		await this.ensureSavedSearchesDbOpen();

		const id = `saved-search-${Date.now()}`;
		const savedSearch: import("./types.ts").SavedSearch = {
			id,
			name: input.name,
			description: input.description,
			query: input.query,
			createdBy,
			isPublic: input.isPublic || false,
			createdAt: new Date(),
			updatedAt: new Date(),
			usageCount: 0,
		};

		await savedSearchesDb.put(id, savedSearch);
		console.log(`[SAVED_SEARCHES_DB] Created saved search: ${id}`);
		return savedSearch;
	}

	async getSavedSearches(userId?: string): Promise<import("./types.ts").SavedSearch[]> {
		await this.ensureSavedSearchesDbOpen();

		const searches: import("./types.ts").SavedSearch[] = [];
		const iterator = savedSearchesDb.iterator();

		try {
			for await (const [, value] of iterator) {
				// Include public searches or user's own searches
				if (value.isPublic || (userId && value.createdBy === userId)) {
					searches.push(value);
				}
			}
		} catch (error) {
			console.error("[SAVED_SEARCHES_DB] Error reading saved searches:", error);
			throw error;
		} finally {
			try {
				await iterator.close();
			} catch (closeError) {
				console.error("[SAVED_SEARCHES_DB] Error closing iterator:", closeError);
			}
		}

		return searches.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
	}

	async getSavedSearch(id: string, userId?: string): Promise<import("./types.ts").SavedSearch | null> {
		await this.ensureSavedSearchesDbOpen();

		try {
			const savedSearch = await savedSearchesDb.get(id);

			// Check access permissions
			if (!savedSearch.isPublic && (!userId || savedSearch.createdBy !== userId)) {
				return null;
			}

			// Increment usage count
			savedSearch.usageCount++;
			savedSearch.updatedAt = new Date();
			await savedSearchesDb.put(id, savedSearch);

			return savedSearch;
		} catch (_error) {
			void _error;
			return null;
		}
	}

	async updateSavedSearch(input: import("./types.ts").UpdateSavedSearchInput, userId: string): Promise<import("./types.ts").SavedSearch> {
		await this.ensureSavedSearchesDbOpen();

		const existingSearch = await savedSearchesDb.get(input.id).catch(() => null);
		if (!existingSearch) {
			throw new Error("Saved search not found");
		}

		if (existingSearch.createdBy !== userId) {
			throw new Error("Not authorized to update this saved search");
		}

		const updatedSearch: import("./types.ts").SavedSearch = {
			...existingSearch,
			...(input.name && { name: input.name }),
			...(input.description !== undefined && { description: input.description }),
			...(input.query && { query: input.query }),
			...(input.isPublic !== undefined && { isPublic: input.isPublic }),
			updatedAt: new Date(),
		};

		await savedSearchesDb.put(input.id, updatedSearch);
		console.log(`[SAVED_SEARCHES_DB] Updated saved search: ${input.id}`);
		return updatedSearch;
	}

	async deleteSavedSearch(id: string, userId: string): Promise<void> {
		await this.ensureSavedSearchesDbOpen();

		const existingSearch = await savedSearchesDb.get(id).catch(() => null);
		if (!existingSearch) {
			throw new Error("Saved search not found");
		}

		if (existingSearch.createdBy !== userId) {
			throw new Error("Not authorized to delete this saved search");
		}

		await savedSearchesDb.del(id);
		console.log(`[SAVED_SEARCHES_DB] Deleted saved search: ${id}`);
	}

	// Archive management methods
	
	// Initialize archive service
	async initializeArchiveService(): Promise<void> {
		try {
			await this.archiveService.initialize();
			console.log("[PRODUCT-MANAGER] Archive service initialized");
		} catch (error) {
			console.error("[PRODUCT-MANAGER] Failed to initialize archive service:", error);
			throw error;
		}
	}

	// Archive a task
	async archiveTask(taskId: string, reason: string, archivedBy: string, options?: {
		retentionPolicyId?: string;
		tags?: string[];
	}): Promise<import("./services/archive-service.ts").ArchivedTask> {
		try {
			const archivedTask = await this.archiveService.archiveTask(taskId, reason, archivedBy, options);
			
			// Broadcast task archived event
			if (this.wsManager) {
				this.wsManager.broadcast({
					type: "task_archived",
					timestamp: new Date(),
					data: {
						taskId,
						reason,
						archivedBy,
						archivedAt: archivedTask.archivedAt,
					},
				});
			}
			
			return archivedTask;
		} catch (error) {
			console.error(`[PRODUCT-MANAGER] Failed to archive task ${taskId}:`, error);
			throw error;
		}
	}

	// Restore an archived task
	async restoreTask(archivedTaskId: string, restoredBy: string): Promise<Task> {
		try {
			const restoredTask = await this.archiveService.restoreTask(archivedTaskId, restoredBy);
			
			// Broadcast task restored event
			if (this.wsManager) {
				this.wsManager.broadcast({
					type: "task_restored",
					timestamp: new Date(),
					data: {
						taskId: restoredTask.id,
						restoredBy,
						restoredAt: new Date().toISOString(),
					},
				});
			}
			
			return restoredTask;
		} catch (error) {
			console.error(`[PRODUCT-MANAGER] Failed to restore task ${archivedTaskId}:`, error);
			throw error;
		}
	}

	// Create retention policy
	async createRetentionPolicy(policy: Omit<import("./services/archive-service.ts").RetentionPolicy, "id" | "createdAt" | "updatedAt">): Promise<import("./services/archive-service.ts").RetentionPolicy> {
		try {
			return await this.archiveService.createRetentionPolicy(policy);
		} catch (error) {
			console.error("[PRODUCT-MANAGER] Failed to create retention policy:", error);
			throw error;
		}
	}

	// Get retention policies
	async getRetentionPolicies(): Promise<import("./services/archive-service.ts").RetentionPolicy[]> {
		try {
			return await this.archiveService.getRetentionPolicyList();
		} catch (error) {
			console.error("[PRODUCT-MANAGER] Failed to get retention policies:", error);
			throw error;
		}
	}

	// Execute retention policy
	async executeRetentionPolicy(policyId: string, executedBy: string): Promise<{
		archived: import("./services/archive-service.ts").ArchivedTask[];
		deleted: string[];
		flagged: string[];
	}> {
		try {
			const result = await this.archiveService.executeRetentionPolicy(policyId, executedBy);
			
			// Broadcast policy execution event
			if (this.wsManager) {
				this.wsManager.broadcast({
					type: "retention_policy_executed",
					timestamp: new Date(),
					data: {
						policyId,
						executedBy,
						result: {
							archivedCount: result.archived.length,
							deletedCount: result.deleted.length,
							flaggedCount: result.flagged.length,
						},
					},
				});
			}
			
			return result;
		} catch (error) {
			console.error(`[PRODUCT-MANAGER] Failed to execute retention policy ${policyId}:`, error);
			throw error;
		}
	}

	// Search archived tasks
	async searchArchivedTasks(query: {
		text?: string;
		archivedBy?: string;
		dateFrom?: Date;
		dateTo?: Date;
		retentionPolicyId?: string;
		originalStatus?: import("./types.ts").TaskStatus;
	}): Promise<import("./services/archive-service.ts").ArchivedTask[]> {
		try {
			return await this.archiveService.searchArchivedTasks(query);
		} catch (error) {
			console.error("[PRODUCT-MANAGER] Failed to search archived tasks:", error);
			throw error;
		}
	}

	// Get archive statistics
	async getArchiveStats(): Promise<import("./services/archive-service.ts").ArchiveStats> {
		try {
			return await this.archiveService.getArchiveStats();
		} catch (error) {
			console.error("[PRODUCT-MANAGER] Failed to get archive stats:", error);
			throw error;
		}
	}

	// Cleanup old archived tasks
	async cleanupOldArchivedTasks(olderThanDays: number): Promise<string[]> {
		try {
			const deletedIds = await this.archiveService.cleanupOldArchivedTasks(olderThanDays);
			
			console.log(`[PRODUCT-MANAGER] Cleaned up ${deletedIds.length} old archived tasks`);
			return deletedIds;
		} catch (error) {
			console.error("[PRODUCT-MANAGER] Failed to cleanup old archived tasks:", error);
			throw error;
		}
	}

	// Export archived tasks
	async exportArchivedTasks(format: "json" | "csv" = "json"): Promise<string | Buffer> {
		try {
			return await this.archiveService.exportArchivedTasks(format);
		} catch (error) {
			console.error("[PRODUCT-MANAGER] Failed to export archived tasks:", error);
			throw error;
		}
	}
}
