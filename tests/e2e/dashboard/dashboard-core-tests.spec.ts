import { describe, it, beforeEach, afterEach } from "node:test";
import { expect } from "../../test-utils/expect.ts";
import { DashboardServer } from "@isomorphiq/dashboard";
import { WebSocketManager } from "@isomorphiq/realtime";
import { ProductManager } from "@isomorphiq/user-profile";
import { createServer, type Server } from "node:http";

describe("Dashboard Core Functionality Tests", () => {
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
				},
				{
					id: "test-3",
					title: "Completed Task",
					description: "Description for completed task",
					status: "done",
					priority: "low",
					createdAt: new Date(Date.now() - 3600000).toISOString(),
					updatedAt: new Date(Date.now() - 1800000).toISOString(),
					createdBy: "test-user"
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
			getConnectionCount: () => 3,
			start: async () => {},
			stop: async () => {}
		} as unknown as WebSocketManager;

		dashboardServer = new DashboardServer(productManager, wsManager);
		
		// Create test HTTP server
		httpServer = createServer((req, res) => {
			dashboardServer.handleRequest(req, res).catch(() => {
				res.writeHead(500).end("Internal Server Error");
			});
		});

		// Find available port
		dashboardPort = 3005 + Math.floor(Math.random() * 1000);
		
		await new Promise<void>((resolve, reject) => {
			httpServer.listen(dashboardPort, resolve);
			httpServer.on('error', reject);
		});
	});

	afterEach(async () => {
		if (httpServer) {
			httpServer.close();
		}
	});

	describe("Basic Dashboard Operations", () => {
		it("should create dashboard server instance", () => {
			expect(dashboardServer).toBeDefined();
			expect(dashboardServer.getDashboardConnectionCount()).toBeDefined();
		});

		it("should serve dashboard HTML", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/`);
			
			expect(response.status).toBe(200);
			expect(response.headers.get('content-type')).toBe('text/html');
			
			const html = await response.text();
			expect(html).toContain('<!DOCTYPE html>');
			expect(html).toContain('Task Manager Dashboard');
		});

		it("should return metrics data", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/api/metrics`);
			const data = await response.json();
			
			expect(data).toHaveProperty('daemon');
			expect(data).toHaveProperty('tasks');
			expect(data).toHaveProperty('health');
			expect(data.tasks.total).toBe(3);
			expect(data.tasks.pending).toBe(1);
			expect(data.tasks.inProgress).toBe(1);
			expect(data.tasks.completed).toBe(1);
		});

		it("should return tasks list", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/api/tasks`);
			const tasks = await response.json();
			
			expect(tasks).toBeInstanceOf(Array);
			expect(tasks.length).toBe(3);
			expect(tasks[0]).toHaveProperty('id');
			expect(tasks[0]).toHaveProperty('title');
			expect(tasks[0]).toHaveProperty('status');
		});

		it("should return queue status", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/api/queue/status`);
			const data = await response.json();
			
			expect(data).toHaveProperty('total');
			expect(data).toHaveProperty('pending');
			expect(data).toHaveProperty('inProgress');
			expect(data).toHaveProperty('completed');
			expect(data.total).toBe(3);
		});

		it("should return health status", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/api/health`);
			const health = await response.json();
			
			expect(health).toHaveProperty('status');
			expect(health).toHaveProperty('timestamp');
			expect(['healthy', 'unhealthy', 'degraded'].some(status => health.status === status)).toBe(true);
		});

		it("should return activity logs", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/api/logs?limit=10`);
			const logs = await response.json();
			
			expect(logs).toBeInstanceOf(Array);
			expect(logs.length).toBeLessThanOrEqual(10);
			logs.forEach(log => {
				expect(log).toHaveProperty('id');
				expect(log).toHaveProperty('type');
				expect(log).toHaveProperty('message');
				expect(log).toHaveProperty('timestamp');
			});
		});
	});

	describe("Task Management Endpoints", () => {
		it("should handle task creation POST request", async () => {
			const newTask = {
				title: "New Test Task",
				description: "Created via API test",
				priority: "high",
				assignedTo: "test-assignee"
			};

			const response = await fetch(`http://localhost:${dashboardPort}/api/tasks`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(newTask)
			});

			const result = await response.json();
			expect(result.success).toBe(true);
			expect(result.data).toHaveProperty('id');
			expect(result.data.title).toBe(newTask.title);
		});

		it("should handle task status update", async () => {
			const updateData = {
				id: "test-1",
				status: "in-progress"
			};

			const response = await fetch(`http://localhost:${dashboardPort}/api/tasks/update`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(updateData)
			});

			const result = await response.json();
			expect(result.success).toBe(true);
			expect(result.data.status).toBe(updateData.status);
		});

		it("should handle task deletion", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/api/tasks/delete?id=test-3`, {
				method: "DELETE"
			});

			const result = await response.json();
			expect(result.success).toBe(true);
		});
	});

	describe("Error Handling", () => {
		it("should handle invalid task ID gracefully", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/api/tasks/update`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ id: "invalid-id", status: "done" })
			});

			const result = await response.json();
			expect(result.success).toBe(false);
			expect(result).toHaveProperty('error');
		});

		it("should return 404 for unknown endpoints", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/api/unknown`);
			expect(response.status).toBe(404);
		});

		it("should handle missing required fields", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/api/tasks`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ title: "" }) // Missing required fields
			});

			expect(response.status).toBe(400);
			const result = await response.json();
			expect(result.success).toBe(false);
		});
	});

	describe("Dashboard UI Components", () => {
		it("should include all required UI sections", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/`);
			const html = await response.text();

			// Check for main sections
			expect(html).toContain('Overview');
			expect(html).toContain('Queue Status');
			expect(html).toContain('Tasks');
			expect(html).toContain('Dependencies');
			expect(html).toContain('Notifications');
			expect(html).toContain('Create Task');
			expect(html).toContain('Health');
			expect(html).toContain('Activity Log');

			// Check for key UI elements
			expect(html).toContain('taskForm');
			expect(html).toContain('metrics');
			expect(html).toContain('filters');
			expect(html).toContain('modal');
		});

		it("should include real-time WebSocket support", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/`);
			const html = await response.text();

			expect(html).toContain('WebSocket');
			expect(html).toContain('dashboard-ws');
			expect(html).toContain('connectWebSocket');
		});

		it("should include task management interface", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/`);
			const html = await response.text();

			expect(html).toContain('searchInput');
			expect(html).toContain('statusFilter');
			expect(html).toContain('priorityFilter');
			expect(html).toContain('sortBy');
			expect(html).toContain('taskForm');
		});
	});
});