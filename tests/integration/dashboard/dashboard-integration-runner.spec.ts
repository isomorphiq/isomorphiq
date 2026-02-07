/**
 * Integration test for the web dashboard functionality
 * Tests the dashboard HTTP API endpoints and TCP integration
 */

import { test, expect } from "@playwright/test";

import http from "node:http";
import { DaemonTcpClient } from "../../e2e/dashboard/tcp-client.ts";

const describe = test.describe;
const it = test;
const before = test.beforeAll;
const after = test.afterAll;
const beforeEach = test.beforeEach;
const afterEach = test.afterEach;

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
class DashboardIntegrationTest {
	private dashboardPort: number = 3005;
	private daemonTcpClient: DaemonTcpClient;
	private results: TestResult[] = [];

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

	async testDashboardHomepage(): Promise<void> {
		const response = await this.makeHttpRequest("/");
		if (response.statusCode !== 200) {
			throw new Error(`Expected status 200, got ${response.statusCode}`);
		}
		if (!response.data.includes("Task Manager Dashboard")) {
			throw new Error("Dashboard HTML does not contain expected content");
		}
	}

	async testMetricsEndpoint(): Promise<void> {
		const response = await this.makeHttpRequest("/api/metrics");
		if (response.statusCode !== 200) {
			throw new Error(`Expected status 200, got ${response.statusCode}`);
		}
		if (!response.data.daemon || !response.data.tasks || !response.data.health) {
			throw new Error("Metrics endpoint missing required data");
		}
	}

	async testTasksEndpoint(): Promise<void> {
		const response = await this.makeHttpRequest("/api/tasks");
		if (response.statusCode !== 200) {
			throw new Error(`Expected status 200, got ${response.statusCode}`);
		}
		if (!Array.isArray(response.data)) {
			throw new Error("Tasks endpoint should return an array");
		}
	}

	async testTaskCreation(): Promise<void> {
		const testTask = {
			title: "Dashboard Integration Test Task",
			description: "Test task created by integration test",
			priority: "high",
		};

		const response = await this.makeHttpRequest("/api/tasks", "POST", JSON.stringify(testTask));
		
		if (response.statusCode !== 201) {
			throw new Error(`Expected status 201, got ${response.statusCode}`);
		}
		
		if (!response.data.success || !response.data.data) {
			throw new Error("Task creation response missing success flag or data");
		}

		// Clean up: delete the created task
		const taskId = response.data.data.id;
		try {
			await this.daemonTcpClient.deleteTask(taskId);
		} catch (error) {
			console.warn(`Failed to clean up test task ${taskId}:`, error);
		}
	}

	async testTaskCreationWithInvalidData(): Promise<void> {
		const invalidTask = {
			description: "Missing required title field",
		};

		const response = await this.makeHttpRequest("/api/tasks", "POST", JSON.stringify(invalidTask));
		
		if (response.statusCode !== 400 && response.statusCode !== 500) {
			throw new Error(`Expected error status 400/500, got ${response.statusCode}`);
		}
	}

	async testTaskFiltering(): Promise<void> {
		// Test status filtering
		const response = await this.makeHttpRequest("/api/tasks?status=todo");
		if (response.statusCode !== 200) {
			throw new Error(`Expected status 200, got ${response.statusCode}`);
		}
		
		// Verify all returned tasks have the requested status
		for (const task of response.data) {
			if (task.status !== "todo") {
				throw new Error(`Task filtering failed: found task with status ${task.status}`);
			}
		}

		// Test priority filtering
		const priorityResponse = await this.makeHttpRequest("/api/tasks?priority=high");
		if (priorityResponse.statusCode !== 200) {
			throw new Error(`Expected status 200, got ${priorityResponse.statusCode}`);
		}
		
		// Verify all returned tasks have the requested priority
		for (const task of priorityResponse.data) {
			if (task.priority !== "high") {
				throw new Error(`Priority filtering failed: found task with priority ${task.priority}`);
			}
		}
	}

	async testTcpDaemonConnection(): Promise<void> {
		const isConnected = await this.daemonTcpClient.checkConnection();
		if (!isConnected) {
			throw new Error("Cannot connect to daemon TCP API on port 3001");
		}
	}

	async testEndToEndWorkflow(): Promise<void> {
		// Create a task via dashboard API
		const testTask = {
			title: "End-to-End Test Task",
			description: "Testing complete workflow",
			priority: "medium",
		};

		const createResponse = await this.makeHttpRequest("/api/tasks", "POST", JSON.stringify(testTask));
		if (createResponse.statusCode !== 201 || !createResponse.data.success) {
			throw new Error("Failed to create task in end-to-end test");
		}

		const taskId = createResponse.data.data.id;

		// Verify task appears in tasks list
		const tasksResponse = await this.makeHttpRequest("/api/tasks");
		const createdTask = tasksResponse.data.find((task: any) => task.id === taskId);
		if (!createdTask) {
			throw new Error("Created task not found in tasks list");
		}

		// Update task status via TCP API
		const updateResponse = await this.daemonTcpClient.updateTaskStatus(taskId, "in-progress");
		if (!updateResponse.success) {
			throw new Error("Failed to update task status via TCP API");
		}

		// Verify update is reflected in dashboard
		await new Promise(resolve => setTimeout(resolve, 1000)); // Allow for update propagation
		const updatedTasksResponse = await this.makeHttpRequest("/api/tasks");
		const updatedTask = updatedTasksResponse.data.find((task: any) => task.id === taskId);
		if (updatedTask.status !== "in-progress") {
			throw new Error("Task status not updated in dashboard");
		}

		// Clean up
		await this.daemonTcpClient.updateTaskStatus(taskId, "done");
		await this.daemonTcpClient.deleteTask(taskId);
	}

	async runAllTests(): Promise<TestResult[]> {
		console.log("=== Dashboard Integration Tests ===\n");

		// Test daemon connection first
		await this.runTest("Daemon TCP Connection", () => this.testTcpDaemonConnection());

		// Dashboard HTTP API tests
		await this.runTest("Dashboard Homepage", () => this.testDashboardHomepage());
		await this.runTest("Metrics Endpoint", () => this.testMetricsEndpoint());
		await this.runTest("Tasks Endpoint", () => this.testTasksEndpoint());
		await this.runTest("Task Creation", () => this.testTaskCreation());
		await this.runTest("Task Creation with Invalid Data", () => this.testTaskCreationWithInvalidData());
		await this.runTest("Task Filtering", () => this.testTaskFiltering());

		// End-to-end workflow test
		await this.runTest("End-to-End Workflow", () => this.testEndToEndWorkflow());

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

describe("Dashboard Integration Runner", () => {
    it("runs the integration runner suite", async () => {
        test.skip(!serverAvailable, "Dashboard server unavailable");

        const tester = new DashboardIntegrationTest();
        const results = await tester.runAllTests();
        const failures = results.filter((result) => !result.passed);
        expect(failures.length).toBe(0);
    });
});

