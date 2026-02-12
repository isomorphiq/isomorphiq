import { createConnection } from "node:net";
import { WebSocket } from "ws";
import type { Result } from "@isomorphiq/core";

export interface Task {
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

export interface TaskFilter {
	status?: string | string[];
	priority?: string | string[];
	createdBy?: string;
	assignedTo?: string;
	type?: string;
	createdAfter?: Date;
	createdBefore?: Date;
	updatedAfter?: Date;
	updatedBefore?: Date;
	limit?: number;
	offset?: number;
}

export interface TaskMonitoringSession {
	id: string;
	filters: TaskFilter;
	createdAt: string;
	lastActivity: string;
	active: boolean;
}

const resolveDefaultPort = (): number => {
	const envPort = Number(process.env.TCP_PORT ?? process.env.DAEMON_PORT);
	return Number.isFinite(envPort) && envPort > 0 ? envPort : 3001;
};

const resolveDefaultHost = (): string => process.env.DAEMON_HOST ?? "localhost";

const resolveDefaultEnvironment = (): string => {
	const configured =
		process.env.ISOMORPHIQ_TEST_ENVIRONMENT ?? process.env.ISOMORPHIQ_ENVIRONMENT;
	if (configured && configured.trim().length > 0) {
		return configured.trim().toLowerCase();
	}
	return "integration";
};

/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class DaemonTcpClient {
	private port: number;
	private host: string;
	private wsConnection: WebSocket | null = null;
	private environment: string;

	constructor(
		port: number = resolveDefaultPort(),
		host: string = resolveDefaultHost(),
		environment: string = resolveDefaultEnvironment(),
	) {
		this.port = port;
		this.host = host;
		this.environment = environment;
	}

	async sendCommand<T = unknown, R = unknown>(
		command: string,
		data: T,
		environment: string = this.environment,
	): Promise<Result<R>> {
		return new Promise((resolve, reject) => {
			const client = createConnection({ port: this.port, host: this.host }, () => {
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
					// Wait for more data
				}
			});

			client.on("error", (err) => {
				reject(new Error(`Connection error: ${err.message}`));
			});

			client.on("close", () => {
				if (!response) {
					reject(new Error("Connection closed without response"));
				}
			});

			setTimeout(() => {
				client.destroy();
				reject(new Error("Request timeout"));
			}, 10000);
		});
	}

	async createTask(taskData: {
		title: string;
		description: string;
		priority?: string;
		dependencies?: string[];
		createdBy?: string;
		assignedTo?: string;
		collaborators?: string[];
		watchers?: string[];
		type?: string;
	}): Promise<Result<Task>> {
		return this.sendCommand("create_task", taskData);
	}

	async listTasks(): Promise<Result<Task[]>> {
		return this.sendCommand("list_tasks", {});
	}

	async getTask(id: string): Promise<Result<Task>> {
		return this.sendCommand("get_task", { id });
	}

	async getTaskStatus(id: string): Promise<Result<{taskId: string; status: string; updatedAt: string}>> {
		return this.sendCommand("get_task_status", { id });
	}

	async listTasksFiltered(filters: {
		status?: string | string[];
		priority?: string | string[];
		createdBy?: string;
		assignedTo?: string;
		type?: string;
		search?: string;
		limit?: number;
		offset?: number;
	}): Promise<Result<Task[]>> {
		return this.sendCommand("list_tasks_filtered", { filters });
	}

	async subscribeToTaskNotifications(options: {
		sessionId?: string;
		taskIds?: string[];
		includeTcpResponse?: boolean;
	}): Promise<Result<{sessionId: string; subscribedTasks: string[]; message: string}>> {
		return this.sendCommand("subscribe_to_task_notifications", options);
	}

	async updateTaskStatus(id: string, status: string): Promise<Result<Task>> {
		return this.sendCommand("update_task_status", { id, status });
	}

	async updateTaskPriority(id: string, priority: string): Promise<Result<Task>> {
		return this.sendCommand("update_task_priority", { id, priority });
	}

	async updateTask(id: string, updates: Partial<Task>): Promise<Result<Task>> {
		return this.sendCommand("update_task", { id, updates });
	}

	async deleteTask(id: string): Promise<Result<boolean>> {
		return this.sendCommand("delete_task", { id });
	}

	async getWebSocketStatus(): Promise<Result<unknown>> {
		return this.sendCommand("ws_status", {});
	}

	async restart(): Promise<Result<{ message: string }>> {
		return this.sendCommand("restart", {});
	}

	async checkConnection(): Promise<boolean> {
		return new Promise((resolve) => {
			const client = createConnection({ port: this.port, host: this.host }, () => {
				client.end();
				resolve(true);
			});

			client.on("error", () => {
				resolve(false);
			});

			setTimeout(() => {
				client.destroy();
				resolve(false);
			}, 2000);
		});
	}

	// Task monitoring methods
	async createMonitoringSession(filters?: TaskFilter): Promise<Result<TaskMonitoringSession>> {
		return this.sendCommand("create_monitoring_session", { filters });
	}

	async updateMonitoringSession(sessionId: string, filters: Partial<TaskFilter>): Promise<Result<boolean>> {
		return this.sendCommand("update_monitoring_session", { sessionId, filters });
	}

	async getFilteredTasks(filters: TaskFilter): Promise<Result<Task[]>> {
		return this.sendCommand("get_filtered_tasks", { filters });
	}

	async getSessionTasks(sessionId: string): Promise<Result<Task[]>> {
		return this.sendCommand("get_session_tasks", { sessionId });
	}

	async subscribeToTaskUpdates(sessionId: string, taskIds?: string[]): Promise<Result<boolean>> {
		return this.sendCommand("subscribe_to_task_updates", { sessionId, taskIds });
	}

	async getMonitoringSession(sessionId: string): Promise<Result<TaskMonitoringSession>> {
		return this.sendCommand("get_monitoring_session", { sessionId });
	}

	async getMonitoringSessions(): Promise<Result<TaskMonitoringSession[]>> {
		return this.sendCommand("get_monitoring_sessions", {});
	}

	async closeMonitoringSession(sessionId: string): Promise<Result<boolean>> {
		return this.sendCommand("close_monitoring_session", { sessionId });
	}

	// WebSocket integration for real-time updates
	async connectWebSocket(dashboardPort: number = 3005): Promise<WebSocket> {
		const wsUrl = `ws://localhost:${dashboardPort}/dashboard-ws`;
		
		return new Promise((resolve, reject) => {
			this.wsConnection = new WebSocket(wsUrl);
			
			this.wsConnection.on("open", () => {
				console.log("[TCP-CLIENT] WebSocket connected for real-time updates");
				resolve(this.wsConnection!);
			});
			
			this.wsConnection.on("message", (data) => {
				try {
					const message = JSON.parse(data.toString());
					this.handleWebSocketMessage(message);
				} catch (error) {
					console.error("[TCP-CLIENT] Error parsing WebSocket message:", error);
				}
			});
			
			this.wsConnection.on("error", (error) => {
				console.error("[TCP-CLIENT] WebSocket error:", error);
				reject(error);
			});
			
			this.wsConnection.on("close", () => {
				console.log("[TCP-CLIENT] WebSocket disconnected");
				this.wsConnection = null;
			});
		});
	}

	private handleWebSocketMessage(message: any): void {
		switch (message.type) {
			case "task_created":
				console.log("[TCP-CLIENT] Task created:", message.data.title);
				break;
			case "task_status_changed":
				console.log("[TCP-CLIENT] Task status changed:", message.data.taskId, "to", message.data.newStatus);
				break;
			case "task_priority_changed":
				console.log("[TCP-CLIENT] Task priority changed:", message.data.taskId, "to", message.data.newPriority);
				break;
			case "task_deleted":
				console.log("[TCP-CLIENT] Task deleted:", message.data.taskId);
				break;
			case "metrics_update":
				// Handle real-time metrics updates
				break;
			default:
				console.log("[TCP-CLIENT] Unknown WebSocket message type:", message.type);
		}
	}

	async subscribeToRealTimeUpdates(taskIds?: string[]): Promise<Result<{sessionId: string; subscribedTasks: string[]}>> {
		const subscriptionData = {
			sessionId: `tcp_client_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
			taskIds: taskIds || [],
			includeTcpResponse: true
		};

		const result = await this.subscribeToTaskNotifications(subscriptionData);
		return result;
	}

	disconnectWebSocket(): void {
		if (this.wsConnection && this.wsConnection.readyState === WebSocket.OPEN) {
			this.wsConnection.close();
		}
	}

	isWebSocketConnected(): boolean {
		return this.wsConnection !== null && this.wsConnection.readyState === WebSocket.OPEN;
	}

	getWebSocketConnection(): WebSocket | null {
		return this.wsConnection;
	}

	// Notification methods
	async setNotificationPreferences(preferences: any): Promise<Result<{message: string}>> {
		return this.sendCommand("set_notification_preferences", preferences);
	}

	async getNotificationPreferences(userId: string): Promise<Result<any>> {
		return this.sendCommand("get_notification_preferences", { userId });
	}

	async sendNotification(notification: any): Promise<Result<string>> {
		return this.sendCommand("send_notification", notification);
	}

	async getNotificationHistory(userId?: string, limit?: number): Promise<Result<any[]>> {
		return this.sendCommand("get_notification_history", { userId, limit });
	}

	async markNotificationAsRead(notificationId: string, userId: string): Promise<Result<{marked: boolean}>> {
		return this.sendCommand("mark_notification_read", { notificationId, userId });
	}

	async getNotificationStats(userId?: string): Promise<Result<any>> {
		return this.sendCommand("get_notification_stats", { userId });
	}

	async sendDailyDigest(userId: string, tasks: any[]): Promise<Result<string>> {
		return this.sendCommand("send_daily_digest", { userId, tasks });
	}

	async sendWeeklyDigest(userId: string, tasks: any[]): Promise<Result<string>> {
		return this.sendCommand("send_weekly_digest", { userId, tasks });
	}
}

