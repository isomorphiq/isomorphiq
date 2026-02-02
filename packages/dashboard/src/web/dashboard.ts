// TODO: This file is too complex (4389 lines) and should be refactored into several modules.
// Current concerns mixed: WebSocket management, HTTP request handling, notification filtering,
// real-time updates, dashboard analytics, client connection management.
// 
// Proposed structure:
// - dashboard/websocket-manager.ts - WebSocket connection and message handling
// - dashboard/http-handlers.ts - HTTP route handlers and request processing
// - dashboard/notification-service.ts - Notification filtering and delivery
// - dashboard/analytics-service.ts - Dashboard analytics calculations
// - dashboard/client-manager.ts - Client connection state and preferences
// - dashboard/types.ts - Shared interfaces and types
// - dashboard/index.ts - Main dashboard server composition

import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import type { WebSocketManager } from "@isomorphiq/realtime";
import { DaemonTcpClient } from "./tcp-client.ts";
import type { Task as CoreTask, TaskServiceApi } from "@isomorphiq/tasks";
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
    messageQueue: Promise<void>;
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
	taskManager: Pick<TaskServiceApi, "getAllTasks">;
	webSocketManager: WebSocketManager;
	analyticsService: DashboardAnalyticsService;
};

type WidgetSize = "small" | "medium" | "large";
type WidgetSizeState = Record<string, WidgetSize>;
type WidgetLayoutState = Record<string, string[]>;
type WidgetVisibilityState = string[];
type WidgetVisibilityUpdate =
    | { hiddenWidgetIds: WidgetVisibilityState }
    | { widgetId: string; hidden: boolean };
type DashboardWidgetState = {
    widgetLayout: WidgetLayoutState | null;
    hiddenWidgetIds: WidgetVisibilityState | null;
    widgetSizes: WidgetSizeState | null;
};
const WIDGET_CONTAINER_ORDER = ["overview-metrics", "queue-metrics", "health-grid"];

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

/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class DashboardServer {
	private environmentServices: Map<string, EnvironmentServices>;
	private resolveEnvironment: (headers: IncomingHttpHeaders) => string;
	private defaultEnvironment: string;
	private tcpClient: DaemonTcpClient;
	private wsServer: WebSocketServer | null = null;
	private activeConnections: Map<WebSocket, ClientConnection> = new Map();
	private notificationLog: NotificationData[] = [];
	private maxNotificationLogSize = 1000;
	private widgetSizePreferencesByEnvironment: Map<string, WidgetSizeState> = new Map();
    private widgetSizeStoragePath: string = path.join(process.cwd(), "db", "dashboard-widget-sizes.json");
    private widgetSizeLoadPromise: Promise<void> | null = null;
    private widgetSizePersistPromise: Promise<void> = Promise.resolve();
    private widgetLayoutPreferencesByEnvironment: Map<string, WidgetLayoutState> = new Map();
    private widgetLayoutStoragePath: string = path.join(process.cwd(), "db", "dashboard-widget-layout.json");
    private widgetLayoutLoadPromise: Promise<void> | null = null;
    private widgetLayoutPersistPromise: Promise<void> = Promise.resolve();
    private widgetVisibilityPreferencesByEnvironment: Map<string, WidgetVisibilityState> = new Map();
    private widgetVisibilityStoragePath: string = path.join(process.cwd(), "db", "dashboard-widget-visibility.json");
    private widgetVisibilityLoadPromise: Promise<void> | null = null;
    private widgetVisibilityPersistPromise: Promise<void> = Promise.resolve();

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

	private normalizeWidgetSize(size: unknown): WidgetSize {
		if (size === "small" || size === "medium" || size === "large") {
			return size;
		}
		return "medium";
	}

    private normalizeTaskStatus(status: unknown): Task["status"] {
        if (
            status === "todo"
            || status === "in-progress"
            || status === "done"
            || status === "failed"
            || status === "cancelled"
        ) {
            return status;
        }
        return "todo";
    }

    private normalizeTaskPriority(priority: unknown): Task["priority"] {
        if (priority === "high" || priority === "medium" || priority === "low") {
            return priority;
        }
        return "medium";
    }

    private async loadTasksResult(
        services: EnvironmentServices,
    ): Promise<{ success: true; data: Task[] } | { success: false; error: Error }> {
        try {
            const result = await services.taskManager.getAllTasks();
            if (!result.success || !Array.isArray(result.data)) {
                return {
                    success: false,
                    error: result.error ?? new Error("Failed to load tasks"),
                };
            }
            const normalized = result.data.map((task) => ({
                ...task,
                status: this.normalizeTaskStatus(task.status),
                priority: this.normalizeTaskPriority(task.priority),
            }));
            return { success: true, data: normalized };
        } catch (error) {
            console.error("[DASHBOARD] Failed to load tasks:", error);
            return {
                success: false,
                error: error instanceof Error ? error : new Error("Failed to load tasks"),
            };
        }
    }

    private async loadTasks(services: EnvironmentServices): Promise<Task[]> {
        const result = await this.loadTasksResult(services);
        return result.success ? result.data : [];
    }

    private normalizeWidgetSizeState(input: unknown): WidgetSizeState {
        if (!input || typeof input !== "object") {
            return {};
        }

        return Object.entries(input).reduce<WidgetSizeState>((acc, [widgetId, size]) => {
            if (!widgetId) {
                return acc;
            }
            return { ...acc, [widgetId]: this.normalizeWidgetSize(size) };
        }, {});
    }

    private normalizeWidgetLayoutState(input: unknown): WidgetLayoutState {
        if (!input || typeof input !== "object") {
            return {};
        }

        const normalized = Object.entries(input).reduce<WidgetLayoutState>((acc, [containerId, widgetIds]) => {
            if (!containerId || !Array.isArray(widgetIds)) {
                return acc;
            }
            const normalizedWidgetIds = widgetIds.reduce<string[]>((ids, widgetId) => {
                if (typeof widgetId !== "string" || widgetId.length === 0) {
                    return ids;
                }
                return ids.includes(widgetId) ? ids : ids.concat(widgetId);
            }, []);
            return { ...acc, [containerId]: normalizedWidgetIds };
        }, {});
        const orderedContainerIds = this.getLayoutContainerOrder(normalized);
        const orderedEntries = orderedContainerIds.reduce<Array<[string, string[]]>>((acc, containerId) => {
            const widgetIds = normalized[containerId];
            if (!Array.isArray(widgetIds) || widgetIds.length === 0) {
                return acc;
            }
            return acc.concat([[containerId, widgetIds]]);
        }, []);
        return this.dedupeWidgetLayoutEntries(orderedEntries);
    }

    private dedupeWidgetLayoutEntries(entries: Array<[string, string[]]>): WidgetLayoutState {
        return entries.reduce<{ layout: WidgetLayoutState; seen: Set<string> }>(
            (state, [containerId, widgetIds]) => {
                if (!containerId || !Array.isArray(widgetIds)) {
                    return state;
                }
                const filtered = widgetIds.reduce<{ ids: string[]; seen: Set<string> }>(
                    (innerState, widgetId) => {
                        if (typeof widgetId !== "string" || widgetId.length === 0) {
                            return innerState;
                        }
                        if (innerState.seen.has(widgetId)) {
                            return innerState;
                        }
                        const nextSeen = new Set(innerState.seen);
                        nextSeen.add(widgetId);
                        return { ids: innerState.ids.concat(widgetId), seen: nextSeen };
                    },
                    { ids: [], seen: state.seen },
                );
                if (filtered.ids.length === 0) {
                    return { layout: state.layout, seen: filtered.seen };
                }
                return { layout: { ...state.layout, [containerId]: filtered.ids }, seen: filtered.seen };
            },
            { layout: {}, seen: new Set<string>() },
        ).layout;
    }

    private getLayoutContainerOrder(layout: WidgetLayoutState): string[] {
        const layoutContainerIds = Object.keys(layout);
        const ordered = WIDGET_CONTAINER_ORDER.filter((containerId) => layoutContainerIds.includes(containerId));
        const remaining = layoutContainerIds.filter((containerId) => !WIDGET_CONTAINER_ORDER.includes(containerId));
        return ordered.concat(remaining);
    }

    private mergeWidgetLayoutUpdates(
        currentLayout: WidgetLayoutState,
        updates: WidgetLayoutState,
    ): WidgetLayoutState {
        const normalizedUpdates = this.normalizeWidgetLayoutState(updates);
        const updateContainerIds = Object.keys(normalizedUpdates);
        if (updateContainerIds.length === 0) {
            return this.normalizeWidgetLayoutState(currentLayout);
        }
        const normalizedCurrent = this.normalizeWidgetLayoutState(currentLayout);
        const orderedUpdateContainers = this.getLayoutContainerOrder(normalizedUpdates);
        const orderedExistingContainers = this.getLayoutContainerOrder(normalizedCurrent).filter(
            (containerId) => !updateContainerIds.includes(containerId),
        );
        const mergedEntries = orderedUpdateContainers
            .concat(orderedExistingContainers)
            .reduce<Array<[string, string[]]>>((acc, containerId) => {
                const widgetIds = Object.prototype.hasOwnProperty.call(normalizedUpdates, containerId)
                    ? normalizedUpdates[containerId]
                    : normalizedCurrent[containerId];
                if (!Array.isArray(widgetIds) || widgetIds.length === 0) {
                    return acc;
                }
                return acc.concat([[containerId, widgetIds]]);
            }, []);
        return this.dedupeWidgetLayoutEntries(mergedEntries);
    }

    private normalizeWidgetVisibilityState(input: unknown): WidgetVisibilityState {
        if (!Array.isArray(input)) {
            return [];
        }
        const normalizedIds = input.filter(
            (widgetId) => typeof widgetId === "string" && widgetId.length > 0,
        );
        return Array.from(new Set(normalizedIds));
    }

    private async ensureWidgetSizePreferencesLoaded(): Promise<void> {
        if (this.widgetSizeLoadPromise) {
            return this.widgetSizeLoadPromise;
        }

        this.widgetSizeLoadPromise = (async () => {
            try {
                const raw = await fs.readFile(this.widgetSizeStoragePath, "utf-8");
                const parsed = JSON.parse(raw);
                if (!parsed || typeof parsed !== "object") {
                    return;
                }
                const nextMap = Object.entries(parsed).reduce((acc, [environment, sizes]) => {
                    if (!environment) {
                        return acc;
                    }
                    const normalizedSizes = this.normalizeWidgetSizeState(sizes);
                    if (Object.keys(normalizedSizes).length === 0) {
                        return acc;
                    }
                    return new Map([...acc, [environment, normalizedSizes]]);
                }, new Map<string, WidgetSizeState>());
                this.widgetSizePreferencesByEnvironment = nextMap;
            } catch (error) {
                if (error instanceof Error && error.message.includes("ENOENT")) {
                    return;
                }
                console.error("[DASHBOARD] Failed to load widget size preferences:", error);
            }
        })();

        return this.widgetSizeLoadPromise;
    }

    private async ensureWidgetLayoutPreferencesLoaded(): Promise<void> {
        if (this.widgetLayoutLoadPromise) {
            return this.widgetLayoutLoadPromise;
        }

        this.widgetLayoutLoadPromise = (async () => {
            try {
                const raw = await fs.readFile(this.widgetLayoutStoragePath, "utf-8");
                const parsed = JSON.parse(raw);
                if (!parsed || typeof parsed !== "object") {
                    return;
                }
                const nextMap = Object.entries(parsed).reduce((acc, [environment, layout]) => {
                    if (!environment) {
                        return acc;
                    }
                    const normalizedLayout = this.normalizeWidgetLayoutState(layout);
                    return new Map([...acc, [environment, normalizedLayout]]);
                }, new Map<string, WidgetLayoutState>());
                this.widgetLayoutPreferencesByEnvironment = nextMap;
            } catch (error) {
                if (error instanceof Error && error.message.includes("ENOENT")) {
                    return;
                }
                console.error("[DASHBOARD] Failed to load widget layout preferences:", error);
            }
        })();

        return this.widgetLayoutLoadPromise;
    }

    private async ensureWidgetVisibilityPreferencesLoaded(): Promise<void> {
        if (this.widgetVisibilityLoadPromise) {
            return this.widgetVisibilityLoadPromise;
        }

        this.widgetVisibilityLoadPromise = (async () => {
            try {
                const raw = await fs.readFile(this.widgetVisibilityStoragePath, "utf-8");
                const parsed = JSON.parse(raw);
                if (!parsed || typeof parsed !== "object") {
                    return;
                }
                const nextMap = Object.entries(parsed).reduce((acc, [environment, hiddenWidgetIds]) => {
                    if (!environment) {
                        return acc;
                    }
                    const normalizedHidden = this.normalizeWidgetVisibilityState(hiddenWidgetIds);
                    return new Map([...acc, [environment, normalizedHidden]]);
                }, new Map<string, WidgetVisibilityState>());
                this.widgetVisibilityPreferencesByEnvironment = nextMap;
            } catch (error) {
                if (error instanceof Error && error.message.includes("ENOENT")) {
                    return;
                }
                console.error("[DASHBOARD] Failed to load widget visibility preferences:", error);
            }
        })();

        return this.widgetVisibilityLoadPromise;
    }

    private serializeWidgetSizePreferences(): Record<string, WidgetSizeState> {
        return Array.from(this.widgetSizePreferencesByEnvironment.entries()).reduce<Record<string, WidgetSizeState>>(
            (acc, [environment, sizes]) => {
                if (!environment) {
                    return acc;
                }
                return { ...acc, [environment]: sizes };
            },
            {},
        );
    }

    private serializeWidgetLayoutPreferences(): Record<string, WidgetLayoutState> {
        return Array.from(this.widgetLayoutPreferencesByEnvironment.entries()).reduce<Record<string, WidgetLayoutState>>(
            (acc, [environment, layout]) => {
                if (!environment) {
                    return acc;
                }
                return { ...acc, [environment]: layout };
            },
            {},
        );
    }

    private serializeWidgetVisibilityPreferences(): Record<string, WidgetVisibilityState> {
        return Array.from(this.widgetVisibilityPreferencesByEnvironment.entries()).reduce<Record<string, WidgetVisibilityState>>(
            (acc, [environment, hiddenWidgetIds]) => {
                if (!environment) {
                    return acc;
                }
                return { ...acc, [environment]: hiddenWidgetIds };
            },
            {},
        );
    }

    private scheduleWidgetSizePersistence(): void {
        const snapshot = this.serializeWidgetSizePreferences();
        this.widgetSizePersistPromise = this.widgetSizePersistPromise
            .then(() => this.persistWidgetSizePreferences(snapshot))
            .catch((error) => {
                console.error("[DASHBOARD] Failed to persist widget size preferences:", error);
            });
    }

    private scheduleWidgetLayoutPersistence(): void {
        const snapshot = this.serializeWidgetLayoutPreferences();
        this.widgetLayoutPersistPromise = this.widgetLayoutPersistPromise
            .then(() => this.persistWidgetLayoutPreferences(snapshot))
            .catch((error) => {
                console.error("[DASHBOARD] Failed to persist widget layout preferences:", error);
            });
    }

    private scheduleWidgetVisibilityPersistence(): void {
        const snapshot = this.serializeWidgetVisibilityPreferences();
        this.widgetVisibilityPersistPromise = this.widgetVisibilityPersistPromise
            .then(() => this.persistWidgetVisibilityPreferences(snapshot))
            .catch((error) => {
                console.error("[DASHBOARD] Failed to persist widget visibility preferences:", error);
            });
    }

    private async persistWidgetSizePreferences(snapshot: Record<string, WidgetSizeState>): Promise<void> {
        await fs.mkdir(path.dirname(this.widgetSizeStoragePath), { recursive: true });
        await fs.writeFile(this.widgetSizeStoragePath, JSON.stringify(snapshot, null, 2), "utf-8");
    }

    private async persistWidgetLayoutPreferences(snapshot: Record<string, WidgetLayoutState>): Promise<void> {
        await fs.mkdir(path.dirname(this.widgetLayoutStoragePath), { recursive: true });
        await fs.writeFile(this.widgetLayoutStoragePath, JSON.stringify(snapshot, null, 2), "utf-8");
    }

    private async persistWidgetVisibilityPreferences(snapshot: Record<string, WidgetVisibilityState>): Promise<void> {
        await fs.mkdir(path.dirname(this.widgetVisibilityStoragePath), { recursive: true });
        await fs.writeFile(this.widgetVisibilityStoragePath, JSON.stringify(snapshot, null, 2), "utf-8");
    }

	private getWidgetSizesForEnvironment(environment: string): WidgetSizeState {
		return this.widgetSizePreferencesByEnvironment.get(environment) ?? {};
	}

	private updateWidgetSizesForEnvironment(
		environment: string,
		updates: WidgetSizeState,
	): WidgetSizeState {
        if (Object.keys(updates).length === 0) {
            return this.getWidgetSizesForEnvironment(environment);
        }
		const currentSizes = this.getWidgetSizesForEnvironment(environment);
		const nextSizes = { ...currentSizes, ...updates };
		const nextMap = new Map(this.widgetSizePreferencesByEnvironment);
		nextMap.set(environment, nextSizes);
		this.widgetSizePreferencesByEnvironment = nextMap;
        this.scheduleWidgetSizePersistence();
		return nextSizes;
	}

    private hasWidgetLayoutForEnvironment(environment: string): boolean {
        return this.widgetLayoutPreferencesByEnvironment.has(environment);
    }

    private getWidgetLayoutForEnvironment(environment: string): WidgetLayoutState {
        return this.widgetLayoutPreferencesByEnvironment.get(environment) ?? {};
    }

    private updateWidgetLayoutForEnvironment(
        environment: string,
        updates: WidgetLayoutState,
        options?: { replace?: boolean },
    ): WidgetLayoutState {
        if (Object.keys(updates).length === 0) {
            return this.getWidgetLayoutForEnvironment(environment);
        }
        const currentLayout = this.getWidgetLayoutForEnvironment(environment);
        const nextLayout = options?.replace
            ? this.mergeWidgetLayoutUpdates({}, updates)
            : this.mergeWidgetLayoutUpdates(currentLayout, updates);
        const nextMap = new Map(this.widgetLayoutPreferencesByEnvironment);
        nextMap.set(environment, nextLayout);
        this.widgetLayoutPreferencesByEnvironment = nextMap;
        this.scheduleWidgetLayoutPersistence();
        return nextLayout;
    }

    private isWidgetLayoutFullUpdate(payload: any): boolean {
        const directFlag = payload?.fullLayout ?? payload?.isFullLayout;
        const nestedFlag = payload?.data?.fullLayout ?? payload?.data?.isFullLayout;
        return Boolean(directFlag ?? nestedFlag);
    }

    private hasWidgetVisibilityForEnvironment(environment: string): boolean {
        return this.widgetVisibilityPreferencesByEnvironment.has(environment);
    }

    private getWidgetVisibilityForEnvironment(environment: string): WidgetVisibilityState {
        return this.widgetVisibilityPreferencesByEnvironment.get(environment) ?? [];
    }

    private updateWidgetVisibilityForEnvironment(
        environment: string,
        update: WidgetVisibilityUpdate,
    ): WidgetVisibilityState {
        const currentHidden = this.getWidgetVisibilityForEnvironment(environment);
        const nextHidden = "hiddenWidgetIds" in update
            ? update.hiddenWidgetIds
            : update.hidden
                ? currentHidden.filter((id) => id !== update.widgetId).concat(update.widgetId)
                : currentHidden.filter((id) => id !== update.widgetId);
        const nextMap = new Map(this.widgetVisibilityPreferencesByEnvironment);
        nextMap.set(environment, nextHidden);
        this.widgetVisibilityPreferencesByEnvironment = nextMap;
        this.scheduleWidgetVisibilityPersistence();
        return nextHidden;
    }

	private extractWidgetSizeUpdates(payload: any): WidgetSizeState {
		const directSizes =
			payload?.widgetSizes ||
			payload?.sizes ||
			payload?.data?.widgetSizes ||
			payload?.data?.sizes;

		if (directSizes && typeof directSizes === "object") {
			return Object.entries(directSizes).reduce<WidgetSizeState>((acc, [widgetId, size]) => {
				if (!widgetId) {
					return acc;
				}
				return { ...acc, [widgetId]: this.normalizeWidgetSize(size) };
			}, {});
		}

		const widgetId = payload?.widgetId || payload?.data?.widgetId;
		if (typeof widgetId === "string" && widgetId.length > 0) {
			const normalizedSize = this.normalizeWidgetSize(payload?.size ?? payload?.data?.size);
			return { [widgetId]: normalizedSize };
		}

		return {};
	}

    private extractWidgetLayoutUpdates(payload: any): WidgetLayoutState {
        const directLayout =
            payload?.layout ||
            payload?.widgetLayout ||
            payload?.updates ||
            payload?.data?.layout ||
            payload?.data?.widgetLayout ||
            payload?.data?.updates;

        if (directLayout && typeof directLayout === "object") {
            return this.normalizeWidgetLayoutState(directLayout);
        }

        const containerId = payload?.containerId || payload?.data?.containerId;
        const widgetIds = payload?.widgetIds || payload?.data?.widgetIds;
        if (typeof containerId === "string" && Array.isArray(widgetIds)) {
            return this.normalizeWidgetLayoutState({ [containerId]: widgetIds });
        }

        return {};
    }

    private extractWidgetVisibilityUpdate(payload: any): WidgetVisibilityUpdate | null {
        const directHidden =
            payload?.hiddenWidgetIds ||
            payload?.data?.hiddenWidgetIds ||
            payload?.hidden ||
            payload?.data?.hidden;

        if (Array.isArray(directHidden)) {
            return { hiddenWidgetIds: this.normalizeWidgetVisibilityState(directHidden) };
        }

        const widgetId = payload?.widgetId || payload?.data?.widgetId;
        const hidden =
            payload?.hidden ??
            payload?.data?.hidden ??
            payload?.isHidden ??
            payload?.data?.isHidden;

        if (typeof widgetId === "string" && typeof hidden === "boolean") {
            return { widgetId, hidden };
        }

        return null;
    }

	// Initialize WebSocket server for dashboard real-time updates
	async initializeWebSocketServer(httpServer: import("node:http").Server): Promise<void> {
        await Promise.all([
            this.ensureWidgetSizePreferencesLoaded(),
            this.ensureWidgetLayoutPreferencesLoaded(),
            this.ensureWidgetVisibilityPreferencesLoaded(),
        ]);
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
                messageQueue: Promise.resolve(),
			});

			// Send initial dashboard state
			this.sendInitialState(ws, environment);

			ws.on("message", (message) => {
				try {
					const data = JSON.parse(message.toString());
                    this.enqueueWebSocketMessage(ws, data, environment);
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
            await Promise.all([
                this.ensureWidgetSizePreferencesLoaded(),
                this.ensureWidgetLayoutPreferencesLoaded(),
                this.ensureWidgetVisibilityPreferencesLoaded(),
            ]);
			const services = this.getEnvironmentServices(environment);
			const metrics = await this.getMetrics(services);
            const tasks = await this.loadTasks(services);
			
			const widgetSizes = this.getWidgetSizesForEnvironment(environment);
            const widgetLayout = this.hasWidgetLayoutForEnvironment(environment)
                ? this.getWidgetLayoutForEnvironment(environment)
                : null;
            const hiddenWidgetIds = this.hasWidgetVisibilityForEnvironment(environment)
                ? this.getWidgetVisibilityForEnvironment(environment)
                : null;
			ws.send(JSON.stringify({
				type: "initial_state",
				data: { metrics, tasks, widgetSizes, widgetLayout, hiddenWidgetIds }
			}));
		} catch (error) {
			console.error("[DASHBOARD] Error sending initial state:", error);
			ws.send(JSON.stringify({
				type: "error",
				message: "Failed to load initial data"
			}));
		}
	}

    private enqueueWebSocketMessage(ws: WebSocket, data: any, environment: string): void {
        const connection = this.activeConnections.get(ws);
        if (!connection) {
            void this.handleWebSocketMessage(ws, data, environment).catch((error) => {
                console.error("[DASHBOARD] Failed to handle WebSocket message:", error);
            });
            return;
        }

        const previousQueue = connection.messageQueue ?? Promise.resolve();
        const nextQueue = previousQueue
            .catch((error) => {
                console.error("[DASHBOARD] WebSocket message queue error:", error);
            })
            .then(() => this.handleWebSocketMessage(ws, data, environment))
            .catch((error) => {
                console.error("[DASHBOARD] Failed to handle WebSocket message:", error);
            });

        this.activeConnections.set(ws, { ...connection, messageQueue: nextQueue });
    }

	// Handle incoming WebSocket messages from dashboard
	private async handleWebSocketMessage(ws: WebSocket, data: any, environment: string): Promise<void> {
        await Promise.all([
            this.ensureWidgetSizePreferencesLoaded(),
            this.ensureWidgetLayoutPreferencesLoaded(),
            this.ensureWidgetVisibilityPreferencesLoaded(),
        ]);
		const services = this.getEnvironmentServices(environment);
		switch (data.type) {
			case "ping":
				ws.send(JSON.stringify({
					type: "pong",
					data: { timestamp: Date.now() }
				}));
				break;
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
					const tasks = await this.loadTasks(services);
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
			case "get_widget_sizes": {
				const widgetSizes = this.getWidgetSizesForEnvironment(environment);
				ws.send(JSON.stringify({
					type: "widget_size_state",
					data: { widgetSizes }
				}));
				break;
			}
            case "get_widget_layout": {
                const widgetLayout = this.hasWidgetLayoutForEnvironment(environment)
                    ? this.getWidgetLayoutForEnvironment(environment)
                    : null;
                ws.send(JSON.stringify({
                    type: "widget_layout_state",
                    data: { widgetLayout },
                }));
                break;
            }
            case "get_widget_visibility": {
                const hiddenWidgetIds = this.hasWidgetVisibilityForEnvironment(environment)
                    ? this.getWidgetVisibilityForEnvironment(environment)
                    : null;
                ws.send(JSON.stringify({
                    type: "widget_visibility_state",
                    data: { hiddenWidgetIds },
                }));
                break;
            }
			case "widget_size_update":
			case "widget_size_changed":
			case "set_widget_size": {
				const updates = this.extractWidgetSizeUpdates(data);
				if (Object.keys(updates).length === 0) {
					ws.send(JSON.stringify({
						type: "error",
						message: "Widget size update missing widget data"
					}));
					break;
				}
				const widgetSizes = this.updateWidgetSizesForEnvironment(environment, updates);
				this.broadcastToDashboard(
					{
						type: "widget_size_update",
						data: { widgetSizes, updates }
					},
					environment,
				);
				break;
			}
            case "widget_layout_update":
            case "widget_layout_changed":
            case "set_widget_layout": {
                const updates = this.extractWidgetLayoutUpdates(data);
                if (Object.keys(updates).length === 0) {
                    ws.send(JSON.stringify({
                        type: "error",
                        message: "Widget layout update missing widget data",
                    }));
                    break;
                }
                const isFullLayout = this.isWidgetLayoutFullUpdate(data);
                const widgetLayout = this.updateWidgetLayoutForEnvironment(environment, updates, {
                    replace: isFullLayout,
                });
                this.broadcastToDashboard(
                    {
                        type: "widget_layout_update",
                        data: { widgetLayout, updates },
                    },
                    environment,
                );
                break;
            }
            case "widget_visibility_update":
            case "widget_visibility_changed":
            case "set_widget_visibility": {
                const update = this.extractWidgetVisibilityUpdate(data);
                if (!update) {
                    ws.send(JSON.stringify({
                        type: "error",
                        message: "Widget visibility update missing widget data",
                    }));
                    break;
                }
                const hiddenWidgetIds = this.updateWidgetVisibilityForEnvironment(environment, update);
                this.broadcastToDashboard(
                    {
                        type: "widget_visibility_update",
                        data: { hiddenWidgetIds },
                    },
                    environment,
                );
                break;
            }
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
					const tasks = await this.loadTasks(services);
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
		const interval = setInterval(async () => {
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
		interval.unref();
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
                await Promise.all([
                    this.ensureWidgetSizePreferencesLoaded(),
                    this.ensureWidgetLayoutPreferencesLoaded(),
                    this.ensureWidgetVisibilityPreferencesLoaded(),
                ]);
                const widgetLayout = this.hasWidgetLayoutForEnvironment(environment)
                    ? this.getWidgetLayoutForEnvironment(environment)
                    : null;
                const hiddenWidgetIds = this.hasWidgetVisibilityForEnvironment(environment)
                    ? this.getWidgetVisibilityForEnvironment(environment)
                    : null;
                const widgetSizes = this.getWidgetSizesForEnvironment(environment);
                const widgetState: DashboardWidgetState = {
                    widgetLayout,
                    hiddenWidgetIds,
                    widgetSizes: Object.keys(widgetSizes).length > 0 ? widgetSizes : null,
                };
                res.writeHead(200, { "Content-Type": "text/html" });
                res.end(this.getDashboardHTML(widgetState));
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

            if (pathname === "/api/widgets/layout" && req.method === "POST") {
                await this.serveWidgetLayoutUpdate(req, res, environment);
                return;
            }

            if (pathname === "/api/widgets/visibility" && req.method === "POST") {
                await this.serveWidgetVisibilityUpdate(req, res, environment);
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

    private parseJsonBody(body: string): { success: true; data: unknown } | { success: false; error: Error } {
        try {
            return { success: true, data: JSON.parse(body) };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error : new Error("Invalid JSON"),
            };
        }
    }

    private async serveWidgetLayoutUpdate(
        req: IncomingMessage,
        res: ServerResponse,
        environment: string,
    ): Promise<void> {
        try {
            await this.ensureWidgetLayoutPreferencesLoaded();
            const body = await this.parseRequestBody(req);
            const parsed = this.parseJsonBody(body);
            if (!parsed.success) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: parsed.error.message }));
                return;
            }
            const updates = this.extractWidgetLayoutUpdates(parsed.data);
            if (Object.keys(updates).length === 0) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Widget layout update missing widget data" }));
                return;
            }
            const isFullLayout = this.isWidgetLayoutFullUpdate(parsed.data);
            const widgetLayout = this.updateWidgetLayoutForEnvironment(environment, updates, {
                replace: isFullLayout,
            });
            this.broadcastToDashboard(
                {
                    type: "widget_layout_update",
                    data: { widgetLayout, updates },
                },
                environment,
            );
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ widgetLayout }));
        } catch (error) {
            console.error("[DASHBOARD] Error persisting widget layout:", error);
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(
                JSON.stringify({
                    error: error instanceof Error ? error.message : "Failed to persist widget layout",
                }),
            );
        }
    }

    private async serveWidgetVisibilityUpdate(
        req: IncomingMessage,
        res: ServerResponse,
        environment: string,
    ): Promise<void> {
        try {
            await this.ensureWidgetVisibilityPreferencesLoaded();
            const body = await this.parseRequestBody(req);
            const parsed = this.parseJsonBody(body);
            if (!parsed.success) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: parsed.error.message }));
                return;
            }
            const update = this.extractWidgetVisibilityUpdate(parsed.data);
            if (!update) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Widget visibility update missing widget data" }));
                return;
            }
            const hiddenWidgetIds = this.updateWidgetVisibilityForEnvironment(environment, update);
            this.broadcastToDashboard(
                {
                    type: "widget_visibility_update",
                    data: { hiddenWidgetIds },
                },
                environment,
            );
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ hiddenWidgetIds }));
        } catch (error) {
            console.error("[DASHBOARD] Error persisting widget visibility:", error);
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(
                JSON.stringify({
                    error: error instanceof Error ? error.message : "Failed to persist widget visibility",
                }),
            );
        }
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
				const maxSearchLength = 2000;
				if (searchQuery && searchQuery.length > maxSearchLength) {
					res.writeHead(414, { "Content-Type": "application/json" });
					res.end(
						JSON.stringify({
							error: "Search query too long",
							maxLength: maxSearchLength,
						}),
					);
					return;
				}

                const services = this.getEnvironmentServices(environment);
                const tasksResult = await this.loadTasksResult(services);
                if (!tasksResult.success) {
                    res.writeHead(500, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: "Failed to search tasks" }));
                    return;
                }
                const tasks = tasksResult.data;
                const normalizedQuery = searchQuery?.trim().toLowerCase();
                const filtered = tasks.filter((task) => {
                    if (statusFilter && statusFilter !== "all" && task.status !== statusFilter) {
                        return false;
                    }
                    if (priorityFilter && priorityFilter !== "all" && task.priority !== priorityFilter) {
                        return false;
                    }
                    if (!normalizedQuery) {
                        return true;
                    }
                    const haystack = `${task.title ?? ""} ${task.description ?? ""} ${task.id ?? ""}`.toLowerCase();
                    return haystack.includes(normalizedQuery);
                });

                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify(filtered));
			} else if (pathname === "/api/tasks" && req.method === "POST") {
				// Create new task
				const body = await this.parseRequestBody(req);
                const parsed = this.parseJsonBody(body);
                if (!parsed.success) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: "Invalid JSON body" }));
                    return;
                }
				const taskData = parsed.data;
				
				const result = await this.tcpClient.sendCommand("create_task", taskData, environment);
				
				if (result.success) {
					res.writeHead(201, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ success: true, data: result.data }));
				} else {
					res.writeHead(400, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ error: result.error?.message || "Failed to create task" }));
				}
			} else if (pathname.startsWith("/api/tasks/") && req.method === "PUT") {
				// Update task
				const taskId = pathname.split("/").pop();
				const body = await this.parseRequestBody(req);
                const parsed = this.parseJsonBody(body);
                if (!parsed.success) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: "Invalid JSON body" }));
                    return;
                }
				const updateData = parsed.data as Record<string, unknown>;
				
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
					res.end(JSON.stringify({ success: true, data: result.data }));
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
                const parsed = this.parseJsonBody(body);
                if (!parsed.success) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: "Invalid JSON body" }));
                    return;
                }
				const updateData = parsed.data as Record<string, unknown>;
				
				const result = await this.tcpClient.sendCommand(
					"update_task_status",
					{ id: updateData.id, status: updateData.status },
					environment,
				);
				
				if (result.success) {
					res.writeHead(200, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ success: true, data: result.data }));
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
                const parsed = this.parseJsonBody(body);
                if (!parsed.success) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: "Invalid JSON body" }));
                    return;
                }
				const { id } = parsed.data as { id?: string };
				
				const result = await this.tcpClient.sendCommand(
					"update_task_status",
					{ id, status: "cancelled" },
					environment,
				);
				
				if (result.success) {
					res.writeHead(200, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ success: true, data: result.data }));
				} else {
					res.writeHead(400, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ error: result.error?.message || "Failed to cancel task" }));
				}
			} else if (pathname === "/api/tasks/retry" && req.method === "POST") {
				// Retry failed task (set status back to todo)
				const body = await this.parseRequestBody(req);
                const parsed = this.parseJsonBody(body);
                if (!parsed.success) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: "Invalid JSON body" }));
                    return;
                }
				const { id } = parsed.data as { id?: string };
				
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
		const tasks = await this.loadTasks(services);
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
				totalmem: os.totalmem(),
				freemem: os.freemem(),
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

	private getDashboardHTML(initialWidgetState?: DashboardWidgetState): string {
        const resolvedWidgetState: DashboardWidgetState = initialWidgetState ?? {
            widgetLayout: null,
            hiddenWidgetIds: null,
            widgetSizes: null,
        };
        const widgetStateJson = JSON.stringify(resolvedWidgetState).replace(/</g, "\\u003c");
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
            padding: var(--widget-padding); 
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

        .widget-container {
            transition: background 0.2s, outline 0.2s;
        }

        .widget-container.drag-active {
            outline: 2px dashed rgba(59, 130, 246, 0.35);
            outline-offset: 4px;
            background: rgba(59, 130, 246, 0.03);
        }

        .widget-card {
            cursor: grab;
            user-select: none;
            --widget-padding: 24px;
            --widget-metric-value-size: 2.5rem;
            --widget-metric-label-size: 0.875rem;
            --widget-metric-change-size: 0.75rem;
            --widget-health-title-size: 1.1rem;
            --widget-health-metric-size: 0.875rem;
            --widget-controls-margin: 12px;
            --widget-controls-font: 0.7rem;
            --widget-controls-padding-y: 2px;
            --widget-controls-padding-x: 6px;
        }

        .widget-size-small {
            --widget-padding: 16px;
            --widget-metric-value-size: 2rem;
            --widget-metric-label-size: 0.75rem;
            --widget-metric-change-size: 0.7rem;
            --widget-health-title-size: 1rem;
            --widget-health-metric-size: 0.8rem;
            --widget-controls-margin: 8px;
            --widget-controls-font: 0.65rem;
            --widget-controls-padding-y: 2px;
            --widget-controls-padding-x: 6px;
        }

        .widget-size-medium {
            --widget-padding: 24px;
            --widget-metric-value-size: 2.5rem;
            --widget-metric-label-size: 0.875rem;
            --widget-metric-change-size: 0.75rem;
            --widget-health-title-size: 1.1rem;
            --widget-health-metric-size: 0.875rem;
            --widget-controls-margin: 12px;
            --widget-controls-font: 0.7rem;
            --widget-controls-padding-y: 2px;
            --widget-controls-padding-x: 6px;
        }

        .widget-size-large {
            --widget-padding: 32px;
            --widget-metric-value-size: 3rem;
            --widget-metric-label-size: 0.95rem;
            --widget-metric-change-size: 0.8rem;
            --widget-health-title-size: 1.25rem;
            --widget-health-metric-size: 0.95rem;
            --widget-controls-margin: 14px;
            --widget-controls-font: 0.75rem;
            --widget-controls-padding-y: 3px;
            --widget-controls-padding-x: 8px;
        }

        .widget-card:focus {
            outline: 2px solid rgba(59, 130, 246, 0.7);
            outline-offset: 2px;
        }

        .widget-card.dragging {
            opacity: 0.45;
            transform: scale(0.98);
            box-shadow: none;
        }

        .widget-card.drag-over {
            outline: 2px solid rgba(59, 130, 246, 0.6);
            outline-offset: 2px;
        }

        .widget-drop-indicator {
            border: 2px dashed rgba(59, 130, 246, 0.5);
            border-radius: 12px;
            background: rgba(59, 130, 246, 0.08);
            pointer-events: none;
        }

        .widget-ghost {
            position: absolute;
            top: -9999px;
            left: -9999px;
            opacity: 0.9;
            transform: rotate(1deg);
            box-shadow: 0 12px 30px rgba(0,0,0,0.2);
            pointer-events: none;
            z-index: 9999;
        }

        .widget-size-controls {
            display: flex;
            justify-content: flex-end;
            gap: 4px;
            margin-bottom: var(--widget-controls-margin);
        }

        .widget-size-btn {
            border: 1px solid #e5e7eb;
            background: #f9fafb;
            color: #374151;
            border-radius: 999px;
            font-size: var(--widget-controls-font);
            padding: var(--widget-controls-padding-y) var(--widget-controls-padding-x);
            text-transform: uppercase;
            letter-spacing: 0.05em;
            cursor: pointer;
        }

        .widget-size-btn[aria-pressed="true"] {
            background: #3b82f6;
            color: white;
            border-color: #2563eb;
        }

        .widget-size-btn:focus {
            outline: 2px solid rgba(59, 130, 246, 0.7);
            outline-offset: 1px;
        }

        .widget-hidden {
            display: none;
        }

        .widget-library {
            background: white;
            border-radius: 12px;
            padding: 24px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        }

        .widget-library-header {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            margin-bottom: 20px;
        }

        .widget-library-header h2 {
            font-size: 1.4rem;
            color: #1f2937;
            font-weight: 700;
        }

        .widget-library-header p {
            color: #6b7280;
            font-size: 0.9rem;
        }

        .widget-library-actions {
            display: flex;
            gap: 8px;
        }

        .widget-library-section {
            margin-bottom: 20px;
        }

        .widget-library-section:last-child {
            margin-bottom: 0;
        }

        .widget-library-section-title {
            font-size: 1rem;
            font-weight: 600;
            color: #1f2937;
            margin-bottom: 12px;
        }

        .widget-library-sections {
            display: flex;
            flex-direction: column;
            gap: 20px;
        }

        .widget-library-list {
            display: grid;
            gap: 12px;
        }

        .widget-library-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            border: 1px solid #e5e7eb;
            border-radius: 10px;
            padding: 12px 16px;
            background: #f9fafb;
        }

        .widget-library-item.selected {
            border-color: #3b82f6;
            background: #eff6ff;
        }

        .widget-library-item-info {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }

        .widget-library-item-name {
            font-weight: 600;
            color: #1f2937;
        }

        .widget-library-item-meta {
            font-size: 0.8rem;
            color: #6b7280;
        }

        .widget-library-item-actions {
            display: flex;
            align-items: center;
            gap: 12px;
            flex-wrap: wrap;
        }

        .widget-library-toggle {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 0.85rem;
            color: #374151;
        }

        .widget-library-select {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 0.85rem;
            color: #374151;
        }

        .widget-library-select input {
            width: 16px;
            height: 16px;
        }

        .widget-library-select input:disabled {
            cursor: not-allowed;
            opacity: 0.6;
        }
        
        .metric-value { 
            font-size: var(--widget-metric-value-size); 
            font-weight: 700; 
            color: #3b82f6; 
            line-height: 1;
            margin-bottom: 8px;
        }
        
        .metric-label { 
            color: #6b7280; 
            font-size: var(--widget-metric-label-size);
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        
        .metric-change {
            position: absolute;
            top: var(--widget-padding);
            right: var(--widget-padding);
            font-size: var(--widget-metric-change-size);
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
            padding: var(--widget-padding);
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
            font-size: var(--widget-health-title-size);
            font-weight: 600;
            color: #1f2937;
            margin-bottom: 12px;
        }
        
        .health-metric {
            display: flex;
            justify-content: space-between;
            padding: 8px 0;
            font-size: var(--widget-health-metric-size);
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
            <button class="tab" data-tab="widgets">Widgets</button>
            <button class="tab" data-tab="queue">Queue Status</button>
            <button class="tab" data-tab="tasks">Tasks</button>
            <button class="tab" data-tab="create">Create Task</button>
            <button class="tab" data-tab="history">Task History</button>
            <button class="tab" data-tab="health">Health</button>
            <button class="tab" data-tab="logs">Activity Log</button>
        </div>

        <!-- Overview Tab -->
        <div id="overview-tab" class="tab-content active">
            <div class="metrics" data-widget-container="overview-metrics">
                <div class="metric-card" data-widget-id="overview-total">
                    <div class="metric-value" id="totalTasks">-</div>
                    <div class="metric-label">Total Tasks</div>
                    <div class="metric-change positive" id="totalTasksChange">+0 today</div>
                </div>
                <div class="metric-card" data-widget-id="overview-pending">
                    <div class="metric-value" id="pendingTasks">-</div>
                    <div class="metric-label">Pending</div>
                    <div class="metric-change" id="pendingTasksChange">0% completion</div>
                </div>
                <div class="metric-card" data-widget-id="overview-in-progress">
                    <div class="metric-value" id="inProgressTasks">-</div>
                    <div class="metric-label">In Progress</div>
                    <div class="metric-change" id="inProgressTasksChange">Active now</div>
                </div>
                <div class="metric-card" data-widget-id="overview-completed">
                    <div class="metric-value" id="completedTasks">-</div>
                    <div class="metric-label">Completed</div>
                    <div class="metric-change positive" id="completedTasksChange">+0 today</div>
                </div>
                <div class="metric-card" data-widget-id="overview-connections">
                    <div class="metric-value" id="wsConnections">-</div>
                    <div class="metric-label">Live Connections</div>
                    <div class="metric-change" id="connectionStatus">WebSocket</div>
                </div>
                <div class="metric-card" data-widget-id="overview-high-priority">
                    <div class="metric-value" id="highPriorityTasks">-</div>
                    <div class="metric-label">High Priority</div>
                    <div class="metric-change negative" id="highPriorityUrgent">Needs attention</div>
                </div>
            </div>
        </div>

        <!-- Widget Library Tab -->
        <div id="widgets-tab" class="tab-content">
            <div class="widget-library">
                <div class="widget-library-header">
                    <div>
                        <h2>Widget Library</h2>
                        <p>Select which widgets appear on your dashboard.</p>
                    </div>
                    <div class="widget-library-actions">
                        <button class="btn btn-primary btn-sm" id="addSelectedWidgetsBtn" disabled>
                            <span>➕</span>
                            <span id="addSelectedWidgetsLabel">Add Selected</span>
                        </button>
                        <button class="btn btn-secondary btn-sm" id="showAllWidgetsBtn">
                            <span>✅</span> Show All
                        </button>
                        <button class="btn btn-secondary btn-sm" id="hideAllWidgetsBtn">
                            <span>🙈</span> Hide All
                        </button>
                    </div>
                </div>
                <div id="widgetLibraryList" class="widget-library-sections"></div>
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
            <div class="metrics" data-widget-container="queue-metrics">
                <div class="metric-card" data-widget-id="queue-total">
                    <div class="metric-value" id="queueTotal">-</div>
                    <div class="metric-label">Total Tasks in Queue</div>
                </div>
                <div class="metric-card" data-widget-id="queue-high-priority">
                    <div class="metric-value" id="queueHighPriority">-</div>
                    <div class="metric-label">High Priority</div>
                </div>
                <div class="metric-card" data-widget-id="queue-avg-processing">
                    <div class="metric-value" id="queueAvgProcessingTime">-</div>
                    <div class="metric-label">Avg Processing Time</div>
                </div>
                <div class="metric-card" data-widget-id="queue-failed">
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
            <div class="health-grid" data-widget-container="health-grid">
                <div class="health-card" data-widget-id="health-system">
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

                <div class="health-card" data-widget-id="health-memory">
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

                <div class="health-card" data-widget-id="health-connections">
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

                <div class="health-card" data-widget-id="health-system-info">
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

                <div class="health-card" data-widget-id="health-performance">
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

                <div class="health-card" data-widget-id="health-controls">
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

                <div class="health-card" data-widget-id="health-alerts">
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

    <script id="dashboardWidgetState" type="application/json">${widgetStateJson}</script>
    <script data-dashboard="true">
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
                            if (tabName === "queue") loadQueueStatus();
                            if (tabName === "tasks") loadTasks();
                            if (tabName === "health") loadHealthDetails();
                            if (tabName === "logs") loadLogs();
                            if (tabName === "history") loadAuditHistory();
                            if (tabName === "widgets") renderWidgetLibrary();
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
                    showSuccess("Real-time updates enabled");
                    if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
                        // Flush pending updates before requesting state to avoid overwriting offline changes.
                        flushPendingWidgetLayoutSync();
                        flushPendingWidgetVisibilitySync();
                        wsConnection.send(JSON.stringify({ type: "get_widget_sizes" }));
                        wsConnection.send(JSON.stringify({ type: "get_widget_layout" }));
                        wsConnection.send(JSON.stringify({ type: "get_widget_visibility" }));
                    }
                };
                
                wsConnection.onmessage = async function(event) {
                    try {
                        const message = JSON.parse(event.data);

                        if (message.type === "initial_state") {
                            if (message.data && Object.prototype.hasOwnProperty.call(message.data, "widgetSizes")) {
                                handleWidgetSizeSync(message.data);
                            }
                            if (message.data && Object.prototype.hasOwnProperty.call(message.data, "widgetLayout")) {
                                handleWidgetLayoutSync(message.data);
                            }
                            if (message.data && Object.prototype.hasOwnProperty.call(message.data, "hiddenWidgetIds")) {
                                handleWidgetVisibilitySync(message.data);
                            }
                            return;
                        }

                        if (message.type === "widget_size_state" || message.type === "widget_size_update") {
                            handleWidgetSizeSync(message.data ?? message);
                            return;
                        }

                        if (message.type === "widget_layout_state" || message.type === "widget_layout_update") {
                            handleWidgetLayoutSync(message.data ?? message);
                            return;
                        }

                        if (message.type === "widget_visibility_state" || message.type === "widget_visibility_update") {
                            handleWidgetVisibilitySync(message.data ?? message);
                            return;
                        }
                        
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

        const WIDGET_LAYOUT_STORAGE_KEY = "dashboardWidgetLayout.v1";
        const WIDGET_SIZE_STORAGE_KEY = "dashboardWidgetSize.v1";
        const WIDGET_VISIBILITY_STORAGE_KEY = "dashboardWidgetVisibility.v1";
        const WIDGET_LIBRARY_SELECTION_KEY = "dashboardWidgetLibrarySelection.v1";
        const WIDGET_LIBRARY_PENDING_ADD_KEY = "dashboardWidgetLibraryPendingAdd.v1";
        const WIDGET_LAYOUT_PENDING_SYNC_KEY = "dashboardWidgetLayout.pending.v1";
        const WIDGET_VISIBILITY_PENDING_SYNC_KEY = "dashboardWidgetVisibility.pending.v1";
        const WIDGET_LAYOUT_SYNC_TIMEOUT_MS = 2500;
        const WIDGET_SIZE_OPTIONS = ["small", "medium", "large"];
        const WIDGET_SIZE_CLASSES = WIDGET_SIZE_OPTIONS.map(size => \`widget-size-\${size}\`);
        const WIDGET_CONTAINER_LABELS = {
            "overview-metrics": "Overview",
            "queue-metrics": "Queue Status",
            "health-grid": "Health",
        };
        const WIDGET_CONTAINER_ORDER = ["overview-metrics", "queue-metrics", "health-grid"];
        let widgetDragState = {
            dragging: null,
            placeholder: null,
            container: null,
        };
        let widgetCatalog = [];
        let selectedWidgetIds = new Set();
        let widgetLayoutSyncState = {
            hasSynced: false,
            hasLayout: false,
            hasServerSync: false,
        };
        let pendingAddSelectedWidgets = false;
        let widgetLayoutSyncTimeoutId = null;
        let widgetLayoutSyncRequested = false;

        function loadInitialWidgetState() {
            const stateElement = document.getElementById("dashboardWidgetState");
            if (!(stateElement instanceof HTMLScriptElement)) {
                return null;
            }
            try {
                const raw = stateElement.textContent;
                if (!raw) {
                    return null;
                }
                const parsed = JSON.parse(raw);
                return parsed && typeof parsed === "object" ? parsed : null;
            } catch (error) {
                console.warn("Failed to parse initial widget state:", error);
                return null;
            }
        }

        function hydrateWidgetStateFromServer() {
            const initialState = loadInitialWidgetState();
            if (!initialState || typeof initialState !== "object") {
                return;
            }
            const pendingLayout = loadPendingWidgetLayoutSync();
            const pendingVisibility = loadPendingWidgetVisibilitySync();
            const localSizes = loadWidgetSizes();
            const serverLayout = initialState.widgetLayout;
            const hasServerLayoutValue = Object.prototype.hasOwnProperty.call(initialState, "widgetLayout");
            const hasServerLayout = Boolean(
                serverLayout &&
                typeof serverLayout === "object" &&
                Object.keys(serverLayout).length > 0,
            );
            if (!pendingLayout.hasPending &&
                serverLayout && typeof serverLayout === "object") {
                saveWidgetLayoutState(serverLayout);
            }
            if (hasServerLayoutValue) {
                updateWidgetLayoutSyncState({
                    hasSynced: true,
                    hasLayout: hasServerLayout,
                    hasServerSync: true,
                });
            }
            const serverHidden = initialState.hiddenWidgetIds;
            if (!pendingVisibility.hasPending && Array.isArray(serverHidden)) {
                saveHiddenWidgetIds(serverHidden);
            }
            const serverSizes = initialState.widgetSizes;
            if (Object.keys(localSizes).length === 0 &&
                serverSizes && typeof serverSizes === "object") {
                saveWidgetSizes(serverSizes);
            }
        }

        function updateWidgetLayoutSyncState(nextState) {
            const resolvedState = { ...widgetLayoutSyncState, ...nextState };
            widgetLayoutSyncState = resolvedState;
            if (resolvedState.hasSynced) {
                clearWidgetLayoutSyncTimeout();
                widgetLayoutSyncRequested = false;
            }
            updateAddSelectedWidgetsState();
        }

        function clearWidgetLayoutSyncTimeout() {
            if (widgetLayoutSyncTimeoutId === null) {
                return;
            }
            clearTimeout(widgetLayoutSyncTimeoutId);
            widgetLayoutSyncTimeoutId = null;
        }

        function scheduleWidgetLayoutSyncFallback() {
            if (widgetLayoutSyncTimeoutId !== null) {
                return;
            }
            widgetLayoutSyncTimeoutId = setTimeout(() => {
                widgetLayoutSyncTimeoutId = null;
                if (widgetLayoutSyncState.hasSynced) {
                    updateAddSelectedWidgetsState();
                    return;
                }
                const seededLayout = seedWidgetLayoutIfEmpty();
                updateWidgetLayoutSyncState({
                    hasSynced: true,
                    hasLayout: Object.keys(seededLayout).length > 0,
                    hasServerSync: false,
                });
                triggerPendingAddSelectedWidgets();
            }, WIDGET_LAYOUT_SYNC_TIMEOUT_MS);
        }

        function hasWidgetLayoutSyncConnection() {
            if (!wsConnection) {
                return false;
            }
            return wsConnection.readyState === WebSocket.OPEN ||
                wsConnection.readyState === WebSocket.CONNECTING;
        }

        function isWidgetLayoutReady() {
            if (widgetLayoutSyncState.hasSynced) {
                return true;
            }
            const localLayout = loadWidgetLayout();
            if (Object.keys(localLayout).length === 0) {
                return false;
            }
            return !hasWidgetLayoutSyncConnection();
        }

        function shouldGateAddSelectedWidgets() {
            if (isWidgetLayoutReady()) {
                return false;
            }
            return hasWidgetLayoutSyncConnection();
        }

        function updateWidgetDragState(nextState) {
            widgetDragState = { ...widgetDragState, ...nextState };
        }

        function updateSelectedWidgetIds(nextSelected) {
            const selectedList = Array.isArray(nextSelected) ? nextSelected : [];
            const hiddenSet = new Set(loadHiddenWidgetIds());
            const filtered = selectedList.filter(widgetId => hiddenSet.has(widgetId));
            const normalized = saveSelectedWidgetIds(filtered);
            selectedWidgetIds = new Set(normalized);
            if (selectedWidgetIds.size === 0) {
                pendingAddSelectedWidgets = false;
                clearPendingAddSelectedWidgets();
            }
            updateAddSelectedWidgetsState();
        }

        function pruneSelectedWidgetIds(hiddenWidgetIds, catalogIdsOverride) {
            const hiddenSet = new Set(hiddenWidgetIds);
            const catalogIds = Array.isArray(catalogIdsOverride)
                ? catalogIdsOverride
                : (() => {
                    collectWidgetCatalog();
                    return widgetCatalog.map(widget => widget.id);
                })();
            const catalogSet = new Set(catalogIds);
            const nextSelected = Array.from(selectedWidgetIds).filter(
                widgetId => hiddenSet.has(widgetId) && catalogSet.has(widgetId),
            );
            if (nextSelected.length !== selectedWidgetIds.size) {
                updateSelectedWidgetIds(nextSelected);
            } else {
                updateAddSelectedWidgetsState();
            }
        }

        function getSelectedWidgetIdsInOrder(hiddenSet, layoutOverride) {
            collectWidgetCatalog();
            const layout = layoutOverride && typeof layoutOverride === "object"
                ? layoutOverride
                : loadWidgetLayout();
            const orderedContainerIds = getLayoutContainerOrder(layout);
            const layoutOrder = orderedContainerIds.reduce((acc, containerId) => {
                const widgetIds = Array.isArray(layout[containerId]) ? layout[containerId] : [];
                const nextIds = widgetIds.reduce((innerAcc, widgetId) => {
                    if (!widgetId || innerAcc.includes(widgetId)) {
                        return innerAcc;
                    }
                    return innerAcc.concat(widgetId);
                }, acc);
                return nextIds;
            }, []);
            const layoutSet = new Set(layoutOrder);
            const selectedFromLayout = layoutOrder.filter(
                (widgetId) => hiddenSet.has(widgetId) && selectedWidgetIds.has(widgetId),
            );
            const catalogSet = new Set(widgetCatalog.map((widget) => widget.id));
            const catalogOrder = widgetCatalog.reduce((acc, widget, index) => {
                if (!widget?.id) {
                    return acc;
                }
                return { ...acc, [widget.id]: index };
            }, {});
            const selectedFromSelection = Array.from(selectedWidgetIds)
                .filter((widgetId) => !layoutSet.has(widgetId))
                .filter((widgetId) => hiddenSet.has(widgetId) && catalogSet.has(widgetId));
            const orderedSelection = selectedFromSelection
                .slice()
                .sort((a, b) => {
                    const aIndex = catalogOrder[a] ?? Number.MAX_SAFE_INTEGER;
                    const bIndex = catalogOrder[b] ?? Number.MAX_SAFE_INTEGER;
                    if (aIndex !== bIndex) {
                        return aIndex - bIndex;
                    }
                    return a.localeCompare(b);
                });
            return selectedFromLayout.concat(orderedSelection);
        }

        function updateAddSelectedWidgetsState() {
            const button = document.getElementById("addSelectedWidgetsBtn");
            if (!(button instanceof HTMLButtonElement)) {
                return;
            }
            const label = document.getElementById("addSelectedWidgetsLabel");
            const count = selectedWidgetIds.size;
            const needsLayoutSync = count > 0 && shouldGateAddSelectedWidgets();
            if (needsLayoutSync && !widgetLayoutSyncRequested) {
                widgetLayoutSyncRequested = true;
                requestWidgetLayoutSync();
                scheduleWidgetLayoutSyncFallback();
            } else if (!needsLayoutSync) {
                widgetLayoutSyncRequested = false;
            }
            const isSyncing = (pendingAddSelectedWidgets && count > 0) || needsLayoutSync;
            button.disabled = count === 0 || pendingAddSelectedWidgets || needsLayoutSync;
            button.setAttribute("aria-busy", isSyncing ? "true" : "false");
            if (label instanceof HTMLElement) {
                if (isSyncing) {
                    label.textContent = "Syncing layout...";
                    return;
                }
                label.textContent = count > 0 ? "Add Selected (" + count + ")" : "Add Selected";
            }
        }

        function triggerPendingAddSelectedWidgets() {
            if (!pendingAddSelectedWidgets) {
                return;
            }
            if (selectedWidgetIds.size === 0) {
                pendingAddSelectedWidgets = false;
                clearPendingAddSelectedWidgets();
                return;
            }
            if (!isWidgetLayoutReady()) {
                return;
            }
            pendingAddSelectedWidgets = false;
            clearPendingAddSelectedWidgets();
            addSelectedWidgetsToDashboard();
        }

        function toggleWidgetSelection(widgetId, shouldSelect) {
            if (!widgetId) {
                return;
            }
            const nextSelected = shouldSelect
                ? Array.from(new Set(Array.from(selectedWidgetIds).concat(widgetId)))
                : Array.from(selectedWidgetIds).filter(id => id !== widgetId);
            updateSelectedWidgetIds(nextSelected);
        }

        function normalizeWidgetLayoutState(input) {
            if (!input || typeof input !== "object") {
                return {};
            }
            return Object.entries(input).reduce((acc, [containerId, widgetIds]) => {
                if (!containerId || !Array.isArray(widgetIds)) {
                    return acc;
                }
                const normalizedWidgetIds = widgetIds.reduce((ids, widgetId) => {
                    if (typeof widgetId !== "string" || widgetId.length === 0) {
                        return ids;
                    }
                    return ids.includes(widgetId) ? ids : ids.concat(widgetId);
                }, []);
                return { ...acc, [containerId]: normalizedWidgetIds };
            }, {});
        }

        function dedupeWidgetLayoutEntries(entries) {
            return entries.reduce(
                (state, [containerId, widgetIds]) => {
                    if (!containerId || !Array.isArray(widgetIds)) {
                        return state;
                    }
                    const filtered = widgetIds.reduce(
                        (innerState, widgetId) => {
                            if (typeof widgetId !== "string" || widgetId.length === 0) {
                                return innerState;
                            }
                            if (innerState.seen.has(widgetId)) {
                                return innerState;
                            }
                            const nextSeen = new Set(innerState.seen);
                            nextSeen.add(widgetId);
                            return { ids: innerState.ids.concat(widgetId), seen: nextSeen };
                        },
                        { ids: [], seen: state.seen },
                    );
                    if (filtered.ids.length === 0) {
                        return { layout: state.layout, seen: filtered.seen };
                    }
                    return { layout: { ...state.layout, [containerId]: filtered.ids }, seen: filtered.seen };
                },
                { layout: {}, seen: new Set() },
            ).layout;
        }

        function mergeWidgetLayoutUpdates(currentLayout, updates) {
            if (!updates || typeof updates !== "object") {
                return dedupeWidgetLayoutState(currentLayout);
            }
            const normalizedUpdates = normalizeWidgetLayoutState(updates);
            const updateContainerIds = Object.keys(normalizedUpdates);
            if (updateContainerIds.length === 0) {
                return dedupeWidgetLayoutState(currentLayout);
            }
            const normalizedCurrent = normalizeWidgetLayoutState(currentLayout);
            const orderedUpdateContainers = getLayoutContainerOrder(normalizedUpdates);
            const orderedExistingContainers = getLayoutContainerOrder(normalizedCurrent).filter(
                containerId => !updateContainerIds.includes(containerId),
            );
            const mergedEntries = orderedUpdateContainers
                .concat(orderedExistingContainers)
                .reduce((acc, containerId) => {
                    const widgetIds = Object.prototype.hasOwnProperty.call(normalizedUpdates, containerId)
                        ? normalizedUpdates[containerId]
                        : normalizedCurrent[containerId];
                    if (!Array.isArray(widgetIds) || widgetIds.length === 0) {
                        return acc;
                    }
                    return acc.concat([[containerId, widgetIds]]);
                }, []);
            return dedupeWidgetLayoutEntries(mergedEntries);
        }

        function dedupeWidgetLayoutState(layout) {
            if (!layout || typeof layout !== "object") {
                return {};
            }
            const orderedContainerIds = getLayoutContainerOrder(layout);
            return orderedContainerIds.reduce(
                (state, containerId) => {
                    const widgetIds = Array.isArray(layout[containerId]) ? layout[containerId] : [];
                    const filtered = widgetIds.reduce(
                        (innerState, widgetId) => {
                            if (!widgetId || innerState.seen.has(widgetId)) {
                                return innerState;
                            }
                            const nextSeen = new Set(innerState.seen);
                            nextSeen.add(widgetId);
                            return { ids: innerState.ids.concat(widgetId), seen: nextSeen };
                        },
                        { ids: [], seen: state.seen },
                    );
                    if (filtered.ids.length === 0) {
                        return { layout: state.layout, seen: filtered.seen };
                    }
                    return { layout: { ...state.layout, [containerId]: filtered.ids }, seen: filtered.seen };
                },
                { layout: {}, seen: new Set() },
            ).layout;
        }

        function normalizeWidgetVisibilityState(input) {
            if (!Array.isArray(input)) {
                return [];
            }
            const normalizedIds = input.filter(
                widgetId => typeof widgetId === "string" && widgetId.length > 0,
            );
            return Array.from(new Set(normalizedIds));
        }

        function loadWidgetLayout() {
            try {
                const raw = localStorage.getItem(WIDGET_LAYOUT_STORAGE_KEY);
                const parsed = raw ? JSON.parse(raw) : {};
                return dedupeWidgetLayoutState(normalizeWidgetLayoutState(parsed));
            } catch (error) {
                console.warn("Failed to load widget layout:", error);
                return {};
            }
        }

        function seedWidgetLayoutIfEmpty() {
            const layout = loadWidgetLayout();
            if (Object.keys(layout).length > 0) {
                return layout;
            }
            const snapshot = buildWidgetLayoutForContainers(getWidgetContainers());
            const normalized = dedupeWidgetLayoutState(normalizeWidgetLayoutState(snapshot));
            if (Object.keys(normalized).length > 0) {
                saveWidgetLayoutState(normalized);
            }
            return normalized;
        }

        function resolveWidgetLayoutForAdd(layout) {
            const pending = loadPendingWidgetLayoutSync();
            if (!pending.hasPending) {
                return layout;
            }
            if (pending.isFullLayout) {
                return Object.keys(pending.widgetLayout).length > 0 ? pending.widgetLayout : layout;
            }
            return mergeWidgetLayoutUpdates(layout, pending.widgetLayout);
        }

        function loadWidgetSizes() {
            try {
                const raw = localStorage.getItem(WIDGET_SIZE_STORAGE_KEY);
                return raw ? JSON.parse(raw) : {};
            } catch (error) {
                console.warn("Failed to load widget sizes:", error);
                return {};
            }
        }

        function loadHiddenWidgetIds() {
            try {
                const raw = localStorage.getItem(WIDGET_VISIBILITY_STORAGE_KEY);
                const parsed = raw ? JSON.parse(raw) : [];
                return normalizeWidgetVisibilityState(parsed);
            } catch (error) {
                console.warn("Failed to load widget visibility:", error);
                return [];
            }
        }

        function loadSelectedWidgetIds() {
            try {
                const raw = localStorage.getItem(WIDGET_LIBRARY_SELECTION_KEY);
                const parsed = raw ? JSON.parse(raw) : [];
                return normalizeWidgetVisibilityState(parsed);
            } catch (error) {
                console.warn("Failed to load widget library selection:", error);
                return [];
            }
        }

        function loadPendingAddSelectedWidgets() {
            try {
                const raw = localStorage.getItem(WIDGET_LIBRARY_PENDING_ADD_KEY);
                return raw ? Boolean(JSON.parse(raw)) : false;
            } catch (error) {
                console.warn("Failed to load pending widget library add state:", error);
                return false;
            }
        }

        function safeLocalStorageSet(key, value, warningMessage) {
            try {
                localStorage.setItem(key, JSON.stringify(value));
                return true;
            } catch (error) {
                console.warn(warningMessage, error);
                return false;
            }
        }

        function saveHiddenWidgetIds(hiddenWidgetIds) {
            const normalized = normalizeWidgetVisibilityState(hiddenWidgetIds);
            safeLocalStorageSet(
                WIDGET_VISIBILITY_STORAGE_KEY,
                normalized,
                "Failed to persist widget visibility:",
            );
            return normalized;
        }

        function saveSelectedWidgetIds(selectedWidgetIds) {
            const normalized = normalizeWidgetVisibilityState(selectedWidgetIds);
            try {
                localStorage.setItem(WIDGET_LIBRARY_SELECTION_KEY, JSON.stringify(normalized));
            } catch (error) {
                console.warn("Failed to persist widget library selection:", error);
            }
            return normalized;
        }

        function savePendingAddSelectedWidgets(isPending) {
            try {
                const normalized = Boolean(isPending);
                localStorage.setItem(WIDGET_LIBRARY_PENDING_ADD_KEY, JSON.stringify(normalized));
                return normalized;
            } catch (error) {
                console.warn("Failed to persist pending widget library add state:", error);
                return false;
            }
        }

        function clearPendingAddSelectedWidgets() {
            localStorage.removeItem(WIDGET_LIBRARY_PENDING_ADD_KEY);
        }

        function saveWidgetLayoutState(layout) {
            const normalized = dedupeWidgetLayoutState(normalizeWidgetLayoutState(layout));
            safeLocalStorageSet(
                WIDGET_LAYOUT_STORAGE_KEY,
                normalized,
                "Failed to persist widget layout:",
            );
            return normalized;
        }

        function saveWidgetSize(widgetId, size) {
            if (!widgetId) {
                return;
            }
            const sizes = loadWidgetSizes();
            const nextSizes = { ...sizes, [widgetId]: size };
            safeLocalStorageSet(
                WIDGET_SIZE_STORAGE_KEY,
                nextSizes,
                "Failed to persist widget sizes:",
            );
        }

        function saveWidgetSizes(updatedSizes) {
            if (!updatedSizes || typeof updatedSizes !== "object") {
                return loadWidgetSizes();
            }
            const sizes = loadWidgetSizes();
            const nextSizes = { ...sizes, ...updatedSizes };
            safeLocalStorageSet(
                WIDGET_SIZE_STORAGE_KEY,
                nextSizes,
                "Failed to persist widget sizes:",
            );
            return nextSizes;
        }

        function loadPendingWidgetLayoutSync() {
            try {
                const raw = localStorage.getItem(WIDGET_LAYOUT_PENDING_SYNC_KEY);
                if (!raw) {
                    return { hasPending: false, widgetLayout: {}, isFullLayout: false };
                }
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === "object" &&
                    Object.prototype.hasOwnProperty.call(parsed, "widgetLayout")) {
                    const normalized = dedupeWidgetLayoutState(normalizeWidgetLayoutState(parsed.widgetLayout));
                    const isFullLayout = Boolean(parsed.isFullLayout ?? parsed.fullLayout);
                    return { hasPending: true, widgetLayout: normalized, isFullLayout };
                }
                const normalized = dedupeWidgetLayoutState(normalizeWidgetLayoutState(parsed));
                return { hasPending: true, widgetLayout: normalized, isFullLayout: false };
            } catch (error) {
                console.warn("Failed to load pending widget layout updates:", error);
                return { hasPending: false, widgetLayout: {}, isFullLayout: false };
            }
        }

        function savePendingWidgetLayoutSync(widgetLayout, options) {
            const normalized = dedupeWidgetLayoutState(normalizeWidgetLayoutState(widgetLayout));
            const payload = {
                widgetLayout: normalized,
                isFullLayout: Boolean(options?.isFullLayout),
            };
            safeLocalStorageSet(
                WIDGET_LAYOUT_PENDING_SYNC_KEY,
                payload,
                "Failed to persist pending widget layout updates:",
            );
            return normalized;
        }

        function clearPendingWidgetLayoutSync() {
            localStorage.removeItem(WIDGET_LAYOUT_PENDING_SYNC_KEY);
        }

        function queueWidgetLayoutSync(widgetLayout, options) {
            if (!widgetLayout || typeof widgetLayout !== "object") {
                return;
            }
            const normalized = normalizeWidgetLayoutState(widgetLayout);
            if (Object.keys(normalized).length === 0) {
                return;
            }
            const forceFullLayout = Boolean(options?.fullLayout);
            const hasLiveSync = Boolean(wsConnection && wsConnection.readyState === WebSocket.OPEN);
            const shouldQueueFullLayout = forceFullLayout ||
                !hasLiveSync ||
                !widgetLayoutSyncState.hasServerSync ||
                !widgetLayoutSyncState.hasLayout;
            const layoutToQueue = shouldQueueFullLayout
                ? mergeWidgetLayoutUpdates(loadWidgetLayout(), normalized)
                : normalized;
            const pending = loadPendingWidgetLayoutSync();
            if (shouldQueueFullLayout) {
                savePendingWidgetLayoutSync(layoutToQueue, { isFullLayout: true });
                return;
            }
            if (pending.hasPending && pending.isFullLayout) {
                const merged = mergeWidgetLayoutUpdates(pending.widgetLayout, normalized);
                savePendingWidgetLayoutSync(merged, { isFullLayout: true });
                return;
            }
            const nextPending = pending.hasPending
                ? mergeWidgetLayoutUpdates(pending.widgetLayout, normalized)
                : normalized;
            savePendingWidgetLayoutSync(nextPending, { isFullLayout: false });
        }

        function areWidgetIdListsEqual(left, right) {
            if (!Array.isArray(left) || !Array.isArray(right)) {
                return false;
            }
            if (left.length !== right.length) {
                return false;
            }
            return left.every((value, index) => value === right[index]);
        }

        function reconcileWidgetLayoutPendingAfterHttp(widgetLayout, options) {
            if (!widgetLayout || typeof widgetLayout !== "object") {
                return;
            }
            const normalized = normalizeWidgetLayoutState(widgetLayout);
            if (Object.keys(normalized).length === 0) {
                return;
            }
            const pending = loadPendingWidgetLayoutSync();
            if (pending.hasPending) {
                if (options?.fullLayout) {
                    if (pending.isFullLayout) {
                        const pendingKeys = Object.keys(pending.widgetLayout);
                        const normalizedKeys = Object.keys(normalized);
                        const isExactMatch = pendingKeys.length === normalizedKeys.length &&
                            pendingKeys.every((containerId) =>
                                Object.prototype.hasOwnProperty.call(normalized, containerId) &&
                                areWidgetIdListsEqual(pending.widgetLayout[containerId], normalized[containerId]),
                            );
                        if (isExactMatch) {
                            clearPendingWidgetLayoutSync();
                        }
                    } else {
                        const remaining = Object.entries(pending.widgetLayout).reduce((acc, [containerId, widgetIds]) => {
                            if (Object.prototype.hasOwnProperty.call(normalized, containerId) &&
                                areWidgetIdListsEqual(widgetIds, normalized[containerId])) {
                                return acc;
                            }
                            return { ...acc, [containerId]: widgetIds };
                        }, {});
                        if (Object.keys(remaining).length === 0) {
                            clearPendingWidgetLayoutSync();
                        } else {
                            savePendingWidgetLayoutSync(remaining, { isFullLayout: false });
                        }
                    }
                } else if (!pending.isFullLayout) {
                    const remaining = Object.entries(pending.widgetLayout).reduce((acc, [containerId, widgetIds]) => {
                        if (Object.prototype.hasOwnProperty.call(normalized, containerId) &&
                            areWidgetIdListsEqual(widgetIds, normalized[containerId])) {
                            return acc;
                        }
                        return { ...acc, [containerId]: widgetIds };
                    }, {});
                    if (Object.keys(remaining).length === 0) {
                        clearPendingWidgetLayoutSync();
                    } else if (Object.keys(remaining).length !== Object.keys(pending.widgetLayout).length) {
                        savePendingWidgetLayoutSync(remaining, { isFullLayout: false });
                    }
                }
            }
            const hasLayout = widgetLayoutSyncState.hasLayout || Object.keys(normalized).length > 0;
            updateWidgetLayoutSyncState({ hasSynced: true, hasLayout, hasServerSync: true });
        }

        function flushPendingWidgetLayoutSync() {
            if (!wsConnection || wsConnection.readyState !== WebSocket.OPEN) {
                return;
            }
            const pending = loadPendingWidgetLayoutSync();
            if (!pending.hasPending) {
                return;
            }
            if (Object.keys(pending.widgetLayout).length > 0) {
                sendWidgetLayoutBatch(pending.widgetLayout, { fullLayout: pending.isFullLayout });
            }
        }

        function loadPendingWidgetVisibilitySync() {
            try {
                const raw = localStorage.getItem(WIDGET_VISIBILITY_PENDING_SYNC_KEY);
                if (!raw) {
                    return { hasPending: false, hiddenWidgetIds: [] };
                }
                const parsed = JSON.parse(raw);
                return { hasPending: true, hiddenWidgetIds: normalizeWidgetVisibilityState(parsed) };
            } catch (error) {
                console.warn("Failed to load pending widget visibility updates:", error);
                return { hasPending: false, hiddenWidgetIds: [] };
            }
        }

        function savePendingWidgetVisibilitySync(hiddenWidgetIds) {
            const normalized = normalizeWidgetVisibilityState(hiddenWidgetIds);
            safeLocalStorageSet(
                WIDGET_VISIBILITY_PENDING_SYNC_KEY,
                normalized,
                "Failed to persist pending widget visibility updates:",
            );
            return normalized;
        }

        function clearPendingWidgetVisibilitySync() {
            localStorage.removeItem(WIDGET_VISIBILITY_PENDING_SYNC_KEY);
        }

        function queueWidgetVisibilitySync(hiddenWidgetIds) {
            if (!Array.isArray(hiddenWidgetIds)) {
                return;
            }
            savePendingWidgetVisibilitySync(hiddenWidgetIds);
        }

        function reconcileWidgetVisibilityPendingAfterHttp(hiddenWidgetIds) {
            const normalized = normalizeWidgetVisibilityState(hiddenWidgetIds);
            const pending = loadPendingWidgetVisibilitySync();
            if (!pending.hasPending) {
                return;
            }
            const pendingIds = pending.hiddenWidgetIds;
            if (pendingIds.length !== normalized.length) {
                return;
            }
            const pendingSet = new Set(pendingIds);
            const isMatch = normalized.every(widgetId => pendingSet.has(widgetId));
            if (isMatch) {
                clearPendingWidgetVisibilitySync();
            }
        }

        function flushPendingWidgetVisibilitySync() {
            if (!wsConnection || wsConnection.readyState !== WebSocket.OPEN) {
                return;
            }
            const pending = loadPendingWidgetVisibilitySync();
            if (!pending.hasPending) {
                return;
            }
            wsConnection.send(JSON.stringify({
                type: "widget_visibility_update",
                data: { hiddenWidgetIds: pending.hiddenWidgetIds }
            }));
        }

        function sendWidgetSizeUpdate(widgetId, size) {
            if (!widgetId || !wsConnection || wsConnection.readyState !== WebSocket.OPEN) {
                return;
            }
            wsConnection.send(JSON.stringify({
                type: "widget_size_update",
                data: { widgetId, size }
            }));
        }

        function sendWidgetSizeBatch(widgetSizes) {
            if (!widgetSizes || !wsConnection || wsConnection.readyState !== WebSocket.OPEN) {
                return;
            }
            const entries = Object.entries(widgetSizes);
            if (entries.length === 0) {
                return;
            }
            wsConnection.send(JSON.stringify({
                type: "widget_size_update",
                data: { widgetSizes }
            }));
        }

        function postWidgetLayoutUpdate(widgetLayout, options) {
            if (!widgetLayout || typeof widgetLayout !== "object") {
                return Promise.resolve(false);
            }
            const fullLayout = Boolean(options?.fullLayout);
            const payload = fullLayout
                ? { widgetLayout, fullLayout: true }
                : { updates: widgetLayout };
            return fetch("/api/widgets/layout", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            })
                .then((response) => {
                    if (!response.ok) {
                        console.warn("Widget layout HTTP update failed:", response.status);
                        return false;
                    }
                    return true;
                })
                .catch((error) => {
                    console.warn("Widget layout HTTP update failed:", error);
                    return false;
                });
        }

        function postWidgetVisibilityUpdate(hiddenWidgetIds) {
            if (!Array.isArray(hiddenWidgetIds)) {
                return Promise.resolve(false);
            }
            return fetch("/api/widgets/visibility", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ hiddenWidgetIds }),
            })
                .then((response) => {
                    if (!response.ok) {
                        console.warn("Widget visibility HTTP update failed:", response.status);
                        return false;
                    }
                    return true;
                })
                .catch((error) => {
                    console.warn("Widget visibility HTTP update failed:", error);
                    return false;
                });
        }

        function sendWidgetLayoutUpdate(containerId, widgetIds) {
            if (!containerId) {
                return;
            }
            const updates = normalizeWidgetLayoutState({
                [containerId]: Array.isArray(widgetIds) ? widgetIds : [],
            });
            if (!wsConnection || wsConnection.readyState !== WebSocket.OPEN) {
                queueWidgetLayoutSync(updates, { fullLayout: false });
                void postWidgetLayoutUpdate(updates, { fullLayout: false }).then((success) => {
                    if (success) {
                        reconcileWidgetLayoutPendingAfterHttp(updates, { fullLayout: false });
                    }
                });
                return;
            }
            if (Object.keys(updates).length === 0) {
                return;
            }
            wsConnection.send(JSON.stringify({
                type: "widget_layout_update",
                data: { containerId, widgetIds }
            }));
        }

        function sendWidgetLayoutBatch(widgetLayout, options) {
            if (!widgetLayout || typeof widgetLayout !== "object") {
                return;
            }
            const normalized = normalizeWidgetLayoutState(widgetLayout);
            const entries = Object.entries(normalized);
            if (entries.length === 0) {
                return;
            }
            const fullLayout = Boolean(options?.fullLayout);
            if (!wsConnection || wsConnection.readyState !== WebSocket.OPEN) {
                queueWidgetLayoutSync(normalized, { fullLayout });
                void postWidgetLayoutUpdate(normalized, { fullLayout }).then((success) => {
                    if (success) {
                        reconcileWidgetLayoutPendingAfterHttp(normalized, { fullLayout });
                    }
                });
                return;
            }
            const data = fullLayout
                ? { widgetLayout: normalized, fullLayout: true }
                : { updates: normalized };
            wsConnection.send(JSON.stringify({
                type: "widget_layout_update",
                data
            }));
        }

        function requestWidgetLayoutSync() {
            if (!wsConnection || wsConnection.readyState !== WebSocket.OPEN) {
                return;
            }
            wsConnection.send(JSON.stringify({ type: "get_widget_layout" }));
        }

        function sendWidgetVisibilityUpdate(hiddenWidgetIds) {
            if (!Array.isArray(hiddenWidgetIds)) {
                return;
            }
            if (!wsConnection || wsConnection.readyState !== WebSocket.OPEN) {
                queueWidgetVisibilitySync(hiddenWidgetIds);
                void postWidgetVisibilityUpdate(hiddenWidgetIds).then((success) => {
                    if (success) {
                        reconcileWidgetVisibilityPendingAfterHttp(hiddenWidgetIds);
                    }
                });
                return;
            }
            wsConnection.send(JSON.stringify({
                type: "widget_visibility_update",
                data: { hiddenWidgetIds }
            }));
        }

        function saveWidgetLayout(containerId, widgetIds) {
            if (!containerId) {
                return;
            }
            const layout = loadWidgetLayout();
            const nextLayout = mergeWidgetLayoutUpdates(layout, {
                [containerId]: Array.isArray(widgetIds) ? widgetIds : [],
            });
            saveWidgetLayoutState(nextLayout);
        }

        function persistWidgetLayout(containerId, widgetIds, options) {
            if (!containerId) {
                return;
            }
            saveWidgetLayout(containerId, widgetIds);
            if (options?.broadcast) {
                sendWidgetLayoutUpdate(containerId, widgetIds);
            }
        }

        function persistWidgetVisibility(hiddenWidgetIds, options) {
            const normalized = saveHiddenWidgetIds(hiddenWidgetIds);
            if (options?.broadcast) {
                sendWidgetVisibilityUpdate(normalized);
            }
            return normalized;
        }

        function getWidgetContainers() {
            return Array.from(document.querySelectorAll("[data-widget-container]"));
        }

        function getWidgets(container) {
            return Array.from(container.querySelectorAll("[data-widget-id]"))
                .filter(widget => !widget.classList.contains("widget-hidden"));
        }

        function getWidgetsIncludingHidden(container) {
            return Array.from(container.querySelectorAll("[data-widget-id]"));
        }

        function getAllWidgetsIncludingHidden() {
            return Array.from(document.querySelectorAll("[data-widget-id]"));
        }

        function getAllWidgets() {
            return getWidgetContainers().reduce((widgets, container) => {
                return widgets.concat(getWidgets(container));
            }, []);
        }

        function getWidgetDisplayName(widget) {
            if (!(widget instanceof HTMLElement)) {
                return "Widget";
            }
            const explicitLabel = widget.dataset.widgetLabel;
            if (explicitLabel) {
                return explicitLabel;
            }
            const labelElement = widget.querySelector(".metric-label, .health-title");
            if (labelElement && labelElement.textContent) {
                return labelElement.textContent.trim();
            }
            const widgetId = widget.dataset.widgetId || "Widget";
            return widgetId
                .split("-")
                .map(word => word ? word[0].toUpperCase() + word.slice(1) : "")
                .join(" ");
        }

        function getWidgetContainerLabel(containerId) {
            if (!containerId) {
                return "Other";
            }
            return WIDGET_CONTAINER_LABELS[containerId] || "Other";
        }

        function sortWidgetCatalog(catalog) {
            const orderIndex = WIDGET_CONTAINER_ORDER.reduce((acc, id, index) => {
                return { ...acc, [id]: index };
            }, {});
            return [...catalog].sort((a, b) => {
                const aIndex = orderIndex[a.containerId] ?? Number.MAX_SAFE_INTEGER;
                const bIndex = orderIndex[b.containerId] ?? Number.MAX_SAFE_INTEGER;
                if (aIndex !== bIndex) {
                    return aIndex - bIndex;
                }
                return a.label.localeCompare(b.label);
            });
        }

        function collectWidgetCatalog() {
            const catalog = getAllWidgetsIncludingHidden().reduce((acc, widget) => {
                if (!(widget instanceof HTMLElement)) {
                    return acc;
                }
                const widgetId = widget.dataset.widgetId;
                if (!widgetId) {
                    return acc;
                }
                const container = widget.closest("[data-widget-container]");
                const containerId = container instanceof HTMLElement ? container.dataset.widgetContainer : undefined;
                const resolvedContainerId = containerId || "other";
                if (!widget.dataset.widgetHomeContainer) {
                    widget.dataset.widgetHomeContainer = resolvedContainerId;
                }
                const label = getWidgetDisplayName(widget);
                if (label && !widget.dataset.widgetLabel) {
                    widget.dataset.widgetLabel = label;
                }
                return acc.concat({
                    id: widgetId,
                    label,
                    containerId: resolvedContainerId,
                    containerLabel: getWidgetContainerLabel(resolvedContainerId),
                });
            }, []);
            widgetCatalog = sortWidgetCatalog(catalog);
        }

        function getWidgetById(widgetId) {
            return getAllWidgetsIncludingHidden().find(widget => widget.dataset.widgetId === widgetId);
        }

        function getWidgetHomeContainer(widget) {
            if (!(widget instanceof HTMLElement)) {
                return null;
            }
            const containerId = widget.dataset.widgetHomeContainer;
            if (!containerId) {
                const container = widget.closest("[data-widget-container]");
                return container instanceof HTMLElement ? container : null;
            }
            const container = document.querySelector("[data-widget-container=\"" + containerId + "\"]");
            return container instanceof HTMLElement ? container : null;
        }

        function getFallbackWidgetContainer() {
            const containers = getWidgetContainers();
            if (containers.length === 0) {
                return null;
            }
            return containers[0];
        }

        function syncWidgetHomeContainer(widget, containerId) {
            if (!(widget instanceof HTMLElement)) {
                return;
            }
            if (!containerId) {
                return;
            }
            widget.dataset.widgetHomeContainer = containerId;
        }

        function getWidgetContainerFromLayout(widgetId, layout) {
            if (!widgetId || !layout || typeof layout !== "object") {
                return null;
            }
            const match = Object.entries(layout).find(([, widgetIds]) => {
                return Array.isArray(widgetIds) && widgetIds.includes(widgetId);
            });
            if (!match) {
                return null;
            }
            const containerId = match[0];
            const container = document.querySelector("[data-widget-container=\"" + containerId + "\"]");
            return container instanceof HTMLElement ? container : null;
        }

        function resolveWidgetPlacementContainer(widgetId, widget, layout) {
            if (!widgetId || !(widget instanceof HTMLElement)) {
                return null;
            }
            const layoutContainer = getWidgetContainerFromLayout(widgetId, layout);
            if (layoutContainer instanceof HTMLElement) {
                return layoutContainer;
            }
            const currentContainer = widget.closest("[data-widget-container]");
            if (currentContainer instanceof HTMLElement) {
                return currentContainer;
            }
            const homeContainer = getWidgetHomeContainer(widget);
            if (homeContainer instanceof HTMLElement) {
                return homeContainer;
            }
            return getFallbackWidgetContainer();
        }

        function uniqueContainers(containers) {
            const filtered = containers.filter(container => container instanceof HTMLElement);
            return Array.from(new Set(filtered));
        }

        function setWidgetVisibility(widget, isVisible) {
            if (!(widget instanceof HTMLElement)) {
                return;
            }
            if (isVisible) {
                widget.classList.remove("widget-hidden");
                widget.removeAttribute("aria-hidden");
                widget.setAttribute("tabindex", "0");
                widget.setAttribute("draggable", "true");
            } else {
                widget.classList.add("widget-hidden");
                widget.setAttribute("aria-hidden", "true");
                widget.setAttribute("tabindex", "-1");
                widget.setAttribute("draggable", "false");
                widget.setAttribute("aria-grabbed", "false");
                widget.classList.remove("dragging", "drag-over");
            }
        }

        function applyWidgetVisibilityState(hiddenWidgetIdsOverride) {
            const resolvedHiddenWidgetIds = hiddenWidgetIdsOverride
                ? normalizeWidgetVisibilityState(hiddenWidgetIdsOverride)
                : loadHiddenWidgetIds();
            if (hiddenWidgetIdsOverride) {
                saveHiddenWidgetIds(resolvedHiddenWidgetIds);
            }
            const hiddenWidgetIds = new Set(resolvedHiddenWidgetIds);
            getAllWidgetsIncludingHidden().forEach(widget => {
                if (!(widget instanceof HTMLElement)) {
                    return;
                }
                const widgetId = widget.dataset.widgetId;
                if (!widgetId) {
                    return;
                }
                const isVisible = !hiddenWidgetIds.has(widgetId);
                setWidgetVisibility(widget, isVisible);
                if (isVisible) {
                    initializeWidget(widget);
                    initWidgetSizingForWidget(widget);
                }
            });
            if (hiddenWidgetIds.size > 0) {
                getWidgetContainers().forEach(container => saveWidgetLayoutForContainer(container));
            }
            pruneSelectedWidgetIds(resolvedHiddenWidgetIds);
            renderWidgetLibrary();
        }

        function toggleWidgetVisibility(widgetId, shouldShow) {
            if (!widgetId) {
                return;
            }
            const widget = getWidgetById(widgetId);
            if (!(widget instanceof HTMLElement)) {
                return;
            }
            const layout = loadWidgetLayout();
            const targetContainer = resolveWidgetPlacementContainer(widgetId, widget, layout);
            if (!(targetContainer instanceof HTMLElement)) {
                return;
            }
            const currentContainer = widget.closest("[data-widget-container]");
            const resolvedCurrentContainer = currentContainer instanceof HTMLElement ? currentContainer : null;
            setWidgetVisibility(widget, shouldShow);
            const hiddenWidgetIds = loadHiddenWidgetIds();
            const nextHiddenWidgetIds = shouldShow
                ? hiddenWidgetIds.filter(id => id !== widgetId)
                : Array.from(new Set(hiddenWidgetIds.concat(widgetId)));
            persistWidgetVisibility(nextHiddenWidgetIds, { broadcast: true });
            pruneSelectedWidgetIds(nextHiddenWidgetIds);

            if (shouldShow) {
                if (widget.parentElement !== targetContainer) {
                    targetContainer.appendChild(widget);
                }
                initializeWidget(widget);
                initWidgetSizingForWidget(widget);
            }
            const containersToUpdate = uniqueContainers([targetContainer, resolvedCurrentContainer]);
            const nextLayout = persistWidgetLayoutForContainers(containersToUpdate, { broadcast: true });
            containersToUpdate.forEach(container => applyWidgetOrderForContainer(container, nextLayout));
            renderWidgetLibrary();
        }

        function buildWidgetLayoutUpdatesForAddedWidgets(widgetTargets, layout) {
            const normalizedLayout = dedupeWidgetLayoutState(normalizeWidgetLayoutState(layout));
            const layoutAssignments = buildWidgetPlacementAssignments(normalizedLayout);
            const groupedTargets = widgetTargets.reduce((acc, target) => {
                const withTarget = acc[target.containerId]
                    ? acc
                    : { ...acc, [target.containerId]: { container: target.container } };
                const withSource = (!target.sourceContainerId || !target.sourceContainer || withTarget[target.sourceContainerId])
                    ? withTarget
                    : { ...withTarget, [target.sourceContainerId]: { container: target.sourceContainer } };
                const layoutContainerId = layoutAssignments[target.widgetId];
                if (!layoutContainerId ||
                    layoutContainerId === target.containerId ||
                    layoutContainerId === target.sourceContainerId ||
                    withSource[layoutContainerId]) {
                    return withSource;
                }
                const layoutContainer = document.querySelector(
                    "[data-widget-container=\"" + layoutContainerId + "\"]",
                );
                if (!(layoutContainer instanceof HTMLElement)) {
                    return withSource;
                }
                return { ...withSource, [layoutContainerId]: { container: layoutContainer } };
            }, {});

            const seededContainers = getWidgetContainers().reduce((acc, container) => {
                if (!(container instanceof HTMLElement)) {
                    return acc;
                }
                const containerId = container.dataset.widgetContainer;
                if (!containerId) {
                    return acc;
                }
                if (Object.prototype.hasOwnProperty.call(groupedTargets, containerId)) {
                    return acc;
                }
                if (Object.prototype.hasOwnProperty.call(normalizedLayout, containerId)) {
                    return acc;
                }
                return { ...acc, [containerId]: { container } };
            }, {});
            const nextGroupedTargets = { ...groupedTargets, ...seededContainers };

            const updates = Object.entries(nextGroupedTargets).reduce((acc, [containerId, group]) => {
                const containerWidgetIds = getWidgetsIncludingHidden(group.container)
                    .map(widget => widget.dataset.widgetId)
                    .filter(Boolean);
                const containerWidgetSet = new Set(containerWidgetIds);
                const baseOrder = Array.isArray(normalizedLayout[containerId])
                    ? normalizedLayout[containerId].filter(widgetId => containerWidgetSet.has(widgetId))
                    : [];
                const baseOrderSet = new Set(baseOrder);
                const nextOrder = baseOrder.concat(containerWidgetIds.filter(widgetId => !baseOrderSet.has(widgetId)));
                return { ...acc, [containerId]: nextOrder };
            }, {});

            const containers = Object.values(nextGroupedTargets).map(group => group.container);
            return { updates: normalizeWidgetLayoutState(updates), containers };
        }

        function persistWidgetLayoutUpdatesForAddedWidgets(widgetTargets, layout) {
            const normalizedLayout = dedupeWidgetLayoutState(normalizeWidgetLayoutState(layout));
            const layoutUpdates = buildWidgetLayoutUpdatesForAddedWidgets(widgetTargets, normalizedLayout);
            const containersToUpdate = uniqueContainers(layoutUpdates.containers);
            if (containersToUpdate.length === 0) {
                return { nextLayout: normalizedLayout, containersToUpdate: [] };
            }

            const hasUpdates = Object.keys(layoutUpdates.updates).length > 0;
            const nextLayout = hasUpdates
                ? saveWidgetLayoutState(mergeWidgetLayoutUpdates(normalizedLayout, layoutUpdates.updates))
                : persistWidgetLayoutForContainers(containersToUpdate, { broadcast: false });

            const broadcastUpdates = hasUpdates
                ? layoutUpdates.updates
                : normalizeWidgetLayoutState(buildWidgetLayoutForContainers(containersToUpdate));
            const shouldBroadcastFullLayout =
                !widgetLayoutSyncState.hasServerSync || !widgetLayoutSyncState.hasLayout;
            const broadcastPayload = shouldBroadcastFullLayout ? nextLayout : broadcastUpdates;
            if (Object.keys(broadcastPayload).length > 0) {
                sendWidgetLayoutBatch(broadcastPayload, { fullLayout: shouldBroadcastFullLayout });
            }

            return { nextLayout, containersToUpdate };
        }

        function addSelectedWidgetsToDashboard() {
            if (!isWidgetLayoutReady()) {
                if (!hasWidgetLayoutSyncConnection()) {
                    const seededLayout = seedWidgetLayoutIfEmpty();
                    updateWidgetLayoutSyncState({
                        hasSynced: true,
                        hasLayout: Object.keys(seededLayout).length > 0,
                        hasServerSync: false,
                    });
                } else {
                    pendingAddSelectedWidgets = selectedWidgetIds.size > 0;
                    if (pendingAddSelectedWidgets) {
                        savePendingAddSelectedWidgets(true);
                    } else {
                        clearPendingAddSelectedWidgets();
                    }
                    requestWidgetLayoutSync();
                    scheduleWidgetLayoutSyncFallback();
                    updateAddSelectedWidgetsState();
                    return;
                }
            }
            pendingAddSelectedWidgets = false;
            clearPendingAddSelectedWidgets();
            const hiddenWidgetIds = loadHiddenWidgetIds();
            const hiddenSet = new Set(hiddenWidgetIds);
            const seededLayout = seedWidgetLayoutIfEmpty();
            const layout = resolveWidgetLayoutForAdd(seededLayout);
            const selectedIds = getSelectedWidgetIdsInOrder(hiddenSet, layout);
            const currentSelectedIds = Array.from(selectedWidgetIds);
            const shouldUpdateSelection = selectedIds.length !== currentSelectedIds.length ||
                selectedIds.some((widgetId, index) => widgetId !== currentSelectedIds[index]);
            if (shouldUpdateSelection) {
                updateSelectedWidgetIds(selectedIds);
            }
            if (selectedIds.length === 0) {
                renderWidgetLibrary();
                return;
            }

            const widgetTargets = selectedIds.reduce((acc, widgetId) => {
                const widget = getWidgetById(widgetId);
                if (!(widget instanceof HTMLElement)) {
                    return acc;
                }
                const currentContainer = widget.closest("[data-widget-container]");
                const resolvedCurrentContainer = currentContainer instanceof HTMLElement ? currentContainer : null;
                const container = resolveWidgetPlacementContainer(widgetId, widget, layout) ||
                    resolvedCurrentContainer ||
                    getWidgetHomeContainer(widget);
                if (!(container instanceof HTMLElement)) {
                    return acc;
                }
                const containerId = container.dataset.widgetContainer;
                if (!containerId) {
                    return acc;
                }
                const sourceContainer = resolvedCurrentContainer;
                const sourceContainerId = sourceContainer?.dataset.widgetContainer || null;
                const isHidden = hiddenSet.has(widgetId) ||
                    widget.classList.contains("widget-hidden") ||
                    widget.getAttribute("aria-hidden") === "true";
                return acc.concat({
                    widgetId,
                    widget,
                    container,
                    containerId,
                    sourceContainer,
                    sourceContainerId,
                    shouldShow: isHidden,
                });
            }, []);

            if (widgetTargets.length === 0) {
                updateSelectedWidgetIds(selectedIds);
                renderWidgetLibrary();
                return;
            }

            widgetTargets.forEach(target => {
                if (target.widget.parentElement !== target.container) {
                    target.container.appendChild(target.widget);
                }
                syncWidgetHomeContainer(target.widget, target.containerId);
                initializeWidget(target.widget);
                initWidgetSizingForWidget(target.widget);
                if (target.shouldShow) {
                    setWidgetVisibility(target.widget, true);
                }
            });

            const widgetIdsToPersistSet = new Set(widgetTargets.map(target => target.widgetId));
            const nextHiddenWidgetIds = hiddenWidgetIds.filter(widgetId => !widgetIdsToPersistSet.has(widgetId));
            const layoutResult = persistWidgetLayoutUpdatesForAddedWidgets(widgetTargets, layout);
            const nextLayoutHasEntries = Object.keys(layoutResult.nextLayout).length > 0;
            // Broadcast layout updates before visibility so placement is ready when widgets appear.
            persistWidgetVisibility(nextHiddenWidgetIds, { broadcast: true });
            if (layoutResult.containersToUpdate.length > 0) {
                applyWidgetPlacement(layoutResult.nextLayout);
                applyWidgetOrderForContainers(layoutResult.containersToUpdate, layoutResult.nextLayout);
            }
            if (!widgetLayoutSyncState.hasLayout && nextLayoutHasEntries) {
                updateWidgetLayoutSyncState({ hasLayout: true });
            }
            if (!widgetLayoutSyncState.hasSynced && nextLayoutHasEntries) {
                updateWidgetLayoutSyncState({ hasSynced: true });
            }

            const remainingSelectedIds = selectedIds.filter(widgetId => !widgetIdsToPersistSet.has(widgetId));
            updateSelectedWidgetIds(remainingSelectedIds);
            renderWidgetLibrary();

            if (widgetIdsToPersistSet.size > 0) {
                showSuccess(
                    "Added " +
                        widgetIdsToPersistSet.size +
                        " widget" +
                        (widgetIdsToPersistSet.size === 1 ? "" : "s") +
                        " to the dashboard.",
                );
            }
            if (remainingSelectedIds.length > 0) {
                showWarning("Some selected widgets could not be added. Try refreshing the dashboard.");
            }
        }

        function renderWidgetLibrary() {
            const list = document.getElementById("widgetLibraryList");
            if (!(list instanceof HTMLElement)) {
                return;
            }
            collectWidgetCatalog();
            const hiddenWidgetIds = new Set(loadHiddenWidgetIds());
            const catalogIds = widgetCatalog.map(widget => widget.id);
            pruneSelectedWidgetIds(hiddenWidgetIds, catalogIds);
            const grouped = widgetCatalog.reduce((acc, widget) => {
                const containerId = widget.containerId || "other";
                const nextGroup = acc[containerId] ? acc[containerId].concat(widget) : [widget];
                return { ...acc, [containerId]: nextGroup };
            }, {});
            const orderedContainerIds = [
                ...WIDGET_CONTAINER_ORDER,
                ...Object.keys(grouped).filter(id => !WIDGET_CONTAINER_ORDER.includes(id)),
            ];

            list.innerHTML = "";

            if (Object.keys(grouped).length === 0) {
                const emptyState = document.createElement("div");
                emptyState.textContent = "No widgets available.";
                list.appendChild(emptyState);
                return;
            }

            orderedContainerIds.forEach(containerId => {
                const widgets = grouped[containerId];
                if (!widgets || widgets.length === 0) {
                    return;
                }

                const section = document.createElement("div");
                section.className = "widget-library-section";

                const title = document.createElement("div");
                title.className = "widget-library-section-title";
                title.textContent = getWidgetContainerLabel(containerId);
                section.appendChild(title);

                const sectionList = document.createElement("div");
                sectionList.className = "widget-library-list";

                widgets.forEach(widgetInfo => {
                    const isHidden = hiddenWidgetIds.has(widgetInfo.id);
                    const isSelected = selectedWidgetIds.has(widgetInfo.id);
                    const item = document.createElement("div");
                    item.className = "widget-library-item";
                    if (isSelected) {
                        item.classList.add("selected");
                    }

                    const info = document.createElement("div");
                    info.className = "widget-library-item-info";

                    const name = document.createElement("div");
                    name.className = "widget-library-item-name";
                    name.textContent = widgetInfo.label;
                    info.appendChild(name);

                    const meta = document.createElement("div");
                    meta.className = "widget-library-item-meta";
                    meta.textContent = widgetInfo.id;
                    info.appendChild(meta);

                    const actionWrap = document.createElement("div");
                    actionWrap.className = "widget-library-item-actions";

                    const selectWrap = document.createElement("label");
                    selectWrap.className = "widget-library-select";

                    const selectBox = document.createElement("input");
                    selectBox.type = "checkbox";
                    selectBox.checked = isSelected;
                    selectBox.disabled = !isHidden;
                    const resolveSelectLabel = (hidden, selected) => {
                        if (!hidden) {
                            return "On dashboard";
                        }
                        return selected ? "Selected" : "Select";
                    };
                    const selectLabel = document.createElement("span");
                    selectLabel.textContent = resolveSelectLabel(isHidden, isSelected);
                    selectBox.addEventListener("change", event => {
                        const target = event.target;
                        if (!(target instanceof HTMLInputElement)) {
                            return;
                        }
                        toggleWidgetSelection(widgetInfo.id, target.checked);
                        selectLabel.textContent = resolveSelectLabel(isHidden, target.checked);
                        if (target.checked) {
                            item.classList.add("selected");
                        } else {
                            item.classList.remove("selected");
                        }
                    });

                    selectWrap.appendChild(selectBox);
                    selectWrap.appendChild(selectLabel);

                    const toggleWrap = document.createElement("label");
                    toggleWrap.className = "widget-library-toggle";

                    const checkbox = document.createElement("input");
                    checkbox.type = "checkbox";
                    checkbox.checked = !isHidden;
                    checkbox.addEventListener("change", event => {
                        const target = event.target;
                        if (!(target instanceof HTMLInputElement)) {
                            return;
                        }
                        toggleWidgetVisibility(widgetInfo.id, target.checked);
                    });

                    const toggleLabel = document.createElement("span");
                    toggleLabel.textContent = checkbox.checked ? "Visible" : "Hidden";

                    checkbox.addEventListener("change", () => {
                        toggleLabel.textContent = checkbox.checked ? "Visible" : "Hidden";
                    });

                    toggleWrap.appendChild(checkbox);
                    toggleWrap.appendChild(toggleLabel);

                    actionWrap.appendChild(selectWrap);
                    actionWrap.appendChild(toggleWrap);

                    item.appendChild(info);
                    item.appendChild(actionWrap);
                    sectionList.appendChild(item);
                });

                section.appendChild(sectionList);
                list.appendChild(section);
            });
        }

        function showAllWidgets() {
            const allWidgets = getAllWidgetsIncludingHidden();
            allWidgets.forEach(widget => {
                setWidgetVisibility(widget, true);
                initializeWidget(widget);
                initWidgetSizingForWidget(widget);
            });
            persistWidgetVisibility([], { broadcast: true });
            getWidgetContainers().forEach(container => saveWidgetLayoutForContainer(container, { broadcast: true }));
            updateSelectedWidgetIds([]);
            renderWidgetLibrary();
        }

        function hideAllWidgets() {
            const allWidgets = getAllWidgetsIncludingHidden();
            const hiddenWidgetIds = allWidgets
                .map(widget => widget.dataset.widgetId)
                .filter(Boolean);
            allWidgets.forEach(widget => setWidgetVisibility(widget, false));
            persistWidgetVisibility(hiddenWidgetIds, { broadcast: true });
            getWidgetContainers().forEach(container => saveWidgetLayoutForContainer(container, { broadcast: true }));
            updateSelectedWidgetIds([]);
            renderWidgetLibrary();
        }

        function normalizeWidgetSize(size) {
            return WIDGET_SIZE_OPTIONS.includes(size) ? size : "medium";
        }

        function applyWidgetSizeState(widgetSizes) {
            if (!widgetSizes || typeof widgetSizes !== "object") {
                return;
            }
            const normalizedSizes = Object.entries(widgetSizes).reduce((acc, [widgetId, size]) => {
                if (!widgetId) {
                    return acc;
                }
                return { ...acc, [widgetId]: normalizeWidgetSize(size) };
            }, {});
            if (Object.keys(normalizedSizes).length === 0) {
                return;
            }
            saveWidgetSizes(normalizedSizes);
            const widgetMap = new Map(getAllWidgets().map(widget => [widget.dataset.widgetId, widget]));
            Object.entries(normalizedSizes).forEach(([widgetId, size]) => {
                const widget = widgetMap.get(widgetId);
                if (widget) {
                    applyWidgetSize(widget, size);
                }
            });
        }

        function handleWidgetSizeSync(messageData) {
            const widgetSizes =
                messageData?.widgetSizes ||
                messageData?.updates ||
                messageData?.sizes ||
                messageData;
            const hasServerSizes = widgetSizes && Object.keys(widgetSizes).length > 0;
            if (hasServerSizes) {
                applyWidgetSizeState(widgetSizes);
                return;
            }
            const localSizes = loadWidgetSizes();
            if (Object.keys(localSizes).length > 0) {
                sendWidgetSizeBatch(localSizes);
            }
        }

        function getWidgetLayoutPayload(messageData) {
            if (!messageData || typeof messageData !== "object") {
                return { hasValue: false, widgetLayout: undefined };
            }
            if (Object.prototype.hasOwnProperty.call(messageData, "widgetLayout")) {
                return { hasValue: true, widgetLayout: messageData.widgetLayout };
            }
            if (Object.prototype.hasOwnProperty.call(messageData, "layout")) {
                return { hasValue: true, widgetLayout: messageData.layout };
            }
            const nested = messageData.data;
            if (nested && typeof nested === "object") {
                if (Object.prototype.hasOwnProperty.call(nested, "widgetLayout")) {
                    return { hasValue: true, widgetLayout: nested.widgetLayout };
                }
                if (Object.prototype.hasOwnProperty.call(nested, "layout")) {
                    return { hasValue: true, widgetLayout: nested.layout };
                }
            }
            return { hasValue: false, widgetLayout: undefined };
        }

        function applyWidgetLayoutState(widgetLayout) {
            if (!widgetLayout || typeof widgetLayout !== "object") {
                return;
            }
            saveWidgetLayoutState(widgetLayout);
            applyWidgetOrder();
            renderWidgetLibrary();
        }

        function handleWidgetLayoutSync(messageData) {
            const pendingLayout = loadPendingWidgetLayoutSync();
            const mergePendingLayout = layout => {
                if (!pendingLayout.hasPending) {
                    return layout;
                }
                clearPendingWidgetLayoutSync();
                if (pendingLayout.isFullLayout) {
                    return pendingLayout.widgetLayout;
                }
                return mergeWidgetLayoutUpdates(layout, pendingLayout.widgetLayout);
            };
            const layoutPayload = getWidgetLayoutPayload(messageData);
            if (layoutPayload.hasValue) {
                if (layoutPayload.widgetLayout && typeof layoutPayload.widgetLayout === "object") {
                    const resolvedLayout = mergePendingLayout(layoutPayload.widgetLayout);
                    updateWidgetLayoutSyncState({
                        hasSynced: true,
                        hasLayout: Object.keys(resolvedLayout).length > 0,
                        hasServerSync: true,
                    });
                    applyWidgetLayoutState(resolvedLayout);
                    triggerPendingAddSelectedWidgets();
                    return;
                }
                if (layoutPayload.widgetLayout === null) {
                    updateWidgetLayoutSyncState({ hasSynced: true, hasLayout: false, hasServerSync: true });
                }
            }
            const updates =
                messageData?.updates ||
                messageData?.data?.updates;
            if (updates && typeof updates === "object") {
                const currentLayout = loadWidgetLayout();
                const nextLayout = mergeWidgetLayoutUpdates(currentLayout, updates);
                const resolvedLayout = mergePendingLayout(nextLayout);
                updateWidgetLayoutSyncState({
                    hasSynced: true,
                    hasLayout: Object.keys(resolvedLayout).length > 0,
                    hasServerSync: true,
                });
                applyWidgetLayoutState(resolvedLayout);
                triggerPendingAddSelectedWidgets();
                return;
            }
            const localLayout = loadWidgetLayout();
            const resolvedLayout = mergePendingLayout(localLayout);
            if (Object.keys(resolvedLayout).length > 0) {
                sendWidgetLayoutBatch(resolvedLayout, { fullLayout: true });
            } else if (layoutPayload.hasValue && layoutPayload.widgetLayout === null) {
                updateAddSelectedWidgetsState();
            }
            triggerPendingAddSelectedWidgets();
        }

        function handleWidgetVisibilitySync(messageData) {
            const pendingVisibility = loadPendingWidgetVisibilitySync();
            const resolveHiddenWidgetIds = hiddenWidgetIds => {
                if (!pendingVisibility.hasPending) {
                    return hiddenWidgetIds;
                }
                clearPendingWidgetVisibilitySync();
                return pendingVisibility.hiddenWidgetIds;
            };
            const directHidden = messageData?.hiddenWidgetIds;
            if (Array.isArray(directHidden)) {
                applyWidgetVisibilityState(resolveHiddenWidgetIds(directHidden));
                renderWidgetLibrary();
                return;
            }
            const nestedHidden = messageData?.data?.hiddenWidgetIds;
            if (Array.isArray(nestedHidden)) {
                applyWidgetVisibilityState(resolveHiddenWidgetIds(nestedHidden));
                renderWidgetLibrary();
                return;
            }
            if (Array.isArray(messageData)) {
                applyWidgetVisibilityState(resolveHiddenWidgetIds(messageData));
                renderWidgetLibrary();
                return;
            }
            const localHiddenWidgetIds = loadHiddenWidgetIds();
            const resolvedHiddenWidgetIds = resolveHiddenWidgetIds(localHiddenWidgetIds);
            if (resolvedHiddenWidgetIds.length > 0) {
                sendWidgetVisibilityUpdate(resolvedHiddenWidgetIds);
            }
        }

        function applyWidgetSize(widget, size) {
            const normalized = normalizeWidgetSize(size);
            widget.dataset.widgetSize = normalized;
            widget.classList.remove(...WIDGET_SIZE_CLASSES);
            widget.classList.add(\`widget-size-\${normalized}\`);
            updateWidgetSizeControls(widget, normalized);
        }

        function updateWidgetSizeControls(widget, size) {
            const controls = widget.querySelector(".widget-size-controls");
            if (!(controls instanceof HTMLElement)) {
                return;
            }
            const buttons = Array.from(controls.querySelectorAll(".widget-size-btn"));
            buttons.forEach(button => {
                if (!(button instanceof HTMLButtonElement)) {
                    return;
                }
                const isActive = button.dataset.widgetSize === size;
                button.setAttribute("aria-pressed", isActive ? "true" : "false");
            });
        }

        function createWidgetSizeControls(currentSize) {
            const controls = document.createElement("div");
            controls.className = "widget-size-controls";
            controls.setAttribute("role", "group");
            controls.setAttribute("aria-label", "Widget size");

            WIDGET_SIZE_OPTIONS.forEach(size => {
                const button = document.createElement("button");
                button.type = "button";
                button.className = "widget-size-btn";
                button.dataset.widgetSize = size;
                button.textContent = size.charAt(0).toUpperCase();
                button.setAttribute("aria-label", \`\${size} size\`);
                button.setAttribute("aria-pressed", size === currentSize ? "true" : "false");
                controls.appendChild(button);
            });

            return controls;
        }

        function applyWidgetOrderForContainer(container, layout) {
            container.classList.add("widget-container");
            const containerId = container.dataset.widgetContainer;
            const savedOrder = containerId ? layout[containerId] : null;
            if (!Array.isArray(savedOrder) || savedOrder.length === 0) {
                return;
            }

            const widgets = getWidgetsIncludingHidden(container);
            const widgetMap = new Map(widgets.map(widget => [widget.dataset.widgetId, widget]));
            const savedOrderSet = new Set(savedOrder);
            const orderedWidgets = savedOrder.map(id => widgetMap.get(id)).filter(Boolean);
            const remainingWidgets = widgets.filter(widget => !savedOrderSet.has(widget.dataset.widgetId));
            const fragment = document.createDocumentFragment();

            orderedWidgets.concat(remainingWidgets).forEach(widget => fragment.appendChild(widget));
            container.appendChild(fragment);
        }

        function applyWidgetOrderForContainers(containers, layout) {
            if (!Array.isArray(containers) || !layout || typeof layout !== "object") {
                return;
            }
            uniqueContainers(containers).forEach(container => {
                applyWidgetOrderForContainer(container, layout);
            });
        }

        function getLayoutContainerOrder(layout) {
            const layoutContainerIds = Object.keys(layout);
            return WIDGET_CONTAINER_ORDER
                .filter(containerId => layoutContainerIds.includes(containerId))
                .concat(layoutContainerIds.filter(containerId => !WIDGET_CONTAINER_ORDER.includes(containerId)));
        }

        function buildWidgetPlacementAssignments(layout) {
            if (!layout || typeof layout !== "object") {
                return {};
            }
            const orderedContainerIds = getLayoutContainerOrder(layout);
            return orderedContainerIds.reduce((acc, containerId) => {
                const widgetIds = Array.isArray(layout[containerId]) ? layout[containerId] : [];
                return widgetIds.reduce((innerAcc, widgetId) => {
                    if (!widgetId) {
                        return innerAcc;
                    }
                    if (Object.prototype.hasOwnProperty.call(innerAcc, widgetId)) {
                        return innerAcc;
                    }
                    return { ...innerAcc, [widgetId]: containerId };
                }, acc);
            }, {});
        }

        function applyWidgetPlacement(layout) {
            if (!layout || typeof layout !== "object") {
                return;
            }
            const assignments = buildWidgetPlacementAssignments(layout);
            const containersById = getWidgetContainers().reduce((acc, container) => {
                const containerId = container.dataset.widgetContainer;
                if (!containerId) {
                    return acc;
                }
                return { ...acc, [containerId]: container };
            }, {});
            Object.entries(assignments).forEach(([widgetId, containerId]) => {
                const container = containersById[containerId];
                if (!(container instanceof HTMLElement)) {
                    return;
                }
                const widget = getWidgetById(widgetId);
                if (!(widget instanceof HTMLElement)) {
                    return;
                }
                if (widget.parentElement !== container) {
                    container.appendChild(widget);
                }
                syncWidgetHomeContainer(widget, containerId);
            });
        }

        function applyWidgetOrder() {
            const layout = loadWidgetLayout();
            applyWidgetPlacement(layout);
            getWidgetContainers().forEach(container => applyWidgetOrderForContainer(container, layout));
        }

        function initializeWidget(widget) {
            if (!(widget instanceof HTMLElement)) {
                return;
            }
            if (widget.dataset.widgetInitialized === "true") {
                return;
            }
            widget.dataset.widgetInitialized = "true";
            widget.classList.add("widget-card");
            widget.setAttribute("draggable", "true");
            widget.setAttribute("tabindex", "0");
            widget.setAttribute("aria-grabbed", "false");
            widget.addEventListener("dragstart", handleWidgetDragStart);
            widget.addEventListener("dragend", handleWidgetDragEnd);
        }

        function initWidgetSizingForWidget(widget, sizesOverride) {
            if (!(widget instanceof HTMLElement)) {
                return;
            }
            const widgetId = widget.dataset.widgetId;
            if (!widgetId) {
                return;
            }
            const sizes = sizesOverride || loadWidgetSizes();
            const storedSize = normalizeWidgetSize(sizes[widgetId]);
            const existingControls = widget.querySelector(".widget-size-controls");
            if (!(existingControls instanceof HTMLElement)) {
                const controls = createWidgetSizeControls(storedSize);
                widget.insertBefore(controls, widget.firstChild);
                controls.addEventListener("click", event => {
                    const target = event.target;
                    if (!(target instanceof HTMLButtonElement)) {
                        return;
                    }
                    const nextSize = normalizeWidgetSize(target.dataset.widgetSize);
                    applyWidgetSize(widget, nextSize);
                    saveWidgetSize(widgetId, nextSize);
                    sendWidgetSizeUpdate(widgetId, nextSize);
                });
            }
            applyWidgetSize(widget, storedSize);
        }

        function initWidgetDragAndDrop() {
            getWidgetContainers().forEach(container => {
                container.classList.add("widget-container");
                const widgets = getWidgets(container);

                widgets.forEach(widget => initializeWidget(widget));

                if (container.dataset.widgetDragReady !== "true") {
                    container.dataset.widgetDragReady = "true";
                    container.addEventListener("dragover", handleWidgetDragOver);
                    container.addEventListener("drop", handleWidgetDrop);
                    container.addEventListener("dragleave", handleWidgetDragLeave);
                }
            });
        }

        function initWidgetSizing() {
            const sizes = loadWidgetSizes();
            getAllWidgets().forEach(widget => initWidgetSizingForWidget(widget, sizes));
        }

        function shouldIgnoreWidgetDrag(event) {
            const target = event.target;
            if (!(target instanceof HTMLElement)) {
                return false;
            }
            return Boolean(target.closest("button, a, input, select, textarea, label"));
        }

        function handleWidgetDragStart(event) {
            if (shouldIgnoreWidgetDrag(event)) {
                event.preventDefault();
                return;
            }

            const widget = event.currentTarget;
            if (!(widget instanceof HTMLElement)) {
                return;
            }

            const container = widget.closest("[data-widget-container]");
            if (!(container instanceof HTMLElement)) {
                return;
            }

            updateWidgetDragState({ dragging: widget, container });
            widget.classList.add("dragging");
            widget.setAttribute("aria-grabbed", "true");
            container.classList.add("drag-active");

            const ghost = createWidgetGhost(widget);
            if (event.dataTransfer) {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", widget.dataset.widgetId || "");
                event.dataTransfer.setDragImage(ghost, ghost.offsetWidth / 2, ghost.offsetHeight / 2);
            }

            window.requestAnimationFrame(() => {
                if (ghost.parentNode) {
                    ghost.parentNode.removeChild(ghost);
                }
            });
        }

        function handleWidgetDragOver(event) {
            if (!widgetDragState.dragging) {
                return;
            }

            const container = event.currentTarget;
            if (!(container instanceof HTMLElement) || container !== widgetDragState.container) {
                return;
            }

            event.preventDefault();
            if (event.dataTransfer) {
                event.dataTransfer.dropEffect = "move";
            }

            const placeholder = ensureWidgetPlaceholder(widgetDragState.dragging);
            const reference = getWidgetDropReference(container, event.clientX, event.clientY);

            clearWidgetDragOver(container);
            if (reference?.element) {
                reference.element.classList.add("drag-over");
                if (reference.before) {
                    container.insertBefore(placeholder, reference.element);
                } else {
                    container.insertBefore(placeholder, reference.element.nextSibling);
                }
            } else {
                container.appendChild(placeholder);
            }
        }

        function handleWidgetDrop(event) {
            if (!widgetDragState.dragging) {
                return;
            }

            const container = event.currentTarget;
            if (!(container instanceof HTMLElement) || container !== widgetDragState.container) {
                return;
            }

            event.preventDefault();

            const placeholder = widgetDragState.placeholder;
            if (placeholder && placeholder.parentNode === container) {
                container.insertBefore(widgetDragState.dragging, placeholder);
            }

            finalizeWidgetDrag(container);
            saveWidgetLayoutForContainer(container, { broadcast: true });
        }

        function handleWidgetDragLeave(event) {
            if (!widgetDragState.dragging) {
                return;
            }

            const container = event.currentTarget;
            if (!(container instanceof HTMLElement) || container !== widgetDragState.container) {
                return;
            }

            if (event.relatedTarget && container.contains(event.relatedTarget)) {
                return;
            }

            clearWidgetDragOver(container);
        }

        function handleWidgetDragEnd() {
            if (!widgetDragState.dragging) {
                return;
            }

            const container = widgetDragState.container;
            if (container instanceof HTMLElement) {
                finalizeWidgetDrag(container);
                saveWidgetLayoutForContainer(container, { broadcast: true });
            }
        }

        function finalizeWidgetDrag(container) {
            clearWidgetDragOver(container);
            const placeholder = widgetDragState.placeholder;
            if (placeholder && placeholder.parentNode) {
                placeholder.parentNode.removeChild(placeholder);
            }
            if (widgetDragState.dragging) {
                widgetDragState.dragging.classList.remove("dragging");
                widgetDragState.dragging.setAttribute("aria-grabbed", "false");
            }
            container.classList.remove("drag-active");
            updateWidgetDragState({ dragging: null, placeholder: null, container: null });
        }

        function createWidgetGhost(widget) {
            const ghost = widget.cloneNode(true);
            ghost.classList.add("widget-ghost");
            ghost.style.width = \`\${widget.offsetWidth}px\`;
            ghost.style.height = \`\${widget.offsetHeight}px\`;
            document.body.appendChild(ghost);
            return ghost;
        }

        function ensureWidgetPlaceholder(widget) {
            if (widgetDragState.placeholder) {
                return widgetDragState.placeholder;
            }
            const placeholder = document.createElement("div");
            placeholder.className = "widget-drop-indicator";
            placeholder.style.width = \`\${widget.offsetWidth}px\`;
            placeholder.style.height = \`\${widget.offsetHeight}px\`;
            updateWidgetDragState({ placeholder });
            return placeholder;
        }

        function getWidgetDropReference(container, x, y) {
            const widgets = getWidgets(container).filter(widget => widget !== widgetDragState.dragging);
            if (widgets.length === 0) {
                return null;
            }

            const closest = widgets
                .map(widget => {
                    const rect = widget.getBoundingClientRect();
                    const centerX = rect.left + rect.width / 2;
                    const centerY = rect.top + rect.height / 2;
                    const distance = Math.hypot(x - centerX, y - centerY);
                    return { widget, rect, distance };
                })
                .sort((a, b) => a.distance - b.distance)[0];

            if (!closest) {
                return null;
            }

            const before = y < closest.rect.top + closest.rect.height / 2 ||
                (Math.abs(y - (closest.rect.top + closest.rect.height / 2)) < closest.rect.height * 0.25 &&
                    x < closest.rect.left + closest.rect.width / 2);

            return { element: closest.widget, before };
        }

        function clearWidgetDragOver(container) {
            getWidgets(container).forEach(widget => widget.classList.remove("drag-over"));
        }

        function saveWidgetLayoutForContainer(container, options) {
            const containerId = container.dataset.widgetContainer;
            if (!containerId) {
                return;
            }

            const widgetIds = getWidgetsIncludingHidden(container)
                .map(widget => widget.dataset.widgetId)
                .filter(Boolean);

            persistWidgetLayout(containerId, widgetIds, options);
        }

        function buildWidgetLayoutForContainers(containers) {
            return containers.reduce((acc, container) => {
                if (!(container instanceof HTMLElement)) {
                    return acc;
                }
                const containerId = container.dataset.widgetContainer;
                if (!containerId) {
                    return acc;
                }
                const widgetIds = getWidgetsIncludingHidden(container)
                    .map(widget => widget.dataset.widgetId)
                    .filter(Boolean);
                return { ...acc, [containerId]: widgetIds };
            }, {});
        }

        function persistWidgetLayoutForContainers(containers, options) {
            const updates = normalizeWidgetLayoutState(buildWidgetLayoutForContainers(containers));
            if (Object.keys(updates).length === 0) {
                return loadWidgetLayout();
            }
            const layout = loadWidgetLayout();
            const nextLayout = mergeWidgetLayoutUpdates(layout, updates);
            saveWidgetLayoutState(nextLayout);
            if (options?.broadcast) {
                sendWidgetLayoutBatch(updates);
            }
            return nextLayout;
        }

        // Event Listeners
        document.addEventListener("DOMContentLoaded", () => {
            hydrateWidgetStateFromServer();
            initTabs();
            collectWidgetCatalog();
            applyWidgetVisibilityState();
            updateSelectedWidgetIds(loadSelectedWidgetIds());
            pruneSelectedWidgetIds(loadHiddenWidgetIds());
            const hasPendingAdd = loadPendingAddSelectedWidgets();
            if (hasPendingAdd && selectedWidgetIds.size > 0) {
                pendingAddSelectedWidgets = true;
                if (shouldGateAddSelectedWidgets()) {
                    requestWidgetLayoutSync();
                    scheduleWidgetLayoutSyncFallback();
                } else {
                    triggerPendingAddSelectedWidgets();
                }
            } else if (hasPendingAdd) {
                clearPendingAddSelectedWidgets();
            }
            updateAddSelectedWidgetsState();
            applyWidgetOrder();
            initWidgetDragAndDrop();
            initWidgetSizing();
            renderWidgetLibrary();

            const addSelectedWidgetsBtn = document.getElementById("addSelectedWidgetsBtn");
            if (addSelectedWidgetsBtn instanceof HTMLButtonElement) {
                addSelectedWidgetsBtn.addEventListener("click", addSelectedWidgetsToDashboard);
            }
            const showAllWidgetsBtn = document.getElementById("showAllWidgetsBtn");
            if (showAllWidgetsBtn instanceof HTMLButtonElement) {
                showAllWidgetsBtn.addEventListener("click", showAllWidgets);
            }
            const hideAllWidgetsBtn = document.getElementById("hideAllWidgetsBtn");
            if (hideAllWidgetsBtn instanceof HTMLButtonElement) {
                hideAllWidgetsBtn.addEventListener("click", hideAllWidgets);
            }
            
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
