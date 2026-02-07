// TODO: This file is too complex (2238 lines) and should be refactored into several modules.
// Current concerns mixed: Process spawning, TCP server, HTTP server, environment management,
// task processing, service initialization, command handling.
// 
// Proposed structure:
// - daemon/tcp-server.ts - TCP command server and protocol handling
// - daemon/http-server.ts - HTTP API endpoints
// - daemon/process-manager.ts - Child process spawning and management
// - daemon/environment-manager.ts - Environment service lifecycle
// - daemon/task-processor.ts - Task execution and workflow orchestration
// - daemon/service-factory.ts - Service initialization and dependency injection
// - daemon/command-handlers/ - Individual command handler modules
// - daemon/types.ts - Core daemon types and interfaces
// - daemon/index.ts - Main daemon composition and startup

import { spawn } from "node:child_process";
import http from "node:http";
import { createServer, type Socket } from "node:net";
import path from "node:path";
import { ProductManager } from "@isomorphiq/profiles";
import { getUserManager } from "@isomorphiq/auth";
import { WebSocketManager } from "@isomorphiq/realtime";
import { startHttpServer } from "@isomorphiq/http-server";
import type { Result } from "@isomorphiq/core";
import { ConfigManager, resolveEnvironmentFromHeaders, resolveEnvironmentValue } from "@isomorphiq/core";
import { ProfileManager } from "@isomorphiq/profiles";
import type { TaskServiceApi } from "@isomorphiq/tasks";
import {
    createNotificationsClient,
    type NotificationsClient,
} from "@isomorphiq/notifications";
import { createWorkflowAgentRunner } from "@isomorphiq/workflow/agent-runner";
import { ProfileWorkflowRunner } from "@isomorphiq/workflow";
import { startMcpServer } from "@isomorphiq/mcp";
import {
	DashboardAnalyticsService,
	DashboardServer,
	ProgressTrackingService,
	TaskAuditService,
} from "@isomorphiq/dashboard";
import { TaskMonitor } from "./services/task-monitor.ts";
import { TaskScheduler } from "./services/scheduler.ts";
import { DependencyGraphService } from "./services/dependency-graph.ts";
import { RecommendationAnalyticsService } from "./services/recommendation-analytics-service.ts";

type EnvironmentServices = {
	environment: string;
	productManager: ProductManager;
	taskManager: TaskServiceApi;
	workflowRunner: ProfileWorkflowRunner;
	webSocketManager: WebSocketManager;
	taskMonitor: TaskMonitor;
	notificationClient: NotificationsClient;
	taskScheduler: TaskScheduler;
	taskAuditService: TaskAuditService;
	progressTrackingService: ProgressTrackingService;
	analyticsService: DashboardAnalyticsService;
	recommendationService: RecommendationAnalyticsService;
};

const extractMentions = (text: string): string[] => {
	const mentionRegex = /@(\w+)/g;
	const mentions: string[] = [];
	let match: RegExpExecArray | null;
	while ((match = mentionRegex.exec(text)) !== null) {
		mentions.push(match[1]);
	}
	return mentions;
};

const isLevelLockedError = (error: unknown): boolean => {
	if (!error || typeof error !== "object") {
		return false;
	}
	const record = error as Record<string, unknown>;
	const code = record.code;
	if (code === "LEVEL_LOCKED") {
		return true;
	}
	const cause = record.cause as Record<string, unknown> | undefined;
	if (cause && cause.code === "LEVEL_LOCKED") {
		return true;
	}
	return false;
};

// Task Manager Daemon - runs the continuous task processing loop and handles MCP requests
async function main() {
	console.log("[DAEMON] Starting Isomorphiq Task Manager Daemon");

	const configManager = ConfigManager.getInstance();
	const environmentConfig = configManager.getEnvironmentConfig();
	const environmentNames = Array.from(new Set(environmentConfig.available));
	const profileManager = new ProfileManager();
    await profileManager.waitForProfileOverrides();
	const workflowRunner = createWorkflowAgentRunner({ profileManager });
	const userManager = getUserManager();

	const basePath = configManager.getDatabaseConfig().path;
	const absoluteBase = path.isAbsolute(basePath) ? basePath : path.join(process.cwd(), basePath);

	const resolveDatabasePath = (environment: string): string => {
		return path.join(absoluteBase, environment);
	};

	const createEnvironmentServices = async (environment: string): Promise<EnvironmentServices> => {
		const databasePath = resolveDatabasePath(environment);
		const productManager = new ProductManager(databasePath, { environment });
		const workflowRunnerInstance = new ProfileWorkflowRunner({
			taskProvider: () => productManager.getAllTasks(),
			taskExecutor: workflowRunner.executeTask,
			environment,
			updateTaskStatus: async (id, status, updatedBy) => {
				await productManager.updateTaskStatus(id, status, updatedBy);
			},
            appendTaskActionLogEntry: async (taskId, entry, fallbackLog) => {
                const task = await productManager.getTask(taskId);
                const currentLog = task?.actionLog ?? fallbackLog ?? [];
                await productManager.updateTask(
                    taskId,
                    { actionLog: [...currentLog, entry] },
                    "workflow",
                );
            },
		});
		const webSocketManager = new WebSocketManager({ path: "/ws" });
		const taskMonitor = new TaskMonitor();
        const notificationClient = createNotificationsClient({ environment });

		const taskScheduler = new TaskScheduler(productManager);
		await taskScheduler.initialize();

		const taskAuditService = new TaskAuditService(path.join(databasePath, "task-audit"));
		await taskAuditService.initialize();

		const progressTrackingService = new ProgressTrackingService(taskAuditService);
		await progressTrackingService.initialize();

		const dashboardAnalyticsService = new DashboardAnalyticsService(productManager.taskService, taskAuditService);
		await dashboardAnalyticsService.initialize();
		const recommendationService = new RecommendationAnalyticsService(productManager);
		await recommendationService.initialize();

		productManager.setWebSocketManager(webSocketManager);
		await productManager.initialize();

		return {
			environment,
			productManager,
			taskManager: productManager.taskService,
			workflowRunner: workflowRunnerInstance,
			webSocketManager,
			taskMonitor,
            notificationClient,
			taskScheduler,
			taskAuditService,
			progressTrackingService,
			analyticsService: dashboardAnalyticsService,
			recommendationService,
		};
	};

	const environmentServices = new Map<string, EnvironmentServices>();
	for (const environment of environmentNames) {
		try {
			const services = await createEnvironmentServices(environment);
			environmentServices.set(environment, services);
		} catch (error) {
			if (isLevelLockedError(error)) {
				console.warn(
					`[DAEMON] Database locked for ${environment}; another daemon may be running. Exiting.`,
				);
				return;
			}
			throw error;
		}
	}

	const defaultEnvironment = environmentConfig.default;
	const fallbackServices = environmentServices.get(defaultEnvironment)
		?? environmentServices.values().next().value;
	if (!fallbackServices) {
		throw new Error("No environments configured for daemon");
	}

	console.log(
		`[DAEMON] Initialized environments: ${Array.from(environmentServices.keys()).join(", ")}`,
	);

	const resolveEnvironmentFromRequest = (headers: http.IncomingHttpHeaders): string =>
		resolveEnvironmentFromHeaders(headers, environmentConfig);
	const resolveEnvironmentFromMessage = (message: Record<string, unknown>): string => {
		const direct = typeof message.environment === "string" ? message.environment : undefined;
		const dataEnv =
			typeof (message.data as { environment?: unknown } | undefined)?.environment === "string"
				? (message.data as { environment?: string }).environment
				: undefined;
		return resolveEnvironmentValue(direct ?? dataEnv, environmentConfig);
	};
	const resolveServices = (environment: string): EnvironmentServices =>
		environmentServices.get(environment) ?? fallbackServices;
	const resolveProcessingServices = (): EnvironmentServices[] => {
		const explicitRaw =
			process.env.ISOMORPHIQ_PROCESS_ENVIRONMENTS ?? process.env.PROCESS_ENVIRONMENTS;
		if (explicitRaw && explicitRaw.trim().length > 0) {
			const requested = explicitRaw
				.split(",")
				.map((value) => value.trim())
				.filter((value) => value.length > 0)
				.map((value) => resolveEnvironmentValue(value, environmentConfig));
			const resolved = requested
				.map((env) => environmentServices.get(env))
				.filter((service): service is EnvironmentServices => Boolean(service));
			if (resolved.length > 0) {
				return resolved;
			}
		}

		const processAll = process.env.ISOMORPHIQ_PROCESS_ALL_ENVIRONMENTS === "true";
		if (processAll) {
			return Array.from(environmentServices.values());
		}

		const targetRaw =
			process.env.ISOMORPHIQ_ENVIRONMENT
			?? process.env.DEFAULT_ENVIRONMENT
			?? environmentConfig.default;
		const target = resolveEnvironmentValue(targetRaw, environmentConfig);
		const service = environmentServices.get(target);
		return service ? [service] : [fallbackServices];
	};

	const startMcpHttpServer = async (): Promise<void> => {
		const transport =
			process.env.ISOMORPHIQ_MCP_TRANSPORT
			?? process.env.MCP_TRANSPORT
			?? "sse";
		if (transport !== "http" && transport !== "sse") {
			return;
		}
		const host =
			process.env.ISOMORPHIQ_MCP_HTTP_HOST
			?? process.env.MCP_HTTP_HOST
			?? "localhost";
		const portRaw =
			process.env.ISOMORPHIQ_MCP_HTTP_PORT
			?? process.env.MCP_HTTP_PORT
			?? "3100";
		const port = Number.parseInt(portRaw, 10);
		const pathValue =
			process.env.ISOMORPHIQ_MCP_HTTP_PATH
			?? process.env.MCP_HTTP_PATH
			?? "/mcp";
		const normalizedPath = pathValue.startsWith("/") ? pathValue : `/${pathValue}`;
		const resolvedPort = Number.isFinite(port) && port > 0 ? port : 3100;

		try {
			await startMcpServer({
				transport,
				host,
				port: resolvedPort,
				path: normalizedPath,
			});
			console.log(
				`[DAEMON] MCP ${transport.toUpperCase()} server listening on ${host}:${resolvedPort}${normalizedPath}`,
			);
		} catch (error) {
			console.error(`[DAEMON] MCP ${transport.toUpperCase()} server failed to start:`, error);
		}
	};

	const setupTaskMonitorHandlers = async (services: EnvironmentServices): Promise<void> => {
		const {
            environment,
            productManager,
            webSocketManager,
            taskMonitor,
            notificationClient,
        } = services;
		const existingTasks = await productManager.getAllTasks();
		console.log(`[DAEMON] Found ${existingTasks.length} existing tasks in ${environment} database`);

		taskMonitor.updateTaskCache(existingTasks);

		const sendTaskStatusNotifications = async (
			task: any,
			oldStatus: string,
			newStatus: string,
		): Promise<void> => {
			try {
				const recipients = [
					task.createdBy,
					task.assignedTo,
					...(task.collaborators || []),
					...(task.watchers || []),
				].filter(Boolean);

				const uniqueRecipients = [...new Set(recipients)];

				await notificationClient.notifyTaskStatusChanged({
                    task,
                    oldStatus,
                    newStatus,
                    recipients: uniqueRecipients,
                });

				const mentionedUsers = extractMentions(`${task.title} ${task.description}`);
				for (const mentionedUser of mentionedUsers) {
					await notificationClient.notifyMention({
                        task,
                        mentionedUsers: [mentionedUser],
                        mentionedBy: task.updatedBy || task.createdBy,
                    });
				}
			} catch (error) {
				console.error("[DAEMON] Error sending task status notifications:", error);
			}
		};

		const sendTaskCompletedNotifications = async (task: any): Promise<void> => {
			try {
				const recipients = [
					task.createdBy,
					task.assignedTo,
					...(task.collaborators || []),
					...(task.watchers || []),
				].filter(Boolean);

				const uniqueRecipients = [...new Set(recipients)];

				await notificationClient.notifyTaskCompleted({
                    task,
                    recipients: uniqueRecipients,
                });
			} catch (error) {
				console.error("[DAEMON] Error sending task completion notifications:", error);
			}
		};

		const sendDependencySatisfiedNotifications = async (completedTask: any): Promise<void> => {
			try {
				const allTasks = await productManager.getAllTasks();
				const dependentTasks = allTasks.filter((task) =>
					task.dependencies && task.dependencies.includes(completedTask.id) && task.status === "todo",
				);

				for (const dependentTask of dependentTasks) {
					const recipients = [
						dependentTask.createdBy,
						dependentTask.assignedTo,
						...(dependentTask.collaborators || []),
						...(dependentTask.watchers || []),
					].filter(Boolean);

					const uniqueRecipients = [...new Set(recipients)];

					await notificationClient.notifyDependencySatisfied({
                        taskId: completedTask.id,
                        dependentTaskId: dependentTask.id,
                        recipients: uniqueRecipients,
                    });
				}
			} catch (error) {
				console.error("[DAEMON] Error sending dependency satisfaction notifications:", error);
			}
		};

		taskMonitor.on("taskUpdate", async (_sessionId, update) => {
			webSocketManager.broadcastTaskStatusChanged(
				update.taskId,
				update.oldStatus || "unknown",
				update.newStatus,
				update.task,
			);

			await sendTaskStatusNotifications(update.task, update.oldStatus || "unknown", update.newStatus);
		});

		taskMonitor.on("taskStatusChanged", async (event) => {
			if (event.data && event.data.taskId && event.data.newStatus) {
				webSocketManager.broadcastTaskStatusChanged(
					event.data.taskId,
					event.data.oldStatus || "unknown",
					event.data.newStatus,
					event.data.task,
				);

				await sendTaskStatusNotifications(
					event.data.task,
					event.data.oldStatus || "unknown",
					event.data.newStatus,
				);
			}
		});

		taskMonitor.on("taskCompleted", async (event) => {
			if (event.data && event.data.task) {
				webSocketManager.broadcastTaskStatusChanged(
					event.data.task.id,
					event.data.oldStatus || "in-progress",
					"done",
					event.data.task,
				);

				await sendTaskCompletedNotifications(event.data.task);
				await sendDependencySatisfiedNotifications(event.data.task);
			}
		});

		taskMonitor.on("dependenciesSatisfied", (event) => {
			console.log("[DAEMON] Dependencies satisfied:", event.data);
		});

		taskMonitor.on("tasksCacheUpdated", (event) => {
			console.log("[DAEMON] Tasks cache updated:", event.data);
		});
	};

	await Promise.all(Array.from(environmentServices.values()).map((services) => setupTaskMonitorHandlers(services)));

	// Add daemon state tracking
	let daemonPaused: boolean = false;
	let processingLoopActive: boolean = true;

    // Daemon owns the DB and hosts HTTP/TRPC; gateway proxies requests.

    const httpPort = Number(process.env.DAEMON_HTTP_PORT || process.env.HTTP_PORT || 3004);
    let httpServer: http.Server | null = null;
    let restartingHttp = false;

    const startHttp = async (): Promise<void> => {
        httpServer = await startHttpServer(
            {
                resolveProductManager: (req) =>
                    resolveServices(resolveEnvironmentFromRequest(req.headers)).productManager,
                resolveProfileManager: () => profileManager,
                resolveWebSocketManager: (req) =>
                    resolveServices(resolveEnvironmentFromRequest(req.headers)).webSocketManager,
            },
            httpPort,
        );
        await Promise.all(
            Array.from(environmentServices.values()).map((services) =>
                services.webSocketManager.start(httpServer!, { attachUpgradeListener: false }),
            ),
        );
        console.log(`[DAEMON] HTTP/TRPC server listening on port ${httpPort}`);

        httpServer.on("close", () => {
            console.warn("[DAEMON] HTTP server closed; scheduling restart.");
            void scheduleHttpRestart();
        });

        httpServer.on("error", (error) => {
            console.error("[DAEMON] HTTP server error:", error);
            void scheduleHttpRestart();
        });
    };

    const scheduleHttpRestart = async (): Promise<void> => {
        if (restartingHttp) {
            return;
        }
        restartingHttp = true;
        try {
            await Promise.all(
                Array.from(environmentServices.values()).map((services) =>
                    services.webSocketManager.stop(),
                ),
            );
        } catch (error) {
            console.error("[DAEMON] Failed to stop WebSocket servers before restart:", error);
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
        try {
            await startHttp();
        } catch (error) {
            console.error("[DAEMON] Failed to restart HTTP server:", error);
        } finally {
            restartingHttp = false;
        }
    };

    await startHttp();

    // Initialize and start dashboard server
	const dashboardServer = new DashboardServer(
		environmentServices,
		resolveEnvironmentFromRequest,
		defaultEnvironment,
	);
    const dashboardPort = Number(process.env.DASHBOARD_PORT || 3005);
    const dashboardHttpServer = http.createServer((req, res) => {
        dashboardServer.handleRequest(req, res).catch((error) => {
            console.error("[DASHBOARD] Error handling request:", error);
            res.writeHead(500, { "Content-Type": "text/plain" });
            res.end("Internal Server Error");
        });
    });
    
    // Initialize dashboard WebSocket server
    dashboardServer.initializeWebSocketServer(dashboardHttpServer).catch((error) => {
        console.error("[DASHBOARD] Failed to initialize WebSocket server:", error);
    });
    
    dashboardHttpServer.listen(dashboardPort, () => {
        console.log(`[DAEMON] Dashboard server listening on port ${dashboardPort}`);
        console.log(`[DAEMON] Dashboard available at http://localhost:${dashboardPort}`);
        console.log(`[DAEMON] Dashboard WebSocket available at ws://localhost:${dashboardPort}/dashboard-ws`);
    });

	const tcpPort = Number(process.env.TCP_PORT) || 3001;
	const skipTcp = process.env.SKIP_TCP === "true";

	if (!skipTcp) {
		const server = createServer((socket: Socket) => {
			console.log("[DAEMON] MCP client connected");

			let pendingBuffer = "";

			const handleIncomingMessage = async (payload: string): Promise<void> => {
				try {
					const message = JSON.parse(payload);
					console.log("[DAEMON] Received command:", message.command);
					const environment = resolveEnvironmentFromMessage(message);
					const services = resolveServices(environment);
					const pm = services.productManager;
					const wsManager = services.webSocketManager;
					const taskMonitor = services.taskMonitor;
					const notificationClient = services.notificationClient;
					const taskAuditService = services.taskAuditService;
					const taskScheduler = services.taskScheduler;
					const dashboardAnalyticsService = services.analyticsService;
					const progressTrackingService = services.progressTrackingService;

					let result: Result<unknown> = {
						success: false,
						error: new Error("Unhandled command"),
					};
					switch (message.command) {
						case "create_task":
							try {
								const task = await pm.createTask(
									message.data.title,
									message.data.description,
									message.data.priority || "medium",
									message.data.dependencies || [],
									message.data.createdBy,
									message.data.assignedTo,
									message.data.collaborators,
									message.data.watchers,
									message.data.type || "task",
								);
								result = { success: true, data: task };
								
								// Record task creation in audit trail
								await taskAuditService.recordTaskCreated(task, message.data.createdBy);
								
								// Update task monitor cache
								taskMonitor.updateTaskCache([task]);
								
								wsManager.broadcastTaskCreated(task);
							} catch (error) {
								result = {
									success: false,
									error: error instanceof Error ? error : new Error(String(error)),
								};
							}
							break;
						case "list_tasks":
							try {
								const tasks = await pm.getAllTasks();
								result = { success: true, data: tasks };
								wsManager.broadcastTasksList(tasks);
							} catch (error) {
								result = {
									success: false,
									error: error instanceof Error ? error : new Error(String(error)),
								};
							}
							break;
						case "get_task": {
							try {
								const tasks = await pm.getAllTasks();
								const task = tasks.find((t) => t.id === message.data.id);
								if (task) {
									result = { success: true, data: task };
								} else {
									result = { success: false, error: new Error("Task not found") };
								}
							} catch (error) {
								result = {
									success: false,
									error: error instanceof Error ? error : new Error(String(error)),
								};
							}
							break;
						}
						case "get_task_status": {
							try {
								const tasks = await pm.getAllTasks();
								const task = tasks.find((t) => t.id === message.data.id);
								if (task) {
									result = { 
										success: true, 
										data: { 
											taskId: task.id, 
											status: task.status, 
											updatedAt: task.updatedAt 
										} 
									};
								} else {
									result = { success: false, error: new Error("Task not found") };
								}
							} catch (error) {
								result = {
									success: false,
									error: error instanceof Error ? error : new Error(String(error)),
								};
							}
							break;
						}
						case "search_tasks": {
							try {
								const query = message.data.query || {};
								const searchResult = await pm.searchTasks(query);
								result = { success: true, data: searchResult };
							} catch (error) {
								result = {
									success: false,
									error: error instanceof Error ? error : new Error(String(error)),
								};
							}
							break;
						}
						case "create_saved_search": {
							try {
								const input = message.data;
								const savedSearch = await pm.createSavedSearch(input, input.createdBy ?? "system");
								result = { success: true, data: savedSearch };
							} catch (error) {
								result = {
									success: false,
									error: error instanceof Error ? error : new Error(String(error)),
								};
							}
							break;
						}
						case "get_saved_search": {
							try {
								const { id, userId } = message.data;
								const savedSearch = await pm.getSavedSearch(id, userId);
								if (savedSearch) {
									result = { success: true, data: savedSearch };
								} else {
									result = { success: false, error: new Error("Saved search not found") };
								}
							} catch (error) {
								result = {
									success: false,
									error: error instanceof Error ? error : new Error(String(error)),
								};
							}
							break;
						}
						case "list_saved_searches": {
							try {
								const { createdBy } = message.data || {};
								const savedSearches = await pm.getSavedSearches(createdBy);
								result = { success: true, data: savedSearches };
							} catch (error) {
								result = {
									success: false,
									error: error instanceof Error ? error : new Error(String(error)),
								};
							}
							break;
						}
						case "update_saved_search": {
							try {
								const input = message.data;
								const userId = input.userId ?? "system";
								const savedSearch = await pm.updateSavedSearch(input, userId);
								result = { success: true, data: savedSearch };
							} catch (error) {
								result = {
									success: false,
									error: error instanceof Error ? error : new Error(String(error)),
								};
							}
							break;
						}
						case "delete_saved_search": {
							try {
								const { id, userId } = message.data;
								await pm.deleteSavedSearch(id, userId ?? "system");
								result = { success: true, data: { deleted: true } };
							} catch (error) {
								result = {
									success: false,
									error: error instanceof Error ? error : new Error(String(error)),
								};
							}
							break;
						}
						case "execute_saved_search": {
							try {
								const { id, userId } = message.data;
								const savedSearch = await pm.getSavedSearch(id, userId);
								if (!savedSearch) {
									throw new Error("Saved search not found");
								}
								const searchResult = await pm.searchTasks(savedSearch.query);
								result = { success: true, data: searchResult };
							} catch (error) {
								result = {
									success: false,
									error: error instanceof Error ? error : new Error(String(error)),
								};
							}
							break;
						}
						case "subscribe_to_task_notifications": {
							try {
								const sessionId = message.data.sessionId || `client_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
								const taskIds = message.data.taskIds || [];
								
								// Create or get monitoring session
								let session = taskMonitor.getSession(sessionId);
								if (!session) {
									session = taskMonitor.createSession({});
								}
								
								// Subscribe to specific task updates
								taskMonitor.subscribeToTaskUpdates(sessionId, taskIds);
								
								// Set up notification forwarding for this session
								taskMonitor.on("taskUpdate", (sid, update) => {
									if (sid === sessionId) {
										// Send notification through WebSocket manager
										wsManager.broadcastTaskStatusChanged(
											update.taskId,
											update.oldStatus || "unknown",
											update.newStatus,
											update.task,
										);
										
										// Also send to TCP client if they have a callback
										if (message.data.includeTcpResponse) {
											socket.write(`${JSON.stringify({
												success: true,
												type: "task_status_notification",
												data: update
											})}\n`);
										}
									}
								});
								
								result = { 
									success: true, 
									data: { 
										sessionId,
										subscribedTasks: taskIds,
										message: "Subscribed to task notifications"
									} 
								};
							} catch (error) {
								result = {
									success: false,
									error: error instanceof Error ? error : new Error(String(error)),
								};
							}
							break;
						}
						case "update_task_status": {
							try {
								const oldTask = await pm
									.getAllTasks()
									.then((t) => t.find((task) => task.id === message.data.id));
								const oldStatus = oldTask?.status || "todo";
								const task = await pm.updateTaskStatus(message.data.id, message.data.status);
								
								// Record status change in audit trail
								await taskAuditService.recordTaskStatusChanged(
									message.data.id,
									oldStatus,
									message.data.status,
									message.data.changedBy
								);
								
								result = { success: true, data: task };
								
								// Update task monitor cache and notify subscribers
								taskMonitor.updateTaskCache([task]);
								taskMonitor.notifyTaskStatusChange({
									taskId: message.data.id,
									oldStatus,
									newStatus: message.data.status,
									timestamp: new Date(),
									task,
								});
								
								wsManager.broadcastTaskStatusChanged(
									message.data.id,
									oldStatus,
									message.data.status,
									task,
								);
							} catch (error) {
								result = {
									success: false,
									error: error instanceof Error ? error : new Error(String(error)),
								};
							}
							break;
						}
						case "update_task_priority": {
							try {
								const oldTaskPriority = await pm
									.getAllTasks()
									.then((t) => t.find((task) => task.id === message.data.id));
								const oldPriority = oldTaskPriority?.priority || "medium";
								const task = await pm.updateTaskPriority(message.data.id, message.data.priority);
								
								// Record priority change in audit trail
								await taskAuditService.recordTaskPriorityChanged(
									message.data.id,
									oldPriority,
									message.data.priority,
									message.data.changedBy
								);
								
								result = { success: true, data: task };
								wsManager.broadcastTaskPriorityChanged(
									message.data.id,
									oldPriority,
									message.data.priority,
									task,
								);
							} catch (error) {
								result = {
									success: false,
									error: error instanceof Error ? error : new Error(String(error)),
								};
							}
							break;
						}
						case "update_task": {
							try {
								const oldTask = await pm
									.getAllTasks()
									.then((t) => t.find((task) => task.id === message.data.id));
								
								const task = await pm.updateTask(message.data.id, message.data.updates, message.data.changedBy);
								
								// Record task update in audit trail
								await taskAuditService.recordTaskUpdated(
									message.data.id,
									message.data.changedBy,
									{
										updatedFields: Object.keys(message.data.updates),
										oldValues: {
											description: oldTask?.description,
											status: oldTask?.status,
											priority: oldTask?.priority,
										},
										newValues: message.data.updates,
									}
								);
								
								result = { success: true, data: task };
								
								// Update task monitor cache and notify subscribers
								taskMonitor.updateTaskCache([task]);
								
								// Broadcast appropriate changes
								if (message.data.updates.status) {
									taskMonitor.notifyTaskStatusChange({
										taskId: message.data.id,
										oldStatus: oldTask?.status || "todo",
										newStatus: message.data.updates.status,
										timestamp: new Date(),
										task,
									});
									wsManager.broadcastTaskStatusChanged(
										message.data.id,
										oldTask?.status || "todo",
										message.data.updates.status,
										task,
									);
								}
								
								if (message.data.updates.priority) {
									wsManager.broadcastTaskPriorityChanged(
										message.data.id,
										oldTask?.priority || "medium",
										message.data.updates.priority,
										task,
									);
								}
							} catch (error) {
								result = {
									success: false,
									error: error instanceof Error ? error : new Error(String(error)),
								};
							}
							break;
						}
						case "delete_task":
							try {
								// Record task deletion in audit trail
								await taskAuditService.recordTaskDeleted(message.data.id, message.data.deletedBy);
								
								await pm.deleteTask(message.data.id);
								wsManager.broadcastTaskDeleted(message.data.id);
								result = { success: true, data: true };
							} catch (error) {
								result = {
									success: false,
									error: error instanceof Error ? error : new Error(String(error)),
								};
							}
							break;
						case "restart":
							console.log("[DAEMON] Restart command received, spawning new daemon and exiting...");
							await wsManager.stop();
							spawn("yarn", ["run", "worker"], {
								cwd: process.cwd(),
								env: process.env,
								detached: true,
								stdio: "ignore",
								shell: true,
							});
							setTimeout(() => process.exit(0), 1000);
							result = {
								success: true,
								data: { message: "Restarting..." },
							};
							break;
						case "ws_status":
							result = { success: true, data: wsManager.getStatus() };
							break;
						case "create_template": {
							const templateManager = pm.getTemplateManager();
							const template = await templateManager.createTemplate(
								message.data.name,
								message.data.description,
								message.data.category,
								message.data.titleTemplate,
								message.data.descriptionTemplate,
								message.data.priority || "medium",
								message.data.variables || [],
								message.data.subtasks || [],
							);
							result = { success: true, data: template };
							break;
						}
						case "list_templates": {
							const tm = pm.getTemplateManager();
							const templates = await tm.getAllTemplates();
							result = { success: true, data: templates };
							break;
						}
						case "get_template": {
							const templateMgr = pm.getTemplateManager();
							const template = await templateMgr.getTemplate(message.data.id);
							result = template
								? { success: true, data: template }
								: { success: false, error: new Error("Template not found") };
							break;
						}
						case "create_task_from_template": {
							const taskResult = await pm.createTaskFromTemplate(message.data);
							result = { success: true, data: taskResult };
							break;
						}
                        case "initialize_templates":
                            await pm.initialize();
                            result = {
                                success: true,
                                data: { message: "Templates initialized successfully" },
                            };
                            break;
						case "create_automation_rule": {
							const automationTemplateMgr = pm.getTemplateManager();
							const rule = await automationTemplateMgr.createAutomationRule(message.data);
							result = { success: true, data: rule };
							break;
						}
						case "list_automation_rules": {
							const automationTmplMgr = pm.getTemplateManager();
							const rules = await automationTmplMgr.getAllAutomationRules();
							result = { success: true, data: rules };
							break;
						}
						case "update_automation_rule": {
							const automationTmplManager = pm.getTemplateManager();
							const updated = await automationTmplManager.updateAutomationRule(
								message.data.id,
								message.data.updates,
							);
							result = { success: true, data: updated };
							break;
						}
						case "delete_automation_rule": {
							const automationTManager = pm.getTemplateManager();
							await automationTManager.deleteAutomationRule(message.data.id);
							result = { success: true, data: true };
							break;
						}
						case "reload_automation_rules":
                            await pm.initialize();
                            result = {
                                success: true,
                                data: { message: "Automation rules reloaded" },
                            };
							break;
						// User management commands
                        case "create_user":
                            try {
                                const createdUser = await userManager.createUser(message.data);
                                result = { success: true, data: createdUser };
                            } catch (error) {
                                result = {
                                    success: false,
                                    error: error instanceof Error ? error : new Error(String(error)),
                                };
                            }
                            break;
                        case "authenticate_user": {
                            const auth = await userManager.authenticateUser(message.data);
                            result = auth.success
                                ? { success: true, data: auth }
                                : {
                                      success: false,
                                      error: new Error(auth.error || "Authentication failed"),
                                  };
                            break;
                        }
                        case "get_user": {
                            const user = await userManager.getUserById(message.data.id);
                            result = user
                                ? { success: true, data: user }
                                : { success: false, error: new Error("User not found") };
                            break;
                        }
                        case "list_users":
                            result = { success: true, data: await userManager.getAllUsers() };
                            break;
                        case "update_user": {
                            const updated = await userManager.updateUser(message.data);
                            result = { success: true, data: updated };
                            break;
                        }
                        case "delete_user":
                            await userManager.deleteUser(message.data.id);
                            result = { success: true, data: true };
                            break;
                        case "validate_session": {
                            const sessionUser = await userManager.validateSession(message.data.token);
                            result = sessionUser
                                ? { success: true, data: sessionUser }
                                : { success: false, error: new Error("Invalid session") };
                            break;
                        }
                        case "logout_user": {
                            const loggedOut = await userManager.logoutUser(message.data.token);
                            result = loggedOut
                                ? { success: true, data: true }
                                : { success: false, error: new Error("Logout failed") };
                            break;
                        }
                        case "refresh_token": {
                            const refresh = await userManager.refreshToken(message.data.refreshToken);
                            result = refresh.success
                                ? { success: true, data: refresh }
                                : {
                                      success: false,
                                      error: new Error(refresh.error || "Refresh token failed"),
                                  };
                            break;
                        }
						case "cleanup_sessions":
							await userManager.cleanupExpiredSessions();
							result = {
								success: true,
								data: { message: "Session cleanup completed" },
							};
							break;
						// Profile management commands
                        case "get_profile_states":
                            result = { success: true, data: profileManager.getAllProfileStates() };
                            break;
                        case "get_profile_state":
                            result = { success: true, data: profileManager.getProfileState(message.data.name) };
                            break;
                        case "get_profile_metrics":
                            result = { success: true, data: profileManager.getProfileMetrics(message.data.name) };
                            break;
                        case "get_all_profile_metrics":
                            result = {
                                success: true,
                                data: Object.fromEntries(profileManager.getAllProfileMetrics()),
                            };
                            break;
                        case "get_profiles_with_states":
                            result = { success: true, data: profileManager.getProfilesWithStates() };
                            break;
                        case "get_profile_task_queue":
                            result = { success: true, data: profileManager.getTaskQueue(message.data.name) };
                            break;
                        case "update_profile_status": {
                            const state = profileManager.getProfileState(message.data.name);
                            if (!state) {
                                result = { success: false, error: new Error("Profile not found") };
                                break;
                            }
                            profileManager.updateProfileState(message.data.name, {
                                isActive: message.data.isActive,
                            });
                            result = { success: true, data: true };
                            break;
                        }
                        case "get_best_profile_for_task":
                            result = {
                                success: true,
                                data: profileManager.getBestProfileForTask(message.data.task),
                            };
                            break;
                        case "assign_task_to_profile": {
                            const profile = profileManager.getProfile(message.data.profileName);
                            if (!profile) {
                                result = { success: false, error: new Error("Profile not found") };
                                break;
                            }
                            profileManager.addToTaskQueue(
                                message.data.profileName,
                                message.data.task,
                            );
                            result = { success: true, data: true };
                            break;
                        }
						case "unlock_accounts":
							console.log("[DAEMON] Unlocking all user accounts");
							try {
								const users = await userManager.getAllUsers();
								let unlockedCount = 0;

								for (const user of users) {
									if (user.lockedUntil || user.failedLoginAttempts > 0) {
										console.log(`[DAEMON] Unlocking user: ${user.username}`);

										const updatedUser = {
											...user,
											failedLoginAttempts: 0,
											updatedAt: new Date(),
										};

										delete updatedUser.lockedUntil;

										await userManager.updateUser(updatedUser);
										unlockedCount++;
									}
								}

								result = {
									success: true,
									data: {
										unlockedCount,
										totalUsers: users.length,
										message: `Unlocked ${unlockedCount} user accounts`,
									},
								};
							} catch (error) {
								result = {
									success: false,
									error: error instanceof Error ? error : new Error(String(error)),
								};
							}
							break;
						// Task monitoring commands
						case "create_monitoring_session": {
							try {
								const session = taskMonitor.createSession(message.data.filters || {});
								result = { success: true, data: session };
							} catch (error) {
								result = {
									success: false,
									error: error instanceof Error ? error : new Error(String(error)),
								};
							}
							break;
						}
						case "update_monitoring_session": {
							try {
								const updated = taskMonitor.updateSession(message.data.sessionId, message.data.filters || {});
								result = { success: true, data: updated };
							} catch (error) {
								result = {
									success: false,
									error: error instanceof Error ? error : new Error(String(error)),
								};
							}
							break;
						}
						case "get_filtered_tasks": {
							try {
								const allTasks = await pm.getAllTasks();
								const filteredTasks = taskMonitor.getTasksByFilter(allTasks, message.data.filters || {});
								result = { success: true, data: filteredTasks };
							} catch (error) {
								result = {
									success: false,
									error: error instanceof Error ? error : new Error(String(error)),
								};
							}
							break;
						}
						case "get_session_tasks": {
							try {
								const allTasks = await pm.getAllTasks();
								const filteredTasks = await taskMonitor.getFilteredTasks(message.data.sessionId, allTasks);
								result = { success: true, data: filteredTasks };
							} catch (error) {
								result = {
									success: false,
									error: error instanceof Error ? error : new Error(String(error)),
								};
							}
							break;
						}
						case "subscribe_to_task_updates": {
							try {
								const subscribed = taskMonitor.subscribeToTaskUpdates(message.data.sessionId, message.data.taskIds || []);
								result = { success: true, data: subscribed };
							} catch (error) {
								result = {
									success: false,
									error: error instanceof Error ? error : new Error(String(error)),
								};
							}
							break;
						}
						case "get_monitoring_session": {
							try {
								const session = taskMonitor.getSession(message.data.sessionId);
								result = session
									? { success: true, data: session }
									: { success: false, error: new Error("Session not found") };
							} catch (error) {
								result = {
									success: false,
									error: error instanceof Error ? error : new Error(String(error)),
								};
							}
							break;
						}
						case "get_monitoring_sessions": {
							try {
								const sessions = taskMonitor.getActiveSessions();
								result = { success: true, data: sessions };
							} catch (error) {
								result = {
									success: false,
									error: error instanceof Error ? error : new Error(String(error)),
								};
							}
							break;
						}
						case "close_monitoring_session": {
							try {
								const closed = taskMonitor.closeSession(message.data.sessionId);
								result = { success: true, data: closed };
							} catch (error) {
								result = {
									success: false,
									error: error instanceof Error ? error : new Error(String(error)),
								};
							}
							break;
						}
						// Daemon control commands
						case "pause_daemon": {
							try {
								if (daemonPaused) {
									result = { success: false, error: new Error("Daemon is already paused") };
								} else {
									daemonPaused = true;
									console.log("[DAEMON] Daemon paused by user command");
									result = { success: true, data: { message: "Daemon paused successfully" } };
								}
							} catch (error) {
								result = {
									success: false,
									error: error instanceof Error ? error : new Error(String(error)),
								};
							}
							break;
						}
						case "resume_daemon": {
							try {
								if (!daemonPaused) {
									result = { success: false, error: new Error("Daemon is not paused") };
								} else {
									daemonPaused = false;
									console.log("[DAEMON] Daemon resumed by user command");
									result = { success: true, data: { message: "Daemon resumed successfully" } };
								}
							} catch (error) {
								result = {
									success: false,
									error: error instanceof Error ? error : new Error(String(error)),
								};
							}
							break;
						}
						case "stop_daemon": {
							try {
								console.log("[DAEMON] Stop command received, shutting down gracefully...");
								
								// Stop processing loop
								processingLoopActive = false;
								
								// Stop WebSocket manager
								await wsManager.stop();
								
								// Stop HTTP server if running
								if (httpServer) {
									httpServer.close();
								}
								
								// Stop dashboard server
								if (dashboardHttpServer) {
									dashboardHttpServer.close();
								}
								
								result = { success: true, data: { message: "Daemon stopped successfully" } };
								
								// Exit after a short delay to allow response to be sent
								setTimeout(() => process.exit(0), 1000);
							} catch (error) {
								result = {
									success: false,
									error: error instanceof Error ? error : new Error(String(error)),
								};
							}
							break;
						}
						case "get_daemon_status": {
							try {
								const status = {
									paused: daemonPaused,
									processingActive: processingLoopActive,
									uptime: process.uptime(),
									memoryUsage: process.memoryUsage(),
									pid: process.pid,
									timestamp: new Date().toISOString()
								};
								result = { success: true, data: status };
							} catch (error) {
								result = {
									success: false,
									error: error instanceof Error ? error : new Error(String(error)),
								};
							}
							break;
						}
						case "bulk_update_priorities": {
							try {
								const { updates } = message.data;
								if (!Array.isArray(updates)) {
									result = { success: false, error: new Error("Updates must be an array") };
									break;
								}

								const results = [];
								for (const update of updates) {
									const { taskId, priority } = update;
									if (!taskId || !priority) {
										results.push({ taskId, success: false, error: "Task ID and priority are required" });
										continue;
									}

									try {
										const updatedTask = await pm.updateTaskPriority(taskId, priority);
										results.push({ taskId, success: true, data: updatedTask });
										
										// Update task monitor cache and notify
										taskMonitor.updateTaskCache([updatedTask]);
										wsManager.broadcastTaskPriorityChanged(
											taskId,
											update.oldPriority || "medium",
											priority,
											updatedTask,
										);
									} catch (error) {
										results.push({ 
											taskId, 
											success: false, 
											error: error instanceof Error ? error.message : "Update failed" 
										});
									}
								}

								result = { 
									success: true, 
									data: { 
										results,
										successful: results.filter(r => r.success).length,
										failed: results.filter(r => !r.success).length
									} 
								};
							} catch (error) {
								result = {
									success: false,
									error: error instanceof Error ? error : new Error(String(error)),
								};
							}
							break;
						}
						// Notification commands
						case "set_notification_preferences": {
							try {
								const preferences = message.data;
								if (!preferences.userId) {
									result = { success: false, error: new Error("User ID is required") };
									break;
								}
								
								await notificationClient.setUserPreferences(preferences);
								result = { success: true, data: { message: "Notification preferences updated" } };
							} catch (error) {
								result = {
									success: false,
									error: error instanceof Error ? error : new Error(String(error)),
								};
							}
							break;
						}
						case "get_notification_preferences": {
							try {
								const userId = message.data.userId;
								if (!userId) {
									result = { success: false, error: new Error("User ID is required") };
									break;
								}
								
								const preferences = await notificationClient.getUserPreferences(userId);
								result = preferences 
									? { success: true, data: preferences }
									: { success: false, error: new Error("Preferences not found") };
							} catch (error) {
								result = {
									success: false,
									error: error instanceof Error ? error : new Error(String(error)),
								};
							}
							break;
						}
						case "send_notification": {
							try {
								const notification = message.data;
								const notificationResult = await notificationClient.sendNotification(notification);
								result = { success: true, data: notificationResult };
							} catch (error) {
								result = {
									success: false,
									error: error instanceof Error ? error : new Error(String(error)),
								};
							}
							break;
						}
						case "get_notification_history": {
							try {
								const userId = message.data.userId;
								const limit = message.data.limit;
								const history = await notificationClient.getNotificationHistory({ userId, limit });
								result = { success: true, data: history };
							} catch (error) {
								result = {
									success: false,
									error: error instanceof Error ? error : new Error(String(error)),
								};
							}
							break;
						}
						case "mark_notification_read": {
							try {
								const { notificationId, userId } = message.data;
								if (!notificationId || !userId) {
									result = { success: false, error: new Error("Notification ID and User ID are required") };
									break;
								}
								
								const marked = await notificationClient.markNotificationRead(notificationId, userId);
								result = { success: marked.marked, data: marked };
							} catch (error) {
								result = {
									success: false,
									error: error instanceof Error ? error : new Error(String(error)),
								};
							}
							break;
						}
						case "get_notification_stats": {
							try {
								const userId = message.data.userId;
								const stats = await notificationClient.getNotificationStats(userId);
								result = { success: true, data: stats };
							} catch (error) {
								result = {
									success: false,
									error: error instanceof Error ? error : new Error(String(error)),
								};
							}
							break;
						}
						case "send_daily_digest": {
							try {
								const { userId, tasks } = message.data;
								if (!userId || !tasks) {
									result = { success: false, error: new Error("User ID and tasks are required") };
									break;
								}
								
								const digestResult = await notificationClient.sendDailyDigest({ userId, tasks });
								result = { success: true, data: digestResult };
							} catch (error) {
								result = {
									success: false,
									error: error instanceof Error ? error : new Error(String(error)),
								};
							}
							break;
						}
						case "send_weekly_digest": {
							try {
								const { userId, tasks } = message.data;
								if (!userId || !tasks) {
									result = { success: false, error: new Error("User ID and tasks are required") };
									break;
								}
								
								const digestResult = await notificationClient.sendWeeklyDigest({ userId, tasks });
								result = { success: true, data: digestResult };
							} catch (error) {
								result = {
									success: false,
									error: error instanceof Error ? error : new Error(String(error)),
								};
							}
							break;
						}
						case "list_notification_outbox": {
							try {
                                const { status, recipientId, limit } = message.data ?? {};
                                const normalizedStatus =
                                    status === "pending"
                                    || status === "processing"
                                    || status === "sent"
                                    || status === "failed"
                                        ? status
                                        : undefined;
                                const outbox = await notificationClient.listOutbox({
                                    ...(normalizedStatus ? { status: normalizedStatus } : {}),
                                    ...(typeof recipientId === "string" ? { recipientId } : {}),
                                    ...(typeof limit === "number" ? { limit } : {}),
                                });
                                result = { success: true, data: outbox };
                            } catch (error) {
                                result = {
                                    success: false,
                                    error: error instanceof Error ? error : new Error(String(error)),
                                };
                            }
                            break;
						}
                        case "get_notification_outbox_entry": {
                            try {
                                const id = message.data?.id;
                                if (!id || typeof id !== "string") {
                                    result = {
                                        success: false,
                                        error: new Error("Notification outbox entry ID is required"),
                                    };
                                    break;
                                }
                                const outboxEntry = await notificationClient.getOutboxMessage(id);
                                if (!outboxEntry) {
                                    result = {
                                        success: false,
                                        error: new Error("Notification outbox entry not found"),
                                    };
                                    break;
                                }
                                result = { success: true, data: outboxEntry };
                            } catch (error) {
                                result = {
                                    success: false,
                                    error: error instanceof Error ? error : new Error(String(error)),
                                };
                            }
                            break;
                        }
                        case "process_notification_outbox": {
                            try {
                                const processingResult = await notificationClient.processOutbox();
                                result = { success: true, data: processingResult };
                            } catch (error) {
                                result = {
                                    success: false,
                                    error: error instanceof Error ? error : new Error(String(error)),
                                };
                            }
                            break;
                        }
						// Task scheduling commands
						case "create_scheduled_task": {
							try {
								const scheduleData = message.data;
								const scheduledTask = await taskScheduler.createScheduledTask(scheduleData);
								result = { success: true, data: scheduledTask };
							} catch (error) {
								result = {
									success: false,
									error: error instanceof Error ? error : new Error(String(error)),
								};
							}
							break;
						}
						case "update_scheduled_task": {
							try {
								const { id, updates } = message.data;
								if (!id) {
									result = { success: false, error: new Error("Scheduled task ID is required") };
									break;
								}
								const updatedTask = await taskScheduler.updateScheduledTask(id, updates);
								result = { success: true, data: updatedTask };
							} catch (error) {
								result = {
									success: false,
									error: error instanceof Error ? error : new Error(String(error)),
								};
							}
							break;
						}
						case "delete_scheduled_task": {
							try {
								const { id } = message.data;
								if (!id) {
									result = { success: false, error: new Error("Scheduled task ID is required") };
									break;
								}
								const deleted = await taskScheduler.deleteScheduledTask(id);
								result = { success: true, data: { deleted } };
							} catch (error) {
								result = {
									success: false,
									error: error instanceof Error ? error : new Error(String(error)),
								};
							}
							break;
						}
						case "get_scheduled_task": {
							try {
								const { id } = message.data;
								if (!id) {
									result = { success: false, error: new Error("Scheduled task ID is required") };
									break;
								}
								const task = taskScheduler.getScheduledTask(id);
								result = task 
									? { success: true, data: task }
									: { success: false, error: new Error("Scheduled task not found") };
							} catch (error) {
								result = {
									success: false,
									error: error instanceof Error ? error : new Error(String(error)),
								};
							}
							break;
						}
						case "list_scheduled_tasks": {
							try {
								const tasks = taskScheduler.getAllScheduledTasks();
								result = { success: true, data: tasks };
							} catch (error) {
								result = {
									success: false,
									error: error instanceof Error ? error : new Error(String(error)),
								};
							}
							break;
						}
						case "list_active_scheduled_tasks": {
							try {
								const tasks = taskScheduler.getActiveScheduledTasks();
								result = { success: true, data: tasks };
							} catch (error) {
								result = {
									success: false,
									error: error instanceof Error ? error : new Error(String(error)),
								};
							}
							break;
						}
						case "validate_cron_expression": {
							try {
								const { expression } = message.data;
								if (!expression) {
									result = { success: false, error: new Error("Cron expression is required") };
									break;
								}
								const validation = taskScheduler.validateCronExpression(expression);
								result = { success: true, data: validation };
							} catch (error) {
								result = {
									success: false,
									error: error instanceof Error ? error : new Error(String(error)),
								};
							}
							break;
						}
						case "get_scheduler_stats": {
							try {
								const stats = taskScheduler.getStats();
								result = { success: true, data: stats };
							} catch (error) {
								result = {
									success: false,
									error: error instanceof Error ? error : new Error(String(error)),
								};
							}
							break;
						}
						case "pause_scheduler": {
							try {
								taskScheduler.pause();
								result = { success: true, data: { message: "Scheduler paused" } };
							} catch (error) {
								result = {
									success: false,
									error: error instanceof Error ? error : new Error(String(error)),
								};
							}
							break;
						}
						case "resume_scheduler": {
							try {
								taskScheduler.resume();
								result = { success: true, data: { message: "Scheduler resumed" } };
							} catch (error) {
								result = {
									success: false,
									error: error instanceof Error ? error : new Error(String(error)),
								};
							}
							break;
						}
						case "get_scheduled_task_failure_log": {
							try {
								const { id } = message.data;
								if (!id) {
									result = { success: false, error: new Error("Scheduled task ID is required") };
									break;
								}
								const failureLog = taskScheduler.getTaskFailureLog(id);
								result = { success: true, data: failureLog };
							} catch (error) {
								result = {
									success: false,
									error: error instanceof Error ? error : new Error(String(error)),
								};
							}
							break;
						}
						case "validate_scheduled_task_dependencies": {
							try {
								const { id } = message.data;
								if (!id) {
									result = { success: false, error: new Error("Scheduled task ID is required") };
									break;
								}
								const validation = await taskScheduler.validateScheduledTaskDependencies(id);
								result = { success: true, data: validation };
							} catch (error) {
								result = {
									success: false,
									error: error instanceof Error ? error : new Error(String(error)),
								};
							}
							break;
						}
						case "get_dependency_scheduling_recommendations": {
							try {
								const recommendations = taskScheduler.getDependencySchedulingRecommendations();
								result = { success: true, data: recommendations };
							} catch (error) {
								result = {
									success: false,
									error: error instanceof Error ? error : new Error(String(error)),
								};
							}
							break;
						}
						case "optimize_scheduled_task_order": {
							try {
								const order = taskScheduler.optimizeScheduledTaskOrder();
								result = { success: true, data: { executionOrder: order } };
							} catch (error) {
								result = {
									success: false,
									error: error instanceof Error ? error : new Error(String(error)),
								};
							}
							break;
						}
						case "get_scheduled_task_dependency_metrics": {
							try {
								const metrics = taskScheduler.getScheduledTaskDependencyMetrics();
								result = { success: true, data: metrics };
							} catch (error) {
								result = {
									success: false,
									error: error instanceof Error ? error : new Error(String(error)),
								};
							}
							break;
						}
						// Dependency management commands
						case "get_dependency_graph": {
							try {
								const allTasks = await pm.getAllTasks();
								const dependencyGraphService = new DependencyGraphService();
								const graphData = dependencyGraphService.generateDependencyGraph(allTasks);
								result = { success: true, data: graphData };
							} catch (error) {
								result = {
									success: false,
									error: error instanceof Error ? error : new Error(String(error)),
								};
							}
							break;
						}
						case "get_dependency_graph_visualization": {
							try {
								const allTasks = await pm.getAllTasks();
								const dependencyGraphService = new DependencyGraphService();
								const visualizationData = dependencyGraphService.formatGraphForVisualization(allTasks);
								result = { success: true, data: visualizationData };
							} catch (error) {
								result = {
									success: false,
									error: error instanceof Error ? error : new Error(String(error)),
								};
							}
							break;
						}
						case "get_critical_path": {
							try {
								const allTasks = await pm.getAllTasks();
								const dependencyGraphService = new DependencyGraphService();
								const graph = dependencyGraphService.generateDependencyGraph(allTasks);
								const criticalPathData = {
									criticalPath: graph.criticalPath || [],
									totalDuration: graph.nodes.reduce((sum, node) => sum + (node.duration || 0), 0),
									criticalTasks: graph.criticalPath || [],
									bottlenecks: graph.bottlenecks || [],
									slackTimes: graph.nodes.reduce((acc, node) => {
										acc[node.id] = node.slack || 0;
										return acc;
									}, {} as Record<string, number>),
									levels: graph.levels || []
								};
								result = { success: true, data: criticalPathData };
							} catch (error) {
								result = {
									success: false,
									error: error instanceof Error ? error : new Error(String(error)),
								};
							}
							break;
						}
						case "get_critical_path_visualization": {
							try {
								const allTasks = await pm.getAllTasks();
								const dependencyGraphService = new DependencyGraphService();
								const criticalPathData = dependencyGraphService.formatCriticalPathForVisualization(allTasks);
								result = { success: true, data: criticalPathData };
							} catch (error) {
								result = {
									success: false,
									error: error instanceof Error ? error : new Error(String(error)),
								};
							}
							break;
						}
						case "validate_dependencies": {
							try {
								const allTasks = await pm.getAllTasks();
								const dependencyGraphService = new DependencyGraphService();
								const validation = dependencyGraphService.validateDependencies(allTasks);
								result = { success: true, data: validation };
							} catch (error) {
								result = {
									success: false,
									error: error instanceof Error ? error : new Error(String(error)),
								};
							}
							break;
						}
						case "get_dependency_impact": {
							try {
								const { taskId } = message.data;
								if (!taskId) {
									result = { success: false, error: new Error("Task ID is required") };
									break;
								}
								
								const allTasks = await pm.getAllTasks();
								const dependencyGraphService = new DependencyGraphService();
								const impactAnalysis = dependencyGraphService.getImpactAnalysis(taskId);
								result = { success: true, data: impactAnalysis };
							} catch (error) {
								result = {
									success: false,
									error: error instanceof Error ? error : new Error(String(error)),
								};
							}
							break;
						}
						case "get_dependency_health": {
							try {
								const allTasks = await pm.getAllTasks();
								const dependencyGraphService = new DependencyGraphService();
								const graph = dependencyGraphService.generateDependencyGraph(allTasks);
								const validation = dependencyGraphService.validateDependencies(allTasks);
								
								const healthMetrics = {
									validation,
									graphSummary: {
										totalNodes: graph.nodes.length,
										totalEdges: graph.edges.length,
										cyclesCount: graph.cycles.length,
										bottlenecksCount: graph.bottlenecks.length,
										criticalPathLength: graph.criticalPath.length
									},
									timestamp: new Date().toISOString()
								};
								
								result = { success: true, data: healthMetrics };
							} catch (error) {
								result = {
									success: false,
									error: error instanceof Error ? error : new Error(String(error)),
								};
							}
							break;
						}
						case "get_dependency_bottlenecks": {
							try {
								const allTasks = await pm.getAllTasks();
								const dependencyGraphService = new DependencyGraphService();
								const graph = dependencyGraphService.generateDependencyGraph(allTasks);
								
								const bottlenecks = graph.bottlenecks.map(taskId => {
									const task = allTasks.find(t => t.id === taskId);
									const node = graph.nodes.find(n => n.id === taskId);
									const dependents = node?.dependents || [];
									
									return {
										id: taskId,
										title: task?.title || taskId,
										status: task?.status || "todo",
										priority: task?.priority || "medium",
										dependentsCount: dependents.length,
										criticalPath: node?.criticalPath || false,
										slack: node?.slack || 0
									};
								});
								
								result = { 
									success: true, 
									data: {
										bottlenecks,
										totalCount: bottlenecks.length,
										timestamp: new Date().toISOString()
									}
								};
							} catch (error) {
								result = {
									success: false,
									error: error instanceof Error ? error : new Error(String(error)),
								};
							}
							break;
						}
						case "get_dependency_suggestions": {
							try {
								const { taskId, context } = message.data;
								if (!taskId) {
									result = { success: false, error: new Error("Task ID is required") };
									break;
								}
								
								const allTasks = await pm.getAllTasks();
								const dependencyGraphService = new DependencyGraphService();
								
								// Generate basic suggestions based on task patterns
								const currentTask = allTasks.find(t => t.id === taskId);
								const suggestions = {
									suggestedDependencies: [],
									potentialDependents: [],
									optimizationSuggestions: []
								};
								
								if (currentTask) {
									// Find tasks that could be dependencies
									suggestions.suggestedDependencies = allTasks
										.filter(task => {
											if (task.id === taskId || (currentTask.dependencies || []).includes(task.id)) return false;
											
											// Simple pattern matching
											const titleWords = currentTask.title.toLowerCase().split(/\s+/);
											const taskTitleWords = task.title.toLowerCase().split(/\s+/);
											const commonWords = titleWords.filter(word => word.length > 3 && taskTitleWords.includes(word));
											
											return commonWords.length >= 2 && task.status === "done";
										})
										.map(task => ({
											taskId: task.id,
											title: task.title,
											reason: "Similar title and completed status",
											confidence: 75
										}))
										.slice(0, 5);
								}
								
								result = { success: true, data: suggestions };
							} catch (error) {
								result = {
									success: false,
									error: error instanceof Error ? error : new Error(String(error)),
								};
							}
							break;
						}
						case "get_dependency_what_if": {
							try {
								const { scenario } = message.data;
								if (!scenario || !scenario.type) {
									result = { success: false, error: new Error("Scenario type is required") };
									break;
								}
								
								const allTasks = await pm.getAllTasks();
								const dependencyGraphService = new DependencyGraphService();
								
								// Basic what-if analysis
								const originalGraph = dependencyGraphService.generateDependencyGraph(allTasks);
								let modifiedTasks = [...allTasks];
								
								switch (scenario.type) {
									case "add_dependency":
										modifiedTasks = modifiedTasks.map(task => 
											task.id === scenario.changes.taskId 
												? { ...task, dependencies: [...(task.dependencies || []), scenario.changes.dependencyId] }
												: task
										);
										break;
									case "remove_dependency":
										modifiedTasks = modifiedTasks.map(task => 
											task.id === scenario.changes.taskId 
												? { ...task, dependencies: (task.dependencies || []).filter((depId: string) => depId !== scenario.changes.dependencyId) }
												: task
										);
										break;
								}
								
								const newGraph = dependencyGraphService.generateDependencyGraph(modifiedTasks);
								const validation = dependencyGraphService.validateDependencies(modifiedTasks);
								
								const analysis = {
									scenario,
									impact: {
										validationResults: validation,
										graphChanges: {
											originalNodeCount: originalGraph.nodes.length,
											newNodeCount: newGraph.nodes.length,
											originalEdgeCount: originalGraph.edges.length,
											newEdgeCount: newGraph.edges.length
										}
									},
									timestamp: new Date().toISOString()
								};
								
								result = { success: true, data: analysis };
							} catch (error) {
								result = {
									success: false,
									error: error instanceof Error ? error : new Error(String(error)),
								};
							}
							break;
						}
						case "get_dependency_tree": {
							try {
								const { taskId, maxDepth } = message.data;
								if (!taskId) {
									result = { success: false, error: new Error("Task ID is required") };
									break;
								}
								
								const allTasks = await pm.getAllTasks();
								const dependencyGraphService = new DependencyGraphService();
								const treeData = dependencyGraphService.formatDependencyTree(allTasks, taskId, maxDepth || 5);
								result = { success: true, data: treeData };
							} catch (error) {
								result = {
									success: false,
									error: error instanceof Error ? error : new Error(String(error)),
								};
							}
							break;
						}
						case "get_dependency_cycles": {
							try {
								const allTasks = await pm.getAllTasks();
								const dependencyGraphService = new DependencyGraphService();
								const cyclesData = dependencyGraphService.formatCircularDependencies(allTasks);
								result = { success: true, data: cyclesData };
							} catch (error) {
								result = {
									success: false,
									error: error instanceof Error ? error : new Error(String(error)),
								};
							}
							break;
						}
						// Task audit trail commands
						case "get_task_history": {
							try {
								const { taskId, limit, offset, eventType, fromDate, toDate, changedBy } = message.data;
								const filter: any = {};
								
								if (taskId) filter.taskId = taskId;
								if (limit) filter.limit = limit;
								if (offset) filter.offset = offset;
								if (eventType) filter.eventType = eventType;
								if (fromDate) filter.fromDate = new Date(fromDate);
								if (toDate) filter.toDate = new Date(toDate);
								if (changedBy) filter.changedBy = changedBy;
								
								const history = await taskAuditService.getTaskHistory(filter);
								result = { success: true, data: history };
							} catch (error) {
								result = {
									success: false,
									error: error instanceof Error ? error : new Error(String(error)),
								};
							}
							break;
						}
						case "get_task_history_summary": {
							try {
								const { taskId } = message.data;
								if (!taskId) {
									result = { success: false, error: new Error("Task ID is required") };
									break;
								}
								
								const summary = await taskAuditService.getTaskHistorySummary(taskId);
								result = summary 
									? { success: true, data: summary }
									: { success: false, error: new Error("Task history not found") };
							} catch (error) {
								result = {
									success: false,
									error: error instanceof Error ? error : new Error(String(error)),
								};
							}
							break;
						}
						case "get_audit_statistics": {
							try {
								const { fromDate, toDate } = message.data;
								const stats = await taskAuditService.getAuditStatistics(
									fromDate ? new Date(fromDate) : undefined,
									toDate ? new Date(toDate) : undefined
								);
								result = { success: true, data: stats };
							} catch (error) {
								result = {
									success: false,
									error: error instanceof Error ? error : new Error(String(error)),
								};
							}
							break;
						}
						case "cleanup_audit_events": {
							try {
								const { olderThanDays } = message.data;
								const deletedCount = await taskAuditService.cleanupOldEvents(olderThanDays || 90);
								result = { 
									success: true, 
									data: { 
										deletedCount,
										message: `Cleaned up ${deletedCount} old audit events` 
									} 
								};
							} catch (error) {
								result = {
									success: false,
									error: error instanceof Error ? error : new Error(String(error)),
								};
							}
							break;
						}
						default:
							result = { success: false, error: new Error(`Unknown command: ${message.command}`) };
					}

					const normalizedResult = result.error instanceof Error
						? {
							...result,
							error: {
								message: result.error.message,
								name: result.error.name,
							},
						}
						: result;
					socket.write(`${JSON.stringify(normalizedResult)}\n`);
				} catch (error) {
					console.error("[DAEMON] Error processing command:", error);
					const err = error instanceof Error ? error : new Error(String(error));
					socket.write(`${JSON.stringify({ success: false, error: err.message })}\n`);
				}
			};

			socket.on("data", async (data) => {
				const nextBuffer = `${pendingBuffer}${data.toString()}`;
				const lines = nextBuffer.split("\n");
				pendingBuffer = lines.pop() ?? "";
				for (const line of lines) {
					const trimmed = line.trim();
					if (!trimmed) {
						continue;
					}
					await handleIncomingMessage(trimmed);
				}
			});

			socket.on("close", () => {
				console.log("[DAEMON] MCP client disconnected");
			});

			socket.on("error", (err) => {
				console.error("[DAEMON] Socket error:", err.message);
			});
		});

		server.on("error", (err: unknown) => {
			const error = err as NodeJS.ErrnoException;
			if (error && error.code === "EADDRINUSE") {
				console.error(`[DAEMON] TCP port ${tcpPort} in use, skipping TCP server`);
			} else {
				console.error("[DAEMON] TCP server error:", error);
			}
		});

		server.listen(tcpPort, () => {
			console.log(`[DAEMON] TCP server listening on port ${tcpPort}`);
		});
	} else {
		console.log("[DAEMON] TCP server disabled via SKIP_TCP=true");
	}

	void startMcpHttpServer();

	const isTestMode =
		process.env.ISOMORPHIQ_TEST_MODE === "true" || process.env.NODE_ENV === "test";
	const shouldProcessTasks =
		process.env.ISOMORPHIQ_ENABLE_TASK_PROCESSING === "true" || !isTestMode;

	if (shouldProcessTasks) {
		const processingServices = resolveProcessingServices();
		console.log(
			`[DAEMON] Task processing environments: ${processingServices.map((svc) => svc.environment).join(", ")}`,
		);
		// Start the continuous task processing loop in parallel
		for (const services of processingServices) {
			services.workflowRunner.runLoop().catch((error) => {
				console.error(
					`[DAEMON] Task processing loop error (${services.environment}):`,
					error,
				);
			});
		}
		console.log("[DAEMON] Daemon is running with both TCP server and task processing loop");
	} else {
		processingLoopActive = false;
		console.log("[DAEMON] Task processing loop disabled for test mode");
		console.log("[DAEMON] Daemon is running with TCP server only");
	}
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
    main().catch(console.error);
}
