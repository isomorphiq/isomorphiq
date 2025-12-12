import path from "node:path";
import { Effect } from "effect";
import { Level } from "level";
import { ACPConnectionManager } from "./acp-connection.ts";
import {
	type ACPProfile,
	ProfileManager,
	type ProfileMetrics,
	type ProfileState,
} from "./acp-profiles.ts";
import { startAcpSession, type AcpSession } from "./acp-session.ts";
import { AutomationRuleEngine } from "./automation-rule-engine.ts";
import { acpCleanupEffect } from "./effects/acp-cleanup.ts";
import { acpTurnEffect } from "./effects/acp-turn.ts";
import { gitCommitIfChanges } from "./git-utils.ts";
import { runLintAndTests } from "./run-tests.ts";
import { TemplateManager } from "./template-manager.ts";
import type { CreateTaskFromTemplateInput, Task } from "./types.ts";
import type { TaskStatus, TaskType, WebSocketEventType } from "./types.ts";
import { buildWorkflowWithEffects } from "./workflow.ts";
import { advanceToken, createToken } from "./workflow-engine.ts";
import type { WebSocketManager } from "./websocket-server.ts";

// Initialize LevelDB
const dbPath = path.join(process.cwd(), "db");
const db = new Level<string, Task>(dbPath, { valueEncoding: "json" });

// Product Manager class to handle task operations
export class ProductManager {
	private profileManager: ProfileManager;
	private templateManager: TemplateManager;
	private automationEngine: AutomationRuleEngine;
	private dbReady = false;
	private wsManager: WebSocketManager | null = null;

	private async ensureDbOpen(): Promise<void> {
		if (this.dbReady) return;
		try {
			await db.open();
			this.dbReady = true;
			console.log("[DB] Database opened successfully");
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

	// Setup automation engine with event handlers
	private setupAutomationEngine(): void {
		// Register event handlers for automation
		this.automationEngine.onTaskEvent(
			async (eventType: WebSocketEventType, data: Record<string, unknown>) => {
				console.log(`[AUTOMATION] Received task event: ${eventType}`);

				switch (eventType) {
					case "task_created":
						if (data.title && data.description) {
							await this.createTask(
								data.title as string,
								data.description as string,
								(data.priority as "low" | "medium" | "high") || "medium",
								(data.dependencies as string[]) || [],
								data.createdBy as string | undefined,
								data.assignedTo as string | undefined,
							);
						}
						break;
					case "task_updated":
						if (data.taskId && data.updates) {
							await this.handleTaskUpdate(
								data.taskId as string,
								data.updates as Record<string, unknown>,
							);
						}
						break;
					case "task_priority_changed":
						if (data.taskId && data.newPriority) {
							await this.updateTaskPriority(
								data.taskId as string,
								data.newPriority as "low" | "medium" | "high",
							);
						}
						break;
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
		let iterator:
			| (AsyncIterableIterator<[string, Task]> & { close: () => Promise<void> })
			| undefined;
		try {
			iterator = db.iterator() as unknown as AsyncIterableIterator<[string, Task]> & {
				close: () => Promise<void>;
			};
			for await (const [, value] of iterator) {
				// Normalize missing fields (legacy tasks may lack dependencies)
				const raw = value as Partial<Task>;
				tasks.push({
					...(raw as Task),
					dependencies: Array.isArray(raw.dependencies) ? raw.dependencies : [],
					priority: raw.priority || "medium",
					status: raw.status || "todo",
					type: raw.type || "task",
				});
			}
		} catch (error) {
			console.error("[DB] Error reading tasks:", error);
			throw error;
		} finally {
			if (iterator) {
				try {
					await iterator.close();
				} catch (closeError) {
					console.error("[DB] Error closing iterator:", closeError);
				}
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

	// Update task priority
	async updateTaskPriority(id: string, priority: "low" | "medium" | "high"): Promise<Task> {
		// Ensure database is open
		if (!this.dbReady) {
			await db.open();
			this.dbReady = true;
		}

		const task = await db.get(id);
		const oldPriority = task.priority;
		task.priority = priority;
		task.updatedAt = new Date();
		await db.put(id, task);

		// Process automation rules for priority change
		const allTasks = await this.getAllTasks();
		const automationResults = await this.automationEngine.processTaskEvent(
			"task_priority_changed",
			{
				taskId: id,
				oldPriority,
				newPriority: priority,
				task,
			},
			allTasks,
		);
		if (automationResults.length > 0) {
			console.log(
				`[AUTOMATION] Processed ${automationResults.length} automation rules for priority change`,
			);
		}

		// Broadcast priority change to WebSocket clients
		if (this.wsManager) {
			this.wsManager.broadcastTaskPriorityChanged(id, oldPriority, priority, task);
		}

		return task;
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
		const _oldAssignedTo = task.assignedTo;
		task.assignedTo = assignedTo;
		task.updatedAt = new Date();
		await db.put(id, task);

		// Broadcast assignment change to WebSocket clients
		if (this.wsManager) {
			this.wsManager.broadcastTaskAssigned(task, assignedTo, assignedBy || "system");
		}

		return task;
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
		const _oldCollaborators = task.collaborators || [];
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
		const _oldWatchers = task.watchers || [];
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

		const taskContext = context.task as { id?: string } | undefined;
		const currentTaskId = taskContext?.id ?? (context.taskId as string | undefined) ?? "n/a";
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
			const errorMsg = `Task execution failed: ACP connection failed: ${(error as Error).message}`;
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
			const errorMsg = `Task execution failed: ACP connection failed: ${(error as Error).message}`;
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
		try {
			// Create ACP connection
			connectionResult = await ACPConnectionManager.createConnection();

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
			const profile = this.profileManager.getProfile(profileName);

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
			const session = await startAcpSession(profile, { state: token.state });
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

		const runTestsEffect = (payload?: { token?: typeof token }) =>
			Effect.promise(async () => {
				const res = await runLintAndTests();
				if (payload?.token) {
					if (!payload.token.context) payload.token.context = {};
					payload.token.context.lastTestResult = res;
				}
				if (!res.passed) {
					const summary = [
						res.lintPassed ? "lint:pass" : "lint:fail",
						res.testPassed ? "tests:pass" : "tests:fail",
					].join(" ");
					console.log(`[TESTS] failed -> ${summary}`);
					// Do not throw; allow workflow to advance to tests-completed and let the decider route to tests-failed.
					return res;
				}
				console.log("[TESTS] passed");
				return res;
			});

		const workflow = buildWorkflowWithEffects({
			"new-feature-proposed": {
				"retry-product-research": () =>
					Effect.gen(function* () {
						const eff = acpEffect(
							"product-manager",
							`Generate exactly ONE Feature ticket.
- Title should read like a feature request (avoid story/task phrasing).
- Include: description, user value, acceptance criteria, priority.
- Do NOT output stories or tasks here.`,
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
				"run-tests": (payload) =>
					Effect.catchAll(runTestsEffect(payload), (err) =>
						Effect.sync(() => {
							console.error("[TESTS] run-tests effect failed", err);
						}),
					),
				"refine-task": acpEffect(
					"refinement",
					"No actionable task; request refinement or split work.",
				),
			},
			"tests-completed": {
				"tests-passing": (_payload) =>
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
							"Tests passed. Confirm readiness and summarize what was validated.",
						)();
					}),
				"tests-failed": (payload) =>
					(() => {
						const ctxPayload = payload as { token?: typeof token } | undefined;
						const lastOutput = (
							ctxPayload?.token?.context?.lastTestResult as { output?: string } | undefined
						)?.output;
						return acpEffect(
							"qa-specialist",
							`Tests failed. Here is the output:\n${lastOutput ?? "No output"}\nPropose fixes and plan next steps.`,
						)();
					})(),
			},
			"task-completed": {
				"pick-up-next-task": acpEffect(
					"development",
					"Task closed. Announce completion and request next task.",
				),
				"research-new-features": acpEffect(
					"product-manager",
					"Identify new feature opportunities now that a task was delivered.",
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

				if (token.state === "tests-completed") {
					const lastResult = token.context?.lastTestResult as { passed?: boolean } | undefined;
					const passed = lastResult?.passed === true;
					transition = passed ? "tests-passing" : "tests-failed";
				}

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
				const errObj = error as { code?: string; cause?: { code?: string } };
				const code = errObj.code || errObj.cause?.code;
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
}
