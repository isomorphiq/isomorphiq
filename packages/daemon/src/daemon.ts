import { spawn } from "node:child_process";
import http from "node:http";
import { createServer, type Socket } from "node:net";
import { ProductManager } from "@isomorphiq/tasks";
import { getUserManager } from "@isomorphiq/auth";
import { WebSocketManager } from "@isomorphiq/realtime";
import { startHttpServer } from "@isomorphiq/http-server";
import type { Result } from "@isomorphiq/core";
import { DashboardServer } from "./web/dashboard.ts";
import { TaskMonitor } from "./services/task-monitor.ts";

// Task Manager Daemon - runs the continuous task processing loop and handles MCP requests
async function main() {
	console.log("[DAEMON] Starting Isomorphiq Task Manager Daemon");

	const pm = new ProductManager();
	const userManager = getUserManager();
	const wsManager = new WebSocketManager({ path: "/ws" });
	const taskMonitor = new TaskMonitor();
	pm.setWebSocketManager(wsManager);
	console.log("[DAEMON] Initialized ProductManager, UserManager, and TaskMonitor with WebSocket support");

    // Daemon owns the DB and hosts HTTP/TRPC; gateway proxies requests.

    // Initialize templates and automation rules
    await pm.initialize();

    const httpPort = Number(process.env.DAEMON_HTTP_PORT || process.env.HTTP_PORT || 3004);
    const httpServer = await startHttpServer(pm, httpPort);
    await wsManager.start(httpServer, { attachUpgradeListener: false });
    console.log(`[DAEMON] HTTP/TRPC server listening on port ${httpPort}`);

    // Initialize and start dashboard server
    const dashboardServer = new DashboardServer(pm, wsManager);
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

	// Display current tasks
	const existingTasks = await pm.getAllTasks();
	console.log(`[DAEMON] Found ${existingTasks.length} existing tasks in database`);

	// Initialize task monitor cache with existing tasks
	taskMonitor.updateTaskCache(existingTasks);

	// Set up task status change notifications
	taskMonitor.on("taskUpdate", (sessionId, update) => {
		wsManager.broadcastTaskStatusChanged(update.taskId, update.oldStatus || "unknown", update.newStatus, update.task);
	});

	const tcpPort = Number(process.env.TCP_PORT) || 3001;
	const skipTcp = process.env.SKIP_TCP === "true";

	if (!skipTcp) {
		const server = createServer((socket: Socket) => {
			console.log("[DAEMON] MCP client connected");

			socket.on("data", async (data) => {
				try {
					const message = JSON.parse(data.toString().trim());
					console.log("[DAEMON] Received command:", message.command);

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
						case "list_tasks_filtered": {
							try {
								const allTasks = await pm.getAllTasks();
								const filters = message.data.filters || {};
								let filteredTasks = allTasks;

								// Apply filters
								if (filters.status) {
									const statuses = Array.isArray(filters.status) ? filters.status : [filters.status];
									filteredTasks = filteredTasks.filter(task => statuses.includes(task.status));
								}

								if (filters.priority) {
									const priorities = Array.isArray(filters.priority) ? filters.priority : [filters.priority];
									filteredTasks = filteredTasks.filter(task => priorities.includes(task.priority));
								}

								if (filters.createdBy) {
									filteredTasks = filteredTasks.filter(task => task.createdBy === filters.createdBy);
								}

								if (filters.assignedTo) {
									filteredTasks = filteredTasks.filter(task => task.assignedTo === filters.assignedTo);
								}

								if (filters.type) {
									filteredTasks = filteredTasks.filter(task => task.type === filters.type);
								}

								if (filters.search) {
									const searchLower = filters.search.toLowerCase();
									filteredTasks = filteredTasks.filter(task => 
										task.title.toLowerCase().includes(searchLower) ||
										task.description.toLowerCase().includes(searchLower) ||
										(task.assignedTo && task.assignedTo.toLowerCase().includes(searchLower)) ||
										(task.createdBy && task.createdBy.toLowerCase().includes(searchLower))
									);
								}

								// Sort by creation date (newest first)
								filteredTasks.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

								// Apply pagination
								if (filters.offset && filters.offset > 0) {
									filteredTasks = filteredTasks.slice(filters.offset);
								}

								if (filters.limit && filters.limit > 0) {
									filteredTasks = filteredTasks.slice(0, filters.limit);
								}

								result = { success: true, data: filteredTasks };
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
								const subscribed = taskMonitor.subscribeToTaskUpdates(sessionId, taskIds);
								
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
						case "delete_task":
							await pm.deleteTask(message.data.id);
							wsManager.broadcastTaskDeleted(message.data.id);
							result = { success: true, data: true };
							break;
						case "restart":
							console.log("[DAEMON] Restart command received, spawning new daemon and exiting...");
							await wsManager.stop();
							spawn("yarn", ["run", "daemon"], {
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
                            result = { success: true, data: pm.getAllProfileStates() };
                            break;
                        case "get_profile_state":
                            result = { success: true, data: pm.getProfileState(message.data.name) };
                            break;
                        case "get_profile_metrics":
                            result = { success: true, data: pm.getProfileMetrics(message.data.name) };
                            break;
                        case "get_all_profile_metrics":
                            result = { success: true, data: Object.fromEntries(pm.getAllProfileMetrics()) };
                            break;
                        case "get_profiles_with_states":
                            result = { success: true, data: pm.getProfilesWithStates() };
                            break;
                        case "get_profile_task_queue":
                            result = { success: true, data: pm.getProfileTaskQueue(message.data.name) };
                            break;
                        case "update_profile_status":
                            result = {
                                success: true,
                                data: pm.updateProfileStatus(message.data.name, message.data.isActive),
                            };
                            break;
                        case "get_best_profile_for_task":
                            result = { success: true, data: pm.getBestProfileForTask(message.data.task) };
                            break;
                        case "assign_task_to_profile":
                            result = {
                                success: true,
                                data: pm.assignTaskToProfile(message.data.profileName, message.data.task),
                            };
                            break;
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
						default:
							result = { success: false, error: new Error(`Unknown command: ${message.command}`) };
					}

					socket.write(`${JSON.stringify(result)}\n`);
				} catch (error) {
					console.error("[DAEMON] Error processing command:", error);
					const err = error instanceof Error ? error : new Error(String(error));
					socket.write(`${JSON.stringify({ success: false, error: err.message })}\n`);
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

	// Start the continuous task processing loop in parallel
	pm.processTasksLoop().catch((error) => {
		console.error("[DAEMON] Task processing loop error:", error);
	});

	console.log("[DAEMON] Daemon is running with both TCP server and task processing loop");
}

// Run the daemon
main().catch(console.error);
