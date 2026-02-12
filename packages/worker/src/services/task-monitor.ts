import { EventEmitter } from "node:events";
import type { Task } from "@isomorphiq/tasks";
import { DependencyGraphService } from "./dependency-graph.ts";

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

/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class TaskMonitor extends EventEmitter {
	private sessions: Map<string, TaskMonitoringSession> = new Map();
	private subscriptions: Map<string, Set<string>> = new Map(); // taskId -> sessionIds
	private taskCache: Map<string, Task> = new Map();
	private startTime: Date = new Date();
	private dependencyGraphService: DependencyGraphService;

	private readonly cleanupInterval = 5 * 60 * 1000; // 5 minutes
	private readonly sessionTimeout = 30 * 60 * 1000; // 30 minutes

	constructor() {
		super();
		this.dependencyGraphService = new DependencyGraphService();
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

		// Emit global task status change event for WebSocket broadcasting
		this.emit("taskStatusChanged", {
			type: "task_status_changed",
			data: {
				taskId: update.taskId,
				oldStatus: update.oldStatus,
				newStatus: update.newStatus,
				timestamp: update.timestamp,
				task: update.task
			}
		});

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

		// Emit cache update event for real-time notifications
		this.emit("tasksCacheUpdated", {
			type: "tasks_updated",
			data: {
				tasks,
				timestamp: new Date()
			}
		});
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
			if ((task.status as string) === "completed" && task.updatedAt && task.createdAt) {
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
			if ((task.status as string) === "completed" && task.updatedAt) {
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
			if (task.priority === "high" && (task.status as string) !== "completed" && (task.status as string) !== "cancelled") {
				return true;
			}
			
			// Failed tasks
			if ((task.status as string) === "failed") {
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

	// Dependency tracking methods

	// Notify about task completion and check for newly available tasks
	notifyTaskCompleted(completedTask: Task): void {
		this.dependencyGraphService.updateTaskCache([completedTask]);
		
		// Find tasks that can now be processed
		const allTasks = Array.from(this.taskCache.values());
		const newlyProcessableTasks = this.dependencyGraphService.getProcessableTasks(allTasks)
			.filter(task => {
				// Only include tasks that weren't processable before this completion
				const wasProcessable = this.checkWasProcessable(task.id, completedTask.id);
				return !wasProcessable;
			});

		// Emit task completion event
		this.emit("taskCompleted", {
			type: "task_completed",
			data: {
				task: completedTask,
				newlyProcessableTasks,
				timestamp: new Date()
			}
		});

		if (newlyProcessableTasks.length > 0) {
			this.emit("dependencies_satisfied", {
				type: "dependencies_satisfied",
				data: {
					completedTask,
					newlyProcessableTasks,
					message: `Task "${completedTask.title}" completed, ${newlyProcessableTasks.length} tasks are now ready for processing`
				}
			});
		}

		console.log(`[TASK-MONITOR] Task ${completedTask.id} completed, ${newlyProcessableTasks.length} tasks now processable`);
	}

	// Check if a task was processable before a dependency was completed
	private checkWasProcessable(taskId: string, completedDepId: string): boolean {
		const task = this.taskCache.get(taskId);
		if (!task || !task.dependencies) {
			return true;
		}

		// If the task doesn't depend on the completed dependency, it was already processable
		if (!task.dependencies.includes(completedDepId)) {
			return true;
		}

		// Check if all other dependencies (excluding the just-completed one) were already done
		const otherDeps = task.dependencies.filter(depId => depId !== completedDepId);
		return otherDeps.every(depId => {
			const depTask = this.taskCache.get(depId);
			return depTask && depTask.status === "done";
		});
	}

	// Get dependency-aware notifications for sessions
	getDependencyNotifications(sessionId: string): Array<{
		type: "circular_dependency" | "dependency_satisfied" | "bottleneck_detected" | "critical_path_delay";
		message: string;
		tasks: string[];
		timestamp: Date;
	}> {
		const session = this.sessions.get(sessionId);
		if (!session || !session.active) {
			return [];
		}

		const notifications = [];
		const allTasks = Array.from(this.taskCache.values());

		// Check for circular dependencies
		const circularCheck = this.dependencyGraphService.detectCircularDependencies(allTasks);
		if (circularCheck.hasCycle) {
			notifications.push({
				type: "circular_dependency",
				message: `Circular dependencies detected affecting ${circularCheck.affectedTasks.length} tasks`,
				tasks: circularCheck.affectedTasks,
				timestamp: new Date()
			});
		}

		// Check for bottlenecks
		const blockingTasks = this.dependencyGraphService.getBlockingTasks(allTasks);
		if (blockingTasks.length > 0) {
			notifications.push({
				type: "bottleneck_detected",
				message: `${blockingTasks.length} tasks are blocking progress on dependent tasks`,
				tasks: blockingTasks.map(t => t.id),
				timestamp: new Date()
			});
		}

		// Check critical path delays
		const graph = this.dependencyGraphService.generateDependencyGraph(allTasks);
		const delayedCriticalTasks = graph.nodes
			.filter(node => node.criticalPath && node.status === "todo" && (node.slack || 0) < 0)
			.map(node => node.id);

		if (delayedCriticalTasks.length > 0) {
			notifications.push({
				type: "critical_path_delay",
				message: `${delayedCriticalTasks.length} critical path tasks are delayed`,
				tasks: delayedCriticalTasks,
				timestamp: new Date()
			});
		}

		return notifications;
	}

	// Get dependency status summary for dashboard
	getDependencySummary(allTasks: Task[]): {
		totalTasks: number;
		tasksWithDependencies: number;
		processableTasks: number;
		blockingTasks: number;
		circularDependencies: number;
		criticalPathLength: number;
		averageDependencyDepth: number;
	} {
		this.dependencyGraphService.updateTaskCache(allTasks);

		const tasksWithDeps = allTasks.filter(task => task.dependencies && task.dependencies.length > 0);
		const processableTasks = this.dependencyGraphService.getProcessableTasks(allTasks);
		const blockingTasks = this.dependencyGraphService.getBlockingTasks(allTasks);
		const circularCheck = this.dependencyGraphService.detectCircularDependencies(allTasks);
		
		const graph = this.dependencyGraphService.generateDependencyGraph(allTasks);
		const criticalPathLength = graph.criticalPath.length;
		
		// Calculate average dependency depth
		let totalDepth = 0;
		let tasksWithDepth = 0;
		for (const task of tasksWithDeps) {
			const depth = this.calculateDependencyDepth(task.id, new Set());
			if (depth > 0) {
				totalDepth += depth;
				tasksWithDepth++;
			}
		}
		const averageDepth = tasksWithDepth > 0 ? totalDepth / tasksWithDepth : 0;

		return {
			totalTasks: allTasks.length,
			tasksWithDependencies: tasksWithDeps.length,
			processableTasks: processableTasks.length,
			blockingTasks: blockingTasks.length,
			circularDependencies: circularCheck.cycles.length,
			criticalPathLength,
			averageDependencyDepth: Math.round(averageDepth * 10) / 10
		};
	}

	// Calculate dependency depth for a task
	private calculateDependencyDepth(taskId: string, visited: Set<string>): number {
		if (visited.has(taskId)) {
			return 0; // Prevent infinite recursion in cycles
		}

		visited.add(taskId);
		const task = this.taskCache.get(taskId);
		if (!task || !task.dependencies || task.dependencies.length === 0) {
			return 0;
		}

		const depths = task.dependencies.map(depId => 
			this.calculateDependencyDepth(depId, new Set(visited))
		);

		return Math.max(...depths) + 1;
	}

	// Update task cache with dependency graph updates
	updateTaskCacheWithDependencies(tasks: Task[]): void {
		this.updateTaskCache(tasks);
		this.dependencyGraphService.updateTaskCache(tasks);
	}

	// Enhanced real-time metrics for dashboard (compatible with core Task type)
	getRealTimeMetrics(allTasks: Task[]): {
		tasksNeedingAttention: Task[];
		processingRate: number;
		failedTasksRate: number;
		averageTaskAge: number;
		queueDepth: number;
		systemLoad: 'low' | 'medium' | 'high' | 'critical';
		performanceScore: number;
		recentActivity: Array<{
			taskId: string;
			action: string;
			timestamp: Date;
		}>;
	} {
		const now = new Date();
		const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

		// Tasks needing attention (using existing method)
		const tasksNeedingAttention = this.getTasksNeedingAttention(allTasks);

		// Processing rate (tasks completed in last hour)
		const tasksCompletedLastHour = allTasks.filter(task => {
			const taskStatus = task.status as string;
			return taskStatus === "done" && 
			new Date(task.updatedAt) >= oneHourAgo;
		}).length;
		const processingRate = tasksCompletedLastHour;

		// Failed tasks rate (using core Task status)
		const tasksFailedLastHour = allTasks.filter(task => {
			const taskStatus = task.status as string;
			return (taskStatus === "failed" || taskStatus === "cancelled") && 
			new Date(task.updatedAt) >= oneHourAgo;
		}).length;
		const failedTasksRate = tasksFailedLastHour;

		// Average task age (for incomplete tasks)
		const incompleteTasks = allTasks.filter(task => {
			const taskStatus = task.status as string;
			return taskStatus !== "done" && taskStatus !== "cancelled";
		});
		const totalAge = incompleteTasks.reduce((sum, task) => 
			sum + (now.getTime() - new Date(task.createdAt).getTime()), 0
		);
		const averageTaskAge = incompleteTasks.length > 0 ? totalAge / incompleteTasks.length / 1000 / 60 : 0; // in minutes

		// Queue depth (tasks pending processing)
		const queueDepth = allTasks.filter(task => (task.status as string) === "todo").length;

		// System load assessment
		const totalTasks = allTasks.length;
		const inProgressTasks = allTasks.filter(task => (task.status as string) === "in-progress").length;
		const failedTasks = allTasks.filter(task => {
			const taskStatus = task.status as string;
			return taskStatus === "failed" || taskStatus === "cancelled";
		}).length;
		
		const loadRatio = (inProgressTasks + failedTasks) / Math.max(totalTasks, 1);
		let systemLoad: 'low' | 'medium' | 'high' | 'critical';
		if (loadRatio < 0.3) systemLoad = 'low';
		else if (loadRatio < 0.6) systemLoad = 'medium';
		else if (loadRatio < 0.8) systemLoad = 'high';
		else systemLoad = 'critical';

		// Performance score (0-100)
		const completedTasks = allTasks.filter(task => (task.status as string) === "done");
		const completionRate = totalTasks > 0 ? (completedTasks.length / totalTasks) * 100 : 100;
		const recentActivity = tasksCompletedLastHour > 0;
		const attentionNeeded = tasksNeedingAttention.length > 0;
		
		let performanceScore = completionRate;
		if (recentActivity) performanceScore += 10;
		if (attentionNeeded) performanceScore -= 20;
		if (failedTasksRate > 0) performanceScore -= failedTasksRate * 10;
		
		performanceScore = Math.max(0, Math.min(100, performanceScore));

		// Recent activity (last 30 minutes)
		const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);
		const recentActivityItems = allTasks
			.filter(task => new Date(task.updatedAt) >= thirtyMinutesAgo)
			.map(task => ({
				taskId: task.id,
				action: this.determineTaskActivity(task),
				timestamp: new Date(task.updatedAt)
			}))
			.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
			.slice(0, 20);

		return {
			tasksNeedingAttention,
			processingRate,
			failedTasksRate,
			averageTaskAge,
			queueDepth,
			systemLoad,
			performanceScore,
			recentActivity: recentActivityItems
		};
	}

	// Determine task activity for recent activity tracking
	private determineTaskActivity(task: Task): string {
		const now = new Date();
		const updated = new Date(task.updatedAt);
		const created = new Date(task.createdAt);
		const timeDiff = now.getTime() - updated.getTime();

		if (timeDiff < 60000 && updated.getTime() === created.getTime()) {
			return 'created';
		}

		const taskStatus = task.status as string;
		switch (taskStatus) {
			case 'in-progress':
				return 'started';
			case 'done':
				return 'completed';
			case 'failed':
				return 'failed';
			case 'cancelled':
				return 'cancelled';
			default:
				return 'updated';
		}
	}

	// Get failed tasks with retry analysis (compatible with core Task type)
	getFailedTasksAnalysis(allTasks: Task[]): {
		failedTasks: Task[];
		retryableTasks: Task[];
		failureRate: number;
		commonFailureReasons: Array<{
			reason: string;
			count: number;
			tasks: string[];
		}>;
	} {
		const failedTasks = allTasks.filter(task => {
			const taskStatus = task.status as string;
			return taskStatus === "failed" || taskStatus === "cancelled";
		});
		const totalTasks = allTasks.length;
		const failureRate = totalTasks > 0 ? (failedTasks.length / totalTasks) * 100 : 0;

		// Tasks that can be retried (not cancelled, recent failures)
		const retryableTasks = failedTasks.filter(task => {
			const taskStatus = task.status as string;
			return taskStatus !== "cancelled" && 
			(Date.now() - new Date(task.updatedAt).getTime()) < 24 * 60 * 60 * 1000 // Within last 24 hours
		});

		// Analyze common failure patterns (mock analysis for now)
		const commonFailureReasons = [
			{
				reason: "Timeout",
				count: Math.floor(failedTasks.length * 0.3),
				tasks: failedTasks.slice(0, Math.floor(failedTasks.length * 0.3)).map(t => t.id)
			},
			{
				reason: "Dependency Failure",
				count: Math.floor(failedTasks.length * 0.2),
				tasks: failedTasks.slice(Math.floor(failedTasks.length * 0.3), Math.floor(failedTasks.length * 0.5)).map(t => t.id)
			},
			{
				reason: "Resource Error", 
				count: Math.floor(failedTasks.length * 0.2),
				tasks: failedTasks.slice(Math.floor(failedTasks.length * 0.5), Math.floor(failedTasks.length * 0.7)).map(t => t.id)
			}
		].filter(item => item.count > 0);

		return {
			failedTasks,
			retryableTasks,
			failureRate,
			commonFailureReasons
		};
	}

	// Enhanced metrics for dashboard performance monitoring (compatible with core Task type)
	getPerformanceMetrics(allTasks: Task[]): {
		throughput: {
			tasksPerHour: number;
			tasksPerDay: number;
			peakHour: string;
			peakDay: string;
		};
		latency: {
			averageCompletionTime: number;
			medianCompletionTime: number;
			p95CompletionTime: number;
		};
		errors: {
			errorRate: number;
			criticalErrors: number;
			recoveryRate: number;
		};
		efficiency: {
			resourceUtilization: number;
			queueEfficiency: number;
			successRate: number;
		};
	} {
		const now = new Date();
		const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
		const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

		// Throughput metrics
		const completedLastDay = allTasks.filter(task => {
			const taskStatus = task.status as string;
			return taskStatus === "done" && new Date(task.updatedAt) >= oneDayAgo;
		});
		const completedLastWeek = allTasks.filter(task => {
			const taskStatus = task.status as string;
			return taskStatus === "done" && new Date(task.updatedAt) >= oneWeekAgo;
		});

		const tasksPerHour = completedLastDay.length / 24;
		const tasksPerDay = completedLastWeek.length / 7;

		// Find peak hour (mock implementation)
		const peakHour = "14:00"; // 2 PM
		const peakDay = "Tuesday";

		// Latency metrics
		const completedTasks = allTasks.filter(task => (task.status as string) === "done");
		const completionTimes = completedTasks.map(task => {
			const created = new Date(task.createdAt).getTime();
			const updated = new Date(task.updatedAt).getTime();
			return (updated - created) / 1000; // in seconds
		}).sort((a, b) => a - b);

		const averageCompletionTime = completionTimes.length > 0 ? 
			completionTimes.reduce((sum, time) => sum + time, 0) / completionTimes.length : 0;

		const medianCompletionTime = completionTimes.length > 0 ? 
			completionTimes[Math.floor(completionTimes.length / 2)] : 0;

		const p95CompletionTime = completionTimes.length > 0 ? 
			completionTimes[Math.floor(completionTimes.length * 0.95)] : 0;

		// Error metrics
		const failedTasks = allTasks.filter(task => {
			const taskStatus = task.status as string;
			return taskStatus === "failed" || taskStatus === "cancelled";
		});
		const errorRate = allTasks.length > 0 ? (failedTasks.length / allTasks.length) * 100 : 0;
		const criticalErrors = failedTasks.filter(task => task.priority === "high").length;
		const recoveryRate = completedTasks.length > 0 ? 
			((completedTasks.length - failedTasks.filter(f => 
				completedTasks.some(c => c.id === f.id)
			).length) / completedTasks.length) * 100 : 100;

		// Efficiency metrics
		const resourceUtilization = Math.min(100, (completedTasks.length / Math.max(allTasks.length, 1)) * 100);
		const queueEfficiency = tasksPerHour > 0 ? Math.min(100, (tasksPerHour / 10) * 100) : 0; // Assuming 10 tasks/hour is optimal
		const successRate = allTasks.length > 0 ? (completedTasks.length / allTasks.length) * 100 : 100;

		return {
			throughput: {
				tasksPerHour,
				tasksPerDay,
				peakHour,
				peakDay
			},
			latency: {
				averageCompletionTime,
				medianCompletionTime,
				p95CompletionTime
			},
			errors: {
				errorRate,
				criticalErrors,
				recoveryRate
			},
			efficiency: {
				resourceUtilization,
				queueEfficiency,
				successRate
			}
		};
	}
}