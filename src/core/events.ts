// Base event interface
export interface BaseEvent {
	id: string;
	type: string;
	timestamp: Date;
	data: Record<string, unknown>;
	metadata?: EventMetadata;
}

export interface EventMetadata {
	userId?: string;
	sessionId?: string;
	source: string;
	version: string;
	correlationId?: string;
}

// Task-specific events
export interface TaskEvent extends BaseEvent {
	type:
		| "task_created"
		| "task_updated"
		| "task_deleted"
		| "task_assigned"
		| "task_status_changed"
		| "task_priority_changed"
		| "task_collaborators_updated"
		| "task_watchers_updated"
		| "task_dependency_added"
		| "task_dependency_removed"
		| "task_approval_started"
		| "task_approval_processed"
		| "task_approval_cancelled"
		| "task_approval_escalated"
		| "task_approval_delegated";
	data: Record<string, unknown>;
}

export interface TaskCreatedEvent extends TaskEvent {
	type: "task_created";
	data: {
		task: Record<string, unknown>;
		createdBy: string;
	};
}

export interface TaskUpdatedEvent extends TaskEvent {
	type: "task_updated";
	data: {
		task: Record<string, unknown>;
		changes: Record<string, unknown>;
		updatedBy: string;
	};
}

export interface TaskDeletedEvent extends TaskEvent {
	type: "task_deleted";
	data: {
		taskId: string;
		deletedBy: string;
	};
}

export interface TaskStatusChangedEvent extends TaskEvent {
	type: "task_status_changed";
	data: {
		taskId: string;
		oldStatus: string;
		newStatus: string;
		task: Record<string, unknown>;
		updatedBy: string;
	};
}

export interface TaskPriorityChangedEvent extends TaskEvent {
	type: "task_priority_changed";
	data: {
		taskId: string;
		oldPriority: string;
		newPriority: string;
		task: Record<string, unknown>;
		updatedBy: string;
	};
}

export interface TaskAssignedEvent extends TaskEvent {
	type: "task_assigned";
	data: {
		task: Record<string, unknown>;
		assignedTo: string;
		assignedBy: string;
	};
}

export interface TaskCollaboratorsUpdatedEvent extends TaskEvent {
	type: "task_collaborators_updated";
	data: {
		task: Record<string, unknown>;
		collaborators: string[];
		updatedBy: string;
	};
}

export interface TaskWatchersUpdatedEvent extends TaskEvent {
	type: "task_watchers_updated";
	data: {
		task: Record<string, unknown>;
		watchers: string[];
		updatedBy: string;
	};
}

export interface TaskDependencyAddedEvent extends TaskEvent {
	type: "task_dependency_added";
	data: {
		taskId: string;
		dependsOn: string;
		updatedBy: string;
	};
}

export interface TaskDependencyRemovedEvent extends TaskEvent {
	type: "task_dependency_removed";
	data: {
		taskId: string;
		dependencyRemoved: string;
		updatedBy: string;
	};
}

// User events
export interface UserEvent extends BaseEvent {
	type: "user_created" | "user_updated" | "user_deleted" | "user_logged_in" | "user_logged_out";
	data: Record<string, unknown>;
}

// System events
export interface SystemEvent extends BaseEvent {
	type:
		| "system_started"
		| "system_shutdown"
		| "error_occurred"
		| "performance_warning"
		| "approval_workflow_created"
		| "approval_workflow_updated"
		| "approval_workflow_deleted";
	data: Record<string, unknown>;
}

// Union type for all events
export type DomainEvent = TaskEvent | UserEvent | SystemEvent;

// Event handler interface
export type EventHandler<T extends DomainEvent = DomainEvent> = (_event: T) => Promise<void> | void;

// Event middleware interface
export type EventMiddleware = (_event: DomainEvent, _next: () => void) => void;

// Event store interface for persistence
export interface EventStore {
	append(event: DomainEvent): Promise<void>;
	getEvents(aggregateId?: string, fromVersion?: number): Promise<DomainEvent[]>;
	getEventsByType(eventType: string, limit?: number): Promise<DomainEvent[]>;
}

// Event bus configuration
export interface EventBusConfig {
	maxListeners?: number;
	enablePersistence?: boolean;
	enableMetrics?: boolean;
	middlewareTimeout?: number;
}
