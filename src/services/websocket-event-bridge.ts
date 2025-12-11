import type { EventBus } from "../core/event-bus.ts";
import type { DomainEvent } from "../core/events.ts";
import type { Task, TaskPriority, TaskStatus, WebSocketEvent } from "../types.ts";
import {
	type EnhancedWebSocketConfig,
	EnhancedWebSocketManager,
} from "./enhanced-websocket-server.ts";

type TaskEventData = {
	task?: Task;
	taskId?: string;
	changes?: Partial<Task>;
	updatedBy?: string;
	oldStatus?: TaskStatus;
	newStatus?: TaskStatus;
	oldPriority?: TaskPriority;
	newPriority?: TaskPriority;
	assignedTo?: string;
	assignedBy?: string;
	collaborators?: string[];
	watchers?: string[];
	dependsOn?: string;
	dependencyRemoved?: string;
};

const getTaskEventData = (event: DomainEvent): TaskEventData => (event.data ?? {}) as TaskEventData;

// WebSocket event bridge that converts domain events to WebSocket events
export class WebSocketEventBridge {
	private wsManager: EnhancedWebSocketManager;
	private eventMappings: Map<string, (event: DomainEvent) => WebSocketEvent> = new Map();

	constructor(wsManager: EnhancedWebSocketManager) {
		this.wsManager = wsManager;
		this.setupEventMappings();
	}

	// Setup mappings from domain events to WebSocket events
	private setupEventMappings(): void {
		// Task events
		this.eventMappings.set("task_created", (event: DomainEvent) => {
			const data = getTaskEventData(event);
			return {
				type: "task_created",
				timestamp: event.timestamp,
				data: data.task as Task,
			};
		});

		this.eventMappings.set("task_updated", (event: DomainEvent) => {
			const data = getTaskEventData(event);
			return {
				type: "task_updated",
				timestamp: event.timestamp,
				data: {
					task: data.task as Task,
					changes: data.changes ?? {},
					updatedBy: data.updatedBy,
				},
			};
		});

		this.eventMappings.set("task_deleted", (event: DomainEvent) => {
			const data = getTaskEventData(event);
			return {
				type: "task_deleted",
				timestamp: event.timestamp,
				data: { taskId: data.taskId ?? "" },
			};
		});

		this.eventMappings.set("task_status_changed", (event: DomainEvent) => {
			const data = getTaskEventData(event);
			return {
				type: "task_status_changed",
				timestamp: event.timestamp,
				data: {
					taskId: data.taskId ?? "",
					oldStatus: data.oldStatus as TaskStatus,
					newStatus: data.newStatus as TaskStatus,
					task: data.task as Task,
				},
			};
		});

		this.eventMappings.set("task_priority_changed", (event: DomainEvent) => {
			const data = getTaskEventData(event);
			return {
				type: "task_priority_changed",
				timestamp: event.timestamp,
				data: {
					taskId: data.taskId ?? "",
					oldPriority: data.oldPriority ?? "medium",
					newPriority: data.newPriority ?? "medium",
					task: data.task as Task,
				},
			};
		});

		this.eventMappings.set("task_assigned", (event: DomainEvent) => {
			const data = getTaskEventData(event);
			return {
				type: "task_assigned",
				timestamp: event.timestamp,
				data: {
					task: data.task as Task,
					assignedTo: data.assignedTo ?? "",
					assignedBy: data.assignedBy ?? "",
				},
			};
		});

		this.eventMappings.set("task_collaborators_updated", (event: DomainEvent) => {
			const data = getTaskEventData(event);
			return {
				type: "task_collaborators_updated",
				timestamp: event.timestamp,
				data: {
					task: data.task as Task,
					collaborators: data.collaborators ?? [],
					updatedBy: data.updatedBy ?? "",
				},
			};
		});

		this.eventMappings.set("task_watchers_updated", (event: DomainEvent) => {
			const data = getTaskEventData(event);
			return {
				type: "task_watchers_updated",
				timestamp: event.timestamp,
				data: {
					task: data.task as Task,
					watchers: data.watchers ?? [],
					updatedBy: data.updatedBy ?? "",
				},
			};
		});

		this.eventMappings.set("task_dependency_added", (event: DomainEvent) => {
			const data = getTaskEventData(event);
			const dependsOn = data.dependsOn ?? "";
			return {
				type: "task_updated", // Map to generic task_updated for WebSocket clients
				timestamp: event.timestamp,
				data: {
					task: { id: data.taskId ?? "", dependencies: [dependsOn] },
					changes: { dependenciesAdded: [dependsOn] },
					updatedBy: data.updatedBy ?? "",
				},
			};
		});

		this.eventMappings.set("task_dependency_removed", (event: DomainEvent) => {
			const data = getTaskEventData(event);
			const dependencyRemoved = data.dependencyRemoved ?? "";
			return {
				type: "task_updated", // Map to generic task_updated for WebSocket clients
				timestamp: event.timestamp,
				data: {
					task: { id: data.taskId ?? "", dependencies: [] },
					changes: { dependenciesRemoved: [dependencyRemoved] },
					updatedBy: data.updatedBy ?? "",
				},
			};
		});
	}

	// Handle domain event and convert to WebSocket event
	handleDomainEvent(event: DomainEvent): void {
		const mapping = this.eventMappings.get(event.type);
		if (!mapping) {
			console.log(`[WebSocketBridge] No mapping for event type: ${event.type}`);
			return;
		}

		try {
			const wsEvent = mapping(event);
			this.wsManager.broadcast(wsEvent);
		} catch (error) {
			console.error(`[WebSocketBridge] Error converting event ${event.type}:`, error);
		}
	}

	// Add custom event mapping
	addEventMapping(eventType: string, mapper: (event: DomainEvent) => WebSocketEvent): void {
		this.eventMappings.set(eventType, mapper);
	}

	// Remove event mapping
	removeEventMapping(eventType: string): void {
		this.eventMappings.delete(eventType);
	}

	// Get current mappings
	getMappings(): Array<{ eventType: string; hasMapping: boolean }> {
		const commonEventTypes = [
			"task_created",
			"task_updated",
			"task_deleted",
			"task_status_changed",
			"task_priority_changed",
			"task_assigned",
			"task_collaborators_updated",
			"task_watchers_updated",
			"task_dependency_added",
			"task_dependency_removed",
			"user_created",
			"user_updated",
			"user_deleted",
			"user_logged_in",
			"user_logged_out",
			"system_started",
			"system_shutdown",
			"error_occurred",
			"performance_warning",
		];

		return commonEventTypes.map((eventType) => ({
			eventType,
			hasMapping: this.eventMappings.has(eventType),
		}));
	}
}

// Enhanced WebSocket manager with event integration
export class EventIntegratedWebSocketManager extends EnhancedWebSocketManager {
	private eventBridge: WebSocketEventBridge;
	private eventSubscriptions: string[] = [];

	constructor(config?: EnhancedWebSocketConfig) {
		super(config);
		this.eventBridge = new WebSocketEventBridge(this);
	}

	// Subscribe to event bus events
	subscribeToEventBus(eventBus: EventBus): void {
		// Subscribe to all task events
		const taskEventTypes = [
			"task_created",
			"task_updated",
			"task_deleted",
			"task_status_changed",
			"task_priority_changed",
			"task_assigned",
			"task_collaborators_updated",
			"task_watchers_updated",
			"task_dependency_added",
			"task_dependency_removed",
		];

		for (const eventType of taskEventTypes) {
			eventBus.on(eventType, (event: DomainEvent) => {
				this.eventBridge.handleDomainEvent(event);
			});
			this.eventSubscriptions.push(eventType);
		}

		// Subscribe to system events for monitoring
		eventBus.on("system_started", (_event: DomainEvent) => {
			console.log("[WS] System started event received");
		});

		eventBus.on("error_occurred", (event: DomainEvent) => {
			console.error("[WS] Error event received:", event.data);
		});

		console.log(`[WS] Subscribed to ${this.eventSubscriptions.length} event types`);
	}

	// Unsubscribe from event bus events
	unsubscribeFromEventBus(eventBus: EventBus): void {
		for (const eventType of this.eventSubscriptions) {
			eventBus.off(eventType, this.eventBridge.handleDomainEvent);
		}
		this.eventSubscriptions = [];
		console.log("[WS] Unsubscribed from all event types");
	}

	// Get event bridge for custom mappings
	getEventBridge(): WebSocketEventBridge {
		return this.eventBridge;
	}

	// Get enhanced status including event information
	getEnhancedStatus(): ReturnType<EnhancedWebSocketManager["getStatus"]> & {
		eventIntegration: {
			subscribedEvents: number;
			eventMappings: number;
			totalMappings: number;
		};
	} {
		const baseStatus = this.getStatus();
		const mappings = this.eventBridge.getMappings();

		return {
			...baseStatus,
			eventIntegration: {
				subscribedEvents: this.eventSubscriptions.length,
				eventMappings: mappings.filter((m) => m.hasMapping).length,
				totalMappings: mappings.length,
			},
		};
	}
}

// Factory function to create event-integrated WebSocket manager
export function createEventIntegratedWebSocketManager(
	config?: EnhancedWebSocketConfig,
): EventIntegratedWebSocketManager {
	return new EventIntegratedWebSocketManager(config);
}
