#!/usr/bin/env node

import WebSocket from "ws";
import type {
	Task,
	TaskCreatedEvent,
	TaskDeletedEvent,
	TaskPriorityChangedEvent,
	TaskStatusChangedEvent,
	TasksListEvent,
	TaskUpdatedEvent,
	WebSocketMessage,
} from "./types.ts";

// WebSocket client for testing real-time task updates
class TaskWebSocketClient {
	private ws: WebSocket | null = null;
	private url: string = "ws://localhost:3002/ws";
	private reconnectAttempts: number = 0;
	private maxReconnectAttempts: number = 5;
	private reconnectDelay: number = 2000;

	connect(): void {
		console.log("[WS-CLIENT] Connecting to WebSocket server...");

		this.ws = new WebSocket(this.url);

		this.ws.on("open", () => {
			console.log("[WS-CLIENT] Connected to WebSocket server");
			this.reconnectAttempts = 0;

			// Subscribe to all task events
			this.subscribe([
				"task_created",
				"task_updated",
				"task_deleted",
				"task_status_changed",
				"task_priority_changed",
				"tasks_list",
			]);
		});

		this.ws.on("message", (data: WebSocket.Data) => {
			try {
				const message = JSON.parse(data.toString());
				this.handleMessage(message);
			} catch (error) {
				console.error("[WS-CLIENT] Failed to parse message:", error);
			}
		});

		this.ws.on("close", (code: number, reason: string) => {
			console.log(`[WS-CLIENT] Disconnected (Code: ${code}, Reason: ${reason})`);
			this.handleReconnect();
		});

		this.ws.on("error", (error: Error) => {
			console.error("[WS-CLIENT] WebSocket error:", error);
		});
	}

	private handleMessage(message: WebSocketMessage): void {
		const { event, id } = message;
		console.log(`[WS-CLIENT] Event received [${id}]: ${event.type}`);

		switch (event.type) {
			case "task_created":
				{
					const taskEvent = event as TaskCreatedEvent;
					console.log(`[WS-CLIENT] 🆕 Task created: ${taskEvent.data.title}`);
					console.log(`  ID: ${taskEvent.data.id}`);
					console.log(`  Priority: ${taskEvent.data.priority}`);
					console.log(`  Status: ${taskEvent.data.status}`);
					console.log(`  Description: ${taskEvent.data.description}`);
				}
				break;

			case "task_updated":
				{
					const taskEvent = event as TaskUpdatedEvent;
					console.log(`[WS-CLIENT] 📝 Task updated: ${taskEvent.data.task.title}`);
					console.log("  Changes:", taskEvent.data.changes);
				}
				break;

			case "task_deleted":
				{
					const taskEvent = event as TaskDeletedEvent;
					console.log(`[WS-CLIENT] 🗑️  Task deleted: ${taskEvent.data.taskId}`);
				}
				break;

			case "task_status_changed":
				{
					const taskEvent = event as TaskStatusChangedEvent;
					console.log(`[WS-CLIENT] 🔄 Task status changed: ${taskEvent.data.taskId}`);
					console.log(`  From: ${taskEvent.data.oldStatus} → To: ${taskEvent.data.newStatus}`);
					console.log(`  Task: ${taskEvent.data.task.title}`);
				}
				break;

			case "task_priority_changed":
				{
					const taskEvent = event as TaskPriorityChangedEvent;
					console.log(`[WS-CLIENT] ⚡ Task priority changed: ${taskEvent.data.taskId}`);
					console.log(`  From: ${taskEvent.data.oldPriority} → To: ${taskEvent.data.newPriority}`);
					console.log(`  Task: ${taskEvent.data.task.title}`);
				}
				break;

			case "tasks_list":
				{
					const taskEvent = event as TasksListEvent;
					console.log(`[WS-CLIENT] 📋 Tasks list received (${taskEvent.data.tasks.length} tasks)`);
					taskEvent.data.tasks.forEach((task: Task, index: number) => {
						console.log(`  ${index + 1}. [${task.status}] ${task.title} (${task.priority})`);
					});
				}
				break;

			default:
				console.log(`[WS-CLIENT] Unknown event type: ${event.type}`);
		}

		console.log("---");
	}

	private handleReconnect(): void {
		if (this.reconnectAttempts < this.maxReconnectAttempts) {
			this.reconnectAttempts++;
			console.log(
				`[WS-CLIENT] Reconnecting... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`,
			);

			setTimeout(() => {
				this.connect();
			}, this.reconnectDelay * this.reconnectAttempts);
		} else {
			console.log("[WS-CLIENT] Max reconnection attempts reached. Giving up.");
		}
	}

	subscribe(eventTypes: string[]): void {
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
			console.error("[WS-CLIENT] Cannot subscribe: WebSocket is not connected");
			return;
		}

		const message = {
			type: "subscribe",
			eventTypes,
		};

		this.ws.send(JSON.stringify(message));
		console.log(`[WS-CLIENT] Subscribed to events: ${eventTypes.join(", ")}`);
	}

	unsubscribe(eventTypes: string[]): void {
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
			console.error("[WS-CLIENT] Cannot unsubscribe: WebSocket is not connected");
			return;
		}

		const message = {
			type: "unsubscribe",
			eventTypes,
		};

		this.ws.send(JSON.stringify(message));
		console.log(`[WS-CLIENT] Unsubscribed from events: ${eventTypes.join(", ")}`);
	}

	disconnect(): void {
		if (this.ws) {
			this.ws.close();
			this.ws = null;
		}
	}
}

// CLI interface
function main() {
	const args = process.argv.slice(2);
	const command = args[0];

	const client = new TaskWebSocketClient();

	switch (command) {
		case "connect":
		case "watch":
			client.connect();

			// Keep the process running
			process.on("SIGINT", () => {
				console.log("\n[WS-CLIENT] Disconnecting...");
				client.disconnect();
				process.exit(0);
			});
			break;
		default:
			console.log("WebSocket Task Client");
			console.log("");
			console.log("Usage:");
			console.log("  node test-websocket-client.js connect  - Connect and watch for task updates");
			console.log("  node test-websocket-client.js watch     - Same as connect");
			console.log("  node test-websocket-client.js help     - Show this help");
			console.log("");
			console.log("Examples:");
			console.log("  node test-websocket-client.js connect");
			console.log("");
			console.log("Note: Make sure the daemon is running (npm run daemon)");
			break;
	}
}

// Run the client
if (import.meta.url === `file://${process.argv[1]}`) {
	main();
}

export { TaskWebSocketClient };
