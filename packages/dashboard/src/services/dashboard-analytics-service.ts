import type { Task, TaskServiceApi } from "@isomorphiq/tasks";
import { ProgressTrackingService, type ProgressAnalytics, type ProgressTrackingFilter, type TaskProgressMetrics, type RetentionPolicy } from "./progress-tracking-service.ts";
import { TaskAuditService } from "./task-audit-service.ts";
import type { IncomingMessage, ServerResponse } from "node:http";

export interface DashboardAnalyticsRequest {
	type: "progress_overview" | "task_progress" | "productivity_trends" | "performance_metrics" | "retention_stats" | "apply_retention";
	filters?: ProgressTrackingFilter;
	dateRange?: { from: string; to: string };
	retentionPolicy?: RetentionPolicy;
}

export interface DashboardAnalyticsResponse {
	success: boolean;
	data?: any;
	error?: string;
	timestamp: string;
}

type TaskManager = Pick<TaskServiceApi, "getAllTasks">;

/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class DashboardAnalyticsService {
    private taskManager: TaskManager;
    private progressService: ProgressTrackingService;
    private auditService: TaskAuditService;

    constructor(taskManager: TaskManager, auditService?: TaskAuditService) {
        this.taskManager = taskManager;
        this.auditService = auditService || new TaskAuditService();
        this.progressService = new ProgressTrackingService(this.auditService);
    }

	async initialize(): Promise<void> {
		await this.progressService.initialize();
		console.log("[ANALYTICS] Dashboard analytics service initialized");
	}

	// Main analytics endpoint handler
	async handleAnalyticsRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
		try {
			const url = new URL(req.url || "", `http://${req.headers.host}`);
			const pathParts = url.pathname.split('/').filter(p => p);

			if (pathParts[0] !== "api" || pathParts[1] !== "analytics") {
				this.serve404(res);
				return;
			}

			const analyticsType = pathParts[2];
			const result = await this.processAnalyticsRequest(analyticsType, url);

			res.writeHead(result.success ? 200 : 400, { "Content-Type": "application/json" });
			res.end(JSON.stringify(result));
		} catch (error) {
			console.error("[ANALYTICS] Error handling request:", error);
			res.writeHead(500, { "Content-Type": "application/json" });
			res.end(JSON.stringify({
				success: false,
				error: error instanceof Error ? error.message : "Internal server error",
				timestamp: new Date().toISOString()
			}));
		}
	}

	// Process specific analytics requests
	async processAnalyticsRequest(type: string, url: URL): Promise<DashboardAnalyticsResponse> {
		const timestamp = new Date().toISOString();

		try {
			switch (type) {
				case "progress-overview": {
					const dateRange = this.parseDateRange(url);
					const analytics = await this.getProgressOverview(dateRange);
					return {
						success: true,
						data: analytics,
						timestamp
					};
				}

				case "task-progress": {
					const filters = this.parseProgressFilters(url);
					const progress = await this.getTasksProgress(filters);
					return {
						success: true,
						data: progress,
						timestamp
					};
				}

				case "productivity-trends": {
					const dateRange = this.parseDateRange(url);
					const trends = await this.getProductivityTrends(dateRange);
					return {
						success: true,
						data: trends,
						timestamp
					};
				}

				case "performance-metrics": {
					const dateRange = this.parseDateRange(url);
					const metrics = await this.getPerformanceMetrics(dateRange);
					return {
						success: true,
						data: metrics,
						timestamp
					};
				}

				case "retention-stats": {
					const stats = await this.getRetentionStatistics();
					return {
						success: true,
						data: stats,
						timestamp
					};
				}

				case "apply-retention": {
					const policy = this.parseRetentionPolicy(url);
					const result = await this.applyRetentionPolicy(policy);
					return {
						success: true,
						data: result,
						timestamp
					};
				}

				case "dashboard-summary": {
					const summary = await this.getDashboardSummary();
					return {
						success: true,
						data: summary,
						timestamp
					};
				}

				default:
					return {
						success: false,
						error: `Unknown analytics type: ${type}`,
						timestamp
					};
			}
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : "Unknown error",
				timestamp
			};
		}
	}

    private async loadTasks(): Promise<Task[]> {
        const result = await this.taskManager.getAllTasks();
        if (!result.success || !result.data) {
            return [];
        }
        return result.data;
    }

	// Get comprehensive progress overview
	async getProgressOverview(dateRange?: { from: Date; to: Date }): Promise<ProgressAnalytics> {
		const allTasks = await this.loadTasks();
		const filteredTasks = this.applyDateRangeFilter(allTasks, dateRange);
		
		return await this.progressService.getProgressAnalytics(filteredTasks, dateRange);
	}

	// Get detailed progress for specific tasks
	async getTasksProgress(filters: ProgressTrackingFilter): Promise<TaskProgressMetrics[]> {
		const allTasks = await this.loadTasks();
		
		// Update progress service with all tasks
		// Note: This is a workaround since progress service doesn't have direct access to tasks
		// In a full implementation, we'd pass tasks directly to the service
		return await this.progressService.getTasksProgress(allTasks, filters);
	}

	// Get productivity trends
	async getProductivityTrends(dateRange?: { from: Date; to: Date }): Promise<any> {
		const allTasks = await this.loadTasks();
		const filteredTasks = this.applyDateRangeFilter(allTasks, dateRange);
		
		const analytics = await this.progressService.getProgressAnalytics(filteredTasks, dateRange);
		
		return {
			trends: analytics.productivityTrends,
			completionRate: analytics.completionRate,
			averageProcessingTime: analytics.averageProcessingTime,
			overdueTasksCount: analytics.overdueTasksCount,
			highRiskTasksCount: analytics.highRiskTasksCount
		};
	}

	// Get performance metrics
	async getPerformanceMetrics(dateRange?: { from: Date; to: Date }): Promise<any> {
		const allTasks = await this.loadTasks();
		const filteredTasks = this.applyDateRangeFilter(allTasks, dateRange);
		
		const analytics = await this.progressService.getProgressAnalytics(filteredTasks, dateRange);
		
		return {
			performanceDistribution: analytics.performanceDistribution,
			statusFlow: analytics.statusFlow,
			bottlenecks: analytics.bottlenecks,
			overallMetrics: {
				totalTasks: analytics.totalTasks,
				completionRate: analytics.completionRate,
				averageProcessingTime: analytics.averageProcessingTime,
				averageTaskAge: analytics.averageTaskAge
			}
		};
	}

	// Get retention statistics
	async getRetentionStatistics(): Promise<any> {
		const allTasks = await this.loadTasks();
		const analytics = await this.progressService.getProgressAnalytics(allTasks);
		
		return {
			retention: analytics.retentionStats,
			recommendations: this.generateRetentionRecommendations(analytics.retentionStats)
		};
	}

	// Apply retention policy
	async applyRetentionPolicy(policy: RetentionPolicy): Promise<any> {
		const result = await this.progressService.applyRetentionPolicy(policy);
		
		return {
			policyApplied: !policy.dryRun,
			result: {
				deletedEvents: result.deletedCount,
				keptEvents: result.keptCount,
				totalProcessed: result.totalProcessed
			},
			summaries: result.summaries,
			impact: this.calculateRetentionImpact(result)
		};
	}

	// Get comprehensive dashboard summary
	async getDashboardSummary(): Promise<any> {
		const allTasks = await this.loadTasks();
		const progressAnalytics = await this.progressService.getProgressAnalytics(allTasks);
		
		// Get recent activity
		const recentEvents = await this.auditService.getTaskHistory({ 
			limit: 50,
			fromDate: new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
		});

		// Get system health
		const systemHealth = await this.getSystemHealth();

		// Get alerts/warnings
		const alerts = await this.generateAlerts(allTasks, progressAnalytics);

		return {
			overview: {
				totalTasks: allTasks.length,
				completedTasks: allTasks.filter(t => (t.status as string) === "done").length,
				failedTasks: allTasks.filter(t => (t.status as string) === "failed").length,
				inProgressTasks: allTasks.filter(t => (t.status as string) === "in-progress").length,
				completionRate: progressAnalytics.completionRate
			},
			performance: {
				averageProcessingTime: progressAnalytics.averageProcessingTime,
				overdueTasks: progressAnalytics.overdueTasksCount,
				highRiskTasks: progressAnalytics.highRiskTasksCount,
				performanceDistribution: progressAnalytics.performanceDistribution
			},
			activity: {
				recentEvents: recentEvents.length,
				eventsByType: this.groupEventsByType(recentEvents),
				activityTrend: progressAnalytics.productivityTrends.slice(-7) // Last 7 days
			},
			system: systemHealth,
			alerts,
			timestamp: new Date().toISOString()
		};
	}

	// Private helper methods
	private parseDateRange(url: URL): { from: Date; to: Date } | undefined {
		const fromParam = url.searchParams.get("from");
		const toParam = url.searchParams.get("to");

		if (!fromParam && !toParam) return undefined;

		const now = new Date();
		const from = fromParam ? new Date(fromParam) : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
		const to = toParam ? new Date(toParam) : now;

		return { from, to };
	}

	private parseProgressFilters(url: URL): ProgressTrackingFilter {
		const filters: ProgressTrackingFilter = {};

		// Basic filters
		if (url.searchParams.has("status")) {
			const statusParam = url.searchParams.get("status")!;
			filters.status = statusParam.includes(',') ? statusParam.split(',') : statusParam;
		}

		if (url.searchParams.has("priority")) {
			const priorityParam = url.searchParams.get("priority")!;
			filters.priority = priorityParam.includes(',') ? priorityParam.split(',') : priorityParam;
		}

		if (url.searchParams.has("createdBy")) {
			filters.createdBy = url.searchParams.get("createdBy")!;
		}

		if (url.searchParams.has("assignedTo")) {
			filters.assignedTo = url.searchParams.get("assignedTo")!;
		}

		if (url.searchParams.has("type")) {
			filters.type = url.searchParams.get("type")!;
		}

		// Date filters
		if (url.searchParams.has("createdAfter")) {
			filters.createdAfter = new Date(url.searchParams.get("createdAfter")!);
		}

		if (url.searchParams.has("createdBefore")) {
			filters.createdBefore = new Date(url.searchParams.get("createdBefore")!);
		}

		if (url.searchParams.has("updatedAfter")) {
			filters.updatedAfter = new Date(url.searchParams.get("updatedAfter")!);
		}

		if (url.searchParams.has("updatedBefore")) {
			filters.updatedBefore = new Date(url.searchParams.get("updatedBefore")!);
		}

		// Special filters
		if (url.searchParams.has("overdueOnly")) {
			filters.overdueOnly = url.searchParams.get("overdueOnly") === "true";
		}

		if (url.searchParams.has("minProgress")) {
			filters.minProgress = parseInt(url.searchParams.get("minProgress")!);
		}

		if (url.searchParams.has("maxProgress")) {
			filters.maxProgress = parseInt(url.searchParams.get("maxProgress")!);
		}

		if (url.searchParams.has("minPerformanceScore")) {
			filters.minPerformanceScore = parseInt(url.searchParams.get("minPerformanceScore")!);
		}

		// Pagination
		if (url.searchParams.has("limit")) {
			filters.limit = parseInt(url.searchParams.get("limit")!);
		}

		if (url.searchParams.has("offset")) {
			filters.offset = parseInt(url.searchParams.get("offset")!);
		}

		return filters;
	}

	private parseRetentionPolicy(url: URL): RetentionPolicy {
		return {
			olderThanDays: parseInt(url.searchParams.get("olderThanDays") || "90"),
			keepHighPriorityTasks: url.searchParams.get("keepHighPriorityTasks") !== "false",
			keepFailedTasks: url.searchParams.get("keepFailedTasks") !== "false",
			keepTasksWithDependencies: url.searchParams.get("keepTasksWithDependencies") !== "false",
			minEventsPerTask: parseInt(url.searchParams.get("minEventsPerTask") || "5"),
			maxEventsPerTask: parseInt(url.searchParams.get("maxEventsPerTask") || "100"),
			dryRun: url.searchParams.get("dryRun") === "true"
		};
	}

	private applyDateRangeFilter(tasks: Task[], dateRange?: { from: Date; to: Date }): Task[] {
		if (!dateRange) return tasks;

		return tasks.filter(task => {
			const created = new Date(task.createdAt);
			const updated = new Date(task.updatedAt);

			if (dateRange.from && created < dateRange.from) return false;
			if (dateRange.to && updated > dateRange.to) return false;

			return true;
		});
	}

	private groupEventsByType(events: any[]): Record<string, number> {
		const grouped: Record<string, number> = {};
		for (const event of events) {
			grouped[event.eventType] = (grouped[event.eventType] || 0) + 1;
		}
		return grouped;
	}

	private async getSystemHealth(): Promise<any> {
		const memUsage = process.memoryUsage();
		const uptime = process.uptime();

		return {
			memory: {
				used: memUsage.heapUsed,
				total: memUsage.heapTotal,
				external: memUsage.external,
				usagePercent: Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100)
			},
			uptime: {
				seconds: uptime,
				human: this.formatUptime(uptime)
			},
			process: {
				pid: process.pid,
				nodeVersion: process.version,
				platform: process.platform
			}
		};
	}

	private async generateAlerts(tasks: Task[], analytics: ProgressAnalytics): Promise<any[]> {
		const alerts = [];

		// High number of overdue tasks
		if (analytics.overdueTasksCount > 10) {
			alerts.push({
				type: "warning",
				title: "High Number of Overdue Tasks",
				message: `${analytics.overdueTasksCount} tasks are overdue`,
				severity: "high"
			});
		}

		// Low completion rate
		if (analytics.completionRate < 50 && tasks.length > 10) {
			alerts.push({
				type: "warning",
				title: "Low Completion Rate",
				message: `Only ${Math.round(analytics.completionRate)}% of tasks are completed`,
				severity: "medium"
			});
		}

		// Storage retention alert
		if (analytics.retentionStats.recommendedCleanup > 1000) {
			alerts.push({
				type: "info",
				title: "Database Cleanup Recommended",
				message: `${analytics.retentionStats.recommendedCleanup} old events can be cleaned up`,
				severity: "low"
			});
		}

		// Performance bottlenecks
		const majorBottlenecks = analytics.bottlenecks.filter(b => b.averageTime > 60); // > 1 hour
		if (majorBottlenecks.length > 0) {
			alerts.push({
				type: "warning",
				title: "Performance Bottlenecks Detected",
				message: `${majorBottlenecks.length} workflow stages are taking longer than expected`,
				severity: "medium"
			});
		}

		return alerts;
	}

	private generateRetentionRecommendations(retentionStats: any): string[] {
		const recommendations = [];

		if (retentionStats.totalEvents > 10000) {
			recommendations.push("Consider implementing automated cleanup for events older than 90 days");
		}

		if (retentionStats.recommendedCleanup > retentionStats.totalEvents * 0.5) {
			recommendations.push("More than 50% of audit events can be safely cleaned up");
		}

		const daysSinceOldest = (Date.now() - retentionStats.oldestEvent.getTime()) / (1000 * 60 * 60 * 24);
		if (daysSinceOldest > 365) {
			recommendations.push("Audit data exists for over a year - consider long-term archival strategy");
		}

		return recommendations;
	}

	private calculateRetentionImpact(result: any): any {
		const diskSpaceSaved = result.deletedCount * 500; // Rough estimate
		const performanceImprovement = Math.min(50, (result.deletedCount / Math.max(result.totalProcessed, 1)) * 100);

		return {
			diskSpaceSaved: this.formatBytes(diskSpaceSaved),
			estimatedPerformanceGain: `${Math.round(performanceImprovement)}%`,
			queriesAffected: result.summaries.length
		};
	}

	private formatUptime(seconds: number): string {
		const days = Math.floor(seconds / (24 * 60 * 60));
		const hours = Math.floor((seconds % (24 * 60 * 60)) / (60 * 60));
		const minutes = Math.floor((seconds % (60 * 60)) / 60);

		return `${days}d ${hours}h ${minutes}m`;
	}

	private formatBytes(bytes: number): string {
		const sizes = ["Bytes", "KB", "MB", "GB"];
		if (bytes === 0) return "0 Bytes";
		const i = Math.floor(Math.log(bytes) / Math.log(1024));
		return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + " " + sizes[i];
	}

	private serve404(res: ServerResponse): void {
		res.writeHead(404, { "Content-Type": "application/json" });
		res.end(JSON.stringify({
			success: false,
			error: "Analytics endpoint not found",
			timestamp: new Date().toISOString()
		}));
	}
}
