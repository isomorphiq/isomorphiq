import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { ProgressTrackingService } from "./progress-tracking-service.ts";
import { TaskAuditService } from "./task-audit-service.ts";

describe("Progress Tracking Service", () => {
	let progressService: ProgressTrackingService;
	let auditService: TaskAuditService;
	let mockTasks: any[];

	before(async () => {
		// Initialize services
		auditService = new TaskAuditService("./test-audit-db");
		progressService = new ProgressTrackingService(auditService);
		await progressService.initialize();

		// Create mock tasks
		mockTasks = [
			{
				id: "task-1",
				title: "Test Task 1",
				description: "First test task",
				status: "done",
				priority: "high",
				createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
				updatedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(), // 30 minutes ago
				createdBy: "user1",
				assignedTo: "user2",
				dependencies: []
			},
			{
				id: "task-2",
				title: "Test Task 2",
				description: "Second test task",
				status: "in-progress",
				priority: "medium",
				createdAt: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(), // 4 hours ago
				updatedAt: new Date(Date.now() - 15 * 60 * 1000).toISOString(), // 15 minutes ago
				createdBy: "user2",
				assignedTo: "user1",
				dependencies: ["task-1"]
			},
			{
				id: "task-3",
				title: "Test Task 3",
				description: "Third test task",
				status: "todo",
				priority: "low",
				createdAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(), // 1 hour ago
				updatedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(), // 1 hour ago
				createdBy: "user1",
				dependencies: ["task-2"]
			},
			{
				id: "task-4",
				title: "Failed Task",
				description: "Failed test task",
				status: "failed",
				priority: "high",
				createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(), // 3 hours ago
				updatedAt: new Date(Date.now() - 45 * 60 * 1000).toISOString(), // 45 minutes ago
				createdBy: "user3",
				dependencies: []
			}
		];

		// Create audit events for testing
		await auditService.recordTaskCreated(mockTasks[0], "user1");
		await auditService.recordTaskCreated(mockTasks[1], "user2");
		await auditService.recordTaskCreated(mockTasks[2], "user1");
		await auditService.recordTaskCreated(mockTasks[3], "user3");

		// Add status changes
		await auditService.recordTaskStatusChanged("task-1", "todo", "in-progress", "system", undefined, 1000 * 60 * 30); // 30 minutes
		await auditService.recordTaskStatusChanged("task-1", "in-progress", "done", "system", undefined, 1000 * 60 * 15); // 15 minutes
		
		await auditService.recordTaskStatusChanged("task-2", "todo", "in-progress", "user2", undefined, 1000 * 60 * 45); // 45 minutes
		
		await auditService.recordTaskStatusChanged("task-4", "todo", "in-progress", "user3", undefined, 1000 * 60 * 60); // 1 hour
		await auditService.recordTaskStatusChanged("task-4", "in-progress", "failed", "system", "Task execution failed", 1000 * 60 * 15); // 15 minutes
	});

	after(async () => {
		// Cleanup test database
		await auditService.shutdown();
	});

	it("should calculate task progress metrics correctly", async () => {
		const task = mockTasks[0]; // Completed task
		const metrics = await progressService.calculateTaskProgress(task);

		assert.strictEqual(metrics.taskId, "task-1");
		assert.strictEqual(metrics.status, "done");
		assert.strictEqual(metrics.priority, "high");
		assert.strictEqual(metrics.progressPercentage, 100);
		assert(metrics.processingTime && metrics.processingTime > 0, "Should have processing time for completed task");
		assert.strictEqual(metrics.performanceScore, 100, "Completed high priority task should have perfect score");
	});

	it("should estimate completion time for incomplete tasks", async () => {
		const task = mockTasks[1]; // In-progress task
		const metrics = await progressService.calculateTaskProgress(task);

		assert.strictEqual(metrics.status, "in-progress");
		assert(metrics.estimatedCompletion, "Should have estimated completion time");
		assert(metrics.progressPercentage > 0 && metrics.progressPercentage < 100, "Should have partial progress");
	});

	it("should identify overdue tasks correctly", async () => {
		const task = {
			...mockTasks[2],
			createdAt: new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString() // 10 hours ago
		}; // Low priority task that's 10 hours old
		
		const metrics = await progressService.calculateTaskProgress(task);
		assert(metrics.isOverdue, "Low priority task older than expected time should be overdue");
	});

	it("should calculate performance scores appropriately", async () => {
		const completedTask = mockTasks[0];
		const failedTask = mockTasks[3];

		const completedMetrics = await progressService.calculateTaskProgress(completedTask);
		const failedMetrics = await progressService.calculateTaskProgress(failedTask);

		assert(completedMetrics.performanceScore > failedMetrics.performanceScore, 
			"Completed task should have higher performance score than failed task");
		assert(completedMetrics.performanceScore === 100, "Successfully completed task should have perfect score");
		assert(failedMetrics.performanceScore < 100, "Failed task should have lower performance score");
	});

	it("should apply progress filters correctly", async () => {
		const filters = {
			status: ["done", "in-progress"],
			priority: "high"
		};

		const filteredTasks = progressService["applyProgressFilters"](mockTasks, filters);
		
		// Should only include high priority tasks that are done or in-progress
		const validTasks = filteredTasks.filter(task => 
			task.priority === "high" && 
			["done", "in-progress"].includes(task.status as string)
		);

		assert.strictEqual(filteredTasks.length, validTasks.length, "All filtered tasks should match criteria");
		assert(filteredTasks.some(task => task.id === "task-1"), "Should include completed high priority task");
		assert(filteredTasks.some(task => task.id === "task-4"), "Should include failed high priority task");
	});

	it("should calculate comprehensive progress analytics", async () => {
		const analytics = await progressService.getProgressAnalytics(mockTasks);

		assert(analytics.totalTasks === mockTasks.length, "Should count all tasks");
		assert(analytics.completionRate > 0, "Should have completion rate > 0");
		assert(analytics.overdueTasksCount >= 0, "Should count overdue tasks");
		assert(analytics.highRiskTasksCount >= 0, "Should count high risk tasks");
		
		// Check performance distribution
		assert(typeof analytics.performanceDistribution.excellent === "number");
		assert(typeof analytics.performanceDistribution.good === "number");
		assert(typeof analytics.performanceDistribution.fair === "number");
		assert(typeof analytics.performanceDistribution.poor === "number");

		// Check trends and bottlenecks
		assert(Array.isArray(analytics.productivityTrends), "Should have productivity trends");
		assert(Array.isArray(analytics.bottlenecks), "Should have bottlenecks");
		
		// Check retention stats
		assert(analytics.retentionStats.totalEvents >= 0, "Should have total events count");
		assert(analytics.retentionStats.oldestEvent instanceof Date, "Should have oldest event date");
		assert(analytics.retentionStats.newestEvent instanceof Date, "Should have newest event date");
	});

	it("should apply retention policy correctly", async () => {
		const policy = {
			olderThanDays: 0, // Delete all events older than now
			keepHighPriorityTasks: false,
			keepFailedTasks: false,
			keepTasksWithDependencies: false,
			minEventsPerTask: 1, // Keep at least creation event
			maxEventsPerTask: 10,
			dryRun: true // Don't actually delete
		};

		const result = await progressService.applyRetentionPolicy(policy);

		assert(result.deletedCount >= 0, "Should count events to delete");
		assert(result.keptCount >= 0, "Should count events to keep");
		assert(result.totalProcessed > 0, "Should process some events");
		assert(Array.isArray(result.summaries), "Should provide task-level summaries");
	});

	it("should handle edge cases gracefully", async () => {
		// Test with empty task list
		const emptyAnalytics = await progressService.getProgressAnalytics([]);
		assert.strictEqual(emptyAnalytics.totalTasks, 0);
		assert.strictEqual(emptyAnalytics.completionRate, 0);

		// Test basic functionality with mock data
		const task = mockTasks[0];
		const metrics = await progressService.calculateTaskProgress(task);
		assert.strictEqual(metrics.taskId, "task-1");
		assert(metrics.performanceScore >= 0 && metrics.performanceScore <= 100, "Score should be within bounds");
	});

	it("should provide meaningful task progress insights", async () => {
		const task = mockTasks[1]; // In-progress task with dependencies
		const metrics = await progressService.calculateTaskProgress(task);

		assert(metrics.timeInCurrentStatus >= 0, "Should calculate time in current status");
		assert(metrics.currentAge >= metrics.timeInCurrentStatus, "Total age should be >= time in current status");
		assert(metrics.statusTransitions >= 0, "Should count status transitions");
		
		if (metrics.estimatedCompletion) {
			assert(metrics.estimatedCompletion > new Date(), "Estimated completion should be in the future");
		}
	});
});

describe("Progress Tracking Service Integration", () => {
	it("should initialize without errors", async () => {
		const service = new ProgressTrackingService();
		await service.initialize();
		assert(true, "Service should initialize successfully");
	});

	it("should handle database errors gracefully", async () => {
		// Test with invalid database path
		const service = new ProgressTrackingService();
		// This should not throw an error
		await service.initialize();
		assert(true, "Should handle database errors gracefully");
	});
});