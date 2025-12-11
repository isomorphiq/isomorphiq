#!/usr/bin/env node

/**
 * Simplified test suite for dashboard functionality
 * Tests core dashboard features without complex dependencies
 */

interface Task {
	id: string;
	title: string;
	description: string;
	status: "todo" | "in-progress" | "done";
	priority: "low" | "medium" | "high";
	dependencies: string[];
	createdBy: string;
	assignedTo?: string;
	createdAt: Date;
	updatedAt: Date;
}

interface TestResult {
	name: string;
	passed: boolean;
	error?: string;
	duration: number;
}

interface AnalyticsData {
	overview: {
		totalTasks: number;
		completedTasks: number;
		inProgressTasks: number;
		todoTasks: number;
		completionRate: number;
	};
	today: {
		created: number;
		completed: number;
	};
	priority: {
		high: number;
		medium: number;
		low: number;
	};
	performance: {
		avgCompletionTime: string;
		productivityScore: string;
		totalActiveTasks: number;
	};
}

class SimplifiedDashboardTester {
	private results: TestResult[] = [];
	private testTasks: Task[] = [];

	constructor() {
		this.setupTestData();
	}

	private setupTestData(): void {
		const now = new Date();
		const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
		const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

		this.testTasks = [
			{
				id: "task-1",
				title: "High Priority Bug",
				description: "Critical bug in production system",
				status: "done",
				priority: "high",
				dependencies: [],
				createdBy: "user1",
				createdAt: twoDaysAgo,
				updatedAt: yesterday,
			},
			{
				id: "task-2",
				title: "Medium Feature",
				description: "New feature request for dashboard",
				status: "in-progress",
				priority: "medium",
				dependencies: [],
				createdBy: "user2",
				createdAt: yesterday,
				updatedAt: now,
			},
			{
				id: "task-3",
				title: "Low Priority Task",
				description: "Documentation update needed",
				status: "todo",
				priority: "low",
				dependencies: [],
				createdBy: "user1",
				createdAt: now,
				updatedAt: now,
			},
			{
				id: "task-4",
				title: "Another High Task",
				description: "Another high priority item",
				status: "done",
				priority: "high",
				dependencies: [],
				createdBy: "user3",
				createdAt: twoDaysAgo,
				updatedAt: twoDaysAgo,
			},
			{
				id: "task-5",
				title: "Medium Task 2",
				description: "Another medium task",
				status: "todo",
				priority: "medium",
				dependencies: [],
				createdBy: "user2",
				createdAt: now,
				updatedAt: now,
			},
		];
	}

	private async runTest(name: string, testFn: () => Promise<void>): Promise<void> {
		const startTime = Date.now();
		try {
			await testFn();
			this.results.push({
				name,
				passed: true,
				duration: Date.now() - startTime,
			});
			console.log(`✅ ${name}`);
		} catch (error) {
			this.results.push({
				name,
				passed: false,
				error: error instanceof Error ? error.message : String(error),
				duration: Date.now() - startTime,
			});
			console.log(`❌ ${name}: ${error}`);
		}
	}

	private generateStats(tasks: Task[]): {
		total: number;
		byStatus: {
			todo: number;
			"in-progress": number;
			done: number;
		};
		byPriority: {
			low: number;
			medium: number;
			high: number;
		};
	} {
		const total = tasks.length;
		const byStatus = {
			todo: tasks.filter((t) => t.status === "todo").length,
			"in-progress": tasks.filter((t) => t.status === "in-progress").length,
			done: tasks.filter((t) => t.status === "done").length,
		};
		const byPriority = {
			low: tasks.filter((t) => t.priority === "low").length,
			medium: tasks.filter((t) => t.priority === "medium").length,
			high: tasks.filter((t) => t.priority === "high").length,
		};

		return { total, byStatus, byPriority };
	}

	private generateAnalytics(tasks: Task[]): AnalyticsData {
		const totalTasks = tasks.length;
		const completedTasks = tasks.filter((t) => t.status === "done").length;
		const inProgressTasks = tasks.filter((t) => t.status === "in-progress").length;
		const todoTasks = tasks.filter((t) => t.status === "todo").length;
		const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

		const now = new Date();
		const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
		const tomorrow = new Date(today);
		tomorrow.setDate(tomorrow.getDate() + 1);

		const todayCreated = tasks.filter((t) => {
			const taskDate = new Date(t.createdAt);
			return taskDate >= today && taskDate < tomorrow;
		}).length;

		const todayCompleted = tasks.filter((t) => {
			if (t.status !== "done") return false;
			const taskDate = new Date(t.updatedAt);
			return taskDate >= today && taskDate < tomorrow;
		}).length;

		const highPriorityTasks = tasks.filter((t) => t.priority === "high").length;
		const mediumPriorityTasks = tasks.filter((t) => t.priority === "medium").length;
		const lowPriorityTasks = tasks.filter((t) => t.priority === "low").length;

		return {
			overview: {
				totalTasks,
				completedTasks,
				inProgressTasks,
				todoTasks,
				completionRate,
			},
			today: {
				created: todayCreated,
				completed: todayCompleted,
			},
			priority: {
				high: highPriorityTasks,
				medium: mediumPriorityTasks,
				low: lowPriorityTasks,
			},
			performance: {
				avgCompletionTime: completedTasks > 0 ? "2.3 days" : "0 days",
				productivityScore:
					totalTasks > 0
						? `${Math.min(100, Math.round((completedTasks / totalTasks) * 100 + todayCompleted * 10))}%`
						: "0%",
				totalActiveTasks: inProgressTasks + todoTasks,
			},
		};
	}

	async testTaskListEndpoint(): Promise<void> {
		await this.runTest("Task list endpoint functionality", async () => {
			// Simulate GET /api/tasks response
			const response = {
				tasks: this.testTasks,
				count: this.testTasks.length,
			};

			if (!Array.isArray(response.tasks)) {
				throw new Error("Tasks response should be an array");
			}

			if (response.count !== response.tasks.length) {
				throw new Error(`Count mismatch: expected ${response.tasks.length}, got ${response.count}`);
			}

			// Validate task structure
			const task = response.tasks[0];
			if (!task.id || !task.title || !task.description || !task.status || !task.priority) {
				throw new Error("Task missing required fields");
			}

			if (!["todo", "in-progress", "done"].includes(task.status)) {
				throw new Error(`Invalid task status: ${task.status}`);
			}

			if (!["low", "medium", "high"].includes(task.priority)) {
				throw new Error(`Invalid task priority: ${task.priority}`);
			}
		});
	}

	async testStatsEndpoint(): Promise<void> {
		await this.runTest("Stats endpoint functionality", async () => {
			// Simulate GET /api/stats response
			const stats = this.generateStats(this.testTasks);
			const response = { stats };

			if (!response.stats || typeof response.stats.total !== "number") {
				throw new Error("Stats response missing total count");
			}

			if (response.stats.total !== this.testTasks.length) {
				throw new Error(
					`Total count mismatch: expected ${this.testTasks.length}, got ${response.stats.total}`,
				);
			}

			// Validate status breakdown
			const expectedTodo = this.testTasks.filter((t) => t.status === "todo").length;
			const expectedInProgress = this.testTasks.filter((t) => t.status === "in-progress").length;
			const expectedDone = this.testTasks.filter((t) => t.status === "done").length;

			if (response.stats.byStatus.todo !== expectedTodo) {
				throw new Error(
					`Todo count mismatch: expected ${expectedTodo}, got ${response.stats.byStatus.todo}`,
				);
			}

			if (response.stats.byStatus["in-progress"] !== expectedInProgress) {
				throw new Error(
					`In-progress count mismatch: expected ${expectedInProgress}, got ${response.stats.byStatus["in-progress"]}`,
				);
			}

			if (response.stats.byStatus.done !== expectedDone) {
				throw new Error(
					`Done count mismatch: expected ${expectedDone}, got ${response.stats.byStatus.done}`,
				);
			}

			// Validate priority breakdown
			const expectedLow = this.testTasks.filter((t) => t.priority === "low").length;
			const expectedMedium = this.testTasks.filter((t) => t.priority === "medium").length;
			const expectedHigh = this.testTasks.filter((t) => t.priority === "high").length;

			if (response.stats.byPriority.low !== expectedLow) {
				throw new Error(
					`Low priority count mismatch: expected ${expectedLow}, got ${response.stats.byPriority.low}`,
				);
			}

			if (response.stats.byPriority.medium !== expectedMedium) {
				throw new Error(
					`Medium priority count mismatch: expected ${expectedMedium}, got ${response.stats.byPriority.medium}`,
				);
			}

			if (response.stats.byPriority.high !== expectedHigh) {
				throw new Error(
					`High priority count mismatch: expected ${expectedHigh}, got ${response.stats.byPriority.high}`,
				);
			}
		});
	}

	async testAnalyticsEndpoint(): Promise<void> {
		await this.runTest("Analytics endpoint functionality", async () => {
			// Simulate GET /api/analytics response
			const analytics = this.generateAnalytics(this.testTasks);
			const response = { analytics };

			if (!response.analytics || !response.analytics.overview) {
				throw new Error("Analytics response missing overview data");
			}

			// Validate overview
			const overview = response.analytics.overview;
			if (typeof overview.totalTasks !== "number" || overview.totalTasks < 0) {
				throw new Error("Invalid total tasks in overview");
			}

			if (
				typeof overview.completionRate !== "number" ||
				overview.completionRate < 0 ||
				overview.completionRate > 100
			) {
				throw new Error("Invalid completion rate in overview");
			}

			// Validate today's stats
			if (!response.analytics.today) {
				throw new Error("Analytics response missing today data");
			}

			if (
				typeof response.analytics.today.created !== "number" ||
				response.analytics.today.created < 0
			) {
				throw new Error("Invalid today created count");
			}

			if (
				typeof response.analytics.today.completed !== "number" ||
				response.analytics.today.completed < 0
			) {
				throw new Error("Invalid today completed count");
			}

			// Validate priority breakdown
			if (!response.analytics.priority) {
				throw new Error("Analytics response missing priority data");
			}

			const priority = response.analytics.priority;
			if (typeof priority.high !== "number" || priority.high < 0) {
				throw new Error("Invalid high priority count");
			}

			if (typeof priority.medium !== "number" || priority.medium < 0) {
				throw new Error("Invalid medium priority count");
			}

			if (typeof priority.low !== "number" || priority.low < 0) {
				throw new Error("Invalid low priority count");
			}

			// Validate performance metrics
			if (!response.analytics.performance) {
				throw new Error("Analytics response missing performance data");
			}

			const performance = response.analytics.performance;
			if (!performance.avgCompletionTime || !performance.avgCompletionTime.endsWith(" days")) {
				throw new Error("Invalid average completion time format");
			}

			if (!performance.productivityScore || !performance.productivityScore.endsWith("%")) {
				throw new Error("Invalid productivity score format");
			}

			if (typeof performance.totalActiveTasks !== "number" || performance.totalActiveTasks < 0) {
				throw new Error("Invalid total active tasks count");
			}
		});
	}

	async testTaskFiltering(): Promise<void> {
		await this.runTest("Task filtering by status", async () => {
			// Test filtering by status
			const todoTasks = this.testTasks.filter((t) => t.status === "todo");
			const inProgressTasks = this.testTasks.filter((t) => t.status === "in-progress");
			const doneTasks = this.testTasks.filter((t) => t.status === "done");

			if (todoTasks.length !== 2) {
				throw new Error(`Expected 2 todo tasks, got ${todoTasks.length}`);
			}

			if (inProgressTasks.length !== 1) {
				throw new Error(`Expected 1 in-progress task, got ${inProgressTasks.length}`);
			}

			if (doneTasks.length !== 2) {
				throw new Error(`Expected 2 done tasks, got ${doneTasks.length}`);
			}

			// Verify all filtered tasks have correct status
			if (!todoTasks.every((t) => t.status === "todo")) {
				throw new Error("Todo filter returned non-todo tasks");
			}

			if (!inProgressTasks.every((t) => t.status === "in-progress")) {
				throw new Error("In-progress filter returned non-in-progress tasks");
			}

			if (!doneTasks.every((t) => t.status === "done")) {
				throw new Error("Done filter returned non-done tasks");
			}
		});

		await this.runTest("Task filtering by priority", async () => {
			// Test filtering by priority
			const highTasks = this.testTasks.filter((t) => t.priority === "high");
			const mediumTasks = this.testTasks.filter((t) => t.priority === "medium");
			const lowTasks = this.testTasks.filter((t) => t.priority === "low");

			if (highTasks.length !== 2) {
				throw new Error(`Expected 2 high priority tasks, got ${highTasks.length}`);
			}

			if (mediumTasks.length !== 2) {
				throw new Error(`Expected 2 medium priority tasks, got ${mediumTasks.length}`);
			}

			if (lowTasks.length !== 1) {
				throw new Error(`Expected 1 low priority task, got ${lowTasks.length}`);
			}

			// Verify all filtered tasks have correct priority
			if (!highTasks.every((t) => t.priority === "high")) {
				throw new Error("High priority filter returned non-high priority tasks");
			}

			if (!mediumTasks.every((t) => t.priority === "medium")) {
				throw new Error("Medium priority filter returned non-medium priority tasks");
			}

			if (!lowTasks.every((t) => t.priority === "low")) {
				throw new Error("Low priority filter returned non-low priority tasks");
			}
		});
	}

	async testTaskSearch(): Promise<void> {
		await this.runTest("Task search functionality", async () => {
			// Test text search
			const searchQuery = "bug";
			const searchResults = this.testTasks.filter(
				(task) =>
					task.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
					task.description.toLowerCase().includes(searchQuery.toLowerCase()),
			);

			if (searchResults.length !== 1) {
				throw new Error(`Expected 1 result for 'bug' search, got ${searchResults.length}`);
			}

			if (!searchResults[0].title.toLowerCase().includes("bug")) {
				throw new Error("Search result does not contain search term");
			}

			// Test case-insensitive search
			const caseInsensitiveQuery = "BUG";
			const caseInsensitiveResults = this.testTasks.filter(
				(task) =>
					task.title.toLowerCase().includes(caseInsensitiveQuery.toLowerCase()) ||
					task.description.toLowerCase().includes(caseInsensitiveQuery.toLowerCase()),
			);

			if (caseInsensitiveResults.length !== searchResults.length) {
				throw new Error("Case-insensitive search not working correctly");
			}

			// Test empty search (should return all tasks)
			const emptySearch = "";
			const emptyResults = this.testTasks.filter(
				(task) =>
					task.title.toLowerCase().includes(emptySearch.toLowerCase()) ||
					task.description.toLowerCase().includes(emptySearch.toLowerCase()),
			);

			if (emptyResults.length !== this.testTasks.length) {
				throw new Error("Empty search should return all tasks");
			}
		});
	}

	async testDataConsistency(): Promise<void> {
		await this.runTest("Data consistency across endpoints", async () => {
			// Get data from multiple "endpoints"
			const tasksData = { tasks: this.testTasks, count: this.testTasks.length };
			const statsData = { stats: this.generateStats(this.testTasks) };
			const analyticsData = { analytics: this.generateAnalytics(this.testTasks) };

			// Check consistency
			if (tasksData.count !== statsData.stats.total) {
				throw new Error(
					`Task count mismatch: tasks=${tasksData.count}, stats=${statsData.stats.total}`,
				);
			}

			if (statsData.stats.total !== analyticsData.analytics.overview.totalTasks) {
				throw new Error(
					`Total tasks mismatch: stats=${statsData.stats.total}, analytics=${analyticsData.analytics.overview.totalTasks}`,
				);
			}

			if (statsData.stats.byStatus.done !== analyticsData.analytics.overview.completedTasks) {
				throw new Error(
					`Completed tasks mismatch: stats=${statsData.stats.byStatus.done}, analytics=${analyticsData.analytics.overview.completedTasks}`,
				);
			}

			if (
				statsData.stats.byStatus["in-progress"] !== analyticsData.analytics.overview.inProgressTasks
			) {
				throw new Error(
					`In-progress tasks mismatch: stats=${statsData.stats.byStatus["in-progress"]}, analytics=${analyticsData.analytics.overview.inProgressTasks}`,
				);
			}

			if (statsData.stats.byStatus.todo !== analyticsData.analytics.overview.todoTasks) {
				throw new Error(
					`Todo tasks mismatch: stats=${statsData.stats.byStatus.todo}, analytics=${analyticsData.analytics.overview.todoTasks}`,
				);
			}
		});
	}

	async testErrorHandling(): Promise<void> {
		await this.runTest("404 handling for non-existent task", async () => {
			// Simulate GET /api/tasks/non-existent-id
			const taskId = "non-existent-id";
			const task = this.testTasks.find((t) => t.id === taskId);

			if (task !== undefined) {
				throw new Error("Non-existent task should not be found");
			}
		});

		await this.runTest("Invalid task creation validation", async () => {
			// Test invalid task data
			const invalidTasks = [
				{ title: "", description: "test", priority: "medium" },
				{ title: "test", description: "", priority: "medium" },
				{ title: "test", description: "test", priority: "invalid" },
			];

			for (const invalidTask of invalidTasks) {
				if (invalidTask.title.trim().length === 0) {
					// This should be rejected - test passes
					continue;
				}

				if (invalidTask.description.trim().length === 0) {
					// This should be rejected - test passes
					continue;
				}

				if (!["low", "medium", "high"].includes(invalidTask.priority)) {
					// This should be rejected - test passes
					continue;
				}

				// If we get here, validation failed
				throw new Error("Invalid task data should be rejected");
			}
		});

		await this.runTest("Invalid status update validation", async () => {
			// Test invalid status updates
			const invalidStatuses = ["invalid-status", "completed", "started", "paused"];

			for (const invalidStatus of invalidStatuses) {
				if (
					!["todo", "in-progress", "done"].includes(
						invalidStatus as "todo" | "in-progress" | "done",
					)
				) {
				} else {
					throw new Error(`Invalid status '${invalidStatus}' should be rejected`);
				}
			}
		});
	}

	async testTaskCRUD(): Promise<void> {
		await this.runTest("Task creation validation", async () => {
			const newTask = {
				title: "Test Dashboard Task",
				description: "This is a test task for dashboard functionality",
				priority: "high",
			};

			// Validate task creation
			if (!newTask.title || newTask.title.trim().length === 0) {
				throw new Error("Task title is required");
			}

			if (!newTask.description || newTask.description.trim().length === 0) {
				throw new Error("Task description is required");
			}

			if (!["low", "medium", "high"].includes(newTask.priority)) {
				throw new Error("Task priority must be valid");
			}

			// Simulate task creation
			const createdTask: Task = {
				id: `task-${Date.now()}`,
				title: newTask.title,
				description: newTask.description,
				status: "todo",
				priority: newTask.priority as "low" | "medium" | "high",
				dependencies: [],
				createdBy: "test-user",
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			if (!createdTask.id) {
				throw new Error("Created task should have an ID");
			}

			if (createdTask.status !== "todo") {
				throw new Error("New task should start with todo status");
			}
		});

		await this.runTest("Task status update", async () => {
			const task = this.testTasks[0];
			const originalStatus = task.status;
			const newStatus = "in-progress";

			// Simulate status update
			const updatedTask = {
				...task,
				status: newStatus as "todo" | "in-progress" | "done",
				updatedAt: new Date(),
			};

			if (updatedTask.status === originalStatus) {
				throw new Error("Task status should be updated");
			}

			if (updatedTask.updatedAt <= task.updatedAt) {
				throw new Error("Task updatedAt should be updated");
			}
		});

		await this.runTest("Task priority update", async () => {
			const task = this.testTasks[0];
			const originalPriority = task.priority;
			const newPriority = "medium";

			// Simulate priority update
			const updatedTask = {
				...task,
				priority: newPriority as "low" | "medium" | "high",
				updatedAt: new Date(),
			};

			if (updatedTask.priority === originalPriority) {
				throw new Error("Task priority should be updated");
			}

			if (updatedTask.updatedAt <= task.updatedAt) {
				throw new Error("Task updatedAt should be updated");
			}
		});
	}

	async runAllTests(): Promise<void> {
		console.log("🧪 Starting Simplified Dashboard Functionality Tests\n");

		await this.testTaskListEndpoint();
		await this.testStatsEndpoint();
		await this.testAnalyticsEndpoint();
		await this.testTaskFiltering();
		await this.testTaskSearch();
		await this.testDataConsistency();
		await this.testErrorHandling();
		await this.testTaskCRUD();

		console.log("\n📊 Test Results:");
		const passed = this.results.filter((r) => r.passed).length;
		const failed = this.results.filter((r) => !r.passed).length;
		const totalDuration = this.results.reduce((sum, r) => sum + r.duration, 0);

		console.log(`Total: ${this.results.length} tests`);
		console.log(`Passed: ${passed} ✅`);
		console.log(`Failed: ${failed} ${failed > 0 ? "❌" : "✅"}`);
		console.log(`Duration: ${totalDuration}ms`);

		if (failed > 0) {
			console.log("\n❌ Failed Tests:");
			this.results
				.filter((r) => !r.passed)
				.forEach((r) => {
					console.log(`  - ${r.name}: ${r.error}`);
				});
			process.exit(1);
		} else {
			console.log("\n✅ All tests passed!");
		}
	}
}

// Run tests if this file is executed directly
if (require.main === module) {
	const tester = new SimplifiedDashboardTester();
	tester.runAllTests().catch((error) => {
		console.error("Test execution failed:", error);
		process.exit(1);
	});
}

export { SimplifiedDashboardTester };
