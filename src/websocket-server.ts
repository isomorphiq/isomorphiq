import type { Server as HttpServer, IncomingMessage } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { WebSocket, WebSocketServer } from "ws";
import type {
	Task,
	WebSocketClient,
	WebSocketEvent,
	WebSocketEventType,
	WebSocketMessage,
} from "./types.ts";

export class WebSocketManager {
	private wss: WebSocketServer | null = null;
	private clients: Map<string, WebSocketClient> = new Map();
	private port: number = 3002;
	private path: string = "/ws";
	private isRunning: boolean = false;
	private listeners: Set<(event: WebSocketEvent) => void> = new Set();

	constructor(options: { port?: number; path?: string } = {}) {
		this.port = options.port ?? 3002;
		this.path = options.path ?? "/ws";
	}

	// Start the WebSocket server
	async start(
		server?: HttpServer,
		options: { attachUpgradeListener?: boolean } = {},
	): Promise<void> {
		if (this.isRunning) {
			console.log("[WS] WebSocket server is already running");
			return;
		}

		const attachUpgradeListener = options.attachUpgradeListener ?? true;

		try {
			if (server) {
				this.httpServer = server;
				// When sharing an HTTP server we optionally attach the upgrade listener ourselves
				// to avoid clashing with other WebSocket handlers (e.g., tRPC).
				if (attachUpgradeListener) {
					this.wss = new WebSocketServer({ server, path: this.path });
				} else {
					// noServer + manual handleUpgrade means we must enforce path checks ourselves
					this.wss = new WebSocketServer({ noServer: true });
				}
			} else {
				this.wss = new WebSocketServer({
					port: this.port,
					path: this.path,
				});
			}

			this.wss.on("connection", (ws: WebSocket, req) => {
				this.handleConnection(ws, req);
			});

			this.wss.on("error", (error) => {
				console.error("[WS] WebSocket server error:", error);
			});

			this.isRunning = true;
			// Capture actual port if bound via shared server
			const address = server?.address();
			if (address && typeof address === "object") {
				this.port = (address as AddressInfo).port;
			}
			console.log(
				`[WS] WebSocket server started on ${server ? "shared HTTP server" : `port ${this.port}`} path ${this.path}`,
			);

			// Start ping interval for connection health
			this.startPingInterval();
		} catch (error) {
			console.error("[WS] Failed to start WebSocket server:", error);
			throw error;
		}
	}

	// Allow external HTTP server to delegate upgrade handling when running in noServer mode
	handleUpgrade(req: IncomingMessage, socket: Socket, head: Buffer): boolean {
		if (!this.wss) return false;

		const url = new URL(req.url ?? "", `http://${req.headers.host}`);
		if (url.pathname !== this.path) {
			return false;
		}

		this.wss.handleUpgrade(req, socket, head, (ws) => {
			this.wss?.emit("connection", ws, req);
		});
		return true;
	}

	// Stop the WebSocket server
	async stop(): Promise<void> {
		if (!this.isRunning || !this.wss) {
			return;
		}

		// Close all client connections
		this.clients.forEach((client) => {
			try {
				client.socket.close();
			} catch (error) {
				console.error("[WS] Error closing client connection:", error);
			}
		});
		this.clients.clear();

		// Close the server
		this.wss.close();
		this.isRunning = false;
		console.log("[WS] WebSocket server stopped");
	}

	// Handle new WebSocket connection
	private handleConnection(ws: WebSocket, _req: IncomingMessage): void {
		const clientId = `client-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
		const client: WebSocketClient = {
			id: clientId,
			socket: ws,
			lastPing: new Date(),
			subscriptions: new Set<WebSocketEventType>([
				"task_created",
				"task_updated",
				"task_deleted",
				"task_status_changed",
				"task_priority_changed",
			]),
		};

		this.clients.set(clientId, client);
		console.log(`[WS] Client connected: ${clientId} (Total: ${this.clients.size})`);

		// Send welcome message
		this.sendToClient(clientId, {
			type: "tasks_list",
			timestamp: new Date(),
			data: { tasks: [] }, // Will be populated by actual task data
		});

		// Handle client messages
		ws.on("message", (data: Buffer) => {
			this.handleClientMessage(clientId, data);
		});

		// Handle client disconnection
		ws.on("close", (code: number, reason: Buffer) => {
			this.handleDisconnection(clientId, code, reason);
		});

		// Handle client errors
		ws.on("error", (error: Error) => {
			console.error(`[WS] Client error (${clientId}):`, error);
		});

		// Handle pong responses
		ws.on("pong", () => {
			const client = this.clients.get(clientId);
			if (client) {
				client.lastPing = new Date();
			}
		});
	}

	// Handle messages from clients
	private handleClientMessage(clientId: string, data: Buffer): void {
		try {
			const message = JSON.parse(data.toString());
			console.log(`[WS] Message from ${clientId}:`, message);

			// Handle subscription management
			if (message.type === "subscribe") {
				const client = this.clients.get(clientId);
				if (client && message.eventTypes) {
					message.eventTypes.forEach((eventType: WebSocketEventType) => {
						client.subscriptions.add(eventType);
					});
					console.log(`[WS] Client ${clientId} subscribed to:`, Array.from(client.subscriptions));
				}
			} else if (message.type === "unsubscribe") {
				const client = this.clients.get(clientId);
				if (client && message.eventTypes) {
					message.eventTypes.forEach((eventType: WebSocketEventType) => {
						client.subscriptions.delete(eventType);
					});
					console.log(`[WS] Client ${clientId} unsubscribed from:`, message.eventTypes);
				}
			}
		} catch (error) {
			console.error(`[WS] Invalid message from ${clientId}:`, error);
		}
	}

	// Handle client disconnection
	private handleDisconnection(clientId: string, code: number, _reason: Buffer): void {
		this.clients.delete(clientId);
		console.log(
			`[WS] Client disconnected: ${clientId} (Code: ${code}, Total: ${this.clients.size})`,
		);
	}

	// Send message to specific client
	private sendToClient(clientId: string, event: WebSocketEvent): void {
		const client = this.clients.get(clientId);
		if (!client || client.socket.readyState !== WebSocket.OPEN) {
			return;
		}

		// Check if client is subscribed to this event type
		if (!client.subscriptions.has(event.type)) {
			return;
		}

		try {
			const message: WebSocketMessage = {
				event,
				id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
			};
			client.socket.send(JSON.stringify(message));
		} catch (error) {
			console.error(`[WS] Error sending message to client ${clientId}:`, error);
			// Remove problematic client
			this.clients.delete(clientId);
		}
	}

	// Broadcast event to all subscribed clients
	broadcast(event: WebSocketEvent): void {
		console.log(`[WS] Broadcasting event: ${event.type} to ${this.clients.size} clients`);

		// Notify listeners (e.g., tRPC subscriptions) before WebSocket clients
		this.listeners.forEach((listener) => {
			try {
				listener(event);
			} catch (err) {
				console.error("[WS] Listener error:", err);
			}
		});

		this.clients.forEach((client) => {
			if (client.subscriptions.has(event.type)) {
				this.sendToClient(client.id, event);
			}
		});
	}

	// Send task list to all clients
	broadcastTasksList(tasks: Task[]): void {
		const event: WebSocketEvent = {
			type: "tasks_list",
			timestamp: new Date(),
			data: { tasks },
		};
		this.broadcast(event);
	}

	// Send task creation event
	broadcastTaskCreated(task: Task): void {
		const event: WebSocketEvent = {
			type: "task_created",
			timestamp: new Date(),
			data: task,
		};
		this.broadcast(event);
	}

	// Send task update event
	broadcastTaskUpdated(task: Task, changes: Partial<Task>, updatedBy?: string): void {
		const event: WebSocketEvent = {
			type: "task_updated",
			timestamp: new Date(),
			data: { task, changes, updatedBy },
		};
		this.broadcast(event);
	}

	// Send task assignment event
	broadcastTaskAssigned(task: Task, assignedTo: string, assignedBy: string): void {
		const event: WebSocketEvent = {
			type: "task_assigned",
			timestamp: new Date(),
			data: { task, assignedTo, assignedBy },
		};
		this.broadcast(event);
	}

	// Send task collaborators update event
	broadcastTaskCollaboratorsUpdated(task: Task, collaborators: string[], updatedBy: string): void {
		const event: WebSocketEvent = {
			type: "task_collaborators_updated",
			timestamp: new Date(),
			data: { task, collaborators, updatedBy },
		};
		this.broadcast(event);
	}

	// Send task watchers update event
	broadcastTaskWatchersUpdated(task: Task, watchers: string[], updatedBy: string): void {
		const event: WebSocketEvent = {
			type: "task_watchers_updated",
			timestamp: new Date(),
			data: { task, watchers, updatedBy },
		};
		this.broadcast(event);
	}

	// Send task status change event
	broadcastTaskStatusChanged(
		taskId: string,
		oldStatus: string,
		newStatus: string,
		task: Task,
	): void {
		const event: WebSocketEvent = {
			type: "task_status_changed",
			timestamp: new Date(),
			data: { taskId, oldStatus, newStatus, task },
		};
		this.broadcast(event);
	}

	// Send task priority change event
	broadcastTaskPriorityChanged(
		taskId: string,
		oldPriority: string,
		newPriority: string,
		task: Task,
	): void {
		const event: WebSocketEvent = {
			type: "task_priority_changed",
			timestamp: new Date(),
			data: { taskId, oldPriority, newPriority, task },
		};
		this.broadcast(event);
	}

	// Send task deletion event
	broadcastTaskDeleted(taskId: string): void {
		const event: WebSocketEvent = {
			type: "task_deleted",
			timestamp: new Date(),
			data: { taskId },
		};
		this.broadcast(event);
	}

	// Start ping interval to check connection health
	private startPingInterval(): void {
		setInterval(() => {
			const now = new Date();
			const deadClients: string[] = [];

			this.clients.forEach((client, clientId) => {
				// Remove clients that haven't responded in 30 seconds
				const timeSinceLastPing = now.getTime() - client.lastPing.getTime();
				if (timeSinceLastPing > 30000) {
					deadClients.push(clientId);
				} else if (client.socket.readyState === WebSocket.OPEN) {
					// Send ping to active clients
					try {
						client.socket.ping();
					} catch (_error) {
						deadClients.push(clientId);
					}
				} else {
					deadClients.push(clientId);
				}
			});

			// Remove dead clients
			deadClients.forEach((clientId) => {
				console.log(`[WS] Removing dead client: ${clientId}`);
				this.clients.delete(clientId);
			});
		}, 10000); // Check every 10 seconds
	}

	// Get server status
	getStatus(): {
		isRunning: boolean;
		clientCount: number;
		port: number;
		path: string;
	} {
		return {
			isRunning: this.isRunning,
			clientCount: this.clients.size,
			port: this.port,
			path: this.path,
		};
	}

	addListener(callback: (event: WebSocketEvent) => void): () => void {
		this.listeners.add(callback);
		return () => this.listeners.delete(callback);
	}

	// Get connected clients info
	getClientsInfo(): Array<{
		id: string;
		subscriptions: string[];
		lastPing: Date;
	}> {
		return Array.from(this.clients.values()).map((client) => ({
			id: client.id,
			subscriptions: Array.from(client.subscriptions),
			lastPing: client.lastPing,
		}));
	}
}
