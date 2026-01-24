import { createConnection } from "node:net";
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

export interface TaskStatusUpdate {
	taskId: string;
	oldStatus?: string;
	newStatus: string;
	timestamp: string;
	task: Task;
}

export class DaemonTcpClient {
	private port: number;
	private host: string;

	constructor(port: number = 3001, host: string = "localhost") {
		this.port = port;
		this.host = host;
	}

	async sendCommand<T = unknown, R = unknown>(command: string, data: T): Promise<Result<R>> {
		return new Promise((resolve, reject) => {
			const client = createConnection({ port: this.port, host: this.host }, () => {
				const message = `${JSON.stringify({ command, data })}\n`;
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
}