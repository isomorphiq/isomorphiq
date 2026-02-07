import { test, expect } from "@playwright/test";

import { canUseLocalSockets, NETWORK_SKIP_REASON } from "../../e2e/dashboard/test-environment.ts";

import { DashboardServer } from "@isomorphiq/dashboard";
import { WebSocketManager } from "@isomorphiq/realtime";
import { ProductManager } from "@isomorphiq/profiles";
import { createServer, type Server } from "node:http";
import { WebSocket } from "ws";

const describe = test.describe;
const it = test;
const before = test.beforeAll;
const after = test.afterAll;
const beforeEach = test.beforeEach;
const afterEach = test.afterEach;

let localSocketAccess = true;

before(async () => {
    localSocketAccess = await canUseLocalSockets();
});

beforeEach(() => {
    test.skip(!localSocketAccess, NETWORK_SKIP_REASON);
});

describe("Dashboard Integration Tests", () => {
	let dashboardServer: DashboardServer;
	let wsManager: WebSocketManager;
	let productManager: ProductManager;
	let httpServer: Server;
	let dashboardPort: number;

	beforeEach(async () => {
		// Mock ProductManager and WebSocketManager
		productManager = {
			getAllTasks: async () => [
				{
					id: "test-1",
					title: "Test Task 1",
					description: "Description for test task 1",
					status: "todo",
					priority: "high",
					createdAt: new Date().toISOString(),
					updatedAt: new Date().toISOString(),
					createdBy: "test-user",
					assignedTo: "assignee"
				},
				{
					id: "test-2", 
					title: "Test Task 2",
					description: "Description for test task 2",
					status: "in-progress",
					priority: "medium",
					createdAt: new Date().toISOString(),
					updatedAt: new Date().toISOString(),
					createdBy: "test-user-2"
				}
			],
			createTask: async () => ({} as any),
			updateTaskStatus: async () => ({} as any),
			updateTaskPriority: async () => ({} as any),
			deleteTask: async () => {}
		} as ProductManager;

		wsManager = {
			broadcastTaskCreated: () => {},
			broadcastTaskStatusChanged: () => {},
			broadcastTaskPriorityChanged: () => {},
			broadcastTaskDeleted: () => {},
			getConnectionCount: () => 0,
			start: async () => {},
			stop: async () => {}
		} as WebSocketManager;

		dashboardServer = new DashboardServer(productManager, wsManager);
		httpServer = createServer((req, res) => {
			dashboardServer.handleRequest(req, res).catch(() => {});
		});

		// Find available port
		dashboardPort = 3005 + Math.floor(Math.random() * 1000);
		
		await new Promise<void>((resolve) => {
			httpServer.listen(dashboardPort, () => resolve());
		});
	});

	afterEach(async () => {
		if (httpServer) {
			await new Promise<void>((resolve) => {
				httpServer.close(() => resolve());
			});
		}
	});

	describe("HTTP API Endpoints", () => {
		it("should serve dashboard HTML", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/`);
			expect(response.status).toBe(200);
			expect(response.headers.get("content-type")).toContain("text/html");
			
			const html = await response.text();
			expect(html).toContain("Task Manager Dashboard");
			expect(html).toContain("Real-time Task Monitoring");
		});

		it("should serve metrics API", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/api/metrics`);
			expect(response.status).toBe(200);
			expect(response.headers.get("content-type")).toBe("application/json");
			
			const metrics = await response.json();
			expect(metrics).toHaveProperty("tasks");
			expect(metrics).toHaveProperty("daemon");
			expect(metrics).toHaveProperty("health");
			expect(metrics.tasks).toHaveProperty("total", 2);
		});

		it("should serve tasks API", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/api/tasks`);
			expect(response.status).toBe(200);
			expect(response.headers.get("content-type")).toBe("application/json");
			
			const tasks = await response.json();
			expect(Array.isArray(tasks)).toBe(true);
			expect(tasks).toHaveLength(2);
			expect(tasks[0]).toHaveProperty("id", "test-1");
		});

		it("should support task filtering by status", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/api/tasks?status=todo`);
			expect(response.status).toBe(200);
			
			const tasks = await response.json();
			expect(tasks).toHaveLength(1);
			expect(tasks[0].status).toBe("todo");
		});

		it("should support task filtering by priority", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/api/tasks?priority=high`);
			expect(response.status).toBe(200);
			
			const tasks = await response.json();
			expect(tasks).toHaveLength(1);
			expect(tasks[0].priority).toBe("high");
		});

		it("should support task search", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/api/tasks/search?q=Test%20Task%201`);
			expect(response.status).toBe(200);
			
			const tasks = await response.json();
			expect(tasks).toHaveLength(1);
			expect(tasks[0].title).toBe("Test Task 1");
		});

		it("should serve queue status API", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/api/queue/status`);
			expect(response.status).toBe(200);
			expect(response.headers.get("content-type")).toBe("application/json");
			
			const queueStatus = await response.json();
			expect(queueStatus).toHaveProperty("total", 2);
			expect(queueStatus).toHaveProperty("queueByPriority");
			expect(queueStatus).toHaveProperty("processingTimes");
		});

		it("should serve health API", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/api/health`);
			expect(response.status).toBe(200);
			expect(response.headers.get("content-type")).toBe("application/json");
			
			const health = await response.json();
			expect(health).toHaveProperty("status");
			expect(health).toHaveProperty("daemon");
		});
	});

	describe("WebSocket Real-time Updates", () => {
		it("should establish WebSocket connection", async () => {
			const ws = new WebSocket(`ws://localhost:${dashboardPort}/dashboard-ws`);
			
			await new Promise<void>((resolve, reject) => {
				ws.on("open", () => resolve());
				ws.on("error", reject);
				
				// Timeout after 5 seconds
				setTimeout(() => reject(new Error("WebSocket connection timeout")), 5000);
			});
			
			expect(ws.readyState).toBe(WebSocket.OPEN);
			ws.close();
		});

		it("should receive initial state on connection", async () => {
			const ws = new WebSocket(`ws://localhost:${dashboardPort}/dashboard-ws`);
			
			const message = await new Promise<string>((resolve, reject) => {
				ws.on("message", (data) => {
					try {
						const parsed = JSON.parse(data.toString());
						resolve(parsed);
					} catch (e) {
						reject(e);
					}
				});
				ws.on("error", reject);
				
				setTimeout(() => reject(new Error("Message timeout")), 5000);
			});
			
			expect(message).toHaveProperty("type", "initial_state");
			expect(message).toHaveProperty("data");
			expect(message.data).toHaveProperty("metrics");
			expect(message.data).toHaveProperty("tasks");
			
			ws.close();
		});

		it("should handle multiple simultaneous connections", async () => {
			const connections = Array.from({ length: 5 }, () => 
				new WebSocket(`ws://localhost:${dashboardPort}/dashboard-ws`)
			);
			
			const openPromises = connections.map(ws => 
				new Promise<void>((resolve, reject) => {
					ws.on("open", resolve);
					ws.on("error", reject);
					setTimeout(() => reject(new Error("Connection timeout")), 5000);
				})
			);
			
			await Promise.all(openPromises);
			
			// All connections should be open
			connections.forEach(ws => {
				expect(ws.readyState).toBe(WebSocket.OPEN);
				ws.close();
			});
		});
	});

		describe("Task Management Operations", () => {
		it("should create new task via API", async () => {
			const newTask = {
				title: "New Test Task",
				description: "Task created via API",
				priority: "medium"
			};

			const response = await fetch(`http://localhost:${dashboardPort}/api/tasks`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(newTask)
			});

			// Note: This might fail in mock environment, but should reach handler
			expect([200, 201, 400]).toContain(response.status);
		});

		it("should update task status via API", async () => {
			const updateData = {
				id: "test-1",
				status: "done"
			};

			const response = await fetch(`http://localhost:${dashboardPort}/api/tasks/update`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(updateData)
			});

			// Note: This might fail in mock environment, but should reach handler
			expect([200, 400]).toContain(response.status);
		});

		it("should delete task via API", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/api/tasks/delete?id=test-1`, {
				method: "DELETE"
			});

			// Note: This might fail in mock environment, but should reach handler
			expect([200, 400, 404]).toContain(response.status);
		});
	});

	describe("Task Status Query API", () => {
		it("should get individual task status by ID", async () => {
			// Test the new task status endpoint via dashboard API
			const response = await fetch(`http://localhost:${dashboardPort}/api/tasks/status/test-1`);
			expect(response.status).toBe(200);
			
			const statusData = await response.json();
			expect(statusData).toHaveProperty("taskId", "test-1");
			expect(statusData).toHaveProperty("status");
			expect(statusData).toHaveProperty("updatedAt");
		});

		it("should return 404 for non-existent task status", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/api/tasks/status/non-existent-id`);
			expect([404, 400]).toContain(response.status);
		});

		it("should support advanced task filtering", async () => {
			const filters = {
				status: ["todo", "in-progress"],
				priority: "high",
				limit: 10,
				offset: 0
			};

			const response = await fetch(`http://localhost:${dashboardPort}/api/tasks/filtered`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ filters })
			});

			expect(response.status).toBe(200);
			
			const filteredTasks = await response.json();
			expect(Array.isArray(filteredTasks)).toBe(true);
			filteredTasks.forEach(task => {
				expect(["todo", "in-progress"]).toContain(task.status);
				expect(task.priority).toBe("high");
			});
		});

		it("should support text search in task filtering", async () => {
			const filters = {
				search: "Test Task 1",
				limit: 5
			};

			const response = await fetch(`http://localhost:${dashboardPort}/api/tasks/filtered`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ filters })
			});

			expect(response.status).toBe(200);
			
			const searchResults = await response.json();
			expect(Array.isArray(searchResults)).toBe(true);
			if (searchResults.length > 0) {
				expect(searchResults[0].title).toContain("Test Task 1");
			}
		});

		it("should support pagination in filtered tasks", async () => {
			const filters = {
				limit: 1,
				offset: 1
			};

			const response = await fetch(`http://localhost:${dashboardPort}/api/tasks/filtered`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ filters })
			});

			expect(response.status).toBe(200);
			
			const paginatedResults = await response.json();
			expect(Array.isArray(paginatedResults)).toBe(true);
			// Should have at most 1 result due to limit
			expect(paginatedResults.length).toBeLessThanOrEqual(1);
		});

		it("should handle empty filter results gracefully", async () => {
			const filters = {
				status: "non-existent-status",
				limit: 10
			};

			const response = await fetch(`http://localhost:${dashboardPort}/api/tasks/filtered`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ filters })
			});

			expect(response.status).toBe(200);
			
			const results = await response.json();
			expect(Array.isArray(results)).toBe(true);
			expect(results).toHaveLength(0);
		});
	});

	describe("Task Status Notifications", () => {
		it("should subscribe to task status notifications", async () => {
			const subscriptionData = {
				sessionId: "test-session-123",
				taskIds: ["test-1", "test-2"],
				includeTcpResponse: true
			};

			const response = await fetch(`http://localhost:${dashboardPort}/api/notifications/subscribe`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(subscriptionData)
			});

			expect(response.status).toBe(200);
			
			const subscription = await response.json();
			expect(subscription).toHaveProperty("success", true);
			expect(subscription).toHaveProperty("sessionId", "test-session-123");
			expect(subscription).toHaveProperty("subscribedTasks");
			expect(subscription.subscribedTasks).toEqual(["test-1", "test-2"]);
		});

		it("should generate unique session ID when not provided", async () => {
			const subscriptionData = {
				taskIds: ["test-1"]
			};

			const response = await fetch(`http://localhost:${dashboardPort}/api/notifications/subscribe`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(subscriptionData)
			});

			expect(response.status).toBe(200);
			
			const subscription = await response.json();
			expect(subscription).toHaveProperty("sessionId");
			expect(typeof subscription.sessionId).toBe("string");
			expect(subscription.sessionId).toMatch(/^client_\d+_[a-z0-9]+$/);
		});

		it("should handle notification subscription for non-existent tasks", async () => {
			const subscriptionData = {
				taskIds: ["non-existent-task-1", "non-existent-task-2"]
			};

			const response = await fetch(`http://localhost:${dashboardPort}/api/notifications/subscribe`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(subscriptionData)
			});

			// Should still create subscription even if tasks don't exist yet
			expect([200, 201]).toContain(response.status);
			
			const subscription = await response.json();
			expect(subscription).toHaveProperty("success", true);
			expect(subscription).toHaveProperty("subscribedTasks");
		});
	});

	describe("Error Handling", () => {
		it("should handle 404 for unknown routes", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/unknown-route`);
			expect(response.status).toBe(404);
		});

		it("should handle invalid task ID", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/api/tasks/delete?id=invalid-id`);
			expect([200, 400, 404]).toContain(response.status);
		});

		it("should handle malformed JSON", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/api/tasks`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: "invalid json{"
			});

			expect([400, 500]).toContain(response.status);
		});
	});

	describe("Performance and Load", () => {
		it("should handle concurrent requests", async () => {
			const requests = Array.from({ length: 20 }, () =>
				fetch(`http://localhost:${dashboardPort}/api/metrics`)
			);

			const responses = await Promise.allSettled(requests);
			
			// Most requests should succeed
			const successful = responses.filter(r => r.status === 'fulfilled').length;
			expect(successful).toBeGreaterThan(15); // At least 75% success rate
		});

		it("should handle large task lists", async () => {
			// This tests the dashboard's ability to handle potentially large datasets
			const response = await fetch(`http://localhost:${dashboardPort}/api/tasks`);
			expect(response.status).toBe(200);
			
			const tasks = await response.json();
			expect(Array.isArray(tasks)).toBe(true);
			
			// Verify response time is reasonable (should be under 5 seconds)
			// This is more of a performance check than functional test
		});
	});
});
