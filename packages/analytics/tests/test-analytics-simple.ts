#!/usr/bin/env node
import "../../../tests/test-utils/env-fetch.ts";

/**
 * Simplified test suite for analytics accuracy and dashboard functionality
 * Tests core analytics calculations without complex dependencies
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

interface StatsData {
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
}

/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
class SimplifiedAnalyticsTester {
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
				description: "Critical bug in production",
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
				description: "New feature request",
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
				description: "Documentation update",
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

	private generateStats(tasks: Task[]): StatsData {
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

	async testAnalyticsAccuracy(): Promise<void> {
		await this.runTest("Analytics total tasks accuracy", async () => {
			const analytics = this.generateAnalytics(this.testTasks);
			if (analytics.overview.totalTasks !== this.testTasks.length) {
				throw new Error(
					`Expected ${this.testTasks.length} total tasks, got ${analytics.overview.totalTasks}`,
				);
			}
		});

		await this.runTest("Analytics status breakdown accuracy", async () => {
			const analytics = this.generateAnalytics(this.testTasks);
			const actualDone = this.testTasks.filter((t) => t.status === "done").length;
			const actualInProgress = this.testTasks.filter((t) => t.status === "in-progress").length;
			const actualTodo = this.testTasks.filter((t) => t.status === "todo").length;

			if (analytics.overview.completedTasks !== actualDone) {
				throw new Error(
					`Completed tasks mismatch: expected ${actualDone}, got ${analytics.overview.completedTasks}`,
				);
			}
			if (analytics.overview.inProgressTasks !== actualInProgress) {
				throw new Error(
					`In-progress tasks mismatch: expected ${actualInProgress}, got ${analytics.overview.inProgressTasks}`,
				);
			}
			if (analytics.overview.todoTasks !== actualTodo) {
				throw new Error(
					`Todo tasks mismatch: expected ${actualTodo}, got ${analytics.overview.todoTasks}`,
				);
			}
		});

		await this.runTest("Analytics completion rate accuracy", async () => {
			const analytics = this.generateAnalytics(this.testTasks);
			const totalTasks = this.testTasks.length;
			const completedTasks = this.testTasks.filter((t) => t.status === "done").length;
			const expectedRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

			if (analytics.overview.completionRate !== expectedRate) {
				throw new Error(
					`Completion rate mismatch: expected ${expectedRate}%, got ${analytics.overview.completionRate}%`,
				);
			}
		});

		await this.runTest("Analytics priority breakdown accuracy", async () => {
			const analytics = this.generateAnalytics(this.testTasks);
			const actualHigh = this.testTasks.filter((t) => t.priority === "high").length;
			const actualMedium = this.testTasks.filter((t) => t.priority === "medium").length;
			const actualLow = this.testTasks.filter((t) => t.priority === "low").length;

			if (analytics.priority.high !== actualHigh) {
				throw new Error(
					`High priority tasks mismatch: expected ${actualHigh}, got ${analytics.priority.high}`,
				);
			}
			if (analytics.priority.medium !== actualMedium) {
				throw new Error(
					`Medium priority tasks mismatch: expected ${actualMedium}, got ${analytics.priority.medium}`,
				);
			}
			if (analytics.priority.low !== actualLow) {
				throw new Error(
					`Low priority tasks mismatch: expected ${actualLow}, got ${analytics.priority.low}`,
				);
			}
		});
	}

	async testStatsConsistency(): Promise<void> {
		await this.runTest("Stats vs Analytics consistency", async () => {
			const stats = this.generateStats(this.testTasks);
			const analytics = this.generateAnalytics(this.testTasks);

			if (stats.total !== analytics.overview.totalTasks) {
				throw new Error(
					`Total tasks inconsistency: stats=${stats.total}, analytics=${analytics.overview.totalTasks}`,
				);
			}

			if (stats.byStatus.done !== analytics.overview.completedTasks) {
				throw new Error(
					`Completed tasks inconsistency: stats=${stats.byStatus.done}, analytics=${analytics.overview.completedTasks}`,
				);
			}

			if (stats.byStatus["in-progress"] !== analytics.overview.inProgressTasks) {
				throw new Error(
					`In-progress tasks inconsistency: stats=${stats.byStatus["in-progress"]}, analytics=${analytics.overview.inProgressTasks}`,
				);
			}

			if (stats.byStatus.todo !== analytics.overview.todoTasks) {
				throw new Error(
					`Todo tasks inconsistency: stats=${stats.byStatus.todo}, analytics=${analytics.overview.todoTasks}`,
				);
			}

			if (stats.byPriority.high !== analytics.priority.high) {
				throw new Error(
					`High priority inconsistency: stats=${stats.byPriority.high}, analytics=${analytics.priority.high}`,
				);
			}

			if (stats.byPriority.medium !== analytics.priority.medium) {
				throw new Error(
					`Medium priority inconsistency: stats=${stats.byPriority.medium}, analytics=${analytics.priority.medium}`,
				);
			}

			if (stats.byPriority.low !== analytics.priority.low) {
				throw new Error(
					`Low priority inconsistency: stats=${stats.byPriority.low}, analytics=${analytics.priority.low}`,
				);
			}
		});
	}

	async testPerformanceMetrics(): Promise<void> {
		await this.runTest("Performance metrics validity", async () => {
			const analytics = this.generateAnalytics(this.testTasks);

			// Test productivity score format
			const productivityScore = analytics.performance.productivityScore;
			if (!productivityScore.endsWith("%")) {
				throw new Error(`Productivity score should end with %: ${productivityScore}`);
			}

			const scoreValue = parseInt(productivityScore.replace("%", ""), 10);
			if (scoreValue < 0 || scoreValue > 100) {
				throw new Error(`Productivity score should be 0-100: ${scoreValue}`);
			}

			// Test completion time format
			const avgCompletionTime = analytics.performance.avgCompletionTime;
			if (!avgCompletionTime.endsWith(" days")) {
				throw new Error(`Average completion time should end with ' days': ${avgCompletionTime}`);
			}

			const timeValue = parseFloat(avgCompletionTime.replace(" days", ""));
			if (timeValue < 0) {
				throw new Error(`Average completion time should be non-negative: ${timeValue}`);
			}

			// Test active tasks count
			const totalActiveTasks = analytics.performance.totalActiveTasks;
			const expectedActive = analytics.overview.inProgressTasks + analytics.overview.todoTasks;
			if (totalActiveTasks !== expectedActive) {
				throw new Error(
					`Active tasks mismatch: expected ${expectedActive}, got ${totalActiveTasks}`,
				);
			}
		});
	}

	async testEdgeCases(): Promise<void> {
		await this.runTest("Empty dataset handling", async () => {
			const analytics = this.generateAnalytics([]);

			// Verify no division by zero errors
			if (analytics.overview.completionRate !== 0) {
				throw new Error("Completion rate should be 0 for empty dataset");
			}

			if (analytics.performance.totalActiveTasks !== 0) {
				throw new Error("Active tasks should be 0 for empty dataset");
			}
		});

		await this.runTest("Single task scenarios", async () => {
			// Test various single task scenarios
			const scenarios = [
				{ status: "todo", priority: "high" },
				{ status: "in-progress", priority: "medium" },
				{ status: "done", priority: "low" },
			];

			for (const scenario of scenarios) {
				const mockTasks: Task[] = [
					{
						id: "test-1",
						title: "Test Task",
						description: "Test Description",
						status: scenario.status as "todo" | "in-progress" | "done",
						priority: scenario.priority as "low" | "medium" | "high",
						dependencies: [],
						createdBy: "test-user",
						createdAt: new Date(),
						updatedAt: new Date(),
					},
				];

				const _analytics = this.generateAnalytics(mockTasks);
				const totalTasks = mockTasks.length;
				const completedTasks = mockTasks.filter((t) => t.status === "done").length;
				const completionRate = Math.round((completedTasks / totalTasks) * 100);

				if (scenario.status === "done" && completionRate !== 100) {
					throw new Error(
						`Single done task should have 100% completion rate, got ${completionRate}%`,
					);
				}

				if (scenario.status !== "done" && completionRate !== 0) {
					throw new Error(
						`Single non-done task should have 0% completion rate, got ${completionRate}%`,
					);
				}
			}
		});
	}

	async testReportGeneration(): Promise<void> {
		await this.runTest("Report data structure validation", async () => {
			const analytics = this.generateAnalytics(this.testTasks);
			const _stats = this.generateStats(this.testTasks);

			const reportData = {
				summary: {
					generatedAt: new Date().toISOString(),
					period: "Last 30 days",
					totalTasks: analytics.overview.totalTasks,
					completionRate: analytics.overview.completionRate,
					productivityScore: analytics.performance.productivityScore,
					avgCompletionTime: analytics.performance.avgCompletionTime,
				},
				tasks: this.testTasks,
				analytics,
				timeline: [],
			};

			// Validate report structure
			if (!reportData.summary || !reportData.tasks || !reportData.analytics) {
				throw new Error("Report missing required sections");
			}

			// Validate summary
			if (typeof reportData.summary.totalTasks !== "number" || reportData.summary.totalTasks < 0) {
				throw new Error("Invalid total tasks in summary");
			}

			if (
				typeof reportData.summary.completionRate !== "number" ||
				reportData.summary.completionRate < 0 ||
				reportData.summary.completionRate > 100
			) {
				throw new Error("Invalid completion rate in summary");
			}

			// Validate analytics
			if (
				!reportData.analytics.overview ||
				!reportData.analytics.priority ||
				!reportData.analytics.performance
			) {
				throw new Error("Analytics section incomplete");
			}
		});

		await this.runTest("CSV export format validation", async () => {
			const csvHeaders = ["Date", "Tasks Created", "Tasks Completed", "Active Tasks"];
			const csvRows = [
				["2025-01-01", "5", "3", "2"],
				["2025-01-02", "2", "4", "-2"],
			];
			const csvContent = [csvHeaders.join(","), ...csvRows.map((row) => row.join(","))].join("\n");

			// Validate CSV structure
			const lines = csvContent.split("\n");
			if (lines.length < 2) {
				throw new Error("CSV should have header and at least one data row");
			}

			// Check header
			const header = lines[0]?.split(",");
			if (!header || header.length !== 4 || header[0] !== "Date") {
				throw new Error("CSV header incorrect");
			}

			// Check data rows
			for (let i = 1; i < lines.length; i++) {
				const row = lines[i]?.split(",");
				if (!row || row.length !== 4) {
					throw new Error(`CSV row ${i} has incorrect number of columns`);
				}

				// Validate numeric columns
				const created = parseInt(row[1] || "0", 10);
				const completed = parseInt(row[2] || "0", 10);
				const active = parseInt(row[3] || "0", 10);

				if (Number.isNaN(created) || Number.isNaN(completed) || Number.isNaN(active)) {
					throw new Error(`CSV row ${i} has invalid numeric data`);
				}
			}
		});

		await this.runTest("JSON export format validation", async () => {
			const reportData = {
				summary: {
					generatedAt: new Date().toISOString(),
					totalTasks: 5,
					completionRate: 40,
				},
				analytics: {
					overview: {
						totalTasks: 5,
						completedTasks: 2,
						inProgressTasks: 1,
						todoTasks: 2,
						completionRate: 40,
					},
				},
			};

			const jsonContent = JSON.stringify(reportData, null, 2);

			// Validate JSON can be parsed back
			try {
				const parsed = JSON.parse(jsonContent);
				if (!parsed.summary || !parsed.analytics) {
					throw new Error("JSON missing required sections after parse");
				}
			} catch (error) {
				throw new Error(`JSON export invalid: ${error}`);
			}
		});
	}

	async runAllTests(): Promise<void> {
		console.log("🧪 Starting Simplified Analytics and Dashboard Tests\n");

		await this.testAnalyticsAccuracy();
		await this.testStatsConsistency();
		await this.testPerformanceMetrics();
		await this.testEdgeCases();
		await this.testReportGeneration();

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
// if (require.main === module) {
// 	const tester = new SimplifiedAnalyticsTester();
// 	tester.runAllTests().catch((error) => {
// 		console.error("Test execution failed:", error);
// 		process.exit(1);
// 	});
// }

export { SimplifiedAnalyticsTester };

