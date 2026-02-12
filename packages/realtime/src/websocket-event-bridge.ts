/* eslint-disable no-unused-vars */
import { z } from "zod";
import type { DomainEvent, EventBus } from "@isomorphiq/core";
import {
	TaskPrioritySchema,
	TaskSchema,
	TaskStatusSchema,
	TaskStruct,
	type Task,
	type TaskPriority,
	type TaskStatus,
} from "@isomorphiq/tasks";
import type { WebSocketEvent } from "./types.ts";
import {
	type EnhancedWebSocketConfig,
	EnhancedWebSocketManager,
} from "./enhanced-websocket-server.ts";

const taskEventDataSchema = z
	.object({
		task: TaskSchema.optional(),
		taskId: z.string().optional(),
		changes: z.record(z.unknown()).optional(),
		updatedBy: z.string().optional(),
		createdBy: z.string().optional(),
		deletedBy: z.string().optional(),
		oldStatus: TaskStatusSchema.optional(),
		newStatus: TaskStatusSchema.optional(),
		oldPriority: TaskPrioritySchema.optional(),
		newPriority: TaskPrioritySchema.optional(),
		assignedTo: z.string().optional(),
		assignedBy: z.string().optional(),
		collaborators: z.array(z.string()).optional(),
		watchers: z.array(z.string()).optional(),
		dependsOn: z.string().optional(),
		dependencyRemoved: z.string().optional(),
	})
	.passthrough();

type TaskEventData = z.output<typeof taskEventDataSchema>;

const getTaskEventData = (event: DomainEvent): TaskEventData => {
	const parsed = taskEventDataSchema.safeParse(event.data);
	if (!parsed.success) {
		return {};
	}

	const task = parsed.data.task ? TaskStruct.from(parsed.data.task) : undefined;
	return { ...parsed.data, task };
};

const parseTaskStatus = (value: unknown, fallback: TaskStatus): TaskStatus => {
	const parsed = TaskStatusSchema.safeParse(value);
	return parsed.success ? parsed.data : fallback;
};

const parseTaskPriority = (value: unknown, fallback: TaskPriority): TaskPriority => {
	const parsed = TaskPrioritySchema.safeParse(value);
	return parsed.success ? parsed.data : fallback;
};

const buildFallbackTask = (taskId: string, dependencies: string[] = []): Task =>
	TaskStruct.from({
		id: taskId,
		title: "",
		description: "",
		status: "todo",
		priority: "medium",
		type: "task",
		dependencies,
		createdBy: "system",
		createdAt: new Date(),
		updatedAt: new Date(),
	});

// WebSocket event bridge that converts domain events to WebSocket events
/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
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
			const taskId = data.task?.id ?? data.taskId ?? "unknown";
			const task = data.task ?? buildFallbackTask(taskId);
			const createdBy = data.createdBy ?? "system";
			return {
				type: "task_created",
				timestamp: event.timestamp,
				data: { task, createdBy },
			};
		});

		this.eventMappings.set("task_updated", (event: DomainEvent) => {
			const data = getTaskEventData(event);
			const taskId = data.task?.id ?? data.taskId ?? "unknown";
			const task = data.task ?? buildFallbackTask(taskId);
			return {
				type: "task_updated",
				timestamp: event.timestamp,
				data: {
					task,
					changes: data.changes ?? {},
					updatedBy: data.updatedBy ?? "system",
				},
			};
		});

		this.eventMappings.set("task_deleted", (event: DomainEvent) => {
			const data = getTaskEventData(event);
			const taskId = data.taskId ?? data.task?.id ?? "unknown";
			return {
				type: "task_deleted",
				timestamp: event.timestamp,
				data: {
					taskId,
					deletedBy: data.deletedBy ?? "system",
				},
			};
		});

		this.eventMappings.set("task_status_changed", (event: DomainEvent) => {
			const data = getTaskEventData(event);
			const taskId = data.taskId ?? data.task?.id ?? "unknown";
			const task = data.task ?? buildFallbackTask(taskId);
			return {
				type: "task_status_changed",
				timestamp: event.timestamp,
				data: {
					taskId,
					oldStatus: parseTaskStatus(data.oldStatus, task.status),
					newStatus: parseTaskStatus(data.newStatus, task.status),
					task,
					updatedBy: data.updatedBy ?? "system",
				},
			};
		});

		this.eventMappings.set("task_priority_changed", (event: DomainEvent) => {
			const data = getTaskEventData(event);
			const taskId = data.taskId ?? data.task?.id ?? "unknown";
			const task = data.task ?? buildFallbackTask(taskId);
			return {
				type: "task_priority_changed",
				timestamp: event.timestamp,
				data: {
					taskId,
					oldPriority: parseTaskPriority(data.oldPriority, task.priority),
					newPriority: parseTaskPriority(data.newPriority, task.priority),
					task,
					updatedBy: data.updatedBy ?? "system",
				},
			};
		});

		this.eventMappings.set("task_assigned", (event: DomainEvent) => {
			const data = getTaskEventData(event);
			const taskId = data.task?.id ?? data.taskId ?? "unknown";
			const task = data.task ?? buildFallbackTask(taskId);
			return {
				type: "task_assigned",
				timestamp: event.timestamp,
				data: {
					task,
					assignedTo: data.assignedTo ?? "unknown",
					assignedBy: data.assignedBy ?? "system",
				},
			};
		});

		this.eventMappings.set("task_collaborators_updated", (event: DomainEvent) => {
			const data = getTaskEventData(event);
			const taskId = data.task?.id ?? data.taskId ?? "unknown";
			const task = data.task ?? buildFallbackTask(taskId);
			return {
				type: "task_collaborators_updated",
				timestamp: event.timestamp,
				data: {
					task,
					collaborators: data.collaborators ?? [],
					updatedBy: data.updatedBy ?? "",
				},
			};
		});

		this.eventMappings.set("task_watchers_updated", (event: DomainEvent) => {
			const data = getTaskEventData(event);
			const taskId = data.task?.id ?? data.taskId ?? "unknown";
			const task = data.task ?? buildFallbackTask(taskId);
			return {
				type: "task_watchers_updated",
				timestamp: event.timestamp,
				data: {
					task,
					watchers: data.watchers ?? [],
					updatedBy: data.updatedBy ?? "",
				},
			};
		});

		this.eventMappings.set("task_dependency_added", (event: DomainEvent) => {
			const data = getTaskEventData(event);
			const dependsOn = data.dependsOn ?? "";
			const taskId = data.taskId ?? data.task?.id ?? "unknown";
			const task = data.task ?? buildFallbackTask(taskId, dependsOn ? [dependsOn] : []);
			return {
				type: "task_updated", // Map to generic task_updated for WebSocket clients
				timestamp: event.timestamp,
				data: {
					task,
					changes: { dependenciesAdded: [dependsOn] },
					updatedBy: data.updatedBy ?? "",
				},
			};
		});

		this.eventMappings.set("task_dependency_removed", (event: DomainEvent) => {
			const data = getTaskEventData(event);
			const dependencyRemoved = data.dependencyRemoved ?? "";
			const taskId = data.taskId ?? data.task?.id ?? "unknown";
			const task = data.task ?? buildFallbackTask(taskId);
			return {
				type: "task_updated", // Map to generic task_updated for WebSocket clients
				timestamp: event.timestamp,
				data: {
					task,
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
/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class EventIntegratedWebSocketManager extends EnhancedWebSocketManager {
	private eventBridge: WebSocketEventBridge;
	private eventSubscriptions: Array<{
		type: DomainEvent["type"];
		handler: (event: DomainEvent) => void;
	}> = [];

	constructor(config?: EnhancedWebSocketConfig) {
		super(config);
		this.eventBridge = new WebSocketEventBridge(this);
	}

	// Subscribe to event bus events
	subscribeToEventBus(eventBus: EventBus): void {
		// Subscribe to all task events
		const taskEventTypes: DomainEvent["type"][] = [
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
			const handler = (event: DomainEvent) => {
				this.eventBridge.handleDomainEvent(event);
			};
			eventBus.on(eventType, handler);
			this.eventSubscriptions.push({ type: eventType, handler });
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
		for (const subscription of this.eventSubscriptions) {
			eventBus.off(subscription.type, subscription.handler);
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

