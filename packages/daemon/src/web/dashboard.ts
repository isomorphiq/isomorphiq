import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { ProductManager } from "@isomorphiq/tasks";
import type { WebSocketManager } from "@isomorphiq/realtime";
import { DaemonTcpClient } from "./tcp-client.ts";
import type { Task as CoreTask } from "@isomorphiq/tasks";
import { DashboardAnalyticsService } from "../services/dashboard-analytics-service.ts";

// Notification filtering options
export interface NotificationFilter {
	userId?: string;
	priority?: 'high' | 'medium' | 'low' | 'all';
	eventTypes?: string[];
	taskIds?: string[];
	enabled?: boolean;
}

// Notification data structure
export interface NotificationData {
	id: string;
	type: 'task_created' | 'task_status_changed' | 'task_completed' | 'task_failed' | 'task_priority_changed' | 'task_deleted';
	timestamp: string;
	taskId: string;
	taskTitle: string;
	taskPriority: string;
	oldStatus?: string;
	newStatus?: string;
	oldPriority?: string;
	newPriority?: string;
	message: string;
	severity: 'info' | 'success' | 'warning' | 'error';
	requiresAction?: boolean;
	actionUrl?: string;
}

// Client connection with notification preferences
interface ClientConnection {
	ws: WebSocket;
	environment: string;
	notificationFilter: NotificationFilter;
	lastPing: number;
	isAlive: boolean;
}

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

type EnvironmentServices = {
	environment: string;
	productManager: ProductManager;
	webSocketManager: WebSocketManager;
	analyticsService: DashboardAnalyticsService;
};

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

// Notification filtering options
export interface NotificationFilter {
	userId?: string;
	priority?: 'high' | 'medium' | 'low' | 'all';
	eventTypes?: string[];
	taskIds?: string[];
	enabled?: boolean;
}

// Notification data structure
export interface NotificationData {
	id: string;
	type: 'task_created' | 'task_status_changed' | 'task_completed' | 'task_failed' | 'task_priority_changed' | 'task_deleted';
	timestamp: string;
	taskId: string;
	taskTitle: string;
	taskPriority: string;
	oldStatus?: string;
	newStatus?: string;
	oldPriority?: string;
	newPriority?: string;
	message: string;
	severity: 'info' | 'success' | 'warning' | 'error';
	requiresAction?: boolean;
	actionUrl?: string;
}

// Client connection with notification preferences
interface ClientConnection {
	ws: WebSocket;
	notificationFilter: NotificationFilter;
	lastPing: number;
	isAlive: boolean;
}

export class DashboardServer {
	private environmentServices: Map<string, EnvironmentServices>;
	private resolveEnvironment: (headers: IncomingHttpHeaders) => string;
	private defaultEnvironment: string;
	private tcpClient: DaemonTcpClient;
	private wsServer: WebSocketServer | null = null;
	private activeConnections: Map<WebSocket, ClientConnection> = new Map();
	private notificationLog: NotificationData[] = [];
	private maxNotificationLogSize = 1000;

	constructor(
		environmentServices: Map<string, EnvironmentServices>,
		resolveEnvironment: (headers: IncomingHttpHeaders) => string,
		defaultEnvironment: string,
	) {
		this.environmentServices = environmentServices;
		this.resolveEnvironment = resolveEnvironment;
		this.defaultEnvironment = defaultEnvironment;
		this.tcpClient = new DaemonTcpClient();
	}

	private getEnvironmentServices(environment?: string): EnvironmentServices {
		if (environment && this.environmentServices.has(environment)) {
			return this.environmentServices.get(environment)!;
		}
		if (this.environmentServices.has(this.defaultEnvironment)) {
			return this.environmentServices.get(this.defaultEnvironment)!;
		}
		const fallback = this.environmentServices.values().next().value as EnvironmentServices | undefined;
		if (!fallback) {
			throw new Error("No environment services configured for dashboard");
		}
		return fallback;
	}

	// Initialize WebSocket server for dashboard real-time updates
	async initializeWebSocketServer(httpServer: import("node:http").Server): Promise<void> {
		this.wsServer = new WebSocketServer({ 
			server: httpServer, 
			path: "/dashboard-ws" 
		});

		this.wsServer.on("connection", (ws: WebSocket, req) => {
			console.log("[DASHBOARD] WebSocket client connected");
			const environment = this.resolveEnvironment(req.headers);
			this.activeConnections.set(ws, {
				ws,
				environment,
				notificationFilter: {},
				lastPing: Date.now(),
				isAlive: true,
			});

			// Send initial dashboard state
			this.sendInitialState(ws, environment);

			ws.on("message", (message) => {
				try {
					const data = JSON.parse(message.toString());
					this.handleWebSocketMessage(ws, data, environment);
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
	private async sendInitialState(ws: WebSocket, environment: string): Promise<void> {
		try {
			const services = this.getEnvironmentServices(environment);
			const metrics = await this.getMetrics(services);
			const coreTasks = await services.productManager.getAllTasks();
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
	private async handleWebSocketMessage(ws: WebSocket, data: any, environment: string): Promise<void> {
		const services = this.getEnvironmentServices(environment);
		switch (data.type) {
			case "refresh_metrics":
				try {
					const metrics = await this.getMetrics(services);
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
					const tasks = await services.productManager.getAllTasks();
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
			case "bulk_task_action":
				try {
					const result = await this.handleBulkTaskAction(
						data.action,
						data.taskIds,
						data.data,
						environment,
					);
					ws.send(JSON.stringify({
						type: "bulk_action_result",
						data: result
					}));
				} catch (error) {
					ws.send(JSON.stringify({
						type: "error",
						message: "Failed to perform bulk action: " + (error instanceof Error ? error.message : "Unknown error")
					}));
				}
				break;
			case "get_task_details":
				try {
					const tasks = await services.productManager.getAllTasks();
					const task = tasks.find(t => t.id === data.taskId);
					if (task) {
						ws.send(JSON.stringify({
							type: "task_details",
							data: task
						}));
					} else {
						ws.send(JSON.stringify({
							type: "error",
							message: "Task not found"
						}));
					}
				} catch (error) {
					ws.send(JSON.stringify({
						type: "error",
						message: "Failed to get task details"
					}));
				}
				break;
			case "get_system_health":
				try {
					const health = await this.getSystemHealth(environment);
					ws.send(JSON.stringify({
						type: "system_health",
						data: health
					}));
				} catch (error) {
					ws.send(JSON.stringify({
						type: "error",
						message: "Failed to get system health"
					}));
				}
				break;
			case "subscribe_to_events":
				// Client wants to subscribe to specific event types
				data.eventTypes?.forEach((eventType: string) => {
					ws.addEventListener('message', (event) => {
						// Handle subscription-specific events
					});
				});
				ws.send(JSON.stringify({
					type: "subscription_confirmed",
					data: { eventTypes: data.eventTypes }
				}));
				break;
			default:
				console.log("[DASHBOARD] Unknown WebSocket message type:", data.type);
		}
	}

	// Set up forwarding of task events from the main WebSocket manager
	private setupTaskEventForwarding(): void {
		for (const services of this.environmentServices.values()) {
			const environment = services.environment;
			const wsManager = services.webSocketManager as any;
			wsManager.on?.("task_created", (task: Task) => {
				this.broadcastToDashboard(
					{
						type: "task_created",
						data: task,
					},
					environment,
				);
			});

			wsManager.on?.(
				"task_status_changed",
				(taskId: string, oldStatus: string, newStatus: string, task: Task) => {
					this.broadcastToDashboard(
						{
							type: "task_status_changed",
							data: { taskId, oldStatus, newStatus, task },
						},
						environment,
					);
				},
			);

			wsManager.on?.(
				"task_priority_changed",
				(taskId: string, oldPriority: string, newPriority: string, task: Task) => {
					this.broadcastToDashboard(
						{
							type: "task_priority_changed",
							data: { taskId, oldPriority, newPriority, task },
						},
						environment,
					);
				},
			);

			wsManager.on?.("task_deleted", (taskId: string) => {
				this.broadcastToDashboard(
					{
						type: "task_deleted",
						data: { taskId },
					},
					environment,
				);
			});
		}
	}

	// Broadcast message to all connected dashboard clients
	private broadcastToDashboard(message: any, environment?: string): void {
		const messageStr = JSON.stringify(message);
		this.activeConnections.forEach((connection) => {
			if (environment && connection.environment !== environment) {
				return;
			}
			if (connection.ws.readyState === 1) {
				connection.ws.send(messageStr);
			}
		});
	}

	// Set up periodic metrics broadcast
	private setupPeriodicMetricsBroadcast(): void {
		// Broadcast metrics every 30 seconds
		setInterval(async () => {
			try {
				if (this.activeConnections.size > 0) {
					const environments = new Set(
						Array.from(this.activeConnections.values()).map((connection) => connection.environment),
					);
					for (const environment of environments) {
						const services = this.getEnvironmentServices(environment);
						const metrics = await this.getMetrics(services);
						this.broadcastToDashboard(
							{
								type: "metrics_update",
								data: metrics,
							},
							environment,
						);
					}
				}
			} catch (error) {
				console.error("[DASHBOARD] Error broadcasting metrics:", error);
			}
		}, 30000);
	}

	// Handle bulk task actions (pause, resume, cancel, prioritize)
	private async handleBulkTaskAction(
		action: string,
		taskIds: string[],
		data: any,
		environment: string,
	): Promise<any> {
		const results = [];
		
		for (const taskId of taskIds) {
			try {
				let result;
				switch (action) {
					case "pause":
						result = await this.tcpClient.sendCommand(
							"update_task_status",
							{ id: taskId, status: "cancelled" },
							environment,
						);
						break;
					case "resume":
						result = await this.tcpClient.sendCommand(
							"update_task_status",
							{ id: taskId, status: "todo" },
							environment,
						);
						break;
					case "cancel":
						result = await this.tcpClient.sendCommand(
							"update_task_status",
							{ id: taskId, status: "cancelled" },
							environment,
						);
						break;
					case "set_priority":
						result = await this.tcpClient.sendCommand(
							"update_task_priority",
							{ id: taskId, priority: data.priority },
							environment,
						);
						break;
					case "delete":
						result = await this.tcpClient.sendCommand(
							"delete_task",
							{ id: taskId },
							environment,
						);
						break;
					default:
						throw new Error(`Unknown bulk action: ${action}`);
				}
				
				results.push({
					taskId,
					success: result.success,
					data: result.data,
					error: result.error?.message
				});
			} catch (error) {
				results.push({
					taskId,
					success: false,
					error: error instanceof Error ? error.message : "Unknown error"
				});
			}
		}
		
		return {
			action,
			totalTasks: taskIds.length,
			successful: results.filter(r => r.success).length,
			failed: results.filter(r => !r.success).length,
			results
		};
	}

	// Get system health metrics
	private async getSystemHealth(environment: string): Promise<any> {
		const memUsage = process.memoryUsage();
		const uptime = process.uptime();
		const tcpConnected = await this.tcpClient.checkConnection();
		
		// Get tasks for health analysis
		const tasksResult = await this.tcpClient.sendCommand("list_tasks", {}, environment);
		const tasks = tasksResult.success ? tasksResult.data as any[] : [];
		
		const failedTasks = tasks.filter(t => t.status === "failed");
		const overdueTasks = tasks.filter(t => {
			const created = new Date(t.createdAt);
			const ageHours = (Date.now() - created.getTime()) / (1000 * 60 * 60);
			return t.status !== "done" && ageHours > 24;
		});
		
		// Determine health status
		let healthStatus = "healthy";
		const issues = [];
		
		if (!tcpConnected) {
			healthStatus = "unhealthy";
			issues.push("TCP connection to daemon lost");
		}
		
		if (memUsage.heapUsed / memUsage.heapTotal > 0.9) {
			healthStatus = "unhealthy";
			issues.push("Memory usage critical");
		}
		
		if (failedTasks.length > 10) {
			healthStatus = "degraded";
			issues.push(`${failedTasks.length} failed tasks`);
		}
		
		if (overdueTasks.length > 20) {
			healthStatus = "degraded";
			issues.push(`${overdueTasks.length} overdue tasks`);
		}
		
		return {
			status: healthStatus,
			issues,
			metrics: {
				memory: {
					used: memUsage.heapUsed,
					total: memUsage.heapTotal,
					percentage: Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100)
				},
				uptime: {
					seconds: uptime,
					formatted: this.formatUptime(uptime)
				},
				tasks: {
					total: tasks.length,
					failed: failedTasks.length,
					overdue: overdueTasks.length,
					completionRate: tasks.length > 0 ? Math.round((tasks.filter(t => t.status === "done").length / tasks.length) * 100) : 0
				},
				connections: {
					tcp: tcpConnected,
					websockets: this.activeConnections.size
				}
			},
			timestamp: new Date().toISOString()
		};
	}

	// Format uptime into human readable string
	private formatUptime(seconds: number): string {
		const days = Math.floor(seconds / (24 * 60 * 60));
		const hours = Math.floor((seconds % (24 * 60 * 60)) / (60 * 60));
		const minutes = Math.floor((seconds % (60 * 60)) / 60);
		
		return `${days}d ${hours}h ${minutes}m`;
	}

	// Main request handler
	async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
		try {
			const url = new URL(req.url || "", `http://${req.headers.host}`);
			const pathname = url.pathname;
			const environment = this.resolveEnvironment(req.headers);

			// Serve main dashboard page
			if (pathname === "/") {
				res.writeHead(200, { "Content-Type": "text/html" });
				res.end(this.getDashboardHTML());
				return;
			}

			// Serve API endpoints
			if (pathname === "/api/metrics") {
				const services = this.getEnvironmentServices(environment);
				const metrics = await this.getMetrics(services);
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify(metrics));
				return;
			}

			// Serve tasks API endpoints
			if (pathname.startsWith("/api/tasks")) {
				await this.serveTasksAPI(req, res, environment);
				return;
			}

			// Serve queue status endpoint
			if (pathname === "/api/queue/status") {
				await this.serveQueueStatus(req, res, environment);
				return;
			}

			// Serve activity logs endpoint
			if (pathname === "/api/logs") {
				await this.serveActivityLogs(req, res, environment);
				return;
			}

			// Serve audit history endpoint
			if (pathname === "/api/audit/history") {
				await this.serveAuditHistory(req, res, environment);
				return;
			}

			// Serve audit summary endpoint
			if (pathname === "/api/audit/summary") {
				await this.serveAuditSummary(req, res, environment);
				return;
			}

			// Serve audit statistics endpoint
			if (pathname === "/api/audit/statistics") {
				await this.serveAuditStatistics(req, res, environment);
				return;
			}

			// Serve daemon control endpoints
			if (pathname.startsWith("/api/daemon/")) {
				await this.serveDaemonControl(req, res, pathname, environment);
				return;
			}

			// Serve analytics endpoints
			if (pathname.startsWith("/api/analytics")) {
				const environment = this.resolveEnvironment(req.headers);
				const services = this.getEnvironmentServices(environment);
				await services.analyticsService.handleAnalyticsRequest(req, res);
				return;
			}

			// Serve bulk actions endpoint
			if (pathname === "/api/tasks/bulk-action" && req.method === "POST") {
				await this.serveBulkActions(req, res, environment);
				return;
			}

			// Serve audit history JavaScript file
			if (pathname === "/audit-history.js") {
				res.writeHead(200, { "Content-Type": "application/javascript" });
				res.end(this.getAuditHistoryJS());
				return;
			}

			this.serve404(res);
		} catch (error) {
			this.serveError(res, error);
		}
	}

	// Get audit history JavaScript code
	private getAuditHistoryJS(): string {
		return `
// Audit History Management Module
(function() {
    let currentHistoryData = [];
    let currentFilters = {};

    // Load audit history from server
    window.loadAuditHistory = async function() {
        try {
            const taskId = document.getElementById('historyTaskId')?.value;
            const eventType = document.getElementById('historyEventType')?.value;
            const changedBy = document.getElementById('historyChangedBy')?.value;
            const fromDate = document.getElementById('historyFromDate')?.value;
            const toDate = document.getElementById('historyToDate')?.value;
            const limit = document.getElementById('historyLimit')?.value || '100';

            const params = new URLSearchParams();
            if (taskId) params.append('taskId', taskId);
            if (eventType) params.append('eventType', eventType);
            if (changedBy) params.append('changedBy', changedBy);
            if (fromDate) params.append('fromDate', fromDate);
            if (toDate) params.append('toDate', toDate);
            if (limit) params.append('limit', limit);

            const response = await fetch('/api/audit/history?' + params.toString());
            const data = await response.json();

            if (Array.isArray(data)) {
                currentHistoryData = data;
                renderAuditHistory(data);
                updateTaskSummaryIfNeeded(taskId);
            } else {
                console.error('Invalid audit history data:', data);
                showError('Failed to load audit history');
            }
        } catch (error) {
            console.error('Error loading audit history:', error);
            showError('Failed to load audit history: ' + error.message);
        }
    };

    // Load task summary
    window.loadTaskSummary = async function(taskId) {
        if (!taskId) return;
        
        try {
            const response = await fetch('/api/audit/summary?taskId=' + encodeURIComponent(taskId));
            const data = await response.json();

            if (data) {
                renderTaskSummary(data);
                document.getElementById('taskSummarySection').style.display = 'block';
            } else {
                document.getElementById('taskSummarySection').style.display = 'none';
            }
        } catch (error) {
            console.error('Error loading task summary:', error);
        }
    };

    // Load audit statistics
    window.loadAuditStatistics = async function() {
        try {
            const fromDate = document.getElementById('historyFromDate')?.value;
            const toDate = document.getElementById('historyToDate')?.value;

            const params = new URLSearchParams();
            if (fromDate) params.append('fromDate', fromDate);
            if (toDate) params.append('toDate', toDate);

            const response = await fetch('/api/audit/statistics?' + params.toString());
            const data = await response.json();

            if (data) {
                renderAuditStatistics(data);
            } else {
                showError('Failed to load audit statistics');
            }
        } catch (error) {
            console.error('Error loading audit statistics:', error);
            showError('Failed to load audit statistics: ' + error.message);
        }
    };

    // Apply history filters
    window.applyHistoryFilters = function() {
        loadAuditHistory();
    };

    // Clear history filters
    window.clearHistoryFilters = function() {
        document.getElementById('historyTaskId').value = '';
        document.getElementById('historyEventType').value = '';
        document.getElementById('historyChangedBy').value = '';
        document.getElementById('historyFromDate').value = '';
        document.getElementById('historyToDate').value = '';
        document.getElementById('historyLimit').value = '100';
        document.getElementById('taskSummarySection').style.display = 'none';
        
        loadAuditHistory();
    };

    // Render audit history
    function renderAuditHistory(events) {
        const container = document.getElementById('auditHistoryList');
        
        if (!events || events.length === 0) {
            container.innerHTML = '<div class="loading">No audit events found</div>';
            return;
        }

        const html = events.map(event => {
            const eventTime = new Date(event.timestamp);
            const eventIcon = getEventIcon(event.eventType);
            const eventDetails = getEventDetails(event);

            return \`
                <div class="audit-event">
                    <div class="event-header">
                        <span class="event-icon">\${eventIcon}</span>
                        <span class="event-type">\${event.eventType}</span>
                        <span class="event-time">\${eventTime.toLocaleString()}</span>
                    </div>
                    <div class="event-content">
                        <div class="event-task">Task: \${event.taskTitle || 'Unknown'}</div>
                        <div class="event-details">\${eventDetails}</div>
                        <div class="event-changed-by">Changed by: \${event.changedBy || 'System'}</div>
                        \${event.error ? \`<div class="event-error">Error: \${event.error}</div>\` : ''}
                    </div>
                </div>
            \`;
        }).join('');

        container.innerHTML = html;
    }

    // Render task summary
    function renderTaskSummary(summary) {
        const container = document.getElementById('taskSummaryContent');
        
        const totalChanges = summary.totalEvents || 0;
        const statusChanges = summary.eventsByType?.status_changed || 0;
        const priorityChanges = summary.eventsByType?.priority_changed || 0;
        const assignments = summary.eventsByType?.assigned || 0;

        const html = \`
            <div class="summary-grid">
                <div class="summary-item">
                    <div class="summary-label">Total Changes</div>
                    <div class="summary-value">\${totalChanges}</div>
                </div>
                <div class="summary-item">
                    <div class="summary-label">Status Changes</div>
                    <div class="summary-value">\${statusChanges}</div>
                </div>
                <div class="summary-item">
                    <div class="summary-label">Priority Changes</div>
                    <div class="summary-value">\${priorityChanges}</div>
                </div>
                <div class="summary-item">
                    <div class="summary-label">Assignments</div>
                    <div class="summary-value">\${assignments}</div>
                </div>
            </div>
            <div class="summary-timeline">
                <div>Created: \${summary.createdAt ? new Date(summary.createdAt).toLocaleString() : 'Unknown'}</div>
                <div>Last Updated: \${summary.lastUpdated ? new Date(summary.lastUpdated).toLocaleString() : 'Unknown'}</div>
            </div>
        \`;

        container.innerHTML = html;
    }

    // Render audit statistics
    function renderAuditStatistics(stats) {
        // Create a modal or expand the statistics section
        const statsHtml = \`
            <div class="stats-grid">
                <div class="stat-item">
                    <div class="stat-label">Total Events</div>
                    <div class="stat-value">\${stats.totalEvents || 0}</div>
                </div>
                <div class="stat-item">
                    <div class="stat-label">Unique Tasks</div>
                    <div class="stat-value">\${stats.uniqueTasks || 0}</div>
                </div>
                <div class="stat-item">
                    <div class="stat-label">Active Users</div>
                    <div class="stat-value">\${stats.activeUsers || 0}</div>
                </div>
                <div class="stat-item">
                    <div class="stat-label">Error Rate</div>
                    <div class="stat-value">\${stats.errorRate || '0%'}</div>
                </div>
            </div>
            <div class="events-by-type">
                <h3>Events by Type</h3>
                \${Object.entries(stats.eventsByType || {}).map(([type, count]) => \`
                    <div class="event-type-stat">
                        <span class="event-type-name">\${type}</span>
                        <span class="event-type-count">\${count}</span>
                    </div>
                \`).join('')}
            </div>
            <div class="most-active-tasks">
                <h3>Most Active Tasks</h3>
                \${(stats.mostActiveTasks || []).slice(0, 10).map(task => \`
                    <div class="active-task">
                        <span class="task-id">\${task.taskId}</span>
                        <span class="event-count">\${task.eventCount} events</span>
                    </div>
                \`).join('')}
            </div>
        \`;

        // Show in modal or update existing section
        const container = document.getElementById('auditHistoryList');
        container.innerHTML = statsHtml;
    }

    // Get event icon based on type
    function getEventIcon(eventType) {
        const icons = {
            'created': '📝',
            'status_changed': '🔄',
            'priority_changed': '⚡',
            'assigned': '👤',
            'updated': '✏️',
            'deleted': '🗑️'
        };
        return icons[eventType] || '📋';
    }

    // Get event details based on type
    function getEventDetails(event) {
        switch (event.eventType) {
            case 'status_changed':
                return \`Status changed from \${event.oldValue} to \${event.newValue}\`;
            case 'priority_changed':
                return \`Priority changed from \${event.oldValue} to \${event.newValue}\`;
            case 'assigned':
                return \`Assigned to \${event.newValue}\`;
            case 'created':
                return \`Task created with priority: \${event.newValue}\`;
            case 'deleted':
                return 'Task was deleted';
            default:
                return event.details || 'Event occurred';
        }
    }

    // Update task summary if needed
    function updateTaskSummaryIfNeeded(taskId) {
        if (taskId) {
            loadTaskSummary(taskId);
        } else {
            document.getElementById('taskSummarySection').style.display = 'none';
        }
    }

    // Utility functions
    function showError(message) {
        if (typeof window.showError === 'function') {
            window.showError(message);
        } else {
            console.error(message);
        }
    }
})();
		`;
	}

	private async serveAuditHistory(
		req: IncomingMessage,
		res: ServerResponse,
		environment: string,
	): Promise<void> {
		try {
			const url = new URL(req.url || "", `http://${req.headers.host}`);
			const taskId = url.searchParams.get("taskId");
			const eventType = url.searchParams.get("eventType");
			const changedBy = url.searchParams.get("changedBy");
			const limit = parseInt(url.searchParams.get("limit") || "100");
			const offset = parseInt(url.searchParams.get("offset") || "0");
			const fromDate = url.searchParams.get("fromDate");
			const toDate = url.searchParams.get("toDate");
			
			const requestData: any = {};
			if (taskId) requestData.taskId = taskId;
			if (eventType) requestData.eventType = eventType;
			if (changedBy) requestData.changedBy = changedBy;
			if (limit) requestData.limit = limit;
			if (offset) requestData.offset = offset;
			if (fromDate) requestData.fromDate = fromDate;
			if (toDate) requestData.toDate = toDate;
			
			const result = await this.tcpClient.sendCommand(
				"get_task_history",
				requestData,
				environment,
			);
			
			if (result.success) {
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify(result.data));
			} else {
				res.writeHead(500, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ 
					error: result.error?.message || "Failed to fetch audit history" 
				}));
			}
		} catch (error) {
			res.writeHead(500, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ 
				error: error instanceof Error ? error.message : "Failed to fetch audit history" 
			}));
		}
	}

	private async serveAuditSummary(
		req: IncomingMessage,
		res: ServerResponse,
		environment: string,
	): Promise<void> {
		try {
			const url = new URL(req.url || "", `http://${req.headers.host}`);
			const taskId = url.searchParams.get("taskId");
			
			if (!taskId) {
				res.writeHead(400, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: "Task ID is required" }));
				return;
			}
			
			const result = await this.tcpClient.sendCommand(
				"get_task_history_summary",
				{ taskId },
				environment,
			);
			
			if (result.success) {
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify(result.data));
			} else {
				res.writeHead(500, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ 
					error: result.error?.message || "Failed to fetch audit summary" 
				}));
			}
		} catch (error) {
			res.writeHead(500, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ 
				error: error instanceof Error ? error.message : "Failed to fetch audit summary" 
			}));
		}
	}

	private async serveAuditStatistics(
		req: IncomingMessage,
		res: ServerResponse,
		environment: string,
	): Promise<void> {
		try {
			const url = new URL(req.url || "", `http://${req.headers.host}`);
			const fromDate = url.searchParams.get("fromDate");
			const toDate = url.searchParams.get("toDate");
			
			const requestData: any = {};
			if (fromDate) requestData.fromDate = fromDate;
			if (toDate) requestData.toDate = toDate;
			
			const result = await this.tcpClient.sendCommand(
				"get_audit_statistics",
				requestData,
				environment,
			);
			
			if (result.success) {
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify(result.data));
			} else {
				res.writeHead(500, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ 
					error: result.error?.message || "Failed to fetch audit statistics" 
				}));
			}
		} catch (error) {
			res.writeHead(500, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ 
				error: error instanceof Error ? error.message : "Failed to fetch audit statistics" 
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

	private async serveTasksAPI(
		req: IncomingMessage,
		res: ServerResponse,
		environment: string,
	): Promise<void> {
		try {
			const url = new URL(req.url || "", `http://${req.headers.host}`);
			const pathname = url.pathname;

			// Handle different task API endpoints
			if (pathname === "/api/tasks" && req.method === "GET") {
				// Search tasks with query parameters
				const searchQuery = url.searchParams.get("q");
				const statusFilter = url.searchParams.get("status");
				const priorityFilter = url.searchParams.get("priority");
				
				const filters: any = {};
				if (statusFilter && statusFilter !== "all") filters.status = statusFilter;
				if (priorityFilter && priorityFilter !== "all") filters.priority = priorityFilter;
				if (searchQuery) filters.search = searchQuery;
				
				const result = await this.tcpClient.sendCommand(
					"list_tasks_filtered",
					{ filters },
					environment,
				);
				
				if (result.success) {
					res.writeHead(200, { "Content-Type": "application/json" });
					res.end(JSON.stringify(result.data));
				} else {
					res.writeHead(500, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ error: result.error?.message || "Failed to search tasks" }));
				}
			} else if (pathname === "/api/tasks" && req.method === "POST") {
				// Create new task
				const body = await this.parseRequestBody(req);
				const taskData = JSON.parse(body);
				
				const result = await this.tcpClient.sendCommand("create_task", taskData, environment);
				
				if (result.success) {
					res.writeHead(201, { "Content-Type": "application/json" });
					res.end(JSON.stringify(result.data));
				} else {
					res.writeHead(400, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ error: result.error?.message || "Failed to create task" }));
				}
			} else if (pathname.startsWith("/api/tasks/") && req.method === "PUT") {
				// Update task
				const taskId = pathname.split("/").pop();
				const body = await this.parseRequestBody(req);
				const updateData = JSON.parse(body);
				
				let result;
				if (updateData.status !== undefined) {
					result = await this.tcpClient.sendCommand(
						"update_task_status",
						{ id: taskId, status: updateData.status },
						environment,
					);
				} else if (updateData.priority !== undefined) {
					result = await this.tcpClient.sendCommand(
						"update_task_priority",
						{ id: taskId, priority: updateData.priority },
						environment,
					);
				} else {
					res.writeHead(400, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ error: "No valid update fields provided" }));
					return;
				}
				
				if (result.success) {
					res.writeHead(200, { "Content-Type": "application/json" });
					res.end(JSON.stringify(result.data));
				} else {
					res.writeHead(400, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ error: result.error?.message || "Failed to update task" }));
				}
			} else if (pathname.startsWith("/api/tasks/") && req.method === "DELETE") {
				// Delete task
				const taskId = pathname.split("/").pop();
				
				const result = await this.tcpClient.sendCommand("delete_task", { id: taskId }, environment);
				
				if (result.success) {
					res.writeHead(200, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ success: true }));
				} else {
					res.writeHead(400, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ error: result.error?.message || "Failed to delete task" }));
				}
			} else if (pathname === "/api/tasks/update" && req.method === "PUT") {
				// Alternative update endpoint
				const body = await this.parseRequestBody(req);
				const updateData = JSON.parse(body);
				
				const result = await this.tcpClient.sendCommand(
					"update_task_status",
					{ id: updateData.id, status: updateData.status },
					environment,
				);
				
				if (result.success) {
					res.writeHead(200, { "Content-Type": "application/json" });
					res.end(JSON.stringify(result.data));
				} else {
					res.writeHead(400, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ error: result.error?.message || "Failed to update task" }));
				}
			} else if (pathname === "/api/tasks/delete" && req.method === "DELETE") {
				// Alternative delete endpoint
				const url = new URL(req.url || "", `http://${req.headers.host}`);
				const taskId = url.searchParams.get("id");
				
				if (!taskId) {
					res.writeHead(400, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ error: "Task ID is required" }));
					return;
				}
				
				const result = await this.tcpClient.sendCommand("delete_task", { id: taskId }, environment);
				
				if (result.success) {
					res.writeHead(200, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ success: true }));
				} else {
					res.writeHead(400, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ error: result.error?.message || "Failed to delete task" }));
				}
			} else if (pathname === "/api/tasks/cancel" && req.method === "POST") {
				// Cancel task (set status to cancelled)
				const body = await this.parseRequestBody(req);
				const { id } = JSON.parse(body);
				
				const result = await this.tcpClient.sendCommand(
					"update_task_status",
					{ id, status: "cancelled" },
					environment,
				);
				
				if (result.success) {
					res.writeHead(200, { "Content-Type": "application/json" });
					res.end(JSON.stringify(result.data));
				} else {
					res.writeHead(400, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ error: result.error?.message || "Failed to cancel task" }));
				}
			} else if (pathname === "/api/tasks/retry" && req.method === "POST") {
				// Retry failed task (set status back to todo)
				const body = await this.parseRequestBody(req);
				const { id } = JSON.parse(body);
				
				const result = await this.tcpClient.sendCommand(
					"update_task_status",
					{ id, status: "todo" },
					environment,
				);
				
				if (result.success) {
					res.writeHead(200, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ success: true, message: "Task queued for retry" }));
				} else {
					res.writeHead(400, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ error: result.error?.message || "Failed to retry task" }));
				}
			} else {
				this.serve404(res);
			}
		} catch (error) {
			console.error("[DASHBOARD] Error in tasks API:", error);
			res.writeHead(500, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: error instanceof Error ? error.message : "Internal server error" }));
		}
	}

	private async serveQueueStatus(
		req: IncomingMessage,
		res: ServerResponse,
		environment: string,
	): Promise<void> {
		try {
			// Get all tasks to analyze queue status
			const tasksResult = await this.tcpClient.sendCommand("list_tasks", {}, environment);
			
			if (!tasksResult.success) {
				res.writeHead(500, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: "Failed to fetch tasks for queue analysis" }));
				return;
			}

			const tasks = tasksResult.data as any[];
			const todoTasks = tasks.filter(task => task.status === "todo");
			const inProgressTasks = tasks.filter(task => task.status === "in-progress");
			const failedTasks = tasks.filter(task => task.status === "failed");

			// Calculate queue metrics
			const queueByPriority = {
				high: todoTasks.filter(task => task.priority === "high"),
				medium: todoTasks.filter(task => task.priority === "medium"),
				low: todoTasks.filter(task => task.priority === "low")
			};

			// Simulate processing times (in a real implementation, you'd track this)
			const processingTimes = {
				averageProcessingTime: 45, // seconds
				totalProcessingTime: inProgressTasks.length * 45,
				estimatedWaitTime: todoTasks.length * 30 // seconds
			};

			const queueStatus = {
				total: todoTasks.length + inProgressTasks.length,
				highPriority: queueByPriority.high.length,
				processingTimes,
				failed: failedTasks.length,
				queueByPriority,
				failedTasks: failedTasks.slice(0, 10), // Limit to 10 for display
				timestamp: new Date().toISOString()
			};

			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify(queueStatus));
		} catch (error) {
			console.error("[DASHBOARD] Error serving queue status:", error);
			res.writeHead(500, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: error instanceof Error ? error.message : "Failed to fetch queue status" }));
		}
	}

	private async serveActivityLogs(
		req: IncomingMessage,
		res: ServerResponse,
		environment: string,
	): Promise<void> {
		try {
			const url = new URL(req.url || "", `http://${req.headers.host}`);
			const limit = parseInt(url.searchParams.get("limit") || "50");

			// Get recent tasks to simulate activity logs
			const tasksResult = await this.tcpClient.sendCommand("list_tasks", {}, environment);
			
			if (!tasksResult.success) {
				res.writeHead(500, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: "Failed to fetch tasks for activity log" }));
				return;
			}

			const tasks = tasksResult.data as any[];
			
			// Create activity log entries from recent task changes
			const logs = tasks
				.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
				.slice(0, limit)
				.map(task => ({
					id: `log_${task.id}_${Date.now()}`,
					timestamp: task.updatedAt,
					level: task.status === "failed" ? "error" : task.status === "done" ? "success" : "info",
					message: `Task "${task.title}" ${task.status.replace('-', ' ')}`,
					data: {
						taskId: task.id,
						taskTitle: task.title,
						status: task.status,
						priority: task.priority
					}
				}));

			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify(logs));
		} catch (error) {
			console.error("[DASHBOARD] Error serving activity logs:", error);
			res.writeHead(500, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: error instanceof Error ? error.message : "Failed to fetch activity logs" }));
		}
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

	private async serveBulkActions(
		req: IncomingMessage,
		res: ServerResponse,
		environment: string,
	): Promise<void> {
		try {
			const body = await this.parseRequestBody(req);
			const { action, taskIds, data } = JSON.parse(body);

			if (!action || !taskIds || !Array.isArray(taskIds)) {
				res.writeHead(400, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: "Action and taskIds array are required" }));
				return;
			}

			// Use the existing handleBulkTaskAction method
			const result = await this.handleBulkTaskAction(action, taskIds, data, environment);

			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify(result));
		} catch (error) {
			console.error("[DASHBOARD] Error in bulk action:", error);
			res.writeHead(500, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: error instanceof Error ? error.message : "Failed to perform bulk action" }));
		}
	}

	private async getMetrics(services: EnvironmentServices): Promise<DashboardMetrics> {
		const coreTasks = await services.productManager.getAllTasks();
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
				wsConnections: (services.webSocketManager as any).getConnectionCount?.() || 0,
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

	private async serveDaemonControl(
		req: IncomingMessage,
		res: ServerResponse,
		pathname: string,
		environment: string,
	): Promise<void> {
		try {
			const action = pathname.replace("/api/daemon/", "");
			
			switch (action) {
				case "status": {
					const result = await this.tcpClient.sendCommand("get_daemon_status", {}, environment);
					if (result.success) {
						res.writeHead(200, { "Content-Type": "application/json" });
						res.end(JSON.stringify(result.data));
					} else {
						res.writeHead(500, { "Content-Type": "application/json" });
						res.end(JSON.stringify({ error: result.error?.message || "Failed to get daemon status" }));
					}
					break;
				}
				case "pause": {
					const result = await this.tcpClient.sendCommand("pause_daemon", {}, environment);
					if (result.success) {
						res.writeHead(200, { "Content-Type": "application/json" });
						res.end(JSON.stringify({ success: true, message: "Daemon paused successfully" }));
					} else {
						res.writeHead(500, { "Content-Type": "application/json" });
						res.end(JSON.stringify({ error: result.error?.message || "Failed to pause daemon" }));
					}
					break;
				}
				case "resume": {
					const result = await this.tcpClient.sendCommand("resume_daemon", {}, environment);
					if (result.success) {
						res.writeHead(200, { "Content-Type": "application/json" });
						res.end(JSON.stringify({ success: true, message: "Daemon resumed successfully" }));
					} else {
						res.writeHead(500, { "Content-Type": "application/json" });
						res.end(JSON.stringify({ error: result.error?.message || "Failed to resume daemon" }));
					}
					break;
				}
				case "restart": {
					const result = await this.tcpClient.sendCommand("restart", {}, environment);
					if (result.success) {
						res.writeHead(200, { "Content-Type": "application/json" });
						res.end(JSON.stringify({ success: true, message: "Daemon restart initiated" }));
					} else {
						res.writeHead(500, { "Content-Type": "application/json" });
						res.end(JSON.stringify({ error: result.error?.message || "Failed to restart daemon" }));
					}
					break;
				}
				default: {
					res.writeHead(404, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ error: "Unknown daemon control action" }));
					break;
				}
			}
		} catch (error) {
			console.error("[DASHBOARD] Error in daemon control:", error);
			res.writeHead(500, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: error instanceof Error ? error.message : "Internal server error" }));
		}
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
        
        /* Audit History Styles */
        .audit-event {
            border-bottom: 1px solid #e5e7eb;
            padding: 16px 0;
            transition: background-color 0.2s;
        }
        
        .audit-event:hover {
            background: #f9fafb;
            padding-left: 16px;
            padding-right: 16px;
        }
        
        .audit-event:last-child {
            border-bottom: none;
        }
        
        .event-header {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 8px;
        }
        
        .event-icon {
            font-size: 1.2rem;
            width: 24px;
            text-align: center;
        }
        
        .event-type {
            font-weight: 600;
            color: #374151;
            font-size: 0.875rem;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        
        .event-time {
            margin-left: auto;
            font-size: 0.75rem;
            color: #6b7280;
        }
        
        .event-content {
            margin-left: 36px;
        }
        
        .event-task {
            font-size: 0.875rem;
            margin-bottom: 4px;
        }
        
        .event-details {
            font-size: 0.875rem;
            color: #6b7280;
            margin-bottom: 4px;
        }
        
        .event-changed-by {
            font-size: 0.75rem;
            color: #9ca3af;
            font-style: italic;
        }
        
        .event-error {
            font-size: 0.875rem;
            color: #ef4444;
            background: #fef2f2;
            padding: 4px 8px;
            border-radius: 4px;
            margin-top: 4px;
        }
        
        .summary-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 16px;
            margin-bottom: 20px;
        }
        
        .summary-item {
            text-align: center;
            padding: 16px;
            background: #f9fafb;
            border-radius: 8px;
        }
        
        .summary-label {
            font-size: 0.75rem;
            color: #6b7280;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            margin-bottom: 8px;
        }
        
        .summary-value {
            font-size: 1.25rem;
            font-weight: 700;
            color: #1f2937;
        }
        
        .summary-timeline {
            display: flex;
            justify-content: space-between;
            font-size: 0.875rem;
            color: #6b7280;
            padding: 12px 0;
            border-top: 1px solid #e5e7eb;
        }
        
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 16px;
            margin-bottom: 24px;
        }
        
        .stat-item {
            text-align: center;
            padding: 16px;
            background: #f9fafb;
            border-radius: 8px;
        }
        
        .stat-label {
            font-size: 0.75rem;
            color: #6b7280;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            margin-bottom: 8px;
        }
        
        .stat-value {
            font-size: 1.5rem;
            font-weight: 700;
            color: #1f2937;
        }
        
        .events-by-type {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 12px;
            margin-bottom: 24px;
        }
        
        .event-type-stat {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px 16px;
            background: #f3f4f6;
            border-radius: 6px;
        }
        
        .event-type-name {
            font-weight: 600;
            color: #374151;
            font-size: 0.875rem;
        }
        
        .event-type-count {
            font-weight: 700;
            color: #3b82f6;
            background: #dbeafe;
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 0.75rem;
        }
        
        .most-active-tasks {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        
        .active-task {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px 16px;
            background: #f9fafb;
            border-radius: 6px;
            border-left: 4px solid #3b82f6;
        }
        
        .task-id {
            font-family: monospace;
            font-size: 0.875rem;
            color: #374151;
        }
        
        .event-count {
            font-weight: 600;
            color: #6b7280;
            font-size: 0.875rem;
        }

        /* Bulk Actions Styles */
        .bulk-actions-container {
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 16px;
            margin-bottom: 16px;
        }
        
        .bulk-actions-info {
            font-weight: 600;
            color: #374151;
            margin-bottom: 12px;
            font-size: 0.875rem;
        }
        
        .bulk-actions-buttons {
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 8px;
        }
        
        .action-separator {
            width: 1px;
            height: 24px;
            background: #d1d5db;
            margin: 0 4px;
        }
        
        .bulk-select {
            padding: 6px 12px;
            border: 2px solid #e5e7eb;
            border-radius: 6px;
            font-size: 14px;
            background: white;
        }
        
        .task-checkbox {
            width: 18px;
            height: 18px;
            margin-right: 12px;
            cursor: pointer;
            accent-color: #3b82f6;
        }
        
        .task-item.selected {
            background: #eff6ff;
            border-left: 4px solid #3b82f6;
            padding-left: 12px;
        }
        
        .task-item:hover {
            background: #f9fafb;
        }
        
        .task-item.selected:hover {
            background: #dbeafe;
        }

        /* Task Details Modal */
        .task-details-modal {
            max-width: 800px;
            width: 90%;
        }
        
        .task-details-content {
            display: grid;
            gap: 20px;
        }
        
        .task-details-section {
            background: #f9fafb;
            padding: 16px;
            border-radius: 8px;
        }
        
        .task-details-section h3 {
            margin-bottom: 12px;
            font-size: 1.1rem;
            color: #1f2937;
            font-weight: 600;
        }
        
        .task-detail-row {
            display: flex;
            justify-content: space-between;
            padding: 8px 0;
            border-bottom: 1px solid #e5e7eb;
        }
        
        .task-detail-row:last-child {
            border-bottom: none;
        }
        
        .task-detail-label {
            font-weight: 600;
            color: #6b7280;
            font-size: 0.875rem;
        }
        
        .task-detail-value {
            color: #1f2937;
            font-size: 0.875rem;
        }

        /* Enhanced Health Tab */
        .health-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
            margin-bottom: 24px;
        }
        
        .health-card {
            background: white;
            border-radius: 12px;
            padding: 20px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
            border-left: 4px solid #10b981;
        }
        
        .health-card.warning {
            border-left-color: #f59e0b;
        }
        
        .health-card.error {
            border-left-color: #ef4444;
        }
        
        .health-title {
            font-size: 1.1rem;
            font-weight: 600;
            color: #1f2937;
            margin-bottom: 12px;
        }
        
        .health-metric {
            display: flex;
            justify-content: space-between;
            padding: 8px 0;
            font-size: 0.875rem;
        }
        
        .health-metric-label {
            color: #6b7280;
        }
        
        .health-metric-value {
            font-weight: 600;
            color: #1f2937;
        }

        /* Print styles */
        @media print {
            body {
                background: white;
            }
            
            .header, .task-form, .filters, .btn, .task-actions,
            .bulk-actions-container, .task-actions {
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
            <button class="tab" data-tab="history">Task History</button>
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
                        <button class="btn btn-secondary btn-sm" onclick="toggleBulkActions()">
                            <span>☑️</span> Bulk Actions
                        </button>
                    </div>
                </div>
                
                <!-- Bulk Actions Panel -->
                <div id="bulkActionsPanel" style="display: none; margin-bottom: 20px;">
                    <div class="bulk-actions-container">
                        <div class="bulk-actions-info">
                            <span id="selectedCount">0</span> tasks selected
                        </div>
                        <div class="bulk-actions-buttons">
                            <button class="btn btn-secondary btn-sm" onclick="selectAllTasks()">
                                <span>☑️</span> Select All
                            </button>
                            <button class="btn btn-secondary btn-sm" onclick="clearSelection()">
                                <span>❌</span> Clear Selection
                            </button>
                            <div class="action-separator"></div>
                            <select id="bulkPrioritySelect" class="bulk-select">
                                <option value="">Set Priority...</option>
                                <option value="high">High Priority</option>
                                <option value="medium">Medium Priority</option>
                                <option value="low">Low Priority</option>
                            </select>
                            <button class="btn btn-warning btn-sm" onclick="bulkSetPriority()">
                                <span>⚡</span> Set Priority
                            </button>
                            <div class="action-separator"></div>
                            <button class="btn btn-success btn-sm" onclick="bulkResume()">
                                <span>▶️</span> Resume
                            </button>
                            <button class="btn btn-danger btn-sm" onclick="bulkCancel()">
                                <span>⏹️</span> Cancel
                            </button>
                            <button class="btn btn-danger btn-sm" onclick="bulkDelete()">
                                <span>🗑️</span> Delete
                            </button>
                        </div>
                    </div>
                </div>
                
                <div id="tasksList" class="loading">Loading tasks...</div>
            </div>
        </div>

        <!-- Health Tab -->
        <div id="health-tab" class="tab-content">
            <div class="health-grid">
                <div class="health-card">
                    <div class="health-title">🏥️ System Health</div>
                    <div class="health-metric">
                        <span class="health-metric-label">Status:</span>
                        <span class="health-metric-value" id="healthStatusDetailed">-</span>
                    </div>
                    <div class="health-metric">
                        <span class="health-metric-label">Uptime:</span>
                        <span class="health-metric-value" id="healthUptime">-</span>
                    </div>
                    <div class="health-metric">
                        <span class="health-metric-label">Process ID:</span>
                        <span class="health-metric-value" id="healthPid">-</span>
                    </div>
                    <div class="health-metric">
                        <span class="health-metric-label">Node Version:</span>
                        <span class="health-metric-value" id="healthNodeVersion">-</span>
                    </div>
                </div>

                <div class="health-card">
                    <div class="health-title">💾 Memory Usage</div>
                    <div class="health-metric">
                        <span class="health-metric-label">Used:</span>
                        <span class="health-metric-value" id="memoryUsed">-</span>
                    </div>
                    <div class="health-metric">
                        <span class="health-metric-label">Total:</span>
                        <span class="health-metric-value" id="memoryTotal">-</span>
                    </div>
                    <div class="health-metric">
                        <span class="health-metric-label">Usage:</span>
                        <span class="health-metric-value" id="memoryPercent">-</span>
                    </div>
                    <div class="health-metric">
                        <span class="health-metric-label">External:</span>
                        <span class="health-metric-value" id="memoryExternal">-</span>
                    </div>
                </div>

                <div class="health-card">
                    <div class="health-title">🔌 Connections</div>
                    <div class="health-metric">
                        <span class="health-metric-label">TCP:</span>
                        <span class="health-metric-value" id="tcpConnection">-</span>
                    </div>
                    <div class="health-metric">
                        <span class="health-metric-label">WebSockets:</span>
                        <span class="health-metric-value" id="wsConnectionsHealth">-</span>
                    </div>
                    <div class="health-metric">
                        <span class="health-metric-label">HTTP Server:</span>
                        <span class="health-metric-value" id="httpServerStatus">-</span>
                    </div>
                    <div class="health-metric">
                        <span class="health-metric-label">Dashboard Server:</span>
                        <span class="health-metric-value" id="dashboardServerStatus">-</span>
                    </div>
                </div>

                <div class="health-card">
                    <div class="health-title">🖥️ System Info</div>
                    <div class="health-metric">
                        <span class="health-metric-label">Platform:</span>
                        <span class="health-metric-value" id="systemPlatform">-</span>
                    </div>
                    <div class="health-metric">
                        <span class="health-metric-label">Architecture:</span>
                        <span class="health-metric-value" id="systemArch">-</span>
                    </div>
                    <div class="health-metric">
                        <span class="health-metric-label">Total Memory:</span>
                        <span class="health-metric-value" id="totalMemory">-</span>
                    </div>
                    <div class="health-metric">
                        <span class="health-metric-label">Free Memory:</span>
                        <span class="health-metric-value" id="freeMemory">-</span>
                    </div>
                </div>

                <div class="health-card">
                    <div class="health-title">📊 Task Performance</div>
                    <div class="health-metric">
                        <span class="health-metric-label">Total Tasks:</span>
                        <span class="health-metric-value" id="healthTotalTasks">-</span>
                    </div>
                    <div class="health-metric">
                        <span class="health-metric-label">Completion Rate:</span>
                        <span class="health-metric-value" id="healthCompletionRate">-</span>
                    </div>
                    <div class="health-metric">
                        <span class="health-metric-label">Failed Tasks:</span>
                        <span class="health-metric-value" id="healthFailedTasks">-</span>
                    </div>
                    <div class="health-metric">
                        <span class="health-metric-label">Overdue Tasks:</span>
                        <span class="health-metric-value" id="healthOverdueTasks">-</span>
                    </div>
                </div>

                <div class="health-card">
                    <div class="health-title">⚙️ Daemon Controls</div>
                    <div class="health-metric">
                        <span class="health-metric-label">Processing Status:</span>
                        <span class="health-metric-value" id="daemonProcessingStatus">-</span>
                    </div>
                    <div class="health-metric">
                        <span class="health-metric-label">Controls:</span>
                        <div style="display: flex; gap: 8px; margin-top: 8px;">
                            <button class="btn btn-warning btn-sm" id="pauseDaemonBtn" onclick="pauseDaemon()">
                                <span>⏸️</span> Pause
                            </button>
                            <button class="btn btn-success btn-sm" id="resumeDaemonBtn" onclick="resumeDaemon()" style="display: none;">
                                <span>▶️</span> Resume
                            </button>
                            <button class="btn btn-danger btn-sm" onclick="restartDaemon()">
                                <span>🔄</span> Restart
                            </button>
                        </div>
                    </div>
                </div>

                <div class="health-card">
                    <div class="health-title">⚠️ System Alerts</div>
                    <div id="healthAlerts" class="health-alerts">
                        <div class="loading">Loading system alerts...</div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Task History Tab -->
        <div id="history-tab" class="tab-content">
            <div class="tasks-section">
                <div class="tasks-header">
                    <h2>Task History & Audit Trail</h2>
                    <div class="form-actions">
                        <button class="btn btn-primary btn-sm" onclick="loadAuditHistory()">
                            <span>🔄</span> Refresh
                        </button>
                        <button class="btn btn-secondary btn-sm" onclick="loadAuditStatistics()">
                            <span>📊</span> Statistics
                        </button>
                    </div>
                </div>
                
                <!-- History Filters -->
                <div class="filters">
                    <div class="filter-group">
                        <label for="historyTaskId">Task ID:</label>
                        <input type="text" id="historyTaskId" placeholder="Enter task ID...">
                    </div>
                    <div class="filter-group">
                        <label for="historyEventType">Event Type:</label>
                        <select id="historyEventType">
                            <option value="">All Events</option>
                            <option value="created">Created</option>
                            <option value="status_changed">Status Changed</option>
                            <option value="priority_changed">Priority Changed</option>
                            <option value="assigned">Assigned</option>
                            <option value="updated">Updated</option>
                            <option value="deleted">Deleted</option>
                        </select>
                    </div>
                    <div class="filter-group">
                        <label for="historyChangedBy">Changed By:</label>
                        <input type="text" id="historyChangedBy" placeholder="Username...">
                    </div>
                    <div class="filter-group">
                        <label for="historyFromDate">From Date:</label>
                        <input type="datetime-local" id="historyFromDate">
                    </div>
                    <div class="filter-group">
                        <label for="historyToDate">To Date:</label>
                        <input type="datetime-local" id="historyToDate">
                    </div>
                    <div class="filter-group">
                        <label for="historyLimit">Limit:</label>
                        <select id="historyLimit">
                            <option value="50">50</option>
                            <option value="100" selected>100</option>
                            <option value="200">200</option>
                            <option value="500">500</option>
                        </select>
                    </div>
                    <div class="filter-group">
                        <button class="btn btn-primary btn-sm" onclick="applyHistoryFilters()">
                            <span>🔍</span> Apply Filters
                        </button>
                        <button class="btn btn-secondary btn-sm" onclick="clearHistoryFilters()">
                            <span>🗑️</span> Clear
                        </button>
                    </div>
                </div>
                
                <!-- Task Summary Section -->
                <div id="taskSummarySection" style="margin-bottom: 24px; display: none;">
                    <div class="metric-card">
                        <h3>Task Summary</h3>
                        <div id="taskSummaryContent"></div>
                    </div>
                </div>
                
                <!-- History List -->
                <div id="auditHistoryList" class="loading">Loading audit history...</div>
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
                            if (tabName === 'history') loadAuditHistory();
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

        // Bulk Actions Functions
        let selectedTasks = new Set();
        let bulkActionsVisible = false;

        function toggleBulkActions() {
            bulkActionsVisible = !bulkActionsVisible;
            const panel = document.getElementById('bulkActionsPanel');
            panel.style.display = bulkActionsVisible ? 'block' : 'none';
            
            // Add checkboxes to tasks if showing bulk actions
            if (bulkActionsVisible) {
                addTaskCheckboxes();
            } else {
                removeTaskCheckboxes();
            }
            
            updateBulkActionsUI();
        }

        function addTaskCheckboxes() {
            const taskItems = document.querySelectorAll('.task-item');
            taskItems.forEach(item => {
                const taskId = item.dataset.taskId;
                if (!item.querySelector('.task-checkbox')) {
                    const checkbox = document.createElement('input');
                    checkbox.type = 'checkbox';
                    checkbox.className = 'task-checkbox';
                    checkbox.dataset.taskId = taskId;
                    checkbox.addEventListener('change', (e) => {
                        if (e.target.checked) {
                            selectedTasks.add(taskId);
                            item.classList.add('selected');
                        } else {
                            selectedTasks.delete(taskId);
                            item.classList.remove('selected');
                        }
                        updateBulkActionsUI();
                    });
                    
                    // Insert checkbox at the beginning of task-header
                    const header = item.querySelector('.task-header');
                    header.insertBefore(checkbox, header.firstChild);
                }
            });
        }

        function removeTaskCheckboxes() {
            const checkboxes = document.querySelectorAll('.task-checkbox');
            checkboxes.forEach(cb => cb.remove());
            
            const taskItems = document.querySelectorAll('.task-item');
            taskItems.forEach(item => item.classList.remove('selected'));
            
            selectedTasks.clear();
        }

        function selectAllTasks() {
            const checkboxes = document.querySelectorAll('.task-checkbox');
            checkboxes.forEach(cb => {
                cb.checked = true;
                const taskId = cb.dataset.taskId;
                selectedTasks.add(taskId);
                cb.closest('.task-item').classList.add('selected');
            });
            updateBulkActionsUI();
        }

        function clearSelection() {
            const checkboxes = document.querySelectorAll('.task-checkbox');
            checkboxes.forEach(cb => {
                cb.checked = false;
                cb.closest('.task-item').classList.remove('selected');
            });
            selectedTasks.clear();
            updateBulkActionsUI();
        }

        function updateBulkActionsUI() {
            document.getElementById('selectedCount').textContent = selectedTasks.size;
            
            // Enable/disable bulk action buttons based on selection
            const buttons = document.querySelectorAll('.bulk-actions-buttons button');
            buttons.forEach(btn => {
                if (btn.textContent.includes('Select All') || btn.textContent.includes('Clear Selection')) {
                    return; // Always enable these
                }
                btn.disabled = selectedTasks.size === 0;
            });
        }

        async function bulkSetPriority() {
            if (selectedTasks.size === 0) return;
            
            const priority = document.getElementById('bulkPrioritySelect').value;
            if (!priority) {
                showError('Please select a priority level');
                return;
            }
            
            if (!confirm('Set priority to ' + priority + ' for ' + selectedTasks.size + ' selected tasks?')) {
                return;
            }
            
            await performBulkAction('set_priority', { priority });
        }

        async function bulkResume() {
            if (selectedTasks.size === 0) return;
            
            if (!confirm('Resume ' + selectedTasks.size + ' selected tasks?')) {
                return;
            }
            
            await performBulkAction('resume');
        }

        async function bulkCancel() {
            if (selectedTasks.size === 0) return;
            
            if (!confirm('Cancel ' + selectedTasks.size + ' selected tasks?')) {
                return;
            }
            
            await performBulkAction('cancel');
        }

        async function bulkDelete() {
            if (selectedTasks.size === 0) return;
            
            if (!confirm('PERMANENTLY delete ' + selectedTasks.size + ' selected tasks? This action cannot be undone.')) {
                return;
            }
            
            await performBulkAction('delete');
        }

        async function performBulkAction(action, data = null) {
            try {
                showInfo('Performing ' + action + ' on ' + selectedTasks.size + ' tasks...');
                
                const taskIds = Array.from(selectedTasks);
                const response = await fetch('/api/tasks/bulk-action', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action,
                        taskIds,
                        data
                    })
                });
                
                const result = await response.json();
                
                if (result.successful > 0) {
                    showSuccess(action + ' completed successfully for ' + result.successful + ' tasks');
                }
                
                if (result.failed > 0) {
                    showError(action + ' failed for ' + result.failed + ' tasks');
                }
                
                // Clear selection and refresh
                clearSelection();
                await loadTasks();
                await loadMetrics();
                
            } catch (error) {
                showError('Failed to perform bulk action: ' + error.message);
            }
        }

        async function loadHealthDetails() {
            // Health details are already loaded in loadMetrics()
            // This function ensures that health tab is updated when switched to
            await loadMetrics();
        }
            } catch (error) {
                console.error('Error loading daemon status:', error);
                document.getElementById('daemonProcessingStatus').textContent = 'Unknown';
            }
        }

        // Daemon Control Functions
        async function pauseDaemon() {
            if (!confirm('Are you sure you want to pause the daemon? This will stop task processing.')) {
                return;
            }
            
            try {
                const response = await fetch('/api/daemon/pause', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                });
                
                const result = await response.json();
                if (result.success) {
                    showSuccess('Daemon paused successfully!');
                    await loadHealthDetails();
                    await loadMetrics();
                } else {
                    showError('Failed to pause daemon: ' + (result.error || 'Unknown error'));
                }
            } catch (error) {
                showError('Failed to pause daemon: ' + error.message);
            }
        }

        async function resumeDaemon() {
            if (!confirm('Are you sure you want to resume the daemon? This will restart task processing.')) {
                return;
            }
            
            try {
                const response = await fetch('/api/daemon/resume', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                });
                
                const result = await response.json();
                if (result.success) {
                    showSuccess('Daemon resumed successfully!');
                    await loadHealthDetails();
                    await loadMetrics();
                } else {
                    showError('Failed to resume daemon: ' + (result.error || 'Unknown error'));
                }
            } catch (error) {
                showError('Failed to resume daemon: ' + error.message);
            }
        }

        async function restartDaemon() {
            if (!confirm('Are you sure you want to restart the daemon? This will restart the entire service.')) {
                return;
            }
            
            try {
                const response = await fetch('/api/daemon/restart', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                });
                
                const result = await response.json();
                if (result.success) {
                    showSuccess('Daemon restart initiated! The dashboard will refresh in a few seconds.');
                    // Refresh after delay to allow restart to complete
                    setTimeout(() => {
                        window.location.reload();
                    }, 5000);
                } else {
                    showError('Failed to restart daemon: ' + (result.error || 'Unknown error'));
                }
            } catch (error) {
                showError('Failed to restart daemon: ' + error.message);
            }
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

        function showInfo(message) {
            showMessage(message, 'info');
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

        // Include external audit history script
        function loadAuditHistory() {
            // Function defined in audit-history.js
            if (typeof window.loadAuditHistory === 'function') {
                window.loadAuditHistory();
            }
        }

        function loadTaskSummary(taskId) {
            // Function defined in audit-history.js
            if (typeof window.loadTaskSummary === 'function') {
                window.loadTaskSummary(taskId);
            }
        }

        function loadAuditStatistics() {
            // Function defined in audit-history.js
            if (typeof window.loadAuditStatistics === 'function') {
                window.loadAuditStatistics();
            }
        }

        function applyHistoryFilters() {
            // Function defined in audit-history.js
            if (typeof window.applyHistoryFilters === 'function') {
                window.applyHistoryFilters();
            }
        }

        function clearHistoryFilters() {
            // Function defined in audit-history.js
            if (typeof window.clearHistoryFilters === 'function') {
                window.clearHistoryFilters();
            }
        }

        // Bulk Actions Functions
        let selectedTasks = new Set();
        let bulkActionsVisible = false;

        function toggleBulkActions() {
            bulkActionsVisible = !bulkActionsVisible;
            const panel = document.getElementById('bulkActionsPanel');
            panel.style.display = bulkActionsVisible ? 'block' : 'none';
            
            // Add checkboxes to tasks if showing bulk actions
            if (bulkActionsVisible) {
                addTaskCheckboxes();
            } else {
                removeTaskCheckboxes();
            }
            
            updateBulkActionsUI();
        }

        function addTaskCheckboxes() {
            const taskItems = document.querySelectorAll('.task-item');
            taskItems.forEach(item => {
                const taskId = item.dataset.taskId;
                if (!item.querySelector('.task-checkbox')) {
                    const checkbox = document.createElement('input');
                    checkbox.type = 'checkbox';
                    checkbox.className = 'task-checkbox';
                    checkbox.dataset.taskId = taskId;
                    checkbox.addEventListener('change', (e) => {
                        if (e.target.checked) {
                            selectedTasks.add(taskId);
                            item.classList.add('selected');
                        } else {
                            selectedTasks.delete(taskId);
                            item.classList.remove('selected');
                        }
                        updateBulkActionsUI();
                    });
                    
                    // Insert checkbox at the beginning of task-header
                    const header = item.querySelector('.task-header');
                    header.insertBefore(checkbox, header.firstChild);
                }
            });
        }

        function removeTaskCheckboxes() {
            const checkboxes = document.querySelectorAll('.task-checkbox');
            checkboxes.forEach(cb => cb.remove());
            
            const taskItems = document.querySelectorAll('.task-item');
            taskItems.forEach(item => item.classList.remove('selected'));
            
            selectedTasks.clear();
        }

        function selectAllTasks() {
            const checkboxes = document.querySelectorAll('.task-checkbox');
            checkboxes.forEach(cb => {
                cb.checked = true;
                const taskId = cb.dataset.taskId;
                selectedTasks.add(taskId);
                cb.closest('.task-item').classList.add('selected');
            });
            updateBulkActionsUI();
        }

        function clearSelection() {
            const checkboxes = document.querySelectorAll('.task-checkbox');
            checkboxes.forEach(cb => {
                cb.checked = false;
                cb.closest('.task-item').classList.remove('selected');
            });
            selectedTasks.clear();
            updateBulkActionsUI();
        }

        function updateBulkActionsUI() {
            document.getElementById('selectedCount').textContent = selectedTasks.size;
            
            // Enable/disable bulk action buttons based on selection
            const buttons = document.querySelectorAll('.bulk-actions-buttons button');
            buttons.forEach(btn => {
                if (btn.textContent.includes('Select All') || btn.textContent.includes('Clear Selection')) {
                    return; // Always enable these
                }
                btn.disabled = selectedTasks.size === 0;
            });
        }

        async function bulkSetPriority() {
            if (selectedTasks.size === 0) return;
            
            const priority = document.getElementById('bulkPrioritySelect').value;
            if (!priority) {
                showError('Please select a priority level');
                return;
            }
            
            if (!confirm('Set priority to ' + priority + ' for ' + selectedTasks.size + ' selected tasks?')) {
                return;
            }
            
            await performBulkAction('set_priority', { priority });
        }

        async function bulkResume() {
            if (selectedTasks.size === 0) return;
            
            if (!confirm('Resume ' + selectedTasks.size + ' selected tasks?')) {
                return;
            }
            
            await performBulkAction('resume');
        }

        async function bulkCancel() {
            if (selectedTasks.size === 0) return;
            
            if (!confirm('Cancel ' + selectedTasks.size + ' selected tasks?')) {
                return;
            }
            
            await performBulkAction('cancel');
        }

        async function bulkDelete() {
            if (selectedTasks.size === 0) return;
            
            if (!confirm('PERMANENTLY delete ' + selectedTasks.size + ' selected tasks? This action cannot be undone.')) {
                return;
            }
            
            await performBulkAction('delete');
        }

        async function performBulkAction(action, data) {
            try {
                showInfo('Performing ' + action + ' on ' + selectedTasks.size + ' tasks...');
                
                const taskIds = Array.from(selectedTasks);
                const response = await fetch('/api/tasks/bulk-action', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action,
                        taskIds,
                        data
                    })
                });
                
                const result = await response.json();
                
                if (result.successful > 0) {
                    showSuccess(action + ' completed successfully for ' + result.successful + ' tasks');
                }
                
                if (result.failed > 0) {
                    showError(action + ' failed for ' + result.failed + ' tasks');
                }
                
                // Clear selection and refresh
                clearSelection();
                await loadTasks();
                await loadMetrics();
                
            } catch (error) {
                showError('Failed to perform bulk action: ' + error.message);
            }
        }

        // Daemon Control Functions
        async function loadDaemonStatus() {
            try {
                const response = await fetch('/api/daemon/status');
                const data = await response.json();
                
                document.getElementById('daemonProcessingStatus').textContent = data.paused ? 'Paused' : 'Active';
                
                // Update button states
                const pauseBtn = document.getElementById('pauseDaemonBtn');
                const resumeBtn = document.getElementById('resumeDaemonBtn');
                
                if (data.paused) {
                    pauseBtn.style.display = 'none';
                    resumeBtn.style.display = 'inline-flex';
                } else {
                    pauseBtn.style.display = 'inline-flex';
                    resumeBtn.style.display = 'none';
                }
            } catch (error) {
                console.error('Error loading daemon status:', error);
                document.getElementById('daemonProcessingStatus').textContent = 'Unknown';
            }
        }

        async function pauseDaemon() {
            if (!confirm('Are you sure you want to pause the daemon? This will stop task processing.')) {
                return;
            }
            
            try {
                const response = await fetch('/api/daemon/pause', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                });
                
                const result = await response.json();
                if (result.success) {
                    showSuccess('Daemon paused successfully!');
                    await loadDaemonStatus();
                    await loadMetrics();
                } else {
                    showError('Failed to pause daemon: ' + (result.error || 'Unknown error'));
                }
            } catch (error) {
                showError('Failed to pause daemon: ' + error.message);
            }
        }

        async function resumeDaemon() {
            if (!confirm('Are you sure you want to resume the daemon? This will restart task processing.')) {
                return;
            }
            
            try {
                const response = await fetch('/api/daemon/resume', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                });
                
                const result = await response.json();
                if (result.success) {
                    showSuccess('Daemon resumed successfully!');
                    await loadDaemonStatus();
                    await loadMetrics();
                } else {
                    showError('Failed to resume daemon: ' + (result.error || 'Unknown error'));
                }
            } catch (error) {
                showError('Failed to resume daemon: ' + error.message);
            }
        }

        async function restartDaemon() {
            if (!confirm('Are you sure you want to restart the daemon? This will restart the entire service.')) {
                return;
            }
            
            try {
                const response = await fetch('/api/daemon/restart', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                });
                
                const result = await response.json();
                if (result.success) {
                    showSuccess('Daemon restart initiated! The dashboard will refresh in a few seconds.');
                    // Refresh after delay to allow restart to complete
                    setTimeout(() => {
                        window.location.reload();
                    }, 5000);
                } else {
                    showError('Failed to restart daemon: ' + (result.error || 'Unknown error'));
                }
            } catch (error) {
                showError('Failed to restart daemon: ' + error.message);
            }
        }

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
    <script src="/audit-history.js"></script>
</body>
</html>`;
	}
}
