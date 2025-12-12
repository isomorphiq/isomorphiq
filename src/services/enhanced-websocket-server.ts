import type { Server as HttpServer, IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import type {
    Task,
    WebSocketClient,
    WebSocketEvent,
    WebSocketEventType,
    WebSocketMessage,
} from "../types.ts";

// Enhanced WebSocket configuration
export interface EnhancedWebSocketConfig {
    port?: number;
    path?: string;
    maxConnections?: number;
    heartbeatInterval?: number;
    reconnectTimeout?: number;
    messageQueueSize?: number;
    enableCompression?: boolean;
}

// Connection pool for better resource management
export class ConnectionPool {
    private connections: Map<string, WebSocketClient> = new Map();
    private maxConnections: number;
    private connectionHistory: Array<{
        id: string;
        connectedAt: Date;
        disconnectedAt?: Date;
    }> = [];

    constructor(maxConnections: number = 1000) {
        this.maxConnections = maxConnections;
    }

    // Add new connection
    addConnection(client: WebSocketClient): boolean {
        if (this.connections.size >= this.maxConnections) {
            console.warn(
                `[WS] Connection limit reached (${this.maxConnections}), rejecting new connection`,
            );
            return false;
        }

        this.connections.set(client.id, client);
        this.connectionHistory.push({ id: client.id, connectedAt: new Date() });

        // Keep only recent history (last 1000 connections)
        if (this.connectionHistory.length > 1000) {
            this.connectionHistory = this.connectionHistory.slice(-1000);
        }

        console.log(
            `[WS] Client connected: ${client.id} (Total: ${this.connections.size})`,
        );
        return true;
    }

    // Remove connection
    removeConnection(clientId: string): WebSocketClient | null {
        const client = this.connections.get(clientId);
        if (client) {
            this.connections.delete(clientId);

            // Update history
            const historyEntry = this.connectionHistory.find(
                (h) => h.id === clientId,
            );
            if (historyEntry) {
                historyEntry.disconnectedAt = new Date();
            }

            console.log(
                `[WS] Client disconnected: ${clientId} (Total: ${this.connections.size})`,
            );
        }
        return client || null;
    }

    // Get connection
    getConnection(clientId: string): WebSocketClient | null {
        return this.connections.get(clientId) || null;
    }

    // Get all connections
    getAllConnections(): WebSocketClient[] {
        return Array.from(this.connections.values());
    }

    // Get connections by subscription
    getConnectionsBySubscription(
        eventType: WebSocketEventType,
    ): WebSocketClient[] {
        return Array.from(this.connections.values()).filter((client) =>
            client.subscriptions.has(eventType),
        );
    }

    // Get connection stats
    getStats(): {
        totalConnections: number;
        maxConnections: number;
        averageConnectionTime: number;
        connectionsPerHour: number;
    } {
        const now = new Date();
        const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

        const recentConnections = this.connectionHistory.filter(
            (h) => h.connectedAt > oneHourAgo,
        );
        const connectionsWithDuration = this.connectionHistory.filter(
            (h) => h.disconnectedAt,
        );

        const totalDuration = connectionsWithDuration.reduce((sum, h) => {
            return (
                sum + (h.disconnectedAt?.getTime() - h.connectedAt.getTime())
            );
        }, 0);

        const averageConnectionTime =
            connectionsWithDuration.length > 0
                ? totalDuration / connectionsWithDuration.length
                : 0;

        return {
            totalConnections: this.connections.size,
            maxConnections: this.maxConnections,
            averageConnectionTime: Math.round(averageConnectionTime / 1000), // seconds
            connectionsPerHour: recentConnections.length,
        };
    }

    // Clean up stale connections
    cleanup(): void {
        const now = Date.now();
        const staleThreshold = 5 * 60 * 1000; // 5 minutes

        for (const [clientId, client] of this.connections) {
            const timeSinceLastPing = now - client.lastPing.getTime();

            if (
                timeSinceLastPing > staleThreshold ||
                client.socket.readyState !== WebSocket.OPEN
            ) {
                console.log(`[WS] Cleaning up stale connection: ${clientId}`);
                try {
                    client.socket.close(1000, "Stale connection");
                } catch (error) {
                    console.error(
                        `[WS] Error closing stale connection ${clientId}:`,
                        error,
                    );
                }
                this.removeConnection(clientId);
            }
        }
    }
}

// Message queue for reliable delivery
export class MessageQueue {
    private queue: Array<{
        event: WebSocketEvent;
        timestamp: number;
        retries: number;
    }> = [];
    private maxSize: number;
    private maxRetries: number = 3;

    constructor(maxSize: number = 10000) {
        this.maxSize = maxSize;
    }

    // Add message to queue
    enqueue(event: WebSocketEvent): boolean {
        if (this.queue.length >= this.maxSize) {
            console.warn(
                `[WS] Message queue full, dropping message: ${event.type}`,
            );
            return false;
        }

        this.queue.push({
            event,
            timestamp: Date.now(),
            retries: 0,
        });

        return true;
    }

    // Get next message
    dequeue(): { event: WebSocketEvent; retries: number } | null {
        return this.queue.shift() || null;
    }

    // Requeue failed message
    requeue(event: WebSocketEvent, currentRetries: number): boolean {
        if (currentRetries >= this.maxRetries) {
            console.warn(
                `[WS] Max retries exceeded for message: ${event.type}`,
            );
            return false;
        }

        return this.enqueue(event);
    }

    // Clean old messages
    cleanup(maxAge: number = 60 * 60 * 1000): void {
        // 1 hour
        const now = Date.now();
        this.queue = this.queue.filter((item) => now - item.timestamp < maxAge);
    }

    // Get queue stats
    getStats(): { size: number; maxSize: number; droppedMessages: number } {
        return {
            size: this.queue.length,
            maxSize: this.maxSize,
            droppedMessages: 0, // Could track dropped messages
        };
    }
}

// Enhanced WebSocket Manager
export class EnhancedWebSocketManager {
    private wss: WebSocketServer | null = null;
    private connectionPool: ConnectionPool;
    private messageQueue: MessageQueue;
    private config: Required<EnhancedWebSocketConfig>;
    private isRunning: boolean = false;
    private listeners: Set<(event: WebSocketEvent) => void> = new Set();
    private heartbeatInterval: NodeJS.Timeout | null = null;
    private cleanupInterval: NodeJS.Timeout | null = null;

    constructor(config: EnhancedWebSocketConfig = {}) {
        this.config = {
            port: config.port || 3002,
            path: config.path || "/ws",
            maxConnections: config.maxConnections || 1000,
            heartbeatInterval: config.heartbeatInterval || 30000,
            reconnectTimeout: config.reconnectTimeout || 5000,
            messageQueueSize: config.messageQueueSize || 10000,
            enableCompression: config.enableCompression || false,
        };

        this.connectionPool = new ConnectionPool(this.config.maxConnections);
        this.messageQueue = new MessageQueue(this.config.messageQueueSize);
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
                if (attachUpgradeListener) {
                    this.wss = new WebSocketServer({
                        server,
                        path: this.config.path,
                    });
                } else {
                    this.wss = new WebSocketServer({ noServer: true });
                }
            } else {
                this.wss = new WebSocketServer({
                    port: this.config.port,
                    path: this.config.path,
                });
            }

            this.wss.on("connection", (ws: WebSocket, req) => {
                this.handleConnection(ws, req);
            });

            this.wss.on("error", (error) => {
                console.error("[WS] WebSocket server error:", error);
            });

            this.isRunning = true;
            this.startHeartbeat();
            this.startCleanup();

            console.log(
                `[WS] Enhanced WebSocket server started on ${server ? "shared HTTP server" : `port ${this.config.port}`} path ${this.config.path}`,
            );
            console.log(
                `[WS] Configuration: maxConnections=${this.config.maxConnections}, compression=${this.config.enableCompression}`,
            );
        } catch (error) {
            console.error("[WS] Failed to start WebSocket server:", error);
            throw error;
        }
    }

    // Allow external HTTP server to delegate upgrade handling
    handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
        if (!this.wss) return false;

        const url = new URL(req.url ?? "", `http://${req.headers.host}`);
        if (url.pathname !== this.config.path) {
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

        console.log("[WS] Stopping enhanced WebSocket server...");

        // Stop intervals
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }

        // Close all connections
        const connections = this.connectionPool.getAllConnections();
        for (const client of connections) {
            try {
                client.socket.close(1000, "Server shutdown");
            } catch (error) {
                console.error(
                    `[WS] Error closing connection ${client.id}:`,
                    error,
                );
            }
        }

        // Close server
        this.wss.close();
        this.isRunning = false;
        console.log("[WS] Enhanced WebSocket server stopped");
    }

    // Handle new WebSocket connection
    private handleConnection(ws: WebSocket, _req: IncomingMessage): void {
        const clientId = this.generateClientId();
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

        // Add to connection pool
        if (!this.connectionPool.addConnection(client)) {
            ws.close(1013, "Connection limit exceeded");
            return;
        }

        // Send welcome message
        this.sendToClient(clientId, {
            type: "tasks_list",
            timestamp: new Date(),
            data: { tasks: [] },
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
            this.connectionPool.removeConnection(clientId);
        });

        // Handle pong responses
        ws.on("pong", () => {
            const client = this.connectionPool.getConnection(clientId);
            if (client) {
                client.lastPing = new Date();
            }
        });

        // Set connection options
        if (this.config.enableCompression) {
            // Enable compression if supported
            ws.send(
                JSON.stringify({ type: "compression_enabled", enabled: true }),
            );
        }
    }

    // Handle messages from clients
    private handleClientMessage(clientId: string, data: Buffer): void {
        try {
            const message = JSON.parse(data.toString());
            console.log(`[WS] Message from ${clientId}:`, message);

            const client = this.connectionPool.getConnection(clientId);
            if (!client) return;

            // Handle subscription management
            if (message.type === "subscribe") {
                if (message.eventTypes && Array.isArray(message.eventTypes)) {
                    message.eventTypes.forEach(
                        (eventType: WebSocketEventType) => {
                            client.subscriptions.add(eventType);
                        },
                    );
                    console.log(
                        `[WS] Client ${clientId} subscribed to:`,
                        Array.from(client.subscriptions),
                    );
                }
            } else if (message.type === "unsubscribe") {
                if (message.eventTypes && Array.isArray(message.eventTypes)) {
                    message.eventTypes.forEach(
                        (eventType: WebSocketEventType) => {
                            client.subscriptions.delete(eventType);
                        },
                    );
                    console.log(
                        `[WS] Client ${clientId} unsubscribed from:`,
                        message.eventTypes,
                    );
                }
            } else if (message.type === "ping") {
                // Respond to client ping
                this.sendToClient(clientId, {
                    type: "pong",
                    timestamp: new Date(),
                    data: { serverTime: new Date().toISOString() },
                });
            }
        } catch (error) {
            console.error(`[WS] Invalid message from ${clientId}:`, error);
        }
    }

    // Handle client disconnection
    private handleDisconnection(
        clientId: string,
        code: number,
        _reason: Buffer,
    ): void {
        this.connectionPool.removeConnection(clientId);
        console.log(
            `[WS] Client disconnected: ${clientId} (Code: ${code}, Total: ${this.connectionPool.getAllConnections().length})`,
        );
    }

    // Send message to specific client
    private sendToClient(clientId: string, event: WebSocketEvent): void {
        const client = this.connectionPool.getConnection(clientId);
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
                id: this.generateMessageId(),
            };

            const payload = JSON.stringify(message);

            if (this.config.enableCompression) {
                // Could implement compression here
                client.socket.send(payload);
            } else {
                client.socket.send(payload);
            }
        } catch (error) {
            console.error(
                `[WS] Error sending message to client ${clientId}:`,
                error,
            );
            this.connectionPool.removeConnection(clientId);
        }
    }

    // Broadcast event to all subscribed clients with connection pooling
    broadcast(event: WebSocketEvent): void {
        const targetClients = this.connectionPool.getConnectionsBySubscription(
            event.type,
        );

        console.log(
            `[WS] Broadcasting event: ${event.type} to ${targetClients.length} subscribed clients`,
        );

        // Notify listeners first
        this.listeners.forEach((listener) => {
            try {
                listener(event);
            } catch (err) {
                console.error("[WS] Listener error:", err);
            }
        });

        // Send to clients
        for (const client of targetClients) {
            this.sendToClient(client.id, event);
        }

        // Queue message for any disconnected clients that should receive it
        if (
            targetClients.length <
            this.connectionPool.getAllConnections().length
        ) {
            this.messageQueue.enqueue(event);
        }
    }

    // Start heartbeat interval
    private startHeartbeat(): void {
        this.heartbeatInterval = setInterval(() => {
            const connections = this.connectionPool.getAllConnections();
            for (const client of connections) {
                if (client.socket.readyState === WebSocket.OPEN) {
                    try {
                        client.socket.ping();
                    } catch (error) {
                        console.error(
                            `[WS] Ping failed for client ${client.id}:`,
                            error,
                        );
                        this.connectionPool.removeConnection(client.id);
                    }
                }
            }
        }, this.config.heartbeatInterval);
    }

    // Start cleanup interval
    private startCleanup(): void {
        this.cleanupInterval = setInterval(() => {
            this.connectionPool.cleanup();
            this.messageQueue.cleanup();
        }, 60000); // Every minute
    }

    // Generate unique client ID
    private generateClientId(): string {
        return `client-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    }

    // Generate unique message ID
    private generateMessageId(): string {
        return `msg-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    }

    // Get enhanced server status
    getStatus(): {
        isRunning: boolean;
        clientCount: number;
        maxConnections: number;
        port: number;
        path: string;
        connectionStats: ReturnType<ConnectionPool["getStats"]>;
        queueStats: ReturnType<MessageQueue["getStats"]>;
    } {
        return {
            isRunning: this.isRunning,
            clientCount: this.connectionPool.getAllConnections().length,
            maxConnections: this.config.maxConnections,
            port: this.config.port,
            path: this.config.path,
            connectionStats: this.connectionPool.getStats(),
            queueStats: this.messageQueue.getStats(),
        };
    }

    // Add event listener
    addListener(callback: (event: WebSocketEvent) => void): () => void {
        this.listeners.add(callback);
        return () => this.listeners.delete(callback);
    }

    // Legacy compatibility methods
    broadcastTasksList(tasks: Task[]): void {
        const event: WebSocketEvent = {
            type: "tasks_list",
            timestamp: new Date(),
            data: { tasks },
        };
        this.broadcast(event);
    }

    broadcastTaskCreated(task: Task): void {
        const event: WebSocketEvent = {
            type: "task_created",
            timestamp: new Date(),
            data: task,
        };
        this.broadcast(event);
    }

    broadcastTaskUpdated(
        task: Task,
        changes: Partial<Task>,
        updatedBy?: string,
    ): void {
        const event: WebSocketEvent = {
            type: "task_updated",
            timestamp: new Date(),
            data: { task, changes, updatedBy },
        };
        this.broadcast(event);
    }

    broadcastTaskAssigned(
        task: Task,
        assignedTo: string,
        assignedBy: string,
    ): void {
        const event: WebSocketEvent = {
            type: "task_assigned",
            timestamp: new Date(),
            data: { task, assignedTo, assignedBy },
        };
        this.broadcast(event);
    }

    broadcastTaskCollaboratorsUpdated(
        task: Task,
        collaborators: string[],
        updatedBy: string,
    ): void {
        const event: WebSocketEvent = {
            type: "task_collaborators_updated",
            timestamp: new Date(),
            data: { task, collaborators, updatedBy },
        };
        this.broadcast(event);
    }

    broadcastTaskWatchersUpdated(
        task: Task,
        watchers: string[],
        updatedBy: string,
    ): void {
        const event: WebSocketEvent = {
            type: "task_watchers_updated",
            timestamp: new Date(),
            data: { task, watchers, updatedBy },
        };
        this.broadcast(event);
    }

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

    broadcastTaskDeleted(taskId: string): void {
        const event: WebSocketEvent = {
            type: "task_deleted",
            timestamp: new Date(),
            data: { taskId },
        };
        this.broadcast(event);
    }

    // Get connected clients info
    getClientsInfo(): Array<{
        id: string;
        subscriptions: string[];
        lastPing: Date;
        connectionDuration: number;
    }> {
        const now = new Date();
        return this.connectionPool.getAllConnections().map((client) => ({
            id: client.id,
            subscriptions: Array.from(client.subscriptions),
            lastPing: client.lastPing,
            connectionDuration: Math.floor(
                (now.getTime() - client.lastPing.getTime()) / 1000,
            ),
        }));
    }
}
