import { describe, it, beforeEach, afterEach } from "node:test";
import { expect } from "../../test-utils/expect.ts";
import { DashboardServer } from "@isomorphiq/daemon";
import { WebSocketManager } from "@isomorphiq/realtime";
import { ProductManager } from "@isomorphiq/tasks";
import { createServer, type Server } from "node:http";

describe("Dashboard Server Tests", () => {
	let dashboardServer: DashboardServer;
	let wsManager: WebSocketManager;
	let productManager: ProductManager;
	let httpServer: Server;
	let dashboardPort: number;

	beforeEach(async () => {
		// Mock ProductManager
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
		} as unknown as ProductManager;

		// Mock WebSocketManager
		wsManager = {
			broadcastTaskCreated: () => {},
			broadcastTaskStatusChanged: () => {},
			broadcastTaskPriorityChanged: () => {},
			broadcastTaskDeleted: () => {},
			broadcastTasksList: () => {},
			stop: async () => {},
			start: async () => {},
			getConnectionCount: () => 0
		} as unknown as WebSocketManager;

		dashboardServer = new DashboardServer(productManager, wsManager);
		
		// Find available port
		dashboardPort = 3005 + Math.floor(Math.random() * 1000);
		
		httpServer = createServer((req, res) => {
			dashboardServer.handleRequest(req, res).catch((error) => {
				console.error("[TEST] Error handling request:", error);
				res.writeHead(500, { "Content-Type": "text/plain" });
				res.end("Internal Server Error");
			});
		});

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

	describe("Basic Dashboard Functionality", () => {
		it("should load dashboard homepage", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/`);
			expect(response.status).toBe(200);
			expect(response.headers.get("content-type")).toContain("text/html");
			
			const html = await response.text();
			expect(html).toContain("Task Manager Dashboard");
		});

		it("should fetch and display metrics", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/api/metrics`);
			expect(response.status).toBe(200);
			
			const metrics = await response.json();
			expect(metrics).toHaveProperty("tasks");
			expect(metrics).toHaveProperty("daemon");
			expect(metrics).toHaveProperty("health");
			expect(metrics.tasks.total).toBe(2);
			expect(metrics.health.status).toBe("healthy");
		});

		it("should fetch and display task list", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/api/tasks`);
			expect(response.status).toBe(200);
			
			const tasks = await response.json();
			expect(Array.isArray(tasks)).toBe(true);
			expect(tasks.length).toBe(2);
		});

		it("should handle 404 for unknown routes", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/unknown-route`);
			expect(response.status).toBe(404);
		});
	});

	describe("Task Management", () => {
		it("should filter tasks by status", async () => {
			const todoResponse = await fetch(`http://localhost:${dashboardPort}/api/tasks?status=todo`);
			const todoTasks = await todoResponse.json();
			expect(todoTasks.length).toBe(1);
			expect(todoTasks[0].status).toBe("todo");

			const inProgressResponse = await fetch(`http://localhost:${dashboardPort}/api/tasks?status=in-progress`);
			const inProgressTasks = await inProgressResponse.json();
			expect(inProgressTasks.length).toBe(1);
			expect(inProgressTasks[0].status).toBe("in-progress");
		});

		it("should filter tasks by priority", async () => {
			const highResponse = await fetch(`http://localhost:${dashboardPort}/api/tasks?priority=high`);
			const highTasks = await highResponse.json();
			expect(highTasks.length).toBe(1);
			expect(highTasks[0].priority).toBe("high");

			const mediumResponse = await fetch(`http://localhost:${dashboardPort}/api/tasks?priority=medium`);
			const mediumTasks = await mediumResponse.json();
			expect(mediumTasks.length).toBe(1);
			expect(mediumTasks[0].priority).toBe("medium");
		});

		it("should search tasks by text", async () => {
			const searchResponse = await fetch(`http://localhost:${dashboardPort}/api/tasks/search?q=Test`);
			const searchResults = await searchResponse.json();
			expect(searchResults.length).toBe(2);
			expect(searchResults.every(task => task.title.includes("Test"))).toBe(true);
		});
	});

	describe("Health and Status", () => {
		it("should provide health status", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/api/health`);
			expect(response.status).toBe(200);
			
			const health = await response.json();
			expect(health).toHaveProperty("status");
			expect(health).toHaveProperty("daemon");
			expect(health).toHaveProperty("timestamp");
		});

		it("should provide system status", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/api/status`);
			expect(response.status).toBe(200);
			
			const status = await response.json();
			expect(status).toHaveProperty("daemon");
			expect(status).toHaveProperty("tasks");
			expect(status).toHaveProperty("connections");
			expect(status).toHaveProperty("timestamp");
		});

		it("should provide performance metrics", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/api/performance`);
			expect(response.status).toBe(200);
			
			const performance = await response.json();
			expect(performance).toHaveProperty("memory");
			expect(performance).toHaveProperty("tasks");
			expect(performance).toHaveProperty("daemon");
		});
	});

	describe("Queue Management", () => {
		it("should provide queue status", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/api/queue/status`);
			expect(response.status).toBe(200);
			
			const queue = await response.json();
			expect(queue).toHaveProperty("total");
			expect(queue).toHaveProperty("pending");
			expect(queue).toHaveProperty("inProgress");
			expect(queue).toHaveProperty("completed");
		});
	});
});