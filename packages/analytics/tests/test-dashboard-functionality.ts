#!/usr/bin/env node
import "../../../tests/test-utils/env-fetch.ts";

/**
 * Test suite for dashboard functionality and UI components
 * Tests the web dashboard components, state management, and real-time updates
 */

import { ProductManager } from "@isomorphiq/user-profile";
import { startHttpServer } from "@isomorphiq/http-server";

interface TestResult {
	name: string;
	passed: boolean;
	error?: string;
	duration: number;
}

/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
class DashboardTester {
	private pm: ProductManager;
	private server: unknown;
	private baseUrl: string;
	private results: TestResult[] = [];

	constructor() {
		this.pm = new ProductManager();
		this.baseUrl = "http://localhost:3004"; // Use different port to avoid conflicts
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

	async setup(): Promise<void> {
		// Start HTTP API server for testing
		this.server = await startHttpServer({ resolveProductManager: () => this.pm }, 3004);
		console.log("🚀 Test server started on port 3004");
	}

	async cleanup(): Promise<void> {
		if (this.server) {
			(this.server as { close(): void }).close();
			console.log("🛑 Test server stopped");
		}
	}

	async testApiEndpoints(): Promise<void> {
		await this.runTest("GET /api/health endpoint", async () => {
			const response = await fetch(`${this.baseUrl}/api/health`);
			if (!response.ok) {
				throw new Error(`Health check failed: ${response.status}`);
			}

			const data = await response.json();
			if (data.status !== "healthy") {
				throw new Error(`Health status is not healthy: ${data.status}`);
			}
		});

		await this.runTest("GET /api/tasks endpoint", async () => {
			const response = await fetch(`${this.baseUrl}/api/tasks`);
			if (!response.ok) {
				throw new Error(`Tasks endpoint failed: ${response.status}`);
			}

			const data = await response.json();
			if (!Array.isArray(data.tasks)) {
				throw new Error("Tasks response should be an array");
			}
		});

		await this.runTest("GET /api/queue endpoint", async () => {
			const response = await fetch(`${this.baseUrl}/api/queue`);
			if (!response.ok) {
				throw new Error(`Queue endpoint failed: ${response.status}`);
			}

			const data = await response.json();
			if (!Object.hasOwn(data, "count") || !Object.hasOwn(data, "queue")) {
				throw new Error("Queue response missing required fields");
			}
		});

		await this.runTest("GET /api/stats endpoint", async () => {
			const response = await fetch(`${this.baseUrl}/api/stats`);
			if (!response.ok) {
				throw new Error(`Stats endpoint failed: ${response.status}`);
			}

			const data = await response.json();
			if (!data.stats || typeof data.stats.total !== "number") {
				throw new Error("Stats response missing total count");
			}
		});

		await this.runTest("GET /api/analytics endpoint", async () => {
			const response = await fetch(`${this.baseUrl}/api/analytics`);
			if (!response.ok) {
				throw new Error(`Analytics endpoint failed: ${response.status}`);
			}

			const data = await response.json();
			if (!data.analytics || !data.analytics.overview) {
				throw new Error("Analytics response missing overview data");
			}
		});
	}

	async testTaskCRUD(): Promise<void> {
		let taskId: string | undefined;

		await this.runTest("POST /api/tasks - Create task", async () => {
			const taskData = {
				title: "Test Dashboard Task",
				description: "This is a test task for dashboard functionality",
				priority: "high",
			};

			const response = await fetch(`${this.baseUrl}/api/tasks`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(taskData),
			});

			if (!response.ok) {
				throw new Error(`Create task failed: ${response.status}`);
			}

			const data = await response.json();
			if (!data.task || !data.task.id) {
				throw new Error("Created task missing ID");
			}

			taskId = data.task.id;
		});

		if (taskId) {
			await this.runTest("GET /api/tasks/:id - Get specific task", async () => {
				const response = await fetch(`${this.baseUrl}/api/tasks/${taskId}`);
				if (!response.ok) {
					throw new Error(`Get task failed: ${response.status}`);
				}

				const data = await response.json();
				if (!data.task || data.task.id !== taskId) {
					throw new Error("Retrieved task ID mismatch");
				}
			});

			await this.runTest("PUT /api/tasks/:id/status - Update task status", async () => {
				const response = await fetch(`${this.baseUrl}/api/tasks/${taskId}/status`, {
					method: "PUT",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ status: "in-progress" }),
				});

				if (!response.ok) {
					throw new Error(`Update status failed: ${response.status}`);
				}

				const data = await response.json();
				if (data.task.status !== "in-progress") {
					throw new Error("Task status not updated correctly");
				}
			});

			await this.runTest("PUT /api/tasks/:id/priority - Update task priority", async () => {
				const response = await fetch(`${this.baseUrl}/api/tasks/${taskId}/priority`, {
					method: "PUT",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ priority: "medium" }),
				});

				if (!response.ok) {
					throw new Error(`Update priority failed: ${response.status}`);
				}

				const data = await response.json();
				if (data.task.priority !== "medium") {
					throw new Error("Task priority not updated correctly");
				}
			});

			await this.runTest("DELETE /api/tasks/:id - Delete task", async () => {
				const response = await fetch(`${this.baseUrl}/api/tasks/${taskId}`, {
					method: "DELETE",
				});

				if (!response.ok) {
					throw new Error(`Delete task failed: ${response.status}`);
				}
			});
		}
	}

	async testFilteringAndSearch(): Promise<void> {
		// Create test tasks with different properties
		const testTasks = [
			{ title: "High Priority Bug", description: "Critical bug in production", priority: "high" },
			{ title: "Medium Feature", description: "New feature request", priority: "medium" },
			{ title: "Low Priority Task", description: "Documentation update", priority: "low" },
		];

		const createdTaskIds: string[] = [];

		for (const taskData of testTasks) {
			const response = await fetch(`${this.baseUrl}/api/tasks`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(taskData),
			});

			if (response.ok) {
				const data = await response.json();
				createdTaskIds.push(data.task.id);
			}
		}

		await this.runTest("GET /api/tasks/priority/:high - Filter by priority", async () => {
			const response = await fetch(`${this.baseUrl}/api/tasks/priority/high`);
			if (!response.ok) {
				throw new Error(`Priority filter failed: ${response.status}`);
			}

			const data = await response.json();
			const hasHighPriority = data.tasks.some(
				(task: { priority: string }) => task.priority === "high",
			);
			if (!hasHighPriority) {
				throw new Error("High priority filter not working");
			}
		});

		await this.runTest("GET /api/tasks/status/:todo - Filter by status", async () => {
			const response = await fetch(`${this.baseUrl}/api/tasks/status/todo`);
			if (!response.ok) {
				throw new Error(`Status filter failed: ${response.status}`);
			}

			const data = await response.json();
			const hasTodoStatus = data.tasks.some((task: { status: string }) => task.status === "todo");
			if (!hasTodoStatus) {
				throw new Error("Status filter not working");
			}
		});

		// Cleanup test tasks
		for (const taskId of createdTaskIds) {
			try {
				await fetch(`${this.baseUrl}/api/tasks/${taskId}`, { method: "DELETE" });
			} catch (_error) {
				// Ignore cleanup errors
			}
		}
	}

	async testTRPCEndpoints(): Promise<void> {
		await this.runTest("tRPC tasks query", async () => {
			const response = await fetch(`${this.baseUrl}/trpc/tasks`, {
				method: "GET",
				headers: { "Content-Type": "application/json" },
			});

			if (!response.ok) {
				throw new Error(`tRPC tasks query failed: ${response.status}`);
			}

			const data = await response.json();
			if (!data.result || !data.result.data) {
				throw new Error("tRPC tasks response missing data");
			}
		});

		await this.runTest("tRPC queue query", async () => {
			const response = await fetch(`${this.baseUrl}/trpc/queue`, {
				method: "GET",
				headers: { "Content-Type": "application/json" },
			});

			if (!response.ok) {
				throw new Error(`tRPC queue query failed: ${response.status}`);
			}

			const data = await response.json();
			if (!data.result || !data.result.data) {
				throw new Error("tRPC queue response missing data");
			}
		});
	}

	async testDataConsistency(): Promise<void> {
		await this.runTest("Data consistency across endpoints", async () => {
			// Get data from multiple endpoints
			const tasksResponse = await fetch(`${this.baseUrl}/api/tasks`);
			const statsResponse = await fetch(`${this.baseUrl}/api/stats`);
			const analyticsResponse = await fetch(`${this.baseUrl}/api/analytics`);

			if (!tasksResponse.ok || !statsResponse.ok || !analyticsResponse.ok) {
				throw new Error("One or more endpoints failed");
			}

			const tasksData = await tasksResponse.json();
			const statsData = await statsResponse.json();
			const analyticsData = await analyticsResponse.json();

			// Check consistency
			if (tasksData.count !== statsData.stats.total) {
				throw new Error(
					`Task count mismatch: /api/tasks=${tasksData.count}, /api/stats=${statsData.stats.total}`,
				);
			}

			if (statsData.stats.total !== analyticsData.analytics.overview.totalTasks) {
				throw new Error(
					`Total tasks mismatch: /api/stats=${statsData.stats.total}, /api/analytics=${analyticsData.analytics.overview.totalTasks}`,
				);
			}
		});
	}

	async testErrorHandling(): Promise<void> {
		await this.runTest("404 handling for non-existent task", async () => {
			const response = await fetch(`${this.baseUrl}/api/tasks/non-existent-id`);
			if (response.status !== 404) {
				throw new Error(`Expected 404, got ${response.status}`);
			}
		});

		await this.runTest("Invalid task creation validation", async () => {
			const response = await fetch(`${this.baseUrl}/api/tasks`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ title: "", description: "test" }),
			});

			if (response.status !== 400 && response.status !== 500) {
				throw new Error(`Expected validation error, got ${response.status}`);
			}
		});

		await this.runTest("Invalid status update validation", async () => {
			// First create a task
			const createResponse = await fetch(`${this.baseUrl}/api/tasks`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ title: "Test", description: "Test", priority: "medium" }),
			});

			if (createResponse.ok) {
				const taskData = await createResponse.json();

				// Try invalid status update
				const updateResponse = await fetch(`${this.baseUrl}/api/tasks/${taskData.task.id}/status`, {
					method: "PUT",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ status: "invalid-status" }),
				});

				if (updateResponse.status !== 400 && updateResponse.status !== 500) {
					throw new Error(
						`Expected validation error for invalid status, got ${updateResponse.status}`,
					);
				}

				// Cleanup
				await fetch(`${this.baseUrl}/api/tasks/${taskData.task.id}`, { method: "DELETE" });
			}
		});
	}

	async runAllTests(): Promise<void> {
		console.log("🧪 Starting Dashboard Functionality Tests\n");

		try {
			await this.setup();

			await this.testApiEndpoints();
			await this.testTaskCRUD();
			await this.testFilteringAndSearch();
			await this.testTRPCEndpoints();
			await this.testDataConsistency();
			await this.testErrorHandling();
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
if (require.main === module) {
	const tester = new DashboardTester();
	tester.runAllTests().catch((error) => {
		console.error("Test execution failed:", error);
		process.exit(1);
	});
}

export { DashboardTester };

