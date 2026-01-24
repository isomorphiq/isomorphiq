import { EventEmitter } from "node:events";
import type {
	DomainEvent,
	EventBusConfig,
	EventHandler,
	EventMetadata,
	EventMiddleware,
	EventStore,
} from "./events.ts";

export class EventBus extends EventEmitter {
	private middleware: EventMiddleware[] = [];
	private eventStore?: EventStore;
	private config: Required<EventBusConfig>;
	private metrics: {
		eventsEmitted: number;
		eventsProcessed: number;
		errors: number;
		processingTimes: number[];
	};

	constructor(config: EventBusConfig = {}) {
		super();
		this.config = {
			maxListeners: config.maxListeners || 1000,
			enablePersistence: config.enablePersistence || false,
			enableMetrics: config.enableMetrics || false,
			middlewareTimeout: config.middlewareTimeout || 5000,
		};

		this.metrics = {
			eventsEmitted: 0,
			eventsProcessed: 0,
			errors: 0,
			processingTimes: [],
		};

		this.setMaxListeners(this.config.maxListeners);
	}

	// Set event store for persistence
	setEventStore(eventStore: EventStore): void {
		this.eventStore = eventStore;
	}

	// Add middleware to the event processing pipeline
	use(middleware: EventMiddleware): void {
		this.middleware.push(middleware);
	}

	// Publish an event to the bus
	async publish<T extends DomainEvent>(event: T): Promise<void> {
		try {
			// Add metadata if not present
			if (!event.metadata) {
				event.metadata = this.createMetadata();
			}

			// Update metrics
			if (this.config.enableMetrics) {
				this.metrics.eventsEmitted++;
			}

			const startTime = Date.now();

			// Process middleware chain
			await this.processMiddleware(event);

			// Persist event if store is configured
			if (this.config.enablePersistence && this.eventStore) {
				await this.eventStore.append(event);
			}

			// Emit to listeners
			this.emit(event.type, event);
			this.emit("*", event); // Wildcard listener for all events

			// Update metrics
			if (this.config.enableMetrics) {
				const processingTime = Date.now() - startTime;
				this.metrics.eventsProcessed++;
				this.metrics.processingTimes.push(processingTime);

				// Keep only last 1000 processing times
				if (this.metrics.processingTimes.length > 1000) {
					this.metrics.processingTimes = this.metrics.processingTimes.slice(-1000);
				}
			}
		} catch (error) {
			if (this.config.enableMetrics) {
				this.metrics.errors++;
			}
			console.error(`[EventBus] Error publishing event ${event.type}:`, error);
			throw error;
		}
	}

	// Subscribe to specific event types
	on<T extends DomainEvent>(eventType: T["type"], handler: EventHandler<T>): this {
		return super.on(eventType, handler as EventHandler);
	}

	// Subscribe to all events
	onAll(handler: EventHandler): this {
		return super.on("*", handler);
	}

	// Remove event listener
	off<T extends DomainEvent>(eventType: T["type"], handler: EventHandler<T>): this {
		return super.off(eventType, handler as EventHandler);
	}

	// Remove all event listeners
	removeAllListeners(eventType?: string | symbol): this {
		return super.removeAllListeners(eventType);
	}

	// Process middleware chain
	private async processMiddleware(event: DomainEvent): Promise<void> {
		let index = 0;

		const next = (): Promise<void> => {
			if (index >= this.middleware.length) {
				return Promise.resolve();
			}

			const middleware = this.middleware[index++];
			if (!middleware) {
				return Promise.resolve();
			}

			const result = middleware(event, next);

			// Handle both sync and async middleware
			return Promise.resolve(result);
		};

		// Execute middleware with timeout
		const timeoutPromise = new Promise<void>((_, reject) => {
			setTimeout(() => {
				reject(new Error(`Middleware timeout for event ${event.type}`));
			}, this.config.middlewareTimeout);
		});

		return Promise.race([next(), timeoutPromise]);
	}

	// Create event metadata
	private createMetadata(): EventMetadata {
		return {
			source: "task-manager",
			version: "1.0.0",
			correlationId: this.generateCorrelationId(),
		};
	}

	// Generate correlation ID
	private generateCorrelationId(): string {
		return `corr-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
	}

	// Get event bus metrics
	getMetrics(): {
		eventsEmitted: number;
		eventsProcessed: number;
		errors: number;
		averageProcessingTime: number;
		middlewareCount: number;
		listenerCount: number;
	} {
		const averageProcessingTime =
			this.metrics.processingTimes.length > 0
				? this.metrics.processingTimes.reduce((a, b) => a + b, 0) /
					this.metrics.processingTimes.length
				: 0;

		return {
			...this.metrics,
			averageProcessingTime: Math.round(averageProcessingTime * 100) / 100,
			middlewareCount: this.middleware.length,
			listenerCount: this.listenerCount("*") + this.eventNames().length,
		};
	}

	// Reset metrics
	resetMetrics(): void {
		this.metrics = {
			eventsEmitted: 0,
			eventsProcessed: 0,
			errors: 0,
			processingTimes: [],
		};
	}

	// Get event statistics
	getEventStats(): {
		totalEvents: number;
		eventsByType: Record<string, number>;
		activeListeners: number;
	} {
		const eventNames = this.eventNames();
		const eventsByType: Record<string, number> = {};

		for (const eventType of eventNames) {
			if (typeof eventType === "string") {
				eventsByType[eventType] = this.listenerCount(eventType);
			}
		}

		return {
			totalEvents: this.metrics.eventsEmitted,
			eventsByType,
			activeListeners: this.listenerCount("*"),
		};
	}
}

// Global event bus instance
export const globalEventBus = new EventBus({
	enableMetrics: true,
	enablePersistence: false, // Will be enabled when event store is set
	maxListeners: 1000,
});

// Event factory functions
export const EventFactory = {
	createTaskCreated: (task: Record<string, unknown>, createdBy: string): TaskCreatedEvent => ({
		id: `task_created_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
		type: "task_created",
		timestamp: new Date(),
		data: { task, createdBy },
	}),

	createTaskUpdated: (task: Record<string, unknown>, changes: Record<string, unknown>, updatedBy: string): TaskUpdatedEvent => ({
		id: `task_updated_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
		type: "task_updated",
		timestamp: new Date(),
		data: { task, changes, updatedBy },
	}),

	createTaskDeleted: (taskId: string, deletedBy: string): TaskDeletedEvent => ({
		id: `task_deleted_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
		type: "task_deleted",
		timestamp: new Date(),
		data: { taskId, deletedBy },
	}),

	createTaskStatusChanged: (
		taskId: string,
		oldStatus: string,
		newStatus: string,
		task: Record<string, unknown>,
		updatedBy: string,
	): TaskStatusChangedEvent => ({
		id: `task_status_changed_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
		type: "task_status_changed",
		timestamp: new Date(),
		data: { taskId, oldStatus, newStatus, task, updatedBy },
	}),

	createTaskPriorityChanged: (
		taskId: string,
		oldPriority: string,
		newPriority: string,
		task: Record<string, unknown>,
		updatedBy: string,
	): TaskPriorityChangedEvent => ({
		id: `task_priority_changed_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
		type: "task_priority_changed",
		timestamp: new Date(),
		data: { taskId, oldPriority, newPriority, task, updatedBy },
	}),

	createTaskAssigned: (
		task: Record<string, unknown>,
		assignedTo: string,
		assignedBy: string,
	): TaskAssignedEvent => ({
		id: `task_assigned_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
		type: "task_assigned",
		timestamp: new Date(),
		data: { task, assignedTo, assignedBy },
	}),

	createTaskCollaboratorsUpdated: (
		task: Record<string, unknown>,
		collaborators: string[],
		updatedBy: string,
	): TaskCollaboratorsUpdatedEvent => ({
		id: `task_collaborators_updated_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
		type: "task_collaborators_updated",
		timestamp: new Date(),
		data: { task, collaborators, updatedBy },
	}),

	createTaskWatchersUpdated: (
		task: Record<string, unknown>,
		watchers: string[],
		updatedBy: string,
	): TaskWatchersUpdatedEvent => ({
		id: `task_watchers_updated_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
		type: "task_watchers_updated",
		timestamp: new Date(),
		data: { task, watchers, updatedBy },
	}),

	createTaskDependencyAdded: (
		taskId: string,
		dependsOn: string,
		updatedBy: string,
	): TaskDependencyAddedEvent => ({
		id: `task_dependency_added_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
		type: "task_dependency_added",
		timestamp: new Date(),
		data: { taskId, dependsOn, updatedBy },
	}),

	createTaskDependencyRemoved: (
		taskId: string,
		dependencyRemoved: string,
		updatedBy: string,
	): TaskDependencyRemovedEvent => ({
		id: `task_dependency_removed_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
		type: "task_dependency_removed",
		timestamp: new Date(),
		data: { taskId, dependencyRemoved, updatedBy },
	}),
};

// Import the event types for the factory
import type {
	TaskAssignedEvent,
	TaskCollaboratorsUpdatedEvent,
	TaskCreatedEvent,
	TaskDeletedEvent,
	TaskDependencyAddedEvent,
	TaskDependencyRemovedEvent,
	TaskPriorityChangedEvent,
	TaskStatusChangedEvent,
	TaskUpdatedEvent,
	TaskWatchersUpdatedEvent,
} from "./events.ts";
