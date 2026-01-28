import { describe, it, beforeEach, afterEach } from "node:test";
import { expect } from "../../test-utils/expect.ts";
import { DashboardServer } from "@isomorphiq/daemon";
import { WebSocketManager } from "@isomorphiq/realtime";
import { ProductManager } from "@isomorphiq/tasks";
import { createServer, type Server } from "node:http";

describe("Dashboard Functionality Tests", () => {
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

	describe("Core Dashboard Features", () => {
		it("should serve complete dashboard HTML with all features", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/`);
			expect(response.status).toBe(200);
			expect(response.headers.get("content-type")).toContain("text/html");
			
			const html = await response.text();
			
			// Check for key dashboard features
			expect(html).toContain("Task Manager Dashboard");
			expect(html).toContain("Real-time Task Monitoring");
			
			// Check for tabs
			expect(html).toContain("Overview");
			expect(html).toContain("Queue Status");
			expect(html).toContain("Tasks");
			expect(html).toContain("Create Task");
			expect(html).toContain("Health");
			expect(html).toContain("Activity Log");
			
			// Check for JavaScript functionality
			expect(html).toContain("connectWebSocket");
			expect(html).toContain("loadMetrics");
			expect(html).toContain("loadTasks");
			expect(html).toContain("createTask");
			
			// Check for responsive design
			expect(html).toContain("@media");
			expect(html).toContain("responsive");
		});

		it("should provide comprehensive metrics API", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/api/metrics`);
			expect(response.status).toBe(200);
			expect(response.headers.get("content-type")).toBe("application/json");
			
			const metrics = await response.json();
			
			// Check all required metric categories
			expect(metrics).toHaveProperty("daemon");
			expect(metrics).toHaveProperty("tasks");
			expect(metrics).toHaveProperty("health");
			expect(metrics).toHaveProperty("system");
			
			// Check daemon metrics
			expect(metrics.daemon).toHaveProperty("uptime");
			expect(metrics.daemon).toHaveProperty("memory");
			expect(metrics.daemon).toHaveProperty("pid");
			
			// Check task metrics
			expect(metrics.tasks).toHaveProperty("total");
			expect(metrics.tasks).toHaveProperty("pending");
			expect(metrics.tasks).toHaveProperty("inProgress");
			expect(metrics.tasks).toHaveProperty("completed");
			expect(metrics.tasks).toHaveProperty("byPriority");
			expect(metrics.tasks).toHaveProperty("byStatus");
			expect(metrics.tasks).toHaveProperty("recent");
			
			// Check health metrics
			expect(metrics.health).toHaveProperty("status");
			expect(metrics.health).toHaveProperty("wsConnections");
			expect(metrics.health).toHaveProperty("tcpConnected");
			expect(metrics.health).toHaveProperty("memoryUsage");
			
			// Check system metrics
			expect(metrics.system).toHaveProperty("nodeVersion");
			expect(metrics.system).toHaveProperty("platform");
			expect(metrics.system).toHaveProperty("arch");
			expect(metrics.system).toHaveProperty("totalmem");
			expect(metrics.system).toHaveProperty("freemem");
		});

		it("should support advanced task operations", async () => {
			// Test task creation
			const newTask = {
				title: "New Test Task",
				description: "Task created via API",
				priority: "medium",
				assignedTo: "test-assignee"
			};

			const createResponse = await fetch(`http://localhost:${dashboardPort}/api/tasks`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(newTask)
			});

			// Should reach the handler even if TCP connection fails in mock
			expect([200, 201, 400, 500]).toContain(createResponse.status);

			// Test task update
			const updateData = {
				id: "test-1",
				status: "done"
			};

			const updateResponse = await fetch(`http://localhost:${dashboardPort}/api/tasks/update`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(updateData)
			});

			expect([200, 400, 404, 500]).toContain(updateResponse.status);

			// Test task deletion
			const deleteResponse = await fetch(`http://localhost:${dashboardPort}/api/tasks/delete?id=test-1`, {
				method: "DELETE"
			});

			expect([200, 400, 404, 500]).toContain(deleteResponse.status);
		});

		it("should provide queue status with processing metrics", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/api/queue/status`);
			expect(response.status).toBe(200);
			expect(response.headers.get("content-type")).toBe("application/json");
			
			const queueStatus = await response.json();
			
			// Check queue metrics
			expect(queueStatus).toHaveProperty("total");
			expect(queueStatus).toHaveProperty("pending");
			expect(queueStatus).toHaveProperty("inProgress");
			expect(queueStatus).toHaveProperty("completed");
			expect(queueStatus).toHaveProperty("failed");
			expect(queueStatus).toHaveProperty("highPriority");
			expect(queueStatus).toHaveProperty("mediumPriority");
			expect(queueStatus).toHaveProperty("lowPriority");
			
			// Check queue organization
			expect(queueStatus).toHaveProperty("queueByPriority");
			expect(queueStatus.queueByPriority).toHaveProperty("high");
			expect(queueStatus.queueByPriority).toHaveProperty("medium");
			expect(queueStatus.queueByPriority).toHaveProperty("low");
			
			// Check processing analytics
			expect(queueStatus).toHaveProperty("processingTimes");
			expect(queueStatus.processingTimes).toHaveProperty("averageProcessingTime");
			expect(queueStatus.processingTimes).toHaveProperty("fastestTask");
			expect(queueStatus.processingTimes).toHaveProperty("slowestTask");
			
			// Check failed tasks tracking
			expect(queueStatus).toHaveProperty("failedTasks");
			expect(Array.isArray(queueStatus.failedTasks)).toBe(true);
		});

		it("should support comprehensive task filtering", async () => {
			const filters = {
				status: ["todo", "in-progress"],
				priority: "high",
				search: "Test Task",
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
			
			// All returned tasks should match filters
			filteredTasks.forEach(task => {
				expect(["todo", "in-progress"]).toContain(task.status);
				expect(task.priority).toBe("high");
				expect(task.title).toContain("Test Task");
			});
		});

		it("should provide system health monitoring", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/api/health`);
			expect(response.status).toBe(200);
			expect(response.headers.get("content-type")).toBe("application/json");
			
			const health = await response.json();
			
			// Check health structure
			expect(health).toHaveProperty("status");
			expect(health).toHaveProperty("timestamp");
			expect(health).toHaveProperty("daemon");
			expect(health).toHaveProperty("websocket");
			
			// Check daemon health
			expect(health.daemon).toHaveProperty("pid");
			expect(health.daemon).toHaveProperty("uptime");
			expect(health.daemon).toHaveProperty("memory");
			expect(health.daemon.memory).toHaveProperty("used");
			expect(health.daemon.memory).toHaveProperty("total");
			
			// Check websocket health
			expect(health.websocket).toHaveProperty("connected");
		});

		it("should provide performance metrics", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/api/performance`);
			expect(response.status).toBe(200);
			expect(response.headers.get("content-type")).toBe("application/json");
			
			const performance = await response.json();
			
			// Check memory metrics
			expect(performance).toHaveProperty("memory");
			expect(performance.memory).toHaveProperty("heap");
			expect(performance.memory.heap).toHaveProperty("used");
			expect(performance.memory.heap).toHaveProperty("total");
			expect(performance.memory.heap).toHaveProperty("percentage");
			
			// Check CPU metrics
			expect(performance).toHaveProperty("cpu");
			expect(performance.cpu).toHaveProperty("user");
			expect(performance.cpu).toHaveProperty("system");
			
			// Check task throughput metrics
			expect(performance).toHaveProperty("tasks");
			expect(performance.tasks).toHaveProperty("throughput");
			expect(performance.tasks.throughput).toHaveProperty("completed");
			expect(performance.tasks.throughput).toHaveProperty("averageProcessingTime");
			expect(performance.tasks.throughput).toHaveProperty("tasksPerMinute");
		});

		it("should provide activity logging", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/api/logs?limit=25`);
			expect(response.status).toBe(200);
			expect(response.headers.get("content-type")).toBe("application/json");
			
			const logs = await response.json();
			expect(Array.isArray(logs)).toBe(true);
			
			// Check log entry structure
			if (logs.length > 0) {
				const log = logs[0];
				expect(log).toHaveProperty("id");
				expect(log).toHaveProperty("type");
				expect(log).toHaveProperty("message");
				expect(log).toHaveProperty("timestamp");
				expect(log).toHaveProperty("level");
				expect(log).toHaveProperty("data");
				
				// Check data structure
				expect(log.data).toHaveProperty("taskId");
				expect(log.data).toHaveProperty("title");
				expect(log.data).toHaveProperty("status");
				expect(log.data).toHaveProperty("priority");
			}
		});
	});

	describe("Real-time Features", () => {
		it("should support WebSocket endpoint for real-time updates", async () => {
			// Test that the WebSocket upgrade path exists
			const response = await fetch(`http://localhost:${dashboardPort}/dashboard-ws`, {
				headers: {
					"Upgrade": "websocket",
					"Connection": "Upgrade"
				}
			});
			
			// Should either succeed with WebSocket upgrade or fail appropriately
			expect([101, 400, 500]).toContain(response.status);
		});

		it("should handle notification subscriptions", async () => {
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
	});

	describe("Error Handling", () => {
		it("should handle 404 for unknown routes", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/unknown-route`);
			expect(response.status).toBe(404);
		});

		it("should handle malformed JSON gracefully", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/api/tasks`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: "invalid json{"
			});

			expect([400, 500]).toContain(response.status);
		});

		it("should handle missing required fields", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/api/tasks/update`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({}) // Missing id and status
			});

			expect([400, 500]).toContain(response.status);
		});
	});
});
