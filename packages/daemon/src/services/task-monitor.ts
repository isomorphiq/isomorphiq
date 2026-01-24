import { EventEmitter } from "node:events";
import type { Task } from "@isomorphiq/tasks";

export interface TaskFilter {
	status?: string | string[];
	priority?: string | string[];
	createdBy?: string;
	assignedTo?: string;
	type?: string;
	createdAfter?: Date;
	createdBefore?: Date;
	updatedAfter?: Date;
	updatedBefore?: Date;
	limit?: number;
	offset?: number;
	search?: string;
}

export interface DashboardMetrics {
	totalTasks: number;
	pendingTasks: number;
	inProgressTasks: number;
	completedTasks: number;
	failedTasks: number;
	cancelledTasks: number;
	tasksByPriority: Record<string, number>;
	tasksByType: Record<string, number>;
	averageCompletionTime?: number;
	queueProcessingRate?: number;
	daemonUptime?: number;
	lastUpdated: Date;
}

export interface TaskStatusUpdate {
	taskId: string;
	oldStatus?: string;
	newStatus: string;
	timestamp: Date;
	task: Task;
}

export interface TaskMonitoringSession {
	id: string;
	filters: TaskFilter;
	createdAt: Date;
	lastActivity: Date;
	active: boolean;
}

export class TaskMonitor extends EventEmitter {
	private sessions: Map<string, TaskMonitoringSession> = new Map();
	private subscriptions: Map<string, Set<string>> = new Map(); // taskId -> sessionIds
	private taskCache: Map<string, Task> = new Map();
	private startTime: Date = new Date();

	private readonly cleanupInterval = 5 * 60 * 1000; // 5 minutes
	private readonly sessionTimeout = 30 * 60 * 1000; // 30 minutes

	constructor() {
		super();
		this.startCleanupTimer();
	}

	// Create a new monitoring session
	createSession(filters: TaskFilter = {}): TaskMonitoringSession {
		const sessionId = this.generateSessionId();
		const session: TaskMonitoringSession = {
			id: sessionId,
			filters: { ...filters },
			createdAt: new Date(),
			lastActivity: new Date(),
			active: true,
		};

		this.sessions.set(sessionId, session);
		console.log(`[TASK-MONITOR] Created monitoring session: ${sessionId}`);
		return session;
	}

	// Update session filters
	updateSession(sessionId: string, filters: Partial<TaskFilter>): boolean {
		const session = this.sessions.get(sessionId);
		if (!session || !session.active) {
			return false;
		}

		session.filters = { ...session.filters, ...filters };
		session.lastActivity = new Date();
		
		// Re-apply filters to existing tasks
		this.refreshSessionSubscriptions(sessionId);
		
		console.log(`[TASK-MONITOR] Updated session: ${sessionId}`);
		return true;
	}

	// Get filtered tasks for a session
	async getFilteredTasks(sessionId: string, allTasks: Task[]): Promise<Task[]> {
		const session = this.sessions.get(sessionId);
		if (!session || !session.active) {
			return [];
		}

		session.lastActivity = new Date();
		return this.applyFilters(allTasks, session.filters);
	}

	// Subscribe to task status updates for a session
	subscribeToTaskUpdates(sessionId: string, taskIds: string[]): boolean {
		const session = this.sessions.get(sessionId);
		if (!session || !session.active) {
			return false;
		}

		// Clear existing subscriptions for this session
		for (const [taskId, subscribers] of this.subscriptions.entries()) {
			subscribers.delete(sessionId);
			if (subscribers.size === 0) {
				this.subscriptions.delete(taskId);
			}
		}

		// Add new subscriptions
		for (const taskId of taskIds) {
			if (!this.subscriptions.has(taskId)) {
				this.subscriptions.set(taskId, new Set());
			}
			this.subscriptions.get(taskId)!.add(sessionId);
		}

		console.log(`[TASK-MONITOR] Session ${sessionId} subscribed to ${taskIds.length} tasks`);
		return true;
	}

	// Get tasks matching filters without requiring a session
	getTasksByFilter(allTasks: Task[], filters: TaskFilter): Task[] {
		return this.applyFilters(allTasks, filters);
	}

	// Notify about task status changes
	notifyTaskStatusChange(update: TaskStatusUpdate): void {
		// Update cache
		this.taskCache.set(update.taskId, update.task);

		// Find all sessions subscribed to this task
		const subscribedSessions = this.subscriptions.get(update.taskId);
		if (!subscribedSessions) {
			return;
		}

		// Send update to all active subscribed sessions
		for (const sessionId of subscribedSessions) {
			const session = this.sessions.get(sessionId);
			if (session && session.active) {
				this.emit("taskUpdate", sessionId, update);
				session.lastActivity = new Date();
			}
		}

		console.log(`[TASK-MONITOR] Notified ${subscribedSessions.size} sessions about task ${update.taskId} status change`);
	}

	// Get task by ID (with cache)
	getTaskById(taskId: string): Task | null {
		return this.taskCache.get(taskId) || null;
	}

	// Update task cache
	updateTaskCache(tasks: Task[]): void {
		for (const task of tasks) {
			this.taskCache.set(task.id, task);
		}
	}

	// Get session info
	getSession(sessionId: string): TaskMonitoringSession | null {
		const session = this.sessions.get(sessionId);
		return session && session.active ? { ...session } : null;
	}

	// Get all active sessions
	getActiveSessions(): TaskMonitoringSession[] {
		return Array.from(this.sessions.values())
			.filter(session => session.active)
			.map(session => ({ ...session }));
	}

	// Close a monitoring session
	closeSession(sessionId: string): boolean {
		const session = this.sessions.get(sessionId);
		if (!session) {
			return false;
		}

		session.active = false;
		this.sessions.delete(sessionId);

		// Remove subscriptions
		for (const [taskId, subscribers] of this.subscriptions.entries()) {
			subscribers.delete(sessionId);
			if (subscribers.size === 0) {
				this.subscriptions.delete(taskId);
			}
		}

		console.log(`[TASK-MONITOR] Closed monitoring session: ${sessionId}`);
		return true;
	}

	// Apply filters to tasks
	private applyFilters(tasks: Task[], filters: TaskFilter): Task[] {
		let filteredTasks = [...tasks];

		if (filters.status) {
			const statuses = Array.isArray(filters.status) ? filters.status : [filters.status];
			filteredTasks = filteredTasks.filter(task => statuses.includes(task.status));
		}

		if (filters.priority) {
			const priorities = Array.isArray(filters.priority) ? filters.priority : [filters.priority];
			filteredTasks = filteredTasks.filter(task => priorities.includes(task.priority));
		}

		if (filters.createdBy) {
			filteredTasks = filteredTasks.filter(task => task.createdBy === filters.createdBy);
		}

		if (filters.assignedTo) {
			filteredTasks = filteredTasks.filter(task => task.assignedTo === filters.assignedTo);
		}

		if (filters.type) {
			filteredTasks = filteredTasks.filter(task => task.type === filters.type);
		}

		if (filters.createdAfter) {
			const afterDate = filters.createdAfter.getTime();
			filteredTasks = filteredTasks.filter(task => new Date(task.createdAt).getTime() >= afterDate);
		}

		if (filters.createdBefore) {
			const beforeDate = filters.createdBefore.getTime();
			filteredTasks = filteredTasks.filter(task => new Date(task.createdAt).getTime() <= beforeDate);
		}

		if (filters.updatedAfter) {
			const afterDate = filters.updatedAfter.getTime();
			filteredTasks = filteredTasks.filter(task => new Date(task.updatedAt).getTime() >= afterDate);
		}

		if (filters.updatedBefore) {
			const beforeDate = filters.updatedBefore.getTime();
			filteredTasks = filteredTasks.filter(task => new Date(task.updatedAt).getTime() <= beforeDate);
		}

		// Sort by creation date (newest first)
		filteredTasks.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

		// Apply pagination
		if (filters.offset && filters.offset > 0) {
			filteredTasks = filteredTasks.slice(filters.offset);
		}

		if (filters.limit && filters.limit > 0) {
			filteredTasks = filteredTasks.slice(0, filters.limit);
		}

		return filteredTasks;
	}

	// Refresh subscriptions for a session based on current filters
	private refreshSessionSubscriptions(sessionId: string): void {
		const session = this.sessions.get(sessionId);
		if (!session || !session.active) {
			return;
		}

		// Get all cached tasks that match the session's filters
		const matchingTasks = Array.from(this.taskCache.values())
			.filter(task => this.applyFilters([task], session.filters).length > 0);

		const taskIds = matchingTasks.map(task => task.id);
		this.subscribeToTaskUpdates(sessionId, taskIds);
	}

	// Generate unique session ID
	private generateSessionId(): string {
		return `monitor_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
	}

	// Start cleanup timer
	private startCleanupTimer(): void {
		setInterval(() => {
			this.cleanupInactiveSessions();
		}, this.cleanupInterval);
	}

	// Clean up inactive sessions
	private cleanupInactiveSessions(): void {
		const now = new Date();
		const sessionsToRemove: string[] = [];

		for (const [sessionId, session] of this.sessions.entries()) {
			const inactiveTime = now.getTime() - session.lastActivity.getTime();
			if (inactiveTime > this.sessionTimeout) {
				sessionsToRemove.push(sessionId);
			}
		}

		for (const sessionId of sessionsToRemove) {
			console.log(`[TASK-MONITOR] Cleaning up inactive session: ${sessionId}`);
			this.closeSession(sessionId);
		}

		if (sessionsToRemove.length > 0) {
			console.log(`[TASK-MONITOR] Cleaned up ${sessionsToRemove.length} inactive sessions`);
		}
	}

	// Get dashboard metrics
	getDashboardMetrics(allTasks: Task[]): DashboardMetrics {
		const tasksByStatus: Record<string, number> = {};
		const tasksByPriority: Record<string, number> = {};
		const tasksByType: Record<string, number> = {};
		let totalCompletionTime = 0;
		let completedTasksCount = 0;

		for (const task of allTasks) {
			// Count by status
			tasksByStatus[task.status] = (tasksByStatus[task.status] || 0) + 1;
			
			// Count by priority
			tasksByPriority[task.priority] = (tasksByPriority[task.priority] || 0) + 1;
			
			// Count by type
			if (task.type) {
				tasksByType[task.type] = (tasksByType[task.type] || 0) + 1;
			}

			// Calculate completion time for completed tasks
			if (task.status === "completed" && task.updatedAt && task.createdAt) {
				const completionTime = new Date(task.updatedAt).getTime() - new Date(task.createdAt).getTime();
				totalCompletionTime += completionTime;
				completedTasksCount++;
			}
		}

		const averageCompletionTime = completedTasksCount > 0 ? totalCompletionTime / completedTasksCount : undefined;
		const daemonUptime = Date.now() - this.startTime.getTime();
		const queueProcessingRate = this.calculateProcessingRate(allTasks);

		return {
			totalTasks: allTasks.length,
			pendingTasks: tasksByStatus["todo"] || 0,
			inProgressTasks: tasksByStatus["in-progress"] || 0,
			completedTasks: tasksByStatus["completed"] || 0,
			failedTasks: tasksByStatus["failed"] || 0,
			cancelledTasks: tasksByStatus["cancelled"] || 0,
			tasksByPriority,
			tasksByType,
			averageCompletionTime,
			queueProcessingRate,
			daemonUptime,
			lastUpdated: new Date(),
		};
	}

	// Calculate queue processing rate (tasks per hour)
	private calculateProcessingRate(allTasks: Task[]): number {
		const oneHourAgo = Date.now() - (60 * 60 * 1000);
		let tasksCompletedInHour = 0;

		for (const task of allTasks) {
			if (task.status === "completed" && task.updatedAt) {
				const updatedTime = new Date(task.updatedAt).getTime();
				if (updatedTime >= oneHourAgo) {
					tasksCompletedInHour++;
				}
			}
		}

		return tasksCompletedInHour;
	}

	// Search tasks by text
	searchTasks(allTasks: Task[], query: string): Task[] {
		if (!query.trim()) {
			return allTasks;
		}

		const lowerQuery = query.toLowerCase();
		return allTasks.filter(task => 
			task.title.toLowerCase().includes(lowerQuery) ||
			task.description.toLowerCase().includes(lowerQuery) ||
			(task.assignedTo && task.assignedTo.toLowerCase().includes(lowerQuery)) ||
			(task.createdBy && task.createdBy.toLowerCase().includes(lowerQuery))
		);
	}

	// Get recently updated tasks
	getRecentTasks(allTasks: Task[], minutes: number = 60): Task[] {
		const cutoffTime = Date.now() - (minutes * 60 * 1000);
		return allTasks
			.filter(task => new Date(task.updatedAt).getTime() >= cutoffTime)
			.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
	}

	// Get tasks that need attention (high priority, failed, or long overdue)
	getTasksNeedingAttention(allTasks: Task[]): Task[] {
		return allTasks.filter(task => {
			// High priority tasks not completed
			if (task.priority === "high" && task.status !== "completed" && task.status !== "cancelled") {
				return true;
			}
			
			// Failed tasks
			if (task.status === "failed") {
				return true;
			}
			
			// Tasks in progress for more than 24 hours
			if (task.status === "in-progress" && task.updatedAt) {
				const inProgressTime = Date.now() - new Date(task.updatedAt).getTime();
				return inProgressTime > (24 * 60 * 60 * 1000); // 24 hours
			}
			
			return false;
		});
	}
}