import type { IncomingMessage, ServerResponse } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { ProductManager } from "@isomorphiq/tasks";
import type { WebSocketManager } from "@isomorphiq/realtime";
import { DaemonTcpClient } from "./tcp-client.ts";
import type { Task as CoreTask } from "@isomorphiq/tasks";

// Extended Task interface with additional statuses
interface Task extends Omit<CoreTask, 'status' | 'priority'> {
	id: string;
	title: string;
	description: string;
	status: "todo" | "in-progress" | "done" | "failed" | "cancelled";
	priority: "high" | "medium" | "low";
	createdAt: string;
	updatedAt: string;
	createdBy?: string;
	assignedTo?: string;
	collaborators?: string[];
	watchers?: string[];
	type?: string;
	dependencies?: string[];
}

export interface DashboardMetrics {
	daemon: {
		uptime: number;
		memory: NodeJS.MemoryUsage;
		pid: number;
		lastRestart?: string;
	};
	tasks: {
		total: number;
		pending: number;
		inProgress: number;
		completed: number;
		byPriority: {
			high: number;
			medium: number;
			low: number;
		};
		byStatus: {
			todo: number;
			"in-progress": number;
			done: number;
		};
		recent: Array<{
			id: string;
			title: string;
			status: string;
			priority: string;
			createdAt: string;
			updatedAt: string;
			createdBy?: string;
			assignedTo?: string;
		}>;
	};
	health: {
		status: "healthy" | "unhealthy" | "degraded";
		lastUpdate: string;
		wsConnections: number;
		tcpConnected: boolean;
		memoryUsage: number;
	};
	system: {
		nodeVersion: string;
		platform: string;
		arch: string;
		totalmem: number;
		freemem: number;
	};
}

export class DashboardServer {
	private productManager: ProductManager;
	private webSocketManager: WebSocketManager;
	private tcpClient: DaemonTcpClient;
	private wsServer: WebSocketServer | null = null;
	private activeConnections: Set<WebSocket> = new Set();

	constructor(productManager: ProductManager, webSocketManager: WebSocketManager) {
		this.productManager = productManager;
		this.webSocketManager = webSocketManager;
		this.tcpClient = new DaemonTcpClient();
	}

	// Initialize WebSocket server for dashboard real-time updates
	async initializeWebSocketServer(httpServer: import("node:http").Server): Promise<void> {
		this.wsServer = new WebSocketServer({ 
			server: httpServer, 
			path: "/dashboard-ws" 
		});

		this.wsServer.on("connection", (ws: WebSocket, req) => {
			console.log("[DASHBOARD] WebSocket client connected");
			this.activeConnections.add(ws);

			// Send initial dashboard state
			this.sendInitialState(ws);

			ws.on("message", (message) => {
				try {
					const data = JSON.parse(message.toString());
					this.handleWebSocketMessage(ws, data);
				} catch (error) {
					console.error("[DASHBOARD] Invalid WebSocket message:", error);
				}
			});

			ws.on("close", () => {
				console.log("[DASHBOARD] WebSocket client disconnected");
				this.activeConnections.delete(ws);
			});

			ws.on("error", (error) => {
				console.error("[DASHBOARD] WebSocket error:", error);
				this.activeConnections.delete(ws);
			});
		});

		// Set up task event broadcasting from the main WebSocket manager
		this.setupTaskEventForwarding();
		
		// Set up periodic metrics broadcast for all connected clients
		this.setupPeriodicMetricsBroadcast();
		
		console.log("[DASHBOARD] WebSocket server initialized for real-time updates");
	}

	// Send initial state to newly connected dashboard client
	private async sendInitialState(ws: WebSocket): Promise<void> {
		try {
			const metrics = await this.getMetrics();
			const coreTasks = await this.productManager.getAllTasks();
			const tasks = coreTasks.map(task => ({
				...task,
				status: (task.status as Task["status"]) || "todo",
				priority: (task.priority as Task["priority"]) || "medium"
			}));
			
			ws.send(JSON.stringify({
				type: "initial_state",
				data: { metrics, tasks }
			}));
		} catch (error) {
			console.error("[DASHBOARD] Error sending initial state:", error);
			ws.send(JSON.stringify({
				type: "error",
				message: "Failed to load initial data"
			}));
		}
	}

	// Handle incoming WebSocket messages from dashboard
	private async handleWebSocketMessage(ws: WebSocket, data: any): Promise<void> {
		switch (data.type) {
			case "refresh_metrics":
				try {
					const metrics = await this.getMetrics();
					ws.send(JSON.stringify({
						type: "metrics_update",
						data: metrics
					}));
				} catch (error) {
					ws.send(JSON.stringify({
						type: "error",
						message: "Failed to refresh metrics"
					}));
				}
				break;
			case "refresh_tasks":
				try {
					const tasks = await this.productManager.getAllTasks();
					ws.send(JSON.stringify({
						type: "tasks_update",
						data: tasks
					}));
				} catch (error) {
					ws.send(JSON.stringify({
						type: "error",
						message: "Failed to refresh tasks"
					}));
				}
				break;
			default:
				console.log("[DASHBOARD] Unknown WebSocket message type:", data.type);
		}
	}

	// Set up forwarding of task events from the main WebSocket manager
	private setupTaskEventForwarding(): void {
		// Listen to task events from the main WebSocket manager
		(this.webSocketManager as any).on?.("task_created", (task: Task) => {
			this.broadcastToDashboard({
				type: "task_created",
				data: task
			});
		});

		(this.webSocketManager as any).on?.("task_status_changed", (taskId: string, oldStatus: string, newStatus: string, task: Task) => {
			this.broadcastToDashboard({
				type: "task_status_changed",
				data: { taskId, oldStatus, newStatus, task }
			});
		});

		(this.webSocketManager as any).on?.("task_priority_changed", (taskId: string, oldPriority: string, newPriority: string, task: Task) => {
			this.broadcastToDashboard({
				type: "task_priority_changed",
				data: { taskId, oldPriority, newPriority, task }
			});
		});

		(this.webSocketManager as any).on?.("task_deleted", (taskId: string) => {
			this.broadcastToDashboard({
				type: "task_deleted",
				data: { taskId }
			});
		});
	}

	// Broadcast message to all connected dashboard clients
	private broadcastToDashboard(message: any): void {
		const messageStr = JSON.stringify(message);
		
		this.activeConnections.forEach((ws) => {
			if (ws.readyState === WebSocket.OPEN) {
				try {
					ws.send(messageStr);
				} catch (error) {
					console.error("[DASHBOARD] Error broadcasting to WebSocket client:", error);
					this.activeConnections.delete(ws);
				}
			} else {
				// Remove closed connections
				this.activeConnections.delete(ws);
			}
		});
	}

	// Set up periodic metrics broadcast for real-time updates
	private setupPeriodicMetricsBroadcast(): void {
		// Broadcast metrics every 2 seconds as required
		setInterval(async () => {
			if (this.activeConnections.size > 0) {
				try {
					const metrics = await this.getMetrics();
					this.broadcastToDashboard({
						type: "metrics_update",
						data: metrics
					});
				} catch (error) {
					console.error("[DASHBOARD] Error broadcasting metrics:", error);
				}
			}
		}, 2000);
	}

	// Get connection count for dashboard
	getDashboardConnectionCount(): number {
		return this.activeConnections.size;
	}

	async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
		const url = new URL(req.url || "", `http://${req.headers.host}`);
		
		try {
			switch (url.pathname) {
				case "/":
				case "/dashboard":
					await this.serveDashboard(req, res);
					break;
				case "/api/metrics":
					await this.serveMetrics(req, res);
					break;
                case "/api/tasks":
                    if (req.method === "GET") {
                        await this.serveTasks(req, res);
                    } else if (req.method === "POST") {
                        await this.createTask(req, res);
                    } else {
                        this.serve404(res);
                    }
                    break;
                case "/api/tasks/search":
                    if (req.method === "GET") {
                        await this.searchTasks(req, res);
                    } else {
                        this.serve404(res);
                    }
                    break;
				case "/api/tasks/create":
					await this.createTask(req, res);
					break;
				case "/api/tasks/update":
					if (req.method === "PUT" || req.method === "PATCH") {
						await this.updateTask(req, res);
					} else {
						this.serve404(res);
					}
					break;
				case "/api/tasks/delete":
					if (req.method === "DELETE") {
						await this.deleteTask(req, res);
					} else {
						this.serve404(res);
					}
					break;
				case "/api/tasks/cancel":
					if (req.method === "POST") {
						await this.cancelTask(req, res);
					} else {
						this.serve404(res);
					}
					break;
				case "/api/tasks/retry":
					if (req.method === "POST") {
						await this.retryTask(req, res);
					} else {
						this.serve404(res);
					}
					break;
				case "/api/queue/status":
					await this.serveQueueStatus(req, res);
					break;
				case "/api/health":
					await this.serveHealth(req, res);
					break;
				case "/api/logs":
					await this.serveLogs(req, res);
					break;
				case "/api/status":
					await this.serveSystemStatus(req, res);
					break;
				case "/api/performance":
					await this.servePerformanceMetrics(req, res);
					break;
				default:
					this.serve404(res);
					break;
			}
		} catch (error) {
			console.error("[DASHBOARD] Error handling request:", error);
			this.serveError(res, error);
		}
	}

	private async serveDashboard(req: IncomingMessage, res: ServerResponse): Promise<void> {
		const html = this.getDashboardHTML();
		res.writeHead(200, { "Content-Type": "text/html" });
		res.end(html);
	}

	private async serveMetrics(req: IncomingMessage, res: ServerResponse): Promise<void> {
		const metrics = await this.getMetrics();
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify(metrics));
	}

	private async serveTasks(req: IncomingMessage, res: ServerResponse): Promise<void> {
		const url = new URL(req.url || "", `http://${req.headers.host}`);
		const status = url.searchParams.get("status");
		const priority = url.searchParams.get("priority");
		
		const coreTasks = await this.productManager.getAllTasks();
		const tasks = coreTasks.map(task => ({
			...task,
			status: (task.status as Task["status"]) || "todo",
			priority: (task.priority as Task["priority"]) || "medium"
		}));
		let filteredTasks = tasks;

		if (status && status !== "all") {
			filteredTasks = filteredTasks.filter(task => task.status === status);
		}

		if (priority && priority !== "all") {
			filteredTasks = filteredTasks.filter(task => task.priority === priority);
		}

		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify(filteredTasks));
	}

	private async searchTasks(req: IncomingMessage, res: ServerResponse): Promise<void> {
		try {
			const url = new URL(req.url || "", `http://${req.headers.host}`);
			const query = url.searchParams.get("q") || "";
			const status = url.searchParams.get("status");
			const priority = url.searchParams.get("priority");
			
			const coreTasks = await this.productManager.getAllTasks();
			const allTasks = coreTasks.map(task => ({
				...task,
				status: (task.status as Task["status"]) || "todo",
				priority: (task.priority as Task["priority"]) || "medium"
			}));
			let filteredTasks = allTasks;

			// Apply text search
			if (query.trim()) {
				const lowerQuery = query.toLowerCase();
				filteredTasks = filteredTasks.filter(task => 
					task.title.toLowerCase().includes(lowerQuery) ||
					task.description.toLowerCase().includes(lowerQuery) ||
					(task.assignedTo && task.assignedTo.toLowerCase().includes(lowerQuery)) ||
					(task.createdBy && task.createdBy.toLowerCase().includes(lowerQuery))
				);
			}

			// Apply status filter
			if (status && status !== "all") {
				filteredTasks = filteredTasks.filter(task => task.status === status);
			}

			// Apply priority filter
			if (priority && priority !== "all") {
				filteredTasks = filteredTasks.filter(task => task.priority === priority);
			}

			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify(filteredTasks));
		} catch (error) {
			res.writeHead(500, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ 
				error: error instanceof Error ? error.message : "Search failed" 
			}));
		}
	}

	private async createTask(req: IncomingMessage, res: ServerResponse): Promise<void> {
		try {
			const body = await this.parseRequestBody(req);
			const taskData = JSON.parse(body);
			
			const result = await this.tcpClient.createTask(taskData);
			
			if (result.success) {
				res.writeHead(201, { "Content-Type": "application/json" });
				res.end(JSON.stringify(result));
			} else {
				res.writeHead(400, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ success: false, error: result.error?.message || "Failed to create task" }));
			}
		} catch (error) {
			res.writeHead(400, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ 
				success: false, 
				error: error instanceof Error ? error.message : "Invalid request" 
			}));
		}
	}

	private async updateTask(req: IncomingMessage, res: ServerResponse): Promise<void> {
		try {
			const body = await this.parseRequestBody(req);
			const { id, status, priority } = JSON.parse(body);
			
			if (!id) {
				res.writeHead(400, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ success: false, error: "Task ID is required" }));
				return;
			}
			
			let result;
			if (status) {
				result = await this.tcpClient.updateTaskStatus(id, status);
			} else if (priority) {
				result = await this.tcpClient.updateTaskPriority(id, priority);
			} else {
				res.writeHead(400, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ success: false, error: "Status or priority is required" }));
				return;
			}
			
			if (result.success) {
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify(result));
			} else {
				res.writeHead(400, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ success: false, error: result.error?.message || "Failed to update task" }));
			}
		} catch (error) {
			res.writeHead(400, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ 
				success: false, 
				error: error instanceof Error ? error.message : "Invalid request" 
			}));
		}
	}

	private async deleteTask(req: IncomingMessage, res: ServerResponse): Promise<void> {
		try {
			const url = new URL(req.url || "", `http://${req.headers.host}`);
			const taskId = url.searchParams.get("id");
			
			if (!taskId) {
				res.writeHead(400, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ success: false, error: "Task ID is required" }));
				return;
			}
			
			const result = await this.tcpClient.deleteTask(taskId);
			
			if (result.success) {
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify(result));
			} else {
				res.writeHead(400, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ success: false, error: result.error?.message || "Failed to delete task" }));
			}
		} catch (error) {
			res.writeHead(400, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ 
				success: false, 
				error: error instanceof Error ? error.message : "Invalid request" 
			}));
		}
	}

	private async cancelTask(req: IncomingMessage, res: ServerResponse): Promise<void> {
		try {
			const body = await this.parseRequestBody(req);
			const { id } = JSON.parse(body);
			
			if (!id) {
				res.writeHead(400, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ success: false, error: "Task ID is required" }));
				return;
			}
			
			const result = await this.tcpClient.updateTaskStatus(id, "cancelled");
			
			if (result.success) {
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify(result));
			} else {
				res.writeHead(400, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ success: false, error: result.error?.message || "Failed to cancel task" }));
			}
		} catch (error) {
			res.writeHead(400, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ 
				success: false, 
				error: error instanceof Error ? error.message : "Invalid request" 
			}));
		}
	}

	private async retryTask(req: IncomingMessage, res: ServerResponse): Promise<void> {
		try {
			const body = await this.parseRequestBody(req);
			const { id } = JSON.parse(body);
			
			if (!id) {
				res.writeHead(400, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ success: false, error: "Task ID is required" }));
				return;
			}
			
			const result = await this.tcpClient.updateTaskStatus(id, "todo");
			
			if (result.success) {
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify(result));
			} else {
				res.writeHead(400, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ success: false, error: result.error?.message || "Failed to retry task" }));
			}
		} catch (error) {
			res.writeHead(400, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ 
				success: false, 
				error: error instanceof Error ? error.message : "Invalid request" 
			}));
		}
	}

	private async serveQueueStatus(req: IncomingMessage, res: ServerResponse): Promise<void> {
		try {
			const coreTasks = await this.productManager.getAllTasks();
			const tasksData = coreTasks.map((task: any) => ({
				...task,
				status: (task.status as Task["status"]) || "todo",
				priority: (task.priority as Task["priority"]) || "medium",
				createdAt: task.createdAt instanceof Date ? task.createdAt.toISOString() : task.createdAt,
				updatedAt: task.updatedAt instanceof Date ? task.updatedAt.toISOString() : task.updatedAt
			})) as Task[];
			
			const queueStatus = {
				total: tasksData.length,
				pending: tasksData.filter(t => t.status === "todo").length,
				inProgress: tasksData.filter(t => t.status === "in-progress").length,
				completed: tasksData.filter(t => t.status === "done").length,
				failed: tasksData.filter(t => t.status === "failed" || t.status === "cancelled").length,
				highPriority: tasksData.filter(t => t.priority === "high" && (t.status === "todo" || t.status === "in-progress")).length,
				mediumPriority: tasksData.filter(t => t.priority === "medium" && (t.status === "todo" || t.status === "in-progress")).length,
				lowPriority: tasksData.filter(t => t.priority === "low" && (t.status === "todo" || t.status === "in-progress")).length,
				queueByPriority: {
					high: tasksData.filter(t => t.priority === "high" && (t.status === "todo" || t.status === "in-progress"))
						.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
					medium: tasksData.filter(t => t.priority === "medium" && (t.status === "todo" || t.status === "in-progress"))
						.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
					low: tasksData.filter(t => t.priority === "low" && (t.status === "todo" || t.status === "in-progress"))
						.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
				},
				failedTasks: tasksData.filter(t => t.status === "failed" || t.status === "cancelled")
					.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
					.slice(0, 10),
				processingTimes: {
					averageProcessingTime: this.calculateAverageProcessingTime(tasksData),
					fastestTask: this.getFastestTask(tasksData),
					slowestTask: this.getSlowestTask(tasksData)
				}
			};
			
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify(queueStatus));
		} catch (error) {
			res.writeHead(500, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ 
				error: error instanceof Error ? error.message : "Failed to fetch queue status" 
			}));
		}
	}

	private calculateAverageProcessingTime(tasks: Task[]): number {
		const completedTasks = tasks.filter(t => t.status === "done");
		if (completedTasks.length === 0) return 0;
		
		const totalTime = completedTasks.reduce((sum, task) => {
			const created = new Date(task.createdAt).getTime();
			const updated = new Date(task.updatedAt).getTime();
			return sum + (updated - created);
		}, 0);
		
		return Math.round(totalTime / completedTasks.length / 1000); // Return in seconds
	}

	private getFastestTask(tasks: Task[]): Task | null {
		const completedTasks = tasks.filter(t => t.status === "done");
		if (completedTasks.length === 0) return null;
		
		return completedTasks.reduce((fastest, task) => {
			const created = new Date(task.createdAt).getTime();
			const updated = new Date(task.updatedAt).getTime();
			const duration = updated - created;
			
			const fastestCreated = new Date(fastest.createdAt).getTime();
			const fastestUpdated = new Date(fastest.updatedAt).getTime();
			const fastestDuration = fastestUpdated - fastestCreated;
			
			return duration < fastestDuration ? task : fastest;
		});
	}

	private getSlowestTask(tasks: Task[]): Task | null {
		const completedTasks = tasks.filter(t => t.status === "done");
		if (completedTasks.length === 0) return null;
		
		return completedTasks.reduce((slowest, task) => {
			const created = new Date(task.createdAt).getTime();
			const updated = new Date(task.updatedAt).getTime();
			const duration = updated - created;
			
			const slowestCreated = new Date(slowest.createdAt).getTime();
			const slowestUpdated = new Date(slowest.updatedAt).getTime();
			const slowestDuration = slowestUpdated - slowestCreated;
			
			return duration > slowestDuration ? task : slowest;
		});
	}

	private async serveHealth(req: IncomingMessage, res: ServerResponse): Promise<void> {
		try {
			const wsStatus = await this.tcpClient.getWebSocketStatus();
			const memUsage = process.memoryUsage();
			
			const health = {
				status: "healthy",
				timestamp: new Date().toISOString(),
				daemon: {
					pid: process.pid,
					uptime: process.uptime(),
					memory: {
						used: memUsage.heapUsed,
						total: memUsage.heapTotal,
						external: memUsage.external,
					},
				},
				websocket: wsStatus.success ? wsStatus.data : { connected: false },
			};
			
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify(health));
		} catch (error) {
			res.writeHead(500, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ 
				status: "unhealthy", 
				error: error instanceof Error ? error.message : "Health check failed" 
			}));
		}
	}

	private async serveLogs(req: IncomingMessage, res: ServerResponse): Promise<void> {
		try {
			const url = new URL(req.url || "", `http://${req.headers.host}`);
			const limit = parseInt(url.searchParams.get("limit") || "50");
			const level = url.searchParams.get("level") || "all";
			
			// Get recent tasks as "logs" for now
			const tasks = await this.productManager.getAllTasks();
			const recentTasks = tasks
				.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
				.slice(0, limit)
				.map(task => ({
					id: task.id,
					type: "task_update",
					message: `Task "${task.title}" status changed to ${task.status}`,
					timestamp: task.updatedAt,
					level: task.status === "done" ? "info" : task.status === "in-progress" ? "warn" : "debug",
					data: {
						taskId: task.id,
						title: task.title,
						status: task.status,
						priority: task.priority,
					},
				}));
			
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify(recentTasks));
		} catch (error) {
			res.writeHead(500, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ 
				error: error instanceof Error ? error.message : "Failed to fetch logs" 
			}));
		}
	}

	private async serveSystemStatus(req: IncomingMessage, res: ServerResponse): Promise<void> {
		try {
			const tasksData = await this.productManager.getAllTasks();
			const tcpConnected = await this.tcpClient.checkConnection();
			const memUsage = process.memoryUsage();
			
			const systemStatus = {
				daemon: {
					pid: process.pid,
					uptime: process.uptime(),
					memory: {
						used: memUsage.heapUsed,
						total: memUsage.heapTotal,
						external: memUsage.external,
						percentage: Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100)
					},
					status: "running"
				},
				tasks: {
					total: tasksData.length,
					pending: tasksData.filter(t => t.status === "todo").length,
					inProgress: tasksData.filter(t => t.status === "in-progress").length,
					completed: tasksData.filter(t => t.status === "done").length,
					failed: tasksData.filter(t => t.status === "failed" || t.status === "cancelled").length
				},
				connections: {
					websocket: this.activeConnections.size,
					tcp: tcpConnected
				},
				system: {
					nodeVersion: process.version,
					platform: process.platform,
					arch: process.arch,
					totalmem: require("os").totalmem(),
					freemem: require("os").freemem()
				},
				timestamp: new Date().toISOString()
			};
			
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify(systemStatus));
		} catch (error) {
			res.writeHead(500, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ 
				error: error instanceof Error ? error.message : "Failed to fetch system status" 
			}));
		}
	}

	private async servePerformanceMetrics(req: IncomingMessage, res: ServerResponse): Promise<void> {
		try {
			const coreTasks = await this.productManager.getAllTasks();
			const tasksData = coreTasks.map(task => ({
				...task,
				status: (task.status as Task["status"]) || "todo",
				priority: (task.priority as Task["priority"]) || "medium"
			}));
			const memUsage = process.memoryUsage();
			const cpuUsage = process.cpuUsage();
			
			// Calculate task processing metrics
			const completedTasks = tasksData.filter(t => t.status === "done");
			const averageProcessingTime = completedTasks.length > 0 ? 
				completedTasks.reduce((sum, task) => {
					const created = new Date(task.createdAt).getTime();
					const updated = new Date(task.updatedAt).getTime();
					return sum + (updated - created);
				}, 0) / completedTasks.length : 0;

			const performance = {
				memory: {
					heap: {
						used: memUsage.heapUsed,
						total: memUsage.heapTotal,
						percentage: Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100)
					},
					external: memUsage.external,
					rss: memUsage.rss
				},
				cpu: {
					user: cpuUsage.user,
					system: cpuUsage.system
				},
				tasks: {
					throughput: {
						completed: completedTasks.length,
						averageProcessingTime: Math.round(averageProcessingTime / 1000), // seconds
						tasksPerMinute: completedTasks.length > 0 ? 
							Math.round(completedTasks.length / (process.uptime() / 60)) : 0
					},
					queue: {
						pending: tasksData.filter(t => t.status === "todo").length,
						inProgress: tasksData.filter(t => t.status === "in-progress").length,
						failed: tasksData.filter(t => t.status === "failed" || t.status === "cancelled").length
					}
				},
				daemon: {
					uptime: process.uptime(),
					pid: process.pid,
					connections: this.activeConnections.size
				},
				timestamp: new Date().toISOString()
			};
			
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify(performance));
		} catch (error) {
			res.writeHead(500, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ 
				error: error instanceof Error ? error.message : "Failed to fetch performance metrics" 
			}));
		}
	}

	private parseRequestBody(req: IncomingMessage): Promise<string> {
		return new Promise((resolve, reject) => {
			let body = "";
			req.on("data", (chunk) => {
				body += chunk.toString();
			});
			req.on("end", () => {
				resolve(body);
			});
			req.on("error", (error) => {
				reject(error);
			});
		});
	}

	private serve404(res: ServerResponse): void {
		res.writeHead(404, { "Content-Type": "text/plain" });
		res.end("Not Found");
	}

	private serveError(res: ServerResponse, error: unknown): void {
		const message = error instanceof Error ? error.message : "Unknown error";
		res.writeHead(500, { "Content-Type": "text/plain" });
		res.end(`Internal Server Error: ${message}`);
	}

	private async getMetrics(): Promise<DashboardMetrics> {
		const coreTasks = await this.productManager.getAllTasks();
		const tasks = coreTasks.map(task => ({
			...task,
			status: (task.status as Task["status"]) || "todo",
			priority: (task.priority as Task["priority"]) || "medium"
		}));
		const memUsage = process.memoryUsage();
		const tcpConnected = await this.tcpClient.checkConnection();
		
		const taskMetrics = {
			total: tasks.length,
			pending: tasks.filter(t => t.status === "todo").length,
			inProgress: tasks.filter(t => t.status === "in-progress").length,
			completed: tasks.filter(t => t.status === "done").length,
			byPriority: {
				high: tasks.filter(t => t.priority === "high").length,
				medium: tasks.filter(t => t.priority === "medium").length,
				low: tasks.filter(t => t.priority === "low").length,
			},
			byStatus: {
				todo: tasks.filter(t => t.status === "todo").length,
				"in-progress": tasks.filter(t => t.status === "in-progress").length,
				done: tasks.filter(t => t.status === "done").length,
			},
			recent: tasks
				.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
				.slice(0, 10)
				.map(t => ({
					id: t.id,
					title: t.title,
					status: t.status,
					priority: t.priority,
					createdAt: t.createdAt instanceof Date ? t.createdAt.toISOString() : t.createdAt,
					updatedAt: t.updatedAt instanceof Date ? t.updatedAt.toISOString() : t.updatedAt,
					createdBy: t.createdBy,
					assignedTo: t.assignedTo,
				})),
		};

		const memoryUsagePercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
		const healthStatus = tcpConnected && memoryUsagePercent < 90 ? "healthy" : 
			memoryUsagePercent > 90 ? "unhealthy" : "degraded";

		return {
			daemon: {
				uptime: process.uptime(),
				memory: memUsage,
				pid: process.pid,
			},
			tasks: taskMetrics,
			health: {
				status: healthStatus,
				lastUpdate: new Date().toISOString(),
				wsConnections: (this.webSocketManager as any).getConnectionCount?.() || 0,
				tcpConnected,
				memoryUsage: Math.round(memoryUsagePercent),
			},
			system: {
				nodeVersion: process.version,
				platform: process.platform,
				arch: process.arch,
				totalmem: require("os").totalmem(),
				freemem: require("os").freemem(),
			},
		};
	}

	private getDashboardHTML(): string {
		return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Task Manager Dashboard</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        /* Base styles */
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif; 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            color: #1f2937;
        }
        
        .container { 
            max-width: 1400px; 
            margin: 0 auto; 
            padding: 20px; 
        }
        
        /* Header */
        .header { 
            background: white; 
            border-radius: 12px; 
            padding: 24px; 
            margin-bottom: 24px; 
            box-shadow: 0 10px 30px rgba(0,0,0,0.1); 
            position: relative;
        }
        
        .header h1 {
            font-size: 2rem;
            font-weight: 700;
            color: #1f2937;
            margin-bottom: 12px;
        }
        
        .status-bar {
            display: flex;
            align-items: center;
            gap: 20px;
            font-size: 0.9rem;
            color: #6b7280;
            flex-wrap: wrap;
        }
        
        .health-indicator { 
            display: inline-block; 
            width: 12px; 
            height: 12px; 
            border-radius: 50%; 
            margin-right: 8px; 
            animation: pulse 2s infinite;
        }
        
        .health-indicator.healthy { background: #10b981; }
        .health-indicator.unhealthy { background: #ef4444; }
        .health-indicator.degraded { background: #f59e0b; }
        
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }
        
        .auto-refresh { 
            position: absolute;
            top: 24px;
            right: 24px;
            font-size: 0.85rem; 
            color: #6b7280;
            background: rgba(255,255,255,0.9);
            padding: 4px 8px;
            border-radius: 4px;
        }
        
        /* Metrics Grid */
        .metrics { 
            display: grid; 
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); 
            gap: 20px; 
            margin-bottom: 24px; 
        }
        
        .metric-card { 
            background: white; 
            border-radius: 12px; 
            padding: 24px; 
            box-shadow: 0 4px 12px rgba(0,0,0,0.1); 
            transition: transform 0.2s, box-shadow 0.2s;
            position: relative;
            overflow: hidden;
        }
        
        .metric-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 25px rgba(0,0,0,0.15);
        }
        
        .metric-card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 4px;
            background: linear-gradient(90deg, #3b82f6, #8b5cf6);
        }
        
        .metric-value { 
            font-size: 2.5rem; 
            font-weight: 700; 
            color: #3b82f6; 
            line-height: 1;
            margin-bottom: 8px;
        }
        
        .metric-label { 
            color: #6b7280; 
            font-size: 0.875rem;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        
        .metric-change {
            position: absolute;
            top: 24px;
            right: 24px;
            font-size: 0.75rem;
            padding: 2px 6px;
            border-radius: 4px;
        }
        
        .metric-change.positive {
            background: #d1fae5;
            color: #065f46;
        }
        
        .metric-change.negative {
            background: #fee2e2;
            color: #991b1b;
        }
        
        /* Forms */
        .task-form { 
            background: white; 
            border-radius: 12px; 
            padding: 24px; 
            margin-bottom: 24px; 
            box-shadow: 0 4px 12px rgba(0,0,0,0.1); 
        }
        
        .form-group { 
            margin-bottom: 20px; 
        }
        
        .form-group label { 
            display: block; 
            margin-bottom: 8px; 
            font-weight: 600; 
            color: #374151;
            font-size: 0.875rem;
        }
        
        .form-group input, .form-group textarea, .form-group select { 
            width: 100%; 
            padding: 12px 16px; 
            border: 2px solid #e5e7eb; 
            border-radius: 8px; 
            font-size: 14px; 
            transition: border-color 0.2s, box-shadow 0.2s;
        }
        
        .form-group input:focus, .form-group textarea:focus, .form-group select:focus {
            outline: none;
            border-color: #3b82f6;
            box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
        }
        
        .form-group textarea { 
            resize: vertical; 
            min-height: 100px; 
        }
        
        .form-row {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 16px;
        }
        
        .form-actions { 
            display: flex; 
            gap: 12px; 
            flex-wrap: wrap;
        }
        
        /* Buttons */
        .btn { 
            padding: 12px 24px; 
            border: none; 
            border-radius: 8px; 
            font-size: 14px; 
            font-weight: 600; 
            cursor: pointer; 
            transition: all 0.2s; 
            display: inline-flex;
            align-items: center;
            gap: 8px;
        }
        
        .btn-primary { 
            background: linear-gradient(135deg, #3b82f6, #1d4ed8); 
            color: white; 
        }
        
        .btn-primary:hover { 
            background: linear-gradient(135deg, #1d4ed8, #1e40af); 
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
        }
        
        .btn-secondary { 
            background: #6b7280; 
            color: white; 
        }
        
        .btn-secondary:hover { 
            background: #4b5563; 
        }
        
        .btn-danger { 
            background: #ef4444; 
            color: white; 
        }
        
        .btn-danger:hover { 
            background: #dc2626; 
        }
        
        .btn-sm {
            padding: 6px 12px;
            font-size: 12px;
        }
        
        .btn:disabled { 
            opacity: 0.5; 
            cursor: not-allowed; 
            transform: none !important;
        }
        
        /* Filters */
        .filters { 
            background: white; 
            border-radius: 12px; 
            padding: 20px; 
            margin-bottom: 24px; 
            box-shadow: 0 4px 12px rgba(0,0,0,0.1); 
        }
        
        .filter-group { 
            display: inline-block; 
            margin-right: 20px; 
            margin-bottom: 10px;
        }
        
        .filter-group label { 
            margin-right: 8px; 
            font-weight: 600;
            font-size: 0.875rem;
        }
        
        .filter-group select { 
            padding: 8px 12px; 
            border: 2px solid #e5e7eb; 
            border-radius: 6px; 
            font-size: 14px;
            transition: border-color 0.2s;
        }
        
        .filter-group select:focus {
            outline: none;
            border-color: #3b82f6;
        }
        
        /* Tasks Section */
        .tasks-section { 
            background: white; 
            border-radius: 12px; 
            padding: 24px; 
            box-shadow: 0 4px 12px rgba(0,0,0,0.1); 
        }
        
        .tasks-header {
            display: flex;
            justify-content: between;
            align-items: center;
            margin-bottom: 20px;
            flex-wrap: wrap;
            gap: 16px;
        }
        
        .tasks-header h2 {
            font-size: 1.5rem;
            font-weight: 700;
            color: #1f2937;
        }
        
        .task-item { 
            border-bottom: 1px solid #e5e7eb; 
            padding: 20px 0; 
            transition: background-color 0.2s;
            border-radius: 8px;
        }
        
        .task-item:hover {
            background: #f9fafb;
            padding-left: 16px;
            padding-right: 16px;
        }
        
        .task-item:last-child { 
            border-bottom: none; 
        }
        
        .task-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 12px;
        }
        
        .task-title { 
            font-weight: 600; 
            font-size: 1.1rem;
            color: #1f2937;
            margin-bottom: 4px;
            flex: 1;
        }
        
        .task-actions {
            display: flex;
            gap: 8px;
        }
        
        .task-meta { 
            display: flex; 
            gap: 16px; 
            font-size: 0.875rem; 
            color: #6b7280; 
            flex-wrap: wrap;
            align-items: center;
        }
        
        .status { 
            padding: 4px 12px; 
            border-radius: 20px; 
            font-size: 0.75rem; 
            font-weight: 600; 
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        
        .status.todo { background: #fef3c7; color: #92400e; }
        .status.in-progress { background: #dbeafe; color: #1e40af; }
        .status.done { background: #d1fae5; color: #065f46; }
        .status.failed { background: #fee2e2; color: #991b1b; }
        .status.cancelled { background: #f3f4f6; color: #6b7280; }
        
        .priority { 
            padding: 4px 12px; 
            border-radius: 20px; 
            font-size: 0.75rem; 
            font-weight: 600; 
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        
        .priority.high { background: #fee2e2; color: #991b1b; }
        .priority.medium { background: #fef3c7; color: #92400e; }
        .priority.low { background: #e0e7ff; color: #3730a3; }
        
        /* Messages */
        .loading { 
            text-align: center; 
            padding: 60px 20px; 
            color: #6b7280;
            font-size: 1.1rem;
        }
        
        .error { 
            background: linear-gradient(135deg, #fef2f2, #fee2e2); 
            color: #991b1b; 
            padding: 16px 20px; 
            border-radius: 8px; 
            margin-bottom: 20px; 
            border-left: 4px solid #ef4444;
            font-weight: 500;
        }
        
        .success { 
            background: linear-gradient(135deg, #f0fdf4, #dcfce7); 
            color: #065f46; 
            padding: 16px 20px; 
            border-radius: 8px; 
            margin-bottom: 20px; 
            border-left: 4px solid #10b981;
            font-weight: 500;
        }
        
        .warning {
            background: linear-gradient(135deg, #fffbeb, #fef3c7); 
            color: #92400e; 
            padding: 16px 20px; 
            border-radius: 8px; 
            margin-bottom: 20px; 
            border-left: 4px solid #f59e0b;
            font-weight: 500;
        }
        
        /* Tabs */
        .tabs {
            display: flex;
            gap: 8px;
            margin-bottom: 24px;
            border-bottom: 2px solid #e5e7eb;
        }
        
        .tab {
            padding: 12px 20px;
            background: none;
            border: none;
            border-bottom: 2px solid transparent;
            color: #6b7280;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
            margin-bottom: -2px;
        }
        
        .tab:hover {
            color: #374151;
            background: #f9fafb;
        }
        
        .tab.active {
            color: #3b82f6;
            border-bottom-color: #3b82f6;
        }
        
        .tab-content {
            display: none;
        }
        
        .tab-content.active {
            display: block;
        }
        
        /* Modal */
        .modal {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.5);
            z-index: 1000;
            animation: fadeIn 0.2s;
        }
        
        .modal.show {
            display: flex;
            align-items: center;
            justify-content: center;
        }
        
        .modal-content {
            background: white;
            border-radius: 12px;
            padding: 24px;
            max-width: 500px;
            width: 90%;
            max-height: 80vh;
            overflow-y: auto;
            animation: slideUp 0.3s;
        }
        
        .modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
        }
        
        .modal-title {
            font-size: 1.25rem;
            font-weight: 700;
            color: #1f2937;
        }
        
        .modal-close {
            background: none;
            border: none;
            font-size: 1.5rem;
            color: #6b7280;
            cursor: pointer;
            padding: 0;
            width: 30px;
            height: 30px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 4px;
            transition: background-color 0.2s;
        }
        
        .modal-close:hover {
            background: #f3f4f6;
            color: #374151;
        }
        
        /* Animations */
        @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }
        
        @keyframes slideUp {
            from {
                transform: translateY(50px);
                opacity: 0;
            }
            to {
                transform: translateY(0);
                opacity: 1;
            }
        }
        
        /* Responsive Design */
        @media (max-width: 768px) {
            .container {
                padding: 12px;
            }
            
            .header {
                padding: 16px;
            }
            
            .header h1 {
                font-size: 1.5rem;
            }
            
            .auto-refresh {
                position: static;
                margin-top: 12px;
                display: block;
            }
            
            .metrics {
                grid-template-columns: 1fr;
                gap: 16px;
            }
            
            .metric-card {
                padding: 16px;
            }
            
            .metric-value {
                font-size: 2rem;
            }
            
            .form-row {
                grid-template-columns: 1fr;
            }
            
            .form-actions {
                flex-direction: column;
            }
            
            .btn {
                width: 100%;
                justify-content: center;
            }
            
            .filter-group {
                display: block;
                margin-right: 0;
                margin-bottom: 12px;
            }
            
            .filter-group select {
                width: 100%;
            }
            
            .task-header {
                flex-direction: column;
                gap: 12px;
            }
            
            .task-actions {
                width: 100%;
                justify-content: flex-start;
            }
            
            .task-meta {
                flex-direction: column;
                align-items: flex-start;
                gap: 8px;
            }
            
            .tabs {
                overflow-x: auto;
                -webkit-overflow-scrolling: touch;
            }
            
            .modal-content {
                margin: 20px;
                width: calc(100% - 40px);
            }
        }
        
        @media (max-width: 480px) {
            .container {
                padding: 8px;
            }
            
            .header, .task-form, .filters, .tasks-section {
                padding: 12px;
            }
            
            .metric-card {
                padding: 12px;
            }
            
            .metric-value {
                font-size: 1.75rem;
            }
        }
        
        /* Print styles */
        @media print {
            body {
                background: white;
            }
            
            .header, .task-form, .filters, .btn, .task-actions {
                display: none;
            }
            
            .task-item {
                break-inside: avoid;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Task Manager Dashboard</h1>
            <div class="auto-refresh">Auto-refresh every 5 seconds</div>
            <div class="status-bar">
                <span class="health-indicator" id="healthIndicator"></span>
                <span id="healthStatus">Loading...</span>
                <span>|</span>
                <span>PID: <strong id="daemonPid">-</strong></span>
                <span>|</span>
                <span>Uptime: <strong id="daemonUptime">-</strong></span>
                <span>|</span>
                <span>Memory: <strong id="memoryUsage">-</strong></span>
                <span>|</span>
                <span>Node: <strong id="nodeVersion">-</strong></span>
            </div>
        </div>

        <!-- Tabs Navigation -->
        <div class="tabs">
            <button class="tab active" data-tab="overview">Overview</button>
            <button class="tab" data-tab="queue">Queue Status</button>
            <button class="tab" data-tab="tasks">Tasks</button>
            <button class="tab" data-tab="create">Create Task</button>
            <button class="tab" data-tab="health">Health</button>
            <button class="tab" data-tab="logs">Activity Log</button>
        </div>

        <!-- Overview Tab -->
        <div id="overview-tab" class="tab-content active">
            <div class="metrics">
                <div class="metric-card">
                    <div class="metric-value" id="totalTasks">-</div>
                    <div class="metric-label">Total Tasks</div>
                    <div class="metric-change positive" id="totalTasksChange">+0 today</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value" id="pendingTasks">-</div>
                    <div class="metric-label">Pending</div>
                    <div class="metric-change" id="pendingTasksChange">0% completion</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value" id="inProgressTasks">-</div>
                    <div class="metric-label">In Progress</div>
                    <div class="metric-change" id="inProgressTasksChange">Active now</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value" id="completedTasks">-</div>
                    <div class="metric-label">Completed</div>
                    <div class="metric-change positive" id="completedTasksChange">+0 today</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value" id="wsConnections">-</div>
                    <div class="metric-label">Live Connections</div>
                    <div class="metric-change" id="connectionStatus">WebSocket</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value" id="highPriorityTasks">-</div>
                    <div class="metric-label">High Priority</div>
                    <div class="metric-change negative" id="highPriorityUrgent">Needs attention</div>
                </div>
            </div>
        </div>

        <!-- Create Task Tab -->
        <div id="create-tab" class="tab-content">
            <div class="task-form">
                <h2>Create New Task</h2>
                <form id="taskForm">
                    <div class="form-group">
                        <label for="taskTitle">Title *</label>
                        <input type="text" id="taskTitle" name="title" required placeholder="Enter a descriptive task title">
                    </div>
                    <div class="form-group">
                        <label for="taskDescription">Description</label>
                        <textarea id="taskDescription" name="description" placeholder="Provide detailed information about this task..."></textarea>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label for="taskPriority">Priority</label>
                            <select id="taskPriority" name="priority">
                                <option value="low">Low Priority</option>
                                <option value="medium" selected>Medium Priority</option>
                                <option value="high">High Priority</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label for="taskAssignedTo">Assigned To</label>
                            <input type="text" id="taskAssignedTo" name="assignedTo" placeholder="Username or email">
                        </div>
                    </div>
                    <div class="form-actions">
                        <button type="submit" class="btn btn-primary">
                            <span>✨</span> Create Task
                        </button>
                        <button type="reset" class="btn btn-secondary">
                            <span>🔄</span> Clear Form
                        </button>
                    </div>
                </form>
            </div>
        </div>

        <!-- Queue Status Tab -->
        <div id="queue-tab" class="tab-content">
            <div class="metrics">
                <div class="metric-card">
                    <div class="metric-value" id="queueTotal">-</div>
                    <div class="metric-label">Total Tasks in Queue</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value" id="queueHighPriority">-</div>
                    <div class="metric-label">High Priority</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value" id="queueAvgProcessingTime">-</div>
                    <div class="metric-label">Avg Processing Time</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value" id="queueFailed">-</div>
                    <div class="metric-label">Failed Tasks</div>
                </div>
            </div>

            <div class="tasks-section">
                <div class="tasks-header">
                    <h2>Queue by Priority</h2>
                    <div class="form-actions">
                        <button class="btn btn-primary btn-sm" onclick="loadQueueStatus()">
                            <span>🔄</span> Refresh
                        </button>
                    </div>
                </div>
                
                <div style="margin-bottom: 24px;">
                    <h3>High Priority Queue</h3>
                    <div id="highPriorityQueue" class="loading">Loading high priority tasks...</div>
                </div>
                
                <div style="margin-bottom: 24px;">
                    <h3>Medium Priority Queue</h3>
                    <div id="mediumPriorityQueue" class="loading">Loading medium priority tasks...</div>
                </div>
                
                <div style="margin-bottom: 24px;">
                    <h3>Low Priority Queue</h3>
                    <div id="lowPriorityQueue" class="loading">Loading low priority tasks...</div>
                </div>
            </div>

            <div class="tasks-section">
                <div class="tasks-header">
                    <h2>Failed Tasks</h2>
                    <div class="form-actions">
                        <button class="btn btn-secondary btn-sm" onclick="retryAllFailed()">
                            <span>🔄</span> Retry All Failed
                        </button>
                    </div>
                </div>
                <div id="failedTasksList" class="loading">Loading failed tasks...</div>
            </div>
        </div>

        <!-- Tasks Tab -->
        <div id="tasks-tab" class="tab-content">
            <div class="filters">
                <div class="filter-group" style="flex: 1; min-width: 200px;">
                    <label for="searchInput">Search:</label>
                    <input type="text" id="searchInput" placeholder="Search tasks by title, description, or assignee..." style="width: 100%;">
                </div>
                <div class="filter-group">
                    <label for="statusFilter">Status:</label>
                    <select id="statusFilter">
                        <option value="all">All Status</option>
                        <option value="todo">To Do</option>
                        <option value="in-progress">In Progress</option>
                        <option value="done">Completed</option>
                        <option value="failed">Failed</option>
                        <option value="cancelled">Cancelled</option>
                    </select>
                </div>
                <div class="filter-group">
                    <label for="priorityFilter">Priority:</label>
                    <select id="priorityFilter">
                        <option value="all">All Priorities</option>
                        <option value="high">High</option>
                        <option value="medium">Medium</option>
                        <option value="low">Low</option>
                    </select>
                </div>
                <div class="filter-group">
                    <label for="sortBy">Sort by:</label>
                    <select id="sortBy">
                        <option value="updated">Recently Updated</option>
                        <option value="created">Recently Created</option>
                        <option value="priority">Priority</option>
                        <option value="title">Title</option>
                    </select>
                </div>
            </div>

            <div class="tasks-section">
                <div class="tasks-header">
                    <h2>Tasks</h2>
                    <div class="form-actions">
                        <button class="btn btn-primary btn-sm" onclick="loadTasks()">
                            <span>🔄</span> Refresh
                        </button>
                    </div>
                </div>
                <div id="tasksList" class="loading">Loading tasks...</div>
            </div>
        </div>

        <!-- Health Tab -->
        <div id="health-tab" class="tab-content">
            <div class="metrics">
                <div class="metric-card">
                    <div class="metric-value" id="healthStatusDetailed">-</div>
                    <div class="metric-label">System Status</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value" id="tcpConnection">-</div>
                    <div class="metric-label">TCP Connection</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value" id="systemMemory">-</div>
                    <div class="metric-label">Memory Usage</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value" id="freeMemory">-</div>
                    <div class="metric-label">Free Memory</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value" id="systemPlatform">-</div>
                    <div class="metric-label">Platform</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value" id="systemArch">-</div>
                    <div class="metric-label">Architecture</div>
                </div>
            </div>
        </div>

        <!-- Activity Log Tab -->
        <div id="logs-tab" class="tab-content">
            <div class="tasks-section">
                <div class="tasks-header">
                    <h2>Activity Log</h2>
                    <div class="form-actions">
                        <button class="btn btn-primary btn-sm" onclick="loadLogs()">
                            <span>🔄</span> Refresh
                        </button>
                        <select id="logLimit">
                            <option value="25">Last 25</option>
                            <option value="50" selected>Last 50</option>
                            <option value="100">Last 100</option>
                        </select>
                    </div>
                </div>
                <div id="logsList" class="loading">Loading activity log...</div>
            </div>
        </div>
    </div>

    <!-- Task Details Modal -->
    <div id="taskModal" class="modal">
        <div class="modal-content">
            <div class="modal-header">
                <h3 class="modal-title">Task Details</h3>
                <button class="modal-close" onclick="closeTaskModal()">&times;</button>
            </div>
            <div id="modalTaskContent">
                <!-- Task details will be loaded here -->
            </div>
        </div>
    </div>

    <script>
        let refreshInterval;
        let wsConnection;
        let currentTasks = [];
        let previousMetrics = null;

        // Tab Management
        function initTabs() {
            const tabButtons = document.querySelectorAll('.tab');
            const tabContents = document.querySelectorAll('.tab-content');

            tabButtons.forEach(button => {
                button.addEventListener('click', () => {
                    const tabName = button.dataset.tab;
                    
                    // Update button states
                    tabButtons.forEach(btn => btn.classList.remove('active'));
                    button.classList.add('active');
                    
                    // Update content visibility
                    tabContents.forEach(content => {
                        content.classList.remove('active');
                        if (content.id === \`\${tabName}-tab\`) {
                            content.classList.add('active');
                            
                            // Load tab-specific content
                            if (tabName === 'queue') loadQueueStatus();
                            if (tabName === 'tasks') loadTasks();
                            if (tabName === 'health') loadHealthDetails();
                            if (tabName === 'logs') loadLogs();
                        }
                    });
                });
            });
        }

        // Enhanced Metrics Loading
        async function loadMetrics() {
            try {
                const response = await fetch('/api/metrics');
                const data = await response.json();
                
                // Update daemon info
                document.getElementById('daemonPid').textContent = data.daemon.pid;
                document.getElementById('daemonUptime').textContent = formatUptime(data.daemon.uptime);
                document.getElementById('memoryUsage').textContent = data.health.memoryUsage + '%';
                document.getElementById('nodeVersion').textContent = data.system.nodeVersion;
                
                // Update health status
                const healthIndicator = document.getElementById('healthIndicator');
                const healthStatus = document.getElementById('healthStatus');
                healthIndicator.className = \`health-indicator \${data.health.status}\`;
                healthStatus.textContent = data.health.status.charAt(0).toUpperCase() + data.health.status.slice(1);
                
                // Calculate changes if we have previous data
                if (previousMetrics) {
                    updateMetricChanges(previousMetrics.tasks, data.tasks);
                }
                previousMetrics = data;
                
                // Update main metrics
                document.getElementById('totalTasks').textContent = data.tasks.total;
                document.getElementById('pendingTasks').textContent = data.tasks.pending;
                document.getElementById('inProgressTasks').textContent = data.tasks.inProgress;
                document.getElementById('completedTasks').textContent = data.tasks.completed;
                document.getElementById('wsConnections').textContent = data.health.wsConnections;
                document.getElementById('highPriorityTasks').textContent = data.tasks.byPriority.high;
                
                // Update overview tab additional metrics
                document.getElementById('totalTasksChange').textContent = \`+ \${data.tasks.recent.filter(t => new Date(t.createdAt).toDateString() === new Date().toDateString()).length} today\`;
                const completionRate = data.tasks.total > 0 ? Math.round((data.tasks.completed / data.tasks.total) * 100) : 0;
                document.getElementById('pendingTasksChange').textContent = \`\${completionRate}% completion\`;
                document.getElementById('inProgressTasksChange').textContent = data.tasks.inProgress > 0 ? 'Active now' : 'Idle';
                document.getElementById('completedTasksChange').textContent = \`+ \${data.tasks.recent.filter(t => t.status === 'done' && new Date(t.updatedAt).toDateString() === new Date().toDateString()).length} today\`;
                document.getElementById('connectionStatus').textContent = data.health.wsConnections > 0 ? 'Connected' : 'No connections';
                document.getElementById('highPriorityUrgent').textContent = data.tasks.byPriority.high > 5 ? 'Urgent' : data.tasks.byPriority.high > 0 ? 'Needs attention' : 'None urgent';
                
                // Update health tab
                document.getElementById('healthStatusDetailed').textContent = data.health.status.toUpperCase();
                document.getElementById('tcpConnection').textContent = data.health.tcpConnected ? 'Connected' : 'Disconnected';
                document.getElementById('systemMemory').textContent = data.health.memoryUsage + '%';
                document.getElementById('freeMemory').textContent = formatBytes(data.system.freemem);
                document.getElementById('systemPlatform').textContent = data.system.platform;
                document.getElementById('systemArch').textContent = data.system.arch;
                
            } catch (error) {
                console.error('Error loading metrics:', error);
                showError('Failed to load metrics');
            }
        }

        function updateMetricChanges(oldTasks, newTasks) {
            // This would calculate changes over time
            // For now, we'll just update with current data
            // In a real implementation, you'd track changes over time periods
        }

        // Enhanced Tasks Loading
        async function loadTasks() {
            try {
                const searchQuery = document.getElementById('searchInput').value;
                const statusFilter = document.getElementById('statusFilter').value;
                const priorityFilter = document.getElementById('priorityFilter').value;
                const sortBy = document.getElementById('sortBy').value;
                
                let url = '/api/tasks/search';
                const params = new URLSearchParams();
                if (searchQuery.trim()) params.append('q', searchQuery);
                if (statusFilter !== 'all') params.append('status', statusFilter);
                if (priorityFilter !== 'all') params.append('priority', priorityFilter);
                url += '?' + params.toString();
                
                const response = await fetch(url);
                let tasks = await response.json();
                
                // Sort tasks
                tasks = sortTasks(tasks, sortBy);
                currentTasks = tasks;
                
                const tasksList = document.getElementById('tasksList');
                if (tasks.length === 0) {
                    tasksList.innerHTML = '<div class="loading">No tasks found</div>';
                    return;
                }
                
                tasksList.innerHTML = tasks.map(task => createTaskHTML(task)).join('');
                
                // Add event listeners to task actions
                addTaskEventListeners();
                
            } catch (error) {
                console.error('Error loading tasks:', error);
                showError('Failed to load tasks');
            }
        }

        function sortTasks(tasks, sortBy) {
            return tasks.sort((a, b) => {
                switch (sortBy) {
                    case 'updated':
                        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
                    case 'created':
                        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
                    case 'priority':
                        const priorityOrder = { high: 3, medium: 2, low: 1 };
                        return priorityOrder[b.priority] - priorityOrder[a.priority];
                    case 'title':
                        return a.title.localeCompare(b.title);
                    default:
                        return 0;
                }
            });
        }

        function createTaskHTML(task) {
            const createdDate = new Date(task.createdAt);
            const updatedDate = new Date(task.updatedAt);
            
            return \`
                <div class="task-item" data-task-id="\${task.id}">
                    <div class="task-header">
                        <div>
                            <div class="task-title">\${task.title}</div>
                            <div class="task-meta">
                                <span class="status \${task.status}">\${task.status.replace('-', ' ')}</span>
                                <span class="priority \${task.priority}">\${task.priority}</span>
                                <span>📅 \${createdDate.toLocaleDateString()}</span>
                                <span>👤 \${task.assignedTo || 'Unassigned'}</span>
                                <span>🔄 \${formatRelativeTime(updatedDate)}</span>
                            </div>
                        </div>
                        <div class="task-actions">
                            <button class="btn btn-primary btn-sm" onclick="viewTaskDetails('\${task.id}')">View</button>
                            <button class="btn btn-secondary btn-sm" onclick="quickUpdateTask('\${task.id}')">Update</button>
                            <button class="btn btn-danger btn-sm" onclick="deleteTask('\${task.id}')">Delete</button>
                        </div>
                    </div>
                </div>
            \`;
        }

        function addTaskEventListeners() {
            // Event listeners are added inline in the HTML for simplicity
            // In a larger app, you might want to use event delegation
        }

        // Task Actions
        async function quickUpdateTask(taskId) {
            const task = currentTasks.find(t => t.id === taskId);
            if (!task) return;
            
            const newStatus = prompt(\`Update status for "\${task.title}":\`, task.status);
            if (newStatus && newStatus !== task.status && ['todo', 'in-progress', 'done'].includes(newStatus)) {
                await updateTaskStatus(taskId, newStatus);
            }
        }

        async function updateTaskStatus(taskId, status) {
            try {
                const response = await fetch('/api/tasks/update', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: taskId, status }),
                });
                
                const result = await response.json();
                if (result.success) {
                    showSuccess('Task status updated successfully!');
                    await loadTasks();
                    await loadMetrics();
                } else {
                    showError('Failed to update task: ' + (result.error || 'Unknown error'));
                }
            } catch (error) {
                showError('Failed to update task: ' + error.message);
            }
        }

        async function deleteTask(taskId) {
            const task = currentTasks.find(t => t.id === taskId);
            if (!task) return;
            
            if (confirm(\`Are you sure you want to delete "\${task.title}"?\`)) {
                try {
                    const response = await fetch(\`/api/tasks/delete?id=\${taskId}\`, {
                        method: 'DELETE',
                    });
                    
                    const result = await response.json();
                    if (result.success) {
                        showSuccess('Task deleted successfully!');
                        await loadTasks();
                        await loadMetrics();
                    } else {
                        showError('Failed to delete task: ' + (result.error || 'Unknown error'));
                    }
                } catch (error) {
                    showError('Failed to delete task: ' + error.message);
                }
            }
        }

        function viewTaskDetails(taskId) {
            const task = currentTasks.find(t => t.id === taskId);
            if (!task) return;
            
            const modal = document.getElementById('taskModal');
            const content = document.getElementById('modalTaskContent');
            
            content.innerHTML = \`
                <div class="task-details">
                    <h4>\${task.title}</h4>
                    <p><strong>Description:</strong> \${task.description || 'No description'}</p>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 16px 0;">
                        <div><strong>Status:</strong> <span class="status \${task.status}">\${task.status.replace('-', ' ')}</span></div>
                        <div><strong>Priority:</strong> <span class="priority \${task.priority}">\${task.priority}</span></div>
                        <div><strong>Assigned To:</strong> \${task.assignedTo || 'Unassigned'}</div>
                        <div><strong>Created By:</strong> \${task.createdBy || 'Unknown'}</div>
                        <div><strong>Created:</strong> \${new Date(task.createdAt).toLocaleString()}</div>
                        <div><strong>Updated:</strong> \${new Date(task.updatedAt).toLocaleString()}</div>
                    </div>
                    <div class="form-actions">
                        <button class="btn btn-primary" onclick="editTask('\${task.id}')">Edit Task</button>
                        <button class="btn btn-secondary" onclick="closeTaskModal()">Close</button>
                    </div>
                </div>
            \`;
            
            modal.classList.add('show');
        }

        function closeTaskModal() {
            document.getElementById('taskModal').classList.remove('show');
        }

        async function loadHealthDetails() {
            // Health details are already loaded in loadMetrics()
            // This function ensures the health tab is updated when switched to
            await loadMetrics();
        }

        // Queue Status Functions
        async function loadQueueStatus() {
            try {
                const response = await fetch('/api/queue/status');
                const data = await response.json();
                
                // Update queue metrics
                document.getElementById('queueTotal').textContent = data.total;
                document.getElementById('queueHighPriority').textContent = data.highPriority;
                document.getElementById('queueAvgProcessingTime').textContent = formatUptime(data.processingTimes.averageProcessingTime);
                document.getElementById('queueFailed').textContent = data.failed;
                
                // Render priority queues
                renderQueue('highPriorityQueue', data.queueByPriority.high, 'high');
                renderQueue('mediumPriorityQueue', data.queueByPriority.medium, 'medium');
                renderQueue('lowPriorityQueue', data.queueByPriority.low, 'low');
                
                // Render failed tasks
                renderFailedTasks(data.failedTasks);
                
            } catch (error) {
                console.error('Error loading queue status:', error);
                showError('Failed to load queue status');
            }
        }

        function renderQueue(containerId, tasks, priority) {
            const container = document.getElementById(containerId);
            if (tasks.length === 0) {
                container.innerHTML = '<div class="loading">No tasks in this queue</div>';
                return;
            }
            
            container.innerHTML = tasks.map(task => createQueueTaskHTML(task, priority)).join('');
        }

        function createQueueTaskHTML(task, priority) {
            const createdDate = new Date(task.createdAt);
            const waitTime = Date.now() - createdDate.getTime();
            
            return \`
                <div class="task-item" data-task-id="\${task.id}">
                    <div class="task-header">
                        <div>
                            <div class="task-title">\${task.title}</div>
                            <div class="task-meta">
                                <span class="status \${task.status}">\${task.status.replace('-', ' ')}</span>
                                <span class="priority \${priority}">\${priority}</span>
                                <span>⏱️ \${formatRelativeTime(createdDate)}</span>
                                <span>🔄 Wait time: \${formatUptime(waitTime / 1000)}</span>
                            </div>
                        </div>
                        <div class="task-actions">
                            \${task.status === 'in-progress' ? 
                                '<button class="btn btn-danger btn-sm" onclick="cancelTask(\\'' + task.id + '\\')">Cancel</button>' :
                                '<button class="btn btn-secondary btn-sm" onclick="viewTaskDetails(\\'' + task.id + '\\')">View</button>'
                            }
                        </div>
                    </div>
                </div>
            \`;
        }

        function renderFailedTasks(tasks) {
            const container = document.getElementById('failedTasksList');
            if (tasks.length === 0) {
                container.innerHTML = '<div class="loading">No failed tasks</div>';
                return;
            }
            
            container.innerHTML = tasks.map(task => \`
                <div class="task-item" data-task-id="\${task.id}">
                    <div class="task-header">
                        <div>
                            <div class="task-title">\${task.title}</div>
                            <div class="task-meta">
                                <span class="status \${task.status}">\${task.status}</span>
                                <span class="priority \${task.priority}">\${task.priority}</span>
                                <span>🕒 \${new Date(task.updatedAt).toLocaleString()}</span>
                            </div>
                        </div>
                        <div class="task-actions">
                            <button class="btn btn-primary btn-sm" onclick="retryTask('\${task.id}')">Retry</button>
                            <button class="btn btn-danger btn-sm" onclick="deleteTask('\${task.id}')">Delete</button>
                        </div>
                    </div>
                </div>
            \`).join('');
        }

        async function cancelTask(taskId) {
            if (!confirm('Are you sure you want to cancel this task?')) return;
            
            try {
                const response = await fetch('/api/tasks/cancel', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: taskId }),
                });
                
                const result = await response.json();
                if (result.success) {
                    showSuccess('Task cancelled successfully!');
                    await loadQueueStatus();
                    await loadMetrics();
                } else {
                    showError('Failed to cancel task: ' + (result.error || 'Unknown error'));
                }
            } catch (error) {
                showError('Failed to cancel task: ' + error.message);
            }
        }

        async function retryTask(taskId) {
            try {
                const response = await fetch('/api/tasks/retry', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: taskId }),
                });
                
                const result = await response.json();
                if (result.success) {
                    showSuccess('Task queued for retry!');
                    await loadQueueStatus();
                    await loadMetrics();
                } else {
                    showError('Failed to retry task: ' + (result.error || 'Unknown error'));
                }
            } catch (error) {
                showError('Failed to retry task: ' + error.message);
            }
        }

        async function retryAllFailed() {
            if (!confirm('Are you sure you want to retry all failed tasks?')) return;
            
            try {
                // Get failed tasks first
                const queueResponse = await fetch('/api/queue/status');
                const queueData = await queueResponse.json();
                
                const failedTasks = queueData.failedTasks;
                let retryCount = 0;
                
                for (const task of failedTasks) {
                    try {
                        const response = await fetch('/api/tasks/retry', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ id: task.id }),
                        });
                        
                        const result = await response.json();
                        if (result.success) retryCount++;
                    } catch (error) {
                        console.error('Failed to retry task:', task.id, error);
                    }
                }
                
                if (retryCount > 0) {
                    showSuccess(\`\${retryCount} tasks queued for retry!\`);
                    await loadQueueStatus();
                    await loadMetrics();
                } else {
                    showError('No tasks could be retried');
                }
            } catch (error) {
                showError('Failed to retry failed tasks: ' + error.message);
            }
        }

        async function loadLogs() {
            try {
                const limit = document.getElementById('logLimit').value;
                const response = await fetch(\`/api/logs?limit=\${limit}\`);
                const logs = await response.json();
                
                const logsList = document.getElementById('logsList');
                if (logs.length === 0) {
                    logsList.innerHTML = '<div class="loading">No activity found</div>';
                    return;
                }
                
                logsList.innerHTML = logs.map(log => \`
                    <div class="task-item">
                        <div class="task-title">\${log.message}</div>
                        <div class="task-meta">
                            <span class="status \${log.level}">\${log.level}</span>
                            <span>🕒 \${new Date(log.timestamp).toLocaleString()}</span>
                            <span>🆔 \${log.data.taskId}</span>
                        </div>
                    </div>
                \`).join('');
                
            } catch (error) {
                console.error('Error loading logs:', error);
                showError('Failed to load activity log');
            }
        }

        // WebSocket Connection
        function connectWebSocket() {
            try {
                const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
                const wsUrl = protocol + "//" + window.location.host + "/dashboard-ws";
                
                wsConnection = new WebSocket(wsUrl);
                
                wsConnection.onopen = function() {
                    console.log("WebSocket connected for real-time updates");
                    showSuccess('Real-time updates enabled');
                };
                
                wsConnection.onmessage = async function(event) {
                    try {
                        const message = JSON.parse(event.data);
                        
                        if (message.type === "task_created" || 
                            message.type === "task_status_changed" || 
                            message.type === "task_priority_changed" || 
                            message.type === "task_deleted") {
                            console.log("Task update received:", message.type);
                            await loadTasks();
                            await loadMetrics();
                            
                            let notificationType = 'info';
                            let notificationMessage = 'Task ' + message.type.replace('_', ' ');
                            
                            if (message.type === "task_created") {
                                notificationType = 'success';
                                notificationMessage = 'New task created: ' + (message.data.title || 'Unknown');
                            } else if (message.type === "task_status_changed") {
                                notificationType = 'info';
                                notificationMessage = 'Task "' + (message.data.task?.title || 'Unknown') + '" status changed to ' + message.data.newStatus;
                            } else if (message.type === "task_deleted") {
                                notificationType = 'warning';
                                notificationMessage = 'Task deleted';
                            }
                            
                            showNotification(notificationMessage, notificationType);
                        }
                    } catch (error) {
                        console.error("Error processing WebSocket message:", error);
                    }
                };
                
                wsConnection.onclose = function() {
                    console.log("WebSocket disconnected, attempting to reconnect...");
                    setTimeout(connectWebSocket, 5000);
                };
                
                wsConnection.onerror = function(error) {
                    console.error("WebSocket error:", error);
                };
                
            } catch (error) {
                console.log("WebSocket not available, falling back to polling");
            }
        }

        // Debounce function for search
        function debounce(func, wait) {
            let timeout;
            return function executedFunction(...args) {
                const later = () => {
                    clearTimeout(timeout);
                    func(...args);
                };
                clearTimeout(timeout);
                timeout = setTimeout(later, wait);
            };
        }

        // Utility Functions
        function formatUptime(seconds) {
            const days = Math.floor(seconds / 86400);
            const hours = Math.floor((seconds % 86400) / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            const secs = Math.floor(seconds % 60);
            
            if (days > 0) {
                return \`\${days}d \${hours}h \${minutes}m\`;
            } else if (hours > 0) {
                return \`\${hours}h \${minutes}m \${secs}s\`;
            } else if (minutes > 0) {
                return \`\${minutes}m \${secs}s\`;
            } else {
                return \`\${secs}s\`;
            }
        }

        function formatBytes(bytes) {
            if (bytes === 0) return '0 B';
            const k = 1024;
            const sizes = ['B', 'KB', 'MB', 'GB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
        }

        function formatRelativeTime(date) {
            const now = new Date();
            const diff = now - date;
            const minutes = Math.floor(diff / 60000);
            const hours = Math.floor(diff / 3600000);
            const days = Math.floor(diff / 86400000);
            
            if (days > 0) return \`\${days} days ago\`;
            if (hours > 0) return \`\${hours} hours ago\`;
            if (minutes > 0) return \`\${minutes} minutes ago\`;
            return 'Just now';
        }

        function showMessage(message, type) {
            const messageDiv = document.createElement('div');
            messageDiv.className = type;
            messageDiv.textContent = message;
            document.querySelector('.container').insertBefore(messageDiv, document.querySelector('.container').firstChild);
            
            setTimeout(() => {
                if (messageDiv.parentNode) {
                    messageDiv.parentNode.removeChild(messageDiv);
                }
            }, 5000);
        }

        function showError(message) {
            showMessage(message, 'error');
        }

        function showSuccess(message) {
            showMessage(message, 'success');
        }

        function showWarning(message) {
            showMessage(message, 'warning');
        }

        function showNotification(message, type) {
            type = type || 'info';
            
            // Try browser notification first
            if ('Notification' in window && Notification.permission === 'granted') {
                new Notification('Task Manager Dashboard', {
                    body: message,
                    icon: '/favicon.ico',
                    tag: 'task-update'
                });
            } else {
                // Fallback to console for now
                console.log('Notification:', message, 'Type:', type);
            }
        }

        // Task Creation
        async function createTask(taskData) {
            try {
                const response = await fetch('/api/tasks', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(taskData),
                });
                
                const result = await response.json();
                
                if (result.success) {
                    showSuccess('Task created successfully!');
                    document.getElementById('taskForm').reset();
                    
                    // Switch to tasks tab to see the new task
                    document.querySelector('[data-tab="tasks"]').click();
                } else {
                    showError('Failed to create task: ' + (result.error || 'Unknown error'));
                }
            } catch (error) {
                console.error('Error creating task:', error);
                showError('Failed to create task: ' + error.message);
            }
        }

        // Auto-refresh Management
        function startAutoRefresh() {
            refreshInterval = setInterval(async () => {
                await loadMetrics();
                // Only refresh tab-specific content if that tab is active
                if (document.getElementById('queue-tab').classList.contains('active')) {
                    await loadQueueStatus();
                }
                if (document.getElementById('tasks-tab').classList.contains('active')) {
                    await loadTasks();
                }
            }, 5000);

            connectWebSocket();
        }

        function stopAutoRefresh() {
            if (refreshInterval) {
                clearInterval(refreshInterval);
            }
            if (wsConnection) {
                wsConnection.close();
            }
        }

        // Event Listeners
        document.addEventListener('DOMContentLoaded', () => {
            initTabs();
            
            // Form submission
            document.getElementById('taskForm').addEventListener('submit', async (e) => {
                e.preventDefault();
                
                const formData = new FormData(e.target);
                const taskData = {
                    title: formData.get('title'),
                    description: formData.get('description') || '',
                    priority: formData.get('priority') || 'medium',
                    assignedTo: formData.get('assignedTo') || undefined,
                };
                
                await createTask(taskData);
            });

            // Filter and sort listeners (with debounced search)
            document.getElementById('searchInput').addEventListener('input', debounce(loadTasks, 300));
            document.getElementById('statusFilter').addEventListener('change', loadTasks);
            document.getElementById('priorityFilter').addEventListener('change', loadTasks);
            document.getElementById('sortBy').addEventListener('change', loadTasks);
            
            // Log limit listener
            document.getElementById('logLimit').addEventListener('change', loadLogs);
            
            // Initial load
            loadMetrics();
            startAutoRefresh();
            
            // Close modal when clicking outside
            document.getElementById('taskModal').addEventListener('click', (e) => {
                if (e.target.id === 'taskModal') {
                    closeTaskModal();
                }
            });
        });

        // Cleanup on page unload
        window.addEventListener('beforeunload', stopAutoRefresh);
        
        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            // Ctrl/Cmd + K to focus search (could be implemented)
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault();
                // document.getElementById('searchInput')?.focus();
            }
            
            // Escape to close modal
            if (e.key === 'Escape') {
                closeTaskModal();
            }
        });
    </script>
</body>
</html>`;
	}
}