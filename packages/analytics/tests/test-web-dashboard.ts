#!/usr/bin/env node
import "../../../tests/test-utils/env-fetch.ts";

/**
 * Comprehensive Web Dashboard Test Suite
 * Tests all major functionality of the web dashboard
 */

import { ProductManager } from "@isomorphiq/tasks";
import { startHttpServer } from "@isomorphiq/http-server";
import type http from "node:http";

interface TestResult {
	name: string;
	passed: boolean;
	error?: string;
	duration: number;
}

class WebDashboardTester {
	private pm: ProductManager;
	private server: http.Server | null = null;
	private baseUrl: string;
	private results: TestResult[] = [];

	constructor() {
		this.pm = new ProductManager();
		this.baseUrl = "http://localhost:3003";
	}

	async runAllTests(): Promise<void> {
		console.log("🌐 Starting Web Dashboard Test Suite\n");

		try {
			// Start HTTP API server for testing
			await this.startTestServer();

			// Run all test categories
			await this.testCoreFunctionality();
			await this.testDashboardViews();
			await this.testRealTimeFeatures();
			await this.testErrorHandling();
			await this.testPerformance();

			// Print results
			this.printResults();
		} catch (error) {
			console.error("❌ Test suite failed:", error);
		} finally {
			await this.cleanup();
		}
	}

	private async startTestServer(): Promise<void> {
		try {
			this.server = await startHttpServer({ resolveProductManager: () => this.pm }, 3003);
			console.log("✅ Test server started on port 3003");
		} catch (_error) {
			// Server might already be running
			console.log("ℹ️  Server already running, proceeding with tests");
		}
	}

	private async testCoreFunctionality(): Promise<void> {
		console.log("📊 Testing Core Functionality");

		await this.runTest("Task List Loading", async () => {
			const response = await fetch(`${this.baseUrl}/api/tasks`);
			if (!response.ok) throw new Error("Failed to fetch tasks");

			const data = await response.json();
			if (!data.tasks || !Array.isArray(data.tasks)) {
				throw new Error("Invalid tasks response format");
			}

			return data.tasks.length >= 0;
		});

		await this.runTest("Task Creation", async () => {
			const testTask = {
				title: "Web Dashboard Test Task",
				description: "Testing task creation via web dashboard",
				priority: "medium",
			};

			const response = await fetch(`${this.baseUrl}/api/tasks`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(testTask),
			});

			if (!response.ok) throw new Error("Failed to create task");

			const data = await response.json();
			return data.task && data.task.title === testTask.title;
		});

		await this.runTest("Task Status Update", async () => {
			// Get a task to update
			const tasksResponse = await fetch(`${this.baseUrl}/api/tasks`);
			const tasksData = await tasksResponse.json();

			if (tasksData.tasks.length === 0) {
				throw new Error("No tasks available for status update test");
			}

			const taskId = tasksData.tasks[0].id;
			const response = await fetch(`${this.baseUrl}/api/tasks/${taskId}/status`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ status: "in-progress" }),
			});

			if (!response.ok) throw new Error("Failed to update task status");

			const data = await response.json();
			return data.task.status === "in-progress";
		});

		await this.runTest("Task Priority Update", async () => {
			const tasksResponse = await fetch(`${this.baseUrl}/api/tasks`);
			const tasksData = await tasksResponse.json();

			if (tasksData.tasks.length === 0) {
				throw new Error("No tasks available for priority update test");
			}

			const taskId = tasksData.tasks[0].id;
			const response = await fetch(`${this.baseUrl}/api/tasks/${taskId}/priority`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ priority: "high" }),
			});

			if (!response.ok) throw new Error("Failed to update task priority");

			const data = await response.json();
			return data.task.priority === "high";
		});

		await this.runTest("Task Deletion", async () => {
			// Create a task to delete
			const createResponse = await fetch(`${this.baseUrl}/api/tasks`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					title: "Task to Delete",
					description: "This task will be deleted",
					priority: "low",
				}),
			});

			const createData = await createResponse.json();
			const taskId = createData.task.id;

			// Delete the task
			const deleteResponse = await fetch(`${this.baseUrl}/api/tasks/${taskId}`, {
				method: "DELETE",
			});

			if (!deleteResponse.ok) throw new Error("Failed to delete task");

			return true;
		});
	}

	private async testDashboardViews(): Promise<void> {
		console.log("\n🖼️  Testing Dashboard Views");

		await this.runTest("Stats View", async () => {
			const response = await fetch(`${this.baseUrl}/api/stats`);
			if (!response.ok) throw new Error("Failed to fetch stats");

			const data = await response.json();
			return (
				data.stats &&
				typeof data.stats.total === "number" &&
				typeof data.stats.byStatus === "object"
			);
		});

		await this.runTest("Analytics View", async () => {
			const response = await fetch(`${this.baseUrl}/api/analytics`);
			if (!response.ok) throw new Error("Failed to fetch analytics");

			const data = await response.json();
			return (
				data.analytics?.overview &&
				data.analytics.timeline &&
				Array.isArray(data.analytics.timeline)
			);
		});

		await this.runTest("Queue View", async () => {
			const response = await fetch(`${this.baseUrl}/api/queue`);
			if (!response.ok) throw new Error("Failed to fetch queue");

			const data = await response.json();
			return data.queue && Array.isArray(data.queue);
		});

		await this.runTest("Health Check", async () => {
			const response = await fetch(`${this.baseUrl}/api/health`);
			if (!response.ok) throw new Error("Health check failed");

			const data = await response.json();
			return data.status === "healthy";
		});
	}

	private async testRealTimeFeatures(): Promise<void> {
		console.log("\n⚡ Testing Real-time Features");

		await this.runTest("WebSocket Connection", async () => {
			return new Promise((resolve, reject) => {
				const WebSocket = require("ws");
				const ws = new WebSocket("ws://localhost:3003/trpc");

				const timeout = setTimeout(() => {
					ws.close();
					reject(new Error("WebSocket connection timeout"));
				}, 5000);

				ws.on("open", () => {
					clearTimeout(timeout);
					ws.close();
					resolve(true);
				});

				ws.on("error", (error: Error) => {
					clearTimeout(timeout);
					reject(error);
				});
			});
		});

		await this.runTest("tRPC Subscription", async () => {
			return new Promise((resolve, reject) => {
				const WebSocket = require("ws");
				const ws = new WebSocket("ws://localhost:3003/trpc");

				const timeout = setTimeout(() => {
					ws.close();
					reject(new Error("tRPC subscription timeout"));
				}, 5000);

				ws.on("open", () => {
					// Send subscription message
					ws.send(
						JSON.stringify({
							type: "subscription",
							payload: {
								path: "taskUpdates",
								input: {},
							},
						}),
					);
				});

				ws.on("message", () => {
					clearTimeout(timeout);
					ws.close();
					resolve(true);
				});

				ws.on("error", (error: Error) => {
					clearTimeout(timeout);
					reject(error);
				});
			});
		});
	}

	private async testErrorHandling(): Promise<void> {
		console.log("\n🛡️  Testing Error Handling");

		await this.runTest("Invalid Task Creation", async () => {
			const response = await fetch(`${this.baseUrl}/api/tasks`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					title: "",
					description: "",
					priority: "invalid",
				}),
			});

			return response.status === 400 || response.status === 500;
		});

		await this.runTest("Non-existent Task", async () => {
			const response = await fetch(`${this.baseUrl}/api/tasks/non-existent-id`);
			return response.status === 404;
		});

		await this.runTest("Invalid Status Update", async () => {
			const response = await fetch(`${this.baseUrl}/api/tasks/invalid-id/status`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ status: "invalid-status" }),
			});

			return response.status === 400 || response.status === 404 || response.status === 500;
		});
	}

	private async testPerformance(): Promise<void> {
		console.log("\n⚡ Testing Performance");

		await this.runTest("Task List Response Time", async () => {
			const start = Date.now();
			const response = await fetch(`${this.baseUrl}/api/tasks`);
			const end = Date.now();

			if (!response.ok) throw new Error("Request failed");

			const responseTime = end - start;
			return responseTime < 1000; // Should respond within 1 second
		});

		await this.runTest("Analytics Response Time", async () => {
			const start = Date.now();
			const response = await fetch(`${this.baseUrl}/api/analytics`);
			const end = Date.now();

			if (!response.ok) throw new Error("Request failed");

			const responseTime = end - start;
			return responseTime < 2000; // Should respond within 2 seconds
		});

		await this.runTest("Concurrent Requests", async () => {
			const requests = Array.from({ length: 10 }, () => fetch(`${this.baseUrl}/api/tasks`));

			const start = Date.now();
			const responses = await Promise.all(requests);
			const end = Date.now();

			const allSuccessful = responses.every((r) => r.ok);
			const totalTime = end - start;

			return allSuccessful && totalTime < 3000; // All should complete within 3 seconds
		});
	}

	private async runTest(name: string, testFn: () => Promise<boolean>): Promise<void> {
		const startTime = Date.now();

		try {
			const result = await testFn();
			const duration = Date.now() - startTime;

			this.results.push({
				name,
				passed: result === true,
				duration,
			});

			if (result) {
				console.log(`  ✅ ${name} (${duration}ms)`);
			} else {
				console.log(`  ❌ ${name} (${duration}ms) - Test returned false`);
			}
		} catch (error) {
			const duration = Date.now() - startTime;

			this.results.push({
				name,
				passed: false,
				error: error instanceof Error ? error.message : String(error),
				duration,
			});

			console.log(`  ❌ ${name} (${duration}ms) - ${error}`);
		}
	}

	private printResults(): void {
		console.log("\n📊 Test Results:");

		const passed = this.results.filter((r) => r.passed).length;
		const failed = this.results.filter((r) => !r.passed).length;
		const total = this.results.length;
		const totalDuration = this.results.reduce((sum, r) => sum + r.duration, 0);

		console.log(`Total: ${total} tests`);
		console.log(`Passed: ${passed} ✅`);
		console.log(`Failed: ${failed} ${failed > 0 ? "❌" : "✅"}`);
		console.log(`Duration: ${totalDuration}ms`);

		if (failed > 0) {
			console.log("\n❌ Failed Tests:");
			this.results
				.filter((r) => !r.passed)
				.forEach((r) => {
					console.log(`  - ${r.name}: ${r.error || "Unknown error"}`);
				});
		}

		console.log(
			`\n${failed === 0 ? "✅" : "❌"} ${failed === 0 ? "All tests passed!" : "Some tests failed!"}`,
		);
	}

	private async cleanup(): Promise<void> {
		if (this.server) {
			this.server.close();
		}
	}
}

// Run the tests
async function main() {
	const tester = new WebDashboardTester();
	await tester.runAllTests();
}

main().catch(console.error);
