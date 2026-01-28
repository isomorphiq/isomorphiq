import { Level } from "level";
import type { Task } from "@isomorphiq/tasks";

export interface TaskAuditEvent {
	id: string;
	taskId: string;
	eventType: "created" | "status_changed" | "priority_changed" | "updated" | "deleted" | "assigned" | "dependency_added" | "dependency_removed";
	timestamp: Date;
	oldStatus?: string;
	newStatus?: string;
	oldPriority?: string;
	newPriority?: string;
	assignedTo?: string;
	assignedBy?: string;
	changedBy?: string;
	dependencyId?: string;
	duration?: number; // in milliseconds
	errorMessage?: string;
	metadata?: Record<string, any>;
}

export interface TaskAuditFilter {
	taskId?: string;
	eventType?: TaskAuditEvent["eventType"] | TaskAuditEvent["eventType"][];
	fromDate?: Date;
	toDate?: Date;
	changedBy?: string;
	assignedTo?: string;
	status?: string;
	priority?: string;
	limit?: number;
	offset?: number;
}

export interface TaskHistorySummary {
	taskId: string;
	totalEvents: number;
	statusTransitions: number;
	currentStatus: string;
	firstEvent: Date;
	lastEvent: Date;
	totalDuration: number; // time from creation to completion
	averageTransitionTime: number;
	failureCount: number;
	retryCount: number;
}

export interface AuditStatistics {
	totalEvents: number;
	eventsByType: Record<string, number>;
	eventsByDate: Record<string, number>;
	mostActiveTasks: Array<{ taskId: string; eventCount: number }>;
	failureRate: number;
	averageCompletionTime: number;
	dailyStats: Array<{
		date: string;
		created: number;
		completed: number;
		failed: number;
	}>;
}

export class TaskAuditService {
	private db: Level<string, string>;

	constructor(databasePath?: string) {
		this.db = new Level(databasePath || "./saved-searches-db/task-audit", {
			valueEncoding: "json",
		});
	}

	async initialize(): Promise<void> {
		try {
			await this.db.open();
			console.log("[AUDIT] Task audit service initialized");
		} catch (error) {
			console.error("[AUDIT] Failed to initialize audit service:", error);
			throw error;
		}
	}

	async shutdown(): Promise<void> {
		try {
			await this.db.close();
			console.log("[AUDIT] Task audit service shutdown");
		} catch (error) {
			console.error("[AUDIT] Failed to shutdown audit service:", error);
		}
	}

	// Record task creation
	async recordTaskCreated(task: Task, createdBy?: string): Promise<void> {
		const event: TaskAuditEvent = {
			id: this.generateEventId(),
			taskId: task.id,
			eventType: "created",
			timestamp: new Date(),
			newStatus: task.status,
			newPriority: task.priority,
			assignedTo: task.assignedTo,
			changedBy: createdBy || task.createdBy,
			metadata: {
				title: task.title,
				description: task.description,
				dependencies: task.dependencies,
				type: task.type,
			},
		};

		await this.saveEvent(event);
		console.log(`[AUDIT] Task created: ${task.id} by ${createdBy || task.createdBy}`);
	}

	// Record task status change
	async recordTaskStatusChanged(
		taskId: string,
		oldStatus: string,
		newStatus: string,
		changedBy?: string,
		errorMessage?: string,
		duration?: number,
	): Promise<void> {
		const event: TaskAuditEvent = {
			id: this.generateEventId(),
			taskId,
			eventType: "status_changed",
			timestamp: new Date(),
			oldStatus,
			newStatus,
			changedBy,
			duration,
			errorMessage,
		};

		await this.saveEvent(event);
		console.log(`[AUDIT] Task status changed: ${taskId} ${oldStatus} -> ${newStatus} by ${changedBy}`);
	}

	// Record task priority change
	async recordTaskPriorityChanged(
		taskId: string,
		oldPriority: string,
		newPriority: string,
		changedBy?: string,
	): Promise<void> {
		const event: TaskAuditEvent = {
			id: this.generateEventId(),
			taskId,
			eventType: "priority_changed",
			timestamp: new Date(),
			oldPriority,
			newPriority,
			changedBy,
		};

		await this.saveEvent(event);
		console.log(`[AUDIT] Task priority changed: ${taskId} ${oldPriority} -> ${newPriority} by ${changedBy}`);
	}

	// Record task assignment
	async recordTaskAssigned(taskId: string, assignedTo: string, assignedBy?: string): Promise<void> {
		const event: TaskAuditEvent = {
			id: this.generateEventId(),
			taskId,
			eventType: "assigned",
			timestamp: new Date(),
			assignedTo,
			assignedBy,
		};

		await this.saveEvent(event);
		console.log(`[AUDIT] Task assigned: ${taskId} to ${assignedTo} by ${assignedBy}`);
	}

	// Record task update
	async recordTaskUpdated(taskId: string, changedBy?: string, metadata?: Record<string, any>): Promise<void> {
		const event: TaskAuditEvent = {
			id: this.generateEventId(),
			taskId,
			eventType: "updated",
			timestamp: new Date(),
			changedBy,
			metadata,
		};

		await this.saveEvent(event);
		console.log(`[AUDIT] Task updated: ${taskId} by ${changedBy}`);
	}

	// Record task deletion
	async recordTaskDeleted(taskId: string, deletedBy?: string): Promise<void> {
		const event: TaskAuditEvent = {
			id: this.generateEventId(),
			taskId,
			eventType: "deleted",
			timestamp: new Date(),
			changedBy: deletedBy,
		};

		await this.saveEvent(event);
		console.log(`[AUDIT] Task deleted: ${taskId} by ${deletedBy}`);
	}

	// Record dependency changes
	async recordDependencyAdded(taskId: string, dependencyId: string, addedBy?: string): Promise<void> {
		const event: TaskAuditEvent = {
			id: this.generateEventId(),
			taskId,
			eventType: "dependency_added",
			timestamp: new Date(),
			dependencyId,
			changedBy: addedBy,
		};

		await this.saveEvent(event);
		console.log(`[AUDIT] Dependency added: ${dependencyId} to ${taskId} by ${addedBy}`);
	}

	async recordDependencyRemoved(taskId: string, dependencyId: string, removedBy?: string): Promise<void> {
		const event: TaskAuditEvent = {
			id: this.generateEventId(),
			taskId,
			eventType: "dependency_removed",
			timestamp: new Date(),
			dependencyId,
			changedBy: removedBy,
		};

		await this.saveEvent(event);
		console.log(`[AUDIT] Dependency removed: ${dependencyId} from ${taskId} by ${removedBy}`);
	}

	// Get task history with filtering
	async getTaskHistory(filter: TaskAuditFilter = {}): Promise<TaskAuditEvent[]> {
		const events: TaskAuditEvent[] = [];
		
		try {
			// Create iterator for all events
			const iterator = this.db.iterator({
				gte: "event:",
				lte: "event:\uffff",
				reverse: true, // Get newest first
				limit: filter.limit || 1000,
			});

			for await (const [, value] of iterator) {
				const event = value as unknown as TaskAuditEvent;
				
				// Apply filters
				if (filter.taskId && event.taskId !== filter.taskId) continue;
				if (filter.eventType) {
					const eventTypes = Array.isArray(filter.eventType) ? filter.eventType : [filter.eventType];
					if (!eventTypes.includes(event.eventType)) continue;
				}
				if (filter.fromDate && new Date(event.timestamp) < filter.fromDate) continue;
				if (filter.toDate && new Date(event.timestamp) > filter.toDate) continue;
				if (filter.changedBy && event.changedBy !== filter.changedBy) continue;
				if (filter.assignedTo && event.assignedTo !== filter.assignedTo) continue;
				
				events.push(event);
			}

			// Apply offset
			if (filter.offset && filter.offset > 0) {
				return events.slice(filter.offset);
			}

			return events;
		} catch (error) {
			console.error("[AUDIT] Error getting task history:", error);
			throw error;
		}
	}

	// Get task history summary
	async getTaskHistorySummary(taskId: string): Promise<TaskHistorySummary | null> {
		const events = await this.getTaskHistory({ taskId });
		
		if (events.length === 0) {
			return null;
		}

		const statusTransitions = events.filter(e => e.eventType === "status_changed").length;
		const firstEvent = events[events.length - 1];
		const lastEvent = events[0];
		const failureCount = events.filter(e => 
			e.eventType === "status_changed" && e.newStatus === "failed"
		).length;
		
		const retryCount = events.filter(e => 
			e.eventType === "status_changed" && 
			e.oldStatus === "failed" && 
			e.newStatus === "todo"
		).length;

		// Calculate total duration (time from creation to completion)
		let totalDuration = 0;
		const createdEvent = events.find(e => e.eventType === "created");
		const completedEvent = events.find(e => 
			e.eventType === "status_changed" && e.newStatus === "done"
		);
		
		if (createdEvent && completedEvent) {
			totalDuration = new Date(completedEvent.timestamp).getTime() - new Date(createdEvent.timestamp).getTime();
		}

		// Calculate average transition time
		const transitionEvents = events.filter(e => e.eventType === "status_changed" && e.duration);
		const averageTransitionTime = transitionEvents.length > 0 
			? transitionEvents.reduce((sum, e) => sum + (e.duration || 0), 0) / transitionEvents.length
			: 0;

		const currentStatus = lastEvent.newStatus || firstEvent.newStatus || "unknown";

		return {
			taskId,
			totalEvents: events.length,
			statusTransitions,
			currentStatus,
			firstEvent: new Date(firstEvent.timestamp),
			lastEvent: new Date(lastEvent.timestamp),
			totalDuration,
			averageTransitionTime,
			failureCount,
			retryCount,
		};
	}

	// Get audit statistics
	async getAuditStatistics(fromDate?: Date, toDate?: Date): Promise<AuditStatistics> {
		const events = await this.getTaskHistory({ fromDate, toDate });
		
		const eventsByType: Record<string, number> = {};
		const eventsByDate: Record<string, number> = {};
		const taskEventCounts: Record<string, number> = {};
		
		let totalCompletionTime = 0;
		let completedTasks = 0;
		const dailyStats: Record<string, { created: number; completed: number; failed: number }> = {};

		for (const event of events) {
			// Count by type
			eventsByType[event.eventType] = (eventsByType[event.eventType] || 0) + 1;
			
			// Count by date
			const dateKey = new Date(event.timestamp).toISOString().split('T')[0];
			eventsByDate[dateKey] = (eventsByDate[dateKey] || 0) + 1;
			
			// Count by task
			taskEventCounts[event.taskId] = (taskEventCounts[event.taskId] || 0) + 1;
			
			// Daily stats
			if (!dailyStats[dateKey]) {
				dailyStats[dateKey] = { created: 0, completed: 0, failed: 0 };
			}
			
			if (event.eventType === "created") {
				dailyStats[dateKey].created++;
			} else if (event.eventType === "status_changed" && event.newStatus === "done") {
				dailyStats[dateKey].completed++;
				completedTasks++;
				
				// Calculate completion time
				const createdEvent = events.find(e => 
					e.taskId === event.taskId && e.eventType === "created"
				);
				if (createdEvent) {
					totalCompletionTime += new Date(event.timestamp).getTime() - new Date(createdEvent.timestamp).getTime();
				}
			} else if (event.eventType === "status_changed" && event.newStatus === "failed") {
				dailyStats[dateKey].failed++;
			}
		}

		// Most active tasks
		const mostActiveTasks = Object.entries(taskEventCounts)
			.map(([taskId, eventCount]) => ({ taskId, eventCount }))
			.sort((a, b) => b.eventCount - a.eventCount)
			.slice(0, 10);

		const totalEvents = events.length;
		const failureEvents = events.filter(e => e.newStatus === "failed").length;
		const failureRate = totalEvents > 0 ? (failureEvents / totalEvents) * 100 : 0;
		const averageCompletionTime = completedTasks > 0 ? totalCompletionTime / completedTasks : 0;

		return {
			totalEvents,
			eventsByType,
			eventsByDate,
			mostActiveTasks,
			failureRate,
			averageCompletionTime,
			dailyStats: Object.entries(dailyStats)
				.map(([date, stats]) => ({ date, ...stats }))
				.sort((a, b) => a.date.localeCompare(b.date)),
		};
	}

	// Cleanup old events (for maintenance)
	async cleanupOldEvents(olderThanDays: number = 90): Promise<number> {
		const cutoffDate = new Date();
		cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
		
		let deletedCount = 0;
		
		try {
			const iterator = this.db.iterator({
				gte: "event:",
				lte: "event:\uffff",
			});

			const keysToDelete: string[] = [];

			for await (const [key, value] of iterator) {
				const event = value as unknown as TaskAuditEvent;
				if (new Date(event.timestamp) < cutoffDate) {
					keysToDelete.push(key);
				}
			}

			// Batch delete
			const batch = this.db.batch();
			for (const key of keysToDelete) {
				batch.del(key);
				deletedCount++;
			}
			await batch.write();

			console.log(`[AUDIT] Cleaned up ${deletedCount} old events older than ${olderThanDays} days`);
			return deletedCount;
		} catch (error) {
			console.error("[AUDIT] Error cleaning up old events:", error);
			throw error;
		}
	}

	// Private helper methods
	private generateEventId(): string {
		return `event_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
	}

	private async saveEvent(event: TaskAuditEvent): Promise<void> {
		const key = `event:${event.id}`;
		try {
			await this.db.put(key, JSON.stringify(event));
		} catch (error) {
			console.error("[AUDIT] Failed to save audit event:", error);
			throw error;
		}
	}
}