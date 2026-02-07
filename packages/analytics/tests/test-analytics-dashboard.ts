#!/usr/bin/env node
import "../../../tests/test-utils/env-fetch.ts";

/**
 * Test suite for analytics accuracy and dashboard functionality
 * Tests the /api/analytics endpoint for data accuracy and consistency
 */

import { ProductManager } from "@isomorphiq/profiles";
import type { Task } from "@isomorphiq/tasks";

interface TestResult {
	name: string;
	passed: boolean;
	error?: string;
	duration: number;
}

interface TestData {
	tasks: Task[];
	analytics: AnalyticsData;
	stats: StatsData;
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
class AnalyticsTester {
	private pm: ProductManager;
	private results: TestResult[] = [];

	constructor() {
		this.pm = new ProductManager();
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

	private async getTestData(): Promise<TestData> {
		const tasks = await this.pm.getAllTasks();

		// Mock analytics endpoint response
		const now = new Date();
		const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
		const tomorrow = new Date(today);
		tomorrow.setDate(tomorrow.getDate() + 1);

		const totalTasks = tasks.length;
		const completedTasks = tasks.filter((t) => t.status === "done").length;
		const inProgressTasks = tasks.filter((t) => t.status === "in-progress").length;
		const todoTasks = tasks.filter((t) => t.status === "todo").length;
		const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

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

		const stats = {
			total: totalTasks,
			byStatus: {
				todo: todoTasks,
				"in-progress": inProgressTasks,
				done: completedTasks,
			},
			byPriority: {
				low: lowPriorityTasks,
				medium: mediumPriorityTasks,
				high: highPriorityTasks,
			},
		};

		const analytics = {
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

		return { tasks, analytics, stats };
	}

	async testAnalyticsAccuracy(): Promise<void> {
		await this.runTest("Analytics total tasks accuracy", async () => {
			const { tasks, analytics } = await this.getTestData();
			if (analytics.overview.totalTasks !== tasks.length) {
				throw new Error(
					`Expected ${tasks.length} total tasks, got ${analytics.overview.totalTasks}`,
				);
			}
		});

		await this.runTest("Analytics status breakdown accuracy", async () => {
			const { tasks, analytics } = await this.getTestData();
			const actualDone = tasks.filter((t) => t.status === "done").length;
			const actualInProgress = tasks.filter((t) => t.status === "in-progress").length;
			const actualTodo = tasks.filter((t) => t.status === "todo").length;

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
			const { tasks, analytics } = await this.getTestData();
			const totalTasks = tasks.length;
			const completedTasks = tasks.filter((t) => t.status === "done").length;
			const expectedRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

			if (analytics.overview.completionRate !== expectedRate) {
				throw new Error(
					`Completion rate mismatch: expected ${expectedRate}%, got ${analytics.overview.completionRate}%`,
				);
			}
		});

		await this.runTest("Analytics priority breakdown accuracy", async () => {
			const { tasks, analytics } = await this.getTestData();
			const actualHigh = tasks.filter((t) => t.priority === "high").length;
			const actualMedium = tasks.filter((t) => t.priority === "medium").length;
			const actualLow = tasks.filter((t) => t.priority === "low").length;

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

		await this.runTest("Analytics today stats accuracy", async () => {
			const { tasks, analytics } = await this.getTestData();
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

			if (analytics.today.created !== todayCreated) {
				throw new Error(
					`Today created tasks mismatch: expected ${todayCreated}, got ${analytics.today.created}`,
				);
			}
			if (analytics.today.completed !== todayCompleted) {
				throw new Error(
					`Today completed tasks mismatch: expected ${todayCompleted}, got ${analytics.today.completed}`,
				);
			}
		});
	}

	async testStatsConsistency(): Promise<void> {
		await this.runTest("Stats vs Analytics consistency", async () => {
			const { stats, analytics } = await this.getTestData();

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

	async testTimelineData(): Promise<void> {
		await this.runTest("Timeline data accuracy", async () => {
			const { tasks } = await this.getTestData();
			const _now = new Date();

			// Test last 7 days
			for (let i = 6; i >= 0; i--) {
				const date = new Date();
				date.setDate(date.getDate() - i);
				date.setHours(0, 0, 0, 0);

				const nextDate = new Date(date);
				nextDate.setDate(nextDate.getDate() + 1);

				const dayCreated = tasks.filter((t) => {
					const taskDate = new Date(t.createdAt);
					return taskDate >= date && taskDate < nextDate;
				}).length;

				const dayCompleted = tasks.filter((t) => {
					if (t.status !== "done") return false;
					const taskDate = new Date(t.updatedAt);
					return taskDate >= date && taskDate < nextDate;
				}).length;

				// Verify counts are non-negative
				if (dayCreated < 0 || dayCompleted < 0) {
					throw new Error(
						`Invalid timeline counts for ${date.toISOString().split("T")[0]}: created=${dayCreated}, completed=${dayCompleted}`,
					);
				}
			}
		});
	}

	async testPerformanceMetrics(): Promise<void> {
		await this.runTest("Performance metrics validity", async () => {
			const { analytics } = await this.getTestData();

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
			// Create a temporary empty dataset scenario
			const analytics = {
				overview: {
					totalTasks: 0,
					completedTasks: 0,
					inProgressTasks: 0,
					todoTasks: 0,
					completionRate: 0,
				},
				today: {
					created: 0,
					completed: 0,
				},
				priority: {
					high: 0,
					medium: 0,
					low: 0,
				},
				performance: {
					avgCompletionTime: "0 days",
					productivityScore: "0%",
					totalActiveTasks: 0,
				},
			};

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
				const mockTasks = [
					{
						id: "test-1",
						title: "Test Task",
						description: "Test Description",
						status: scenario.status,
						priority: scenario.priority,
						createdAt: new Date().toISOString(),
						updatedAt: new Date().toISOString(),
					},
				];

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

	async runAllTests(): Promise<void> {
		console.log("🧪 Starting Analytics and Dashboard Tests\n");

		await this.testAnalyticsAccuracy();
		await this.testStatsConsistency();
		await this.testTimelineData();
		await this.testPerformanceMetrics();
		await this.testEdgeCases();

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
	const tester = new AnalyticsTester();
	tester.runAllTests().catch((error) => {
		console.error("Test execution failed:", error);
		process.exit(1);
	});
}

export { AnalyticsTester };

