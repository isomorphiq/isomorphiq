import { type ChildProcess, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import type { Server as HttpServer } from "node:http";
import { createServer, type Server as NetServer, type Socket } from "node:net";
import { startHttpApi } from "../http-api-server.ts";
import { ProductManager } from "../index.ts";
import { getUserManager } from "../user-manager.ts";
import { WebSocketManager } from "../websocket-server.ts";

export interface ProcessConfig {
	name: string;
	command: string;
	args?: string[];
	cwd?: string;
	env?: Record<string, string>;
	autoRestart?: boolean;
	healthCheck?: {
		port: number;
		path?: string;
		interval: number;
	};
	dependencies?: string[];
}

export interface ProcessStatus {
	name: string;
	pid?: number;
	status: "stopped" | "starting" | "running" | "stopping" | "error";
	uptime?: number;
	restarts: number;
	lastRestart?: Date;
	lastError?: string;
	health?: "healthy" | "unhealthy" | "unknown";
}

export interface ProcessManagerConfig {
	daemonPort: number;
	healthCheckInterval: number;
	maxRestarts: number;
	restartDelay: number;
}

export class ProcessManager extends EventEmitter {
	private processes: Map<string, ChildProcess> = new Map();
	private configs: Map<string, ProcessConfig> = new Map();
	private statuses: Map<string, ProcessStatus> = new Map();
	private healthCheckTimers: Map<string, NodeJS.Timeout> = new Map();
	private restartTimers: Map<string, NodeJS.Timeout> = new Map();
	private config: ProcessManagerConfig;
	private commandServer: NetServer | null = null;
	private productManager: ProductManager | null = null;
	private webSocketManager: WebSocketManager | null = null;
	private httpServer: HttpServer | null = null;

	constructor(config: Partial<ProcessManagerConfig> = {}) {
		super();
		this.config = {
			daemonPort: 3001,
			healthCheckInterval: 30000,
			maxRestarts: 5,
			restartDelay: 5000,
			...config,
		};
	}

	// Initialize the process manager with core services
	async initialize(): Promise<void> {
		console.log("[PROCESS-MANAGER] Initializing process manager...");

		// Initialize core services
		this.productManager = new ProductManager();
		const _userManager = getUserManager();
		this.webSocketManager = new WebSocketManager({ path: "/ws" });
		this.productManager.setWebSocketManager(this.webSocketManager);

		// Start HTTP API server
		const httpPort = Number(process.env.HTTP_PORT) || 3003;
		try {
			this.httpServer = await startHttpApi(this.productManager, httpPort);
			console.log(`[PROCESS-MANAGER] HTTP API server started on port ${httpPort}`);
		} catch (error) {
			console.error("[PROCESS-MANAGER] Failed to start HTTP API server:", error);
			throw error;
		}

		// Attach WebSocket server to HTTP server
		if (this.httpServer) {
			try {
				await this.webSocketManager.start(this.httpServer, { attachUpgradeListener: false });
				console.log("[PROCESS-MANAGER] WebSocket server attached to HTTP server");
			} catch (error) {
				console.error("[PROCESS-MANAGER] Failed to start WebSocket server:", error);
				throw error;
			}
		}

		// Initialize templates and automation
		await this.productManager.initializeTemplates();

		// Start command server for external communication
		await this.startCommandServer();

		// Start task processing loop
		this.startTaskProcessing();

		console.log("[PROCESS-MANAGER] Process manager initialized successfully");
	}

	// Register a process configuration
	registerProcess(config: ProcessConfig): void {
		this.configs.set(config.name, config);
		this.statuses.set(config.name, {
			name: config.name,
			status: "stopped",
			restarts: 0,
			health: "unknown",
		});
		console.log(`[PROCESS-MANAGER] Registered process: ${config.name}`);
	}

	// Start a specific process
	async startProcess(name: string): Promise<boolean> {
		const config = this.configs.get(name);
		if (!config) {
			console.error(`[PROCESS-MANAGER] No configuration found for process: ${name}`);
			return false;
		}

		const status = this.statuses.get(name);
		if (!status) {
			console.error(`[PROCESS-MANAGER] No status found for process: ${name}`);
			return false;
		}
		if (status.status === "running") {
			console.log(`[PROCESS-MANAGER] Process ${name} is already running`);
			return true;
		}

		// Check dependencies
		if (config.dependencies) {
			for (const dep of config.dependencies) {
				const depStatus = this.statuses.get(dep);
				if (!depStatus || depStatus.status !== "running") {
					console.error(`[PROCESS-MANAGER] Dependency ${dep} not running for ${name}`);
					return false;
				}
			}
		}

		console.log(`[PROCESS-MANAGER] Starting process: ${name}`);
		status.status = "starting";
		this.emit("processStarting", name);

		try {
			const child = spawn(config.command, config.args || [], {
				cwd: config.cwd || process.cwd(),
				env: { ...process.env, ...config.env },
				stdio: ["pipe", "pipe", "pipe"],
				detached: false,
			});

			this.processes.set(name, child);
			if (child.pid) {
				status.pid = child.pid;
			}
			delete status.lastError;

			child.on("spawn", () => {
				console.log(`[PROCESS-MANAGER] Process ${name} spawned with PID ${child.pid}`);
				status.status = "running";
				status.uptime = Date.now();
				this.emit("processStarted", name, child.pid ?? undefined);

				// Start health checks if configured
				if (config.healthCheck) {
					this.startHealthCheck(name);
				}
			});

			child.on("exit", (code, signal) => {
				console.log(`[PROCESS-MANAGER] Process ${name} exited with code ${code}, signal ${signal}`);
				this.handleProcessExit(name, code, signal);
			});

			child.on("error", (error) => {
				console.error(`[PROCESS-MANAGER] Process ${name} error:`, error);
				status.status = "error";
				status.lastError = error.message;
				this.emit("processError", name, error);
			});

			// Handle output
			child.stdout?.on("data", (data) => {
				console.log(`[${name.toUpperCase()}] ${data.toString().trim()}`);
			});

			child.stderr?.on("data", (data) => {
				console.error(`[${name.toUpperCase()}] ${data.toString().trim()}`);
			});

			return true;
		} catch (error) {
			console.error(`[PROCESS-MANAGER] Failed to start process ${name}:`, error);
			status.status = "error";
			status.lastError = (error as Error).message;
			this.emit("processError", name, error);
			return false;
		}
	}

	// Stop a specific process
	async stopProcess(name: string, graceful: boolean = true): Promise<boolean> {
		const process = this.processes.get(name);
		const status = this.statuses.get(name);

		if (!process || !status) {
			console.log(`[PROCESS-MANAGER] Process ${name} not found`);
			return true;
		}

		if (status.status === "stopped") {
			console.log(`[PROCESS-MANAGER] Process ${name} already stopped`);
			return true;
		}

		console.log(`[PROCESS-MANAGER] Stopping process: ${name}`);
		status.status = "stopping";
		this.emit("processStopping", name);

		// Stop health checks
		this.stopHealthCheck(name);

		// Clear restart timer
		const restartTimer = this.restartTimers.get(name);
		if (restartTimer) {
			clearTimeout(restartTimer);
			this.restartTimers.delete(name);
		}

		return new Promise((resolve) => {
			const timeout = setTimeout(
				() => {
					console.log(`[PROCESS-MANAGER] Force killing process ${name}`);
					process.kill("SIGKILL");
					this.handleProcessExit(name, -1, "SIGKILL");
					resolve(true);
				},
				graceful ? 10000 : 1000,
			);

			process.once("exit", () => {
				clearTimeout(timeout);
				resolve(true);
			});

			if (graceful) {
				process.kill("SIGTERM");
			} else {
				process.kill("SIGKILL");
			}
		});
	}

	// Restart a specific process
	async restartProcess(name: string): Promise<boolean> {
		console.log(`[PROCESS-MANAGER] Restarting process: ${name}`);
		await this.stopProcess(name, true);

		// Wait a bit before restarting
		await new Promise((resolve) => setTimeout(resolve, this.config.restartDelay));

		return await this.startProcess(name);
	}

	// Handle process exit
	private handleProcessExit(name: string, code: number | null, signal: string | null): void {
		const process = this.processes.get(name);
		const status = this.statuses.get(name);
		const config = this.configs.get(name);

		if (!process || !status) return;

		// Clean up
		this.processes.delete(name);
		this.stopHealthCheck(name);

		status.status = "stopped";
		delete status.uptime;

		this.emit("processStopped", name, code, signal);

		// Auto-restart if configured
		if (config?.autoRestart && code !== 0) {
			status.restarts++;
			status.lastRestart = new Date();

			if (status.restarts < this.config.maxRestarts) {
				console.log(
					`[PROCESS-MANAGER] Auto-restarting ${name} (attempt ${status.restarts}/${this.config.maxRestarts})`,
				);

				const restartTimer = setTimeout(async () => {
					await this.startProcess(name);
				}, this.config.restartDelay);

				this.restartTimers.set(name, restartTimer);
			} else {
				console.error(
					`[PROCESS-MANAGER] Process ${name} exceeded max restarts (${this.config.maxRestarts})`,
				);
				status.status = "error";
				status.lastError = `Exceeded max restarts (${this.config.maxRestarts})`;
				this.emit("processError", name, new Error("Exceeded max restarts"));
			}
		}
	}

	// Start health check for a process
	private startHealthCheck(name: string): void {
		const config = this.configs.get(name);
		if (!config?.healthCheck) return;

		const timer = setInterval(async () => {
			await this.checkProcessHealth(name);
		}, config.healthCheck.interval);

		this.healthCheckTimers.set(name, timer);
	}

	// Stop health check for a process
	private stopHealthCheck(name: string): void {
		const timer = this.healthCheckTimers.get(name);
		if (timer) {
			clearInterval(timer);
			this.healthCheckTimers.delete(name);
		}
	}

	// Check process health
	private async checkProcessHealth(name: string): Promise<void> {
		const config = this.configs.get(name);
		const status = this.statuses.get(name);

		if (!config?.healthCheck || !status) return;

		try {
			const { port, path = "/" } = config.healthCheck;
			const url = `http://localhost:${port}${path}`;

			const response = await fetch(url, {
				method: "GET",
				signal: AbortSignal.timeout(5000),
			});

			if (response.ok) {
				status.health = "healthy";
			} else {
				status.health = "unhealthy";
				console.warn(`[PROCESS-MANAGER] Process ${name} health check failed: ${response.status}`);
			}
		} catch (error) {
			status.health = "unhealthy";
			console.warn(`[PROCESS-MANAGER] Process ${name} health check error:`, error);
		}

		this.emit("healthCheck", name, status.health);
	}

	// Start command server for external communication
	private async startCommandServer(): Promise<void> {
		return new Promise((resolve, reject) => {
			this.commandServer = createServer((socket: Socket) => {
				console.log("[PROCESS-MANAGER] Command client connected");

				let buffer = "";
				socket.on("data", (data) => {
					buffer += data.toString();

					// Process complete messages
					const messages = buffer.split("\n");
					buffer = messages.pop() || "";

					for (const message of messages) {
						if (message.trim()) {
							this.handleCommand(message.trim(), socket);
						}
					}
				});

				socket.on("close", () => {
					console.log("[PROCESS-MANAGER] Command client disconnected");
				});

				socket.on("error", (err) => {
					console.error("[PROCESS-MANAGER] Command socket error:", err.message);
				});
			});

			this.commandServer.on("error", (err: NodeJS.ErrnoException) => {
				if (err.code === "EADDRINUSE") {
					console.error(`[PROCESS-MANAGER] Command port ${this.config.daemonPort} in use`);
				} else {
					console.error("[PROCESS-MANAGER] Command server error:", err);
				}
				reject(err);
			});

			this.commandServer.listen(this.config.daemonPort, () => {
				console.log(`[PROCESS-MANAGER] Command server listening on port ${this.config.daemonPort}`);
				resolve();
			});
		});
	}

	// Handle incoming commands
	private async handleCommand(message: string, socket: Socket): Promise<void> {
		try {
			const command = JSON.parse(message);
			console.log("[PROCESS-MANAGER] Received command:", command.command);

			let result: unknown;
			switch (command.command) {
				case "start_process":
					result = await this.startProcess(command.data.name);
					break;
				case "stop_process":
					result = await this.stopProcess(command.data.name, command.data.graceful);
					break;
				case "restart_process":
					result = await this.restartProcess(command.data.name);
					break;
				case "get_status":
					result = this.getAllStatuses();
					break;
				case "get_process_status":
					result = this.getProcessStatus(command.data.name);
					break;
				case "list_processes":
					result = Array.from(this.configs.keys());
					break;
				// Legacy task management commands
				case "create_task":
					if (!this.productManager) throw new Error("ProductManager not initialized");
					result = await this.productManager.createTask(
						command.data.title,
						command.data.description,
						command.data.priority || "medium",
						command.data.dependencies || [],
						command.data.createdBy,
						command.data.assignedTo,
						command.data.collaborators,
						command.data.watchers,
					);
					if (this.webSocketManager) {
						this.webSocketManager.broadcastTaskCreated(result);
					}
					break;
				case "list_tasks":
					if (!this.productManager) throw new Error("ProductManager not initialized");
					result = await this.productManager.getAllTasks();
					if (this.webSocketManager) {
						this.webSocketManager.broadcastTasksList(result);
					}
					break;
				case "get_task": {
					if (!this.productManager) throw new Error("ProductManager not initialized");
					const tasks = await this.productManager.getAllTasks();
					result = tasks.find((t) => t.id === command.data.id);
					break;
				}
				case "update_task_status": {
					if (!this.productManager) throw new Error("ProductManager not initialized");
					const oldTask = await this.productManager
						.getAllTasks()
						.then((t) => t.find((task) => task.id === command.data.id));
					const oldStatus = oldTask?.status || "todo";
					result = await this.productManager.updateTaskStatus(command.data.id, command.data.status);
					if (this.webSocketManager) {
						this.webSocketManager.broadcastTaskStatusChanged(
							command.data.id,
							oldStatus,
							command.data.status,
							result,
						);
					}
					break;
				}
				case "update_task_priority": {
					if (!this.productManager) throw new Error("ProductManager not initialized");
					const oldTaskPriority = await this.productManager
						.getAllTasks()
						.then((t) => t.find((task) => task.id === command.data.id));
					const oldPriority = oldTaskPriority?.priority || "medium";
					result = await this.productManager.updateTaskPriority(
						command.data.id,
						command.data.priority,
					);
					if (this.webSocketManager) {
						this.webSocketManager.broadcastTaskPriorityChanged(
							command.data.id,
							oldPriority,
							command.data.priority,
							result,
						);
					}
					break;
				}
				case "delete_task":
					if (!this.productManager) throw new Error("ProductManager not initialized");
					await this.productManager.deleteTask(command.data.id);
					if (this.webSocketManager) {
						this.webSocketManager.broadcastTaskDeleted(command.data.id);
					}
					result = { success: true };
					break;
				case "restart":
					console.log("[PROCESS-MANAGER] Restart command received");
					await this.restartAll();
					result = { success: true, message: "Restarting..." };
					break;
				default:
					throw new Error(`Unknown command: ${command.command}`);
			}

			socket.write(`${JSON.stringify(result)}\n`);
		} catch (error) {
			console.error("[PROCESS-MANAGER] Error processing command:", error);
			socket.write(`${JSON.stringify({ error: (error as Error).message })}\n`);
		}
	}

	// Get status of all processes
	getAllStatuses(): Record<string, ProcessStatus> {
		const statuses: Record<string, ProcessStatus> = {};
		for (const [name, status] of this.statuses) {
			statuses[name] = { ...status };
		}
		return statuses;
	}

	// Get status of a specific process
	getProcessStatus(name: string): ProcessStatus | null {
		const status = this.statuses.get(name);
		return status ? { ...status } : null;
	}

	// Start task processing loop
	private startTaskProcessing(): void {
		if (!this.productManager) return;

		this.productManager.processTasksLoop().catch((error) => {
			console.error("[PROCESS-MANAGER] Task processing loop error:", error);
		});
	}

	// Restart all processes
	private async restartAll(): Promise<void> {
		console.log("[PROCESS-MANAGER] Restarting all processes...");

		// Stop all processes
		for (const name of Array.from(this.processes.keys())) {
			await this.stopProcess(name, true);
		}

		// Stop core services
		if (this.webSocketManager) {
			await this.webSocketManager.stop();
		}
		if (this.httpServer) {
			this.httpServer.close();
		}
		if (this.commandServer) {
			this.commandServer.close();
		}

		// Spawn new daemon process
		const { spawn } = await import("node:child_process");
		spawn("npm", ["run", "daemon"], {
			cwd: process.cwd(),
			env: process.env,
			detached: true,
			stdio: "ignore",
			shell: true,
		});

		// Exit current process
		setTimeout(() => process.exit(0), 1000);
	}

	// Graceful shutdown
	async shutdown(): Promise<void> {
		console.log("[PROCESS-MANAGER] Starting graceful shutdown...");

		// Stop all processes
		for (const name of Array.from(this.processes.keys())) {
			await this.stopProcess(name, true);
		}

		// Stop health checks
		for (const timer of this.healthCheckTimers.values()) {
			clearInterval(timer);
		}
		this.healthCheckTimers.clear();

		// Stop restart timers
		for (const timer of this.restartTimers.values()) {
			clearTimeout(timer);
		}
		this.restartTimers.clear();

		// Stop core services
		if (this.webSocketManager) {
			await this.webSocketManager.stop();
		}
		if (this.httpServer) {
			this.httpServer.close();
		}
		if (this.commandServer) {
			this.commandServer.close();
		}

		console.log("[PROCESS-MANAGER] Shutdown complete");
	}
}
