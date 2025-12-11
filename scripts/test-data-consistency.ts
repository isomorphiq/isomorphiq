#!/usr/bin/env node

/**
 * Comprehensive test suite for data consistency across analytics endpoints
 * Tests data integrity between /api/tasks, /api/stats, /api/analytics, and tRPC endpoints
 */

import { ProductManager } from "../src/index";
import { startHttpApi } from "../src/http-api-server";
import type * as http from "node:http";

interface Task {
	id: string;
	title: string;
	description?: string;
	priority: "low" | "medium" | "high";
	status: "todo" | "in-progress" | "done";
	createdAt: string;
	updatedAt: string;
}

interface TasksData {
	tasks: Task[];
}

interface StatsData {
	stats: {
		total: number;
		byStatus: Record<string, number>;
		byPriority: Record<string, number>;
	};
}

interface AnalyticsData {
	analytics: {
		overview: {
			totalTasks: number;
			todoTasks: number;
			inProgressTasks: number;
			completedTasks: number;
			completionRate: number;
		};
		priority: Record<string, number>;
		performance: {
			productivityScore: string;
			totalActiveTasks: number;
		};
		timeline: Array<{
			date: string;
			created: number;
			completed: number;
		}>;
	};
}

interface QueueData {
	count: number;
	queue: Task[];
}

interface TestResult {
	name: string;
	passed: boolean;
	error?: string;
	duration: number;
}

class DataConsistencyTester {
	private pm: ProductManager;
	private server: http.Server | null = null;
	private baseUrl: string;
	private results: TestResult[] = [];

	constructor() {
		this.pm = new ProductManager();
		this.baseUrl = "http://localhost:3005"; // Use different port
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

	private async fetchEndpoint(endpoint: string): Promise<unknown> {
		const response = await fetch(`${this.baseUrl}${endpoint}`);
		if (!response.ok) {
			throw new Error(`Endpoint ${endpoint} failed: ${response.status}`);
		}
		return response.json();
	}

	private async fetchTRPC(endpoint: string): Promise<unknown> {
		const response = await fetch(`${this.baseUrl}/trpc${endpoint}`);
		if (!response.ok) {
			throw new Error(`tRPC ${endpoint} failed: ${response.status}`);
		}
		const data = await response.json();
		return data.result?.data || data;
	}

	async setup(): Promise<void> {
		this.server = await startHttpApi(this.pm, 3005);
		console.log("🚀 Consistency test server started on port 3005");
	}

	async cleanup(): Promise<void> {
		if (this.server) {
			this.server.close();
			console.log("🛑 Consistency test server stopped");
		}
	}

	async testBasicDataConsistency(): Promise<void> {
		await this.runTest("Basic data consistency across endpoints", async () => {
			// Fetch data from all endpoints
			const tasksData = (await this.fetchEndpoint("/api/tasks")) as TasksData;
			const statsData = (await this.fetchEndpoint("/api/stats")) as StatsData;
			const analyticsData = (await this.fetchEndpoint("/api/analytics")) as AnalyticsData;
			const trpcTasksData = (await this.fetchTRPC("/tasks")) as Task[];
			const _trpcQueueData = (await this.fetchTRPC("/queue")) as Task[];

			// Verify total tasks consistency
			const tasksCount = tasksData.tasks?.length || 0;
			const statsTotal = statsData.stats?.total || 0;
			const analyticsTotal = analyticsData.analytics?.overview?.totalTasks || 0;
			const trpcTasksCount = Array.isArray(trpcTasksData) ? trpcTasksData.length : 0;

			if (tasksCount !== statsTotal) {
				throw new Error(`Tasks count mismatch: /api/tasks=${tasksCount}, /api/stats=${statsTotal}`);
			}

			if (tasksCount !== analyticsTotal) {
				throw new Error(
					`Tasks count mismatch: /api/tasks=${tasksCount}, /api/analytics=${analyticsTotal}`,
				);
			}

			if (tasksCount !== trpcTasksCount) {
				throw new Error(
					`Tasks count mismatch: /api/tasks=${tasksCount}, tRPC/tasks=${trpcTasksCount}`,
				);
			}

			// Verify status breakdown consistency
			const tasksByStatus = {
				todo: tasksData.tasks?.filter((t: Task) => t.status === "todo").length || 0,
				"in-progress": tasksData.tasks?.filter((t: Task) => t.status === "in-progress").length || 0,
				done: tasksData.tasks?.filter((t: Task) => t.status === "done").length || 0,
			};

			const statsByStatus = statsData.stats?.byStatus || {};
			const analyticsByStatus = {
				todo: analyticsData.analytics?.overview?.todoTasks || 0,
				"in-progress": analyticsData.analytics?.overview?.inProgressTasks || 0,
				done: analyticsData.analytics?.overview?.completedTasks || 0,
			};

			for (const status of ["todo", "in-progress", "done"] as const) {
				if (tasksByStatus[status] !== statsByStatus[status]) {
					throw new Error(
						`Status ${status} mismatch: tasks=${tasksByStatus[status]}, stats=${statsByStatus[status]}`,
					);
				}
				if (tasksByStatus[status] !== analyticsByStatus[status]) {
					throw new Error(
						`Status ${status} mismatch: tasks=${tasksByStatus[status]}, analytics=${analyticsByStatus[status]}`,
					);
				}
			}

			// Verify priority breakdown consistency
			const tasksByPriority = {
				low: tasksData.tasks?.filter((t: Task) => t.priority === "low").length || 0,
				medium: tasksData.tasks?.filter((t: Task) => t.priority === "medium").length || 0,
				high: tasksData.tasks?.filter((t: Task) => t.priority === "high").length || 0,
			};

			const statsByPriority = statsData.stats?.byPriority || {};
			const analyticsByPriority = analyticsData.analytics?.priority || {};

			for (const priority of ["low", "medium", "high"] as const) {
				if (tasksByPriority[priority] !== statsByPriority[priority]) {
					throw new Error(
						`Priority ${priority} mismatch: tasks=${tasksByPriority[priority]}, stats=${statsByPriority[priority]}`,
					);
				}
				if (tasksByPriority[priority] !== analyticsByPriority[priority]) {
					throw new Error(
						`Priority ${priority} mismatch: tasks=${tasksByPriority[priority]}, analytics=${analyticsByPriority[priority]}`,
					);
				}
			}
		});
	}

	async testQueueConsistency(): Promise<void> {
		await this.runTest("Queue data consistency", async () => {
			const queueData = (await this.fetchEndpoint("/api/queue")) as QueueData;
			const trpcQueueData = (await this.fetchTRPC("/queue")) as Task[];
			const tasksData = (await this.fetchEndpoint("/api/tasks")) as TasksData;

			// Verify queue count consistency
			const queueCount = queueData.count || 0;
			const trpcQueueCount = Array.isArray(trpcQueueData) ? trpcQueueData.length : 0;

			if (queueCount !== trpcQueueCount) {
				throw new Error(
					`Queue count mismatch: /api/queue=${queueCount}, tRPC/queue=${trpcQueueCount}`,
				);
			}

			// Verify queue contains only todo tasks
			const todoTasks = tasksData.tasks?.filter((t: Task) => t.status === "todo") || [];
			const expectedQueueCount = todoTasks.length;

			if (queueCount !== expectedQueueCount) {
				throw new Error(
					`Queue should contain only todo tasks: expected=${expectedQueueCount}, actual=${queueCount}`,
				);
			}

			// Verify queue ordering (priority then creation date)
			if (queueData.queue && Array.isArray(queueData.queue)) {
				const priorityWeight = { high: 0, medium: 1, low: 2 };

				for (let i = 1; i < queueData.queue.length; i++) {
					const prev = queueData.queue[i - 1];
					const curr = queueData.queue[i];

					if (!prev || !curr) continue;

					const prevWeight = priorityWeight[prev.priority as keyof typeof priorityWeight];
					const currWeight = priorityWeight[curr.priority as keyof typeof priorityWeight];

					if (prevWeight > currWeight) {
						throw new Error("Queue not properly sorted by priority");
					}

					if (prevWeight === currWeight) {
						const prevDate = new Date(prev.createdAt).getTime();
						const currDate = new Date(curr.createdAt).getTime();

						if (prevDate > currDate) {
							throw new Error("Queue not properly sorted by creation date within same priority");
						}
					}
				}
			}
		});
	}

	async testAnalyticsCalculations(): Promise<void> {
		await this.runTest("Analytics calculation accuracy", async () => {
			const tasksData = (await this.fetchEndpoint("/api/tasks")) as TasksData;
			const analyticsData = (await this.fetchEndpoint("/api/analytics")) as AnalyticsData;

			const tasks = tasksData.tasks || [];
			const totalTasks = tasks.length;
			const completedTasks = tasks.filter((t: Task) => t.status === "done").length;

			// Verify completion rate calculation
			const expectedCompletionRate =
				totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
			const actualCompletionRate = analyticsData.analytics?.overview?.completionRate || 0;

			if (actualCompletionRate !== expectedCompletionRate) {
				throw new Error(
					`Completion rate calculation error: expected=${expectedCompletionRate}, actual=${actualCompletionRate}`,
				);
			}

			// Verify productivity score calculation
			const now = new Date();
			const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
			const tomorrow = new Date(today);
			tomorrow.setDate(tomorrow.getDate() + 1);

			const todayCompleted = tasks.filter((t: Task) => {
				if (t.status !== "done") return false;
				const taskDate = new Date(t.updatedAt);
				return taskDate >= today && taskDate < tomorrow;
			}).length;

			const expectedProductivityScore =
				totalTasks > 0
					? Math.min(100, Math.round((completedTasks / totalTasks) * 100 + todayCompleted * 10))
					: 0;

			const actualProductivityScoreStr =
				analyticsData.analytics?.performance?.productivityScore || "0%";
			const actualProductivityScore = parseInt(actualProductivityScoreStr.replace("%", ""), 10);

			if (actualProductivityScore !== expectedProductivityScore) {
				throw new Error(
					`Productivity score calculation error: expected=${expectedProductivityScore}, actual=${actualProductivityScore}`,
				);
			}

			// Verify active tasks calculation
			const inProgressTasks = tasks.filter((t: Task) => t.status === "in-progress").length;
			const todoTasks = tasks.filter((t: Task) => t.status === "todo").length;
			const expectedActiveTasks = inProgressTasks + todoTasks;

			const actualActiveTasks = analyticsData.analytics?.performance?.totalActiveTasks || 0;

			if (actualActiveTasks !== expectedActiveTasks) {
				throw new Error(
					`Active tasks calculation error: expected=${expectedActiveTasks}, actual=${actualActiveTasks}`,
				);
			}
		});
	}

	async testTimelineConsistency(): Promise<void> {
		await this.runTest("Timeline data consistency", async () => {
			const tasksData = (await this.fetchEndpoint("/api/tasks")) as TasksData;
			const analyticsData = (await this.fetchEndpoint("/api/analytics")) as AnalyticsData;

			const tasks = tasksData.tasks || [];
			const timeline = analyticsData.analytics?.timeline || [];

			if (!Array.isArray(timeline) || timeline.length !== 30) {
				throw new Error("Timeline should have exactly 30 days of data");
			}

			// Verify timeline calculations for each day
			for (const dayData of timeline) {
				const date = new Date(dayData.date);
				const nextDate = new Date(date);
				nextDate.setDate(nextDate.getDate() + 1);

				const dayCreated = tasks.filter((t: Task) => {
					const taskDate = new Date(t.createdAt);
					return taskDate >= date && taskDate < nextDate;
				}).length;

				const dayCompleted = tasks.filter((t: Task) => {
					if (t.status !== "done") return false;
					const taskDate = new Date(t.updatedAt);
					return taskDate >= date && taskDate < nextDate;
				}).length;

				if (dayData.created !== dayCreated) {
					throw new Error(
						`Timeline created count mismatch for ${dayData.date}: expected=${dayCreated}, actual=${dayData.created}`,
					);
				}

				if (dayData.completed !== dayCompleted) {
					throw new Error(
						`Timeline completed count mismatch for ${dayData.date}: expected=${dayCompleted}, actual=${dayData.completed}`,
					);
				}
			}
		});
	}

	async testFilteringConsistency(): Promise<void> {
		await this.runTest("Filtering endpoint consistency", async () => {
			const allTasksData = (await this.fetchEndpoint("/api/tasks")) as TasksData;
			const highPriorityData = (await this.fetchEndpoint("/api/tasks/priority/high")) as {
				count: number;
			};
			const mediumPriorityData = (await this.fetchEndpoint("/api/tasks/priority/medium")) as {
				count: number;
			};
			const lowPriorityData = (await this.fetchEndpoint("/api/tasks/priority/low")) as {
				count: number;
			};
			const todoStatusData = (await this.fetchEndpoint("/api/tasks/status/todo")) as {
				count: number;
			};
			const inProgressStatusData = (await this.fetchEndpoint("/api/tasks/status/in-progress")) as {
				count: number;
			};
			const doneStatusData = (await this.fetchEndpoint("/api/tasks/status/done")) as {
				count: number;
			};

			const allTasks = allTasksData.tasks || [];

			// Verify priority filtering
			const highPriorityTasks = allTasks.filter((t: Task) => t.priority === "high");
			const mediumPriorityTasks = allTasks.filter((t: Task) => t.priority === "medium");
			const lowPriorityTasks = allTasks.filter((t: Task) => t.priority === "low");

			if (highPriorityData.count !== highPriorityTasks.length) {
				throw new Error(
					`High priority filter mismatch: endpoint=${highPriorityData.count}, calculated=${highPriorityTasks.length}`,
				);
			}

			if (mediumPriorityData.count !== mediumPriorityTasks.length) {
				throw new Error(
					`Medium priority filter mismatch: endpoint=${mediumPriorityData.count}, calculated=${mediumPriorityTasks.length}`,
				);
			}

			if (lowPriorityData.count !== lowPriorityTasks.length) {
				throw new Error(
					`Low priority filter mismatch: endpoint=${lowPriorityData.count}, calculated=${lowPriorityTasks.length}`,
				);
			}

			// Verify status filtering
			const todoTasks = allTasks.filter((t: Task) => t.status === "todo");
			const inProgressTasks = allTasks.filter((t: Task) => t.status === "in-progress");
			const doneTasks = allTasks.filter((t: Task) => t.status === "done");

			if (todoStatusData.count !== todoTasks.length) {
				throw new Error(
					`Todo status filter mismatch: endpoint=${todoStatusData.count}, calculated=${todoTasks.length}`,
				);
			}

			if (inProgressStatusData.count !== inProgressTasks.length) {
				throw new Error(
					`In-progress status filter mismatch: endpoint=${inProgressStatusData.count}, calculated=${inProgressTasks.length}`,
				);
			}

			if (doneStatusData.count !== doneTasks.length) {
				throw new Error(
					`Done status filter mismatch: endpoint=${doneStatusData.count}, calculated=${doneTasks.length}`,
				);
			}

			// Verify that filtered counts sum to total
			const totalByPriority =
				highPriorityTasks.length + mediumPriorityTasks.length + lowPriorityTasks.length;
			const totalByStatus = todoTasks.length + inProgressTasks.length + doneTasks.length;

			if (totalByPriority !== allTasks.length) {
				throw new Error(
					`Priority filtered tasks don't sum to total: ${totalByPriority} vs ${allTasks.length}`,
				);
			}

			if (totalByStatus !== allTasks.length) {
				throw new Error(
					`Status filtered tasks don't sum to total: ${totalByStatus} vs ${allTasks.length}`,
				);
			}
		});
	}

	async testRealTimeDataConsistency(): Promise<void> {
		await this.runTest("Real-time data consistency", async () => {
			// Create a test task
			const createResponse = await fetch(`${this.baseUrl}/api/tasks`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					title: "Consistency Test Task",
					description: "Task for testing data consistency",
					priority: "medium",
				}),
			});

			if (!createResponse.ok) {
				throw new Error("Failed to create test task");
			}

			const createData = await createResponse.json();
			const taskId = createData.task.id;

			try {
				// Wait a moment for data to propagate
				await new Promise((resolve) => setTimeout(resolve, 100));

				// Verify task appears in all endpoints
				const tasksData = (await this.fetchEndpoint("/api/tasks")) as TasksData;
				const _statsData = (await this.fetchEndpoint("/api/stats")) as StatsData;
				const _analyticsData = (await this.fetchEndpoint("/api/analytics")) as AnalyticsData;
				const trpcTasksData = (await this.fetchTRPC("/tasks")) as Task[];

				const taskInTasks = tasksData.tasks?.some((t: Task) => t.id === taskId);
				const taskInTRPC = trpcTasksData?.some((t: Task) => t.id === taskId);

				if (!taskInTasks) {
					throw new Error("New task not found in /api/tasks endpoint");
				}

				if (!taskInTRPC) {
					throw new Error("New task not found in tRPC/tasks endpoint");
				}

				// Update task status
				const updateResponse = await fetch(`${this.baseUrl}/api/tasks/${taskId}/status`, {
					method: "PUT",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ status: "in-progress" }),
				});

				if (!updateResponse.ok) {
					throw new Error("Failed to update task status");
				}

				// Wait for propagation
				await new Promise((resolve) => setTimeout(resolve, 100));

				// Verify status update is reflected
				const updatedTasksData = (await this.fetchEndpoint("/api/tasks")) as TasksData;
				const updatedStatsData = (await this.fetchEndpoint("/api/stats")) as StatsData;
				const updatedAnalyticsData = (await this.fetchEndpoint("/api/analytics")) as AnalyticsData;

				const updatedTask = updatedTasksData.tasks?.find((t: Task) => t.id === taskId);

				if (!updatedTask || updatedTask.status !== "in-progress") {
					throw new Error("Task status update not reflected in endpoints");
				}

				// Verify counts are updated
				const inProgressCount =
					updatedTasksData.tasks?.filter((t: Task) => t.status === "in-progress").length || 0;
				const statsInProgress = updatedStatsData.stats?.byStatus?.["in-progress"] || 0;
				const analyticsInProgress = updatedAnalyticsData.analytics?.overview?.inProgressTasks || 0;

				if (inProgressCount !== statsInProgress) {
					throw new Error("In-progress count mismatch between tasks and stats endpoints");
				}

				if (inProgressCount !== analyticsInProgress) {
					throw new Error("In-progress count mismatch between tasks and analytics endpoints");
				}
			} finally {
				// Cleanup test task
				try {
					await fetch(`${this.baseUrl}/api/tasks/${taskId}`, { method: "DELETE" });
				} catch (_error) {
					// Ignore cleanup errors
				}
			}
		});
	}

	async runAllTests(): Promise<void> {
		console.log("🧪 Starting Data Consistency Tests\n");

		try {
			await this.setup();

			await this.testBasicDataConsistency();
			await this.testQueueConsistency();
			await this.testAnalyticsCalculations();
			await this.testTimelineConsistency();
			await this.testFilteringConsistency();
			await this.testRealTimeDataConsistency();
		} finally {
			await this.cleanup();
		}

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
const tester = new DataConsistencyTester();
tester.runAllTests().catch((error) => {
	console.error("Test execution failed:", error);
	process.exit(1);
});

export { DataConsistencyTester };
