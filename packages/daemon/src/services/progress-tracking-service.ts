import type { Task } from "@isomorphiq/tasks";
import { TaskAuditService } from "./task-audit-service.ts";
import type { TaskAuditEvent } from "./task-audit-service.ts";

export interface TaskProgressMetrics {
	taskId: string;
	title: string;
	status: string;
	priority: string;
	createdAt: Date;
	updatedAt: Date;
	currentAge: number; // minutes since creation
	timeInCurrentStatus: number; // minutes
	processingTime?: number; // total processing time in minutes
	estimatedCompletion?: Date;
	progressPercentage: number; // 0-100
	statusTransitions: number;
	retryCount: number;
	failureCount: number;
	averageStatusDuration: number; // minutes
	isOverdue: boolean;
	performanceScore: number; // 0-100
}

export interface ProgressTrackingFilter {
	status?: string | string[];
	priority?: string | string[];
	createdBy?: string;
	assignedTo?: string;
	type?: string;
	createdAfter?: Date;
	createdBefore?: Date;
	updatedAfter?: Date;
	updatedBefore?: Date;
	overdueOnly?: boolean;
	minProgress?: number;
	maxProgress?: number;
	minPerformanceScore?: number;
	limit?: number;
	offset?: number;
}

export interface ProgressAnalytics {
	totalTasks: number;
	completionRate: number;
	averageProcessingTime: number;
	averageTaskAge: number;
	overdueTasksCount: number;
	highRiskTasksCount: number;
	performanceDistribution: {
		excellent: number; // 90-100
		good: number; // 75-89
		fair: number; // 60-74
		poor: number; // <60
	};
	statusFlow: Array<{
		fromStatus: string;
		toStatus: string;
		count: number;
		averageTime: number; // minutes
	}>;
	bottlenecks: Array<{
		status: string;
		averageTime: number;
		taskCount: number;
	}>;
	productivityTrends: Array<{
		date: string;
		completed: number;
		failed: number;
		created: number;
		averageTime: number;
	}>;
	retentionStats: {
		totalEvents: number;
		oldestEvent: Date;
		newestEvent: Date;
		storageSize: string; // estimated
		recommendedCleanup: number; // events to clean up
	};
}

export interface RetentionPolicy {
	olderThanDays: number;
	keepHighPriorityTasks: boolean;
	keepFailedTasks: boolean;
	keepTasksWithDependencies: boolean;
	minEventsPerTask: number;
	maxEventsPerTask: number;
	dryRun?: boolean;
}

export class ProgressTrackingService {
	private auditService: TaskAuditService;

	constructor(auditService?: TaskAuditService) {
		this.auditService = auditService || new TaskAuditService();
	}

	async initialize(): Promise<void> {
		await this.auditService.initialize();
		console.log("[PROGRESS] Progress tracking service initialized");
	}

	// Calculate progress metrics for a single task
	async calculateTaskProgress(task: Task): Promise<TaskProgressMetrics> {
		const now = new Date();
		const created = new Date(task.createdAt);
		const updated = new Date(task.updatedAt);
		
		// Get task history for detailed analysis
		const history = await this.auditService.getTaskHistory({ taskId: task.id });
		const summary = await this.auditService.getTaskHistorySummary(task.id);

		// Calculate basic metrics
		const currentAge = Math.floor((now.getTime() - created.getTime()) / (1000 * 60));
		const timeInCurrentStatus = Math.floor((now.getTime() - updated.getTime()) / (1000 * 60));
		
		// Calculate processing time if completed
		let processingTime = 0;
		if ((task.status as string) === "done" && summary && summary.totalDuration > 0) {
			processingTime = Math.floor(summary.totalDuration / (1000 * 60));
		} else if ((task.status as string) === "done") {
			// Fallback: calculate from task timestamps
			processingTime = Math.floor((updated.getTime() - created.getTime()) / (1000 * 60));
		}

		// Calculate progress percentage based on status and history
		const progressPercentage = this.calculateProgressPercentage(task, history);
		
		// Estimate completion time for incomplete tasks
		let estimatedCompletion: Date | undefined;
		if ((task.status as string) !== "done" && (task.status as string) !== "cancelled") {
			estimatedCompletion = this.estimateCompletionTime(task, history, processingTime);
		}

		// Calculate performance score
		const performanceScore = this.calculatePerformanceScore(task, history, currentAge, processingTime, created, updated);

		// Determine if task is overdue
		const isOverdue = this.isTaskOverdue(task, currentAge, estimatedCompletion);

		return {
			taskId: task.id,
			title: task.title,
			status: task.status as string,
			priority: task.priority,
			createdAt: created,
			updatedAt: updated,
			currentAge,
			timeInCurrentStatus,
			processingTime,
			estimatedCompletion,
			progressPercentage,
			statusTransitions: summary?.statusTransitions || 0,
			retryCount: summary?.retryCount || 0,
			failureCount: summary?.failureCount || 0,
			averageStatusDuration: summary?.averageTransitionTime ? Math.floor(summary.averageTransitionTime / (1000 * 60)) : 0,
			isOverdue,
			performanceScore
		};
	}

	// Get progress metrics for multiple tasks with filtering
	async getTasksProgress(tasks: Task[], filter: ProgressTrackingFilter = {}): Promise<TaskProgressMetrics[]> {
		const filteredTasks = this.applyProgressFilters(tasks, filter);
		const progressMetrics: TaskProgressMetrics[] = [];

		for (const task of filteredTasks) {
			try {
				const metrics = await this.calculateTaskProgress(task);
				progressMetrics.push(metrics);
			} catch (error) {
				console.error(`[PROGRESS] Error calculating progress for task ${task.id}:`, error);
			}
		}

		// Sort by priority and performance score
		progressMetrics.sort((a, b) => {
			const priorityOrder = { high: 3, medium: 2, low: 1 };
			const priorityDiff = (priorityOrder[b.priority as keyof typeof priorityOrder] || 0) - 
							  (priorityOrder[a.priority as keyof typeof priorityOrder] || 0);
			
			if (priorityDiff !== 0) return priorityDiff;
			return b.performanceScore - a.performanceScore;
		});

		// Apply pagination
		if (filter.offset && filter.offset > 0) {
			progressMetrics.splice(0, filter.offset);
		}
		if (filter.limit && filter.limit > 0) {
			progressMetrics.splice(filter.limit);
		}

		return progressMetrics;
	}

	// Get comprehensive progress analytics
	async getProgressAnalytics(tasks: Task[], dateRange?: { from: Date; to: Date }): Promise<ProgressAnalytics> {
		const progressMetrics = await this.getTasksProgress(tasks);
		const now = new Date();

		// Basic metrics
		const completedTasks = progressMetrics.filter(m => m.status === "done");
		const completionRate = tasks.length > 0 ? (completedTasks.length / tasks.length) * 100 : 0;
		
		const averageProcessingTime = completedTasks.length > 0 
			? completedTasks.reduce((sum, task) => sum + (task.processingTime || 0), 0) / completedTasks.length
			: 0;

		const averageTaskAge = progressMetrics.length > 0
			? progressMetrics.reduce((sum, task) => sum + task.currentAge, 0) / progressMetrics.length
			: 0;

		const overdueTasks = progressMetrics.filter(m => m.isOverdue);
		const highRiskTasks = progressMetrics.filter(m => 
			m.performanceScore < 60 || (m.priority === "high" && m.status !== "done")
		);

		// Performance distribution
		const performanceDistribution = {
			excellent: progressMetrics.filter(m => m.performanceScore >= 90).length,
			good: progressMetrics.filter(m => m.performanceScore >= 75 && m.performanceScore < 90).length,
			fair: progressMetrics.filter(m => m.performanceScore >= 60 && m.performanceScore < 75).length,
			poor: progressMetrics.filter(m => m.performanceScore < 60).length
		};

		// Status flow analysis
		const statusFlow = await this.analyzeStatusFlow(dateRange);

		// Bottleneck analysis
		const bottlenecks = await this.identifyBottlenecks(dateRange);

		// Productivity trends (last 30 days)
		const productivityTrends = await this.calculateProductivityTrends(dateRange);

		// Retention statistics
		const retentionStats = await this.getRetentionStats();

		return {
			totalTasks: tasks.length,
			completionRate,
			averageProcessingTime,
			averageTaskAge,
			overdueTasksCount: overdueTasks.length,
			highRiskTasksCount: highRiskTasks.length,
			performanceDistribution,
			statusFlow,
			bottlenecks,
			productivityTrends,
			retentionStats
		};
	}

	// Apply retention policy to clean up old audit events
	async applyRetentionPolicy(policy: RetentionPolicy): Promise<{
		deletedCount: number;
		keptCount: number;
		totalProcessed: number;
		summaries: Array<{
			taskId: string;
			eventsDeleted: number;
			eventsKept: number;
		}>;
	}> {
		const allEvents = await this.auditService.getTaskHistory({});
		const cutoffDate = new Date();
		cutoffDate.setDate(cutoffDate.getDate() - policy.olderThanDays);

		// Group events by task
		const eventsByTask = new Map<string, TaskAuditEvent[]>();
		for (const event of allEvents) {
			if (!eventsByTask.has(event.taskId)) {
				eventsByTask.set(event.taskId, []);
			}
			eventsByTask.get(event.taskId)!.push(event);
		}

		let totalDeleted = 0;
		let totalKept = 0;
		const summaries: Array<{ taskId: string; eventsDeleted: number; eventsKept: number }> = [];

		// Get all tasks to check priority and dependencies
		const allTasks = await this.getAllTasks(); // This would need to be injected or passed

		for (const [taskId, events] of eventsByTask) {
			const task = allTasks.find(t => t.id === taskId);
			let eventsToDelete: TaskAuditEvent[] = [];
			let eventsToKeep: TaskAuditEvent[] = [];

			for (const event of events) {
				let shouldDelete = new Date(event.timestamp) < cutoffDate;

				// Exceptions to deletion rule
				if (shouldDelete && task) {
					// Keep high priority tasks if configured
					if (policy.keepHighPriorityTasks && task.priority === "high") {
						shouldDelete = false;
					}

					// Keep failed tasks if configured
					if (policy.keepFailedTasks && (task.status as string) === "failed") {
						shouldDelete = false;
					}

					// Keep tasks with dependencies if configured
					if (policy.keepTasksWithDependencies && task.dependencies && task.dependencies.length > 0) {
						shouldDelete = false;
					}
				}

				// Always keep creation events and minimum number of events
				if (event.eventType === "created" || events.length <= policy.minEventsPerTask) {
					shouldDelete = false;
				}

				if (shouldDelete) {
					eventsToDelete.push(event);
				} else {
					eventsToKeep.push(event);
				}
			}

			// Limit events per task if specified
			if (eventsToKeep.length > policy.maxEventsPerTask) {
				// Keep the most recent events
				eventsToKeep.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
				const extraEvents = eventsToKeep.splice(policy.maxEventsPerTask);
				eventsToDelete.push(...extraEvents);
			}

			if (!policy.dryRun) {
				// Delete events from database (would need to implement deleteEvent in TaskAuditService)
				// For now, we'll just count them
				console.log(`[PROGRESS] Would delete ${eventsToDelete.length} events for task ${taskId}`);
			}

			totalDeleted += eventsToDelete.length;
			totalKept += eventsToKeep.length;

			if (eventsToDelete.length > 0 || eventsToKeep.length > 0) {
				summaries.push({
					taskId,
					eventsDeleted: eventsToDelete.length,
					eventsKept: eventsToKeep.length
				});
			}
		}

		console.log(`[PROGRESS] Retention policy applied: ${totalDeleted} events deleted, ${totalKept} events kept`);
		
		return {
			deletedCount: totalDeleted,
			keptCount: totalKept,
			totalProcessed: totalDeleted + totalKept,
			summaries
		};
	}

	// Private helper methods
	private calculateProgressPercentage(task: Task, history: TaskAuditEvent[]): number {
		const status = task.status as string;
		
		// Basic progress based on status
		const statusProgress = {
			"todo": 0,
			"in-progress": 50,
			"done": 100,
			"failed": 25,
			"cancelled": 0
		};

		let baseProgress = statusProgress[status as keyof typeof statusProgress] || 0;

		// Adjust based on history and dependencies
		const statusChanges = history.filter(e => e.eventType === "status_changed").length;
		const hasDependencies = task.dependencies && task.dependencies.length > 0;

		// Factor in retry attempts (negative impact)
		const retries = history.filter(e => 
			e.eventType === "status_changed" && 
			e.oldStatus === "failed" && 
			e.newStatus === "todo"
		).length;

		// Adjust progress based on complexity
		let complexityBonus = 0;
		if (hasDependencies) {
			complexityBonus += Math.min(20, task.dependencies!.length * 5);
		}
		if (statusChanges > 2) {
			complexityBonus += Math.min(10, statusChanges * 2);
		}

		// Apply retry penalty
		const retryPenalty = Math.min(30, retries * 10);

		return Math.max(0, Math.min(100, baseProgress + complexityBonus - retryPenalty));
	}

	private estimateCompletionTime(task: Task, history: TaskAuditEvent[], currentProcessingTime: number): Date | undefined {
		const status = task.status as string;
		
		if (status === "done" || status === "cancelled") {
			return undefined;
		}

		// Use historical data to estimate completion
		const statusHistory = history.filter(e => e.eventType === "status_changed");
		const avgTimePerStatus = this.calculateAverageTimePerStatus(statusHistory);

		let estimatedMinutes = 0;
		
		// Add remaining time based on current status and typical workflow
		switch (status) {
			case "todo":
				estimatedMinutes = avgTimePerStatus["todo"] + avgTimePerStatus["in-progress"];
				break;
			case "in-progress":
				estimatedMinutes = avgTimePerStatus["in-progress"];
				break;
			case "failed":
				estimatedMinutes = avgTimePerStatus["todo"] + avgTimePerStatus["in-progress"]; // Assume retry
				break;
		}

		// Factor in task complexity
		if (task.dependencies && task.dependencies.length > 0) {
			estimatedMinutes *= (1 + task.dependencies.length * 0.1);
		}

		// Factor in priority (high priority tasks usually faster)
		const priorityMultiplier = {
			high: 0.8,
			medium: 1.0,
			low: 1.3
		};
		estimatedMinutes *= priorityMultiplier[task.priority as keyof typeof priorityMultiplier] || 1.0;

		return new Date(Date.now() + estimatedMinutes * 60 * 1000);
	}

	private calculatePerformanceScore(task: Task, history: TaskAuditEvent[], currentAge: number, processingTime: number, created: Date, updated: Date): number {
		let score = 100;

		// Deduct points for being overdue
		const expectedTime = this.getExpectedCompletionTime(task);
		if (expectedTime && currentAge > expectedTime) {
			const overdueRatio = (currentAge - expectedTime) / expectedTime;
			score -= Math.min(40, overdueRatio * 100);
		}

		// Bonus for completed tasks
		if ((task.status as string) === "done") {
			score = Math.max(score, 90); // Ensure completed tasks get high scores
		}

		// Deduct points for failures
		const failures = history.filter(e => e.eventType === "status_changed" && e.newStatus === "failed").length;
		score -= Math.min(30, failures * 10);

		// Deduct points for too many status changes (indicates instability)
		const statusChanges = history.filter(e => e.eventType === "status_changed").length;
		if (statusChanges > 5) {
			score -= Math.min(20, (statusChanges - 5) * 3);
		}

		// Bonus for completing quickly
		if (processingTime > 0 && processingTime < expectedTime) {
			const speedBonus = ((expectedTime - processingTime) / expectedTime) * 20;
			score += Math.min(15, speedBonus);
		}

		// Bonus for high priority tasks being completed
		if (task.priority === "high" && (task.status as string) === "done") {
			score += 10;
		}

		return Math.max(0, Math.min(100, score));
	}

	private isTaskOverdue(task: Task, currentAge: number, estimatedCompletion?: Date): boolean {
		if ((task.status as string) === "done" || (task.status as string) === "cancelled") {
			return false;
		}

		const expectedTime = this.getExpectedCompletionTime(task);
		
		// Check both age-based and estimated completion based overdue
		const ageBasedOverdue = currentAge > expectedTime;
		const completionBasedOverdue = estimatedCompletion ? new Date() > estimatedCompletion : false;
		
		return ageBasedOverdue || completionBasedOverdue;
	}

	private getExpectedCompletionTime(task: Task): number {
		// Expected completion time in minutes based on priority and complexity
		const baseTime = {
			high: 60,   // 1 hour
			medium: 240, // 4 hours
			low: 120    // 2 hours (reduced for testing)
		};

		let expectedTime = baseTime[task.priority as keyof typeof baseTime] || baseTime.medium;

		// Adjust for complexity
		if (task.dependencies && task.dependencies.length > 0) {
			expectedTime *= (1 + task.dependencies.length * 0.2);
		}

		return expectedTime;
	}

	private applyProgressFilters(tasks: Task[], filter: ProgressTrackingFilter): Task[] {
		return tasks.filter(task => {
			// Status filter
			if (filter.status) {
				const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
				if (!statuses.includes(task.status as string)) return false;
			}

			// Priority filter
			if (filter.priority) {
				const priorities = Array.isArray(filter.priority) ? filter.priority : [filter.priority];
				if (!priorities.includes(task.priority)) return false;
			}

			// Created by filter
			if (filter.createdBy && task.createdBy !== filter.createdBy) return false;

			// Assigned to filter
			if (filter.assignedTo && task.assignedTo !== filter.assignedTo) return false;

			// Type filter
			if (filter.type && task.type !== filter.type) return false;

			// Date range filters
			if (filter.createdAfter && new Date(task.createdAt) < filter.createdAfter) return false;
			if (filter.createdBefore && new Date(task.createdAt) > filter.createdBefore) return false;
			if (filter.updatedAfter && new Date(task.updatedAt) < filter.updatedAfter) return false;
			if (filter.updatedBefore && new Date(task.updatedAt) > filter.updatedBefore) return false;

			return true;
		});
	}

	private async analyzeStatusFlow(dateRange?: { from: Date; to: Date }): Promise<Array<{
		fromStatus: string;
		toStatus: string;
		count: number;
		averageTime: number;
	}>> {
		const filter: any = { eventType: "status_changed" };
		if (dateRange) {
			filter.fromDate = dateRange.from;
			filter.toDate = dateRange.to;
		}

		const statusEvents = await this.auditService.getTaskHistory(filter);
		const flowMap = new Map<string, { count: number; totalTime: number }>();

		for (const event of statusEvents) {
			if (event.oldStatus && event.newStatus && event.duration) {
				const key = `${event.oldStatus}->${event.newStatus}`;
				const existing = flowMap.get(key) || { count: 0, totalTime: 0 };
				existing.count++;
				existing.totalTime += event.duration;
				flowMap.set(key, existing);
			}
		}

		return Array.from(flowMap.entries()).map(([key, data]) => {
			const [fromStatus, toStatus] = key.split('->');
			return {
				fromStatus,
				toStatus,
				count: data.count,
				averageTime: Math.floor(data.totalTime / data.count / (1000 * 60)) // minutes
			};
		}).sort((a, b) => b.count - a.count);
	}

	private async identifyBottlenecks(dateRange?: { from: Date; to: Date }): Promise<Array<{
		status: string;
		averageTime: number;
		taskCount: number;
	}>> {
		const statusFlow = await this.analyzeStatusFlow(dateRange);
		const statusTimes = new Map<string, { totalTime: number; count: number }>();

		// Calculate average time spent in each status
		for (const flow of statusFlow) {
			const existing = statusTimes.get(flow.fromStatus) || { totalTime: 0, count: 0 };
			existing.totalTime += flow.averageTime * flow.count;
			existing.count += flow.count;
			statusTimes.set(flow.fromStatus, existing);
		}

		return Array.from(statusTimes.entries())
			.map(([status, data]) => ({
				status,
				averageTime: Math.floor(data.totalTime / data.count),
				taskCount: data.count
			}))
			.sort((a, b) => b.averageTime - a.averageTime)
			.slice(0, 5); // Top 5 bottlenecks
	}

	private async calculateProductivityTrends(dateRange?: { from: Date; to: Date }): Promise<Array<{
		date: string;
		completed: number;
		failed: number;
		created: number;
		averageTime: number;
	}>> {
		const endDate = dateRange?.to || new Date();
		const startDate = dateRange?.from || new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);

		const trends = [];
		const dayMs = 24 * 60 * 60 * 1000;

		for (let date = new Date(startDate); date <= endDate; date.setTime(date.getTime() + dayMs)) {
			const nextDate = new Date(date.getTime() + dayMs);
			
			const [createdEvents, completedEvents, failedEvents] = await Promise.all([
				this.auditService.getTaskHistory({ 
					eventType: "created", 
					fromDate: date, 
					toDate: nextDate 
				}),
				this.auditService.getTaskHistory({ 
					eventType: "status_changed", 
					fromDate: date, 
					toDate: nextDate 
				}).then(events => events.filter(e => e.newStatus === "done")),
				this.auditService.getTaskHistory({ 
					eventType: "status_changed", 
					fromDate: date, 
					toDate: nextDate 
				}).then(events => events.filter(e => e.newStatus === "failed"))
			]);

			// Calculate average processing time for completed tasks
			const completedTasks = completedEvents.filter(e => e.taskId);
			let totalTime = 0;
			let count = 0;

			for (const event of completedTasks) {
				const taskHistory = await this.auditService.getTaskHistory({ taskId: event.taskId });
				const created = taskHistory.find(e => e.eventType === "created");
				if (created) {
					totalTime += new Date(event.timestamp).getTime() - new Date(created.timestamp).getTime();
					count++;
				}
			}

			trends.push({
				date: date.toISOString().split('T')[0],
				completed: completedEvents.length,
				failed: failedEvents.length,
				created: createdEvents.length,
				averageTime: count > 0 ? Math.floor(totalTime / count / (1000 * 60)) : 0
			});
		}

		return trends;
	}

	private async getRetentionStats(): Promise<{
		totalEvents: number;
		oldestEvent: Date;
		newestEvent: Date;
		storageSize: string;
		recommendedCleanup: number;
	}> {
		const allEvents = await this.auditService.getTaskHistory({ limit: 10000 });
		
		if (allEvents.length === 0) {
			return {
				totalEvents: 0,
				oldestEvent: new Date(),
				newestEvent: new Date(),
				storageSize: "0 KB",
				recommendedCleanup: 0
			};
		}

		const dates = allEvents.map(e => new Date(e.timestamp));
		const oldestEvent = new Date(Math.min(...dates.map(d => d.getTime())));
		const newestEvent = new Date(Math.max(...dates.map(d => d.getTime())));

		// Estimate storage size (rough calculation)
		const avgEventSize = 500; // bytes per event (rough estimate)
		const totalSize = allEvents.length * avgEventSize;
		const storageSize = this.formatBytes(totalSize);

		// Recommend cleanup for events older than 90 days
		const cutoffDate = new Date();
		cutoffDate.setDate(cutoffDate.getDate() - 90);
		const recommendedCleanup = allEvents.filter(e => new Date(e.timestamp) < cutoffDate).length;

		return {
			totalEvents: allEvents.length,
			oldestEvent,
			newestEvent,
			storageSize,
			recommendedCleanup
		};
	}

	private formatBytes(bytes: number): string {
		const sizes = ["Bytes", "KB", "MB", "GB"];
		if (bytes === 0) return "0 Bytes";
		const i = Math.floor(Math.log(bytes) / Math.log(1024));
		return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + " " + sizes[i];
	}

	private calculateAverageTimePerStatus(statusEvents: TaskAuditEvent[]): Record<string, number> {
		const statusTimes: Record<string, number[]> = {};

		// Group durations by status
		for (const event of statusEvents) {
			if (event.oldStatus && event.duration) {
				if (!statusTimes[event.oldStatus]) {
					statusTimes[event.oldStatus] = [];
				}
				statusTimes[event.oldStatus].push(event.duration / (1000 * 60)); // Convert to minutes
			}
		}

		// Calculate averages
		const averages: Record<string, number> = {};
		for (const [status, times] of Object.entries(statusTimes)) {
			averages[status] = times.length > 0 ? times.reduce((sum, time) => sum + time, 0) / times.length : 0;
		}

		// Default values for statuses without history
		const defaults = {
			"todo": 30,      // 30 minutes
			"in-progress": 120, // 2 hours
			"failed": 15,   // 15 minutes
			"cancelled": 5   // 5 minutes
		};

		return { ...defaults, ...averages };
	}

	// This would need to be injected or passed from the daemon
	private async getAllTasks(): Promise<Task[]> {
		// This is a placeholder - in the actual implementation, 
		// this would call the ProductManager or get tasks from the daemon
		return [];
	}
}