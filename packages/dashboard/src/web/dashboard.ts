// FILE_CONTEXT: "context-aad67ced-4b88-4ccc-b48b-6ac0bd11531c"

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
import { LevelKeyValueAdapter } from "@isomorphiq/persistence-level";
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
type WidgetLayoutRecord = {
    version: number;
    layout: WidgetLayoutState;
};
type WidgetVisibilityState = string[];
type WidgetVisibilityUpdate =
    | { hiddenWidgetIds: WidgetVisibilityState }
    | { widgetId: string; hidden: boolean };
type DashboardWidgetState = {
    widgetLayout: WidgetLayoutState | null;
    hiddenWidgetIds: WidgetVisibilityState | null;
    widgetSizes: WidgetSizeState | null;
};
type ViewportBreakpoint = "mobile" | "tablet" | "desktop";
type ViewportState = {
    width: number;
    breakpoint: ViewportBreakpoint;
    gridColumns: number;
};
type JsonParseResult = { success: true; data: unknown } | { success: false; error: Error };
const WIDGET_LAYOUT_RECORD_VERSION = 1;
const WIDGET_CONTAINER_ORDER = ["overview-metrics", "queue-metrics", "health-grid"];

const isJsonParseError = (result: JsonParseResult): result is { success: false; error: Error } => {
    return result.success === false;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value);

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
	// Add widget to dashboard with validation and persistence
	public async addWidgetToDashboard(
		widgetId: string,
		options?: { container?: string; size?: WidgetSize; position?: { x: number; y: number } },
	): Promise<{ success: true; layout: WidgetLayoutState } | { success: false; error: string }> {
		try {
			await this.ensureWidgetLayoutPreferencesLoaded();

			const currentLayout = this.getWidgetLayoutForEnvironment(this.defaultEnvironment);
			const widgetSize = options?.size ?? "medium";
			const containerId = options?.container ?? WIDGET_CONTAINER_ORDER[0];
			const position = options?.position ?? { x: 0, y: 0 };

			if (!WIDGET_CONTAINER_ORDER.includes(containerId)) {
				return { success: false, error: `Invalid container: ${containerId}` };
			}

			if (widgetSize !== "small" && widgetSize !== "medium" && widgetSize !== "large") {
				return { success: false, error: `Invalid size: ${widgetSize}` };
			}

			const newWidgetInstanceId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
				? crypto.randomUUID()
				: `widget_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;

			const newWidgetPlacement = {
				id: newWidgetInstanceId,
				widgetId,
				x: position.x,
				y: position.y,
				w: widgetSize === "small" ? 3 : widgetSize === "medium" ? 6 : 9,
				h: 4,
			};

			const nextLayout = this.updateWidgetLayoutForEnvironment(
				this.defaultEnvironment,
				{ [containerId]: [...(currentLayout[containerId] ?? []), newWidgetPlacement.id] },
			);

			return { success: true, layout: nextLayout };
		} catch (error) {
			console.error("[DASHBOARD] Failed to add widget:", error);
			return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
		}
	}

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
    private widgetLayoutLegacyStoragePath: string = path.join(process.cwd(), "db", "dashboard-widget-layout.json");
    private widgetLayoutStorePath: string = path.join(process.cwd(), "db", "dashboard-widget-layout");
private widgetLayoutStore: LevelKeyValueAdapter<string, WidgetLayoutRecord>;
private widgetLayoutStoreOpenPromise: Promise<void> | null = null;
private widgetLayoutLoadPromise: Promise<void> | null = null;
private widgetLayoutPersistPromise: Promise<void> = Promise.resolve();
private widgetLayoutStoreKeyPrefix = "layout:";
private viewportState: ViewportState;
private resizeDebounceTimer: NodeJS.Timeout | null = null;
private viewportChangeListeners: Set<(state: ViewportState) => void> = new Set();
    private widgetVisibilityPreferencesByEnvironment: Map<string, WidgetVisibilityState> = new Map();
    private widgetVisibilityStoragePath: string = path.join(process.cwd(), "db", "dashboard-widget-visibility.json");
    private widgetVisibilityLoadPromise: Promise<void> | null = null;
    private widgetVisibilityPersistPromise: Promise<void> = Promise.resolve();

    private redistributeWidgetPositions(newState: ViewportState): WidgetLayoutState {
        const currentLayout = this.getWidgetLayoutForEnvironment(this.defaultEnvironment);
        const containerIds = Object.keys(currentLayout);
        if (containerIds.length === 0) return currentLayout;

        const maxColumnWidth = newState.gridColumns;
        const redistributedLayout: WidgetLayoutState = {};

        containerIds.forEach((containerId) => {
            const widgetIds = currentLayout[containerId];
            if (!Array.isArray(widgetIds)) return;

            const widgetCount = widgetIds.length;
            const optimalWidgetsPerRow = Math.floor(maxColumnWidth / 3);
            const rowsNeeded = Math.ceil(widgetCount / optimalWidgetsPerRow);

            redistributedLayout[containerId] = [];

            for (let row = 0; row < rowsNeeded; row += 1) {
                const startIdx = row * optimalWidgetsPerRow;
                const endIdx = Math.min(startIdx + optimalWidgetsPerRow, widgetCount);
                const rowWidgetIds = widgetIds.slice(startIdx, endIdx);

                redistributedLayout[containerId] = [...redistributedLayout[containerId], ...rowWidgetIds];
            }
        });

        return redistributedLayout;
    }

    private onViewportChange(newState: ViewportState): void {
        console.log("[DASHBOARD]Viewport change detected: breakpoint={newState.breakpoint}, columns={newState.gridColumns}");
        const newLayout = this.redistributeWidgetPositions(newState);
        if (Object.keys(newLayout).length > 0 && JSON.stringify(newLayout) !== JSON.stringify(this.getWidgetLayoutForEnvironment(this.defaultEnvironment))) {
            this.updateWidgetLayoutForEnvironment(this.defaultEnvironment, newLayout);
            this.broadcastViewportStateToClients(newState, this.defaultEnvironment);
        }
    }

    private broadcastViewportStateToClients(state: ViewportState, environment?: string): void {
        const message = JSON.stringify({
            type: "viewport_state_update",
            data: state
        });
        this.activeConnections.forEach((connection) => {
            if (environment && connection.environment !== environment) return;
            if (connection.ws.readyState === 1) {
                connection.ws.send(message);
            }
        });
    }

constructor(
environmentServices: Map<string, EnvironmentServices>,
resolveEnvironment: (headers: IncomingHttpHeaders) => string,
defaultEnvironment: string,
) {
this.environmentServices = environmentServices;
this.resolveEnvironment = resolveEnvironment;
this.defaultEnvironment = defaultEnvironment;
this.tcpClient = new DaemonTcpClient();
this.widgetLayoutStore = new LevelKeyValueAdapter<string, WidgetLayoutRecord>(this.widgetLayoutStorePath);
this.viewportState = this.computeViewportState();
this.registerResizeListener();
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

    private normalizeTaskTimestamp(value: unknown): string {
        if (value instanceof Date) {
            return value.toISOString();
        }
        if (typeof value === "string" && value.length > 0) {
            return value;
        }
        return new Date().toISOString();
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
            const normalized = result.data.reduce<Task[]>((acc, task) => {
                if (!task || typeof task.id !== "string" || task.id.length === 0) {
                    return acc;
                }
                const title = typeof task.title === "string" ? task.title : "Untitled task";
                const description = typeof task.description === "string" ? task.description : "";
                const normalizedTask: Task = {
                    ...task,
                    id: task.id,
                    title,
                    description,
                    status: this.normalizeTaskStatus(task.status),
                    priority: this.normalizeTaskPriority(task.priority),
                    createdAt: this.normalizeTaskTimestamp(task.createdAt),
                    updatedAt: this.normalizeTaskTimestamp(task.updatedAt),
                };
                return acc.concat(normalizedTask);
            }, []);
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

    private widgetLayoutStoreKeyForEnvironment(environment: string): string {
        return `${this.widgetLayoutStoreKeyPrefix}${environment}`;
    }

    private async ensureWidgetLayoutStoreOpen(): Promise<void> {
        if (this.widgetLayoutStoreOpenPromise) {
            return this.widgetLayoutStoreOpenPromise;
        }
        this.widgetLayoutStoreOpenPromise = this.widgetLayoutStore.open().catch((error) => {
            this.widgetLayoutStoreOpenPromise = null;
            throw error;
        });
        return this.widgetLayoutStoreOpenPromise;
    }

    private normalizeWidgetLayoutRecord(value: unknown): WidgetLayoutRecord | null {
        if (!isRecord(value)) {
            return null;
        }
        if (!Object.prototype.hasOwnProperty.call(value, "version")
            || !Object.prototype.hasOwnProperty.call(value, "layout")) {
            return null;
        }
        if (value.version !== WIDGET_LAYOUT_RECORD_VERSION) {
            return null;
        }
        return {
            version: WIDGET_LAYOUT_RECORD_VERSION,
            layout: this.normalizeWidgetLayoutState(value.layout),
        };
    }

    private buildWidgetLayoutRecord(layout: WidgetLayoutState): WidgetLayoutRecord {
        return {
            version: WIDGET_LAYOUT_RECORD_VERSION,
            layout: this.normalizeWidgetLayoutState(layout),
        };
    }

    private async loadLegacyWidgetLayoutSnapshot(): Promise<Record<string, WidgetLayoutState> | null> {
        try {
            const raw = await fs.readFile(this.widgetLayoutLegacyStoragePath, "utf-8");
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== "object") {
                return null;
            }
            const snapshot = Object.entries(parsed).reduce<Record<string, WidgetLayoutState>>(
                (acc, [environment, layout]) => {
                    if (!environment) {
                        return acc;
                    }
                    const normalizedLayout = this.normalizeWidgetLayoutState(layout);
                    if (Object.keys(normalizedLayout).length === 0) {
                        return acc;
                    }
                    return { ...acc, [environment]: normalizedLayout };
                },
                {},
            );
            return Object.keys(snapshot).length > 0 ? snapshot : null;
        } catch (error) {
            if (error instanceof Error && error.message.includes("ENOENT")) {
                return null;
            }
            console.error("[DASHBOARD] Failed to load legacy widget layout preferences:", error);
            return null;
        }
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

    private detectViewportBreakpoint(width: number): ViewportBreakpoint {
        if (width < 768) return "mobile";
        if (width < 1024) return "tablet";
        return "desktop";
    }

    private updateGridColumnsForBreakpoint(breakpoint: ViewportBreakpoint): number {
        switch (breakpoint) {
            case "mobile": return 4;
            case "tablet": return 8;
            case "desktop": return 12;
        }
    }

    private computeViewportState(): ViewportState {
        const width = globalThis.innerWidth ?? 0;
        const breakpoint = this.detectViewportBreakpoint(width);
        const gridColumns = this.updateGridColumnsForBreakpoint(breakpoint);
        return { width, breakpoint, gridColumns };
    }

    private updateViewportState(newState: ViewportState): void {
        if (this.viewportState.breakpoint === newState.breakpoint && this.viewportState.gridColumns === newState.gridColumns) {
            return;
        }
        const oldState = this.viewportState;
        this.viewportState = newState;
        this.viewportChangeListeners.forEach((listener) => listener(newState));
        console.log("[DASHBOARD] Viewport change: breakpoint={oldState.breakpoint}→{newState.breakpoint}, columns={oldState.gridColumns}→{newState.gridColumns}");
    }

    private debouncedViewportUpdate(): void {
        if (this.resizeDebounceTimer) {
            clearTimeout(this.resizeDebounceTimer);
        }
        this.resizeDebounceTimer = setTimeout(() => {
            const newState = this.computeViewportState();
            this.updateViewportState(newState);
            this.resizeDebounceTimer = null;
        }, 500);
    }

    private registerResizeListener(): void {
        if (typeof globalThis === "undefined" || typeof globalThis.addEventListener !== "function") {
            return;
        }
        globalThis.addEventListener("resize", () => this.debouncedViewportUpdate());
        console.log("[DASHBOARD] Resize listener registered with 500ms debounce");
    }

    private unregisterResizeListener(): void {
        if (typeof globalThis === "undefined" || typeof globalThis.removeEventListener !== "function") {
            return;
        }
        globalThis.removeEventListener("resize", () => this.debouncedViewportUpdate());
        console.log("[DASHBOARD] Resize listener unregistered");
    }

    public registerViewportChangeListener(listener: (state: ViewportState) => void): void {
        this.viewportChangeListeners.add(listener);
    }

    public unregisterViewportChangeListener(listener: (state: ViewportState) => void): void {
        this.viewportChangeListeners.delete(listener);
    }

    public getViewportState(): ViewportState {
        return this.viewportState;
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
                await this.ensureWidgetLayoutStoreOpen();
                const prefix = this.widgetLayoutStoreKeyPrefix;
                const iterator = this.widgetLayoutStore.iterator({
                    gte: prefix,
                    lt: `${prefix}\uFFFF`,
                });
                let entries: Array<[string, WidgetLayoutState]> = [];
                try {
                    for await (const [key, value] of iterator) {
                        if (typeof key !== "string" || !key.startsWith(prefix)) {
                            continue;
                        }
                        const environment = key.slice(prefix.length);
                        if (!environment) {
                            continue;
                        }
                        const record = this.normalizeWidgetLayoutRecord(value);
                        if (!record) {
                            continue;
                        }
                        entries = entries.concat([[environment, record.layout]]);
                    }
                } finally {
                    await iterator.close();
                }
                if (entries.length === 0) {
                    const legacySnapshot = await this.loadLegacyWidgetLayoutSnapshot();
                    if (legacySnapshot) {
                        const legacyMap = Object.entries(legacySnapshot).reduce(
                            (acc, [environment, layout]) => new Map([...acc, [environment, layout]]),
                            new Map<string, WidgetLayoutState>(),
                        );
                        this.widgetLayoutPreferencesByEnvironment = legacyMap;
                        await this.persistWidgetLayoutPreferences(legacySnapshot);
                        return;
                    }
                }
                this.widgetLayoutPreferencesByEnvironment = entries.reduce(
                    (acc, [environment, layout]) => new Map([...acc, [environment, layout]]),
                    new Map<string, WidgetLayoutState>(),
                );
            } catch (error) {
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
        await this.ensureWidgetLayoutStoreOpen();
        const entries = Object.entries(snapshot).filter(([environment]) => environment);
        if (entries.length === 0) {
            return;
        }
        const operations = entries.map(([environment, layout]) => ({
            type: "put" as const,
            key: this.widgetLayoutStoreKeyForEnvironment(environment),
            value: this.buildWidgetLayoutRecord(layout),
        }));
        if (typeof this.widgetLayoutStore.batch === "function") {
            await this.widgetLayoutStore.batch(operations);
            return;
        }
        for (const operation of operations) {
            await this.widgetLayoutStore.put(operation.key, operation.value);
        }
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
                        <span class="event-icon" aria-hidden="true">\${eventIcon}</span>
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

    private parseJsonBody(body: string): JsonParseResult {
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
            if (isJsonParseError(parsed)) {
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
            if (isJsonParseError(parsed)) {
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

            const resolveEventType = (task: any): string => {
                if (!task || typeof task !== "object") {
                    return "task_status_changed";
                }
                const createdAt = task.createdAt ? new Date(task.createdAt).getTime() : Number.NaN;
                const updatedAt = task.updatedAt ? new Date(task.updatedAt).getTime() : Number.NaN;
                if (Number.isFinite(createdAt) && Number.isFinite(updatedAt) && createdAt === updatedAt) {
                    return "task_created";
                }
                if (task.status === "done") {
                    return "task_completed";
                }
                if (task.status === "failed") {
                    return "task_failed";
                }
                return "task_status_changed";
            };

			// Create activity log entries from recent task changes
			const logs = tasks
				.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
				.slice(0, limit)
				.map(task => {
                    const eventType = resolveEventType(task);
                    return {
					id: `log_${task.id}_${Date.now()}`,
					timestamp: task.updatedAt,
					level: task.status === "failed" ? "error" : task.status === "done" ? "success" : "info",
					message: `Task "${task.title}" ${task.status.replace('-', ' ')}`,
                    eventType,
					data: {
						taskId: task.id,
						taskTitle: task.title,
						status: task.status,
						priority: task.priority,
                        eventType,
					},
				};
                });

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
                        createdAt: this.normalizeTaskTimestamp(t.createdAt),
                        updatedAt: this.normalizeTaskTimestamp(t.updatedAt),
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

        :root {
            --priority-high-color: #ef4444;
            --priority-medium-color: #f59e0b;
            --priority-low-color: #10b981;
            --widget-drag-accent: rgba(59, 130, 246, 0.6);
            --widget-drag-accent-strong: rgba(59, 130, 246, 0.9);
            --widget-drag-accent-soft: rgba(59, 130, 246, 0.16);
            --widget-drag-hover-duration: 320ms;
            --widget-drag-drop-duration: 360ms;
            --widget-drag-ghost-duration: 360ms;
            --widget-drag-ghost-scale: 0.9;
            --widget-drag-ghost-opacity: 0.5;
            --widget-drag-ghost-opacity-peak: 0.55;
            --widget-drag-ease: cubic-bezier(0.2, 0.8, 0.2, 1);
            --widget-drag-muted-opacity: 0.82;
            --widget-drag-active-opacity: 0.18;
            --widget-drag-line-color: rgba(59, 130, 246, 0.75);
            --widget-drag-line-glow: rgba(59, 130, 246, 0.28);
            --widget-snap-grid-size: 36px;
            --widget-snap-grid-color: rgba(59, 130, 246, 0.2);
            --widget-drag-handle-bg: rgba(255, 255, 255, 0.85);
            --widget-drag-handle-border: rgba(148, 163, 184, 0.55);
            --widget-drag-handle-dot: rgba(30, 64, 175, 0.75);
            --focus-ring-color: #1d4ed8;
            --focus-ring-shadow: rgba(191, 219, 254, 0.85);
            --focus-ring-width: 3px;
            --focus-ring-offset: 2px;
            --text-muted-color: #4b5563;
        }
        
        /* Base styles */
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif; 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            color: #1f2937;
        }

        .skip-link {
            position: absolute;
            top: 12px;
            left: 12px;
            padding: 10px 14px;
            border-radius: 8px;
            background: #111827;
            color: #f9fafb;
            text-decoration: none;
            transform: translateY(-200%);
            transition: transform 0.2s ease;
            z-index: 1000;
        }

        .skip-link:focus-visible {
            transform: translateY(0);
            outline: var(--focus-ring-width) solid var(--focus-ring-color);
            outline-offset: 2px;
        }

        body.widget-dragging,
        body.widget-dragging * {
            cursor: grabbing;
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
            color: var(--text-muted-color);
            flex-wrap: wrap;
        }

        .layout-save-indicator {
            margin-left: auto;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 4px 10px;
            border-radius: 999px;
            font-size: 0.78rem;
            font-weight: 600;
            color: #047857;
            background: rgba(16, 185, 129, 0.12);
            border: 1px solid rgba(16, 185, 129, 0.28);
            opacity: 0;
            transform: translateY(4px);
            transition: opacity 180ms var(--widget-drag-ease), transform 180ms var(--widget-drag-ease);
            pointer-events: none;
        }

        .layout-save-indicator.is-visible {
            opacity: 1;
            transform: translateY(0);
            pointer-events: auto;
        }

        .layout-save-indicator.is-error {
            color: #b91c1c;
            background: rgba(248, 113, 113, 0.12);
            border-color: rgba(239, 68, 68, 0.3);
        }

        .layout-save-icon {
            font-size: 0.9rem;
            line-height: 1;
        }

        .layout-save-retry {
            border: none;
            background: transparent;
            color: inherit;
            font-size: 0.78rem;
            font-weight: 600;
            text-decoration: underline;
            cursor: pointer;
            padding: 0;
        }

        .layout-save-retry:focus-visible {
            outline: var(--focus-ring-width) solid var(--focus-ring-color);
            outline-offset: 2px;
            border-radius: 6px;
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
            display: inline-flex;
            align-items: center;
            gap: 8px;
            font-size: 0.85rem; 
            color: var(--text-muted-color);
            background: rgba(255,255,255,0.9);
            padding: 6px 10px;
            border-radius: 4px;
        }

        .auto-refresh label {
            font-weight: 600;
            color: #4b5563;
        }

        .auto-refresh select {
            border: 1px solid #e5e7eb;
            border-radius: 6px;
            padding: 4px 8px;
            background: #ffffff;
            color: #374151;
            font-size: 0.85rem;
        }
        
        /* Metrics Grid */
        .dashboard-grid {
            --dashboard-grid-columns: auto-fit;
            --dashboard-grid-min-width: 280px;
            --dashboard-grid-gap: 20px;
            display: grid;
            grid-template-columns: repeat(var(--dashboard-grid-columns), minmax(var(--dashboard-grid-min-width), 1fr));
            gap: var(--dashboard-grid-gap);
            grid-auto-flow: row;
        }

        .metrics {
            --dashboard-grid-min-width: 280px;
            --dashboard-grid-gap: 20px;
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

        .metric-card.clickable {
            cursor: pointer;
        }

        .metric-card.clickable:focus-visible {
            outline: var(--focus-ring-width) solid var(--focus-ring-color);
            outline-offset: var(--focus-ring-offset);
            box-shadow: 0 0 0 3px var(--focus-ring-shadow);
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

        .priority-breakdown {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }

        .priority-breakdown-header {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 16px;
        }

        .priority-breakdown-title {
            font-size: 0.95rem;
            font-weight: 600;
            color: #111827;
            margin: 0;
        }

        .priority-breakdown-subtitle {
            font-size: 0.75rem;
            color: var(--text-muted-color);
            margin-top: 4px;
        }

        .priority-breakdown-total {
            font-size: 2rem;
            font-weight: 700;
            color: #111827;
            text-align: right;
        }

        .priority-breakdown-bar {
            display: flex;
            height: 10px;
            border-radius: 999px;
            overflow: hidden;
            background: #f3f4f6;
            box-shadow: inset 0 0 0 1px #e5e7eb;
        }

        .priority-breakdown-segment {
            height: 100%;
            transition: width 0.4s ease;
        }

        .priority-breakdown-segment.high { background: var(--priority-high-color); }
        .priority-breakdown-segment.medium { background: var(--priority-medium-color); }
        .priority-breakdown-segment.low { background: var(--priority-low-color); }

        .priority-breakdown-rows {
            display: grid;
            gap: 10px;
        }

        .priority-breakdown-row {
            display: grid;
            grid-template-columns: minmax(120px, 1fr) auto minmax(90px, 1fr);
            gap: 12px;
            align-items: center;
        }

        .priority-breakdown-row.clickable {
            cursor: pointer;
        }

        .priority-breakdown-row.clickable:focus-visible {
            outline: var(--focus-ring-width) solid var(--focus-ring-color);
            outline-offset: var(--focus-ring-offset);
            box-shadow: 0 0 0 3px var(--focus-ring-shadow);
        }

        .priority-breakdown-label {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            font-weight: 600;
            color: #111827;
        }

        .priority-dot {
            width: 8px;
            height: 8px;
            border-radius: 999px;
        }

        .priority-dot.high { background: var(--priority-high-color); }
        .priority-dot.medium { background: var(--priority-medium-color); }
        .priority-dot.low { background: var(--priority-low-color); }

        .priority-breakdown-value {
            display: flex;
            flex-direction: column;
            align-items: flex-end;
            gap: 2px;
            font-weight: 700;
            color: #111827;
        }

        .priority-breakdown-count {
            font-size: 1.2rem;
        }

        .priority-breakdown-percent {
            font-size: 0.75rem;
            color: var(--text-muted-color);
            font-weight: 500;
        }

        .priority-sparkline {
            width: 100%;
            height: 24px;
        }

        .priority-sparkline-line {
            fill: none;
            stroke-width: 2;
            stroke-linecap: round;
            stroke-linejoin: round;
            opacity: 0.9;
        }

        .priority-sparkline-line.high { stroke: var(--priority-high-color); }
        .priority-sparkline-line.medium { stroke: var(--priority-medium-color); }
        .priority-sparkline-line.low { stroke: var(--priority-low-color); }

        .status-breakdown {
            --status-high-color: var(--priority-high-color);
            --status-medium-color: var(--priority-medium-color);
            --status-low-color: var(--priority-low-color);
            display: flex;
            flex-direction: column;
            gap: 12px;
        }

        .status-breakdown-header {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 16px;
        }

        .status-breakdown-title {
            font-size: 0.95rem;
            font-weight: 600;
            color: #111827;
            margin: 0;
        }

        .status-breakdown-subtitle {
            font-size: 0.75rem;
            color: var(--text-muted-color);
            margin-top: 4px;
        }

        .status-breakdown-total {
            font-size: 2rem;
            font-weight: 700;
            color: #111827;
            text-align: right;
        }

        .status-breakdown-empty {
            background: #f9fafb;
            border-radius: 10px;
            border: 1px dashed #e5e7eb;
            padding: 12px 14px;
            color: var(--text-muted-color);
            font-size: 0.9rem;
        }

        .status-breakdown-rows {
            display: grid;
            gap: 10px;
        }

        .status-breakdown-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            padding-top: 6px;
            border-top: 1px solid #f3f4f6;
        }

        .status-breakdown-row.clickable {
            cursor: pointer;
        }

        .status-breakdown-row.clickable:focus-visible {
            outline: var(--focus-ring-width) solid var(--focus-ring-color);
            outline-offset: var(--focus-ring-offset);
            box-shadow: 0 0 0 3px var(--focus-ring-shadow);
        }

        .status-breakdown-row:first-child {
            border-top: none;
            padding-top: 0;
        }

        .status-breakdown-label {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            font-weight: 600;
            color: #111827;
        }

        .status-breakdown-value {
            display: flex;
            align-items: center;
            justify-content: flex-end;
            min-width: 48px;
        }

        .status-dot {
            width: 8px;
            height: 8px;
            border-radius: 999px;
        }

        .status-dot.pending { background: var(--status-high-color); }
        .status-dot.in-progress { background: var(--status-medium-color); }
        .status-dot.completed { background: var(--status-low-color); }

        .status-breakdown-count {
            font-size: 1.35rem;
            font-weight: 700;
            color: #111827;
        }

        .status-breakdown-row.pending .status-breakdown-count { color: var(--status-high-color); }
        .status-breakdown-row.in-progress .status-breakdown-count { color: var(--status-medium-color); }
        .status-breakdown-row.completed .status-breakdown-count { color: var(--status-low-color); }

        .activity-widget {
            display: flex;
            flex-direction: column;
            gap: 12px;
            grid-column: span 2;
        }

        .activity-widget-header {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 12px;
        }

        .activity-widget-title {
            font-size: 0.95rem;
            font-weight: 600;
            color: #111827;
            margin: 0;
        }

        .activity-widget-subtitle {
            font-size: 0.75rem;
            color: var(--text-muted-color);
            margin-top: 4px;
        }

        .activity-widget-action {
            border: 1px solid #e5e7eb;
            background: #f9fafb;
            color: #374151;
            border-radius: 999px;
            font-size: 0.7rem;
            font-weight: 600;
            padding: 6px 12px;
            cursor: pointer;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }

        .activity-widget-action:hover {
            border-color: #cbd5f5;
            background: #eef2ff;
        }

        .activity-widget-action:focus-visible {
            outline: var(--focus-ring-width) solid var(--focus-ring-color);
            outline-offset: var(--focus-ring-offset);
            box-shadow: 0 0 0 3px var(--focus-ring-shadow);
        }

        .activity-widget-list {
            display: grid;
            gap: 10px;
            max-height: 280px;
            overflow-y: auto;
            padding-right: 4px;
        }

        .activity-widget-loading {
            opacity: 0.7;
        }

        .activity-widget-list .loading,
        .activity-widget-empty,
        .activity-widget-error {
            padding: 16px;
            font-size: 0.9rem;
            text-align: left;
            background: #f9fafb;
            border-radius: 10px;
            border: 1px dashed #e5e7eb;
            color: var(--text-muted-color);
        }

        .activity-widget-item {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 12px;
            width: 100%;
            appearance: none;
            -webkit-appearance: none;
            border: 1px solid #e5e7eb;
            border-radius: 10px;
            padding: 12px;
            background: #f8fafc;
            color: inherit;
            text-align: left;
            cursor: pointer;
            transition: background 0.2s, border-color 0.2s, transform 0.2s;
        }

        .activity-widget-item:hover {
            background: #eef2ff;
            border-color: rgba(99, 102, 241, 0.35);
            transform: translateY(-1px);
        }

        .activity-widget-item:focus-visible {
            outline: var(--focus-ring-width) solid var(--focus-ring-color);
            outline-offset: var(--focus-ring-offset);
            box-shadow: 0 0 0 3px var(--focus-ring-shadow);
        }

        .activity-widget-item-main {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }

        .activity-widget-message {
            font-weight: 600;
            color: #111827;
            font-size: 0.95rem;
        }

        .activity-widget-meta {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
        }

        .activity-widget-time {
            font-size: 0.75rem;
            color: var(--text-muted-color);
            white-space: nowrap;
            margin-top: 2px;
        }

        .my-tasks-widget {
            display: flex;
            flex-direction: column;
            gap: 12px;
            grid-column: span 2;
        }

        .my-tasks-header {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 12px;
        }

        .my-tasks-title {
            font-size: 0.95rem;
            font-weight: 600;
            color: #111827;
            margin: 0;
        }

        .my-tasks-subtitle {
            font-size: 0.75rem;
            color: var(--text-muted-color);
            margin-top: 4px;
        }

        .my-tasks-action {
            border: 1px solid #e5e7eb;
            background: #f9fafb;
            color: #374151;
            border-radius: 999px;
            font-size: 0.7rem;
            font-weight: 600;
            padding: 6px 12px;
            cursor: pointer;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }

        .my-tasks-action:hover {
            border-color: #cbd5f5;
            background: #eef2ff;
        }

        .my-tasks-action:focus-visible {
            outline: var(--focus-ring-width) solid var(--focus-ring-color);
            outline-offset: var(--focus-ring-offset);
            box-shadow: 0 0 0 3px var(--focus-ring-shadow);
        }

        .my-tasks-list {
            display: grid;
            gap: 10px;
            max-height: 320px;
            overflow-y: auto;
            padding-right: 4px;
        }

        .my-tasks-list .loading,
        .my-tasks-empty {
            padding: 16px;
            font-size: 0.9rem;
            text-align: left;
            background: #f9fafb;
            border-radius: 10px;
            border: 1px dashed #e5e7eb;
            color: var(--text-muted-color);
        }

        .my-task-item {
            display: flex;
            flex-direction: column;
            gap: 10px;
            border: 1px solid #e5e7eb;
            border-radius: 10px;
            padding: 12px;
            background: #f8fafc;
            color: inherit;
            text-align: left;
            transition: background 0.2s, border-color 0.2s, transform 0.2s;
        }

        .my-task-item:hover {
            background: #eef2ff;
            border-color: rgba(99, 102, 241, 0.35);
            transform: translateY(-1px);
        }

        .my-task-title {
            font-weight: 600;
            color: #111827;
            font-size: 0.95rem;
        }

        .my-task-meta {
            display: flex;
            flex-wrap: wrap;
            gap: 6px 10px;
            font-size: 0.75rem;
            color: var(--text-muted-color);
            align-items: center;
        }

        .my-task-meta .status,
        .my-task-meta .priority {
            font-size: 0.65rem;
            padding: 2px 8px;
        }

        .my-task-assignee,
        .my-task-updated {
            font-weight: 500;
        }

        .my-task-actions {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
        }

        .my-task-action-btn {
            border: 1px solid transparent;
            border-radius: 999px;
            padding: 6px 10px;
            font-size: 0.7rem;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            cursor: pointer;
            background: #f3f4f6;
            color: #374151;
            transition: background 0.2s, border-color 0.2s, transform 0.2s;
        }

        .my-task-action-btn:hover {
            transform: translateY(-1px);
        }

        .my-task-action-btn:focus-visible {
            outline: var(--focus-ring-width) solid var(--focus-ring-color);
            outline-offset: var(--focus-ring-offset);
            box-shadow: 0 0 0 3px var(--focus-ring-shadow);
        }

        .my-task-action-btn.complete {
            background: #dcfce7;
            color: #065f46;
            border-color: #86efac;
        }

        .my-task-action-btn.complete:hover {
            background: #bbf7d0;
        }

        .my-task-action-btn.priority {
            background: #fef3c7;
            color: #92400e;
            border-color: #fde68a;
        }

        .my-task-action-btn.priority:hover {
            background: #fde68a;
        }

        .my-task-action-btn.view {
            background: #dbeafe;
            color: #1e40af;
            border-color: #93c5fd;
        }

        .my-task-action-btn.view:hover {
            background: #bfdbfe;
        }

        .my-task-action-btn.is-disabled,
        .my-task-action-btn:disabled {
            cursor: not-allowed;
            opacity: 0.55;
            transform: none;
        }

        @media (max-width: 767px) {
            .activity-widget,
            .my-tasks-widget {
                grid-column: span 1;
            }
        }

        .dashboard-grid.dashboard-grid-single .activity-widget,
        .dashboard-grid.dashboard-grid-single .my-tasks-widget {
            grid-column: span 1;
        }

        .widget-container {
            transition: background var(--widget-drag-hover-duration) var(--widget-drag-ease),
                outline var(--widget-drag-hover-duration) var(--widget-drag-ease),
                box-shadow var(--widget-drag-hover-duration) var(--widget-drag-ease);
        }

        .widget-container.drag-active {
            outline: 2px dashed var(--widget-drag-accent);
            outline-offset: 4px;
            background-color: rgba(59, 130, 246, 0.04);
            background-image:
                linear-gradient(90deg, var(--widget-snap-grid-color) 1px, transparent 1px),
                linear-gradient(180deg, var(--widget-snap-grid-color) 1px, transparent 1px);
            background-size: var(--widget-snap-grid-size) var(--widget-snap-grid-size);
            box-shadow: 0 10px 24px rgba(59, 130, 246, 0.12);
        }

        .widget-container.drag-hover {
            outline-color: var(--widget-drag-accent-strong);
            background-color: rgba(59, 130, 246, 0.12);
            background-image:
                linear-gradient(90deg, var(--widget-snap-grid-color) 1px, transparent 1px),
                linear-gradient(180deg, var(--widget-snap-grid-color) 1px, transparent 1px);
            background-size: var(--widget-snap-grid-size) var(--widget-snap-grid-size);
            box-shadow: 0 16px 32px rgba(59, 130, 246, 0.18);
        }

        .widget-container.drag-dropping {
            outline: 2px solid var(--widget-drag-accent);
            outline-offset: 4px;
            background-color: rgba(59, 130, 246, 0.06);
            animation: widget-drop-flash var(--widget-drag-drop-duration) var(--widget-drag-ease);
        }

        .widget-container.drag-active .widget-card {
            transition: transform var(--widget-drag-hover-duration) var(--widget-drag-ease),
                box-shadow var(--widget-drag-hover-duration) var(--widget-drag-ease),
                opacity var(--widget-drag-hover-duration) var(--widget-drag-ease);
        }

        .widget-container.drag-active .widget-card:not(.dragging):not(.widget-drop-indicator) {
            opacity: var(--widget-drag-muted-opacity);
        }

        .widget-card {
            cursor: grab;
            user-select: none;
            position: relative;
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

        .widget-notification-indicator {
            position: absolute;
            top: calc(var(--widget-padding) / 2);
            right: calc(var(--widget-padding) / 2);
            background: #f97316;
            color: #ffffff;
            font-size: 0.65rem;
            font-weight: 600;
            letter-spacing: 0.02em;
            padding: 2px 8px;
            border-radius: 999px;
            opacity: 0;
            transform: translateY(-4px) scale(0.92);
            transition: opacity 0.2s ease, transform 0.2s ease;
            pointer-events: none;
            z-index: 3;
            box-shadow: 0 6px 12px rgba(249, 115, 22, 0.25);
        }

        .widget-notification-indicator.is-active {
            opacity: 1;
            transform: translateY(0) scale(1);
        }

        .widget-drag-handle {
            position: absolute;
            top: calc(var(--widget-padding) / 2);
            left: calc(var(--widget-padding) / 2);
            width: 26px;
            height: 26px;
            border-radius: 8px;
            background: var(--widget-drag-handle-bg);
            border: 1px solid var(--widget-drag-handle-border);
            display: inline-flex;
            align-items: center;
            justify-content: center;
            opacity: 0;
            transform: translateY(-4px) scale(0.98);
            transition: opacity var(--widget-drag-hover-duration) var(--widget-drag-ease),
                transform var(--widget-drag-hover-duration) var(--widget-drag-ease);
            pointer-events: none;
            z-index: 2;
        }

        .widget-drag-handle::before {
            content: "";
            width: 14px;
            height: 14px;
            background-image: radial-gradient(circle, var(--widget-drag-handle-dot) 1.2px, transparent 1.4px);
            background-size: 6px 6px;
        }

        .widget-card:hover .widget-drag-handle,
        .widget-card:focus-within .widget-drag-handle {
            opacity: 0.9;
            transform: translateY(0) scale(1);
        }

        .widget-card.dragging .widget-drag-handle {
            opacity: 0.25;
            transform: translateY(0) scale(1);
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

        .widget-card:focus-visible {
            outline: var(--focus-ring-width) solid var(--focus-ring-color);
            outline-offset: var(--focus-ring-offset);
            box-shadow: 0 0 0 3px var(--focus-ring-shadow);
        }

        .widget-card.dragging {
            opacity: var(--widget-drag-active-opacity);
            transform: scale(0.97) rotate(-0.3deg);
            box-shadow: 0 6px 16px rgba(15, 23, 42, 0.12);
            cursor: grabbing;
            filter: grayscale(0.3);
        }

        .widget-card.drag-over {
            outline: 2px solid var(--widget-drag-accent-strong);
            outline-offset: 2px;
            background: linear-gradient(135deg, rgba(59, 130, 246, 0.08), rgba(255, 255, 255, 0.98));
            box-shadow: 0 10px 22px rgba(59, 130, 246, 0.18);
        }

        .widget-card.dropping {
            animation: widget-drop-snap var(--widget-drag-drop-duration) var(--widget-drag-ease);
        }

        .widget-drop-indicator {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 100%;
            max-width: 100%;
            min-height: 120px;
            border: 2px dashed var(--widget-drag-accent);
            border-radius: 12px;
            background-color: var(--widget-drag-accent-soft);
            background-image:
                linear-gradient(90deg, rgba(59, 130, 246, 0.2) 1px, transparent 1px),
                linear-gradient(180deg, rgba(59, 130, 246, 0.2) 1px, transparent 1px);
            background-size: calc(var(--widget-snap-grid-size) * 0.8) calc(var(--widget-snap-grid-size) * 0.8);
            pointer-events: none;
            position: relative;
            overflow: hidden;
            box-sizing: border-box;
            opacity: 0.7;
            transition: transform var(--widget-drag-hover-duration) var(--widget-drag-ease),
                border-color var(--widget-drag-hover-duration) var(--widget-drag-ease),
                background var(--widget-drag-hover-duration) var(--widget-drag-ease),
                box-shadow var(--widget-drag-hover-duration) var(--widget-drag-ease),
                opacity var(--widget-drag-hover-duration) var(--widget-drag-ease);
        }

        .widget-drop-indicator::after {
            content: "";
            position: absolute;
            left: 16px;
            right: 16px;
            height: 2px;
            border-radius: 999px;
            background: linear-gradient(90deg, transparent, var(--widget-drag-line-color), transparent);
            opacity: 0;
            transform: scaleX(0.7);
            transition: opacity var(--widget-drag-hover-duration) var(--widget-drag-ease),
                transform var(--widget-drag-hover-duration) var(--widget-drag-ease);
        }

        .widget-drop-indicator.is-active {
            border-style: solid;
            border-color: var(--widget-drag-accent-strong);
            opacity: 1;
            transform: translateY(-2px);
            box-shadow: 0 10px 24px var(--widget-drag-line-glow);
            animation: widget-drop-pulse 1.1s ease-in-out infinite;
        }

        .widget-drop-indicator.drag-over {
            border-color: var(--widget-drag-accent-strong);
            background-color: rgba(59, 130, 246, 0.22);
            box-shadow: 0 16px 32px rgba(59, 130, 246, 0.24);
            opacity: 1;
        }

        .widget-drop-indicator.is-active::after {
            opacity: 1;
            transform: scaleX(1);
        }

        .widget-drop-indicator[data-drop-edge="before"]::after {
            top: 12px;
        }

        .widget-drop-indicator[data-drop-edge="after"]::after {
            bottom: 12px;
        }

        .widget-drop-ghost {
            width: 100%;
            height: 100%;
            border-radius: 10px;
            background: linear-gradient(135deg, rgba(59, 130, 246, 0.24), rgba(59, 130, 246, 0.05));
            display: flex;
            align-items: center;
            justify-content: center;
            color: #1d4ed8;
            font-weight: 700;
            font-size: 0.8rem;
            letter-spacing: 0.08em;
            text-transform: uppercase;
        }

        .widget-drop-label {
            padding: 8px 12px;
            border-radius: 999px;
            background: rgba(255, 255, 255, 0.9);
            box-shadow: 0 6px 16px rgba(37, 99, 235, 0.2);
            border: 1px solid rgba(59, 130, 246, 0.25);
        }

        .widget-ghost {
            position: absolute;
            top: -9999px;
            left: -9999px;
            opacity: var(--widget-drag-ghost-opacity);
            transform: translateZ(0) scale(var(--widget-drag-ghost-scale));
            transform-origin: center;
            box-shadow: 0 14px 32px rgba(15, 23, 42, 0.25);
            pointer-events: none;
            z-index: 9999;
            animation: widget-ghost-float var(--widget-drag-ghost-duration) var(--widget-drag-ease) both;
        }

        @keyframes widget-drop-pulse {
            0% { box-shadow: 0 0 0 rgba(59, 130, 246, 0.18); }
            50% { box-shadow: 0 12px 26px rgba(59, 130, 246, 0.28); }
            100% { box-shadow: 0 0 0 rgba(59, 130, 246, 0.18); }
        }

        @keyframes widget-drop-flash {
            0% { outline-color: rgba(59, 130, 246, 0.7); }
            60% { outline-color: rgba(59, 130, 246, 0.2); }
            100% { outline-color: rgba(59, 130, 246, 0); }
        }

        @keyframes widget-drop-snap {
            0% { transform: scale(0.98); box-shadow: 0 0 0 rgba(0, 0, 0, 0); }
            70% { transform: scale(1.01); box-shadow: 0 18px 30px rgba(15, 23, 42, 0.12); }
            100% { transform: scale(1); box-shadow: 0 10px 18px rgba(15, 23, 42, 0.08); }
        }

        @keyframes widget-ghost-float {
            0% {
                transform: translateZ(0) scale(var(--widget-drag-ghost-scale));
                opacity: var(--widget-drag-ghost-opacity);
            }
            100% {
                transform: translateY(-1px) scale(var(--widget-drag-ghost-scale));
                opacity: var(--widget-drag-ghost-opacity-peak);
            }
        }

        @media (prefers-reduced-motion: reduce) {
            .widget-container.drag-dropping,
            .widget-card.dropping,
            .widget-drop-indicator.is-active,
            .widget-ghost {
                animation: none;
            }
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

        .widget-size-btn:focus-visible {
            outline: var(--focus-ring-width) solid var(--focus-ring-color);
            outline-offset: 1px;
            box-shadow: 0 0 0 3px var(--focus-ring-shadow);
        }

        .widget-remove-controls {
            position: absolute;
            top: calc(var(--widget-padding) / 2);
            right: calc(var(--widget-padding) / 2);
            display: flex;
            gap: 6px;
            padding: 4px;
            border-radius: 999px;
            background: rgba(255, 255, 255, 0.92);
            box-shadow: 0 6px 16px rgba(15, 23, 42, 0.12);
            opacity: 0;
            visibility: hidden;
            transform: translateY(-4px);
            transition: opacity 0.15s ease, transform 0.15s ease, visibility 0.15s ease;
            pointer-events: none;
            z-index: 3;
        }

        .widget-card:hover .widget-remove-controls,
        .widget-card:focus .widget-remove-controls,
        .widget-card:focus-within .widget-remove-controls {
            opacity: 1;
            visibility: visible;
            transform: translateY(0);
            pointer-events: auto;
        }

        .widget-remove-btn {
            border: 1px solid rgba(239, 68, 68, 0.4);
            background: rgba(254, 226, 226, 0.9);
            color: #b91c1c;
            border-radius: 999px;
            font-size: 0.7rem;
            font-weight: 600;
            padding: 4px 10px;
            cursor: pointer;
            text-transform: uppercase;
            letter-spacing: 0.06em;
        }

        .widget-move-btn {
            border: 1px solid rgba(59, 130, 246, 0.35);
            background: rgba(219, 234, 254, 0.9);
            color: #1d4ed8;
            border-radius: 999px;
            font-size: 0.7rem;
            font-weight: 600;
            padding: 4px 10px;
            cursor: pointer;
            text-transform: uppercase;
            letter-spacing: 0.06em;
        }

        .widget-remove-btn:hover {
            background: #ef4444;
            color: #ffffff;
            border-color: #dc2626;
        }

        .widget-move-btn:hover {
            background: #2563eb;
            color: #ffffff;
            border-color: #1d4ed8;
        }

        .widget-remove-btn:focus-visible {
            outline: var(--focus-ring-width) solid var(--focus-ring-color);
            outline-offset: var(--focus-ring-offset);
            box-shadow: 0 0 0 3px var(--focus-ring-shadow);
        }

        .widget-move-btn:focus-visible {
            outline: var(--focus-ring-width) solid var(--focus-ring-color);
            outline-offset: var(--focus-ring-offset);
            box-shadow: 0 0 0 3px var(--focus-ring-shadow);
        }

        .widget-move-btn:disabled,
        .widget-move-btn[aria-disabled="true"] {
            background: rgba(226, 232, 240, 0.9);
            border-color: rgba(148, 163, 184, 0.5);
            color: #64748b;
            cursor: not-allowed;
            opacity: 0.7;
        }

        .widget-hidden {
            display: none;
        }

        .sr-only {
            position: absolute;
            width: 1px;
            height: 1px;
            padding: 0;
            margin: -1px;
            overflow: hidden;
            clip: rect(0, 0, 0, 0);
            white-space: nowrap;
            border: 0;
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
            color: var(--text-muted-color);
            font-size: 0.9rem;
        }

        .widget-library-actions {
            display: flex;
            gap: 8px;
        }

        .widget-library-controls {
            display: grid;
            gap: 12px;
            margin-bottom: 16px;
        }

        .widget-library-search {
            position: relative;
        }

        .widget-library-search label {
            display: block;
            font-size: 0.72rem;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            color: var(--text-muted-color);
            margin-bottom: 6px;
        }

        .widget-library-search input[type="search"] {
            width: 100%;
            border: 1px solid #e5e7eb;
            border-radius: 999px;
            padding: 10px 14px;
            font-size: 0.9rem;
            background: #ffffff;
            color: #111827;
            transition: border-color 0.12s ease, box-shadow 0.12s ease;
        }

        .widget-library-search input[type="search"]:focus-visible {
            outline: var(--focus-ring-width) solid var(--focus-ring-color);
            outline-offset: var(--focus-ring-offset);
            border-color: var(--focus-ring-color);
            box-shadow: 0 0 0 3px var(--focus-ring-shadow);
        }

        .widget-library-filter-group {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
        }

        .widget-library-filter-btn {
            border: 1px solid #d1d5db;
            border-radius: 999px;
            padding: 6px 12px;
            font-size: 0.8rem;
            color: #374151;
            background: #ffffff;
            cursor: pointer;
            transition: border-color 0.12s ease, background 0.12s ease, color 0.12s ease;
        }

        .widget-library-filter-btn:focus-visible {
            outline: var(--focus-ring-width) solid var(--focus-ring-color);
            outline-offset: var(--focus-ring-offset);
            box-shadow: 0 0 0 3px var(--focus-ring-shadow);
        }

        .widget-library-filter-btn.is-active {
            border-color: #2563eb;
            background: #eff6ff;
            color: #1d4ed8;
            font-weight: 600;
        }

        .widget-library-results {
            font-size: 0.85rem;
            color: var(--text-muted-color);
            margin-bottom: 12px;
        }

        .widget-library-selection-summary {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 8px;
            font-size: 0.85rem;
            color: #374151;
        }

        .widget-library-empty {
            border: 1px dashed #d1d5db;
            border-radius: 12px;
            padding: 20px;
            display: grid;
            gap: 8px;
            color: var(--text-muted-color);
            background: #f9fafb;
        }

        .widget-limit-message {
            width: 100%;
            padding: 10px 12px;
            border-radius: 10px;
            border: 1px solid #fcd34d;
            background: #fef3c7;
            color: #92400e;
            font-size: 0.85rem;
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
            margin: 0 0 12px;
        }

        .widget-library-sections {
            display: flex;
            flex-direction: column;
            gap: 20px;
        }

        .dashboard-empty-state {
            margin: 16px 0 28px;
        }

        .dashboard-empty-card {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            justify-content: space-between;
            gap: 20px;
            padding: 28px;
            border-radius: 16px;
            border: 1px solid #e5e7eb;
            background: linear-gradient(135deg, rgba(59, 130, 246, 0.08), rgba(255, 255, 255, 0.95));
            box-shadow: 0 12px 24px rgba(15, 23, 42, 0.08);
        }

        .dashboard-empty-content h2 {
            margin: 0 0 8px;
            font-size: 1.4rem;
            color: #111827;
        }

        .dashboard-empty-content p {
            margin: 0;
            color: var(--text-muted-color);
            max-width: 520px;
        }

        .dashboard-empty-actions {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
        }

        @media (max-width: 768px) {
            .dashboard-empty-card {
                align-items: flex-start;
            }
        }

        .widget-library-catalog-grid {
            display: grid;
            gap: 12px;
            grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
        }

        .widget-library-card {
            display: flex;
            flex-direction: column;
            align-items: stretch;
            justify-content: space-between;
            gap: 12px;
            border: 1px solid #e5e7eb;
            border-radius: 10px;
            padding: 12px;
            background: #f9fafb;
            position: relative;
            overflow: visible;
            min-height: 220px;
        }

        .widget-library-card.selected {
            border-color: #3b82f6;
            background: #eff6ff;
        }

        .widget-library-card-preview {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 10px 12px;
            border-radius: 10px;
            background: linear-gradient(135deg, rgba(59, 130, 246, 0.12), rgba(14, 116, 144, 0.08));
        }

        .widget-library-card-badge {
            width: 42px;
            height: 42px;
            border-radius: 12px;
            background: linear-gradient(135deg, rgba(59, 130, 246, 0.65), rgba(14, 116, 144, 0.75));
            box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.4);
        }

        .widget-library-card-title {
            font-weight: 600;
            color: #1f2937;
        }

        .widget-library-card-subtitle {
            font-size: 0.78rem;
            color: var(--text-muted-color);
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }

        .widget-library-card-body {
            display: flex;
            flex-direction: column;
            gap: 8px;
            padding: 0 4px;
            flex: 1;
        }

        .widget-library-card-description {
            font-size: 0.82rem;
            color: #4b5563;
        }

        .widget-library-card-rows {
            display: grid;
            gap: 6px;
        }

        .widget-library-card-row {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            font-size: 0.75rem;
            color: #4b5563;
        }

        .widget-library-card-row-label {
            text-transform: uppercase;
            letter-spacing: 0.08em;
            font-size: 0.7rem;
            color: var(--text-muted-color);
        }

        .widget-library-card-row-value {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            justify-content: flex-end;
        }

        .widget-library-card-tag {
            padding: 3px 8px;
            border-radius: 999px;
            background: rgba(148, 163, 184, 0.2);
            color: #475569;
            font-size: 0.7rem;
            font-weight: 600;
            letter-spacing: 0.02em;
        }

        .widget-library-card-row-metrics {
            font-weight: 600;
            color: #1f2937;
        }

        .widget-library-card-id {
            font-size: 0.75rem;
            color: var(--text-muted-color);
        }

        .widget-library-card-actions {
            display: flex;
            align-items: center;
            gap: 12px;
            flex-wrap: wrap;
            margin-top: auto;
        }

        .widget-library-tooltip {
            position: absolute;
            left: 12px;
            right: 12px;
            top: -8px;
            transform: translateY(-8px);
            opacity: 0;
            pointer-events: none;
            background: #111827;
            color: #f9fafb;
            border-radius: 12px;
            padding: 12px 14px;
            box-shadow: 0 12px 30px rgba(15, 23, 42, 0.25);
            transition: opacity 0.15s ease, transform 0.15s ease;
            z-index: 4;
        }

        .widget-library-card:hover .widget-library-tooltip,
        .widget-library-card:focus-within .widget-library-tooltip {
            opacity: 1;
            transform: translateY(0);
        }

        .widget-library-tooltip-title {
            font-size: 0.85rem;
            font-weight: 600;
            margin-bottom: 6px;
        }

        .widget-library-tooltip-detail {
            font-size: 0.75rem;
            color: rgba(248, 250, 252, 0.8);
            display: flex;
            justify-content: space-between;
            gap: 8px;
        }

        .widget-library-tooltip-status {
            font-weight: 600;
        }

        .widget-library-tooltip-preview {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 8px;
        }

        .widget-library-tooltip-badge {
            width: 34px;
            height: 34px;
            border-radius: 10px;
            background: linear-gradient(135deg, rgba(59, 130, 246, 0.65), rgba(14, 116, 144, 0.75));
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

        .widget-library-toggle input:focus-visible,
        .widget-library-select input:focus-visible {
            outline: var(--focus-ring-width) solid var(--focus-ring-color);
            outline-offset: var(--focus-ring-offset);
            box-shadow: 0 0 0 3px var(--focus-ring-shadow);
        }

        .widget-library-notifications {
            margin-top: 10px;
            padding-top: 10px;
            border-top: 1px solid #e5e7eb;
            display: grid;
            gap: 8px;
        }

        .widget-library-notifications-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            font-size: 0.7rem;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            color: var(--text-muted-color);
        }

        .widget-library-notifications-toggle {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            font-size: 0.75rem;
            color: #111827;
        }

        .widget-library-notification-select {
            width: 100%;
            font-size: 0.75rem;
            padding: 4px 8px;
            border-radius: 8px;
            border: 1px solid #d1d5db;
            background: #ffffff;
            color: #111827;
        }

        .widget-library-notification-types {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 6px 10px;
        }

        .widget-library-notification-type {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            font-size: 0.72rem;
            color: #374151;
        }

        .widget-library-notification-type input:disabled,
        .widget-library-notification-select:disabled {
            opacity: 0.6;
        }

        .widget-library-add {
            border: 1px solid #2563eb;
            background: #3b82f6;
            color: #ffffff;
            border-radius: 999px;
            font-size: 0.75rem;
            font-weight: 600;
            padding: 6px 14px;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            transition: transform 0.12s ease, box-shadow 0.12s ease, background 0.12s ease, border-color 0.12s ease;
        }

        .widget-library-add:hover:not(:disabled) {
            transform: translateY(-1px);
            box-shadow: 0 6px 12px rgba(59, 130, 246, 0.25);
            background: #2563eb;
            border-color: #1d4ed8;
        }

        .widget-library-add:focus-visible {
            outline: var(--focus-ring-width) solid var(--focus-ring-color);
            outline-offset: var(--focus-ring-offset);
            box-shadow: 0 0 0 3px var(--focus-ring-shadow);
        }

        .widget-library-add:disabled {
            background: #e5e7eb;
            border-color: #d1d5db;
            color: var(--text-muted-color);
            cursor: not-allowed;
            box-shadow: none;
            transform: none;
        }

        .widget-library-add.is-loading {
            background: #f59e0b;
            border-color: #d97706;
            color: #111827;
        }

        .widget-library-add.is-success {
            background: #10b981;
            border-color: #059669;
        }
        
        .metric-value { 
            font-size: var(--widget-metric-value-size); 
            font-weight: 700; 
            color: #1d4ed8; 
            line-height: 1;
            margin-bottom: 8px;
        }
        
        .metric-label { 
            color: var(--text-muted-color); 
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

        @keyframes metricsPulse {
            0% {
                opacity: 0.55;
            }
            50% {
                opacity: 0.9;
            }
            100% {
                opacity: 0.55;
            }
        }

        .metrics,
        .health-grid {
            transition: opacity 0.3s ease;
        }

        .metrics.metrics-loading,
        .health-grid.metrics-loading {
            opacity: 0.7;
        }

        .metrics.metrics-loading .metric-value,
        .metrics.metrics-loading .metric-change,
        .metrics.metrics-loading .status-breakdown-total,
        .metrics.metrics-loading .status-breakdown-count,
        .metrics.metrics-loading .priority-breakdown-total,
        .metrics.metrics-loading .priority-breakdown-count,
        .metrics.metrics-loading .priority-breakdown-percent,
        .health-grid.metrics-loading .health-metric-value {
            animation: metricsPulse 1.2s ease-in-out infinite;
        }

        @media (prefers-reduced-motion: reduce) {
            .metrics.metrics-loading .metric-value,
            .metrics.metrics-loading .metric-change,
            .metrics.metrics-loading .status-breakdown-total,
            .metrics.metrics-loading .status-breakdown-count,
            .metrics.metrics-loading .priority-breakdown-total,
            .metrics.metrics-loading .priority-breakdown-count,
            .metrics.metrics-loading .priority-breakdown-percent,
            .health-grid.metrics-loading .health-metric-value {
                animation: none;
            }
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
        
        .form-group input:focus-visible,
        .form-group textarea:focus-visible,
        .form-group select:focus-visible {
            outline: var(--focus-ring-width) solid var(--focus-ring-color);
            outline-offset: var(--focus-ring-offset);
            border-color: var(--focus-ring-color);
            box-shadow: 0 0 0 3px var(--focus-ring-shadow);
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

        .btn:focus-visible {
            outline: var(--focus-ring-width) solid var(--focus-ring-color);
            outline-offset: var(--focus-ring-offset);
            box-shadow: 0 0 0 3px var(--focus-ring-shadow);
        }
        
        .btn-primary { 
            background: linear-gradient(135deg, #1d4ed8, #1e40af); 
            color: white; 
        }
        
        .btn-primary:hover { 
            background: linear-gradient(135deg, #1e40af, #1e3a8a); 
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
        }
        
        .btn-secondary { 
            background: #4b5563; 
            color: white; 
        }
        
        .btn-secondary:hover { 
            background: #374151; 
        }
        
        .btn-danger { 
            background: #dc2626; 
            color: white; 
        }
        
        .btn-danger:hover { 
            background: #b91c1c; 
        }

        .btn-warning {
            background: #b45309;
            color: white;
        }

        .btn-warning:hover {
            background: #92400e;
        }

        .btn-success {
            background: #047857;
            color: white;
        }

        .btn-success:hover {
            background: #065f46;
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
        
        .filter-group select:focus-visible {
            outline: var(--focus-ring-width) solid var(--focus-ring-color);
            outline-offset: var(--focus-ring-offset);
            border-color: var(--focus-ring-color);
            box-shadow: 0 0 0 3px var(--focus-ring-shadow);
        }

        .filter-group select.priority-highlight-high {
            border-color: var(--priority-high-color);
            box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.15);
        }

        .filter-group select.priority-highlight-medium {
            border-color: var(--priority-medium-color);
            box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.15);
        }

        .filter-group select.priority-highlight-low {
            border-color: var(--priority-low-color);
            box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.15);
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
            color: var(--text-muted-color); 
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
        .status.cancelled { background: #f3f4f6; color: var(--text-muted-color); }
        
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
            color: var(--text-muted-color);
            font-size: 1.1rem;
        }

        .dashboard-restore-overlay {
            position: fixed;
            inset: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            background: rgba(15, 23, 42, 0.6);
            backdrop-filter: blur(2px);
            z-index: 2000;
            opacity: 1;
            transition: opacity 180ms ease;
        }

        .dashboard-restore-overlay.is-hidden {
            opacity: 0;
            pointer-events: none;
        }

        .dashboard-restore-card {
            display: flex;
            align-items: center;
            gap: 12px;
            background: #0f172a;
            color: #f8fafc;
            padding: 16px 20px;
            border-radius: 12px;
            box-shadow: 0 20px 40px rgba(15, 23, 42, 0.35);
            font-weight: 600;
        }

        .dashboard-restore-spinner {
            width: 24px;
            height: 24px;
            border-radius: 50%;
            border: 3px solid rgba(248, 250, 252, 0.35);
            border-top-color: #38bdf8;
            animation: dashboard-restore-spin 0.9s linear infinite;
        }

        @keyframes dashboard-restore-spin {
            from {
                transform: rotate(0deg);
            }
            to {
                transform: rotate(360deg);
            }
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

        .toast-container {
            position: fixed;
            right: 24px;
            bottom: 24px;
            display: flex;
            flex-direction: column;
            gap: 10px;
            z-index: 1000;
            pointer-events: none;
        }

        .toast {
            background: rgba(255, 255, 255, 0.92);
            color: #1f2937;
            padding: 10px 14px;
            border-radius: 10px;
            border: 1px solid rgba(148, 163, 184, 0.35);
            box-shadow: 0 12px 30px rgba(15, 23, 42, 0.12);
            font-size: 0.85rem;
            font-weight: 600;
            letter-spacing: 0.01em;
            opacity: 0;
            transform: translateY(8px);
            transition: opacity 160ms var(--widget-drag-ease), transform 160ms var(--widget-drag-ease);
        }

        .toast.is-visible {
            opacity: 1;
            transform: translateY(0);
        }

        .toast-success {
            border-left: 3px solid #10b981;
        }

        .toast-warning {
            border-left: 3px solid #f59e0b;
            background: rgba(255, 251, 235, 0.95);
        }

        .toast-error {
            border-left: 3px solid #ef4444;
            background: rgba(254, 242, 242, 0.95);
        }

        .toast-info {
            border-left: 3px solid #3b82f6;
            background: rgba(239, 246, 255, 0.95);
        }

        @media (max-width: 640px) {
            .toast-container {
                left: 12px;
                right: 12px;
                bottom: 16px;
            }

            .toast {
                width: 100%;
            }
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
            color: var(--text-muted-color);
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
            margin-bottom: -2px;
        }
        
        .tab:hover {
            color: #374151;
            background: #f9fafb;
        }

        .tab:focus-visible {
            outline: var(--focus-ring-width) solid var(--focus-ring-color);
            outline-offset: var(--focus-ring-offset);
            box-shadow: 0 0 0 3px var(--focus-ring-shadow);
        }
        
        .tab.active {
            color: #1d4ed8;
            border-bottom-color: #1d4ed8;
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
         
         /* Widget appearing animations */
         .widget-card.widget-appearing {
             animation: widgetSlideIn 0.4s ease-out, widgetFadeIn 0.4s ease-out;
             animation-fill-mode: both;
         }
         
         @keyframes widgetSlideIn {
             from {
                 transform: translateY(-20px);
                 opacity: 0;
             }
             to {
                 transform: translateY(0);
                 opacity: 1;
             }
         }
         
         @keyframes widgetFadeIn {
             from { opacity: 0; }
             to { opacity: 1; }
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
            color: var(--text-muted-color);
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
                display: flex;
                align-items: center;
                gap: 8px;
                flex-wrap: wrap;
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

            .priority-breakdown-row {
                grid-template-columns: 1fr auto;
            }

            .priority-sparkline {
                grid-column: 1 / -1;
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

            .widget-drop-indicator {
                min-height: 96px;
            }

            .widget-drop-ghost {
                font-size: 0.75rem;
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

            .widget-drop-indicator {
                min-height: 84px;
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
            color: var(--text-muted-color);
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
            color: var(--text-muted-color);
            margin-bottom: 4px;
        }
        
        .event-changed-by {
            font-size: 0.75rem;
            color: var(--text-muted-color);
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
            color: var(--text-muted-color);
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
            color: var(--text-muted-color);
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
            color: var(--text-muted-color);
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
            color: #1d4ed8;
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
            color: var(--text-muted-color);
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
            color: var(--text-muted-color);
            font-size: 0.875rem;
        }
        
        .task-detail-value {
            color: #1f2937;
            font-size: 0.875rem;
        }

        /* Enhanced Health Tab */
        .health-grid {
            --dashboard-grid-min-width: 300px;
            --dashboard-grid-gap: 20px;
            margin-bottom: 24px;
        }
        
        .health-card {
            background: white;
            border-radius: 12px;
            padding: var(--widget-padding);
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
            border-left: 4px solid #10b981;
            position: relative;
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
            margin: 0 0 12px;
        }
        
        .health-metric {
            display: flex;
            justify-content: space-between;
            padding: 8px 0;
            font-size: var(--widget-health-metric-size);
        }
        
        .health-metric-label {
            color: var(--text-muted-color);
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
<body data-widget-limit="20">
    <a class="skip-link" href="#dashboardMain">Skip to main content</a>
    <div id="dashboardRestoreOverlay" class="dashboard-restore-overlay is-hidden" aria-hidden="true" role="status" aria-live="polite">
        <div class="dashboard-restore-card">
            <span class="dashboard-restore-spinner" aria-hidden="true"></span>
            <span id="dashboardRestoreMessage">Restoring dashboard layout...</span>
        </div>
    </div>
    <div id="widgetMoveAnnouncement" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></div>
    <div class="container">
        <header class="header" role="banner">
            <h1>Task Manager Dashboard</h1>
            <div class="auto-refresh">
                <label for="autoRefreshSelect">Auto-refresh</label>
                <select id="autoRefreshSelect" aria-label="Auto-refresh interval">
                    <option value="off">Off</option>
                    <option value="30s">Every 30 seconds</option>
                    <option value="1m">Every minute</option>
                    <option value="5m">Every 5 minutes</option>
                </select>
            </div>
            <div class="status-bar">
                <span class="health-indicator" id="healthIndicator" role="img" aria-label="Daemon health: loading"></span>
                <span id="healthStatus" role="status" aria-live="polite">Loading...</span>
                <span>|</span>
                <span>PID: <strong id="daemonPid">-</strong></span>
                <span>|</span>
                <span>Uptime: <strong id="daemonUptime">-</strong></span>
                <span>|</span>
                <span>Memory: <strong id="memoryUsage">-</strong></span>
                <span>|</span>
                <span>Node: <strong id="nodeVersion">-</strong></span>
                <div
                    class="layout-save-indicator"
                    id="layoutSaveIndicator"
                    aria-live="polite"
                    aria-atomic="true"
                    aria-hidden="true"
                >
                    <span class="layout-save-icon" aria-hidden="true">&#10003;</span>
                    <span class="layout-save-text">Layout saved</span>
                    <button class="layout-save-retry" type="button" hidden>Retry</button>
                </div>
            </div>
        </header>

        <!-- Tabs Navigation -->
        <nav class="tabs" role="tablist" aria-label="Dashboard sections">
            <button class="tab active" data-tab="overview" id="tab-overview" role="tab" aria-controls="overview-tab" aria-selected="true" tabindex="0" type="button">Overview</button>
            <button class="tab" data-tab="widgets" id="tab-widgets" role="tab" aria-controls="widgets-tab" aria-selected="false" tabindex="-1" type="button">Widgets</button>
            <button class="tab" data-tab="queue" id="tab-queue" role="tab" aria-controls="queue-tab" aria-selected="false" tabindex="-1" type="button">Queue Status</button>
            <button class="tab" data-tab="tasks" id="tab-tasks" role="tab" aria-controls="tasks-tab" aria-selected="false" tabindex="-1" type="button">Tasks</button>
            <button class="tab" data-tab="create" id="tab-create" role="tab" aria-controls="create-tab" aria-selected="false" tabindex="-1" type="button">Create Task</button>
            <button class="tab" data-tab="history" id="tab-history" role="tab" aria-controls="history-tab" aria-selected="false" tabindex="-1" type="button">Task History</button>
            <button class="tab" data-tab="health" id="tab-health" role="tab" aria-controls="health-tab" aria-selected="false" tabindex="-1" type="button">Health</button>
            <button class="tab" data-tab="logs" id="tab-logs" role="tab" aria-controls="logs-tab" aria-selected="false" tabindex="-1" type="button">Activity Log</button>
        </nav>

        <!-- Overview Tab -->
        <main id="dashboardMain" class="dashboard-main" tabindex="-1">
        <section id="overview-tab" class="tab-content active" role="tabpanel" aria-labelledby="tab-overview" tabindex="0">
            <div id="dashboardEmptyState" class="dashboard-empty-state" hidden>
                <div class="dashboard-empty-card">
                    <div class="dashboard-empty-content">
                        <h2>Your dashboard is ready for its first widget</h2>
                        <p>Open the widget library to review available widgets and add the signals you want to track.</p>
                    </div>
                    <div class="dashboard-empty-actions">
                        <button class="btn btn-primary" type="button" id="openWidgetLibraryBtn" aria-controls="widgetLibraryList">
                            View widget library
                        </button>
                        <button class="btn btn-secondary" type="button" id="showAllWidgetsEmptyBtn">
                            Add all widgets
                        </button>
                    </div>
                </div>
            </div>
            <div class="metrics dashboard-grid" data-widget-container="overview-metrics">
                <div class="metric-card clickable" data-widget-id="overview-total" data-task-nav="tasks" tabindex="0" role="button" aria-label="View all tasks">
                    <div class="metric-value" id="totalTasks">-</div>
                    <div class="metric-label">Total Tasks</div>
                    <div class="metric-change positive" id="totalTasksChange">+0 today</div>
                </div>
                <div class="metric-card clickable" data-widget-id="overview-pending" data-task-nav="tasks" data-task-status="todo" tabindex="0" role="button" aria-label="View pending tasks">
                    <div class="metric-value" id="pendingTasks">-</div>
                    <div class="metric-label">Pending</div>
                    <div class="metric-change" id="pendingTasksChange">0% completion</div>
                </div>
                <div class="metric-card clickable" data-widget-id="overview-in-progress" data-task-nav="tasks" data-task-status="in-progress" tabindex="0" role="button" aria-label="View in-progress tasks">
                    <div class="metric-value" id="inProgressTasks">-</div>
                    <div class="metric-label">In Progress</div>
                    <div class="metric-change" id="inProgressTasksChange">Active now</div>
                </div>
                <div class="metric-card clickable" data-widget-id="overview-completed" data-task-nav="tasks" data-task-status="done" tabindex="0" role="button" aria-label="View completed tasks">
                    <div class="metric-value" id="completedTasks">-</div>
                    <div class="metric-label">Completed</div>
                    <div class="metric-change positive" id="completedTasksChange">+0 today</div>
                </div>
                <div class="metric-card clickable" data-widget-id="overview-connections" data-task-nav="tasks" tabindex="0" role="button" aria-label="View task list">
                    <div class="metric-value" id="wsConnections">-</div>
                    <div class="metric-label">Live Connections</div>
                    <div class="metric-change" id="connectionStatus">WebSocket</div>
                </div>
                <div class="metric-card clickable" data-widget-id="overview-high-priority" data-task-nav="tasks" data-task-priority="high" tabindex="0" role="button" aria-label="View high priority tasks">
                    <div class="metric-value" id="highPriorityTasks">-</div>
                    <div class="metric-label">High Priority</div>
                    <div class="metric-change negative" id="highPriorityUrgent">Needs attention</div>
                </div>
                <div class="metric-card status-breakdown clickable" data-widget-id="overview-status-breakdown" data-widget-label="Status Breakdown" data-task-nav="tasks" tabindex="0" role="button" aria-label="View tasks by status">
                    <div class="status-breakdown-header">
                        <div>
                        <h3 class="status-breakdown-title">Status Breakdown</h3>
                            <div class="status-breakdown-subtitle">Totals by workflow stage</div>
                        </div>
                        <div class="status-breakdown-total" id="statusBreakdownTotal" aria-live="polite">-</div>
                    </div>
                    <div class="status-breakdown-empty" id="statusBreakdownEmpty" hidden>
                        No tasks yet - create your first one!
                    </div>
                    <div class="status-breakdown-rows" id="statusBreakdownRows">
                        <div class="status-breakdown-row pending clickable" data-task-nav="tasks" data-task-status="todo" tabindex="0" role="button" aria-label="View pending tasks">
                            <div class="status-breakdown-label">
                                <span class="status-dot pending"></span>
                                <span>Pending</span>
                            </div>
                            <div class="status-breakdown-value">
                                <span class="status-breakdown-count" id="statusBreakdownPending" aria-live="polite">-</span>
                            </div>
                        </div>
                        <div class="status-breakdown-row in-progress clickable" data-task-nav="tasks" data-task-status="in-progress" tabindex="0" role="button" aria-label="View in-progress tasks">
                            <div class="status-breakdown-label">
                                <span class="status-dot in-progress"></span>
                                <span>In Progress</span>
                            </div>
                            <div class="status-breakdown-value">
                                <span class="status-breakdown-count" id="statusBreakdownInProgress" aria-live="polite">-</span>
                            </div>
                        </div>
                        <div class="status-breakdown-row completed clickable" data-task-nav="tasks" data-task-status="done" tabindex="0" role="button" aria-label="View completed tasks">
                            <div class="status-breakdown-label">
                                <span class="status-dot completed"></span>
                                <span>Completed</span>
                            </div>
                            <div class="status-breakdown-value">
                                <span class="status-breakdown-count" id="statusBreakdownCompleted" aria-live="polite">-</span>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="metric-card priority-breakdown clickable" data-widget-id="overview-priority-breakdown" data-task-nav="tasks" tabindex="0" role="button" aria-label="View tasks by priority">
                    <div class="priority-breakdown-header">
                        <div>
                            <h3 class="priority-breakdown-title">Priority Breakdown</h3>
                            <div class="priority-breakdown-subtitle">Distribution across task priorities</div>
                        </div>
                        <div class="priority-breakdown-total" id="priorityBreakdownTotal" aria-live="polite">-</div>
                    </div>
                    <div class="priority-breakdown-bar" role="img" aria-label="Priority distribution">
                        <div class="priority-breakdown-segment high" id="priorityBreakdownHighBar" style="width: 0%;"></div>
                        <div class="priority-breakdown-segment medium" id="priorityBreakdownMediumBar" style="width: 0%;"></div>
                        <div class="priority-breakdown-segment low" id="priorityBreakdownLowBar" style="width: 0%;"></div>
                    </div>
                    <div class="priority-breakdown-rows">
                        <div class="priority-breakdown-row clickable" data-task-nav="tasks" data-task-priority="high" tabindex="0" role="button" aria-label="View high priority tasks">
                            <div class="priority-breakdown-label">
                                <span class="priority-dot high"></span>
                                <span>High</span>
                            </div>
                            <div class="priority-breakdown-value">
                                <span class="priority-breakdown-count" id="priorityBreakdownHigh" aria-live="polite">-</span>
                                <span class="priority-breakdown-percent" id="priorityBreakdownHighPct">0%</span>
                            </div>
                            <svg class="priority-sparkline" viewBox="0 0 100 24" aria-hidden="true">
                                <polyline class="priority-sparkline-line high" id="prioritySparklineHigh" points="0,12 100,12"></polyline>
                            </svg>
                        </div>
                        <div class="priority-breakdown-row clickable" data-task-nav="tasks" data-task-priority="medium" tabindex="0" role="button" aria-label="View medium priority tasks">
                            <div class="priority-breakdown-label">
                                <span class="priority-dot medium"></span>
                                <span>Medium</span>
                            </div>
                            <div class="priority-breakdown-value">
                                <span class="priority-breakdown-count" id="priorityBreakdownMedium" aria-live="polite">-</span>
                                <span class="priority-breakdown-percent" id="priorityBreakdownMediumPct">0%</span>
                            </div>
                            <svg class="priority-sparkline" viewBox="0 0 100 24" aria-hidden="true">
                                <polyline class="priority-sparkline-line medium" id="prioritySparklineMedium" points="0,12 100,12"></polyline>
                            </svg>
                        </div>
                        <div class="priority-breakdown-row clickable" data-task-nav="tasks" data-task-priority="low" tabindex="0" role="button" aria-label="View low priority tasks">
                            <div class="priority-breakdown-label">
                                <span class="priority-dot low"></span>
                                <span>Low</span>
                            </div>
                            <div class="priority-breakdown-value">
                                <span class="priority-breakdown-count" id="priorityBreakdownLow" aria-live="polite">-</span>
                                <span class="priority-breakdown-percent" id="priorityBreakdownLowPct">0%</span>
                            </div>
                            <svg class="priority-sparkline" viewBox="0 0 100 24" aria-hidden="true">
                                <polyline class="priority-sparkline-line low" id="prioritySparklineLow" points="0,12 100,12"></polyline>
                            </svg>
                        </div>
                    </div>
                </div>
                <div class="metric-card activity-widget" data-widget-id="overview-recent-activity" data-widget-label="Recent Activity">
                    <div class="activity-widget-header">
                        <div>
                            <h3 class="activity-widget-title">Recent Activity</h3>
                            <div class="activity-widget-subtitle">Latest task updates</div>
                        </div>
                        <button class="activity-widget-action" type="button" data-task-nav="tasks" aria-label="View all tasks">
                            View tasks
                        </button>
                    </div>
                    <div id="recentActivityList" class="activity-widget-list" aria-live="polite" aria-busy="true">
                        <div class="loading">Loading recent activity...</div>
                    </div>
                </div>
                <div class="metric-card my-tasks-widget" data-widget-id="overview-my-tasks" data-widget-label="My Tasks">
                    <div class="my-tasks-header">
                        <div>
                            <h3 class="my-tasks-title">My Tasks</h3>
                            <div class="my-tasks-subtitle">Top tasks with quick actions</div>
                        </div>
                        <button class="my-tasks-action" type="button" data-task-nav="tasks" aria-label="View all tasks">
                            View all
                        </button>
                    </div>
                    <div id="myTasksList" class="my-tasks-list" aria-live="polite" aria-busy="true">
                        <div class="loading">Loading tasks...</div>
                    </div>
                </div>
            </div>
        </section>

        <!-- Widget Library Tab -->
        <section id="widgets-tab" class="tab-content" role="tabpanel" aria-labelledby="tab-widgets" tabindex="0" hidden>
            <div class="widget-library">
                <div class="widget-library-header">
                    <div>
                        <h2>Widget Library</h2>
                        <p>Select which widgets appear on your dashboard.</p>
                    </div>
                    <div class="widget-library-actions">
                        <button class="btn btn-primary btn-sm" id="addSelectedWidgetsBtn" disabled>
                            <span aria-hidden="true">➕</span>
                            <span id="addSelectedWidgetsLabel">Add Selected</span>
                        </button>
                        <button class="btn btn-secondary btn-sm" id="showAllWidgetsBtn">
                            <span aria-hidden="true">✅</span> Show All
                        </button>
                        <button class="btn btn-secondary btn-sm" id="hideAllWidgetsBtn">
                            <span aria-hidden="true">🙈</span> Hide All
                        </button>
                    </div>
                </div>
                <div class="widget-library-controls">
                    <div class="widget-library-search">
                        <label for="widgetLibrarySearch">Search widgets</label>
                        <input
                            type="search"
                            id="widgetLibrarySearch"
                            placeholder="Search widgets, IDs, or categories"
                            autocomplete="off"
                        >
                    </div>
                    <div
                        id="widgetLibraryFilterGroup"
                        class="widget-library-filter-group"
                        role="group"
                        aria-label="Filter widgets by category"
                    ></div>
                    <div class="widget-library-selection-summary">
                        <span id="widgetLibrarySelectionSummary">Showing 0 widgets.</span>
                        <button class="btn btn-secondary btn-sm" id="clearSelectedWidgetsBtn" type="button" disabled>
                            Clear selection
                        </button>
                    </div>
                </div>
                <div id="widgetLibraryResults" class="widget-library-results" role="status" aria-live="polite" aria-atomic="true"></div>
                <div id="widgetLimitMessage" class="widget-limit-message" role="status" aria-live="polite" aria-hidden="true" hidden></div>
                <div id="widgetLibraryList" class="widget-library-sections widget-library-list widget-library-catalog"></div>
            </div>
        </section>

        <!-- Create Task Tab -->
        <section id="create-tab" class="tab-content" role="tabpanel" aria-labelledby="tab-create" tabindex="0" hidden>
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
                            <span aria-hidden="true">✨</span> Create Task
                        </button>
                        <button type="reset" class="btn btn-secondary">
                            <span aria-hidden="true">🔄</span> Clear Form
                        </button>
                    </div>
                </form>
            </div>
        </section>

        <!-- Queue Status Tab -->
        <section id="queue-tab" class="tab-content" role="tabpanel" aria-labelledby="tab-queue" tabindex="0" hidden>
            <div class="metrics dashboard-grid" data-widget-container="queue-metrics">
                <div class="metric-card clickable" data-widget-id="queue-total" data-task-nav="tasks" data-task-status="todo" tabindex="0" role="button" aria-label="View queued tasks">
                    <div class="metric-value" id="queueTotal">-</div>
                    <div class="metric-label">Total Tasks in Queue</div>
                </div>
                <div class="metric-card clickable" data-widget-id="queue-high-priority" data-task-nav="tasks" data-task-status="todo" data-task-priority="high" tabindex="0" role="button" aria-label="View high priority queued tasks">
                    <div class="metric-value" id="queueHighPriority">-</div>
                    <div class="metric-label">High Priority</div>
                </div>
                <div class="metric-card clickable" data-widget-id="queue-avg-processing" data-task-nav="tasks" data-task-status="todo" tabindex="0" role="button" aria-label="View queued tasks">
                    <div class="metric-value" id="queueAvgProcessingTime">-</div>
                    <div class="metric-label">Avg Processing Time</div>
                </div>
                <div class="metric-card clickable" data-widget-id="queue-failed" data-task-nav="tasks" data-task-status="failed" tabindex="0" role="button" aria-label="View failed tasks">
                    <div class="metric-value" id="queueFailed">-</div>
                    <div class="metric-label">Failed Tasks</div>
                </div>
            </div>

            <div class="tasks-section">
                <div class="tasks-header">
                    <h2>Queue by Priority</h2>
                    <div class="form-actions">
                        <button class="btn btn-primary btn-sm" onclick="loadQueueStatus()">
                            <span aria-hidden="true">🔄</span> Refresh
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
                        <button class="btn btn-secondary btn-sm" onclick="retryAllFailed()">Retry All Failed</button>
                    </div>
                </div>
                <div id="failedTasksList" class="loading">Loading failed tasks...</div>
            </div>
        </section>

        <!-- Tasks Tab -->
        <section id="tasks-tab" class="tab-content" role="tabpanel" aria-labelledby="tab-tasks" tabindex="0" hidden>
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
                            <span aria-hidden="true">🔄</span> Refresh
                        </button>
                        <button class="btn btn-secondary btn-sm" id="toggleBulkActionsBtn" aria-controls="bulkActionsPanel" aria-expanded="false" onclick="toggleBulkActions()">
                            <span aria-hidden="true">☑️</span> Bulk Actions
                        </button>
                    </div>
                </div>
                
                <!-- Bulk Actions Panel -->
                <div id="bulkActionsPanel" style="margin-bottom: 20px;" hidden aria-hidden="true" role="region" aria-label="Bulk actions">
                    <div class="bulk-actions-container">
                        <div class="bulk-actions-info">
                            <span id="selectedCount" aria-live="polite" aria-atomic="true">0</span> tasks selected
                        </div>
                        <div class="bulk-actions-buttons">
                            <button class="btn btn-secondary btn-sm" onclick="selectAllTasks()">
                                <span aria-hidden="true">☑️</span> Select All
                            </button>
                            <button class="btn btn-secondary btn-sm" onclick="clearSelection()">
                                <span aria-hidden="true">❌</span> Clear Selection
                            </button>
                            <div class="action-separator"></div>
                            <select id="bulkPrioritySelect" class="bulk-select" aria-label="Bulk set priority">
                                <option value="">Set Priority...</option>
                                <option value="high">High Priority</option>
                                <option value="medium">Medium Priority</option>
                                <option value="low">Low Priority</option>
                            </select>
                            <button class="btn btn-warning btn-sm" onclick="bulkSetPriority()">
                                <span aria-hidden="true">⚡</span> Set Priority
                            </button>
                            <div class="action-separator"></div>
                            <button class="btn btn-success btn-sm" onclick="bulkResume()">
                                <span aria-hidden="true">▶️</span> Resume
                            </button>
                            <button class="btn btn-danger btn-sm" onclick="bulkCancel()">
                                <span aria-hidden="true">⏹️</span> Cancel
                            </button>
                            <button class="btn btn-danger btn-sm" onclick="bulkDelete()">
                                <span aria-hidden="true">🗑️</span> Delete
                            </button>
                        </div>
                    </div>
                </div>
                
                <div id="tasksList" class="loading">Loading tasks...</div>
            </div>
        </section>

        <!-- Health Tab -->
        <section id="health-tab" class="tab-content" role="tabpanel" aria-labelledby="tab-health" tabindex="0" hidden>
            <div class="health-grid dashboard-grid" data-widget-container="health-grid">
                <div class="health-card" data-widget-id="health-system">
                    <h3 class="health-title"><span aria-hidden="true">🏥️</span> System Health</h3>
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
                    <h3 class="health-title"><span aria-hidden="true">💾</span> Memory Usage</h3>
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
                    <h3 class="health-title"><span aria-hidden="true">🔌</span> Connections</h3>
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
                    <h3 class="health-title"><span aria-hidden="true">🖥️</span> System Info</h3>
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
                    <h3 class="health-title"><span aria-hidden="true">📊</span> Task Performance</h3>
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
                    <h3 class="health-title"><span aria-hidden="true">⚙️</span> Daemon Controls</h3>
                    <div class="health-metric">
                        <span class="health-metric-label">Processing Status:</span>
                        <span class="health-metric-value" id="daemonProcessingStatus">-</span>
                    </div>
                    <div class="health-metric">
                        <span class="health-metric-label">Controls:</span>
                        <div style="display: flex; gap: 8px; margin-top: 8px;">
                            <button class="btn btn-warning btn-sm" id="pauseDaemonBtn" onclick="pauseDaemon()">
                                <span aria-hidden="true">⏸️</span> Pause
                            </button>
                            <button class="btn btn-success btn-sm" id="resumeDaemonBtn" onclick="resumeDaemon()" style="display: none;">
                                <span aria-hidden="true">▶️</span> Resume
                            </button>
                            <button class="btn btn-danger btn-sm" onclick="restartDaemon()">
                                <span aria-hidden="true">🔄</span> Restart
                            </button>
                        </div>
                    </div>
                </div>

                <div class="health-card" data-widget-id="health-alerts">
                    <h3 class="health-title"><span aria-hidden="true">⚠️</span> System Alerts</h3>
                    <div id="healthAlerts" class="health-alerts">
                        <div class="loading">Loading system alerts...</div>
                    </div>
                </div>
            </div>
        </section>

        <!-- Task History Tab -->
        <section id="history-tab" class="tab-content" role="tabpanel" aria-labelledby="tab-history" tabindex="0" hidden>
            <div class="tasks-section">
                <div class="tasks-header">
                    <h2>Task History & Audit Trail</h2>
                    <div class="form-actions">
                        <button class="btn btn-primary btn-sm" onclick="loadAuditHistory()">
                            <span aria-hidden="true">🔄</span> Refresh
                        </button>
                        <button class="btn btn-secondary btn-sm" onclick="loadAuditStatistics()">
                            <span aria-hidden="true">📊</span> Statistics
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
                            <span aria-hidden="true">🔍</span> Apply Filters
                        </button>
                        <button class="btn btn-secondary btn-sm" onclick="clearHistoryFilters()">
                            <span aria-hidden="true">🗑️</span> Clear
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
        </section>

        <!-- Activity Log Tab -->
        <section id="logs-tab" class="tab-content" role="tabpanel" aria-labelledby="tab-logs" tabindex="0" hidden>
            <div class="tasks-section">
                <div class="tasks-header">
                    <h2>Activity Log</h2>
                    <div class="form-actions">
                        <button class="btn btn-primary btn-sm" onclick="loadLogs()">
                            <span aria-hidden="true">🔄</span> Refresh
                        </button>
                        <select id="logLimit" aria-label="Log entries limit">
                            <option value="25">Last 25</option>
                            <option value="50" selected>Last 50</option>
                            <option value="100">Last 100</option>
                        </select>
                    </div>
                </div>
                <div id="logsList" class="loading">Loading activity log...</div>
            </div>
        </section>
        </main>
    </div>

    <!-- Task Details Modal -->
    <div id="taskModal" class="modal" role="dialog" aria-modal="true" aria-labelledby="taskModalTitle" aria-describedby="modalTaskContent" aria-hidden="true">
        <div class="modal-content" tabindex="-1">
            <div class="modal-header">
                <h3 class="modal-title" id="taskModalTitle">Task Details</h3>
                <button class="modal-close" type="button" data-modal-close aria-label="Close task details" onclick="closeTaskModal()">&times;</button>
            </div>
            <div id="modalTaskContent">
                <!-- Task details will be loaded here -->
            </div>
        </div>
    </div>

    <script id="dashboardWidgetState" type="application/json">${widgetStateJson}</script>
    <script data-dashboard="true">
        let refreshInterval = null;
        let wsConnection;
        let currentTasks = [];
        let previousMetrics = null;
        let metricsInitialized = false;
        const METRICS_LOADING_CLASS = "metrics-loading";
        const PRIORITY_LEVELS = ["high", "medium", "low"];
        const PRIORITY_FILTER_CLASSES = {
            high: "priority-highlight-high",
            medium: "priority-highlight-medium",
            low: "priority-highlight-low",
        };
        const PRIORITY_SPARKLINE_POINTS = 18;
        const PRIORITY_SPARKLINE_WIDTH = 100;
        const PRIORITY_SPARKLINE_HEIGHT = 24;
        const RECENT_ACTIVITY_LIMIT = 8;
        const RECENT_ACTIVITY_REFRESH_MS = 30000;
        const RECENT_ACTIVITY_STATUS_VALUES = ["todo", "in-progress", "done", "failed", "cancelled"];
        const RECENT_ACTIVITY_PRIORITY_VALUES = ["high", "medium", "low"];
        const RECENT_ACTIVITY_WIDGET_ID = "overview-recent-activity";
        const WIDGET_NOTIFICATION_TYPES = [
            { id: "task_created", label: "Task created" },
            { id: "task_status_changed", label: "Status changed" },
            { id: "task_priority_changed", label: "Priority changed" },
            { id: "task_completed", label: "Completed" },
            { id: "task_failed", label: "Failed" },
            { id: "task_deleted", label: "Deleted" },
        ];
        const WIDGET_NOTIFICATION_PRESET_ALL = "all";
        const WIDGET_NOTIFICATION_PRESET_NONE = "none";
        const WIDGET_NOTIFICATION_PRESET_CUSTOM = "custom";
        const WIDGET_NOTIFICATION_PULSE_MS = 2200;
        const MY_TASKS_WIDGET_LIMIT = 8;
        const MY_TASKS_STATUS_VALUES = ["todo", "in-progress", "done", "failed", "cancelled"];
        const MY_TASKS_PRIORITY_VALUES = ["high", "medium", "low"];
        const MY_TASKS_PRIORITY_RANK = { high: 3, medium: 2, low: 1 };
        const AUTO_REFRESH_OPTIONS = {
            off: { label: "Off", intervalMs: 0 },
            "30s": { label: "Every 30 seconds", intervalMs: 30000 },
            "1m": { label: "Every minute", intervalMs: 60000 },
            "5m": { label: "Every 5 minutes", intervalMs: 300000 },
        };
        const AUTO_REFRESH_DEFAULT = "30s";
        const AUTO_REFRESH_STORAGE_KEY = "dashboardAutoRefreshRate.v1";
        const DASHBOARD_TAB_SEQUENCE = [
            "overview",
            "widgets",
            "queue",
            "tasks",
            "create",
            "history",
            "health",
            "logs",
        ];
        const DASHBOARD_GRID_BREAKPOINTS = {
            mobileMax: 767,
            tabletMax: 1024,
        };
        const DASHBOARD_GRID_RANGES = {
            mobile: { min: 1, max: 1 },
            tablet: { min: 2, max: 3 },
            desktop: { min: 3, max: 4 },
        };
        let autoRefreshRate = AUTO_REFRESH_DEFAULT;
        const prefersReducedMotion = typeof window !== "undefined" && typeof window.matchMedia === "function"
            ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
            : false;
        let priorityBreakdownState = {
            high: { value: 0, history: [] },
            medium: { value: 0, history: [] },
            low: { value: 0, history: [] },
        };
        let priorityBreakdownAnimationIds = {};
        let recentActivityInitialized = false;
        let recentActivityLastFetchedAt = 0;
        let recentActivityRequest = null;
        let lastFocusedElement = null;
        const MODAL_FOCUSABLE_SELECTOR =
            "button, [href], input, select, textarea, [tabindex]:not([tabindex=\"-1\"])";

        // Tab Management
        function initTabs() {
            const tabButtons = Array.from(document.querySelectorAll(".tab"));
            const tabContents = Array.from(document.querySelectorAll(".tab-content"));

            const syncTabState = (tabName, options) => {
                if (!tabName) {
                    return;
                }
                const shouldLoad = options?.load !== false;
                tabButtons.forEach(button => {
                    const isActive = button.dataset.tab === tabName;
                    button.classList.toggle("active", isActive);
                    button.setAttribute("aria-selected", isActive ? "true" : "false");
                    button.setAttribute("tabindex", isActive ? "0" : "-1");
                });
                tabContents.forEach(content => {
                    const isActive = content.id === tabName + "-tab";
                    content.classList.toggle("active", isActive);
                    if (content instanceof HTMLElement) {
                        content.hidden = !isActive;
                    }
                    content.setAttribute("aria-hidden", isActive ? "false" : "true");
                });
                if (!shouldLoad) {
                    return;
                }
                if (tabName === "overview") loadRecentActivityWidget();
                if (tabName === "queue") loadQueueStatus();
                if (tabName === "tasks") loadTasks();
                if (tabName === "health") loadHealthDetails();
                if (tabName === "logs") loadLogs();
                if (tabName === "history") loadAuditHistory();
                if (tabName === "widgets") renderWidgetLibrary();
                applyResponsiveDashboardGrid();
            };

            tabButtons.forEach((button, index) => {
                button.addEventListener("click", () => {
                    syncTabState(button.dataset.tab, { load: true });
                });
                button.addEventListener("keydown", (event) => {
                    const key = event.key;
                    if (key !== "ArrowRight" && key !== "ArrowLeft" && key !== "Home" && key !== "End") {
                        return;
                    }
                    event.preventDefault();
                    if (tabButtons.length === 0) {
                        return;
                    }
                    let nextIndex = index;
                    if (key === "ArrowRight") {
                        nextIndex = (index + 1) % tabButtons.length;
                    } else if (key === "ArrowLeft") {
                        nextIndex = (index - 1 + tabButtons.length) % tabButtons.length;
                    } else if (key === "Home") {
                        nextIndex = 0;
                    } else if (key === "End") {
                        nextIndex = tabButtons.length - 1;
                    }
                    const nextButton = tabButtons[nextIndex];
                    nextButton.focus();
                    nextButton.click();
                });
            });

            const initialActive = tabButtons.find(button => button.classList.contains("active"));
            const initialTabName = initialActive?.dataset.tab || tabButtons[0]?.dataset.tab;
            syncTabState(initialTabName, { load: false });
        }

        function isEditableTarget(target) {
            if (!(target instanceof HTMLElement)) {
                return false;
            }
            if (target.isContentEditable) {
                return true;
            }
            const tagName = target.tagName;
            return tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT";
        }

        function getActiveTabName() {
            const activeButton = document.querySelector(".tab.active");
            if (activeButton instanceof HTMLElement && activeButton.dataset.tab) {
                return activeButton.dataset.tab;
            }
            const activeContent = document.querySelector(".tab-content.active");
            if (activeContent instanceof HTMLElement && activeContent.id.endsWith("-tab")) {
                return activeContent.id.replace("-tab", "");
            }
            return null;
        }

        function activateTab(tabName, options) {
            const tabButton = document.querySelector("[data-tab=\"" + tabName + "\"]");
            if (!(tabButton instanceof HTMLElement)) {
                return false;
            }
            tabButton.click();
            if (options?.focus === true && typeof tabButton.focus === "function") {
                tabButton.focus({ preventScroll: true });
            }
            return true;
        }

        function focusWidgetLibrarySearch() {
            activateTab("widgets");
            const searchInput = document.getElementById("widgetLibrarySearch");
            if (searchInput instanceof HTMLInputElement) {
                searchInput.focus({ preventScroll: true });
                searchInput.select();
            }
        }

        function refreshActiveTab() {
            const activeTab = getActiveTabName();
            if (!activeTab) {
                requestMetricsRefresh();
                return;
            }
            if (activeTab === "overview") {
                requestMetricsRefresh();
                loadRecentActivityWidget();
                return;
            }
            if (activeTab === "queue") {
                loadQueueStatus();
                return;
            }
            if (activeTab === "tasks") {
                loadTasks();
                return;
            }
            if (activeTab === "health") {
                loadHealthDetails();
                return;
            }
            if (activeTab === "logs") {
                loadLogs();
                return;
            }
            if (activeTab === "history") {
                loadAuditHistory();
                return;
            }
            if (activeTab === "widgets") {
                renderWidgetLibrary();
                return;
            }
            requestMetricsRefresh();
        }

        function setTextIfPresent(id, value) {
            const element = document.getElementById(id);
            if (!(element instanceof HTMLElement)) {
                return;
            }
            element.textContent = value;
        }

        function toSafeNumber(value) {
            const numberValue = Number(value);
            return Number.isFinite(numberValue) ? numberValue : 0;
        }

        function setMetricsLoadingState(isLoading) {
            const containers = document.querySelectorAll(".metrics, .health-grid");
            containers.forEach(container => {
                if (!(container instanceof HTMLElement)) {
                    return;
                }
                if (isLoading) {
                    container.classList.add(METRICS_LOADING_CLASS);
                    container.setAttribute("aria-busy", "true");
                    return;
                }
                container.classList.remove(METRICS_LOADING_CLASS);
                container.setAttribute("aria-busy", "false");
            });
        }

        function setPriorityFilterHighlight(priority) {
            const filter = document.getElementById("priorityFilter");
            if (!(filter instanceof HTMLSelectElement)) {
                return;
            }
            const classes = Object.values(PRIORITY_FILTER_CLASSES);
            filter.classList.remove(...classes);
            if (priority === "high" || priority === "medium" || priority === "low") {
                filter.classList.add(PRIORITY_FILTER_CLASSES[priority]);
            }
        }

        function navigateToTasksWithFilters(filters) {
            const statusValue = typeof filters?.status === "string" && filters.status.length > 0
                ? filters.status
                : "all";
            const priorityValue = typeof filters?.priority === "string" && filters.priority.length > 0
                ? filters.priority
                : "all";
            const statusFilter = document.getElementById("statusFilter");
            if (statusFilter instanceof HTMLSelectElement) {
                statusFilter.value = statusValue;
            }
            const priorityFilter = document.getElementById("priorityFilter");
            if (priorityFilter instanceof HTMLSelectElement) {
                priorityFilter.value = priorityValue;
            }
            setPriorityFilterHighlight(priorityValue);
            const tasksTab = document.querySelector("[data-tab=\"tasks\"]");
            if (tasksTab instanceof HTMLElement) {
                tasksTab.click();
                return;
            }
            loadTasks();
        }

        function extractTaskFilters(element) {
            const status = element.dataset.taskStatus;
            const priority = element.dataset.taskPriority;
            return {
                status: typeof status === "string" && status.length > 0 ? status : "all",
                priority: typeof priority === "string" && priority.length > 0 ? priority : "all",
            };
        }

        function initMetricNavigation() {
            document.addEventListener("click", (event) => {
                const target = event.target;
                if (!(target instanceof HTMLElement)) {
                    return;
                }
                if (widgetDragState && widgetDragState.dragging) {
                    return;
                }
                const trigger = target.closest("[data-task-nav=\"tasks\"]");
                if (!(trigger instanceof HTMLElement)) {
                    return;
                }
                event.preventDefault();
                navigateToTasksWithFilters(extractTaskFilters(trigger));
            });

            document.addEventListener("keydown", (event) => {
                if (event.key !== "Enter" && event.key !== " ") {
                    return;
                }
                const target = event.target;
                if (!(target instanceof HTMLElement)) {
                    return;
                }
                if (widgetDragState && widgetDragState.dragging) {
                    return;
                }
                const trigger = target.closest("[data-task-nav=\"tasks\"]");
                if (!(trigger instanceof HTMLElement)) {
                    return;
                }
                event.preventDefault();
                navigateToTasksWithFilters(extractTaskFilters(trigger));
            });
        }

        function initMyTasksWidgetActions() {
            document.addEventListener("click", (event) => {
                const target = event.target;
                if (!(target instanceof HTMLElement)) {
                    return;
                }
                if (widgetDragState && widgetDragState.dragging) {
                    return;
                }
                const actionButton = target.closest("[data-my-task-action]");
                if (!(actionButton instanceof HTMLButtonElement)) {
                    return;
                }
                const action = actionButton.dataset.myTaskAction;
                const taskId = actionButton.dataset.taskId;
                if (!action || !taskId) {
                    return;
                }
                event.preventDefault();
                event.stopPropagation();
                if (action === "complete") {
                    const status = actionButton.dataset.taskStatus;
                    if (status === "done" || status === "cancelled" || actionButton.disabled) {
                        return;
                    }
                    void updateTaskStatus(taskId, "done");
                    return;
                }
                if (action === "priority") {
                    const currentPriority = normalizeMyTaskPriority(actionButton.dataset.taskPriority);
                    const promptValue = prompt(
                        "Set priority (high, medium, low):",
                        currentPriority,
                    );
                    if (!promptValue) {
                        return;
                    }
                    const nextPriority = promptValue.trim().toLowerCase();
                    if (!MY_TASKS_PRIORITY_VALUES.includes(nextPriority)) {
                        showError("Priority must be high, medium, or low.");
                        return;
                    }
                    if (nextPriority === currentPriority) {
                        return;
                    }
                    void updateTaskPriority(taskId, nextPriority);
                    return;
                }
                if (action === "view") {
                    viewTaskDetails(taskId);
                }
            });
        }

        function applyMetricsUpdate(payload) {
            if (!payload || typeof payload !== "object") {
                return;
            }
            const data = payload;
            const tasks = data.tasks && typeof data.tasks === "object" ? data.tasks : {};
            const health = data.health && typeof data.health === "object" ? data.health : {};
            const daemon = data.daemon && typeof data.daemon === "object" ? data.daemon : {};
            const system = data.system && typeof data.system === "object" ? data.system : {};
            const recentTasks = Array.isArray(tasks.recent) ? tasks.recent : [];
            const taskTotals = {
                total: toSafeNumber(tasks.total),
                pending: toSafeNumber(tasks.pending),
                inProgress: toSafeNumber(tasks.inProgress),
                completed: toSafeNumber(tasks.completed),
            };
            const byPriority = tasks.byPriority && typeof tasks.byPriority === "object" ? tasks.byPriority : {};
            const highPriority = toSafeNumber(byPriority.high);
            const wsConnections = toSafeNumber(health.wsConnections);
            const memoryUsagePercent = toSafeNumber(health.memoryUsage);
            const healthStatusValue = typeof health.status === "string" && health.status
                ? health.status
                : "degraded";
            const healthStatusLabel = healthStatusValue.charAt(0).toUpperCase() + healthStatusValue.slice(1);
            const daemonMemory = daemon.memory && typeof daemon.memory === "object" ? daemon.memory : {};

            setTextIfPresent("daemonPid", daemon.pid !== undefined ? String(daemon.pid) : "-");
            setTextIfPresent("daemonUptime", formatUptime(toSafeNumber(daemon.uptime)));
            setTextIfPresent("memoryUsage", memoryUsagePercent + "%");
            setTextIfPresent("nodeVersion", typeof system.nodeVersion === "string" ? system.nodeVersion : "-");

            const healthIndicator = document.getElementById("healthIndicator");
            if (healthIndicator instanceof HTMLElement) {
                healthIndicator.className = "health-indicator " + healthStatusValue;
                healthIndicator.setAttribute("aria-label", "Daemon health: " + healthStatusLabel);
            }
            const healthStatus = document.getElementById("healthStatus");
            if (healthStatus instanceof HTMLElement) {
                healthStatus.textContent = healthStatusLabel;
            }

            if (previousMetrics) {
                updateMetricChanges(previousMetrics.tasks, tasks);
            }
            previousMetrics = data;

            setTextIfPresent("totalTasks", String(taskTotals.total));
            setTextIfPresent("pendingTasks", String(taskTotals.pending));
            setTextIfPresent("inProgressTasks", String(taskTotals.inProgress));
            setTextIfPresent("completedTasks", String(taskTotals.completed));
            setTextIfPresent("wsConnections", String(wsConnections));
            setTextIfPresent("highPriorityTasks", String(highPriority));

            const todayKey = new Date().toDateString();
            const createdToday = recentTasks.filter(task => new Date(task.createdAt).toDateString() === todayKey).length;
            const completedToday = recentTasks.filter(task => task.status === "done" &&
                new Date(task.updatedAt).toDateString() === todayKey).length;
            const completionRate = taskTotals.total > 0
                ? Math.round((taskTotals.completed / taskTotals.total) * 100)
                : 0;

            setTextIfPresent("totalTasksChange", "+ " + createdToday + " today");
            setTextIfPresent("pendingTasksChange", completionRate + "% completion");
            setTextIfPresent("inProgressTasksChange", taskTotals.inProgress > 0 ? "Active now" : "Idle");
            setTextIfPresent("completedTasksChange", "+ " + completedToday + " today");
            setTextIfPresent("connectionStatus", wsConnections > 0 ? "Connected" : "No connections");
            setTextIfPresent("highPriorityUrgent",
                highPriority > 5 ? "Urgent" : highPriority > 0 ? "Needs attention" : "None urgent");

            updatePriorityBreakdownWidget(byPriority);
            updateStatusBreakdownWidget(tasks);
            renderMyTasksWidget(recentTasks);

            setTextIfPresent("healthStatusDetailed", healthStatusValue.toUpperCase());
            setTextIfPresent("tcpConnection", health.tcpConnected ? "Connected" : "Disconnected");
            setTextIfPresent("systemPlatform", typeof system.platform === "string" ? system.platform : "-");
            setTextIfPresent("systemArch", typeof system.arch === "string" ? system.arch : "-");
            setTextIfPresent("totalMemory", formatBytes(toSafeNumber(system.totalmem)));
            setTextIfPresent("freeMemory", formatBytes(toSafeNumber(system.freemem)));
            setTextIfPresent("healthUptime", formatUptime(toSafeNumber(daemon.uptime)));
            setTextIfPresent("healthPid", daemon.pid !== undefined ? String(daemon.pid) : "-");
            setTextIfPresent("healthNodeVersion", typeof system.nodeVersion === "string" ? system.nodeVersion : "-");
            setTextIfPresent("memoryUsed", formatBytes(toSafeNumber(daemonMemory.heapUsed)));
            setTextIfPresent("memoryTotal", formatBytes(toSafeNumber(daemonMemory.heapTotal)));
            setTextIfPresent("memoryPercent", memoryUsagePercent + "%");
            setTextIfPresent("memoryExternal", formatBytes(toSafeNumber(daemonMemory.external)));
            setTextIfPresent("wsConnectionsHealth", String(wsConnections));
            setTextIfPresent("healthTotalTasks", String(taskTotals.total));
            setTextIfPresent("healthCompletionRate", completionRate + "%");

            metricsInitialized = true;
            setMetricsLoadingState(false);
        }

        // Enhanced Metrics Loading
        async function loadMetrics() {
            if (!metricsInitialized) {
                setMetricsLoadingState(true);
            }
            try {
                const response = await fetch("/api/metrics");
                const data = await response.json();
                applyMetricsUpdate(data);
            } catch (error) {
                console.error("Error loading metrics:", error);
                showError("Failed to load metrics");
                setMetricsLoadingState(false);
            }
        }

        function requestMetricsRefresh() {
            if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
                wsConnection.send(JSON.stringify({ type: "refresh_metrics" }));
                return Promise.resolve();
            }
            return loadMetrics();
        }

        function updatePriorityBreakdownWidget(byPriority) {
            if (!byPriority || typeof byPriority !== "object") {
                return;
            }
            const counts = {
                high: Number(byPriority.high) || 0,
                medium: Number(byPriority.medium) || 0,
                low: Number(byPriority.low) || 0,
            };
            const total = counts.high + counts.medium + counts.low;
            const nextState = PRIORITY_LEVELS.reduce((acc, level) => {
                const previous = priorityBreakdownState[level];
                const previousHistory = previous && Array.isArray(previous.history) ? previous.history : [];
                const nextHistory = previousHistory.concat(counts[level]).slice(-PRIORITY_SPARKLINE_POINTS);
                return { ...acc, [level]: { value: counts[level], history: nextHistory } };
            }, {});
            priorityBreakdownState = nextState;

            animatePriorityValue("priorityBreakdownTotal", total);
            updatePriorityBreakdownBar(counts, total);
            updatePriorityBreakdownRow("high", counts.high, total, nextState.high.history);
            updatePriorityBreakdownRow("medium", counts.medium, total, nextState.medium.history);
            updatePriorityBreakdownRow("low", counts.low, total, nextState.low.history);
        }

        function updateStatusBreakdownWidget(tasks) {
            if (!tasks || typeof tasks !== "object") {
                return;
            }
            const byStatus = tasks.byStatus && typeof tasks.byStatus === "object" ? tasks.byStatus : null;
            const counts = {
                pending: Number(byStatus?.todo ?? tasks.pending ?? 0) || 0,
                inProgress: Number(byStatus?.["in-progress"] ?? tasks.inProgress ?? 0) || 0,
                completed: Number(byStatus?.done ?? tasks.completed ?? 0) || 0,
            };
            const total = counts.pending + counts.inProgress + counts.completed;
            const overallTotal = Number(tasks.total);
            const hasOverallTotal = Number.isFinite(overallTotal);
            animatePriorityValue("statusBreakdownTotal", total);
            animatePriorityValue("statusBreakdownPending", counts.pending);
            animatePriorityValue("statusBreakdownInProgress", counts.inProgress);
            animatePriorityValue("statusBreakdownCompleted", counts.completed);
            const empty = document.getElementById("statusBreakdownEmpty");
            const rows = document.getElementById("statusBreakdownRows");
            const isEmpty = (hasOverallTotal ? overallTotal : total) === 0;
            if (empty instanceof HTMLElement) {
                empty.hidden = !isEmpty;
                empty.setAttribute("aria-hidden", isEmpty ? "false" : "true");
            }
            if (rows instanceof HTMLElement) {
                rows.hidden = isEmpty;
                rows.setAttribute("aria-hidden", isEmpty ? "true" : "false");
            }
        }

        function normalizeMyTaskStatus(value) {
            return typeof value === "string" && MY_TASKS_STATUS_VALUES.includes(value)
                ? value
                : "todo";
        }

        function normalizeMyTaskPriority(value) {
            return typeof value === "string" && MY_TASKS_PRIORITY_VALUES.includes(value)
                ? value
                : "medium";
        }

        function getMyTaskSortTime(task) {
            const timestamp = task?.updatedAt ?? task?.createdAt;
            const date = timestamp ? new Date(timestamp) : null;
            return date instanceof Date && !Number.isNaN(date.getTime()) ? date.getTime() : 0;
        }

        function buildMyTaskItem(task) {
            const taskId = typeof task?.id === "string" ? task.id : "";
            if (!taskId) {
                return "";
            }
            const title = typeof task?.title === "string" && task.title.trim().length > 0
                ? task.title
                : "Untitled task";
            const status = normalizeMyTaskStatus(task?.status);
            const priority = normalizeMyTaskPriority(task?.priority);
            const statusLabel = status.replace("-", " ");
            const assignedTo = typeof task?.assignedTo === "string" && task.assignedTo.trim().length > 0
                ? task.assignedTo
                : "Unassigned";
            const updatedAt = getMyTaskSortTime(task);
            const updatedLabel = updatedAt > 0 ? formatRelativeTime(new Date(updatedAt)) : "Unknown time";
            const disableComplete = status === "done" || status === "cancelled";
            const completeLabel = status === "done"
                ? "Completed"
                : status === "cancelled"
                    ? "Cancelled"
                    : "Complete";
            const safeTaskId = escapeHTML(taskId);
            const safeTitle = escapeHTML(title);
            const safeStatus = escapeHTML(statusLabel);
            const safePriority = escapeHTML(priority);
            const safeAssignee = escapeHTML(assignedTo);
            const safeUpdated = escapeHTML(updatedLabel);
            const completeAttributes = disableComplete ? " disabled aria-disabled=\"true\"" : "";

            return (
                "<div class=\"my-task-item\" data-task-id=\"" +
                safeTaskId +
                "\">" +
                "<div class=\"my-task-main\">" +
                "<div class=\"my-task-title\">" +
                safeTitle +
                "</div>" +
                "<div class=\"my-task-meta\">" +
                "<span class=\"status " +
                escapeHTML(status) +
                "\">" +
                safeStatus +
                "</span>" +
                "<span class=\"priority " +
                safePriority +
                "\">" +
                safePriority +
                "</span>" +
                "<span class=\"my-task-assignee\">Assignee: " +
                safeAssignee +
                "</span>" +
                "<span class=\"my-task-updated\">Updated " +
                safeUpdated +
                "</span>" +
                "</div>" +
                "</div>" +
                "<div class=\"my-task-actions\">" +
                "<button class=\"my-task-action-btn complete\" type=\"button\" data-my-task-action=\"complete\" data-task-id=\"" +
                safeTaskId +
                "\" data-task-status=\"" +
                escapeHTML(status) +
                "\"" +
                completeAttributes +
                ">" +
                completeLabel +
                "</button>" +
                "<button class=\"my-task-action-btn priority\" type=\"button\" data-my-task-action=\"priority\" data-task-id=\"" +
                safeTaskId +
                "\" data-task-priority=\"" +
                safePriority +
                "\">" +
                "Priority" +
                "</button>" +
                "<button class=\"my-task-action-btn view\" type=\"button\" data-my-task-action=\"view\" data-task-id=\"" +
                safeTaskId +
                "\">" +
                "Details" +
                "</button>" +
                "</div>" +
                "</div>"
            );
        }

        function renderMyTasksWidget(tasks) {
            const list = document.getElementById("myTasksList");
            if (!(list instanceof HTMLElement)) {
                return;
            }
            const normalized = Array.isArray(tasks)
                ? tasks.filter(task => task && typeof task.id === "string")
                : [];
            const ranked = normalized.slice().sort((a, b) => {
                const priorityA = MY_TASKS_PRIORITY_RANK[normalizeMyTaskPriority(a?.priority)] ?? 0;
                const priorityB = MY_TASKS_PRIORITY_RANK[normalizeMyTaskPriority(b?.priority)] ?? 0;
                if (priorityB !== priorityA) {
                    return priorityB - priorityA;
                }
                return getMyTaskSortTime(b) - getMyTaskSortTime(a);
            });
            const topTasks = ranked.slice(0, MY_TASKS_WIDGET_LIMIT);
            if (topTasks.length === 0) {
                list.innerHTML = "<div class=\"my-tasks-empty\">No tasks yet. Create one to get started.</div>";
                list.setAttribute("aria-busy", "false");
                return;
            }
            list.innerHTML = topTasks.map(buildMyTaskItem).filter(Boolean).join("");
            list.setAttribute("aria-busy", "false");
        }

        function updatePriorityBreakdownBar(counts, total) {
            const setWidth = (id, value) => {
                const element = document.getElementById(id);
                if (!(element instanceof HTMLElement)) {
                    return;
                }
                element.style.width = value + "%";
            };
            const resolvedTotal = total > 0 ? total : 0;
            const highPercent = resolvedTotal > 0 ? (counts.high / resolvedTotal) * 100 : 0;
            const mediumPercent = resolvedTotal > 0 ? (counts.medium / resolvedTotal) * 100 : 0;
            const lowPercent = resolvedTotal > 0 ? (counts.low / resolvedTotal) * 100 : 0;
            setWidth("priorityBreakdownHighBar", highPercent);
            setWidth("priorityBreakdownMediumBar", mediumPercent);
            setWidth("priorityBreakdownLowBar", lowPercent);
        }

        function updatePriorityBreakdownRow(level, count, total, history) {
            const label = level.charAt(0).toUpperCase() + level.slice(1);
            animatePriorityValue("priorityBreakdown" + label, count);
            const percentElement = document.getElementById("priorityBreakdown" + label + "Pct");
            if (percentElement instanceof HTMLElement) {
                const percent = total > 0 ? Math.round((count / total) * 100) : 0;
                percentElement.textContent = percent + "%";
            }
            const sparkline = document.getElementById("prioritySparkline" + label);
            if (sparkline instanceof SVGPolylineElement) {
                sparkline.setAttribute("points", buildSparklinePoints(history));
            }
        }

        function buildSparklinePoints(values) {
            const normalizedValues = Array.isArray(values) ? values : [];
            const width = PRIORITY_SPARKLINE_WIDTH;
            const height = PRIORITY_SPARKLINE_HEIGHT;
            const padding = 3;
            if (normalizedValues.length === 0) {
                return "0," + (height / 2) + " " + width + "," + (height / 2);
            }
            const min = Math.min(...normalizedValues);
            const max = Math.max(...normalizedValues);
            const range = Math.max(max - min, 1);
            if (normalizedValues.length === 1) {
                const value = normalizedValues[0];
                const normalized = (value - min) / range;
                const y = height - padding - normalized * (height - padding * 2);
                return "0," + y.toFixed(1) + " " + width + "," + y.toFixed(1);
            }
            const step = width / (normalizedValues.length - 1);
            return normalizedValues.map((value, index) => {
                const normalized = (value - min) / range;
                const x = index * step;
                const y = height - padding - normalized * (height - padding * 2);
                return x.toFixed(1) + "," + y.toFixed(1);
            }).join(" ");
        }

        function animatePriorityValue(elementId, nextValue) {
            const element = document.getElementById(elementId);
            if (!(element instanceof HTMLElement)) {
                return;
            }
            const normalizedNext = Number.isFinite(nextValue) ? nextValue : 0;
            const textValue = Number(element.textContent);
            const dataValue = Number(element.dataset.currentValue);
            const currentValue = Number.isFinite(textValue)
                ? textValue
                : Number.isFinite(dataValue)
                    ? dataValue
                    : 0;
            if (prefersReducedMotion || currentValue === normalizedNext) {
                element.textContent = String(normalizedNext);
                element.dataset.currentValue = String(normalizedNext);
                return;
            }
            const startValue = Number.isFinite(currentValue) ? currentValue : 0;
            const duration = 600;
            const startTime = performance.now();
            const existingId = priorityBreakdownAnimationIds[elementId];
            if (typeof existingId === "number") {
                cancelAnimationFrame(existingId);
            }
            const step = (now) => {
                const elapsed = now - startTime;
                const progress = Math.min(elapsed / duration, 1);
                const eased = 1 - Math.pow(1 - progress, 3);
                const value = Math.round(startValue + (normalizedNext - startValue) * eased);
                element.textContent = String(value);
                if (progress < 1) {
                    const nextId = requestAnimationFrame(step);
                    priorityBreakdownAnimationIds = { ...priorityBreakdownAnimationIds, [elementId]: nextId };
                    return;
                }
                element.dataset.currentValue = String(normalizedNext);
            };
            const nextId = requestAnimationFrame(step);
            priorityBreakdownAnimationIds = { ...priorityBreakdownAnimationIds, [elementId]: nextId };
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
            return [...tasks].sort((a, b) => {
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
                                <span><span aria-hidden="true">📅</span><span class="sr-only">Created: </span> \${createdDate.toLocaleDateString()}</span>
                                <span><span aria-hidden="true">👤</span><span class="sr-only">Assignee: </span> \${task.assignedTo || "Unassigned"}</span>
                                <span><span aria-hidden="true">🔄</span><span class="sr-only">Updated: </span> \${formatRelativeTime(updatedDate)}</span>
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
                    await requestMetricsRefresh();
                } else {
                    showError('Failed to update task: ' + (result.error || 'Unknown error'));
                }
            } catch (error) {
                showError('Failed to update task: ' + error.message);
            }
        }

        async function updateTaskPriority(taskId, priority) {
            try {
                const response = await fetch("/api/tasks/update", {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ id: taskId, priority }),
                });

                const result = await response.json();
                if (result.success) {
                    showSuccess("Task priority updated successfully!");
                    await loadTasks();
                    await requestMetricsRefresh();
                } else {
                    showError("Failed to update task priority: " + (result.error || "Unknown error"));
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : "Unknown error";
                showError("Failed to update task priority: " + message);
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
                        await requestMetricsRefresh();
                    } else {
                        showError('Failed to delete task: ' + (result.error || 'Unknown error'));
                    }
                } catch (error) {
                    showError('Failed to delete task: ' + error.message);
                }
            }
        }

        function getTaskModalElement() {
            const modal = document.getElementById("taskModal");
            return modal instanceof HTMLElement ? modal : null;
        }

        function getTaskModalFocusableElements(modal) {
            return Array.from(modal.querySelectorAll(MODAL_FOCUSABLE_SELECTOR))
                .filter(element => element instanceof HTMLElement && !element.hasAttribute("disabled"));
        }

        function focusTaskModal(modal) {
            const closeButton = modal.querySelector("[data-modal-close]");
            if (closeButton instanceof HTMLElement) {
                closeButton.focus();
                return;
            }
            const content = modal.querySelector(".modal-content");
            if (content instanceof HTMLElement) {
                content.focus();
            }
        }

        function trapTaskModalFocus(event) {
            if (event.key !== "Tab") {
                return;
            }
            const modal = getTaskModalElement();
            if (!modal || !modal.classList.contains("show")) {
                return;
            }
            const focusable = getTaskModalFocusableElements(modal);
            if (focusable.length === 0) {
                event.preventDefault();
                return;
            }
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            const active = document.activeElement;
            if (event.shiftKey) {
                if (active === first || !modal.contains(active)) {
                    event.preventDefault();
                    last.focus();
                }
                return;
            }
            if (active === last) {
                event.preventDefault();
                first.focus();
            }
        }

        function viewTaskDetails(taskId) {
            const task = currentTasks.find(t => t.id === taskId);
            if (!task) return;
            
            const modal = getTaskModalElement();
            const content = document.getElementById("modalTaskContent");
            const title = document.getElementById("taskModalTitle");
            if (!modal || !(content instanceof HTMLElement)) {
                return;
            }
            lastFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            if (title instanceof HTMLElement) {
                title.textContent = "Task Details: " + task.title;
            }
            
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
            
            modal.classList.add("show");
            modal.setAttribute("aria-hidden", "false");
            focusTaskModal(modal);
        }

        function closeTaskModal() {
            const modal = getTaskModalElement();
            if (!modal) {
                return;
            }
            modal.classList.remove("show");
            modal.setAttribute("aria-hidden", "true");
            if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
                lastFocusedElement.focus();
            }
            lastFocusedElement = null;
        }

        // Bulk Actions Functions
        let selectedTasks = new Set();
        let bulkActionsVisible = false;

        function toggleBulkActions() {
            const nextVisible = !bulkActionsVisible;
            bulkActionsVisible = nextVisible;
            const panel = document.getElementById("bulkActionsPanel");
            if (panel instanceof HTMLElement) {
                panel.hidden = !nextVisible;
                panel.setAttribute("aria-hidden", nextVisible ? "false" : "true");
            }
            const toggleButton = document.getElementById("toggleBulkActionsBtn");
            if (toggleButton instanceof HTMLElement) {
                toggleButton.setAttribute("aria-expanded", nextVisible ? "true" : "false");
            }
            
            // Add checkboxes to tasks if showing bulk actions
            if (nextVisible) {
                addTaskCheckboxes();
            } else {
                removeTaskCheckboxes();
            }
            
            updateBulkActionsUI();
        }

        function addTaskCheckboxes() {
            const taskItems = document.querySelectorAll(".task-item");
            taskItems.forEach(item => {
                if (!(item instanceof HTMLElement)) {
                    return;
                }
                const taskId = item.dataset.taskId;
                if (!taskId) {
                    return;
                }
                if (!item.querySelector(".task-checkbox")) {
                    const checkbox = document.createElement("input");
                    checkbox.type = "checkbox";
                    checkbox.className = "task-checkbox";
                    checkbox.dataset.taskId = taskId;
                    const titleElement = item.querySelector(".task-title");
                    const taskTitle = titleElement instanceof HTMLElement ? titleElement.textContent?.trim() : "";
                    const label = taskTitle ? "Select task " + taskTitle : "Select task " + taskId;
                    checkbox.setAttribute("aria-label", label);
                    checkbox.setAttribute("title", label);
                    checkbox.addEventListener("change", (event) => {
                        const target = event.target;
                        if (!(target instanceof HTMLInputElement)) {
                            return;
                        }
                        if (target.checked) {
                            selectedTasks.add(taskId);
                            item.classList.add("selected");
                        } else {
                            selectedTasks.delete(taskId);
                            item.classList.remove("selected");
                        }
                        updateBulkActionsUI();
                    });
                    
                    // Insert checkbox at the beginning of task-header
                    const header = item.querySelector(".task-header");
                    if (header instanceof HTMLElement) {
                        header.insertBefore(checkbox, header.firstChild);
                    }
                }
            });
        }

        function removeTaskCheckboxes() {
            const checkboxes = document.querySelectorAll(".task-checkbox");
            checkboxes.forEach(checkbox => checkbox.remove());
            
            const taskItems = document.querySelectorAll(".task-item");
            taskItems.forEach(item => {
                if (item instanceof HTMLElement) {
                    item.classList.remove("selected");
                }
            });
            
            selectedTasks.clear();
        }

        function selectAllTasks() {
            const checkboxes = document.querySelectorAll(".task-checkbox");
            checkboxes.forEach(checkbox => {
                if (!(checkbox instanceof HTMLInputElement)) {
                    return;
                }
                checkbox.checked = true;
                const taskId = checkbox.dataset.taskId;
                if (taskId) {
                    selectedTasks.add(taskId);
                }
                const taskItem = checkbox.closest(".task-item");
                if (taskItem instanceof HTMLElement) {
                    taskItem.classList.add("selected");
                }
            });
            updateBulkActionsUI();
        }

        function clearSelection() {
            const checkboxes = document.querySelectorAll(".task-checkbox");
            checkboxes.forEach(checkbox => {
                if (!(checkbox instanceof HTMLInputElement)) {
                    return;
                }
                checkbox.checked = false;
                const taskItem = checkbox.closest(".task-item");
                if (taskItem instanceof HTMLElement) {
                    taskItem.classList.remove("selected");
                }
            });
            selectedTasks.clear();
            updateBulkActionsUI();
        }

        function updateBulkActionsUI() {
            const selectedCount = document.getElementById("selectedCount");
            if (selectedCount instanceof HTMLElement) {
                selectedCount.textContent = String(selectedTasks.size);
            }
            
            // Enable/disable bulk action buttons based on selection
            const buttons = document.querySelectorAll(".bulk-actions-buttons button");
            buttons.forEach(button => {
                if (!(button instanceof HTMLButtonElement)) {
                    return;
                }
                const label = button.textContent || "";
                if (label.includes("Select All") || label.includes("Clear Selection")) {
                    return; // Always enable these
                }
                const isDisabled = selectedTasks.size === 0;
                button.disabled = isDisabled;
                button.setAttribute("aria-disabled", isDisabled ? "true" : "false");
            });
            const bulkPrioritySelect = document.getElementById("bulkPrioritySelect");
            if (bulkPrioritySelect instanceof HTMLSelectElement) {
                const isDisabled = selectedTasks.size === 0;
                bulkPrioritySelect.disabled = isDisabled;
                bulkPrioritySelect.setAttribute("aria-disabled", isDisabled ? "true" : "false");
            }
        }

        async function bulkSetPriority() {
            if (selectedTasks.size === 0) {
                return;
            }
            
            const bulkPrioritySelect = document.getElementById("bulkPrioritySelect");
            if (!(bulkPrioritySelect instanceof HTMLSelectElement)) {
                return;
            }
            const priority = bulkPrioritySelect.value;
            if (!priority) {
                showError("Please select a priority level");
                return;
            }
            
            if (!confirm("Set priority to " + priority + " for " + selectedTasks.size + " selected tasks?")) {
                return;
            }
            
            await performBulkAction("set_priority", { priority });
        }

        async function bulkResume() {
            if (selectedTasks.size === 0) {
                return;
            }
            
            if (!confirm("Resume " + selectedTasks.size + " selected tasks?")) {
                return;
            }
            
            await performBulkAction("resume");
        }

        async function bulkCancel() {
            if (selectedTasks.size === 0) {
                return;
            }
            
            if (!confirm("Cancel " + selectedTasks.size + " selected tasks?")) {
                return;
            }
            
            await performBulkAction("cancel");
        }

        async function bulkDelete() {
            if (selectedTasks.size === 0) {
                return;
            }
            
            if (!confirm("PERMANENTLY delete " + selectedTasks.size + " selected tasks? This action cannot be undone.")) {
                return;
            }
            
            await performBulkAction("delete");
        }

        async function performBulkAction(action, data = null) {
            try {
                showInfo("Performing " + action + " on " + selectedTasks.size + " tasks...");
                
                const taskIds = Array.from(selectedTasks);
                const response = await fetch("/api/tasks/bulk-action", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        action,
                        taskIds,
                        data
                    })
                });
                
                const result = await response.json();
                
                if (result.successful > 0) {
                    showSuccess(action + " completed successfully for " + result.successful + " tasks");
                }
                
                if (result.failed > 0) {
                    showError(action + " failed for " + result.failed + " tasks");
                }
                
                // Clear selection and refresh
                clearSelection();
                await loadTasks();
                await requestMetricsRefresh();
                
            } catch (error) {
                const message = error instanceof Error ? error.message : "Unknown error";
                showError("Failed to perform bulk action: " + message);
            }
        }

        async function loadHealthDetails() {
            // Health details are updated as part of metric refresh.
            // This function ensures that health tab is updated when switched to.
            await requestMetricsRefresh();
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
                    await requestMetricsRefresh();
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
                    await requestMetricsRefresh();
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
                                <span><span aria-hidden="true">⏱️</span><span class="sr-only">Queued: </span> \${formatRelativeTime(createdDate)}</span>
                                <span><span aria-hidden="true">🔄</span><span class="sr-only">Wait time: </span> \${formatUptime(waitTime / 1000)}</span>
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
                                <span><span aria-hidden="true">🕒</span><span class="sr-only">Last update: </span> \${new Date(task.updatedAt).toLocaleString()}</span>
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
                    await requestMetricsRefresh();
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
                    await requestMetricsRefresh();
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
                    await requestMetricsRefresh();
                } else {
                    showError('No tasks could be retried');
                }
            } catch (error) {
                showError('Failed to retry failed tasks: ' + error.message);
            }
        }

        function normalizeActivityFilterValue(value, allowedValues) {
            if (typeof value !== "string") {
                return "all";
            }
            return allowedValues.includes(value) ? value : "all";
        }

        function setRecentActivityLoadingState(list, isLoading) {
            if (!(list instanceof HTMLElement)) {
                return;
            }
            if (isLoading) {
                list.classList.add("activity-widget-loading");
                list.setAttribute("aria-busy", "true");
                if (!recentActivityInitialized) {
                    list.innerHTML = "<div class=\"loading\">Loading recent activity...</div>";
                }
                return;
            }
            list.classList.remove("activity-widget-loading");
            list.setAttribute("aria-busy", "false");
        }

        function renderRecentActivityEmpty(list) {
            if (!(list instanceof HTMLElement)) {
                return;
            }
            list.innerHTML = "<div class=\"activity-widget-empty\">No recent activity yet.</div>";
        }

        function renderRecentActivityError(list, message) {
            if (!(list instanceof HTMLElement)) {
                return;
            }
            const safeMessage = escapeHTML(message || "Failed to load recent activity.");
            list.innerHTML = "<div class=\"activity-widget-error\">" + safeMessage + "</div>";
        }

        function buildRecentActivityItem(log) {
            const message = log && typeof log.message === "string" ? log.message : "Task updated";
            const data = log && typeof log.data === "object" ? log.data : null;
            const statusValue = normalizeActivityFilterValue(data?.status, RECENT_ACTIVITY_STATUS_VALUES);
            const priorityValue = normalizeActivityFilterValue(data?.priority, RECENT_ACTIVITY_PRIORITY_VALUES);
            const statusAttr = statusValue !== "all" ? " data-task-status=\"" + statusValue + "\"" : "";
            const priorityAttr = priorityValue !== "all" ? " data-task-priority=\"" + priorityValue + "\"" : "";
            const timestampValue = log?.timestamp;
            const timestamp = typeof timestampValue === "string" || typeof timestampValue === "number"
                ? new Date(timestampValue)
                : null;
            const isValidDate = timestamp instanceof Date && !Number.isNaN(timestamp.getTime());
            const relativeTime = isValidDate ? formatRelativeTime(timestamp) : "Unknown time";
            const absoluteTime = isValidDate ? timestamp.toLocaleString() : "Unknown time";
            const metaItems = [];

            if (statusValue !== "all") {
                metaItems.push(
                    "<span class=\"status " +
                    statusValue +
                    "\">" +
                    escapeHTML(statusValue.replace("-", " ")) +
                    "</span>",
                );
            }
            if (priorityValue !== "all") {
                metaItems.push(
                    "<span class=\"priority " +
                    priorityValue +
                    "\">" +
                    escapeHTML(priorityValue) +
                    "</span>",
                );
            }

            const metaMarkup = metaItems.length > 0
                ? "<div class=\"activity-widget-meta\">" + metaItems.join("") + "</div>"
                : "";

            return (
                "<button class=\"activity-widget-item\" type=\"button\" data-task-nav=\"tasks\"" +
                statusAttr +
                priorityAttr +
                ">" +
                "<div class=\"activity-widget-item-main\">" +
                "<div class=\"activity-widget-message\">" +
                escapeHTML(message) +
                "</div>" +
                metaMarkup +
                "</div>" +
                "<span class=\"activity-widget-time\" title=\"" +
                escapeHTML(absoluteTime) +
                "\">" +
                escapeHTML(relativeTime) +
                "</span>" +
                "</button>"
            );
        }

        function shouldShowRecentActivityNotifications() {
            const preference = getWidgetNotificationPreference(RECENT_ACTIVITY_WIDGET_ID);
            if (!preference.enabled) {
                return false;
            }
            const normalizedTypes = normalizeWidgetNotificationTypes(preference.types);
            return WIDGET_NOTIFICATION_TYPES.some(type => normalizedTypes[type.id]);
        }

        function filterRecentActivityByNotifications(logs) {
            const preference = getWidgetNotificationPreference(RECENT_ACTIVITY_WIDGET_ID);
            if (!preference.enabled) {
                return [];
            }
            return logs.filter((log) => {
                const eventType = log?.eventType || log?.data?.eventType;
                if (!eventType || typeof eventType !== "string") {
                    return true;
                }
                return isWidgetNotificationTypeEnabled(RECENT_ACTIVITY_WIDGET_ID, eventType);
            });
        }

        function renderRecentActivityList(list, logs) {
            if (!(list instanceof HTMLElement)) {
                return;
            }
            if (!shouldShowRecentActivityNotifications()) {
                list.innerHTML = "<div class=\"activity-widget-empty\">Notifications muted for this widget.</div>";
                return;
            }
            const rawActivity = Array.isArray(logs) ? logs.slice(0, RECENT_ACTIVITY_LIMIT) : [];
            const activity = filterRecentActivityByNotifications(rawActivity);
            if (activity.length === 0) {
                renderRecentActivityEmpty(list);
                return;
            }
            list.innerHTML = activity.map(buildRecentActivityItem).join("");
        }

        function loadRecentActivityWidget(options) {
            const list = document.getElementById("recentActivityList");
            if (!(list instanceof HTMLElement)) {
                return Promise.resolve();
            }
            const forceRefresh = Boolean(options?.force);
            const now = Date.now();
            if (!forceRefresh &&
                recentActivityInitialized &&
                now - recentActivityLastFetchedAt < RECENT_ACTIVITY_REFRESH_MS) {
                return Promise.resolve();
            }
            if (recentActivityRequest) {
                return recentActivityRequest;
            }
            recentActivityLastFetchedAt = now;
            if (!recentActivityInitialized) {
                setRecentActivityLoadingState(list, true);
            }
            recentActivityRequest = fetch("/api/logs?limit=" + RECENT_ACTIVITY_LIMIT)
                .then((response) => {
                    if (!response.ok) {
                        throw new Error("Unexpected response " + response.status);
                    }
                    return response.json();
                })
                .then((logs) => {
                    if (!Array.isArray(logs)) {
                        renderRecentActivityError(list, "Failed to load activity data.");
                        return;
                    }
                    renderRecentActivityList(list, logs);
                })
                .catch((error) => {
                    console.error("Error loading recent activity:", error);
                    renderRecentActivityError(list, "Failed to load recent activity.");
                })
                .finally(() => {
                    recentActivityInitialized = true;
                    setRecentActivityLoadingState(list, false);
                    recentActivityRequest = null;
                });
            return recentActivityRequest;
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
                            <span><span aria-hidden="true">🕒</span><span class="sr-only">Timestamp: </span> \${new Date(log.timestamp).toLocaleString()}</span>
                            <span><span aria-hidden="true">🆔</span><span class="sr-only">Task ID: </span> \${log.data.taskId}</span>
                        </div>
                    </div>
                \`).join('');
                
            } catch (error) {
                console.error('Error loading logs:', error);
                showError('Failed to load activity log');
            }
        }

        function ensureWidgetNotificationIndicator(widget) {
            if (!(widget instanceof HTMLElement)) {
                return null;
            }
            const existing = widget.querySelector(".widget-notification-indicator");
            if (existing instanceof HTMLElement) {
                return existing;
            }
            const indicator = document.createElement("div");
            indicator.className = "widget-notification-indicator";
            indicator.setAttribute("aria-hidden", "true");
            widget.appendChild(indicator);
            return indicator;
        }

        function getNotificationTypeLabel(typeId) {
            const match = WIDGET_NOTIFICATION_TYPES.find(type => type.id === typeId);
            return match ? match.label : "Update";
        }

        function triggerWidgetNotification(widgetId, typeId) {
            const widget = getWidgetById(widgetId);
            if (!(widget instanceof HTMLElement)) {
                return;
            }
            const indicator = ensureWidgetNotificationIndicator(widget);
            if (!(indicator instanceof HTMLElement)) {
                return;
            }
            indicator.textContent = getNotificationTypeLabel(typeId);
            indicator.classList.add("is-active");
            const previousTimeout = widgetNotificationTimeouts[widgetId];
            if (previousTimeout) {
                clearTimeout(previousTimeout);
            }
            const timeoutId = window.setTimeout(() => {
                indicator.classList.remove("is-active");
            }, WIDGET_NOTIFICATION_PULSE_MS);
            widgetNotificationTimeouts = { ...widgetNotificationTimeouts, [widgetId]: timeoutId };
        }

        function getWidgetNotificationEligibleIds(typeId) {
            if (!typeId || typeof typeId !== "string") {
                return [];
            }
            const hiddenSet = new Set(loadHiddenWidgetIds());
            return getAllWidgets()
                .map(widget => widget.dataset.widgetId)
                .filter(widgetId => Boolean(widgetId))
                .filter(widgetId => !hiddenSet.has(widgetId))
                .filter(widgetId => isWidgetNotificationTypeEnabled(widgetId, typeId));
        }

        function handleWidgetNotificationEvent(typeId) {
            const eligibleWidgetIds = getWidgetNotificationEligibleIds(typeId);
            if (eligibleWidgetIds.length === 0) {
                return false;
            }
            eligibleWidgetIds.forEach(widgetId => {
                triggerWidgetNotification(widgetId, typeId);
            });
            return true;
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
                            if (message.data && Object.prototype.hasOwnProperty.call(message.data, "metrics")) {
                                applyMetricsUpdate(message.data.metrics);
                            }
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

                        if (message.type === "metrics_update") {
                            applyMetricsUpdate(message.data);
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
                            await requestMetricsRefresh();
                            await loadRecentActivityWidget({ force: true });
                            
                            const shouldNotify = handleWidgetNotificationEvent(message.type);
                            let notificationType = "info";
                            let notificationMessage = "Task " + message.type.replace("_", " ");
                            
                            if (message.type === "task_created") {
                                notificationType = "success";
                                notificationMessage = "New task created: " + (message.data.title || "Unknown");
                            } else if (message.type === "task_status_changed") {
                                notificationType = "info";
                                notificationMessage = "Task \"" + (message.data.task?.title || "Unknown") + "\" status changed to " + message.data.newStatus;
                            } else if (message.type === "task_deleted") {
                                notificationType = "warning";
                                notificationMessage = "Task deleted";
                            }

                            if (shouldNotify) {
                                showNotification(notificationMessage, notificationType);
                            }
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

        function escapeHTML(value) {
            return String(value)
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#39;");
        }

        function getToastContainer() {
            const existing = document.getElementById("toastContainer");
            if (existing instanceof HTMLElement) {
                return existing;
            }
            const container = document.createElement("div");
            container.id = "toastContainer";
            container.className = "toast-container";
            container.setAttribute("role", "status");
            container.setAttribute("aria-live", "polite");
            container.setAttribute("aria-atomic", "true");
            document.body.appendChild(container);
            return container;
        }

        function showToast(message, options) {
            if (!message) {
                return;
            }
            const container = getToastContainer();
            const toast = document.createElement("div");
            const type = options?.type || "info";
            toast.className = "toast toast-" + type;
            toast.textContent = message;
            container.appendChild(toast);
            window.requestAnimationFrame(() => {
                toast.classList.add("is-visible");
            });
            const durationMs = typeof options?.durationMs === "number" ? options.durationMs : 2200;
            window.setTimeout(() => {
                toast.classList.remove("is-visible");
                window.setTimeout(() => {
                    if (toast.parentNode) {
                        toast.parentNode.removeChild(toast);
                    }
                }, 220);
            }, durationMs);
        }

        function showMessage(message, type) {
            const messageDiv = document.createElement("div");
            messageDiv.className = type;
            messageDiv.textContent = message;
            messageDiv.setAttribute("role", "status");
            messageDiv.setAttribute("aria-live", "polite");
            messageDiv.setAttribute("aria-atomic", "true");
            const container = document.querySelector(".container");
            if (!(container instanceof HTMLElement)) {
                return;
            }
            container.insertBefore(messageDiv, container.firstChild);
            
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
        function normalizeAutoRefreshRate(value) {
            if (value === "off" || value === "30s" || value === "1m" || value === "5m") {
                return value;
            }
            return AUTO_REFRESH_DEFAULT;
        }

        function getAutoRefreshIntervalMs(rate) {
            const normalized = normalizeAutoRefreshRate(rate);
            return AUTO_REFRESH_OPTIONS[normalized].intervalMs;
        }

        function getAutoRefreshSelect() {
            const element = document.getElementById("autoRefreshSelect");
            return element instanceof HTMLSelectElement ? element : null;
        }

        function readStoredAutoRefreshRate() {
            if (typeof window === "undefined") {
                return null;
            }
            try {
                const stored = window.localStorage.getItem(AUTO_REFRESH_STORAGE_KEY);
                return stored ? normalizeAutoRefreshRate(stored) : null;
            } catch (_error) {
                return null;
            }
        }

        function storeAutoRefreshRate(rate) {
            if (typeof window === "undefined") {
                return;
            }
            try {
                window.localStorage.setItem(AUTO_REFRESH_STORAGE_KEY, rate);
            } catch (_error) {
                return;
            }
        }

        function stopAutoRefreshInterval() {
            if (refreshInterval !== null) {
                clearInterval(refreshInterval);
                refreshInterval = null;
            }
        }

        function applyAutoRefreshRate(nextRate) {
            const normalized = normalizeAutoRefreshRate(nextRate);
            autoRefreshRate = normalized;
            const select = getAutoRefreshSelect();
            if (select) {
                select.value = normalized;
            }
            stopAutoRefreshInterval();
            const intervalMs = getAutoRefreshIntervalMs(normalized);
            if (!intervalMs) {
                return;
            }
            refreshInterval = window.setInterval(async () => {
                await requestMetricsRefresh();
                await loadRecentActivityWidget();
                // Only refresh tab-specific content if that tab is active
                if (document.getElementById("queue-tab").classList.contains("active")) {
                    await loadQueueStatus();
                }
                if (document.getElementById("tasks-tab").classList.contains("active")) {
                    await loadTasks();
                }
            }, intervalMs);
        }

        function startAutoRefresh(nextRate) {
            applyAutoRefreshRate(nextRate ?? autoRefreshRate);
        }

        async function hydrateAutoRefreshPreferences() {
            const profileState = await loadUserProfileState({ force: false });
            const profileRate = profileState?.preferences?.dashboard?.refreshRate;
            if (!profileRate) {
                return;
            }
            const normalized = normalizeAutoRefreshRate(profileRate);
            storeAutoRefreshRate(normalized);
            applyAutoRefreshRate(normalized);
        }

        async function persistAutoRefreshPreference(nextRate) {
            const normalized = normalizeAutoRefreshRate(nextRate);
            storeAutoRefreshRate(normalized);
            applyAutoRefreshRate(normalized);
            const token = readAuthToken();
            if (!token) {
                return;
            }
            const profileState = await loadUserProfileState({ force: false });
            const basePreferences = resolvePreferencesBase(profileState);
            const dashboardPreferences =
                basePreferences.dashboard && typeof basePreferences.dashboard === "object"
                    ? basePreferences.dashboard
                    : {};
            const nextPreferences = {
                ...basePreferences,
                dashboard: {
                    ...dashboardPreferences,
                    refreshRate: normalized,
                },
            };
            const updatedAt = Date.now();
            await persistPreferencesUpdate(nextPreferences, {
                updatedAt,
                source: "dashboard.autoRefresh",
            });
        }

        function initAutoRefreshControls() {
            const select = getAutoRefreshSelect();
            if (!select) {
                return;
            }
            select.addEventListener("change", () => {
                void persistAutoRefreshPreference(select.value);
            });
        }

        function stopAutoRefresh() {
            stopAutoRefreshInterval();
            if (wsConnection) {
                wsConnection.close();
            }
        }

        const WIDGET_LAYOUT_STORAGE_KEY = "dashboardWidgetLayout.v1";
        const WIDGET_LAYOUT_SCHEMA_VERSION = 1;
        const WIDGET_SIZE_SCHEMA_VERSION = 1;
        const WIDGET_LAYOUT_META_STORAGE_KEY = "dashboardWidgetLayout.meta.v1";
        const WIDGET_SIZE_STORAGE_KEY = "dashboardWidgetSize.v1";
        const WIDGET_VISIBILITY_STORAGE_KEY = "dashboardWidgetVisibility.v1";
        const WIDGET_LAYOUT_SYNC_CHANNEL = "dashboardWidgetLayout.sync.v1";
        const WIDGET_LAYOUT_PROFILE_VERSION = 1;
        const WIDGET_LAYOUT_PROFILE_SYNC_DEBOUNCE_MS = 900;
        const WIDGET_LAYOUT_PROFILE_REFRESH_MS = 60000;
        const WIDGET_LIBRARY_SELECTION_KEY = "dashboardWidgetLibrarySelection.v1";
        const WIDGET_LIBRARY_PENDING_ADD_KEY = "dashboardWidgetLibraryPendingAdd.v1";
        const PREFERENCES_SYNC_PENDING_KEY = "userPreferences.pending.v1";
        const PREFERENCES_SYNC_DEVICE_KEY = "userPreferences.device.v1";
        const PREFERENCES_SYNC_SOURCE = "dashboard";
        const WIDGET_LIBRARY_ADD_LOADING_MS = 350;
        const WIDGET_LIBRARY_ADD_SUCCESS_MS = 1400;
        const WIDGET_DRAG_DROP_FEEDBACK_MS = 360;
        const DEFAULT_WIDGET_GHOST_SCALE = 0.9;
        const DEFAULT_MAX_VISIBLE_WIDGETS = 20;
        const MAX_VISIBLE_WIDGETS = (() => {
            if (typeof document === "undefined") {
                return DEFAULT_MAX_VISIBLE_WIDGETS;
            }
            const rawLimit = document.body && document.body.dataset
                ? document.body.dataset.widgetLimit
                : undefined;
            const parsedLimit = Number.parseInt(rawLimit ?? "", 10);
            return Number.isFinite(parsedLimit) && parsedLimit > 0
                ? parsedLimit
                : DEFAULT_MAX_VISIBLE_WIDGETS;
        })();
        const WIDGET_LAYOUT_PENDING_SYNC_KEY = "dashboardWidgetLayout.pending.v1";
        const WIDGET_VISIBILITY_PENDING_SYNC_KEY = "dashboardWidgetVisibility.pending.v1";
        const WIDGET_LAYOUT_SYNC_TIMEOUT_MS = 2500;
        const WIDGET_LAYOUT_AUTOSAVE_DEBOUNCE_MS = 500;
        const WIDGET_LAYOUT_SAVE_TOAST_DELAY_MS = 250;
        const WIDGET_LAYOUT_SAVE_TOAST_COOLDOWN_MS = 2400;
        const WIDGET_LAYOUT_SAVE_FAILURE_TOAST_COOLDOWN_MS = 6000;
        const WIDGET_LAYOUT_SAVE_RETRY_BASE_MS = 1500;
        const WIDGET_LAYOUT_SAVE_RETRY_MAX_MS = 12000;
        const WIDGET_LAYOUT_SAVE_RETRY_JITTER_MS = 400;
        const WIDGET_LAYOUT_SAVE_MAX_RETRIES = 5;
        const WIDGET_LAYOUT_SAVE_RECOVERY_TOAST_COOLDOWN_MS = 12000;
        const WIDGET_SIZE_OPTIONS = ["small", "medium", "large"];
        const WIDGET_SIZE_CLASSES = WIDGET_SIZE_OPTIONS.map(size => \`widget-size-\${size}\`);
        const WIDGET_MOVE_ANNOUNCER_ID = "widgetMoveAnnouncement";
        const DASHBOARD_RESTORE_MIN_MS = 200;
        const DASHBOARD_RESTORE_OVERLAY_ID = "dashboardRestoreOverlay";
        const DASHBOARD_RESTORE_MESSAGE_ID = "dashboardRestoreMessage";
        const DASHBOARD_RESTORE_MESSAGE_DEFAULT = "Restoring dashboard layout...";
        const DASHBOARD_RESTORE_MESSAGE_FALLBACK = "Resetting dashboard layout...";
        const WIDGET_CONTAINER_LABELS = {
            "overview-metrics": "Overview",
            "queue-metrics": "Queue Status",
            "health-grid": "Health",
        };
        const WIDGET_CONTAINER_ORDER = ["overview-metrics", "queue-metrics", "health-grid"];
        const WIDGET_LIBRARY_FILTER_ALL = "all";
        const WIDGET_LIBRARY_DRAG_HOLD_MS = 180;
        const WIDGET_LIBRARY_DRAG_MOVE_THRESHOLD = 6;
        const WIDGET_TOUCH_DRAG_THRESHOLD = 8;
        const WIDGET_DRAG_HANDLE_SELECTORS = "[data-widget-drag-handle], .widget-drag-handle";
        const WIDGET_DRAG_HEADER_SELECTORS =
            ".activity-widget-header, .status-breakdown-header, .priority-breakdown-header, " +
            ".health-title, .metric-label, .metric-value";
        let widgetDragState = {
            dragging: null,
            placeholder: null,
            container: null,
            originContainer: null,
            originNextSibling: null,
            dropTimeoutId: null,
            dropTarget: null,
            dropContainer: null,
            dragHandleActive: false,
        };
        let widgetLibraryDragState = {
            widgetId: null,
            widget: null,
            container: null,
            ghost: null,
            pointerId: null,
            holdTimeoutId: null,
            startX: 0,
            startY: 0,
            lastX: 0,
            lastY: 0,
            active: false,
            moved: false,
        };
        let widgetTouchDragState = {
            pointerId: null,
            widget: null,
            container: null,
            ghost: null,
            startX: 0,
            startY: 0,
            lastX: 0,
            lastY: 0,
            active: false,
        };
        let widgetLibraryDragListenersAttached = false;
        let widgetTouchDragListenersAttached = false;
        let widgetCatalog = [];
        let widgetNotificationPreferences = {};
        let widgetNotificationTimeouts = {};
        let widgetLibrarySearchQuery = "";
        let widgetLibraryActiveCategory = WIDGET_LIBRARY_FILTER_ALL;
        let selectedWidgetIds = new Set();
        let widgetLibraryAddState = {};
        let widgetLayoutSyncState = {
            hasSynced: false,
            hasLayout: false,
            hasServerSync: false,
        };
        let widgetLayoutLastAppliedAt = 0;
        let widgetLayoutLastAppliedSnapshot = null;
        let widgetLayoutSaveState = {
            pendingFeedback: false,
            lastToastAt: 0,
            lastFailureToastAt: 0,
            lastRecoveryToastAt: 0,
            toastTimeoutId: null,
            indicatorTimeoutId: null,
            retryTimeoutId: null,
            retryCount: 0,
            recoveryFailed: false,
        };
        let widgetLayoutAutosaveState = {
            timeoutId: null,
            pendingLayout: {},
            pendingFullLayout: false,
        };
        let widgetLayoutSyncChannel = null;
        let widgetLayoutSyncTabId = createWidgetLayoutSyncId();
        let dashboardRestoreState = {
            status: "idle",
            startedAt: 0,
            timeoutId: null,
        };
        let widgetLayoutProfileState = {
            userId: null,
            preferences: null,
            lastFetchedAt: 0,
            isAuthenticated: false,
        };
        let widgetLayoutProfileSyncState = {
            timeoutId: null,
            pendingLayout: null,
            pendingUpdatedAt: 0,
            lastSyncedUpdatedAt: 0,
        };
        let pendingAddSelectedWidgets = false;
        let widgetLayoutSyncTimeoutId = null;
        let widgetLayoutSyncRequested = false;

        function createWidgetLayoutSyncId() {
            return "tab-" + Date.now() + "-" + Math.random().toString(16).slice(2);
        }

        function readAuthToken() {
            if (typeof window === "undefined") {
                return null;
            }
            const token =
                window.localStorage.getItem("authToken")
                ?? window.localStorage.getItem("token")
                ?? window.sessionStorage.getItem("token");
            if (!token || typeof token !== "string") {
                return null;
            }
            const trimmed = token.trim();
            return trimmed.length > 0 ? trimmed : null;
        }

        function resolvePreferencesSyncDeviceId() {
            if (typeof window === "undefined") {
                return "device-unknown";
            }
            try {
                const stored = window.localStorage.getItem(PREFERENCES_SYNC_DEVICE_KEY);
                if (stored && stored.trim().length > 0) {
                    return stored;
                }
                const created = "device-" + Date.now() + "-" + Math.random().toString(16).slice(2);
                window.localStorage.setItem(PREFERENCES_SYNC_DEVICE_KEY, created);
                return created;
            } catch (_error) {
                return "device-" + Date.now() + "-" + Math.random().toString(16).slice(2);
            }
        }

        function loadPendingPreferencesSync() {
            if (typeof window === "undefined") {
                return { hasPending: false, preferences: null, preferencesSync: null };
            }
            try {
                const raw = window.localStorage.getItem(PREFERENCES_SYNC_PENDING_KEY);
                if (!raw) {
                    return { hasPending: false, preferences: null, preferencesSync: null };
                }
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === "object" && parsed.preferences) {
                    return {
                        hasPending: true,
                        preferences: parsed.preferences,
                        preferencesSync: parsed.preferencesSync ?? null,
                    };
                }
            } catch (error) {
                console.warn("Failed to load pending preference sync:", error);
            }
            return { hasPending: false, preferences: null, preferencesSync: null };
        }

        function savePendingPreferencesSync(payload) {
            if (!payload || typeof payload !== "object") {
                return false;
            }
            return safeLocalStorageSet(
                PREFERENCES_SYNC_PENDING_KEY,
                payload,
                "Failed to persist pending preference sync:",
            );
        }

        function clearPendingPreferencesSync() {
            if (typeof window === "undefined") {
                return;
            }
            window.localStorage.removeItem(PREFERENCES_SYNC_PENDING_KEY);
        }

        function buildPreferencesSyncMetadata(updatedAt, source) {
            return {
                updatedAt,
                deviceId: resolvePreferencesSyncDeviceId(),
                source: source || PREFERENCES_SYNC_SOURCE,
            };
        }

        function queuePreferencesSync(preferences, preferencesSync) {
            if (!preferences || typeof preferences !== "object") {
                return;
            }
            savePendingPreferencesSync({
                preferences,
                preferencesSync,
            });
        }

        function reconcilePendingPreferencesSync(updatedAt) {
            const pending = loadPendingPreferencesSync();
            if (!pending.hasPending) {
                return;
            }
            const pendingUpdatedAt =
                typeof pending.preferencesSync?.updatedAt === "number"
                    ? pending.preferencesSync.updatedAt
                    : 0;
            if (pendingUpdatedAt <= updatedAt) {
                clearPendingPreferencesSync();
            }
        }

        function resolvePreferencesBase(profileState) {
            const pending = loadPendingPreferencesSync();
            if (pending.hasPending && pending.preferences && typeof pending.preferences === "object") {
                return pending.preferences;
            }
            return profileState?.preferences && typeof profileState.preferences === "object"
                ? profileState.preferences
                : {};
        }

        function updateProfileStatePreferences(preferences, options) {
            const nextPreferences = preferences && typeof preferences === "object" ? preferences : {};
            const isAuthenticated =
                typeof options?.isAuthenticated === "boolean"
                    ? options.isAuthenticated
                    : widgetLayoutProfileState.isAuthenticated;
            widgetLayoutProfileState = {
                ...widgetLayoutProfileState,
                preferences: nextPreferences,
                lastFetchedAt: Date.now(),
                isAuthenticated,
            };
        }

        async function flushPendingPreferencesSync() {
            const pending = loadPendingPreferencesSync();
            if (!pending.hasPending || !pending.preferences) {
                return;
            }
            const token = readAuthToken();
            if (!token) {
                return;
            }
            if (!isClientOnline()) {
                return;
            }
            try {
                const response = await fetch("/api/users/me/profile", {
                    method: "PUT",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: "Bearer " + token,
                    },
                    body: JSON.stringify({
                        preferences: pending.preferences,
                        preferencesSync: pending.preferencesSync ?? undefined,
                    }),
                });
                if (!response.ok) {
                    if (response.status === 401 || response.status === 403) {
                        widgetLayoutProfileState = {
                            ...widgetLayoutProfileState,
                            isAuthenticated: false,
                        };
                    }
                    console.warn("Failed to flush pending preferences:", response.status);
                    return;
                }
                const data = await response.json();
                const nextPreferences =
                    data?.user?.preferences && typeof data.user.preferences === "object"
                        ? data.user.preferences
                        : pending.preferences;
                updateProfileStatePreferences(nextPreferences, { isAuthenticated: true });
                const confirmedUpdatedAt =
                    typeof pending.preferencesSync?.updatedAt === "number"
                        ? pending.preferencesSync.updatedAt
                        : 0;
                reconcilePendingPreferencesSync(confirmedUpdatedAt);
            } catch (error) {
                console.warn("Failed to flush pending preferences:", error);
            }
        }

        async function persistPreferencesUpdate(nextPreferences, options) {
            const updatedAt = typeof options?.updatedAt === "number" ? options.updatedAt : Date.now();
            const preferencesSync = buildPreferencesSyncMetadata(updatedAt, options?.source);
            const token = readAuthToken();
            if (!token) {
                queuePreferencesSync(nextPreferences, preferencesSync);
                updateProfileStatePreferences(nextPreferences, {});
                return false;
            }
            try {
                const response = await fetch("/api/users/me/profile", {
                    method: "PUT",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: "Bearer " + token,
                    },
                    body: JSON.stringify({
                        preferences: nextPreferences,
                        preferencesSync,
                    }),
                });
                if (!response.ok) {
                    if (response.status === 401 || response.status === 403) {
                        widgetLayoutProfileState = {
                            ...widgetLayoutProfileState,
                            isAuthenticated: false,
                        };
                        return false;
                    }
                    if (!isClientOnline()) {
                        queuePreferencesSync(nextPreferences, preferencesSync);
                        updateProfileStatePreferences(nextPreferences, {});
                    }
                    console.warn("Failed to update user preferences:", response.status);
                    return false;
                }
                const data = await response.json();
                const nextFromServer =
                    data?.user?.preferences && typeof data.user.preferences === "object"
                        ? data.user.preferences
                        : nextPreferences;
                updateProfileStatePreferences(nextFromServer, { isAuthenticated: true });
                reconcilePendingPreferencesSync(preferencesSync.updatedAt);
                return true;
            } catch (error) {
                console.warn("Failed to update user preferences:", error);
                queuePreferencesSync(nextPreferences, preferencesSync);
                updateProfileStatePreferences(nextPreferences, {});
                return false;
            }
        }

        function buildDefaultWidgetNotificationTypes() {
            return WIDGET_NOTIFICATION_TYPES.reduce((acc, type) => {
                return { ...acc, [type.id]: true };
            }, {});
        }

        function buildWidgetNotificationTypesState(value) {
            return WIDGET_NOTIFICATION_TYPES.reduce((acc, type) => {
                return { ...acc, [type.id]: value };
            }, {});
        }

        function normalizeWidgetNotificationTypes(value) {
            const defaults = buildDefaultWidgetNotificationTypes();
            if (!value || typeof value !== "object") {
                return defaults;
            }
            return WIDGET_NOTIFICATION_TYPES.reduce((acc, type) => {
                const entry = value[type.id];
                return {
                    ...acc,
                    [type.id]: typeof entry === "boolean" ? entry : defaults[type.id],
                };
            }, {});
        }

        function buildDefaultWidgetNotificationPreference() {
            return {
                enabled: true,
                types: buildDefaultWidgetNotificationTypes(),
            };
        }

        function normalizeWidgetNotificationPreference(value) {
            if (typeof value === "boolean") {
                return {
                    enabled: value,
                    types: buildDefaultWidgetNotificationTypes(),
                };
            }
            if (!value || typeof value !== "object") {
                return buildDefaultWidgetNotificationPreference();
            }
            const enabled = typeof value.enabled === "boolean" ? value.enabled : true;
            const types = normalizeWidgetNotificationTypes(value.types);
            return { enabled, types };
        }

        function normalizeWidgetNotificationPreferences(value) {
            if (!value || typeof value !== "object") {
                return {};
            }
            return Object.entries(value).reduce((acc, [key, entry]) => {
                if (!key) {
                    return acc;
                }
                return { ...acc, [key]: normalizeWidgetNotificationPreference(entry) };
            }, {});
        }

        function getWidgetNotificationPreference(widgetId) {
            if (!widgetId) {
                return buildDefaultWidgetNotificationPreference();
            }
            const stored = widgetNotificationPreferences[widgetId];
            return normalizeWidgetNotificationPreference(stored);
        }

        function isWidgetNotificationTypeEnabled(widgetId, typeId) {
            const preference = getWidgetNotificationPreference(widgetId);
            if (!preference.enabled) {
                return false;
            }
            if (!typeId || typeof typeId !== "string") {
                return true;
            }
            const value = preference.types?.[typeId];
            return typeof value === "boolean" ? value : true;
        }

        function resolveWidgetNotificationPreset(types) {
            const normalized = normalizeWidgetNotificationTypes(types);
            const values = WIDGET_NOTIFICATION_TYPES.map(type => normalized[type.id]);
            const allEnabled = values.every(value => value === true);
            if (allEnabled) {
                return WIDGET_NOTIFICATION_PRESET_ALL;
            }
            const allDisabled = values.every(value => value === false);
            if (allDisabled) {
                return WIDGET_NOTIFICATION_PRESET_NONE;
            }
            return WIDGET_NOTIFICATION_PRESET_CUSTOM;
        }

        function updateWidgetNotificationPreferences(nextPreferences) {
            widgetNotificationPreferences = normalizeWidgetNotificationPreferences(nextPreferences);
            renderWidgetLibrary();
        }

        async function hydrateWidgetNotificationPreferences() {
            const profileState = await loadUserProfileState({ force: false });
            const dashboardPreferences =
                profileState?.preferences && typeof profileState.preferences === "object"
                    ? profileState.preferences.dashboard
                    : null;
            const widgetNotifications =
                dashboardPreferences && typeof dashboardPreferences === "object"
                    ? dashboardPreferences.widgetNotifications
                    : null;
            updateWidgetNotificationPreferences(widgetNotifications ?? {});
        }

        async function persistWidgetNotificationPreference(widgetId, nextPreference) {
            const token = readAuthToken();
            if (!token) {
                return;
            }
            const profileState = await loadUserProfileState({ force: false });
            const basePreferences = resolvePreferencesBase(profileState);
            const dashboardPreferences =
                basePreferences.dashboard && typeof basePreferences.dashboard === "object"
                    ? basePreferences.dashboard
                    : {};
            const nextWidgetNotifications = {
                ...(dashboardPreferences.widgetNotifications ?? {}),
                [widgetId]: nextPreference,
            };
            const nextPreferences = {
                ...basePreferences,
                dashboard: {
                    ...dashboardPreferences,
                    widgetNotifications: nextWidgetNotifications,
                },
            };
            const updatedAt = Date.now();
            await persistPreferencesUpdate(nextPreferences, {
                updatedAt,
                source: "dashboard.widgetNotifications",
            });
        }

        function updateWidgetNotificationPreference(widgetId, updater) {
            if (!widgetId) {
                return;
            }
            const current = getWidgetNotificationPreference(widgetId);
            const next = typeof updater === "function" ? updater(current) : updater;
            const normalized = normalizeWidgetNotificationPreference(next);
            widgetNotificationPreferences = {
                ...widgetNotificationPreferences,
                [widgetId]: normalized,
            };
            renderWidgetLibrary();
            if (widgetId === RECENT_ACTIVITY_WIDGET_ID) {
                loadRecentActivityWidget({ force: true });
            }
            void persistWidgetNotificationPreference(widgetId, normalized);
        }

        function getDashboardRestoreOverlay() {
            if (typeof document === "undefined") {
                return null;
            }
            const overlay = document.getElementById(DASHBOARD_RESTORE_OVERLAY_ID);
            return overlay instanceof HTMLElement ? overlay : null;
        }

        function getDashboardRestoreMessageNode() {
            if (typeof document === "undefined") {
                return null;
            }
            const message = document.getElementById(DASHBOARD_RESTORE_MESSAGE_ID);
            return message instanceof HTMLElement ? message : null;
        }

        function setDashboardRestoreMessage(message) {
            const messageNode = getDashboardRestoreMessageNode();
            if (!messageNode) {
                return;
            }
            messageNode.textContent = message;
        }

        function startDashboardRestore() {
            const overlay = getDashboardRestoreOverlay();
            if (!overlay) {
                return;
            }
            if (dashboardRestoreState.timeoutId !== null) {
                clearTimeout(dashboardRestoreState.timeoutId);
            }
            overlay.classList.remove("is-hidden");
            overlay.setAttribute("aria-hidden", "false");
            setDashboardRestoreMessage(DASHBOARD_RESTORE_MESSAGE_DEFAULT);
            dashboardRestoreState = {
                status: "loading",
                startedAt: Date.now(),
                timeoutId: null,
            };
        }

        function finishDashboardRestore(options) {
            const overlay = getDashboardRestoreOverlay();
            if (!overlay) {
                return;
            }
            if (options?.usedFallback) {
                setDashboardRestoreMessage(DASHBOARD_RESTORE_MESSAGE_FALLBACK);
            }
            const elapsed = Date.now() - dashboardRestoreState.startedAt;
            const delay = Math.max(0, DASHBOARD_RESTORE_MIN_MS - elapsed);
            const hideOverlay = () => {
                overlay.classList.add("is-hidden");
                overlay.setAttribute("aria-hidden", "true");
            };
            const timeoutId = window.setTimeout(hideOverlay, delay);
            dashboardRestoreState = {
                status: "ready",
                startedAt: dashboardRestoreState.startedAt,
                timeoutId,
            };
        }

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
                const currentLayout = loadWidgetLayout();
                const currentMeta = loadWidgetLayoutMeta();
                const resolved = resolveWidgetLayoutConflict(
                    currentLayout,
                    currentMeta,
                    serverLayout,
                    { updatedAt: 0 },
                );
                const shouldApply = resolved.action !== "keep"
                    || !areWidgetLayoutStatesEqual(currentLayout, resolved.layout);
                if (shouldApply) {
                    saveWidgetLayoutState(resolved.layout, {
                        updatedAt: resolved.updatedAt,
                        allowZero: resolved.updatedAt === 0,
                    });
                }
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

        function updateWidgetLayoutSaveState(nextState) {
            widgetLayoutSaveState = { ...widgetLayoutSaveState, ...nextState };
        }

        function updateWidgetLayoutAutosaveState(nextState) {
            widgetLayoutAutosaveState = { ...widgetLayoutAutosaveState, ...nextState };
        }

        function getWidgetLayoutSaveIndicator() {
            if (typeof document === "undefined") {
                return null;
            }
            const indicator = document.getElementById("layoutSaveIndicator");
            return indicator instanceof HTMLElement ? indicator : null;
        }

        function clearWidgetLayoutSaveIndicator() {
            const indicator = getWidgetLayoutSaveIndicator();
            if (!indicator) {
                return;
            }
            if (widgetLayoutSaveState.indicatorTimeoutId !== null) {
                clearTimeout(widgetLayoutSaveState.indicatorTimeoutId);
            }
            indicator.classList.remove("is-visible", "is-error");
            indicator.setAttribute("aria-hidden", "true");
            const retryButton = indicator.querySelector(".layout-save-retry");
            if (retryButton instanceof HTMLButtonElement) {
                retryButton.hidden = true;
            }
            updateWidgetLayoutSaveState({ indicatorTimeoutId: null });
        }

        function showWidgetLayoutSaveIndicator(options) {
            const indicator = getWidgetLayoutSaveIndicator();
            if (!indicator) {
                return;
            }
            const status = options?.status ?? "success";
            const message = options?.message ?? (status === "success" ? "Layout saved" : "Layout save failed");
            const icon = indicator.querySelector(".layout-save-icon");
            const text = indicator.querySelector(".layout-save-text");
            if (icon instanceof HTMLElement) {
                icon.textContent = status === "success" ? "\u2713" : "!";
            }
            if (text instanceof HTMLElement) {
                text.textContent = message;
            }
            indicator.classList.toggle("is-error", status === "error");
            indicator.classList.add("is-visible");
            indicator.setAttribute("aria-hidden", "false");
            const retryButton = indicator.querySelector(".layout-save-retry");
            if (retryButton instanceof HTMLButtonElement) {
                retryButton.hidden = status !== "error";
            }
            if (widgetLayoutSaveState.indicatorTimeoutId !== null) {
                clearTimeout(widgetLayoutSaveState.indicatorTimeoutId);
            }
            if (options?.autoHide === false) {
                updateWidgetLayoutSaveState({ indicatorTimeoutId: null });
                return;
            }
            const durationMs = typeof options?.durationMs === "number" ? options.durationMs : 2000;
            const timeoutId = window.setTimeout(() => {
                clearWidgetLayoutSaveIndicator();
            }, durationMs);
            updateWidgetLayoutSaveState({ indicatorTimeoutId: timeoutId });
        }

        function initWidgetLayoutSaveIndicator() {
            const indicator = getWidgetLayoutSaveIndicator();
            if (!indicator) {
                return;
            }
            const retryButton = indicator.querySelector(".layout-save-retry");
            if (!(retryButton instanceof HTMLButtonElement)) {
                return;
            }
            if (retryButton.dataset.retryReady === "true") {
                return;
            }
            retryButton.dataset.retryReady = "true";
            retryButton.addEventListener("click", (event) => {
                event.preventDefault();
                attemptWidgetLayoutSaveRetry();
            });
        }

        function isClientOnline() {
            if (typeof navigator === "undefined") {
                return true;
            }
            return navigator.onLine !== false;
        }

        function clearWidgetLayoutAutosaveTimeout() {
            if (widgetLayoutAutosaveState.timeoutId === null) {
                return;
            }
            clearTimeout(widgetLayoutAutosaveState.timeoutId);
            updateWidgetLayoutAutosaveState({ timeoutId: null });
        }

        function flushWidgetLayoutAutoSave() {
            const pendingLayout = widgetLayoutAutosaveState.pendingLayout;
            const pendingFullLayout = widgetLayoutAutosaveState.pendingFullLayout;
            updateWidgetLayoutAutosaveState({
                timeoutId: null,
                pendingLayout: {},
                pendingFullLayout: false,
            });
            if (!pendingLayout || typeof pendingLayout !== "object" || Object.keys(pendingLayout).length === 0) {
                return;
            }
            const hasLiveSync = Boolean(wsConnection && wsConnection.readyState === WebSocket.OPEN);
            sendWidgetLayoutBatch(pendingLayout, { fullLayout: pendingFullLayout });
            if (hasLiveSync) {
                notifyWidgetLayoutSaveSuccess({});
            }
        }

        function scheduleWidgetLayoutAutoSave(layoutUpdates, options) {
            if (!layoutUpdates || typeof layoutUpdates !== "object") {
                return;
            }
            const normalized = normalizeWidgetLayoutState(layoutUpdates);
            if (Object.keys(normalized).length === 0) {
                return;
            }
            markWidgetLayoutSaveRequested();
            const shouldSendFullLayout = Boolean(options?.fullLayout);
            const currentPendingLayout = widgetLayoutAutosaveState.pendingLayout || {};
            const mergedPendingLayout = mergeWidgetLayoutUpdates(currentPendingLayout, normalized);
            const nextPendingLayout = shouldSendFullLayout ? normalized : mergedPendingLayout;
            const nextPendingFullLayout = shouldSendFullLayout || widgetLayoutAutosaveState.pendingFullLayout;
            clearWidgetLayoutAutosaveTimeout();
            const timeoutId = window.setTimeout(() => {
                flushWidgetLayoutAutoSave();
            }, WIDGET_LAYOUT_AUTOSAVE_DEBOUNCE_MS);
            updateWidgetLayoutAutosaveState({
                timeoutId,
                pendingLayout: nextPendingLayout,
                pendingFullLayout: nextPendingFullLayout,
            });
        }

        function clearWidgetLayoutSaveToast() {
            if (widgetLayoutSaveState.toastTimeoutId === null) {
                return;
            }
            clearTimeout(widgetLayoutSaveState.toastTimeoutId);
            updateWidgetLayoutSaveState({ toastTimeoutId: null });
        }

        function scheduleWidgetLayoutSaveToast(message, options) {
            if (!message) {
                return;
            }
            const now = Date.now();
            const elapsed = now - (widgetLayoutSaveState.lastToastAt || 0);
            const delay = elapsed < WIDGET_LAYOUT_SAVE_TOAST_COOLDOWN_MS
                ? WIDGET_LAYOUT_SAVE_TOAST_COOLDOWN_MS - elapsed
                : WIDGET_LAYOUT_SAVE_TOAST_DELAY_MS;
            clearWidgetLayoutSaveToast();
            const timeoutId = window.setTimeout(() => {
                showToast(message, options);
                updateWidgetLayoutSaveState({
                    lastToastAt: Date.now(),
                    toastTimeoutId: null,
                });
            }, Math.max(0, delay));
            updateWidgetLayoutSaveState({ toastTimeoutId: timeoutId });
        }

        function markWidgetLayoutSaveRequested() {
            updateWidgetLayoutSaveState({
                pendingFeedback: true,
                recoveryFailed: false,
                retryCount: 0,
            });
        }

        function notifyWidgetLayoutSaveSuccess(options) {
            if (!widgetLayoutSaveState.pendingFeedback && !options?.force) {
                clearWidgetLayoutSaveRetry();
                return;
            }
            clearWidgetLayoutSaveToast();
            showWidgetLayoutSaveIndicator({
                status: "success",
                message: options?.message ?? "Layout saved",
                durationMs: 2000,
            });
            updateWidgetLayoutSaveState({
                pendingFeedback: false,
                lastFailureToastAt: 0,
                lastRecoveryToastAt: 0,
                recoveryFailed: false,
            });
            clearWidgetLayoutSaveRetry();
        }

        function notifyWidgetLayoutSaveFailure(options) {
            const shouldToast = widgetLayoutSaveState.pendingFeedback || options?.force;
            updateWidgetLayoutSaveState({ pendingFeedback: true });
            clearWidgetLayoutSaveToast();
            const indicatorMessage = isClientOnline()
                ? "Layout save failed"
                : "Layout save queued";
            showWidgetLayoutSaveIndicator({
                status: "error",
                message: indicatorMessage,
                autoHide: false,
            });
            const now = Date.now();
            const lastFailureToastAt = widgetLayoutSaveState.lastFailureToastAt || 0;
            if (shouldToast && now - lastFailureToastAt >= WIDGET_LAYOUT_SAVE_FAILURE_TOAST_COOLDOWN_MS) {
                const fallbackMessage = isClientOnline()
                    ? "Layout save failed. Retrying..."
                    : "Layout save failed while offline. Changes queued for retry.";
                showToast(options?.message ?? fallbackMessage, {
                    type: "warning",
                    durationMs: 2600,
                });
                updateWidgetLayoutSaveState({ lastFailureToastAt: now });
            }
            scheduleWidgetLayoutSaveRetry();
        }

        function notifyWidgetLayoutSaveRecoveryFailure(options) {
            const now = Date.now();
            const lastRecoveryToastAt = widgetLayoutSaveState.lastRecoveryToastAt || 0;
            if (now - lastRecoveryToastAt < WIDGET_LAYOUT_SAVE_RECOVERY_TOAST_COOLDOWN_MS) {
                updateWidgetLayoutSaveState({ recoveryFailed: true });
                return;
            }
            const fallbackMessage = isClientOnline()
                ? "Layout save failed after multiple attempts. Changes are queued to retry."
                : "Layout save failed offline. Changes will retry when you are back online.";
            showWidgetLayoutSaveIndicator({
                status: "error",
                message: "Layout save needs attention",
                autoHide: false,
            });
            showToast(options?.message ?? fallbackMessage, {
                type: "error",
                durationMs: 4200,
            });
            updateWidgetLayoutSaveState({
                recoveryFailed: true,
                lastRecoveryToastAt: now,
            });
        }

        function clearWidgetLayoutSaveRetry() {
            if (widgetLayoutSaveState.retryTimeoutId === null) {
                updateWidgetLayoutSaveState({ retryCount: 0 });
                return;
            }
            clearTimeout(widgetLayoutSaveState.retryTimeoutId);
            updateWidgetLayoutSaveState({
                retryTimeoutId: null,
                retryCount: 0,
            });
        }

        function scheduleWidgetLayoutSaveRetry() {
            const pending = loadPendingWidgetLayoutSync();
            if (!pending.hasPending || Object.keys(pending.widgetLayout).length === 0) {
                return;
            }
            if (widgetLayoutSaveState.retryTimeoutId !== null) {
                return;
            }
            const retryCount = widgetLayoutSaveState.retryCount || 0;
            if (retryCount >= WIDGET_LAYOUT_SAVE_MAX_RETRIES) {
                notifyWidgetLayoutSaveRecoveryFailure({});
                return;
            }
            const baseDelay = Math.min(
                WIDGET_LAYOUT_SAVE_RETRY_MAX_MS,
                WIDGET_LAYOUT_SAVE_RETRY_BASE_MS * Math.pow(2, retryCount),
            );
            const jitter = Math.floor(Math.random() * WIDGET_LAYOUT_SAVE_RETRY_JITTER_MS);
            const timeoutId = window.setTimeout(() => {
                updateWidgetLayoutSaveState({ retryTimeoutId: null });
                attemptWidgetLayoutSaveRetry();
            }, baseDelay + jitter);
            updateWidgetLayoutSaveState({
                retryTimeoutId: timeoutId,
                retryCount: retryCount + 1,
            });
        }

        function attemptWidgetLayoutSaveRetry() {
            const pending = loadPendingWidgetLayoutSync();
            if (!pending.hasPending || Object.keys(pending.widgetLayout).length === 0) {
                clearWidgetLayoutSaveRetry();
                return;
            }
            const hasLiveSync = Boolean(wsConnection && wsConnection.readyState === WebSocket.OPEN);
            if (hasLiveSync) {
                sendWidgetLayoutBatch(pending.widgetLayout, { fullLayout: pending.isFullLayout });
                notifyWidgetLayoutSaveSuccess({});
                return;
            }
            void postWidgetLayoutUpdate(pending.widgetLayout, { fullLayout: pending.isFullLayout }).then((success) => {
                if (success) {
                    reconcileWidgetLayoutPendingAfterHttp(pending.widgetLayout, { fullLayout: pending.isFullLayout });
                    notifyWidgetLayoutSaveSuccess({});
                    return;
                }
                scheduleWidgetLayoutSaveRetry();
            });
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

        function updateWidgetLibraryDragState(nextState) {
            widgetLibraryDragState = { ...widgetLibraryDragState, ...nextState };
        }

        function updateWidgetTouchDragState(nextState) {
            widgetTouchDragState = { ...widgetTouchDragState, ...nextState };
        }

        function attachWidgetLibraryDragListeners() {
            if (widgetLibraryDragListenersAttached) {
                return;
            }
            widgetLibraryDragListenersAttached = true;
            window.addEventListener("pointermove", handleWidgetLibraryPointerMove);
            window.addEventListener("pointerup", handleWidgetLibraryPointerEnd);
            window.addEventListener("pointercancel", handleWidgetLibraryPointerEnd);
        }

        function detachWidgetLibraryDragListeners() {
            if (!widgetLibraryDragListenersAttached) {
                return;
            }
            widgetLibraryDragListenersAttached = false;
            window.removeEventListener("pointermove", handleWidgetLibraryPointerMove);
            window.removeEventListener("pointerup", handleWidgetLibraryPointerEnd);
            window.removeEventListener("pointercancel", handleWidgetLibraryPointerEnd);
        }

        function attachWidgetTouchDragListeners() {
            if (widgetTouchDragListenersAttached) {
                return;
            }
            widgetTouchDragListenersAttached = true;
            window.addEventListener("pointermove", handleWidgetTouchPointerMove, { passive: false });
            window.addEventListener("pointerup", handleWidgetTouchPointerEnd);
            window.addEventListener("pointercancel", handleWidgetTouchPointerEnd);
        }

        function detachWidgetTouchDragListeners() {
            if (!widgetTouchDragListenersAttached) {
                return;
            }
            widgetTouchDragListenersAttached = false;
            window.removeEventListener("pointermove", handleWidgetTouchPointerMove);
            window.removeEventListener("pointerup", handleWidgetTouchPointerEnd);
            window.removeEventListener("pointercancel", handleWidgetTouchPointerEnd);
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

        function createWidgetLibraryAddToken() {
            return String(Date.now()) + "_" + Math.random().toString(16).slice(2);
        }

        function getWidgetLibraryAddState(widgetId) {
            if (!widgetId) {
                return { status: "idle", token: "" };
            }
            const entry = widgetLibraryAddState[widgetId];
            if (!entry || typeof entry !== "object") {
                return { status: "idle", token: "" };
            }
            return entry;
        }

        function setWidgetLibraryAddState(widgetId, nextState) {
            if (!widgetId) {
                return;
            }
            widgetLibraryAddState = { ...widgetLibraryAddState, [widgetId]: nextState };
            renderWidgetLibrary();
        }

        function clearWidgetLibraryAddState(widgetId, token) {
            if (!widgetId) {
                return;
            }
            const current = widgetLibraryAddState[widgetId];
            if (!current || (token && current.token !== token)) {
                return;
            }
            const { [widgetId]: _, ...rest } = widgetLibraryAddState;
            widgetLibraryAddState = rest;
            renderWidgetLibrary();
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
            const limitState = getWidgetLimitState();
            updateWidgetLimitMessage(limitState);
            updateWidgetLimitActionButtons(limitState);
            const needsLayoutSync = count > 0 && shouldGateAddSelectedWidgets();
            if (needsLayoutSync && !widgetLayoutSyncRequested) {
                widgetLayoutSyncRequested = true;
                requestWidgetLayoutSync();
                scheduleWidgetLayoutSyncFallback();
            } else if (!needsLayoutSync) {
                widgetLayoutSyncRequested = false;
            }
            const isSyncing = (pendingAddSelectedWidgets && count > 0) || needsLayoutSync;
            button.disabled = count === 0 || pendingAddSelectedWidgets || needsLayoutSync || limitState.limitReached;
            button.setAttribute("aria-busy", isSyncing ? "true" : "false");
            if (limitState.limitReached) {
                button.setAttribute(
                    "title",
                    buildWidgetLimitMessage(limitState.visibleCount, limitState.maxVisible),
                );
            } else {
                button.removeAttribute("title");
            }
            if (label instanceof HTMLElement) {
                if (isSyncing) {
                    label.textContent = "Syncing layout...";
                    return;
                }
                if (limitState.limitReached && count > 0) {
                    label.textContent = "Limit reached";
                    return;
                }
                label.textContent = count > 0 ? "Add Selected (" + count + ")" : "Add Selected";
            }
            updateWidgetLibrarySelectionSummary();
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

        const WIDGET_LAYOUT_ERROR_CODES = {
            invalidPayload: "widget_layout_invalid_payload",
            invalidContainer: "widget_layout_invalid_container",
            invalidWidgetId: "widget_layout_invalid_widget_id",
            invalidVersion: "widget_layout_invalid_version",
            versionMismatch: "widget_layout_version_mismatch",
        };
        const WIDGET_SIZE_ERROR_CODES = {
            invalidPayload: "widget_size_invalid_payload",
            invalidWidgetId: "widget_size_invalid_widget_id",
            invalidSize: "widget_size_invalid_value",
            invalidVersion: "widget_size_invalid_version",
            versionMismatch: "widget_size_version_mismatch",
        };

        function normalizeWidgetSizeState(input) {
            if (!input || typeof input !== "object" || Array.isArray(input)) {
                return {};
            }
            return Object.entries(input).reduce((acc, [widgetId, size]) => {
                if (typeof widgetId !== "string" || widgetId.length === 0) {
                    return acc;
                }
                const normalizedSize = normalizeWidgetSize(size);
                return { ...acc, [widgetId]: normalizedSize };
            }, {});
        }

        function normalizeWidgetLayoutState(input) {
            if (!input || typeof input !== "object" || Array.isArray(input)) {
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

        function validateWidgetLayoutState(payload) {
            if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
                return { valid: false, layout: {}, errorCode: WIDGET_LAYOUT_ERROR_CODES.invalidPayload };
            }
            const entries = Object.entries(payload);
            if (entries.length === 0) {
                return { valid: true, layout: {} };
            }
            const result = entries.reduce(
                (state, [containerId, widgetIds]) => {
                    if (!state.valid) {
                        return state;
                    }
                    if (typeof containerId !== "string" || containerId.length === 0 || !Array.isArray(widgetIds)) {
                        return {
                            layout: state.layout,
                            valid: false,
                            errorCode: WIDGET_LAYOUT_ERROR_CODES.invalidContainer,
                        };
                    }
                    const hasInvalidIds = widgetIds.some(
                        widgetId => typeof widgetId !== "string" || widgetId.length === 0,
                    );
                    if (hasInvalidIds) {
                        return {
                            layout: state.layout,
                            valid: false,
                            errorCode: WIDGET_LAYOUT_ERROR_CODES.invalidWidgetId,
                        };
                    }
                    const normalizedWidgetIds = widgetIds.reduce(
                        (ids, widgetId) => (ids.includes(widgetId) ? ids : ids.concat(widgetId)),
                        [],
                    );
                    return {
                        layout: { ...state.layout, [containerId]: normalizedWidgetIds },
                        valid: true,
                        errorCode: null,
                    };
                },
                { layout: {}, valid: true, errorCode: null },
            );

            return result.valid
                ? { valid: true, layout: result.layout }
                : { valid: false, layout: {}, errorCode: result.errorCode };
        }

        function validateWidgetSizeState(payload) {
            if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
                return { valid: false, sizes: {}, errorCode: WIDGET_SIZE_ERROR_CODES.invalidPayload };
            }
            const entries = Object.entries(payload);
            if (entries.length === 0) {
                return { valid: true, sizes: {} };
            }
            const allowedSizes = new Set(WIDGET_SIZE_OPTIONS);
            const result = entries.reduce(
                (state, [widgetId, size]) => {
                    if (!state.valid) {
                        return state;
                    }
                    if (typeof widgetId !== "string" || widgetId.length === 0) {
                        return {
                            sizes: state.sizes,
                            valid: false,
                            errorCode: WIDGET_SIZE_ERROR_CODES.invalidWidgetId,
                        };
                    }
                    if (typeof size !== "string" || !allowedSizes.has(size)) {
                        return {
                            sizes: state.sizes,
                            valid: false,
                            errorCode: WIDGET_SIZE_ERROR_CODES.invalidSize,
                        };
                    }
                    return {
                        sizes: { ...state.sizes, [widgetId]: size },
                        valid: true,
                        errorCode: null,
                    };
                },
                { sizes: {}, valid: true, errorCode: null },
            );
            return result.valid
                ? { valid: true, sizes: result.sizes }
                : { valid: false, sizes: {}, errorCode: result.errorCode };
        }

        function validateWidgetSizePayload(payload) {
            if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
                return { valid: false, sizes: {}, errorCode: WIDGET_SIZE_ERROR_CODES.invalidPayload };
            }
            const hasSizesKey = Object.prototype.hasOwnProperty.call(payload, "sizes");
            const hasVersionKey = Object.prototype.hasOwnProperty.call(payload, "version");
            const isWrapped = hasSizesKey && hasVersionKey;
            const candidateVersion = isWrapped ? payload.version : WIDGET_SIZE_SCHEMA_VERSION;
            if (isWrapped) {
                if (
                    typeof candidateVersion !== "number"
                    || !Number.isFinite(candidateVersion)
                    || !Number.isInteger(candidateVersion)
                    || candidateVersion < 1
                ) {
                    return { valid: false, sizes: {}, errorCode: WIDGET_SIZE_ERROR_CODES.invalidVersion };
                }
                if (candidateVersion !== WIDGET_SIZE_SCHEMA_VERSION) {
                    return {
                        valid: false,
                        sizes: {},
                        errorCode: WIDGET_SIZE_ERROR_CODES.versionMismatch,
                        version: candidateVersion,
                    };
                }
            }
            const candidateSizes = isWrapped ? payload.sizes : payload;
            const validated = validateWidgetSizeState(candidateSizes);
            if (!validated.valid) {
                return validated;
            }
            return { valid: true, sizes: validated.sizes, version: WIDGET_SIZE_SCHEMA_VERSION };
        }

        function validateWidgetLayoutPayload(payload) {
            if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
                return { valid: false, layout: {}, errorCode: WIDGET_LAYOUT_ERROR_CODES.invalidPayload };
            }

            const hasLayoutKey = Object.prototype.hasOwnProperty.call(payload, "layout");
            const hasVersionKey = Object.prototype.hasOwnProperty.call(payload, "version");
            const isWrapped = hasLayoutKey && hasVersionKey;
            const candidateVersion = isWrapped ? payload.version : WIDGET_LAYOUT_SCHEMA_VERSION;
            if (isWrapped) {
                if (
                    typeof candidateVersion !== "number"
                    || !Number.isFinite(candidateVersion)
                    || !Number.isInteger(candidateVersion)
                    || candidateVersion < 1
                ) {
                    return { valid: false, layout: {}, errorCode: WIDGET_LAYOUT_ERROR_CODES.invalidVersion };
                }
                if (candidateVersion !== WIDGET_LAYOUT_SCHEMA_VERSION) {
                    return {
                        valid: false,
                        layout: {},
                        errorCode: WIDGET_LAYOUT_ERROR_CODES.versionMismatch,
                        version: candidateVersion,
                    };
                }
            }

            const candidateLayout = isWrapped ? payload.layout : payload;
            const validated = validateWidgetLayoutState(candidateLayout);
            if (!validated.valid) {
                return validated;
            }

            const normalizedLayout = dedupeWidgetLayoutState(validated.layout);
            return { valid: true, layout: normalizedLayout, version: WIDGET_LAYOUT_SCHEMA_VERSION };
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

        function normalizeWidgetLayoutUpdatedAt(value) {
            if (typeof value === "number" && Number.isFinite(value)) {
                return value > 0 ? value : 0;
            }
            if (typeof value === "string" && value.trim().length > 0) {
                const parsed = Number(value);
                return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
            }
            return 0;
        }

        function loadWidgetLayoutMeta() {
            try {
                const raw = localStorage.getItem(WIDGET_LAYOUT_META_STORAGE_KEY);
                const parsed = raw ? JSON.parse(raw) : null;
                const updatedAt = normalizeWidgetLayoutUpdatedAt(parsed?.updatedAt);
                return { updatedAt };
            } catch (error) {
                console.warn("Failed to load widget layout metadata:", error);
                return { updatedAt: 0 };
            }
        }

        function saveWidgetLayoutMeta(updatedAt) {
            const normalizedUpdatedAt = normalizeWidgetLayoutUpdatedAt(updatedAt);
            const resolvedUpdatedAt = normalizedUpdatedAt > 0
                ? normalizedUpdatedAt
                : updatedAt === 0
                    ? 0
                    : Date.now();
            const payload = { updatedAt: resolvedUpdatedAt };
            safeLocalStorageSet(
                WIDGET_LAYOUT_META_STORAGE_KEY,
                payload,
                "Failed to persist widget layout metadata:",
            );
            return payload;
        }

        function readWidgetLayoutFromStorage() {
            try {
                const raw = localStorage.getItem(WIDGET_LAYOUT_STORAGE_KEY);
                if (!raw) {
                    return { status: "missing", layout: null, errorCode: null, version: null };
                }
                const parsed = JSON.parse(raw);
                const validated = validateWidgetLayoutPayload(parsed);
                if (!validated.valid) {
                    const status = validated.errorCode === WIDGET_LAYOUT_ERROR_CODES.versionMismatch
                        ? "version-mismatch"
                        : "corrupt";
                    return {
                        status,
                        layout: null,
                        errorCode: validated.errorCode ?? null,
                        version: validated.version ?? null,
                    };
                }
                return { status: "valid", layout: validated.layout, errorCode: null, version: validated.version ?? null };
            } catch (error) {
                console.warn("Failed to load widget layout:", error);
                return {
                    status: "corrupt",
                    layout: null,
                    errorCode: WIDGET_LAYOUT_ERROR_CODES.invalidPayload,
                    version: null,
                };
            }
        }

        function loadWidgetLayout() {
            const loaded = readWidgetLayoutFromStorage();
            return loaded.status === "valid" ? loaded.layout : {};
        }

        function initializeWidgetLayoutFromStorage() {
            const loaded = readWidgetLayoutFromStorage();
            if (loaded.status === "valid") {
                return {
                    status: "restored",
                    layout: loaded.layout,
                    errorCode: null,
                    version: loaded.version ?? null,
                };
            }
            if (loaded.status === "version-mismatch") {
                console.warn(
                    "Widget layout version mismatch. Rebuilding default layout.",
                    { expected: WIDGET_LAYOUT_SCHEMA_VERSION, found: loaded.version },
                );
            } else if (loaded.status === "corrupt") {
                if (loaded.errorCode) {
                    console.warn(
                        "Invalid widget layout found in localStorage. Falling back to default layout.",
                        { code: loaded.errorCode },
                    );
                } else {
                    console.warn("Invalid widget layout found in localStorage. Falling back to default layout.");
                }
            }
            const snapshot = buildWidgetLayoutForContainers(getWidgetContainers());
            const normalized = dedupeWidgetLayoutState(normalizeWidgetLayoutState(snapshot));
            saveWidgetLayoutState(normalized, { updatedAt: 0, allowZero: true });
            return {
                status: "fallback",
                layout: normalized,
                errorCode: loaded.errorCode ?? null,
                version: loaded.version ?? null,
            };
        }

        function seedWidgetLayoutIfEmpty() {
            const layout = loadWidgetLayout();
            if (Object.keys(layout).length > 0) {
                return layout;
            }
            const snapshot = buildWidgetLayoutForContainers(getWidgetContainers());
            const normalized = dedupeWidgetLayoutState(normalizeWidgetLayoutState(snapshot));
            if (Object.keys(normalized).length > 0) {
                saveWidgetLayoutState(normalized, { updatedAt: 0, allowZero: true });
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

        function buildWidgetSizePayload(sizes) {
            return {
                version: WIDGET_SIZE_SCHEMA_VERSION,
                sizes: normalizeWidgetSizeState(sizes),
            };
        }

        function readWidgetSizesFromStorage() {
            try {
                const raw = localStorage.getItem(WIDGET_SIZE_STORAGE_KEY);
                if (!raw) {
                    return { status: "missing", sizes: {}, errorCode: null, version: null };
                }
                const parsed = JSON.parse(raw);
                const validated = validateWidgetSizePayload(parsed);
                if (!validated.valid) {
                    const status = validated.errorCode === WIDGET_SIZE_ERROR_CODES.versionMismatch
                        ? "version-mismatch"
                        : "corrupt";
                    return {
                        status,
                        sizes: {},
                        errorCode: validated.errorCode ?? null,
                        version: validated.version ?? null,
                    };
                }
                return { status: "valid", sizes: validated.sizes, errorCode: null, version: validated.version ?? null };
            } catch (error) {
                console.warn("Failed to load widget sizes:", error);
                return {
                    status: "corrupt",
                    sizes: {},
                    errorCode: WIDGET_SIZE_ERROR_CODES.invalidPayload,
                    version: null,
                };
            }
        }

        function clearWidgetSizeStorage() {
            localStorage.removeItem(WIDGET_SIZE_STORAGE_KEY);
        }

        function loadWidgetSizes() {
            const loaded = readWidgetSizesFromStorage();
            if (loaded.status === "valid") {
                return loaded.sizes;
            }
            if (loaded.status === "version-mismatch") {
                console.warn(
                    "Widget size version mismatch. Resetting stored sizes.",
                    { expected: WIDGET_SIZE_SCHEMA_VERSION, found: loaded.version },
                );
            } else if (loaded.status === "corrupt") {
                if (loaded.errorCode) {
                    console.warn("Invalid widget sizes found in localStorage.", { code: loaded.errorCode });
                } else {
                    console.warn("Invalid widget sizes found in localStorage.");
                }
            }
            if (loaded.status !== "missing") {
                clearWidgetSizeStorage();
            }
            return {};
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

        function saveWidgetLayoutState(layout, options) {
            const normalized = dedupeWidgetLayoutState(normalizeWidgetLayoutState(layout));
            const normalizedUpdatedAt = normalizeWidgetLayoutUpdatedAt(options?.updatedAt);
            const shouldPreserveZero = options?.allowZero === true;
            const resolvedUpdatedAt = normalizedUpdatedAt > 0
                ? normalizedUpdatedAt
                : shouldPreserveZero
                    ? 0
                    : Date.now();
            const payload = {
                version: WIDGET_LAYOUT_SCHEMA_VERSION,
                layout: normalized,
            };
            safeLocalStorageSet(
                WIDGET_LAYOUT_STORAGE_KEY,
                payload,
                "Failed to persist widget layout:",
            );
            const meta = saveWidgetLayoutMeta(resolvedUpdatedAt);
            widgetLayoutLastAppliedAt = meta.updatedAt;
            widgetLayoutLastAppliedSnapshot = normalized;
            return normalized;
        }

        function saveWidgetSize(widgetId, size) {
            if (!widgetId) {
                return;
            }
            const sizes = loadWidgetSizes();
            const nextSizes = { ...sizes, [widgetId]: normalizeWidgetSize(size) };
            safeLocalStorageSet(
                WIDGET_SIZE_STORAGE_KEY,
                buildWidgetSizePayload(nextSizes),
                "Failed to persist widget sizes:",
            );
        }

        function saveWidgetSizes(updatedSizes) {
            if (!updatedSizes || typeof updatedSizes !== "object") {
                return loadWidgetSizes();
            }
            const sizes = loadWidgetSizes();
            const nextSizes = normalizeWidgetSizeState({ ...sizes, ...updatedSizes });
            safeLocalStorageSet(
                WIDGET_SIZE_STORAGE_KEY,
                buildWidgetSizePayload(nextSizes),
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

        function areWidgetLayoutStatesEqual(left, right) {
            const normalizedLeft = dedupeWidgetLayoutState(normalizeWidgetLayoutState(left));
            const normalizedRight = dedupeWidgetLayoutState(normalizeWidgetLayoutState(right));
            const leftKeys = Object.keys(normalizedLeft);
            const rightKeys = Object.keys(normalizedRight);
            if (leftKeys.length !== rightKeys.length) {
                return false;
            }
            return leftKeys.every((containerId) =>
                Object.prototype.hasOwnProperty.call(normalizedRight, containerId)
                && areWidgetIdListsEqual(normalizedLeft[containerId], normalizedRight[containerId]),
            );
        }

        function mergeWidgetLayoutFallback(currentLayout, incomingLayout) {
            const normalizedCurrent = dedupeWidgetLayoutState(normalizeWidgetLayoutState(currentLayout));
            const normalizedIncoming = dedupeWidgetLayoutState(normalizeWidgetLayoutState(incomingLayout));
            const currentContainers = new Set(Object.keys(normalizedCurrent));
            const fallbackUpdates = Object.entries(normalizedIncoming).reduce((acc, [containerId, widgetIds]) => {
                if (currentContainers.has(containerId)) {
                    return acc;
                }
                return { ...acc, [containerId]: widgetIds };
            }, {});
            return mergeWidgetLayoutUpdates(normalizedCurrent, fallbackUpdates);
        }

        function resolveWidgetLayoutConflict(currentLayout, currentMeta, incomingLayout, incomingMeta) {
            const normalizedCurrent = dedupeWidgetLayoutState(normalizeWidgetLayoutState(currentLayout));
            const normalizedIncoming = dedupeWidgetLayoutState(normalizeWidgetLayoutState(incomingLayout));
            const currentUpdatedAt = normalizeWidgetLayoutUpdatedAt(currentMeta?.updatedAt);
            const incomingUpdatedAt = normalizeWidgetLayoutUpdatedAt(incomingMeta?.updatedAt);
            if (currentUpdatedAt > 0 && incomingUpdatedAt > 0) {
                if (incomingUpdatedAt > currentUpdatedAt) {
                    return { layout: normalizedIncoming, updatedAt: incomingUpdatedAt, action: "replace" };
                }
                if (incomingUpdatedAt < currentUpdatedAt) {
                    return { layout: normalizedCurrent, updatedAt: currentUpdatedAt, action: "keep" };
                }
                const merged = mergeWidgetLayoutUpdates(normalizedCurrent, normalizedIncoming);
                return { layout: merged, updatedAt: currentUpdatedAt, action: "merge" };
            }
            if (currentUpdatedAt > 0 && incomingUpdatedAt === 0) {
                const merged = mergeWidgetLayoutFallback(normalizedCurrent, normalizedIncoming);
                return { layout: merged, updatedAt: currentUpdatedAt, action: "merge" };
            }
            if (incomingUpdatedAt > 0 && currentUpdatedAt === 0) {
                return { layout: normalizedIncoming, updatedAt: incomingUpdatedAt, action: "replace" };
            }
            const merged = mergeWidgetLayoutUpdates(normalizedCurrent, normalizedIncoming);
            return { layout: merged, updatedAt: 0, action: "merge" };
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

        function handleWidgetLayoutHttpResult(widgetLayout, options, success) {
            if (success) {
                reconcileWidgetLayoutPendingAfterHttp(widgetLayout, options);
                notifyWidgetLayoutSaveSuccess({});
                return;
            }
            notifyWidgetLayoutSaveFailure({});
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
                    handleWidgetLayoutHttpResult(updates, { fullLayout: false }, success);
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
                    handleWidgetLayoutHttpResult(normalized, { fullLayout }, success);
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

        function setupWidgetLayoutSyncChannel() {
            if (typeof BroadcastChannel === "undefined") {
                return;
            }
            if (widgetLayoutSyncChannel) {
                return;
            }
            const channel = new BroadcastChannel(WIDGET_LAYOUT_SYNC_CHANNEL);
            channel.onmessage = (event) => {
                handleWidgetLayoutBroadcast(event?.data);
            };
            widgetLayoutSyncChannel = channel;
        }

        function broadcastWidgetLayoutSync(widgetLayout, options) {
            if (!widgetLayoutSyncChannel) {
                return;
            }
            const updatedAt = normalizeWidgetLayoutUpdatedAt(options?.updatedAt) || Date.now();
            widgetLayoutSyncChannel.postMessage({
                type: "widget_layout_sync",
                layout: widgetLayout,
                updatedAt,
                sourceId: widgetLayoutSyncTabId,
            });
        }

        function handleWidgetLayoutBroadcast(payload) {
            if (!payload || payload.type !== "widget_layout_sync") {
                return;
            }
            if (payload.sourceId && payload.sourceId === widgetLayoutSyncTabId) {
                return;
            }
            const incomingLayout = payload.layout;
            if (!incomingLayout || typeof incomingLayout !== "object") {
                return;
            }
            const currentLayout = loadWidgetLayout();
            const currentMeta = loadWidgetLayoutMeta();
            const resolved = resolveWidgetLayoutConflict(
                currentLayout,
                currentMeta,
                incomingLayout,
                { updatedAt: payload.updatedAt },
            );
            const shouldApply = resolved.action !== "keep"
                || !areWidgetLayoutStatesEqual(currentLayout, resolved.layout);
            if (!shouldApply) {
                widgetLayoutLastAppliedAt = Math.max(widgetLayoutLastAppliedAt, resolved.updatedAt);
                return;
            }
            applyWidgetLayoutState(resolved.layout, {
                updatedAt: resolved.updatedAt,
                allowZero: resolved.updatedAt === 0,
            });
            updateWidgetLayoutSyncState({
                hasSynced: true,
                hasLayout: Object.keys(resolved.layout).length > 0,
            });
            triggerPendingAddSelectedWidgets();
        }

        async function loadUserProfileState(options) {
            const token = readAuthToken();
            if (!token) {
                widgetLayoutProfileState = {
                    ...widgetLayoutProfileState,
                    isAuthenticated: false,
                };
                return null;
            }
            const now = Date.now();
            const shouldRefresh = options?.force
                || !widgetLayoutProfileState.isAuthenticated
                || now - (widgetLayoutProfileState.lastFetchedAt || 0) > WIDGET_LAYOUT_PROFILE_REFRESH_MS;
            if (!shouldRefresh && widgetLayoutProfileState.preferences) {
                return widgetLayoutProfileState;
            }
            try {
                const response = await fetch("/api/users/me", {
                    headers: {
                        Authorization: "Bearer " + token,
                    },
                });
                if (!response.ok) {
                    widgetLayoutProfileState = {
                        ...widgetLayoutProfileState,
                        isAuthenticated: false,
                    };
                    return null;
                }
                const data = await response.json();
                const user = data?.user;
                if (!user || !user.id) {
                    return null;
                }
                const nextPreferences = user.preferences && typeof user.preferences === "object"
                    ? user.preferences
                    : {};
                widgetLayoutProfileState = {
                    userId: user.id,
                    preferences: nextPreferences,
                    lastFetchedAt: now,
                    isAuthenticated: true,
                };
                return widgetLayoutProfileState;
            } catch (error) {
                console.warn("Failed to load user profile:", error);
                widgetLayoutProfileState = {
                    ...widgetLayoutProfileState,
                    isAuthenticated: false,
                };
                return null;
            }
        }

        function extractWidgetLayoutFromProfile(preferences) {
            if (!preferences || typeof preferences !== "object") {
                return null;
            }
            const dashboardPreferences = preferences.dashboard;
            if (!dashboardPreferences || typeof dashboardPreferences !== "object") {
                return null;
            }
            const widgetLayout = dashboardPreferences.widgetLayout;
            if (!widgetLayout || typeof widgetLayout !== "object") {
                return null;
            }
            const layout = widgetLayout.layout ?? widgetLayout.widgetLayout ?? widgetLayout;
            if (!layout || typeof layout !== "object") {
                return null;
            }
            const updatedAt = normalizeWidgetLayoutUpdatedAt(widgetLayout.updatedAt);
            return { layout, updatedAt };
        }

        function buildWidgetLayoutProfilePayload(layout, updatedAt) {
            const normalizedLayout = dedupeWidgetLayoutState(normalizeWidgetLayoutState(layout));
            return {
                layout: normalizedLayout,
                updatedAt: normalizeWidgetLayoutUpdatedAt(updatedAt) || Date.now(),
                version: WIDGET_LAYOUT_PROFILE_VERSION,
            };
        }

        async function hydrateWidgetLayoutFromProfile(options) {
            const profileState = await loadUserProfileState(options);
            if (!profileState || !profileState.isAuthenticated) {
                return;
            }
            if (widgetLayoutProfileSyncState.pendingLayout) {
                void flushWidgetLayoutProfileSync();
            }
            const profileLayout = extractWidgetLayoutFromProfile(profileState.preferences);
            if (!profileLayout) {
                return;
            }
            const currentLayout = loadWidgetLayout();
            const currentMeta = loadWidgetLayoutMeta();
            const resolved = resolveWidgetLayoutConflict(
                currentLayout,
                currentMeta,
                profileLayout.layout,
                { updatedAt: profileLayout.updatedAt },
            );
            const shouldApply = resolved.action !== "keep"
                || !areWidgetLayoutStatesEqual(currentLayout, resolved.layout);
            if (!shouldApply) {
                if (currentMeta.updatedAt > profileLayout.updatedAt) {
                    scheduleWidgetLayoutProfileSync(currentLayout, { updatedAt: currentMeta.updatedAt });
                }
                return;
            }
            applyWidgetLayoutState(resolved.layout, {
                updatedAt: resolved.updatedAt,
                allowZero: resolved.updatedAt === 0,
            });
            updateWidgetLayoutSyncState({
                hasSynced: true,
                hasLayout: Object.keys(resolved.layout).length > 0,
            });
            triggerPendingAddSelectedWidgets();
            if (resolved.action === "merge") {
                scheduleWidgetLayoutProfileSync(resolved.layout, { updatedAt: resolved.updatedAt, force: true });
            }
        }

        function scheduleWidgetLayoutProfileSync(layout, options) {
            if (!layout || typeof layout !== "object") {
                return;
            }
            const updatedAt = normalizeWidgetLayoutUpdatedAt(options?.updatedAt) || Date.now();
            if (!options?.force && updatedAt <= widgetLayoutProfileSyncState.lastSyncedUpdatedAt) {
                return;
            }
            const normalized = dedupeWidgetLayoutState(normalizeWidgetLayoutState(layout));
            if (Object.keys(normalized).length === 0) {
                return;
            }
            if (widgetLayoutProfileSyncState.timeoutId !== null) {
                clearTimeout(widgetLayoutProfileSyncState.timeoutId);
            }
            const timeoutId = window.setTimeout(() => {
                void flushWidgetLayoutProfileSync();
            }, WIDGET_LAYOUT_PROFILE_SYNC_DEBOUNCE_MS);
            widgetLayoutProfileSyncState = {
                ...widgetLayoutProfileSyncState,
                timeoutId,
                pendingLayout: normalized,
                pendingUpdatedAt: updatedAt,
            };
        }

        async function flushWidgetLayoutProfileSync() {
            const pendingLayout = widgetLayoutProfileSyncState.pendingLayout;
            if (!pendingLayout || typeof pendingLayout !== "object") {
                return;
            }
            widgetLayoutProfileSyncState = {
                ...widgetLayoutProfileSyncState,
                timeoutId: null,
            };
            const token = readAuthToken();
            if (!token) {
                return;
            }
            const profileState = await loadUserProfileState({ force: false });
            const basePreferences = resolvePreferencesBase(profileState);
            const dashboardPreferences = basePreferences.dashboard && typeof basePreferences.dashboard === "object"
                ? basePreferences.dashboard
                : {};
            const payload = buildWidgetLayoutProfilePayload(
                pendingLayout,
                widgetLayoutProfileSyncState.pendingUpdatedAt,
            );
            const nextPreferences = {
                ...basePreferences,
                dashboard: {
                    ...dashboardPreferences,
                    widgetLayout: payload,
                },
            };
            const updatedAt = normalizeWidgetLayoutUpdatedAt(payload.updatedAt) || Date.now();
            const success = await persistPreferencesUpdate(nextPreferences, {
                updatedAt,
                source: "dashboard.widgetLayout",
            });
            if (success) {
                widgetLayoutProfileSyncState = {
                    ...widgetLayoutProfileSyncState,
                    pendingLayout: null,
                    pendingUpdatedAt: 0,
                    lastSyncedUpdatedAt: updatedAt,
                };
            }
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

        function commitWidgetLayoutUpdate(widgetLayout, options) {
            const updatedAt = normalizeWidgetLayoutUpdatedAt(options?.updatedAt) || Date.now();
            const normalized = saveWidgetLayoutState(widgetLayout, { updatedAt });
            if (options?.broadcast) {
                broadcastWidgetLayoutSync(normalized, { updatedAt });
            }
            if (options?.profileSync) {
                scheduleWidgetLayoutProfileSync(normalized, { updatedAt });
            }
            return { layout: normalized, updatedAt };
        }

        function saveWidgetLayout(containerId, widgetIds) {
            if (!containerId) {
                return;
            }
            const layout = loadWidgetLayout();
            const nextLayout = mergeWidgetLayoutUpdates(layout, {
                [containerId]: Array.isArray(widgetIds) ? widgetIds : [],
            });
            commitWidgetLayoutUpdate(nextLayout, { profileSync: true, broadcast: true });
        }

        function persistWidgetLayout(containerId, widgetIds, options) {
            if (!containerId) {
                return;
            }
            const layout = loadWidgetLayout();
            const nextLayout = mergeWidgetLayoutUpdates(layout, {
                [containerId]: Array.isArray(widgetIds) ? widgetIds : [],
            });
            commitWidgetLayoutUpdate(nextLayout, {
                profileSync: true,
                broadcast: true,
            });
            if (options?.broadcast) {
                scheduleWidgetLayoutAutoSave({
                    [containerId]: Array.isArray(widgetIds) ? widgetIds : [],
                });
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

        function getDashboardGridContainers() {
            return getWidgetContainers().filter(container => container.classList.contains("dashboard-grid"));
        }

        function parsePixelValue(value) {
            const parsed = Number.parseFloat(value);
            return Number.isFinite(parsed) ? parsed : 0;
        }

        function resolveDashboardGridRange(viewportWidth) {
            if (viewportWidth < DASHBOARD_GRID_BREAKPOINTS.mobileMax + 1) {
                return DASHBOARD_GRID_RANGES.mobile;
            }
            if (viewportWidth <= DASHBOARD_GRID_BREAKPOINTS.tabletMax) {
                return DASHBOARD_GRID_RANGES.tablet;
            }
            return DASHBOARD_GRID_RANGES.desktop;
        }

        function getDashboardGridGap(container) {
            if (typeof window === "undefined") {
                return 0;
            }
            const styles = window.getComputedStyle(container);
            const gapValue = styles.columnGap || styles.gap || "0";
            return parsePixelValue(gapValue);
        }

        function getDashboardGridMinWidth(container) {
            if (typeof window === "undefined") {
                return 0;
            }
            const styles = window.getComputedStyle(container);
            const minWidthValue = styles.getPropertyValue("--dashboard-grid-min-width") || "0";
            return parsePixelValue(minWidthValue);
        }

        function getDashboardGridContainerWidth(container, viewportWidth) {
            const rect = container.getBoundingClientRect();
            const width = rect.width || container.clientWidth || viewportWidth || 0;
            return Math.max(width, 0);
        }

        function computeDashboardGridColumns(container, widgetCount, viewportWidth) {
            const range = resolveDashboardGridRange(viewportWidth);
            const safeWidgetCount = Math.max(1, widgetCount);
            const minWidth = getDashboardGridMinWidth(container);
            const gap = getDashboardGridGap(container);
            const containerWidth = getDashboardGridContainerWidth(container, viewportWidth);
            const columnWidth = minWidth + gap;
            const maxByWidth = columnWidth > 0
                ? Math.floor((containerWidth + gap) / columnWidth)
                : range.max;
            const maxColumns = Math.min(range.max, safeWidgetCount, Math.max(1, maxByWidth));
            const minColumns = Math.min(range.min, maxColumns);
            return Math.max(minColumns, 1);
        }

        function applyDashboardGridColumns(container, columns) {
            container.style.setProperty("--dashboard-grid-columns", String(columns));
            if (columns === 1) {
                container.classList.add("dashboard-grid-single");
                return;
            }
            container.classList.remove("dashboard-grid-single");
        }

        function applyResponsiveDashboardGrid(containers) {
            if (typeof window === "undefined") {
                return;
            }
            const viewportWidth = window.innerWidth || 0;
            const resolvedContainers = Array.isArray(containers) && containers.length > 0
                ? containers
                : getDashboardGridContainers();
            resolvedContainers.forEach(container => {
                if (!(container instanceof HTMLElement) || !container.classList.contains("dashboard-grid")) {
                    return;
                }
                const widgetCount = getWidgets(container).length;
                const columns = computeDashboardGridColumns(container, widgetCount, viewportWidth);
                applyDashboardGridColumns(container, columns);
            });
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

        function getMaxVisibleWidgets() {
            return MAX_VISIBLE_WIDGETS;
        }

        function getVisibleWidgetCount() {
            return getAllWidgets().length;
        }

        function getRemainingWidgetSlots(visibleCountOverride) {
            const maxVisible = getMaxVisibleWidgets();
            const visibleCount = typeof visibleCountOverride === "number"
                ? visibleCountOverride
                : getVisibleWidgetCount();
            return Math.max(0, maxVisible - visibleCount);
        }

        function getWidgetLimitState() {
            const visibleCount = getVisibleWidgetCount();
            const maxVisible = getMaxVisibleWidgets();
            const remainingSlots = getRemainingWidgetSlots(visibleCount);
            return {
                visibleCount,
                maxVisible,
                remainingSlots,
                limitReached: remainingSlots === 0,
            };
        }

        function updateWidgetLimitMessage(limitState) {
            const message = document.getElementById("widgetLimitMessage");
            if (!(message instanceof HTMLElement)) {
                return;
            }
            if (limitState.limitReached) {
                message.textContent = buildWidgetLimitMessage(limitState.visibleCount, limitState.maxVisible);
                message.hidden = false;
                message.setAttribute("aria-hidden", "false");
                return;
            }
            message.textContent = "";
            message.hidden = true;
            message.setAttribute("aria-hidden", "true");
        }

        function updateWidgetLimitActionButtons(limitState) {
            const showAllWidgetsBtn = document.getElementById("showAllWidgetsBtn");
            if (showAllWidgetsBtn instanceof HTMLButtonElement) {
                const isDisabled = limitState.limitReached;
                showAllWidgetsBtn.disabled = isDisabled;
                if (isDisabled) {
                    showAllWidgetsBtn.setAttribute("aria-disabled", "true");
                    showAllWidgetsBtn.title = "Widget limit reached";
                } else {
                    showAllWidgetsBtn.removeAttribute("aria-disabled");
                    showAllWidgetsBtn.removeAttribute("title");
                }
            }
        }

        function buildWidgetLimitMessage(visibleCountOverride, maxVisibleOverride) {
            const maxVisible = typeof maxVisibleOverride === "number"
                ? maxVisibleOverride
                : getMaxVisibleWidgets();
            const visibleCount = typeof visibleCountOverride === "number"
                ? visibleCountOverride
                : getVisibleWidgetCount();
            return "Widget limit reached. You can show up to " +
                maxVisible +
                " widgets (currently " +
                visibleCount +
                "). Hide a widget to add more.";
        }

        function buildWidgetLimitAddMessage(maxVisible, attemptedCount, addedCount) {
            if (typeof attemptedCount !== "number" || typeof addedCount !== "number") {
                return "Widget limit reached. You can show up to " + maxVisible + " widgets. Hide a widget to add more.";
            }
            if (attemptedCount <= addedCount) {
                return "Widget limit reached. You can show up to " + maxVisible + " widgets. Hide a widget to add more.";
            }
            return "Widget limit reached. Added " +
                addedCount +
                " of " +
                attemptedCount +
                " widgets (max " +
                maxVisible +
                "). Hide a widget to add more.";
        }

        function updateEmptyDashboardState() {
            const emptyState = document.getElementById("dashboardEmptyState");
            if (!(emptyState instanceof HTMLElement)) {
                return;
            }
            const visibleWidgetCount = getAllWidgets().length;
            const isEmpty = visibleWidgetCount === 0;
            emptyState.hidden = !isEmpty;
            emptyState.setAttribute("aria-hidden", isEmpty ? "false" : "true");
        }

        function openWidgetLibraryFromEmptyState() {
            const widgetsTabButton = document.querySelector("[data-tab=\"widgets\"]");
            if (widgetsTabButton instanceof HTMLElement) {
                widgetsTabButton.click();
            }
            if (typeof history !== "undefined" && typeof history.replaceState === "function") {
                history.replaceState(null, "", "#widgetLibraryList");
            } else if (typeof window !== "undefined") {
                window.location.hash = "widgetLibraryList";
            }
            const list = document.getElementById("widgetLibraryList");
            if (!(list instanceof HTMLElement)) {
                return;
            }
            list.scrollIntoView({ behavior: "smooth", block: "start" });
            if (!list.hasAttribute("tabindex")) {
                list.setAttribute("tabindex", "-1");
            }
            if (typeof list.focus === "function") {
                list.focus({ preventScroll: true });
            }
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

        function getWidgetMoveAnnouncer() {
            if (typeof document === "undefined") {
                return null;
            }
            const announcer = document.getElementById(WIDGET_MOVE_ANNOUNCER_ID);
            return announcer instanceof HTMLElement ? announcer : null;
        }

        function announceWidgetMove(message) {
            if (!message || typeof window === "undefined") {
                return;
            }
            const announcer = getWidgetMoveAnnouncer();
            if (!announcer) {
                return;
            }
            announcer.textContent = "";
            window.setTimeout(() => {
                announcer.textContent = message;
            }, 0);
        }

        const WIDGET_LIBRARY_DESCRIPTION_OVERRIDES = {
            "overview-total": "Total tasks across your workspace.",
            "overview-pending": "Tasks awaiting action right now.",
            "overview-in-progress": "Active work currently in progress.",
            "overview-completed": "Completed tasks and throughput.",
            "overview-my-tasks": "Top tasks with quick actions to complete, reprioritize, or review.",
            "overview-connections": "Live agent connections and activity.",
            "overview-status-breakdown": "Status distribution across your tasks.",
            "overview-priority-breakdown": "Priority distribution snapshot.",
            "overview-recent-activity": "Latest task updates and activity stream.",
            "queue-total": "Queued tasks waiting for processing.",
            "queue-high-priority": "High priority tasks in the queue.",
            "queue-avg-processing": "Average processing time for queued work.",
            "queue-failed": "Failed queue items requiring attention.",
            "health-system": "System resource health snapshot.",
            "health-memory": "Memory usage overview.",
            "health-connections": "Active connection health signals.",
            "health-system-info": "System build and environment details.",
            "health-performance": "CPU and throughput signals.",
            "health-controls": "Worker controls and toggles.",
            "health-alerts": "Active alerts and warnings.",
        };

        const WIDGET_LIBRARY_PREVIEW_OVERRIDES = {
            "overview-total": "Workspace totals",
            "overview-my-tasks": "Task action list",
            "overview-recent-activity": "Activity feed preview",
            "overview-priority-breakdown": "Priority split preview",
            "health-system": "Live health snapshot",
            "health-alerts": "Alert activity preview",
        };

        const WIDGET_LIBRARY_DATA_SOURCE_OVERRIDES = {
            "overview-my-tasks": ["Task store", "Task actions"],
            "overview-connections": ["WebSocket", "Daemon sessions"],
            "overview-recent-activity": ["Activity log", "Task events"],
            "overview-status-breakdown": ["Task store", "Workflow status"],
            "overview-priority-breakdown": ["Task store", "Priority analytics"],
            "queue-avg-processing": ["Queue processor", "Timing metrics"],
            "health-system-info": ["Daemon runtime", "Host environment"],
            "health-controls": ["Worker manager", "Scheduler"],
            "health-alerts": ["Alerting", "System monitor"],
        };

        const WIDGET_LIBRARY_METRICS_COUNT_OVERRIDES = {
            "overview-status-breakdown": 3,
            "overview-priority-breakdown": 3,
            "overview-recent-activity": 5,
            "overview-my-tasks": 5,
            "health-system-info": 4,
            "health-controls": 2,
            "health-alerts": 2,
        };

        const WIDGET_LIBRARY_DATA_SOURCE_DEFAULTS = {
            overview: ["Task store", "Dashboard metrics"],
            queue: ["Queue processor", "Task store"],
            health: ["System monitor", "Daemon telemetry"],
            other: ["Dashboard telemetry"],
        };

        function buildWidgetLibraryDescription(widgetInfo) {
            const explicit = WIDGET_LIBRARY_DESCRIPTION_OVERRIDES[widgetInfo.id];
            if (explicit) {
                return explicit;
            }
            const label = widgetInfo.label || "Widget";
            const containerLabel = widgetInfo.containerLabel || getWidgetContainerLabel(widgetInfo.containerId);
            if (widgetInfo.id.startsWith("overview-")) {
                return "Overview signal for " + label + ".";
            }
            if (widgetInfo.id.startsWith("queue-")) {
                return "Queue signal for " + label + ".";
            }
            if (widgetInfo.id.startsWith("health-")) {
                return "Health signal for " + label + ".";
            }
            return containerLabel ? containerLabel + " widget for " + label + "." : "Dashboard widget for " + label + ".";
        }

        function buildWidgetLibraryDataSources(widgetInfo) {
            const explicit = WIDGET_LIBRARY_DATA_SOURCE_OVERRIDES[widgetInfo.id];
            if (explicit) {
                return [...explicit];
            }
            if (widgetInfo.id.startsWith("overview-")) {
                return [...WIDGET_LIBRARY_DATA_SOURCE_DEFAULTS.overview];
            }
            if (widgetInfo.id.startsWith("queue-")) {
                return [...WIDGET_LIBRARY_DATA_SOURCE_DEFAULTS.queue];
            }
            if (widgetInfo.id.startsWith("health-")) {
                return [...WIDGET_LIBRARY_DATA_SOURCE_DEFAULTS.health];
            }
            return [...WIDGET_LIBRARY_DATA_SOURCE_DEFAULTS.other];
        }

        function buildWidgetLibraryMetricsCount(widgetInfo) {
            const explicit = WIDGET_LIBRARY_METRICS_COUNT_OVERRIDES[widgetInfo.id];
            if (typeof explicit === "number") {
                return explicit;
            }
            if (widgetInfo.id.startsWith("health-")) {
                return 2;
            }
            return 1;
        }

        function buildWidgetLibraryPreview(widgetInfo) {
            const explicit = WIDGET_LIBRARY_PREVIEW_OVERRIDES[widgetInfo.id];
            if (explicit) {
                return explicit;
            }
            const containerLabel = widgetInfo.containerLabel || getWidgetContainerLabel(widgetInfo.containerId);
            return containerLabel ? containerLabel + " preview" : "Dashboard preview";
        }

        function normalizeWidgetLibrarySearchQuery(query) {
            if (typeof query !== "string") {
                return "";
            }
            return query.trim().toLowerCase();
        }

        function updateWidgetLibrarySearchQuery(nextQuery) {
            const resolved = typeof nextQuery === "string" ? nextQuery : "";
            if (resolved === widgetLibrarySearchQuery) {
                return;
            }
            widgetLibrarySearchQuery = resolved;
            renderWidgetLibrary();
        }

        function updateWidgetLibraryCategoryFilter(nextCategory) {
            const resolved = nextCategory || WIDGET_LIBRARY_FILTER_ALL;
            if (resolved === widgetLibraryActiveCategory) {
                return;
            }
            widgetLibraryActiveCategory = resolved;
            renderWidgetLibrary();
        }

        function resetWidgetLibraryFilters() {
            widgetLibrarySearchQuery = "";
            widgetLibraryActiveCategory = WIDGET_LIBRARY_FILTER_ALL;
            renderWidgetLibrary();
        }

        function getWidgetLibraryCategoryOptions(catalog) {
            const counts = catalog.reduce((acc, widget) => {
                const containerId = widget.containerId || "other";
                const current = acc[containerId] ?? 0;
                return { ...acc, [containerId]: current + 1 };
            }, {});
            const orderedContainerIds = [
                ...WIDGET_CONTAINER_ORDER,
                ...Object.keys(counts).filter(id => !WIDGET_CONTAINER_ORDER.includes(id)),
            ];
            const options = orderedContainerIds.map(containerId => ({
                id: containerId,
                label: getWidgetContainerLabel(containerId),
                count: counts[containerId] ?? 0,
            }));
            const totalCount = catalog.length;
            return [{ id: WIDGET_LIBRARY_FILTER_ALL, label: "All", count: totalCount }].concat(options);
        }

        function filterWidgetLibraryCatalog(catalog, searchQuery, activeCategory) {
            const searchTerm = normalizeWidgetLibrarySearchQuery(searchQuery);
            return catalog.filter(widget => {
                if (activeCategory !== WIDGET_LIBRARY_FILTER_ALL && widget.containerId !== activeCategory) {
                    return false;
                }
                if (!searchTerm) {
                    return true;
                }
                const haystack = [
                    widget.label,
                    widget.id,
                    widget.containerLabel,
                    widget.description,
                    Array.isArray(widget.dataSources) ? widget.dataSources.join(" ") : "",
                ]
                    .filter(Boolean)
                    .join(" ")
                    .toLowerCase();
                return haystack.includes(searchTerm);
            });
        }

        function buildWidgetLibraryTooltipId(widgetId) {
            if (!widgetId) {
                return "widget-library-tooltip";
            }
            const safeId = widgetId.replace(/[^a-zA-Z0-9_-]/g, "");
            return "widget-library-tooltip-" + safeId;
        }

        function buildWidgetLibraryTooltip(widgetInfo, state) {
            const tooltip = document.createElement("div");
            tooltip.className = "widget-library-tooltip";
            tooltip.id = buildWidgetLibraryTooltipId(widgetInfo.id);
            tooltip.setAttribute("role", "tooltip");

            const preview = document.createElement("div");
            preview.className = "widget-library-tooltip-preview";

            const badge = document.createElement("div");
            badge.className = "widget-library-tooltip-badge";

            const previewText = document.createElement("div");
            previewText.textContent = buildWidgetLibraryPreview(widgetInfo);

            preview.appendChild(badge);
            preview.appendChild(previewText);

            const title = document.createElement("div");
            title.className = "widget-library-tooltip-title";
            title.textContent = widgetInfo.label;

            const detail = document.createElement("div");
            detail.className = "widget-library-tooltip-detail";
            const left = document.createElement("span");
            left.textContent = widgetInfo.containerLabel || "Widget";
            const right = document.createElement("span");
            right.className = "widget-library-tooltip-status";
            if (!state.isHidden) {
                right.textContent = "On dashboard";
            } else if (state.isSelected) {
                right.textContent = "Selected";
            } else {
                right.textContent = "Available";
            }
            detail.appendChild(left);
            detail.appendChild(right);

            const description = document.createElement("div");
            description.textContent = widgetInfo.description;

            tooltip.appendChild(preview);
            tooltip.appendChild(title);
            tooltip.appendChild(description);
            tooltip.appendChild(detail);

            return tooltip;
        }

        function updateWidgetLibrarySelectionSummary(summary) {
            const summaryElement = document.getElementById("widgetLibrarySelectionSummary");
            if (!(summaryElement instanceof HTMLElement)) {
                return;
            }
            const clearButton = document.getElementById("clearSelectedWidgetsBtn");
            const totalCount = summary?.totalCount ?? widgetCatalog.length;
            const filteredCount = summary?.filteredCount ?? totalCount;
            const selectedCount = selectedWidgetIds.size;
            const countLabel = filteredCount === totalCount
                ? filteredCount + " widgets"
                : filteredCount + " of " + totalCount + " widgets";
            if (selectedCount === 0) {
                summaryElement.textContent = "Showing " + countLabel + ". None selected.";
            } else {
                summaryElement.textContent = "Showing " + countLabel + ". " + selectedCount + " selected.";
            }
            if (clearButton instanceof HTMLButtonElement) {
                clearButton.disabled = selectedCount === 0;
            }
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
                const containerLabel = getWidgetContainerLabel(resolvedContainerId);
                const widgetInfo = {
                    id: widgetId,
                    label,
                    containerId: resolvedContainerId,
                    containerLabel,
                };
                const dataSources = buildWidgetLibraryDataSources(widgetInfo);
                const metricsCount = buildWidgetLibraryMetricsCount(widgetInfo);
                return acc.concat({
                    ...widgetInfo,
                    description: buildWidgetLibraryDescription(widgetInfo),
                    dataSources,
                    metricsCount,
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
                 widget.classList.add("widget-appearing");
                 setTimeout(() => {
                     widget.classList.remove("widget-appearing");
                 }, 400);
             } else {
                widget.classList.add("widget-hidden");
                widget.setAttribute("aria-hidden", "true");
                widget.setAttribute("tabindex", "-1");
                widget.setAttribute("draggable", "false");
                widget.setAttribute("aria-grabbed", "false");
                widget.classList.remove("dragging", "drag-over");
            }
        }

        function enforceWidgetVisibilityLimit(hiddenWidgetIds) {
            const maxVisible = getMaxVisibleWidgets();
            if (!Number.isFinite(maxVisible) || maxVisible <= 0) {
                return hiddenWidgetIds;
            }
            const orderedWidgetIds = getAllWidgetsIncludingHidden()
                .map(widget => widget.dataset.widgetId)
                .filter(Boolean);
            if (orderedWidgetIds.length === 0) {
                return hiddenWidgetIds;
            }
            const hiddenSet = new Set(hiddenWidgetIds);
            const visibleIds = orderedWidgetIds.filter(widgetId => !hiddenSet.has(widgetId));
            if (visibleIds.length <= maxVisible) {
                return hiddenWidgetIds;
            }
            const overflowIds = visibleIds.slice(maxVisible);
            const nextHiddenSet = new Set(hiddenWidgetIds.concat(overflowIds));
            return Array.from(nextHiddenSet);
        }

        function applyWidgetVisibilityState(hiddenWidgetIdsOverride) {
            const resolvedHiddenWidgetIds = hiddenWidgetIdsOverride
                ? normalizeWidgetVisibilityState(hiddenWidgetIdsOverride)
                : loadHiddenWidgetIds();
            const limitedHiddenWidgetIds = enforceWidgetVisibilityLimit(resolvedHiddenWidgetIds);
            if (hiddenWidgetIdsOverride || limitedHiddenWidgetIds.length !== resolvedHiddenWidgetIds.length) {
                saveHiddenWidgetIds(limitedHiddenWidgetIds);
            }
            const hiddenWidgetIds = new Set(limitedHiddenWidgetIds);
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
            pruneSelectedWidgetIds(limitedHiddenWidgetIds);
            updateEmptyDashboardState();
            applyResponsiveDashboardGrid();
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
            if (shouldShow) {
                const visibleCount = getVisibleWidgetCount();
                const maxVisible = getMaxVisibleWidgets();
                if (visibleCount >= maxVisible) {
                    showWarning(buildWidgetLimitMessage(visibleCount, maxVisible));
                    renderWidgetLibrary();
                    return;
                }
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
            updateEmptyDashboardState();
            applyResponsiveDashboardGrid(containersToUpdate);
            renderWidgetLibrary();
        }

        function buildWidgetLayoutUpdatesForAddedWidgets(widgetTargets, layout) {
            const normalizedLayout = dedupeWidgetLayoutState(normalizeWidgetLayoutState(layout));
            const layoutAssignments = buildWidgetPlacementAssignments(normalizedLayout);
            const appendTargetsByContainer = widgetTargets.reduce((acc, target) => {
                if (!target?.shouldAppendAtEnd) {
                    return acc;
                }
                if (!target.containerId || !target.widgetId) {
                    return acc;
                }
                const current = acc[target.containerId] || [];
                return { ...acc, [target.containerId]: current.concat(target.widgetId) };
            }, {});
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
                const appendIds = appendTargetsByContainer[containerId] || [];
                const appendSet = new Set(appendIds);
                const baseOrder = Array.isArray(normalizedLayout[containerId])
                    ? normalizedLayout[containerId].filter(
                        widgetId => containerWidgetSet.has(widgetId) && !appendSet.has(widgetId),
                    )
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
            const updatedAt = Date.now();
            const nextLayout = hasUpdates
                ? commitWidgetLayoutUpdate(
                    mergeWidgetLayoutUpdates(normalizedLayout, layoutUpdates.updates),
                    { broadcast: true, profileSync: true, updatedAt },
                ).layout
                : (() => {
                    const layoutFromStorage = loadWidgetLayout();
                    const containerUpdates = normalizeWidgetLayoutState(
                        buildWidgetLayoutForContainers(containersToUpdate),
                    );
                    const mergedLayout = mergeWidgetLayoutUpdates(layoutFromStorage, containerUpdates);
                    return commitWidgetLayoutUpdate(mergedLayout, {
                        broadcast: true,
                        profileSync: true,
                        updatedAt,
                    }).layout;
                })();

            const broadcastUpdates = hasUpdates
                ? layoutUpdates.updates
                : normalizeWidgetLayoutState(buildWidgetLayoutForContainers(containersToUpdate));
            const shouldBroadcastFullLayout =
                !widgetLayoutSyncState.hasServerSync || !widgetLayoutSyncState.hasLayout;
            const broadcastPayload = shouldBroadcastFullLayout ? nextLayout : broadcastUpdates;
            if (Object.keys(broadcastPayload).length > 0) {
                scheduleWidgetLayoutAutoSave(broadcastPayload, { fullLayout: shouldBroadcastFullLayout });
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

            const visibleCount = getVisibleWidgetCount();
            const maxVisible = getMaxVisibleWidgets();
            const remainingSlots = getRemainingWidgetSlots(visibleCount);
            if (remainingSlots === 0) {
                showWarning(buildWidgetLimitMessage(visibleCount, maxVisible));
                renderWidgetLibrary();
                return;
            }
            const selectedIdsToAdd = selectedIds.slice(0, remainingSlots);
            const limitReached = selectedIdsToAdd.length < selectedIds.length;
            if (selectedIdsToAdd.length === 0) {
                renderWidgetLibrary();
                return;
            }

            const widgetTargets = selectedIdsToAdd.reduce((acc, widgetId) => {
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
                    shouldAppendAtEnd: true,
                });
            }, []);

            if (widgetTargets.length === 0) {
                updateSelectedWidgetIds(selectedIds);
                renderWidgetLibrary();
                return;
            }

            widgetTargets.forEach(target => {
                if (target.shouldAppendAtEnd || target.widget.parentElement !== target.container) {
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
            updateEmptyDashboardState();
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
            if (limitReached) {
                showWarning(
                    buildWidgetLimitAddMessage(maxVisible, selectedIds.length, widgetIdsToPersistSet.size),
                );
            } else if (remainingSelectedIds.length > 0) {
                showWarning("Some selected widgets could not be added. Try refreshing the dashboard.");
            }
        }

        function addWidgetFromLibrary(widgetId) {
            if (!widgetId) {
                return;
            }
            const hiddenSet = new Set(loadHiddenWidgetIds());
            if (!hiddenSet.has(widgetId)) {
                showInfo("Widget is already on the dashboard.");
                return;
            }
            const currentState = getWidgetLibraryAddState(widgetId);
            if (currentState.status === "loading") {
                return;
            }
            const token = createWidgetLibraryAddToken();
            setWidgetLibraryAddState(widgetId, { status: "loading", token });
            const startTime = Date.now();
            const result = addWidgetFromLibraryToDashboard(widgetId);
            const elapsed = Date.now() - startTime;
            const remainingDelay = Math.max(0, WIDGET_LIBRARY_ADD_LOADING_MS - elapsed);
            setTimeout(() => {
                if (!result.added) {
                    clearWidgetLibraryAddState(widgetId, token);
                    return;
                }
                setWidgetLibraryAddState(widgetId, { status: "success", token });
                showSuccess("Added " + result.label + " to the dashboard.");
                setTimeout(() => {
                    clearWidgetLibraryAddState(widgetId, token);
                }, WIDGET_LIBRARY_ADD_SUCCESS_MS);
            }, remainingDelay);
        }

        function addWidgetFromLibraryToDashboard(widgetId) {
            if (!widgetId) {
                return { added: false, label: "Widget" };
            }
            const widget = getWidgetById(widgetId);
            if (!(widget instanceof HTMLElement)) {
                return { added: false, label: "Widget" };
            }
            const label = getWidgetDisplayName(widget);
            if (!isWidgetLayoutReady()) {
                if (!hasWidgetLayoutSyncConnection()) {
                    const seededLayout = seedWidgetLayoutIfEmpty();
                    updateWidgetLayoutSyncState({
                        hasSynced: true,
                        hasLayout: Object.keys(seededLayout).length > 0,
                        hasServerSync: false,
                    });
                } else {
                    requestWidgetLayoutSync();
                    scheduleWidgetLayoutSyncFallback();
                    showInfo("Syncing layout. Try again in a moment.");
                    return { added: false, label };
                }
            }
            const hiddenWidgetIds = loadHiddenWidgetIds();
            const hiddenSet = new Set(hiddenWidgetIds);
            if (!hiddenSet.has(widgetId)) {
                return { added: false, label };
            }
            const visibleCount = getVisibleWidgetCount();
            const maxVisible = getMaxVisibleWidgets();
            if (visibleCount >= maxVisible) {
                showWarning(buildWidgetLimitMessage(visibleCount, maxVisible));
                return { added: false, label, reason: "limit" };
            }
            const seededLayout = seedWidgetLayoutIfEmpty();
            const layout = resolveWidgetLayoutForAdd(seededLayout);
            const currentContainer = widget.closest("[data-widget-container]");
            const resolvedCurrentContainer = currentContainer instanceof HTMLElement ? currentContainer : null;
            const container = resolveWidgetPlacementContainer(widgetId, widget, layout) ||
                resolvedCurrentContainer ||
                getWidgetHomeContainer(widget);
            if (!(container instanceof HTMLElement)) {
                return { added: false, label };
            }
            const containerId = container.dataset.widgetContainer;
            if (!containerId) {
                return { added: false, label };
            }
            const sourceContainer = resolvedCurrentContainer;
            const sourceContainerId = sourceContainer?.dataset.widgetContainer || null;
            const widgetTargets = [
                {
                    widgetId,
                    widget,
                    container,
                    containerId,
                    sourceContainer,
                    sourceContainerId,
                    shouldShow: true,
                    shouldAppendAtEnd: true,
                },
            ];

            widgetTargets.forEach(target => {
                if (target.shouldAppendAtEnd || target.widget.parentElement !== target.container) {
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

            const remainingSelectedIds = Array.from(selectedWidgetIds).filter(id => id !== widgetId);
            updateSelectedWidgetIds(remainingSelectedIds);
            updateEmptyDashboardState();
            renderWidgetLibrary();

            return { added: true, label };
        }

        function addWidgetFromLibraryToDashboardAtPosition(widgetId, container, placeholder) {
            if (!widgetId) {
                return { added: false, label: "Widget" };
            }
            const widget = getWidgetById(widgetId);
            if (!(widget instanceof HTMLElement)) {
                return { added: false, label: "Widget" };
            }
            const label = getWidgetDisplayName(widget);
            if (!isWidgetLayoutReady()) {
                if (!hasWidgetLayoutSyncConnection()) {
                    const seededLayout = seedWidgetLayoutIfEmpty();
                    updateWidgetLayoutSyncState({
                        hasSynced: true,
                        hasLayout: Object.keys(seededLayout).length > 0,
                        hasServerSync: false,
                    });
                } else {
                    requestWidgetLayoutSync();
                    scheduleWidgetLayoutSyncFallback();
                    showInfo("Syncing layout. Try again in a moment.");
                    return { added: false, label };
                }
            }
            const hiddenWidgetIds = loadHiddenWidgetIds();
            const hiddenSet = new Set(hiddenWidgetIds);
            if (!hiddenSet.has(widgetId)) {
                return { added: false, label };
            }
            const visibleCount = getVisibleWidgetCount();
            const maxVisible = getMaxVisibleWidgets();
            if (visibleCount >= maxVisible) {
                showWarning(buildWidgetLimitMessage(visibleCount, maxVisible));
                return { added: false, label, reason: "limit" };
            }
            const seededLayout = seedWidgetLayoutIfEmpty();
            const layout = resolveWidgetLayoutForAdd(seededLayout);
            const resolvedContainer = container instanceof HTMLElement
                ? container
                : resolveWidgetPlacementContainer(widgetId, widget, layout) ||
                    getWidgetHomeContainer(widget) ||
                    getFallbackWidgetContainer();
            if (!(resolvedContainer instanceof HTMLElement)) {
                return { added: false, label };
            }
            const containerId = resolvedContainer.dataset.widgetContainer;
            if (!containerId) {
                return { added: false, label };
            }
            const sourceContainer = widget.closest("[data-widget-container]");
            const resolvedSourceContainer = sourceContainer instanceof HTMLElement ? sourceContainer : null;

            if (placeholder && placeholder.parentNode === resolvedContainer) {
                resolvedContainer.insertBefore(widget, placeholder);
            } else {
                resolvedContainer.appendChild(widget);
            }
            syncWidgetHomeContainer(widget, containerId);
            initializeWidget(widget);
            initWidgetSizingForWidget(widget);
            setWidgetVisibility(widget, true);

            const nextHiddenWidgetIds = hiddenWidgetIds.filter(id => id !== widgetId);
            persistWidgetVisibility(nextHiddenWidgetIds, { broadcast: true });

            const layoutContainer = getWidgetContainerFromLayout(widgetId, layout);
            const containersToUpdate = uniqueContainers([
                resolvedContainer,
                resolvedSourceContainer,
                layoutContainer,
            ]);
            const nextLayout = containersToUpdate.length > 0
                ? persistWidgetLayoutForContainers(containersToUpdate, { broadcast: true })
                : loadWidgetLayout();
            if (containersToUpdate.length > 0) {
                applyWidgetOrderForContainers(containersToUpdate, nextLayout);
            }
            const nextLayoutHasEntries = Object.keys(nextLayout).length > 0;
            if (!widgetLayoutSyncState.hasLayout && nextLayoutHasEntries) {
                updateWidgetLayoutSyncState({ hasLayout: true });
            }
            if (!widgetLayoutSyncState.hasSynced && nextLayoutHasEntries) {
                updateWidgetLayoutSyncState({ hasSynced: true });
            }

            const remainingSelectedIds = Array.from(selectedWidgetIds).filter(id => id !== widgetId);
            updateSelectedWidgetIds(remainingSelectedIds);
            updateEmptyDashboardState();
            renderWidgetLibrary();

            return { added: true, label };
        }

        function renderWidgetLibrary() {
            const list = document.getElementById("widgetLibraryList");
            if (!(list instanceof HTMLElement)) {
                return;
            }
            collectWidgetCatalog();
            const limitState = getWidgetLimitState();
            const limitReached = limitState.limitReached;
            const hiddenWidgetIds = new Set(loadHiddenWidgetIds());
            const catalogIds = widgetCatalog.map(widget => widget.id);
            pruneSelectedWidgetIds(hiddenWidgetIds, catalogIds);
            const searchInput = document.getElementById("widgetLibrarySearch");
            if (searchInput instanceof HTMLInputElement && searchInput.value !== widgetLibrarySearchQuery) {
                searchInput.value = widgetLibrarySearchQuery;
            }

            const categoryOptions = getWidgetLibraryCategoryOptions(widgetCatalog);
            const validCategoryIds = new Set(categoryOptions.map(option => option.id));
            const resolvedCategory = validCategoryIds.has(widgetLibraryActiveCategory)
                ? widgetLibraryActiveCategory
                : WIDGET_LIBRARY_FILTER_ALL;
            if (resolvedCategory !== widgetLibraryActiveCategory) {
                widgetLibraryActiveCategory = resolvedCategory;
            }

            const filterGroup = document.getElementById("widgetLibraryFilterGroup");
            if (filterGroup instanceof HTMLElement) {
                filterGroup.innerHTML = "";
                categoryOptions.forEach(option => {
                    const button = document.createElement("button");
                    button.type = "button";
                    button.className = "widget-library-filter-btn";
                    if (option.id === resolvedCategory) {
                        button.classList.add("is-active");
                    }
                    button.setAttribute("aria-pressed", option.id === resolvedCategory ? "true" : "false");
                    button.textContent = option.label + " (" + option.count + ")";
                    button.addEventListener("click", () => {
                        updateWidgetLibraryCategoryFilter(option.id);
                    });
                    filterGroup.appendChild(button);
                });
            }

            const filteredCatalog = filterWidgetLibraryCatalog(
                widgetCatalog,
                widgetLibrarySearchQuery,
                resolvedCategory,
            );

            const results = document.getElementById("widgetLibraryResults");
            if (results instanceof HTMLElement) {
                const searchTerm = normalizeWidgetLibrarySearchQuery(widgetLibrarySearchQuery);
                const resultLabel = filteredCatalog.length === widgetCatalog.length
                    ? "Showing " + filteredCatalog.length + " widgets."
                    : "Showing " + filteredCatalog.length + " of " + widgetCatalog.length + " widgets.";
                const categoryLabel = resolvedCategory === WIDGET_LIBRARY_FILTER_ALL
                    ? ""
                    : " " + getWidgetContainerLabel(resolvedCategory) + ".";
                const searchLabel = searchTerm
                    ? " Search: \"" + widgetLibrarySearchQuery.trim() + "\"."
                    : "";
                results.textContent = resultLabel + categoryLabel + searchLabel;
            }

            updateWidgetLibrarySelectionSummary({
                filteredCount: filteredCatalog.length,
                totalCount: widgetCatalog.length,
            });

            const grouped = filteredCatalog.reduce((acc, widget) => {
                const containerId = widget.containerId || "other";
                const nextGroup = acc[containerId] ? acc[containerId].concat(widget) : [widget];
                return { ...acc, [containerId]: nextGroup };
            }, {});
            const orderedContainerIds = [
                ...WIDGET_CONTAINER_ORDER.filter(id => grouped[id]?.length),
                ...Object.keys(grouped).filter(id => !WIDGET_CONTAINER_ORDER.includes(id)),
            ];

            list.innerHTML = "";

            if (filteredCatalog.length === 0) {
                const emptyState = document.createElement("div");
                emptyState.className = "widget-library-empty";
                const emptyTitle = document.createElement("div");
                emptyTitle.textContent = "No widgets match your filters.";
                const resetButton = document.createElement("button");
                resetButton.type = "button";
                resetButton.className = "btn btn-secondary btn-sm";
                resetButton.textContent = "Reset filters";
                resetButton.addEventListener("click", resetWidgetLibraryFilters);
                emptyState.appendChild(emptyTitle);
                emptyState.appendChild(resetButton);
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

                const title = document.createElement("h3");
                title.className = "widget-library-section-title";
                title.textContent = getWidgetContainerLabel(containerId);
                section.appendChild(title);

                const sectionList = document.createElement("div");
                sectionList.className = "widget-library-catalog-grid";

                widgets.forEach(widgetInfo => {
                    const isHidden = hiddenWidgetIds.has(widgetInfo.id);
                    const isSelected = selectedWidgetIds.has(widgetInfo.id);
                    const item = document.createElement("div");
                    item.className = "widget-library-card";
                    if (isSelected) {
                        item.classList.add("selected");
                    }

                    const tooltip = buildWidgetLibraryTooltip(widgetInfo, { isHidden, isSelected });
                    item.appendChild(tooltip);
                    item.setAttribute("aria-describedby", tooltip.id);

                    const preview = document.createElement("div");
                    preview.className = "widget-library-card-preview";
                    preview.addEventListener("pointerdown", event => {
                        startWidgetLibraryPress(event, widgetInfo.id);
                    });

                    const previewBadge = document.createElement("div");
                    previewBadge.className = "widget-library-card-badge";

                    const previewText = document.createElement("div");
                    const name = document.createElement("div");
                    name.className = "widget-library-card-title";
                    name.textContent = widgetInfo.label;
                    const subtitle = document.createElement("div");
                    subtitle.className = "widget-library-card-subtitle";
                    subtitle.textContent = widgetInfo.containerLabel || "Widget";
                    previewText.appendChild(name);
                    previewText.appendChild(subtitle);
                    preview.appendChild(previewBadge);
                    preview.appendChild(previewText);

                    const body = document.createElement("div");
                    body.className = "widget-library-card-body";

                    const description = document.createElement("div");
                    description.className = "widget-library-card-description widget-library-item-description";
                    description.textContent = widgetInfo.description;
                    body.appendChild(description);

                    const rows = document.createElement("div");
                    rows.className = "widget-library-card-rows";

                    const sourcesRow = document.createElement("div");
                    sourcesRow.className = "widget-library-card-row";
                    const sourcesLabel = document.createElement("span");
                    sourcesLabel.className = "widget-library-card-row-label";
                    sourcesLabel.textContent = "Sources";
                    const sourcesValue = document.createElement("div");
                    sourcesValue.className = "widget-library-card-row-value";
                    const sources = Array.isArray(widgetInfo.dataSources) && widgetInfo.dataSources.length > 0
                        ? widgetInfo.dataSources
                        : ["Unspecified"];
                    sources.forEach(source => {
                        const tag = document.createElement("span");
                        tag.className = "widget-library-card-tag";
                        tag.textContent = source;
                        sourcesValue.appendChild(tag);
                    });
                    sourcesRow.appendChild(sourcesLabel);
                    sourcesRow.appendChild(sourcesValue);

                    const metricsRow = document.createElement("div");
                    metricsRow.className = "widget-library-card-row";
                    const metricsLabel = document.createElement("span");
                    metricsLabel.className = "widget-library-card-row-label";
                    metricsLabel.textContent = "Metrics";
                    const metricsValue = document.createElement("span");
                    metricsValue.className = "widget-library-card-row-metrics";
                    const metricsCount = Number.isFinite(widgetInfo.metricsCount) ? widgetInfo.metricsCount : 0;
                    metricsValue.textContent = metricsCount + " total";
                    metricsRow.appendChild(metricsLabel);
                    metricsRow.appendChild(metricsValue);

                    rows.appendChild(sourcesRow);
                    rows.appendChild(metricsRow);
                    body.appendChild(rows);

                    const meta = document.createElement("div");
                    meta.className = "widget-library-card-id";
                    meta.textContent = widgetInfo.id;
                    body.appendChild(meta);

                    const actionWrap = document.createElement("div");
                    actionWrap.className = "widget-library-card-actions";

                    const addState = getWidgetLibraryAddState(widgetInfo.id);
                    const isAdding = addState.status === "loading";
                    const isAdded = addState.status === "success";
                    const isDisabledForLimit = limitReached && isHidden;
                    const addButton = document.createElement("button");
                    addButton.type = "button";
                    addButton.className = "widget-library-add";
                    if (isAdding) {
                        addButton.classList.add("is-loading");
                    }
                    if (isAdded) {
                        addButton.classList.add("is-success");
                    }
                    addButton.disabled = !isHidden || isAdding || isAdded || isDisabledForLimit;
                    addButton.setAttribute("aria-busy", isAdding ? "true" : "false");
                    addButton.setAttribute("aria-live", "polite");
                    const addLabel = isAdding
                        ? "Adding..."
                        : isAdded
                            ? "Added"
                            : !isHidden
                                ? "On dashboard"
                                : isDisabledForLimit
                                    ? "Limit reached"
                                : "Add";
                    addButton.textContent = addLabel;
                    const addAriaLabel = isAdding
                        ? "Adding " + widgetInfo.label + " to dashboard"
                        : isAdded
                            ? widgetInfo.label + " added to dashboard"
                            : !isHidden
                                ? widgetInfo.label + " already on dashboard"
                                : isDisabledForLimit
                                    ? buildWidgetLimitMessage(limitState.visibleCount, limitState.maxVisible)
                                : "Add " + widgetInfo.label + " to dashboard";
                    addButton.setAttribute("aria-label", addAriaLabel);
                    addButton.addEventListener("click", () => {
                        addWidgetFromLibrary(widgetInfo.id);
                    });

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
                        const tooltipStatus = tooltip.querySelector(".widget-library-tooltip-status");
                        if (tooltipStatus instanceof HTMLElement) {
                            tooltipStatus.textContent = target.checked ? "Selected" : "Available";
                        }
                        updateWidgetLibrarySelectionSummary({
                            filteredCount: filteredCatalog.length,
                            totalCount: widgetCatalog.length,
                        });
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

                    actionWrap.appendChild(addButton);
                    actionWrap.appendChild(selectWrap);
                    actionWrap.appendChild(toggleWrap);

                    const notificationPreference = getWidgetNotificationPreference(widgetInfo.id);
                    const notificationsEnabled = notificationPreference.enabled;
                    const normalizedNotificationTypes = normalizeWidgetNotificationTypes(notificationPreference.types);
                    const notificationPreset = resolveWidgetNotificationPreset(normalizedNotificationTypes);
                    const notificationsWrap = document.createElement("div");
                    notificationsWrap.className = "widget-library-notifications";

                    const notificationsHeader = document.createElement("div");
                    notificationsHeader.className = "widget-library-notifications-header";
                    const notificationsTitle = document.createElement("span");
                    notificationsTitle.textContent = "Notifications";
                    const notificationsToggle = document.createElement("label");
                    notificationsToggle.className = "widget-library-notifications-toggle";
                    const notificationsToggleInput = document.createElement("input");
                    notificationsToggleInput.type = "checkbox";
                    notificationsToggleInput.checked = notificationsEnabled;
                    const notificationsToggleLabel = document.createElement("span");
                    notificationsToggleLabel.textContent = notificationsEnabled ? "On" : "Off";
                    notificationsToggleInput.addEventListener("change", event => {
                        const target = event.target;
                        if (!(target instanceof HTMLInputElement)) {
                            return;
                        }
                        updateWidgetNotificationPreference(widgetInfo.id, (current) => ({
                            ...current,
                            enabled: target.checked,
                        }));
                    });
                    notificationsToggle.appendChild(notificationsToggleInput);
                    notificationsToggle.appendChild(notificationsToggleLabel);
                    notificationsHeader.appendChild(notificationsTitle);
                    notificationsHeader.appendChild(notificationsToggle);

                    const notificationsPresetSelect = document.createElement("select");
                    notificationsPresetSelect.className = "widget-library-notification-select";
                    notificationsPresetSelect.disabled = !notificationsEnabled;
                    [
                        { id: WIDGET_NOTIFICATION_PRESET_ALL, label: "All updates" },
                        { id: WIDGET_NOTIFICATION_PRESET_NONE, label: "None" },
                        { id: WIDGET_NOTIFICATION_PRESET_CUSTOM, label: "Custom" },
                    ].forEach(optionInfo => {
                        const option = document.createElement("option");
                        option.value = optionInfo.id;
                        option.textContent = optionInfo.label;
                        notificationsPresetSelect.appendChild(option);
                    });
                    notificationsPresetSelect.value = notificationPreset;
                    notificationsPresetSelect.addEventListener("change", event => {
                        const target = event.target;
                        if (!(target instanceof HTMLSelectElement)) {
                            return;
                        }
                        if (target.value === WIDGET_NOTIFICATION_PRESET_CUSTOM) {
                            return;
                        }
                        const nextTypes = target.value === WIDGET_NOTIFICATION_PRESET_ALL
                            ? buildWidgetNotificationTypesState(true)
                            : buildWidgetNotificationTypesState(false);
                        updateWidgetNotificationPreference(widgetInfo.id, (current) => ({
                            ...current,
                            types: nextTypes,
                        }));
                    });

                    const notificationTypes = document.createElement("div");
                    notificationTypes.className = "widget-library-notification-types";
                    WIDGET_NOTIFICATION_TYPES.forEach(typeInfo => {
                        const typeLabel = document.createElement("label");
                        typeLabel.className = "widget-library-notification-type";
                        const typeCheckbox = document.createElement("input");
                        typeCheckbox.type = "checkbox";
                        typeCheckbox.checked = normalizedNotificationTypes[typeInfo.id];
                        typeCheckbox.disabled = !notificationsEnabled;
                        typeCheckbox.addEventListener("change", event => {
                            const target = event.target;
                            if (!(target instanceof HTMLInputElement)) {
                                return;
                            }
                            updateWidgetNotificationPreference(widgetInfo.id, (current) => {
                                const normalizedTypes = normalizeWidgetNotificationTypes(current.types);
                                return {
                                    ...current,
                                    types: { ...normalizedTypes, [typeInfo.id]: target.checked },
                                };
                            });
                        });
                        const typeText = document.createElement("span");
                        typeText.textContent = typeInfo.label;
                        typeLabel.appendChild(typeCheckbox);
                        typeLabel.appendChild(typeText);
                        notificationTypes.appendChild(typeLabel);
                    });

                    notificationsWrap.appendChild(notificationsHeader);
                    notificationsWrap.appendChild(notificationsPresetSelect);
                    notificationsWrap.appendChild(notificationTypes);

                    item.appendChild(preview);
                    item.appendChild(body);
                    item.appendChild(actionWrap);
                    item.appendChild(notificationsWrap);
                    sectionList.appendChild(item);
                });

                section.appendChild(sectionList);
                list.appendChild(section);
            });
        }

        function showAllWidgets() {
            const allWidgets = getAllWidgetsIncludingHidden();
            const visibleWidgets = getAllWidgets();
            const visibleCount = visibleWidgets.length;
            const maxVisible = getMaxVisibleWidgets();
            const remainingSlots = getRemainingWidgetSlots(visibleCount);
            if (remainingSlots === 0) {
                showWarning(buildWidgetLimitMessage(visibleCount, maxVisible));
                return;
            }
            const hiddenWidgets = allWidgets.filter(widget =>
                widget instanceof HTMLElement && widget.classList.contains("widget-hidden"),
            );
            const widgetsToShow = hiddenWidgets.slice(0, remainingSlots);
            const widgetsToKeepHidden = hiddenWidgets.slice(remainingSlots);
            const hiddenWidgetIds = widgetsToKeepHidden
                .map(widget => widget.dataset.widgetId)
                .filter(Boolean);
            const nextHiddenSet = new Set(hiddenWidgetIds);
            allWidgets.forEach(widget => {
                if (!(widget instanceof HTMLElement)) {
                    return;
                }
                const widgetId = widget.dataset.widgetId;
                if (!widgetId) {
                    return;
                }
                const shouldShow = !nextHiddenSet.has(widgetId);
                setWidgetVisibility(widget, shouldShow);
                if (shouldShow) {
                    initializeWidget(widget);
                    initWidgetSizingForWidget(widget);
                }
            });
            persistWidgetVisibility(hiddenWidgetIds, { broadcast: true });
            getWidgetContainers().forEach(container => saveWidgetLayoutForContainer(container, { broadcast: true }));
            updateSelectedWidgetIds([]);
            updateEmptyDashboardState();
            renderWidgetLibrary();
            if (widgetsToKeepHidden.length > 0) {
                showWarning(
                    buildWidgetLimitAddMessage(maxVisible, hiddenWidgets.length, widgetsToShow.length),
                );
            }
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
            updateEmptyDashboardState();
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

        function applyWidgetLayoutState(widgetLayout, options) {
            if (!widgetLayout || typeof widgetLayout !== "object") {
                return;
            }
            const normalized = dedupeWidgetLayoutState(normalizeWidgetLayoutState(widgetLayout));
            if (options?.persist === false) {
                const updatedAt = normalizeWidgetLayoutUpdatedAt(options?.updatedAt);
                widgetLayoutLastAppliedAt = updatedAt > 0 ? updatedAt : widgetLayoutLastAppliedAt;
                widgetLayoutLastAppliedSnapshot = normalized;
            } else {
                saveWidgetLayoutState(normalized, {
                    updatedAt: options?.updatedAt,
                    allowZero: options?.allowZero,
                });
            }
            applyWidgetOrder();
            renderWidgetLibrary();
            updateEmptyDashboardState();
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
            const currentLayout = loadWidgetLayout();
            const currentMeta = loadWidgetLayoutMeta();
            if (layoutPayload.hasValue) {
                if (layoutPayload.widgetLayout && typeof layoutPayload.widgetLayout === "object") {
                    const resolvedLayout = mergePendingLayout(layoutPayload.widgetLayout);
                    const resolved = resolveWidgetLayoutConflict(
                        currentLayout,
                        currentMeta,
                        resolvedLayout,
                        { updatedAt: 0 },
                    );
                    updateWidgetLayoutSyncState({
                        hasSynced: true,
                        hasLayout: Object.keys(resolved.layout).length > 0,
                        hasServerSync: true,
                    });
                    applyWidgetLayoutState(resolved.layout, {
                        updatedAt: resolved.updatedAt,
                        allowZero: resolved.updatedAt === 0,
                    });
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
                const nextLayout = mergeWidgetLayoutUpdates(currentLayout, updates);
                const resolvedLayout = mergePendingLayout(nextLayout);
                const resolved = resolveWidgetLayoutConflict(
                    currentLayout,
                    currentMeta,
                    resolvedLayout,
                    { updatedAt: 0 },
                );
                updateWidgetLayoutSyncState({
                    hasSynced: true,
                    hasLayout: Object.keys(resolved.layout).length > 0,
                    hasServerSync: true,
                });
                applyWidgetLayoutState(resolved.layout, {
                    updatedAt: resolved.updatedAt,
                    allowZero: resolved.updatedAt === 0,
                });
                triggerPendingAddSelectedWidgets();
                return;
            }
            const resolvedLayout = mergePendingLayout(currentLayout);
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

        function handleWidgetStorageUpdate(event) {
            if (!event || event.storageArea !== localStorage) {
                return;
            }
            if (event.key === WIDGET_VISIBILITY_STORAGE_KEY) {
                applyWidgetVisibilityState();
                return;
            }
            if (event.key === WIDGET_LAYOUT_STORAGE_KEY || event.key === WIDGET_LAYOUT_META_STORAGE_KEY) {
                const layout = loadWidgetLayout();
                const meta = loadWidgetLayoutMeta();
                const updatedAt = meta.updatedAt;
                const isDuplicate = updatedAt < widgetLayoutLastAppliedAt
                    || (updatedAt === widgetLayoutLastAppliedAt
                        && widgetLayoutLastAppliedSnapshot
                        && areWidgetLayoutStatesEqual(widgetLayoutLastAppliedSnapshot, layout));
                if (isDuplicate) {
                    return;
                }
                applyWidgetLayoutState(layout, {
                    updatedAt,
                    allowZero: updatedAt === 0,
                    persist: false,
                });
                updateWidgetLayoutSyncState({
                    hasSynced: true,
                    hasLayout: Object.keys(layout).length > 0,
                });
                triggerPendingAddSelectedWidgets();
                updateEmptyDashboardState();
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

        function getWidgetMoveContext(widget) {
            if (!(widget instanceof HTMLElement)) {
                return null;
            }
            const container = widget.closest("[data-widget-container]");
            if (!(container instanceof HTMLElement)) {
                return null;
            }
            const widgets = getWidgets(container);
            const index = widgets.indexOf(widget);
            if (index < 0) {
                return null;
            }
            return { container, widgets, index };
        }

        function shouldIgnoreWidgetKeydown(target, widget) {
            if (!(target instanceof HTMLElement)) {
                return true;
            }
            if (target === widget) {
                return false;
            }
            if (target.isContentEditable) {
                return true;
            }
            const tagName = target.tagName;
            return tagName === "BUTTON" || tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT";
        }

        function focusWidgetByIndex(widget, index) {
            const context = getWidgetMoveContext(widget);
            if (!context) {
                return;
            }
            const boundedIndex = Math.max(0, Math.min(context.widgets.length - 1, index));
            const target = context.widgets[boundedIndex];
            if (target && typeof target.focus === "function") {
                target.focus({ preventScroll: true });
            }
        }

        function focusAdjacentWidget(widget, offset) {
            const context = getWidgetMoveContext(widget);
            if (!context) {
                return;
            }
            const nextIndex = context.index + offset;
            if (nextIndex < 0 || nextIndex >= context.widgets.length) {
                return;
            }
            const target = context.widgets[nextIndex];
            if (target && typeof target.focus === "function") {
                target.focus({ preventScroll: true });
            }
        }

        function focusWidgetEdge(widget, edge) {
            const context = getWidgetMoveContext(widget);
            if (!context) {
                return;
            }
            const index = edge === "start" ? 0 : context.widgets.length - 1;
            const target = context.widgets[index];
            if (target && typeof target.focus === "function") {
                target.focus({ preventScroll: true });
            }
        }

        function handleWidgetKeyDown(event) {
            const widget = event.currentTarget;
            if (!(widget instanceof HTMLElement)) {
                return;
            }
            if (widgetDragState && widgetDragState.dragging) {
                return;
            }
            if (shouldIgnoreWidgetKeydown(event.target, widget)) {
                return;
            }
            if (event.altKey || event.ctrlKey || event.metaKey) {
                return;
            }
            switch (event.key) {
                case "ArrowLeft":
                case "ArrowUp":
                    event.preventDefault();
                    focusAdjacentWidget(widget, -1);
                    break;
                case "ArrowRight":
                case "ArrowDown":
                    event.preventDefault();
                    focusAdjacentWidget(widget, 1);
                    break;
                case "Home":
                    event.preventDefault();
                    focusWidgetEdge(widget, "start");
                    break;
                case "End":
                    event.preventDefault();
                    focusWidgetEdge(widget, "end");
                    break;
                default:
                    break;
            }
        }

        function updateWidgetMoveControlsForWidget(widget, index, total) {
            if (!(widget instanceof HTMLElement)) {
                return;
            }
            const buttons = Array.from(widget.querySelectorAll(".widget-move-btn"));
            if (buttons.length === 0) {
                return;
            }
            buttons.forEach(button => {
                if (!(button instanceof HTMLButtonElement)) {
                    return;
                }
                const direction = button.dataset.widgetMove;
                const isDisabled = direction === "up"
                    ? index === 0
                    : direction === "down"
                        ? index >= total - 1
                        : false;
                button.disabled = isDisabled;
                button.setAttribute("aria-disabled", isDisabled ? "true" : "false");
            });
        }

        function updateWidgetMoveControlsForContainer(container) {
            if (!(container instanceof HTMLElement)) {
                return;
            }
            const widgets = getWidgets(container);
            widgets.forEach((widget, index) => {
                updateWidgetMoveControlsForWidget(widget, index, widgets.length);
            });
        }

        function updateWidgetMoveControlsForContainers(containers) {
            uniqueContainers(containers).forEach(container => {
                updateWidgetMoveControlsForContainer(container);
            });
        }

        function focusWidgetMoveTarget(widget, direction) {
            if (!(widget instanceof HTMLElement)) {
                return;
            }
            const controls = widget.querySelector(".widget-remove-controls");
            if (!(controls instanceof HTMLElement)) {
                if (typeof widget.focus === "function") {
                    widget.focus({ preventScroll: true });
                }
                return;
            }
            const preferred = controls.querySelector(
                ".widget-move-btn[data-widget-move=\"" + direction + "\"]",
            );
            const enabledButtons = Array.from(controls.querySelectorAll(".widget-move-btn"))
                .filter(button => button instanceof HTMLButtonElement && !button.disabled);
            const preferredButton = preferred instanceof HTMLButtonElement && !preferred.disabled
                ? preferred
                : null;
            const fallback = enabledButtons.find(button => button !== preferredButton);
            const target = preferredButton || fallback || widget;
            if (target instanceof HTMLElement && typeof target.focus === "function") {
                target.focus({ preventScroll: true });
            }
        }

        function moveWidgetByDirection(widget, direction) {
            const context = getWidgetMoveContext(widget);
            if (!context) {
                return;
            }
            const { container, widgets, index } = context;
            const targetIndex = direction === "up" ? index - 1 : index + 1;
            if (targetIndex < 0 || targetIndex >= widgets.length) {
                return;
            }
            const referenceWidget = widgets[targetIndex];
            const referenceNode = direction === "up"
                ? referenceWidget
                : referenceWidget.nextElementSibling;
            container.insertBefore(widget, referenceNode);
            persistWidgetLayoutForContainers([container], { broadcast: true });
            updateWidgetMoveControlsForContainer(container);
            const nextWidgets = getWidgets(container);
            const nextIndex = nextWidgets.indexOf(widget);
            if (nextIndex >= 0) {
                const widgetLabel = getWidgetDisplayName(widget);
                const containerLabel = getWidgetContainerLabel(container.dataset.widgetContainer);
                const position = nextIndex + 1;
                const total = nextWidgets.length;
                announceWidgetMove(
                    "Moved " + widgetLabel + " to position " + position + " of " + total + " in " + containerLabel + ".",
                );
            }
            window.requestAnimationFrame(() => {
                focusWidgetMoveTarget(widget, direction);
            });
        }

        function createWidgetMoveButton(widget, direction, label) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "widget-move-btn";
            button.dataset.widgetMove = direction;
            const actionLabel = "Move " + label + " " + direction;
            button.setAttribute("aria-label", actionLabel);
            button.setAttribute("title", actionLabel);
            button.textContent = direction === "up" ? "Up" : "Down";
            button.addEventListener("click", event => {
                event.preventDefault();
                event.stopPropagation();
                moveWidgetByDirection(widget, direction);
            });
            return button;
        }

        function ensureWidgetMoveControls(widget, controls) {
            if (!(widget instanceof HTMLElement) || !(controls instanceof HTMLElement)) {
                return;
            }
            if (controls.dataset.widgetMoveControlsReady === "true") {
                return;
            }
            const label = getWidgetDisplayName(widget);
            const insertBeforeNode = controls.querySelector(".widget-remove-btn");
            const moveUpButton = createWidgetMoveButton(widget, "up", label);
            const moveDownButton = createWidgetMoveButton(widget, "down", label);
            controls.insertBefore(moveUpButton, insertBeforeNode);
            controls.insertBefore(moveDownButton, insertBeforeNode);
            controls.dataset.widgetMoveControlsReady = "true";
        }

        function initWidgetRemoveControls(widget) {
            if (!(widget instanceof HTMLElement)) {
                return;
            }
            const widgetId = widget.dataset.widgetId;
            if (!widgetId) {
                return;
            }
            const existingControls = widget.querySelector(".widget-remove-controls");
            if (existingControls instanceof HTMLElement) {
                ensureWidgetMoveControls(widget, existingControls);
                return;
            }
            if (widget.dataset.widgetRemoveReady === "true") {
                return;
            }
            widget.dataset.widgetRemoveReady = "true";

            const controls = document.createElement("div");
            controls.className = "widget-remove-controls";
            controls.setAttribute("role", "group");
            controls.setAttribute("aria-label", "Widget actions");

            const button = document.createElement("button");
            button.type = "button";
            button.className = "widget-remove-btn";
            const label = getWidgetDisplayName(widget);
            const actionLabel = "Remove " + label;
            button.setAttribute("aria-label", actionLabel);
            button.setAttribute("title", actionLabel);
            button.textContent = "Remove";
            button.addEventListener("click", event => {
                event.preventDefault();
                event.stopPropagation();
                toggleWidgetVisibility(widgetId, false);
            });

            ensureWidgetMoveControls(widget, controls);
            controls.appendChild(button);
            widget.insertBefore(controls, widget.firstChild);
        }

        function initWidgetDragHandle(widget) {
            if (!(widget instanceof HTMLElement)) {
                return;
            }
            if (widget.dataset.widgetDragHandleReady === "true") {
                return;
            }
            widget.dataset.widgetDragHandleReady = "true";

            const handle = document.createElement("div");
            handle.className = "widget-drag-handle";
            handle.setAttribute("aria-hidden", "true");
            handle.dataset.widgetDragHandle = "true";
            widget.insertBefore(handle, widget.firstChild);
        }

        function applyWidgetOrderForContainer(container, layout) {
            container.classList.add("widget-container");
            const containerId = container.dataset.widgetContainer;
            const savedOrder = containerId ? layout[containerId] : null;
            if (!Array.isArray(savedOrder) || savedOrder.length === 0) {
                updateWidgetMoveControlsForContainer(container);
                applyResponsiveDashboardGrid([container]);
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
            updateWidgetMoveControlsForContainer(container);
            applyResponsiveDashboardGrid([container]);
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
            ensureWidgetNotificationIndicator(widget);
            initWidgetDragHandle(widget);
            initWidgetRemoveControls(widget);
            widget.addEventListener("keydown", handleWidgetKeyDown);
            widget.addEventListener("pointerdown", handleWidgetPointerDown);
            widget.addEventListener("pointerup", clearWidgetDragHandleState);
            widget.addEventListener("pointercancel", clearWidgetDragHandleState);
            widget.addEventListener("dragstart", handleWidgetDragStart);
            widget.addEventListener("dragend", handleWidgetDragEnd);
            const container = widget.closest("[data-widget-container]");
            if (container instanceof HTMLElement) {
                updateWidgetMoveControlsForContainer(container);
            }
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
                const removeControls = widget.querySelector(".widget-remove-controls");
                const insertBeforeNode = removeControls ? removeControls.nextSibling : widget.firstChild;
                widget.insertBefore(controls, insertBeforeNode);
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

        function isWidgetDragHandleElement(target) {
            if (!(target instanceof HTMLElement)) {
                return false;
            }
            if (target.closest(WIDGET_DRAG_HANDLE_SELECTORS)) {
                return true;
            }
            return Boolean(target.closest(WIDGET_DRAG_HEADER_SELECTORS));
        }

        function isWidgetDragHandleTarget(event) {
            if (isWidgetDragHandleElement(event.target)) {
                return true;
            }
            if (typeof event.composedPath !== "function") {
                return false;
            }
            return event.composedPath().some(entry => isWidgetDragHandleElement(entry));
        }

        function clearWidgetDragHandleState() {
            if (!widgetDragState.dragHandleActive) {
                return;
            }
            updateWidgetDragState({ dragHandleActive: false });
        }

        function handleWidgetPointerDown(event) {
            if (!event.isPrimary) {
                return;
            }
            if (event.pointerType === "mouse" && event.button !== 0) {
                return;
            }
            if (shouldIgnoreWidgetDrag(event)) {
                clearWidgetDragHandleState();
                return;
            }
            const dragHandleActive = isWidgetDragHandleTarget(event);
            updateWidgetDragState({ dragHandleActive });
            if (dragHandleActive && event.pointerType !== "mouse") {
                beginWidgetTouchDrag(event);
            }
        }

        function beginWidgetTouchDrag(event) {
            if (widgetDragState.dragging || widgetLibraryDragState.active) {
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
            updateWidgetTouchDragState({
                pointerId: event.pointerId,
                widget,
                container,
                ghost: null,
                startX: event.clientX,
                startY: event.clientY,
                lastX: event.clientX,
                lastY: event.clientY,
                active: false,
            });
            if (typeof widget.setPointerCapture === "function") {
                widget.setPointerCapture(event.pointerId);
            }
            attachWidgetTouchDragListeners();
        }

        function setWidgetDraggingState(isDragging) {
            if (typeof document === "undefined" || !document.body) {
                return;
            }
            if (isDragging) {
                document.body.classList.add("widget-dragging");
            } else {
                document.body.classList.remove("widget-dragging");
            }
        }

        function getWidgetGhostScale() {
            if (typeof document === "undefined") {
                return DEFAULT_WIDGET_GHOST_SCALE;
            }
            const rawScale = window.getComputedStyle(document.documentElement)
                .getPropertyValue("--widget-drag-ghost-scale")
                .trim();
            const parsedScale = Number.parseFloat(rawScale);
            return Number.isFinite(parsedScale) && parsedScale > 0
                ? parsedScale
                : DEFAULT_WIDGET_GHOST_SCALE;
        }

        function applyWidgetGhostPointerTransform(ghost) {
            if (!(ghost instanceof HTMLElement)) {
                return DEFAULT_WIDGET_GHOST_SCALE;
            }
            const scale = getWidgetGhostScale();
            ghost.style.transform = "translate(-50%, -50%) scale(" + scale + ")";
            return scale;
        }

        function updateWidgetDragContainer(nextContainer) {
            const current = widgetDragState.container;
            if (current === nextContainer) {
                return;
            }
            if (current instanceof HTMLElement) {
                current.classList.remove("drag-active", "drag-hover");
                clearWidgetDragOver(current);
            }
            if (nextContainer instanceof HTMLElement) {
                nextContainer.classList.add("drag-active");
            }
            updateWidgetDragState({ container: nextContainer });
        }

        function updateWidgetTouchGhostPosition(ghost, x, y) {
            if (!(ghost instanceof HTMLElement)) {
                return;
            }
            ghost.style.left = Number.isFinite(x) ? String(x) + "px" : "";
            ghost.style.top = Number.isFinite(y) ? String(y) + "px" : "";
        }

        function activateWidgetTouchDrag() {
            const widget = widgetTouchDragState.widget;
            const container = widgetTouchDragState.container;
            if (!(widget instanceof HTMLElement) || !(container instanceof HTMLElement)) {
                return;
            }
            clearWidgetDropFeedback();
            updateWidgetDragState({ dragging: widget, container, dragHandleActive: false });
            captureWidgetDragOrigin(widget, container);
            const ghost = createWidgetGhost(widget);
            ghost.style.position = "fixed";
            applyWidgetGhostPointerTransform(ghost);
            updateWidgetTouchGhostPosition(ghost, widgetTouchDragState.lastX, widgetTouchDragState.lastY);
            widget.classList.add("dragging");
            widget.setAttribute("aria-grabbed", "true");
            container.classList.add("drag-active");
            setWidgetDraggingState(true);
            updateWidgetTouchDragState({ ghost, active: true });
        }

        function resetWidgetTouchDragState() {
            const ghost = widgetTouchDragState.ghost;
            if (ghost && ghost.parentNode) {
                ghost.parentNode.removeChild(ghost);
            }
            detachWidgetTouchDragListeners();
            updateWidgetTouchDragState({
                pointerId: null,
                widget: null,
                container: null,
                ghost: null,
                startX: 0,
                startY: 0,
                lastX: 0,
                lastY: 0,
                active: false,
            });
        }

        function handleWidgetTouchPointerMove(event) {
            if (!widgetTouchDragState.pointerId || event.pointerId !== widgetTouchDragState.pointerId) {
                return;
            }
            const nextX = event.clientX;
            const nextY = event.clientY;
            updateWidgetTouchDragState({ lastX: nextX, lastY: nextY });

            if (!widgetTouchDragState.active) {
                const dx = nextX - widgetTouchDragState.startX;
                const dy = nextY - widgetTouchDragState.startY;
                const distance = Math.hypot(dx, dy);
                if (distance < WIDGET_TOUCH_DRAG_THRESHOLD) {
                    return;
                }
                activateWidgetTouchDrag();
                return;
            }

            event.preventDefault();
            const ghost = widgetTouchDragState.ghost;
            if (ghost instanceof HTMLElement) {
                updateWidgetTouchGhostPosition(ghost, nextX, nextY);
            }

            const widget = widgetDragState.dragging ?? widgetTouchDragState.widget;
            if (!(widget instanceof HTMLElement)) {
                return;
            }

            const nextContainer = resolveWidgetDropContainer(nextX, nextY);
            if (nextContainer instanceof HTMLElement) {
                updateWidgetDragContainer(nextContainer);
                updateWidgetDragOverAtPosition(widget, nextContainer, nextX, nextY);
                return;
            }

            if (widgetDragState.container instanceof HTMLElement) {
                widgetDragState.container.classList.remove("drag-hover");
                clearWidgetDragOver(widgetDragState.container);
            }
            if (widgetDragState.placeholder) {
                widgetDragState.placeholder.classList.remove("is-active");
            }
            updateWidgetDragContainer(null);
        }

        function handleWidgetTouchPointerEnd(event) {
            if (!widgetTouchDragState.pointerId || event.pointerId !== widgetTouchDragState.pointerId) {
                return;
            }
            const wasActive = widgetTouchDragState.active;
            const dropContainer = widgetDragState.container;
            const originContainer = widgetDragState.originContainer;
            const draggingWidget = widgetDragState.dragging;

            resetWidgetTouchDragState();
            clearWidgetDragHandleState();

            if (!wasActive) {
                return;
            }
            if (!(dropContainer instanceof HTMLElement) || !(draggingWidget instanceof HTMLElement)) {
                cancelWidgetDrag();
                return;
            }

            event.preventDefault();
            const placeholder = widgetDragState.placeholder;
            if (placeholder && placeholder.parentNode === dropContainer) {
                dropContainer.insertBefore(draggingWidget, placeholder);
            }
            const containerId = dropContainer.dataset.widgetContainer;
            if (containerId) {
                syncWidgetHomeContainer(draggingWidget, containerId);
            }

            applyWidgetDropFeedback(draggingWidget, dropContainer);
            finalizeWidgetDrag(dropContainer);

            const containers = [dropContainer, originContainer].filter(
                (container, index, list) =>
                    container instanceof HTMLElement && list.indexOf(container) === index,
            );
            persistWidgetLayoutForContainers(containers, { broadcast: true });
        }

        function captureWidgetDragOrigin(widget, container) {
            if (!(widget instanceof HTMLElement) || !(container instanceof HTMLElement)) {
                return;
            }
            updateWidgetDragState({
                originContainer: container,
                originNextSibling: widget.nextElementSibling,
            });
        }

        function restoreWidgetDragOrigin() {
            const { dragging, originContainer, originNextSibling } = widgetDragState;
            if (!(dragging instanceof HTMLElement) || !(originContainer instanceof HTMLElement)) {
                return;
            }
            if (originNextSibling && originNextSibling.parentElement === originContainer) {
                originContainer.insertBefore(dragging, originNextSibling);
                return;
            }
            originContainer.appendChild(dragging);
        }

        function cancelWidgetDrag() {
            if (!widgetDragState.dragging) {
                return;
            }
            clearWidgetDropFeedback();
            restoreWidgetDragOrigin();
            const container = widgetDragState.container ?? widgetDragState.originContainer;
            if (container instanceof HTMLElement) {
                finalizeWidgetDrag(container);
                return;
            }
            if (widgetDragState.dragging) {
                widgetDragState.dragging.classList.remove("dragging");
                widgetDragState.dragging.setAttribute("aria-grabbed", "false");
            }
            updateWidgetDragState({
                dragging: null,
                placeholder: null,
                container: null,
                originContainer: null,
                originNextSibling: null,
                dragHandleActive: false,
            });
            setWidgetDraggingState(false);
        }

        function clearWidgetDropFeedback() {
            const { dropTimeoutId, dropTarget, dropContainer } = widgetDragState;
            if (dropTimeoutId !== null) {
                clearTimeout(dropTimeoutId);
            }
            if (dropTarget instanceof HTMLElement) {
                dropTarget.classList.remove("dropping");
            }
            if (dropContainer instanceof HTMLElement) {
                dropContainer.classList.remove("drag-dropping");
            }
            updateWidgetDragState({ dropTimeoutId: null, dropTarget: null, dropContainer: null });
        }

        function applyWidgetDropFeedback(widget, container) {
            if (!(widget instanceof HTMLElement) || !(container instanceof HTMLElement)) {
                return;
            }
            clearWidgetDropFeedback();
            widget.classList.add("dropping");
            container.classList.add("drag-dropping");
            const dropTimeoutId = window.setTimeout(() => {
                widget.classList.remove("dropping");
                container.classList.remove("drag-dropping");
                updateWidgetDragState({ dropTimeoutId: null, dropTarget: null, dropContainer: null });
            }, WIDGET_DRAG_DROP_FEEDBACK_MS);
            updateWidgetDragState({ dropTimeoutId, dropTarget: widget, dropContainer: container });
        }

        function handleWidgetDragStart(event) {
            const dragHandleActive = widgetDragState.dragHandleActive || isWidgetDragHandleTarget(event);
            if (shouldIgnoreWidgetDrag(event) || !dragHandleActive || widgetLibraryDragState.active) {
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

            clearWidgetDropFeedback();
            updateWidgetDragState({ dragging: widget, container, dragHandleActive: false });
            captureWidgetDragOrigin(widget, container);
            const ghost = createWidgetGhost(widget);
            widget.classList.add("dragging");
            widget.setAttribute("aria-grabbed", "true");
            container.classList.add("drag-active");
            setWidgetDraggingState(true);
            if (event.dataTransfer) {
                const ghostScale = getWidgetGhostScale();
                const offsetX = Math.round((ghost.offsetWidth || 0) * ghostScale / 2);
                const offsetY = Math.round((ghost.offsetHeight || 0) * ghostScale / 2);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", widget.dataset.widgetId || "");
                event.dataTransfer.setDragImage(ghost, offsetX, offsetY);
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
            if (!(container instanceof HTMLElement)) {
                return;
            }

            event.preventDefault();
            if (event.dataTransfer) {
                event.dataTransfer.dropEffect = "move";
            }

            updateWidgetDragContainer(container);
            const activeContainer = widgetDragState.container;
            if (!(activeContainer instanceof HTMLElement)) {
                return;
            }

            const reference = getWidgetDropReference(activeContainer, event.clientX, event.clientY);
            const placeholder = ensureWidgetPlaceholder(widgetDragState.dragging, reference?.element);
            setWidgetDropIndicatorEdge(placeholder, reference?.before ? "before" : "after");

            activeContainer.classList.add("drag-hover");
            clearWidgetDragOver(activeContainer);
            placeholder.classList.add("drag-over");
            if (reference?.element) {
                reference.element.classList.add("drag-over");
                if (reference.before) {
                    activeContainer.insertBefore(placeholder, reference.element);
                } else {
                    activeContainer.insertBefore(placeholder, reference.element.nextSibling);
                }
            } else {
                activeContainer.appendChild(placeholder);
            }
        }

        function handleWidgetDrop(event) {
            if (!widgetDragState.dragging) {
                return;
            }

            const container = event.currentTarget;
            if (!(container instanceof HTMLElement)) {
                return;
            }

            event.preventDefault();

            const placeholder = widgetDragState.placeholder;
            if (placeholder && placeholder.parentNode === container) {
                container.insertBefore(widgetDragState.dragging, placeholder);
            }

            applyWidgetDropFeedback(widgetDragState.dragging, container);
            const originContainer = widgetDragState.originContainer;
            const containerId = container.dataset.widgetContainer;
            if (containerId) {
                syncWidgetHomeContainer(widgetDragState.dragging, containerId);
            }
            finalizeWidgetDrag(container);
            const containers = [container, originContainer].filter(
                (entry, index, list) =>
                    entry instanceof HTMLElement && list.indexOf(entry) === index,
            );
            persistWidgetLayoutForContainers(containers, { broadcast: true });
            updateWidgetMoveControlsForContainers(containers);
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

            container.classList.remove("drag-hover");
            if (widgetDragState.placeholder) {
                widgetDragState.placeholder.classList.remove("is-active");
            }
            clearWidgetDragOver(container);
        }

        function handleWidgetDragEnd() {
            clearWidgetDragHandleState();
            if (!widgetDragState.dragging) {
                return;
            }

            cancelWidgetDrag();
        }

        function clearWidgetLibraryHoldTimeout() {
            if (widgetLibraryDragState.holdTimeoutId !== null) {
                clearTimeout(widgetLibraryDragState.holdTimeoutId);
            }
            updateWidgetLibraryDragState({ holdTimeoutId: null });
        }

        function clearWidgetLibraryDragContainer() {
            const container = widgetLibraryDragState.container;
            if (container instanceof HTMLElement) {
                container.classList.remove("drag-active", "drag-hover");
                clearWidgetDragOver(container);
            }
            const placeholder = widgetDragState.placeholder;
            if (placeholder && placeholder.parentNode) {
                placeholder.parentNode.removeChild(placeholder);
            }
            updateWidgetDragState({ placeholder: null });
            updateWidgetLibraryDragState({ container: null });
        }

        function createWidgetLibraryGhost(widget) {
            const ghost = createWidgetGhost(widget);
            ghost.style.position = "fixed";
            applyWidgetGhostPointerTransform(ghost);
            return ghost;
        }

        function updateWidgetLibraryGhostPosition(ghost, x, y) {
            if (!(ghost instanceof HTMLElement)) {
                return;
            }
            ghost.style.left = Number.isFinite(x) ? String(x) + "px" : "";
            ghost.style.top = Number.isFinite(y) ? String(y) + "px" : "";
        }

        function resolveWidgetDropContainer(x, y) {
            if (!Number.isFinite(x) || !Number.isFinite(y)) {
                return null;
            }
            const target = document.elementFromPoint(x, y);
            if (!(target instanceof HTMLElement)) {
                return null;
            }
            const container = target.closest("[data-widget-container]");
            return container instanceof HTMLElement ? container : null;
        }

        function updateWidgetDragOverAtPosition(widget, container, x, y) {
            if (!(widget instanceof HTMLElement) || !(container instanceof HTMLElement)) {
                return;
            }
            const reference = getWidgetDropReference(container, x, y);
            const placeholder = ensureWidgetPlaceholder(widget, reference?.element);
            setWidgetDropIndicatorEdge(placeholder, reference?.before ? "before" : "after");

            container.classList.add("drag-hover");
            clearWidgetDragOver(container);
            placeholder.classList.add("drag-over");
            if (reference?.element) {
                reference.element.classList.add("drag-over");
                if (reference.before) {
                    container.insertBefore(placeholder, reference.element);
                } else {
                    container.insertBefore(placeholder, reference.element.nextSibling);
                }
                return;
            }
            container.appendChild(placeholder);
        }

        function canStartWidgetLibraryDrag(widgetId) {
            if (!widgetId) {
                return false;
            }
            const hiddenSet = new Set(loadHiddenWidgetIds());
            if (!hiddenSet.has(widgetId)) {
                return false;
            }
            const visibleCount = getVisibleWidgetCount();
            const maxVisible = getMaxVisibleWidgets();
            return visibleCount < maxVisible;
        }

        function startWidgetLibraryPress(event, widgetId) {
            if (!widgetId) {
                return;
            }
            if (!event.isPrimary) {
                return;
            }
            if (event.pointerType === "mouse" && event.button !== 0) {
                return;
            }
            if (widgetDragState && widgetDragState.dragging) {
                return;
            }
            if (widgetLibraryDragState.active || widgetLibraryDragState.holdTimeoutId !== null) {
                return;
            }
            if (shouldIgnoreWidgetDrag(event)) {
                return;
            }

            const startX = event.clientX;
            const startY = event.clientY;
            const holdTimeoutId = canStartWidgetLibraryDrag(widgetId)
                ? window.setTimeout(() => {
                    beginWidgetLibraryDrag(widgetId);
                }, WIDGET_LIBRARY_DRAG_HOLD_MS)
                : null;

            updateWidgetLibraryDragState({
                widgetId,
                widget: null,
                container: null,
                ghost: null,
                pointerId: event.pointerId,
                holdTimeoutId,
                startX,
                startY,
                lastX: startX,
                lastY: startY,
                active: false,
                moved: false,
            });

            attachWidgetLibraryDragListeners();
        }

        function beginWidgetLibraryDrag(widgetId) {
            clearWidgetLibraryHoldTimeout();
            if (!widgetId) {
                return;
            }
            const widget = getWidgetById(widgetId);
            if (!(widget instanceof HTMLElement)) {
                return;
            }
            if (!canStartWidgetLibraryDrag(widgetId)) {
                return;
            }
            clearWidgetDropFeedback();
            const ghost = createWidgetLibraryGhost(widget);
            updateWidgetLibraryDragState({
                widget,
                ghost,
                active: true,
                moved: false,
            });
            updateWidgetLibraryGhostPosition(ghost, widgetLibraryDragState.lastX, widgetLibraryDragState.lastY);
            setWidgetDraggingState(true);
        }

        function handleWidgetLibraryPointerMove(event) {
            if (!widgetLibraryDragState.pointerId || event.pointerId !== widgetLibraryDragState.pointerId) {
                return;
            }

            const nextX = event.clientX;
            const nextY = event.clientY;
            updateWidgetLibraryDragState({ lastX: nextX, lastY: nextY });

            if (!widgetLibraryDragState.active) {
                const dx = nextX - widgetLibraryDragState.startX;
                const dy = nextY - widgetLibraryDragState.startY;
                const distance = Math.hypot(dx, dy);
                if (distance > WIDGET_LIBRARY_DRAG_MOVE_THRESHOLD) {
                    clearWidgetLibraryHoldTimeout();
                    updateWidgetLibraryDragState({ moved: true });
                }
                return;
            }

            event.preventDefault();
            const ghost = widgetLibraryDragState.ghost;
            if (ghost instanceof HTMLElement) {
                updateWidgetLibraryGhostPosition(ghost, nextX, nextY);
            }

            const widget = widgetLibraryDragState.widget;
            if (!(widget instanceof HTMLElement)) {
                return;
            }

            const nextContainer = resolveWidgetDropContainer(nextX, nextY);
            if (nextContainer !== widgetLibraryDragState.container) {
                clearWidgetLibraryDragContainer();
                if (nextContainer instanceof HTMLElement) {
                    nextContainer.classList.add("drag-active");
                    updateWidgetLibraryDragState({ container: nextContainer });
                }
            }
            const activeContainer = widgetLibraryDragState.container;
            if (!(activeContainer instanceof HTMLElement)) {
                return;
            }
            updateWidgetDragOverAtPosition(widget, activeContainer, nextX, nextY);
        }

        function handleWidgetLibraryPointerEnd(event) {
            if (!widgetLibraryDragState.pointerId || event.pointerId !== widgetLibraryDragState.pointerId) {
                return;
            }

            const shouldAddOnClick = !widgetLibraryDragState.active && !widgetLibraryDragState.moved;
            const widgetId = widgetLibraryDragState.widgetId;
            if (widgetLibraryDragState.active) {
                finalizeWidgetLibraryDrop();
            } else {
                clearWidgetLibraryHoldTimeout();
                resetWidgetLibraryDragState();
            }

            if (shouldAddOnClick && widgetId) {
                addWidgetFromLibrary(widgetId);
            }
        }

        function finalizeWidgetLibraryDrop() {
            const widgetId = widgetLibraryDragState.widgetId;
            const widget = widgetLibraryDragState.widget;
            const container = widgetLibraryDragState.container;
            const placeholder = widgetDragState.placeholder;
            if (!widgetId || !(widget instanceof HTMLElement) || !(container instanceof HTMLElement)) {
                cancelWidgetLibraryDrag();
                return;
            }
            const result = addWidgetFromLibraryToDashboardAtPosition(widgetId, container, placeholder);
            if (result.added) {
                showSuccess("Added " + result.label + " to the dashboard.");
            }
            cancelWidgetLibraryDrag();
        }

        function resetWidgetLibraryDragState() {
            detachWidgetLibraryDragListeners();
            updateWidgetLibraryDragState({
                widgetId: null,
                widget: null,
                container: null,
                ghost: null,
                pointerId: null,
                holdTimeoutId: null,
                startX: 0,
                startY: 0,
                lastX: 0,
                lastY: 0,
                active: false,
                moved: false,
            });
        }

        function cancelWidgetLibraryDrag() {
            clearWidgetLibraryHoldTimeout();
            clearWidgetLibraryDragContainer();
            clearWidgetDropFeedback();
            const ghost = widgetLibraryDragState.ghost;
            if (ghost && ghost.parentNode) {
                ghost.parentNode.removeChild(ghost);
            }
            setWidgetDraggingState(false);
            resetWidgetLibraryDragState();
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
            container.classList.remove("drag-active", "drag-hover");
            updateWidgetDragState({
                dragging: null,
                placeholder: null,
                container: null,
                originContainer: null,
                originNextSibling: null,
                dragHandleActive: false,
            });
            setWidgetDraggingState(false);
        }

        function createWidgetGhost(widget) {
            const ghost = widget.cloneNode(true);
            ghost.classList.add("widget-ghost");
            ghost.classList.remove("widget-hidden");
            ghost.removeAttribute("data-widget-id");
            ghost.removeAttribute("data-widget-label");
            ghost.setAttribute("aria-hidden", "true");
            Array.from(ghost.querySelectorAll("[id]")).forEach(node => node.removeAttribute("id"));
            Array.from(ghost.querySelectorAll("[data-widget-id]"))
                .forEach(node => node.removeAttribute("data-widget-id"));
            ghost.style.visibility = "hidden";
            document.body.appendChild(ghost);
            const rect = ghost.getBoundingClientRect();
            const width = rect.width || widget.offsetWidth || 0;
            const height = rect.height || widget.offsetHeight || 0;
            ghost.style.width = width ? \`\${width}px\` : "";
            ghost.style.height = height ? \`\${height}px\` : "";
            ghost.style.transformOrigin = "center";
            ghost.style.visibility = "";
            return ghost;
        }

        function getWidgetSizeClass(widget) {
            if (!(widget instanceof HTMLElement)) {
                return null;
            }
            return WIDGET_SIZE_CLASSES.find(sizeClass => widget.classList.contains(sizeClass)) || null;
        }

        function buildWidgetDropIndicator(widget) {
            const placeholder = document.createElement("div");
            placeholder.className = "widget-drop-indicator widget-card";
            placeholder.setAttribute("aria-hidden", "true");
            placeholder.dataset.dropEdge = "after";
            const sizeClass = getWidgetSizeClass(widget);
            if (sizeClass) {
                placeholder.classList.add(sizeClass);
            }
            const ghost = document.createElement("div");
            ghost.className = "widget-drop-ghost";
            const label = document.createElement("div");
            label.className = "widget-drop-label";
            label.textContent = "Drop " + getWidgetDisplayName(widget);
            ghost.appendChild(label);
            placeholder.appendChild(ghost);
            return placeholder;
        }

        function syncWidgetPlaceholderSize(placeholder, widget, referenceElement) {
            if (!(placeholder instanceof HTMLElement)) {
                return;
            }
            const base = referenceElement instanceof HTMLElement ? referenceElement : widget;
            const rect = base.getBoundingClientRect();
            const height = Math.max(80, Math.round(rect.height || widget.offsetHeight || 0));
            placeholder.style.minHeight = height ? \`\${height}px\` : "";
        }

        function setWidgetDropIndicatorEdge(placeholder, edge) {
            if (!(placeholder instanceof HTMLElement)) {
                return;
            }
            const resolvedEdge = edge === "before" || edge === "after" ? edge : "after";
            placeholder.dataset.dropEdge = resolvedEdge;
        }

        function ensureWidgetPlaceholder(widget, referenceElement) {
            if (widgetDragState.placeholder) {
                widgetDragState.placeholder.classList.add("is-active");
                syncWidgetPlaceholderSize(widgetDragState.placeholder, widget, referenceElement);
                return widgetDragState.placeholder;
            }
            const placeholder = buildWidgetDropIndicator(widget);
            placeholder.classList.add("is-active");
            syncWidgetPlaceholderSize(placeholder, widget, referenceElement);
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
            const placeholder = widgetDragState.placeholder;
            if (placeholder && placeholder.parentNode === container) {
                placeholder.classList.remove("drag-over");
            }
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
            commitWidgetLayoutUpdate(nextLayout, {
                profileSync: true,
                broadcast: true,
            });
            if (options?.broadcast) {
                scheduleWidgetLayoutAutoSave(updates);
            }
            return nextLayout;
        }

        // Event Listeners
        const initializeDashboard = () => {
            startDashboardRestore();
            const layoutRestore = initializeWidgetLayoutFromStorage();
            hydrateWidgetStateFromServer();
            setupWidgetLayoutSyncChannel();
            void hydrateWidgetLayoutFromProfile({ force: true });
            void flushPendingPreferencesSync();
            initTabs();
            initMetricNavigation();
            initMyTasksWidgetActions();
            initWidgetLayoutSaveIndicator();
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
            applyResponsiveDashboardGrid();
            renderWidgetLibrary();
            void hydrateWidgetNotificationPreferences();
            updateEmptyDashboardState();
            finishDashboardRestore({ usedFallback: layoutRestore.status !== "restored" });
            if (typeof window !== "undefined" && window.location.hash === "#widgetLibraryList") {
                openWidgetLibraryFromEmptyState();
            }
            if (typeof window !== "undefined") {
                const scheduleResponsiveGridUpdate = debounce(() => applyResponsiveDashboardGrid(), 150);
                window.addEventListener("storage", handleWidgetStorageUpdate);
                window.addEventListener("resize", scheduleResponsiveGridUpdate);
                window.addEventListener("orientationchange", scheduleResponsiveGridUpdate);
                window.addEventListener("online", () => {
                    attemptWidgetLayoutSaveRetry();
                    void flushWidgetLayoutProfileSync();
                    void flushPendingPreferencesSync();
                });
                window.addEventListener("focus", () => {
                    void hydrateWidgetLayoutFromProfile({ force: false });
                });
            }
            attemptWidgetLayoutSaveRetry();

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
            const openWidgetLibraryBtn = document.getElementById("openWidgetLibraryBtn");
            if (openWidgetLibraryBtn instanceof HTMLButtonElement) {
                openWidgetLibraryBtn.addEventListener("click", openWidgetLibraryFromEmptyState);
            }
            const widgetLibrarySearch = document.getElementById("widgetLibrarySearch");
            if (widgetLibrarySearch instanceof HTMLInputElement) {
                widgetLibrarySearch.addEventListener("input", () => {
                    updateWidgetLibrarySearchQuery(widgetLibrarySearch.value);
                });
            }
            const clearSelectedWidgetsBtn = document.getElementById("clearSelectedWidgetsBtn");
            if (clearSelectedWidgetsBtn instanceof HTMLButtonElement) {
                clearSelectedWidgetsBtn.addEventListener("click", () => {
                    updateSelectedWidgetIds([]);
                    renderWidgetLibrary();
                });
            }
            const showAllWidgetsEmptyBtn = document.getElementById("showAllWidgetsEmptyBtn");
            if (showAllWidgetsEmptyBtn instanceof HTMLButtonElement) {
                showAllWidgetsEmptyBtn.addEventListener("click", showAllWidgets);
            }

            const priorityFilter = document.getElementById("priorityFilter");
            if (priorityFilter instanceof HTMLSelectElement) {
                setPriorityFilterHighlight(priorityFilter.value);
                priorityFilter.addEventListener("change", () => {
                    setPriorityFilterHighlight(priorityFilter.value);
                });
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

            initAutoRefreshControls();
            const storedRefreshRate = readStoredAutoRefreshRate();
            if (storedRefreshRate) {
                autoRefreshRate = storedRefreshRate;
            }
            
            // Initial load
            setMetricsLoadingState(true);
            requestMetricsRefresh();
            loadRecentActivityWidget({ force: true });
            startAutoRefresh();
            connectWebSocket();
            void hydrateAutoRefreshPreferences();
            
            // Close modal when clicking outside
            const taskModal = getTaskModalElement();
            if (taskModal) {
                taskModal.addEventListener("click", (event) => {
                    if (event.target === taskModal) {
                        closeTaskModal();
                    }
                });
                taskModal.addEventListener("keydown", trapTaskModalFocus);
            }
        };

        if (typeof document !== "undefined") {
            if (document.readyState === "loading") {
                document.addEventListener("DOMContentLoaded", initializeDashboard);
            } else {
                initializeDashboard();
            }
        }

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
            const nextVisible = !bulkActionsVisible;
            bulkActionsVisible = nextVisible;
            const panel = document.getElementById("bulkActionsPanel");
            if (panel instanceof HTMLElement) {
                panel.hidden = !nextVisible;
                panel.setAttribute("aria-hidden", nextVisible ? "false" : "true");
            }
            const toggleButton = document.getElementById("toggleBulkActionsBtn");
            if (toggleButton instanceof HTMLElement) {
                toggleButton.setAttribute("aria-expanded", nextVisible ? "true" : "false");
            }
            
            // Add checkboxes to tasks if showing bulk actions
            if (nextVisible) {
                addTaskCheckboxes();
            } else {
                removeTaskCheckboxes();
            }
            
            updateBulkActionsUI();
        }

        function addTaskCheckboxes() {
            const taskItems = document.querySelectorAll(".task-item");
            taskItems.forEach(item => {
                if (!(item instanceof HTMLElement)) {
                    return;
                }
                const taskId = item.dataset.taskId;
                if (!taskId) {
                    return;
                }
                if (!item.querySelector(".task-checkbox")) {
                    const checkbox = document.createElement("input");
                    checkbox.type = "checkbox";
                    checkbox.className = "task-checkbox";
                    checkbox.dataset.taskId = taskId;
                    const titleElement = item.querySelector(".task-title");
                    const taskTitle = titleElement instanceof HTMLElement ? titleElement.textContent?.trim() : "";
                    const label = taskTitle ? "Select task " + taskTitle : "Select task " + taskId;
                    checkbox.setAttribute("aria-label", label);
                    checkbox.setAttribute("title", label);
                    checkbox.addEventListener("change", (event) => {
                        const target = event.target;
                        if (!(target instanceof HTMLInputElement)) {
                            return;
                        }
                        if (target.checked) {
                            selectedTasks.add(taskId);
                            item.classList.add("selected");
                        } else {
                            selectedTasks.delete(taskId);
                            item.classList.remove("selected");
                        }
                        updateBulkActionsUI();
                    });
                    
                    // Insert checkbox at the beginning of task-header
                    const header = item.querySelector(".task-header");
                    if (header instanceof HTMLElement) {
                        header.insertBefore(checkbox, header.firstChild);
                    }
                }
            });
        }

        function removeTaskCheckboxes() {
            const checkboxes = document.querySelectorAll(".task-checkbox");
            checkboxes.forEach(checkbox => checkbox.remove());
            
            const taskItems = document.querySelectorAll(".task-item");
            taskItems.forEach(item => {
                if (item instanceof HTMLElement) {
                    item.classList.remove("selected");
                }
            });
            
            selectedTasks.clear();
        }

        function selectAllTasks() {
            const checkboxes = document.querySelectorAll(".task-checkbox");
            checkboxes.forEach(checkbox => {
                if (!(checkbox instanceof HTMLInputElement)) {
                    return;
                }
                checkbox.checked = true;
                const taskId = checkbox.dataset.taskId;
                if (taskId) {
                    selectedTasks.add(taskId);
                }
                const taskItem = checkbox.closest(".task-item");
                if (taskItem instanceof HTMLElement) {
                    taskItem.classList.add("selected");
                }
            });
            updateBulkActionsUI();
        }

        function clearSelection() {
            const checkboxes = document.querySelectorAll(".task-checkbox");
            checkboxes.forEach(checkbox => {
                if (!(checkbox instanceof HTMLInputElement)) {
                    return;
                }
                checkbox.checked = false;
                const taskItem = checkbox.closest(".task-item");
                if (taskItem instanceof HTMLElement) {
                    taskItem.classList.remove("selected");
                }
            });
            selectedTasks.clear();
            updateBulkActionsUI();
        }

        function updateBulkActionsUI() {
            const selectedCount = document.getElementById("selectedCount");
            if (selectedCount instanceof HTMLElement) {
                selectedCount.textContent = String(selectedTasks.size);
            }
            
            // Enable/disable bulk action buttons based on selection
            const buttons = document.querySelectorAll(".bulk-actions-buttons button");
            buttons.forEach(button => {
                if (!(button instanceof HTMLButtonElement)) {
                    return;
                }
                const label = button.textContent || "";
                if (label.includes("Select All") || label.includes("Clear Selection")) {
                    return; // Always enable these
                }
                const isDisabled = selectedTasks.size === 0;
                button.disabled = isDisabled;
                button.setAttribute("aria-disabled", isDisabled ? "true" : "false");
            });
            const bulkPrioritySelect = document.getElementById("bulkPrioritySelect");
            if (bulkPrioritySelect instanceof HTMLSelectElement) {
                const isDisabled = selectedTasks.size === 0;
                bulkPrioritySelect.disabled = isDisabled;
                bulkPrioritySelect.setAttribute("aria-disabled", isDisabled ? "true" : "false");
            }
        }

        async function bulkSetPriority() {
            if (selectedTasks.size === 0) {
                return;
            }
            
            const bulkPrioritySelect = document.getElementById("bulkPrioritySelect");
            if (!(bulkPrioritySelect instanceof HTMLSelectElement)) {
                return;
            }
            const priority = bulkPrioritySelect.value;
            if (!priority) {
                showError("Please select a priority level");
                return;
            }
            
            if (!confirm("Set priority to " + priority + " for " + selectedTasks.size + " selected tasks?")) {
                return;
            }
            
            await performBulkAction("set_priority", { priority });
        }

        async function bulkResume() {
            if (selectedTasks.size === 0) {
                return;
            }
            
            if (!confirm("Resume " + selectedTasks.size + " selected tasks?")) {
                return;
            }
            
            await performBulkAction("resume");
        }

        async function bulkCancel() {
            if (selectedTasks.size === 0) {
                return;
            }
            
            if (!confirm("Cancel " + selectedTasks.size + " selected tasks?")) {
                return;
            }
            
            await performBulkAction("cancel");
        }

        async function bulkDelete() {
            if (selectedTasks.size === 0) {
                return;
            }
            
            if (!confirm("PERMANENTLY delete " + selectedTasks.size + " selected tasks? This action cannot be undone.")) {
                return;
            }
            
            await performBulkAction("delete");
        }

        async function performBulkAction(action, data) {
            try {
                showInfo("Performing " + action + " on " + selectedTasks.size + " tasks...");
                
                const taskIds = Array.from(selectedTasks);
                const response = await fetch("/api/tasks/bulk-action", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        action,
                        taskIds,
                        data
                    })
                });
                
                const result = await response.json();
                
                if (result.successful > 0) {
                    showSuccess(action + " completed successfully for " + result.successful + " tasks");
                }
                
                if (result.failed > 0) {
                    showError(action + " failed for " + result.failed + " tasks");
                }
                
                // Clear selection and refresh
                clearSelection();
                await loadTasks();
                await requestMetricsRefresh();
                
            } catch (error) {
                const message = error instanceof Error ? error.message : "Unknown error";
                showError("Failed to perform bulk action: " + message);
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
                    await requestMetricsRefresh();
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
                    await requestMetricsRefresh();
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
        document.addEventListener("keydown", (event) => {
            // Escape to close modal
            if (event.key === "Escape") {
                if (widgetLibraryDragState && (widgetLibraryDragState.active || widgetLibraryDragState.holdTimeoutId !== null)) {
                    event.preventDefault();
                    cancelWidgetLibraryDrag();
                    return;
                }
                if (widgetDragState && widgetDragState.dragging) {
                    event.preventDefault();
                    cancelWidgetDrag();
                    return;
                }
                closeTaskModal();
                return;
            }

            const normalizedKey = event.key.toLowerCase();
            if ((event.ctrlKey || event.metaKey) && normalizedKey === "k") {
                event.preventDefault();
                focusWidgetLibrarySearch();
                return;
            }

            if (isEditableTarget(event.target)) {
                return;
            }

            if (event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
                if (normalizedKey === "r") {
                    event.preventDefault();
                    refreshActiveTab();
                    return;
                }
                const index = Number.parseInt(event.key, 10);
                if (Number.isFinite(index)) {
                    const tabName = DASHBOARD_TAB_SEQUENCE[index - 1];
                    if (tabName) {
                        event.preventDefault();
                        activateTab(tabName, { focus: true });
                    }
                }
            }
        });
    </script>
    <script src="/audit-history.js"></script>
</body>
</html>`;
	}
}
