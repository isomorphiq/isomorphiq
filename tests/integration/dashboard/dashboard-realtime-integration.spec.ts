import { test, expect } from "@playwright/test";

import { canReachDashboard, canUseLocalSockets, NETWORK_SKIP_REASON } from "../../e2e/dashboard/test-environment.ts";

import { strict as assert } from "node:assert";
import { WebSocket } from "ws";

const describe = test.describe;
const it = test;
const before = test.beforeAll;
const after = test.afterAll;
const beforeEach = test.beforeEach;
const afterEach = test.afterEach;

let localSocketAccess = true;
let dashboardReachable = false;

before(async () => {
    localSocketAccess = await canUseLocalSockets();
    dashboardReachable = await canReachDashboard("http://localhost:3006");
});

beforeEach(() => {
    test.skip(!localSocketAccess, NETWORK_SKIP_REASON);
    test.skip(!dashboardReachable, "Dashboard server is not reachable at http://localhost:3006");
});

// Test configuration
const DASHBOARD_PORT = 3006; // Use different port to avoid conflicts
const TEST_TIMEOUT = 10000; // 10 seconds

describe("Dashboard Real-time Updates Integration Tests", () => {
	let wsConnection: WebSocket | null = null;
	let dashboardBaseUrl: string;

	before(async () => {
		// Set up test environment
		dashboardBaseUrl = `http://localhost:${DASHBOARD_PORT}`;
		console.log(`[TEST] Setting up dashboard tests on port ${DASHBOARD_PORT}`);
	});

	after(async () => {
		// Cleanup
		if (wsConnection) {
			wsConnection.close();
		}
		console.log("[TEST] Dashboard tests completed");
	});

	beforeEach(async () => {
		// Establish WebSocket connection before each test
		await connectWebSocket();
	});

	afterEach(async () => {
		// Clean up WebSocket connection after each test
		if (wsConnection) {
			wsConnection.close();
			wsConnection = null;
		}
		await new Promise(resolve => setTimeout(resolve, 100));
	});

	async function connectWebSocket(): Promise<void> {
		return new Promise((resolve, reject) => {
			const wsUrl = `ws://localhost:${DASHBOARD_PORT}/dashboard-ws`;
			wsConnection = new WebSocket(wsUrl);

			const timeout = setTimeout(() => {
				reject(new Error("WebSocket connection timeout"));
			}, 5000);

			wsConnection.on("open", () => {
				clearTimeout(timeout);
				console.log("[TEST] WebSocket connected for dashboard testing");
				resolve();
			});

			wsConnection.on("error", (error) => {
				clearTimeout(timeout);
				console.log("[TEST] WebSocket error:", error);
				reject(error);
			});
		});
	}

	function waitForMessage(type: string, timeout: number = TEST_TIMEOUT): Promise<any> {
		return new Promise((resolve, reject) => {
			if (!wsConnection) {
				reject(new Error("WebSocket not connected"));
				return;
			}

			const messageTimeout = setTimeout(() => {
				reject(new Error(`Timeout waiting for ${type} message`));
			}, timeout);

			wsConnection.on("message", (event: any) => {
				try {
					const message = JSON.parse(event.data.toString());
					if (message.type === type) {
						clearTimeout(messageTimeout);
						resolve(message);
					}
				} catch (error) {
					clearTimeout(messageTimeout);
					reject(error);
				}
			});
		});
	}

	describe("WebSocket Connection Tests", () => {
		it("should establish WebSocket connection", async () => {
			assert.ok(wsConnection, "WebSocket connection should be established");
			assert.equal(wsConnection.readyState, WebSocket.OPEN, "WebSocket should be in open state");
		});

		it("should receive initial state on connection", async () => {
			const message = await waitForMessage("initial_state");
			assert.ok(message.data, "Should receive initial state data");
			assert.ok(message.data.metrics, "Should contain metrics data");
			assert.ok(message.data.tasks, "Should contain tasks data");
		});
	});

	describe("Real-time Metrics Updates", () => {
		it("should receive metrics updates periodically", async () => {
			// Wait for at least one metrics update
			const message = await waitForMessage("metrics_update");
			assert.ok(message.data, "Should receive metrics update data");
			
			// Verify metrics structure
			const metrics = message.data;
			assert.ok(metrics.daemon, "Should contain daemon metrics");
			assert.ok(metrics.tasks, "Should contain task metrics");
			assert.ok(metrics.health, "Should contain health metrics");
			assert.ok(metrics.system, "Should contain system metrics");

			// Verify specific metric fields
			assert.ok(typeof metrics.daemon.uptime === "number", "Daemon uptime should be a number");
			assert.ok(typeof metrics.tasks.total === "number", "Total tasks should be a number");
		});

		it("should receive queue status updates", async () => {
			const message = await waitForMessage("queue_status_update");
			assert.ok(message.data, "Should receive queue status update data");

			const queueStatus = message.data;
			assert.ok(typeof queueStatus.total === "number", "Total queue should be a number");
			assert.ok(typeof queueStatus.pending === "number", "Pending tasks should be a number");
			assert.ok(typeof queueStatus.inProgress === "number", "In-progress tasks should be a number");
		});
	});

	describe("API Integration Tests", () => {
		it("should fetch tasks via API", async () => {
			const response = await fetch(`${dashboardBaseUrl}/api/tasks`);
			assert.ok(response.ok, "Tasks API should respond successfully");

			const tasks = await response.json();
			assert.ok(Array.isArray(tasks), "Should return an array of tasks");
		});

		it("should fetch metrics via API", async () => {
			const response = await fetch(`${dashboardBaseUrl}/api/metrics`);
			assert.ok(response.ok, "Metrics API should respond successfully");

			const metrics = await response.json();
			assert.ok(metrics, "Should return metrics object");
			assert.ok(metrics.daemon, "Should contain daemon metrics");
			assert.ok(metrics.tasks, "Should contain task metrics");
		});

		it("should fetch queue status via API", async () => {
			const response = await fetch(`${dashboardBaseUrl}/api/queue/status`);
			assert.ok(response.ok, "Queue status API should respond successfully");

			const queueStatus = await response.json();
			assert.ok(queueStatus, "Should return queue status object");
			assert.ok(typeof queueStatus.total === "number", "Should contain total count");
		});

		it("should support task filtering", async () => {
			const response = await fetch(`${dashboardBaseUrl}/api/tasks/search?q=test&status=todo`);
			assert.ok(response.ok, "Task search API should respond successfully");

			const tasks = await response.json();
			assert.ok(Array.isArray(tasks), "Should return an array of filtered tasks");
		});
	});

	describe("Error Handling Tests", () => {
		it("should handle WebSocket connection errors gracefully", async () => {
			// Try connecting to invalid port to test error handling
			const invalidWs = new WebSocket(`ws://localhost:9999/dashboard-ws`);
			
			await new Promise<void>((resolve) => {
				invalidWs.on("error", () => {
					resolve();
				});
			});

			assert.ok(true, "Should handle connection errors gracefully");
		});

		it("should handle invalid API requests", async () => {
			const response = await fetch(`${dashboardBaseUrl}/api/invalid-endpoint`);
			assert.equal(response.status, 404, "Should return 404 for invalid endpoint");
		});

		it("should handle malformed request data", async () => {
			const response = await fetch(`${dashboardBaseUrl}/api/tasks`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: "invalid json"
			});

			assert.equal(response.status, 400, "Should return 400 for malformed data");
		});
	});

	describe("Dashboard UI Tests", () => {
		it("should serve dashboard HTML page", async () => {
			const response = await fetch(dashboardBaseUrl);
			assert.ok(response.ok, "Should serve dashboard page");
			
			const html = await response.text();
			assert.ok(html.includes("<!DOCTYPE html>"), "Should serve valid HTML");
			assert.ok(html.includes("Task Manager Dashboard"), "Should include dashboard title");
		});

		it("should include WebSocket connection script", async () => {
			const response = await fetch(dashboardBaseUrl);
			const html = await response.text();
			
			assert.ok(html.includes("WebSocket"), "Should include WebSocket code");
			assert.ok(html.includes("dashboard-ws"), "Should include correct WebSocket endpoint");
		});
	});
});
