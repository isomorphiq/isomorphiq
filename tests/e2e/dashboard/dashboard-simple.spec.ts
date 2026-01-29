import { describe, it, beforeEach, afterEach } from "node:test";
import { expect } from "../../../test-utils/expect.ts";
import { DashboardServer } from "@isomorphiq/daemon";
import { WebSocketManager } from "@isomorphiq/realtime";
import { ProductManager } from "@isomorphiq/tasks";
import { createServer, type Server } from "node:http";

describe("Dashboard Core Functionality", () => {
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
				}
			],
			createTask: async () => ({} as any),
			updateTaskStatus: async () => ({} as any),
			updateTaskPriority: async () => ({} as any),
			deleteTask: async () => {}
		} as unknown as ProductManager;

		wsManager = {
			broadcastTaskCreated: () => {},
			broadcastTaskStatusChanged: () => {},
			broadcastTaskPriorityChanged: () => {},
			broadcastTaskDeleted: () => {},
			getConnectionCount: () => 0,
			start: async () => {},
			stop: async () => {}
		} as unknown as WebSocketManager;

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

	it("should serve dashboard HTML", async () => {
		const response = await fetch(`http://localhost:${dashboardPort}/`);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("text/html");
		
		const html = await response.text();
		expect(html).toContain("Task Manager Dashboard");
	});

	it("should serve metrics API", async () => {
		const response = await fetch(`http://localhost:${dashboardPort}/api/metrics`);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("application/json");
		
		const metrics = await response.json();
		expect(metrics).toHaveProperty("tasks");
		expect(metrics).toHaveProperty("daemon");
		expect(metrics).toHaveProperty("health");
		expect(metrics.tasks).toHaveProperty("total", 1);
	});

	it("should serve tasks API", async () => {
		const response = await fetch(`http://localhost:${dashboardPort}/api/tasks`);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("application/json");
		
		const tasks = await response.json();
		expect(Array.isArray(tasks)).toBe(true);
		expect(tasks).toHaveLength(1);
		expect(tasks[0]).toHaveProperty("id", "test-1");
	});

	it("should support task filtering by status", async () => {
		const response = await fetch(`http://localhost:${dashboardPort}/api/tasks?status=todo`);
		expect(response.status).toBe(200);
		
		const tasks = await response.json();
		expect(tasks).toHaveLength(1);
		expect(tasks[0].status).toBe("todo");
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
		expect(queueStatus).toHaveProperty("total", 1);
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

	it("should handle 404 for unknown routes", async () => {
		const response = await fetch(`http://localhost:${dashboardPort}/unknown-route`);
		expect(response.status).toBe(404);
	});
});
