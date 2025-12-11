#!/usr/bin/env node

/**
 * Test suite for real-time updates in dashboard
 * Tests WebSocket connections, tRPC subscriptions, and live data synchronization
 */

import { ProductManager } from "../src/index.js";
import { startHttpApi } from "../src/http-api-server.js";
import WebSocket from "ws";
import type http from "node:http";

interface TestResult {
	name: string;
	passed: boolean;
	error?: string;
	duration: number;
}

class RealTimeUpdatesTester {
	private pm: ProductManager;
	private server: http.Server | null = null;
	private baseUrl: string;
	private results: TestResult[] = [];

	constructor() {
		this.pm = new ProductManager();
		this.baseUrl = "http://localhost:3006"; // Use different port
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

	private async createWebSocketConnection(): Promise<WebSocket> {
		return new Promise((resolve, reject) => {
			const ws = new WebSocket(`ws://localhost:3006/trpc`);

			ws.on("open", () => {
				console.log("  WebSocket connection established");
				resolve(ws);
			});

			ws.on("error", (error) => {
				reject(new Error(`WebSocket connection failed: ${error.message}`));
			});

			// Timeout after 5 seconds
			setTimeout(() => {
				reject(new Error("WebSocket connection timeout"));
			}, 5000);
		});
	}

	private async sendTRPCSubscription(ws: WebSocket, procedure: string): Promise<void> {
		const message = {
			type: "subscription",
			payload: {
				path: procedure,
				input: undefined,
			},
		};

		ws.send(JSON.stringify(message));
	}

	private async waitForMessage(ws: WebSocket, timeout: number = 5000): Promise<unknown> {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				reject(new Error("Message timeout"));
			}, timeout);

			const messageHandler = (data: Buffer) => {
				clearTimeout(timer);
				ws.removeListener("message", messageHandler);
				try {
					const parsed = JSON.parse(data.toString());
					resolve(parsed);
				} catch (error) {
					reject(new Error(`Failed to parse message: ${error}`));
				}
			};

			ws.on("message", messageHandler);
		});
	}

	async setup(): Promise<void> {
		this.server = await startHttpApi(this.pm, 3006);
		console.log("🚀 Real-time test server started on port 3006");
	}

	async cleanup(): Promise<void> {
		if (this.server) {
			this.server.close();
			console.log("🛑 Real-time test server stopped");
		}
	}

	async testWebSocketConnection(): Promise<void> {
		await this.runTest("WebSocket connection establishment", async () => {
			const ws = await this.createWebSocketConnection();

			if (ws.readyState !== WebSocket.OPEN) {
				throw new Error("WebSocket not in OPEN state");
			}

			ws.close();
		});
	}

	async testTRPCSubscription(): Promise<void> {
		await this.runTest("tRPC subscription to task updates", async () => {
			const ws = await this.createWebSocketConnection();

			try {
				// Subscribe to task updates
				await this.sendTRPCSubscription(ws, "taskUpdates");

				// Wait for subscription acknowledgment or initial data
				const message = await this.waitForMessage(ws, 3000);

				if (!message) {
					throw new Error("No response received from subscription");
				}

				// Message should have some structure (even if empty)
				if (typeof message !== "object") {
					throw new Error("Subscription response is not an object");
				}
			} finally {
				ws.close();
			}
		});
	}

	async testRealTimeTaskCreation(): Promise<void> {
		await this.runTest("Real-time task creation updates", async () => {
			const ws = await this.createWebSocketConnection();

			try {
				// Subscribe to task updates
				await this.sendTRPCSubscription(ws, "taskUpdates");

				// Create a test task via HTTP API
				const createResponse = await fetch(`${this.baseUrl}/api/tasks`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						title: "Real-time Test Task",
						description: "Task for testing real-time updates",
						priority: "high",
					}),
				});

				if (!createResponse.ok) {
					throw new Error("Failed to create test task");
				}

				const createData = await createResponse.json();
				const taskId = createData.task.id;

				try {
					// Wait for real-time update
					const updateMessage = await this.waitForMessage(ws, 3000);

					if (!updateMessage) {
						throw new Error("No real-time update received for task creation");
					}

					// Verify the update contains task information
					if (updateMessage.type !== "data") {
						throw new Error('Update message is not of type "data"');
					}

					const updateData = updateMessage.data;
					if (!updateData) {
						throw new Error("Update message missing data");
					}
				} finally {
					// Cleanup test task
					try {
						await fetch(`${this.baseUrl}/api/tasks/${taskId}`, { method: "DELETE" });
					} catch (_error) {
						// Ignore cleanup errors
					}
				}
			} finally {
				ws.close();
			}
		});
	}

	async testRealTimeTaskUpdates(): Promise<void> {
		await this.runTest("Real-time task status updates", async () => {
			const ws = await this.createWebSocketConnection();

			try {
				// Subscribe to task updates
				await this.sendTRPCSubscription(ws, "taskUpdates");

				// Create a test task first
				const createResponse = await fetch(`${this.baseUrl}/api/tasks`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						title: "Status Update Test Task",
						description: "Task for testing status update real-time updates",
						priority: "medium",
					}),
				});

				if (!createResponse.ok) {
					throw new Error("Failed to create test task");
				}

				const createData = await createResponse.json();
				const taskId = createData.task.id;

				try {
					// Update task status
					const updateResponse = await fetch(`${this.baseUrl}/api/tasks/${taskId}/status`, {
						method: "PUT",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ status: "in-progress" }),
					});

					if (!updateResponse.ok) {
						throw new Error("Failed to update task status");
					}

					// Wait for real-time update
					const updateMessage = await this.waitForMessage(ws, 3000);

					if (!updateMessage) {
						throw new Error("No real-time update received for status change");
					}

					// Verify the update contains the status change
					const updateData = updateMessage.data;
					if (updateData.type !== "TASK_UPDATED") {
						throw new Error("Update type is not TASK_UPDATED");
					}

					if (updateData.task.id !== taskId) {
						throw new Error("Update task ID does not match");
					}

					if (updateData.task.status !== "in-progress") {
						throw new Error("Update task status does not match expected value");
					}
				} finally {
					// Cleanup test task
					try {
						await fetch(`${this.baseUrl}/api/tasks/${taskId}`, { method: "DELETE" });
					} catch (_error) {
						// Ignore cleanup errors
					}
				}
			} finally {
				ws.close();
			}
		});
	}

	async testMultipleSubscribers(): Promise<void> {
		await this.runTest("Multiple WebSocket subscribers", async () => {
			const ws1 = await this.createWebSocketConnection();
			const ws2 = await this.createWebSocketConnection();

			try {
				// Subscribe both connections to task updates
				await this.sendTRPCSubscription(ws1, "taskUpdates");
				await this.sendTRPCSubscription(ws2, "taskUpdates");

				// Create a test task
				const createResponse = await fetch(`${this.baseUrl}/api/tasks`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						title: "Multi-subscriber Test Task",
						description: "Task for testing multiple subscribers",
						priority: "low",
					}),
				});

				if (!createResponse.ok) {
					throw new Error("Failed to create test task");
				}

				const createData = await createResponse.json();
				const taskId = createData.task.id;

				try {
					// Wait for updates on both connections
					const [message1, message2] = await Promise.all([
						this.waitForMessage(ws1, 3000),
						this.waitForMessage(ws2, 3000),
					]);

					if (!message1 || !message2) {
						throw new Error("Not all subscribers received updates");
					}

					// Both should receive the same task creation event
					const data1 = message1.data;
					const data2 = message2.data;

					if (data1.task.id !== taskId || data2.task.id !== taskId) {
						throw new Error("Subscribers received different task IDs");
					}

					if (data1.type !== "TASK_CREATED" || data2.type !== "TASK_CREATED") {
						throw new Error("Subscribers did not receive TASK_CREATED event");
					}
				} finally {
					// Cleanup test task
					try {
						await fetch(`${this.baseUrl}/api/tasks/${taskId}`, { method: "DELETE" });
					} catch (_error) {
						// Ignore cleanup errors
					}
				}
			} finally {
				ws1.close();
				ws2.close();
			}
		});
	}

	async testConnectionResilience(): Promise<void> {
		await this.runTest("WebSocket connection resilience", async () => {
			let ws = await this.createWebSocketConnection();

			try {
				// Subscribe to task updates
				await this.sendTRPCSubscription(ws, "taskUpdates");

				// Close the connection abruptly
				ws.terminate();

				// Wait a moment
				await new Promise((resolve) => setTimeout(resolve, 100));

				// Reconnect
				ws = await this.createWebSocketConnection();

				// Subscribe again
				await this.sendTRPCSubscription(ws, "taskUpdates");

				// Create a test task to verify the new connection works
				const createResponse = await fetch(`${this.baseUrl}/api/tasks`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						title: "Resilience Test Task",
						description: "Task for testing connection resilience",
						priority: "medium",
					}),
				});

				if (!createResponse.ok) {
					throw new Error("Failed to create test task");
				}

				const createData = await createResponse.json();
				const taskId = createData.task.id;

				try {
					// Should receive update on reconnected socket
					const updateMessage = await this.waitForMessage(ws, 3000);

					if (!updateMessage) {
						throw new Error("No update received on reconnected socket");
					}

					const updateData = updateMessage.data;
					if (updateData.task.id !== taskId) {
						throw new Error("Reconnected socket received wrong task update");
					}
				} finally {
					// Cleanup test task
					try {
						await fetch(`${this.baseUrl}/api/tasks/${taskId}`, { method: "DELETE" });
					} catch (_error) {
						// Ignore cleanup errors
					}
				}
			} finally {
				ws.close();
			}
		});
	}

	async testSubscriptionFiltering(): Promise<void> {
		await this.runTest("Subscription event filtering", async () => {
			const ws = await this.createWebSocketConnection();

			try {
				// Subscribe to task updates
				await this.sendTRPCSubscription(ws, "taskUpdates");

				// Track received events
				const events: unknown[] = [];

				const messageHandler = (data: Buffer) => {
					try {
						const parsed = JSON.parse(data.toString()) as { type?: string; data?: unknown };
						if (parsed.type === "data" && parsed.data) {
							events.push(parsed.data);
						}
					} catch (_error) {
						// Ignore parsing errors
					}
				};

				ws.on("message", messageHandler);

				// Create multiple tasks rapidly
				const tasks = [];
				for (let i = 0; i < 3; i++) {
					const createResponse = await fetch(`${this.baseUrl}/api/tasks`, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							title: `Filter Test Task ${i + 1}`,
							description: `Task ${i + 1} for testing event filtering`,
							priority: "low",
						}),
					});

					if (createResponse.ok) {
						const createData = await createResponse.json();
						tasks.push(createData.task.id);
					}

					// Small delay between creations
					await new Promise((resolve) => setTimeout(resolve, 50));
				}

				// Wait for events to be received
				await new Promise((resolve) => setTimeout(resolve, 2000));

				// Should have received events for all created tasks
				if (events.length < 3) {
					throw new Error(`Expected at least 3 events, received ${events.length}`);
				}

				// All events should be TASK_CREATED type
				const createdEvents = events.filter((e) => e.type === "TASK_CREATED");
				if (createdEvents.length < 3) {
					throw new Error(
						`Expected at least 3 TASK_CREATED events, received ${createdEvents.length}`,
					);
				}

				// Cleanup test tasks
				for (const taskId of tasks) {
					try {
						await fetch(`${this.baseUrl}/api/tasks/${taskId}`, { method: "DELETE" });
					} catch (_error) {
						// Ignore cleanup errors
					}
				}
			} finally {
				ws.close();
			}
		});
	}

	async runAllTests(): Promise<void> {
		console.log("🧪 Starting Real-time Updates Tests\n");

		try {
			await this.setup();

			await this.testWebSocketConnection();
			await this.testTRPCSubscription();
			await this.testRealTimeTaskCreation();
			await this.testRealTimeTaskUpdates();
			await this.testMultipleSubscribers();
			await this.testConnectionResilience();
			await this.testSubscriptionFiltering();
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
	const tester = new RealTimeUpdatesTester();
	tester.runAllTests().catch((error) => {
		console.error("Test execution failed:", error);
		process.exit(1);
	});
}

export { RealTimeUpdatesTester };
