import { spawn } from "node:child_process";
import type http from "node:http";
import { createServer, type Socket } from "node:net";
import { startHttpApi } from "./http-api-server.ts";
import { ProductManager } from "./index.ts";
import { getUserManager } from "./user-manager.ts";
import { WebSocketManager } from "./websocket-server.ts";
import type { Result } from "./core/result.ts";

// Task Manager Daemon - runs the continuous task processing loop and handles MCP requests
async function main() {
	console.log("[DAEMON] Starting Isomorphiq Task Manager Daemon");

	const pm = new ProductManager();
	const userManager = getUserManager();
	const wsManager = new WebSocketManager({ path: "/ws" });
	pm.setWebSocketManager(wsManager);
	console.log("[DAEMON] Initialized ProductManager and UserManager with WebSocket support");

	// Start HTTP API server bound to this ProductManager (shared with WebSocket)
	const httpPort = Number(process.env.HTTP_PORT) || 3003;
	let httpServer: http.Server | undefined;
	httpServer = await startHttpApi(pm, httpPort);
	console.log(`[DAEMON] HTTP API server started on port ${httpPort}`);

	// Attach WebSocket server to the same HTTP server but let HTTP server own the upgrade event.
	// We pass attachUpgradeListener=false to avoid double-handling upgrades when tRPC WS handler is also mounted.
	if (httpServer) {
		try {
			await wsManager.start(httpServer, { attachUpgradeListener: false });
			console.log("[DAEMON] WebSocket server created (noServer mode) on shared HTTP server");
		} catch (error) {
			console.error("[DAEMON] Failed to start WebSocket server:", error);
		}
	}

	// Initialize templates and automation rules
	await pm.initializeTemplates();

	// Display current tasks
	const existingTasks = await pm.getAllTasks();
	console.log(`[DAEMON] Found ${existingTasks.length} existing tasks in database`);

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
						case "update_task_status": {
							try {
								const oldTask = await pm
									.getAllTasks()
									.then((t) => t.find((task) => task.id === message.data.id));
								const oldStatus = oldTask?.status || "todo";
								const task = await pm.updateTaskStatus(message.data.id, message.data.status);
								result = { success: true, data: task };
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
							spawn("npm", ["run", "daemon"], {
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
                            await pm.initializeTemplates();
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
							await pm.loadAutomationRules();
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
