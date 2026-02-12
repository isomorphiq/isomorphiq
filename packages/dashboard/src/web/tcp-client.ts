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

export interface TaskStatusUpdate {
	taskId: string;
	oldStatus?: string;
	newStatus: string;
	timestamp: string;
	task: Task;
}

const resolveDefaultPort = (): number => {
	const envPort = Number(process.env.TCP_PORT ?? process.env.DAEMON_PORT);
	return Number.isFinite(envPort) && envPort > 0 ? envPort : 3001;
};

const resolveDefaultHost = (): string => process.env.DAEMON_HOST ?? "localhost";

const resolveGatewayBaseUrl = (): string => {
    const direct =
        process.env.GATEWAY_URL
        ?? process.env.WORKER_GATEWAY_URL
        ?? process.env.ISOMORPHIQ_GATEWAY_URL;
    if (direct && direct.trim().length > 0) {
        return direct.trim().replace(/\/+$/, "");
    }
    const host = process.env.GATEWAY_HOST ?? "127.0.0.1";
    const envPort = Number(process.env.GATEWAY_PORT);
    const port = Number.isFinite(envPort) && envPort > 0 ? envPort : 3003;
    return `http://${host}:${String(port)}`;
};

const resolveWorkerManagerBaseUrl = (): string => {
    const direct = process.env.WORKER_MANAGER_URL;
    if (direct && direct.trim().length > 0) {
        return direct.trim().replace(/\/+$/, "");
    }
    const host = process.env.WORKER_MANAGER_HOST ?? "127.0.0.1";
    const envPort = Number(process.env.WORKER_MANAGER_HTTP_PORT ?? process.env.WORKER_MANAGER_PORT);
    const port = Number.isFinite(envPort) && envPort > 0 ? envPort : 3012;
    return `http://${host}:${String(port)}`;
};

const resolveDefaultEnvironment = (): string => {
	const configured =
		process.env.ISOMORPHIQ_ENVIRONMENT ?? process.env.ISOMORPHIQ_TEST_ENVIRONMENT;
	if (configured && configured.trim().length > 0) {
		return configured.trim().toLowerCase();
	}
	const isTest = process.env.NODE_ENV === "test" || process.env.ISOMORPHIQ_TEST_MODE === "true";
	return isTest ? "integration" : "production";
};

/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class DaemonTcpClient {
    private port: number;
    private host: string;
    private connect: typeof createConnection;
    private wsConnection: WebSocket | null = null;
    private environment: string;
    private gatewayBaseUrl: string;
    private workerManagerBaseUrl: string;

	constructor(
		port: number = resolveDefaultPort(),
		host: string = resolveDefaultHost(),
		environment: string = resolveDefaultEnvironment(),
    ) {
        this.port = port;
        this.host = host;
        this.connect = createConnection;
        this.environment = environment;
        this.gatewayBaseUrl = resolveGatewayBaseUrl();
        this.workerManagerBaseUrl = resolveWorkerManagerBaseUrl();
    }

    async sendCommand<T = unknown, R = unknown>(
        command: string,
        data: T,
        environment: string = this.environment,
    ): Promise<Result<R>> {
        try {
            return await this.sendCommandOverTcp<T, R>(command, data, environment);
        } catch (error) {
            const fallbackResult = await this.sendCommandViaHttpFallback<T, R>(command, data, environment);
            if (fallbackResult) {
                return fallbackResult;
            }
            throw error;
        }
    }

    private async sendCommandOverTcp<T = unknown, R = unknown>(
        command: string,
        data: T,
        environment: string,
    ): Promise<Result<R>> {
        return new Promise((resolve, reject) => {
            const client = this.connect({ port: this.port, host: this.host }, () => {
                const message = `${JSON.stringify({ command, data, environment })}\n`;
                client.write(message);
            });

            let response = "";
            const timeout = setTimeout(() => {
                client.destroy();
                reject(new Error("Request timeout"));
            }, 10000);
            client.on("data", (data) => {
                response += data.toString();
                try {
                    const result = JSON.parse(response.trim());
                    clearTimeout(timeout);
                    client.end();
                    resolve(result);
                } catch (_e) {
                    // Wait for more data
                }
            });

            client.on("error", (err) => {
                clearTimeout(timeout);
                reject(new Error(`Connection error: ${err.message}`));
            });

            client.on("close", () => {
                clearTimeout(timeout);
                if (!response) {
                    reject(new Error("Connection closed without response"));
                }
            });
        });
    }

    private buildEnvironmentHeaders(environment: string): Record<string, string> {
        return {
            "Content-Type": "application/json",
            "Environment": environment,
        };
    }

    private asRecord(value: unknown): Record<string, unknown> {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
            return {};
        }
        return Object.fromEntries(Object.entries(value));
    }

    private async sendGatewayRequest(
        input: string,
        init: RequestInit,
    ): Promise<{ ok: boolean; status: number; body: unknown }> {
        const response = await fetch(input, init);
        const text = await response.text();
        if (!text || text.trim().length === 0) {
            return { ok: response.ok, status: response.status, body: {} };
        }
        try {
            return { ok: response.ok, status: response.status, body: JSON.parse(text) as unknown };
        } catch {
            return { ok: response.ok, status: response.status, body: text };
        }
    }

    private toErrorResult<R>(message: string): Result<R> {
        return {
            success: false,
            error: new Error(message),
        };
    }

    private async sendCommandViaHttpFallback<T = unknown, R = unknown>(
        command: string,
        data: T,
        environment: string,
    ): Promise<Result<R> | null> {
        const payload = this.asRecord(data);
        const headers = this.buildEnvironmentHeaders(environment);

        try {
            if (command === "list_tasks") {
                const response = await this.sendGatewayRequest(
                    `${this.gatewayBaseUrl}/api/tasks`,
                    {
                        method: "GET",
                        headers,
                    },
                );
                if (!response.ok || !Array.isArray(response.body)) {
                    return this.toErrorResult<R>(`Gateway tasks list failed (${String(response.status)})`);
                }
                return { success: true, data: response.body as R };
            }

            if (command === "create_task") {
                const response = await this.sendGatewayRequest(
                    `${this.gatewayBaseUrl}/api/tasks`,
                    {
                        method: "POST",
                        headers,
                        body: JSON.stringify(data),
                    },
                );
                const bodyRecord = this.asRecord(response.body);
                if (!response.ok || bodyRecord.success !== true) {
                    const reason = typeof bodyRecord.error === "string"
                        ? bodyRecord.error
                        : `Gateway task create failed (${String(response.status)})`;
                    return this.toErrorResult<R>(reason);
                }
                return { success: true, data: bodyRecord.data as R };
            }

            if (command === "update_task_status") {
                const taskId = typeof payload.id === "string" ? payload.id : "";
                const status = payload.status;
                if (taskId.length === 0 || typeof status !== "string") {
                    return this.toErrorResult<R>("update_task_status requires id and status");
                }
                const response = await this.sendGatewayRequest(
                    `${this.gatewayBaseUrl}/api/tasks/${encodeURIComponent(taskId)}/status`,
                    {
                        method: "PUT",
                        headers,
                        body: JSON.stringify({ status }),
                    },
                );
                const bodyRecord = this.asRecord(response.body);
                if (!response.ok || bodyRecord.success !== true) {
                    const reason = typeof bodyRecord.error === "string"
                        ? bodyRecord.error
                        : `Gateway task status update failed (${String(response.status)})`;
                    return this.toErrorResult<R>(reason);
                }
                return { success: true, data: bodyRecord.data as R };
            }

            if (command === "update_task_priority") {
                const taskId = typeof payload.id === "string" ? payload.id : "";
                const priority = payload.priority;
                if (taskId.length === 0 || typeof priority !== "string") {
                    return this.toErrorResult<R>("update_task_priority requires id and priority");
                }
                const response = await this.sendGatewayRequest(
                    `${this.gatewayBaseUrl}/api/tasks/${encodeURIComponent(taskId)}/priority`,
                    {
                        method: "PUT",
                        headers,
                        body: JSON.stringify({ priority }),
                    },
                );
                const bodyRecord = this.asRecord(response.body);
                if (!response.ok || bodyRecord.success !== true) {
                    const reason = typeof bodyRecord.error === "string"
                        ? bodyRecord.error
                        : `Gateway task priority update failed (${String(response.status)})`;
                    return this.toErrorResult<R>(reason);
                }
                return { success: true, data: bodyRecord.data as R };
            }

            if (command === "delete_task") {
                const taskId = typeof payload.id === "string" ? payload.id : "";
                if (taskId.length === 0) {
                    return this.toErrorResult<R>("delete_task requires id");
                }
                const response = await this.sendGatewayRequest(
                    `${this.gatewayBaseUrl}/api/tasks/${encodeURIComponent(taskId)}`,
                    {
                        method: "DELETE",
                        headers,
                    },
                );
                const bodyRecord = this.asRecord(response.body);
                if (!response.ok || bodyRecord.success !== true) {
                    const reason = typeof bodyRecord.error === "string"
                        ? bodyRecord.error
                        : `Gateway task delete failed (${String(response.status)})`;
                    return this.toErrorResult<R>(reason);
                }
                return { success: true, data: true as R };
            }

            if (command === "get_daemon_status") {
                const response = await this.sendGatewayRequest(
                    `${this.workerManagerBaseUrl}/workers`,
                    {
                        method: "GET",
                        headers,
                    },
                );
                const bodyRecord = this.asRecord(response.body);
                const workers = Array.isArray(bodyRecord.workers) ? bodyRecord.workers : [];
                const running = workers.filter((worker) =>
                    worker
                    && typeof worker === "object"
                    && this.asRecord(worker).status === "running"
                );
                if (!response.ok) {
                    return this.toErrorResult<R>(`Worker-manager status failed (${String(response.status)})`);
                }
                return {
                    success: true,
                    data: {
                        paused: running.length === 0,
                        workers: workers.length,
                        runningWorkers: running.length,
                    } as R,
                };
            }

            if (command === "pause_daemon" || command === "resume_daemon") {
                const desiredCount = command === "pause_daemon"
                    ? 0
                    : (() => {
                        const raw = Number(process.env.ISOMORPHIQ_WORKER_COUNT ?? process.env.WORKER_COUNT);
                        return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 1;
                    })();
                const response = await this.sendGatewayRequest(
                    `${this.workerManagerBaseUrl}/workers/reconcile`,
                    {
                        method: "POST",
                        headers,
                        body: JSON.stringify({ desiredCount }),
                    },
                );
                const bodyRecord = this.asRecord(response.body);
                if (!response.ok || bodyRecord.ok !== true) {
                    return this.toErrorResult<R>(
                        `Worker-manager reconcile failed (${String(response.status)})`,
                    );
                }
                return {
                    success: true,
                    data: {
                        desiredCount,
                        workers: bodyRecord.workers,
                    } as R,
                };
            }

            if (command === "restart") {
                const desiredCountRaw = Number(process.env.ISOMORPHIQ_WORKER_COUNT ?? process.env.WORKER_COUNT);
                const desiredCount = Number.isFinite(desiredCountRaw) && desiredCountRaw > 0
                    ? Math.floor(desiredCountRaw)
                    : 1;
                const pauseResponse = await this.sendGatewayRequest(
                    `${this.workerManagerBaseUrl}/workers/reconcile`,
                    {
                        method: "POST",
                        headers,
                        body: JSON.stringify({ desiredCount: 0 }),
                    },
                );
                const pauseBody = this.asRecord(pauseResponse.body);
                if (!pauseResponse.ok || pauseBody.ok !== true) {
                    return this.toErrorResult<R>(
                        `Worker-manager restart (stop) failed (${String(pauseResponse.status)})`,
                    );
                }
                const resumeResponse = await this.sendGatewayRequest(
                    `${this.workerManagerBaseUrl}/workers/reconcile`,
                    {
                        method: "POST",
                        headers,
                        body: JSON.stringify({ desiredCount }),
                    },
                );
                const resumeBody = this.asRecord(resumeResponse.body);
                if (!resumeResponse.ok || resumeBody.ok !== true) {
                    return this.toErrorResult<R>(
                        `Worker-manager restart (start) failed (${String(resumeResponse.status)})`,
                    );
                }
                return {
                    success: true,
                    data: {
                        message: "Worker pool restarted",
                        desiredCount,
                    } as R,
                };
            }
        } catch (error) {
            return this.toErrorResult<R>(
                error instanceof Error ? error.message : "HTTP fallback failed",
            );
        }

        return null;
    }

    async createTask(taskData: {
        title: string;
        description: string;
        prd?: string;
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
         const tcpConnected = await new Promise<boolean>((resolve) => {
             const client = this.connect({ port: this.port, host: this.host });
             
             client.on("connect", () => {
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
        if (tcpConnected) {
            return true;
        }
        try {
            const response = await fetch(`${this.gatewayBaseUrl}/api/health`, {
                method: "GET",
                headers: this.buildEnvironmentHeaders(this.environment),
            });
            return response.ok;
        } catch {
            return false;
        }
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
		this.wsConnection = null;
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
