/**
 * Enhanced integration tests for dashboard real-time functionality
 * Tests real-time updates, task cancellation workflow, and performance metrics
 */

import { describe, it, before } from "node:test";
import http from "node:http";
import { WebSocket } from "ws";
import { DaemonTcpClient } from "./tcp-client.ts";
import { expect } from "../../test-utils/expect.ts";

type TestResult = {
    name: string;
    passed: boolean;
    message: string;
    duration: number;
};

let serverAvailable = false;

const checkServer = async (): Promise<boolean> => {
    try {
        const response = await fetch("http://localhost:3005/api/health");
        return response.ok;
    } catch {
        return false;
    }
};

before(async () => {
    serverAvailable = await checkServer();
});

/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
class DashboardRealtimeTest {
	private dashboardPort: number = 3005;
	private daemonTcpClient: DaemonTcpClient;
	private results: TestResult[] = [];
	private testTasks: string[] = [];

	constructor() {
		this.daemonTcpClient = new DaemonTcpClient();
	}

	async runTest(name: string, testFn: () => Promise<void>): Promise<void> {
		const startTime = Date.now();
		try {
			await testFn();
			this.results.push({
				name,
				passed: true,
				message: "Test passed",
				duration: Date.now() - startTime,
			});
			console.log(`✅ ${name}`);
		} catch (error) {
			this.results.push({
				name,
				passed: false,
				message: error instanceof Error ? error.message : String(error),
				duration: Date.now() - startTime,
			});
			console.log(`❌ ${name}: ${error instanceof Error ? error.message : error}`);
		}
	}

	async makeHttpRequest(path: string, method: string = "GET", body?: string): Promise<any> {
		return new Promise((resolve, reject) => {
			const options = {
				hostname: "localhost",
				port: this.dashboardPort,
				path,
				method,
				headers: body ? {
					"Content-Type": "application/json",
					"Content-Length": Buffer.byteLength(body),
				} : undefined,
			};

			const req = http.request(options, (res) => {
				let responseData = "";
				res.on("data", (chunk) => {
					responseData += chunk;
				});
				res.on("end", () => {
					try {
						const parsed = JSON.parse(responseData);
						resolve({ statusCode: res.statusCode, data: parsed });
					} catch (error) {
						resolve({ statusCode: res.statusCode, data: responseData });
					}
				});
			});

			req.on("error", (error) => {
				reject(error);
			});

			if (body) {
				req.write(body);
			}
			req.end();
		});
	}

	async testDashboardHttpServer(): Promise<void> {
		const response = await this.makeHttpRequest("/");
		if (response.statusCode !== 200) {
			throw new Error(`Expected status 200, got ${response.statusCode}`);
		}
		if (!response.data.includes("Task Manager Dashboard")) {
			throw new Error("Dashboard HTML does not contain expected content");
		}
	}

	async testMetricsEndpointRealTime(): Promise<void> {
		const response = await this.makeHttpRequest("/api/metrics");
		if (response.statusCode !== 200) {
			throw new Error(`Expected status 200, got ${response.statusCode}`);
		}
		
		const metrics = response.data;
		if (!metrics.daemon || !metrics.tasks || !metrics.health) {
			throw new Error("Metrics endpoint missing required data");
		}

		// Test real-time metrics structure
		if (typeof metrics.daemon.uptime !== "number") {
			throw new Error("Daemon uptime should be a number");
		}
		if (typeof metrics.tasks.total !== "number") {
			throw new Error("Tasks total should be a number");
		}
		if (!["healthy", "unhealthy", "degraded"].includes(metrics.health.status)) {
			throw new Error("Health status should be one of: healthy, unhealthy, degraded");
		}
	}

	async testSystemStatusEndpoint(): Promise<void> {
		const response = await this.makeHttpRequest("/api/status");
		if (response.statusCode !== 200) {
			throw new Error(`Expected status 200, got ${response.statusCode}`);
		}

		const status = response.data;
		if (!status.daemon || !status.tasks || !status.connections) {
			throw new Error("System status endpoint missing required data");
		}

		// Validate daemon status
		if (!status.daemon.pid || !status.daemon.uptime) {
			throw new Error("Daemon status missing pid or uptime");
		}

		// Validate task counts
		if (typeof status.tasks.total !== "number") {
			throw new Error("Tasks total should be a number");
		}

		// Validate connection status
		if (typeof status.connections.websocket !== "number") {
			throw new Error("WebSocket connections should be a number");
		}
	}

	async testPerformanceMetricsEndpoint(): Promise<void> {
		const response = await this.makeHttpRequest("/api/performance");
		if (response.statusCode !== 200) {
			throw new Error(`Expected status 200, got ${response.statusCode}`);
		}

		const perf = response.data;
		if (!perf.memory || !perf.tasks || !perf.daemon) {
			throw new Error("Performance metrics missing required data");
		}

		// Validate memory metrics
		if (typeof perf.memory.heap.used !== "number") {
			throw new Error("Memory heap used should be a number");
		}

		// Validate task throughput
		if (typeof perf.tasks.throughput.completed !== "number") {
			throw new Error("Task throughput completed should be a number");
		}
	}

	async testWebSocketConnection(): Promise<void> {
		return new Promise((resolve, reject) => {
			const ws = new WebSocket(`ws://localhost:${this.dashboardPort}/dashboard-ws`);
			
			let connected = false;
			
			const timeout = setTimeout(() => {
				if (!connected) {
					ws.close();
					reject(new Error("WebSocket connection timeout"));
				}
			}, 5000);

			ws.on("open", () => {
				connected = true;
				clearTimeout(timeout);
				console.log("[TEST] WebSocket connected successfully");
				ws.close();
				resolve();
			});

			ws.on("error", (error) => {
				clearTimeout(timeout);
				reject(new Error(`WebSocket connection failed: ${error.message}`));
			});
		});
	}

	async testWebSocketRealTimeUpdates(): Promise<void> {
		return new Promise((resolve, reject) => {
			const ws = new WebSocket(`ws://localhost:${this.dashboardPort}/dashboard-ws`);
			let receivedUpdate = false;
			let testTaskId: string;

			const timeout = setTimeout(() => {
				if (!receivedUpdate) {
					ws.close();
					reject(new Error("Did not receive WebSocket update within timeout"));
				}
			}, 10000);

			ws.on("open", async () => {
				// Create a test task to trigger an update
				try {
					const taskResponse = await this.daemonTcpClient.createTask({
						title: "Real-time Test Task",
						description: "Task to test WebSocket updates",
						priority: "high",
					});

				if (taskResponse.success && taskResponse.data) {
					testTaskId = taskResponse.data.id;
					this.testTasks.push(testTaskId);
				}
				} catch (error) {
					console.error("[TEST] Failed to create test task:", error);
				}
			});

			ws.on("message", (data) => {
				try {
					const message = JSON.parse(data.toString());
					if (message.type === "task_created" || message.type === "metrics_update") {
						receivedUpdate = true;
						clearTimeout(timeout);
						ws.close();
						resolve();
					}
				} catch (error) {
					// Ignore parsing errors
				}
			});

			ws.on("error", (error) => {
				clearTimeout(timeout);
				reject(new Error(`WebSocket error: ${error.message}`));
			});
		});
	}

	async testTaskCancellationWorkflow(): Promise<void> {
		// Create a task that can be cancelled
		const taskResponse = await this.daemonTcpClient.createTask({
			title: "Cancellation Test Task",
			description: "Task to test cancellation workflow",
			priority: "medium",
		});

		if (!taskResponse.success) {
			throw new Error("Failed to create test task for cancellation");
		}

		if (!taskResponse.data) {
			throw new Error("Task creation response missing data");
		}
		const taskId = taskResponse.data.id;
		this.testTasks.push(taskId);

		// Verify task exists
		const getResponse = await this.daemonTcpClient.getTask(taskId);
		if (!getResponse.success) {
			throw new Error("Failed to retrieve created task");
		}

		// Cancel the task via dashboard API
		const cancelResponse = await this.makeHttpRequest("/api/tasks/cancel", "POST", 
			JSON.stringify({ id: taskId }));

		if (cancelResponse.statusCode !== 200) {
			throw new Error(`Expected cancel status 200, got ${cancelResponse.statusCode}`);
		}

		if (!cancelResponse.data.success) {
			throw new Error("Task cancellation failed: " + (cancelResponse.data.error || "Unknown error"));
		}

		// Verify task was cancelled
		const updatedResponse = await this.daemonTcpClient.getTask(taskId);
		if (!updatedResponse.success) {
			throw new Error("Failed to retrieve task after cancellation");
		}

		if (!updatedResponse.data) {
			throw new Error("Updated task response missing data");
		}

		if (updatedResponse.data.status !== "cancelled") {
			throw new Error(`Expected status 'cancelled', got '${updatedResponse.data.status}'`);
		}
	}

	async testQueueStatusEndpoint(): Promise<void> {
		const response = await this.makeHttpRequest("/api/queue/status");
		if (response.statusCode !== 200) {
			throw new Error(`Expected status 200, got ${response.statusCode}`);
		}

		const queue = response.data;
		if (typeof queue.total !== "number") {
			throw new Error("Queue total should be a number");
		}
		if (!queue.queueByPriority) {
			throw new Error("Queue should have queueByPriority field");
		}
		if (!Array.isArray(queue.failedTasks)) {
			throw new Error("Failed tasks should be an array");
		}
	}

	async testAutoRefreshFrequency(): Promise<void> {
		let updateCount = 0;
		
		const ws = new WebSocket(`ws://localhost:${this.dashboardPort}/dashboard-ws`);
		
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				ws.close();
				
				// Should receive multiple updates in 6 seconds (2-second interval)
				if (updateCount >= 2) {
					resolve();
				} else {
					reject(new Error(`Expected at least 2 updates in 6 seconds, got ${updateCount}`));
				}
			}, 6000);

			ws.on("open", () => {
				// Start counting metrics updates
			});

			ws.on("message", (data) => {
				try {
					const message = JSON.parse(data.toString());
					if (message.type === "metrics_update") {
						updateCount++;
						console.log(`[TEST] Received update ${updateCount}`);
					}
				} catch (error) {
					// Ignore parsing errors
				}
			});

			ws.on("error", (error) => {
				clearTimeout(timeout);
				reject(new Error(`WebSocket error: ${error.message}`));
			});
		});
	}

	async testTaskCreationThroughDashboard(): Promise<void> {
		const testTask = {
			title: "Dashboard Creation Test",
			description: "Testing task creation via dashboard API",
			priority: "high",
		};

		const response = await this.makeHttpRequest("/api/tasks", "POST", JSON.stringify(testTask));
		
		if (response.statusCode !== 201) {
			throw new Error(`Expected status 201, got ${response.statusCode}`);
		}

		if (!response.data.success || !response.data.data) {
			throw new Error("Task creation response missing success flag or data");
		}

		const taskId = response.data.data.id;
		this.testTasks.push(taskId);

		// Verify task was created via TCP API
		const verifyResponse = await this.daemonTcpClient.getTask(taskId);
		if (!verifyResponse.success) {
			throw new Error("Failed to verify created task via TCP API");
		}

		if (!verifyResponse.data) {
			throw new Error("Verify task response missing data");
		}

		if (verifyResponse.data.title !== testTask.title) {
			throw new Error("Created task title does not match");
		}
	}

	async cleanupTestTasks(): Promise<void> {
		for (const taskId of this.testTasks) {
			try {
				await this.daemonTcpClient.deleteTask(taskId);
			} catch (error) {
				console.warn(`Failed to clean up test task ${taskId}:`, error);
			}
		}
		this.testTasks = [];
	}

	async runAllTests(): Promise<TestResult[]> {
		console.log("=== Dashboard Real-time Integration Tests ===\n");

		// Basic connectivity tests
		await this.runTest("Dashboard HTTP Server", () => this.testDashboardHttpServer());
		await this.runTest("Metrics Endpoint Real-time", () => this.testMetricsEndpointRealTime());
		await this.runTest("System Status Endpoint", () => this.testSystemStatusEndpoint());
		await this.runTest("Performance Metrics Endpoint", () => this.testPerformanceMetricsEndpoint());

		// WebSocket tests
		await this.runTest("WebSocket Connection", () => this.testWebSocketConnection());
		await this.runTest("WebSocket Real-time Updates", () => this.testWebSocketRealTimeUpdates());
		await this.runTest("Auto-refresh Frequency", () => this.testAutoRefreshFrequency());

		// Workflow tests
		await this.runTest("Task Cancellation Workflow", () => this.testTaskCancellationWorkflow());
		await this.runTest("Queue Status Endpoint", () => this.testQueueStatusEndpoint());
		await this.runTest("Task Creation Through Dashboard", () => this.testTaskCreationThroughDashboard());

		// Cleanup
		await this.cleanupTestTasks();

		this.printSummary();
		return this.results;
	}

	printSummary(): void {
		console.log("\n=== Test Summary ===");
		const passed = this.results.filter(r => r.passed).length;
		const total = this.results.length;
		const totalDuration = this.results.reduce((sum, r) => sum + r.duration, 0);

		console.log(`Passed: ${passed}/${total} tests`);
		console.log(`Total Duration: ${totalDuration}ms`);

		if (passed === total) {
			console.log("✅ All tests passed!");
		} else {
			console.log("❌ Some tests failed:");
			this.results.filter(r => !r.passed).forEach(r => {
				console.log(`  - ${r.name}: ${r.message}`);
			});
		}
	}
}

describe("Dashboard Realtime Runner", () => {
    it("runs the realtime integration suite", async (t) => {
        if (!serverAvailable) {
            t.skip();
            return;
        }

        const tester = new DashboardRealtimeTest();
        const results = await tester.runAllTests();
        const failures = results.filter((result) => !result.passed);
        expect(failures.length).toBe(0);
    });
});

