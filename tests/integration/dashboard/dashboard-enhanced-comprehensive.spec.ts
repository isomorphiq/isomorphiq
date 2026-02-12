import { test, expect } from "@playwright/test";

import { canUseLocalSockets, NETWORK_SKIP_REASON } from "../../e2e/dashboard/test-environment.ts";

import { DashboardServer } from "@isomorphiq/dashboard";
import { WebSocketManager } from "@isomorphiq/realtime";
import { ProductManager } from "@isomorphiq/profiles";
import { createServer, type Server } from "node:http";
import { WebSocketServer } from "ws";

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

describe("Enhanced Dashboard Server Tests", () => {
	let dashboardServer: DashboardServer;
	let wsManager: WebSocketManager;
	let productManager: ProductManager;
	let httpServer: Server;
	let dashboardPort: number;
	let wsServer: WebSocketServer;

	beforeEach(async () => {
		// Mock ProductManager with comprehensive task data
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
					assignedTo: "assignee",
					dependencies: []
				},
				{
					id: "test-2", 
					title: "Test Task 2",
					description: "Description for test task 2",
					status: "in-progress",
					priority: "medium",
					createdAt: new Date().toISOString(),
					updatedAt: new Date().toISOString(),
					createdBy: "test-user-2",
					dependencies: ["test-1"]
				},
				{
					id: "test-3",
					title: "Completed Task",
					description: "Description for completed task",
					status: "done",
					priority: "low",
					createdAt: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
					updatedAt: new Date(Date.now() - 1800000).toISOString(), // 30 min ago
					createdBy: "test-user",
					assignedTo: "assignee"
				},
				{
					id: "test-4",
					title: "Failed Task",
					description: "Description for failed task",
					status: "failed",
					priority: "high",
					createdAt: new Date(Date.now() - 7200000).toISOString(), // 2 hours ago
					updatedAt: new Date(Date.now() - 900000).toISOString(), // 15 min ago
					createdBy: "test-user",
					assignedTo: "assignee"
				}
			],
			createTask: async (title, description, priority, dependencies, createdBy, assignedTo, collaborators, watchers, type) => ({
				id: "new-task",
				title,
				description,
				priority: priority || "medium",
				status: "todo",
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				createdBy,
				assignedTo,
				collaborators,
				watchers,
				type: type || "task",
				dependencies: dependencies || []
			}),
			updateTaskStatus: async (id, status) => {
				const tasks = await productManager.getAllTasks();
				const task = tasks.find(t => t.id === id);
				return task ? { ...task, status, updatedAt: new Date().toISOString() } : null;
			},
			updateTaskPriority: async (id, priority) => {
				const tasks = await productManager.getAllTasks();
				const task = tasks.find(t => t.id === id);
				return task ? { ...task, priority, updatedAt: new Date().toISOString() } : null;
			},
			deleteTask: async (id) => {
				const tasks = await productManager.getAllTasks();
				return tasks.some(t => t.id === id);
			}
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

		// Initialize WebSocket server
		wsServer = new WebSocketServer({ port: dashboardPort + 1 });
		await dashboardServer.initializeWebSocketServer(httpServer);
	});

	afterEach(async () => {
		if (wsServer) {
			wsServer.close();
		}
		if (httpServer) {
			httpServer.close();
		}
	});

	describe("Dashboard Metrics API", () => {
		it("should return comprehensive metrics", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/api/metrics`);
			const data = await response.json();
			
			expect(data).toHaveProperty('daemon');
			expect(data).toHaveProperty('tasks');
			expect(data).toHaveProperty('health');
			expect(data).toHaveProperty('system');
			
			// Check task metrics
			expect(data.tasks.total).toBe(4);
			expect(data.tasks.pending).toBe(1);
			expect(data.tasks.inProgress).toBe(1);
			expect(data.tasks.completed).toBe(1);
			expect(data.tasks.failed).toBe(1);
			
			// Check priority breakdown
			expect(data.tasks.byPriority.high).toBe(2);
			expect(data.tasks.byPriority.medium).toBe(1);
			expect(data.tasks.byPriority.low).toBe(1);
			
			// Check health status
			expect(data.health.status).toMatch(/healthy|unhealthy|degraded/);
			expect(data.health.wsConnections).toBeGreaterThan(0);
		});

		it("should calculate memory usage percentage correctly", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/api/metrics`);
			const data = await response.json();
			
			expect(typeof data.health.memoryUsage).toBe('number');
			expect(data.health.memoryUsage).toBeGreaterThanOrEqual(0);
			expect(data.health.memoryUsage).toBeLessThanOrEqual(100);
		});
	});

	describe("Task Management API", () => {
		it("should create new task via POST", async () => {
			const newTask = {
				title: "New Test Task",
				description: "Created via API",
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
			expect(result.data.priority).toBe(newTask.priority);
		});

		it("should update task status", async () => {
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

		it("should update task priority", async () => {
			const updateData = {
				id: "test-2",
				priority: "high"
			};

			const response = await fetch(`http://localhost:${dashboardPort}/api/tasks/update`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(updateData)
			});

			const result = await response.json();
			expect(result.success).toBe(true);
			expect(result.data.priority).toBe(updateData.priority);
		});

		it("should cancel task", async () => {
			const cancelData = {
				id: "test-2"
			};

			const response = await fetch(`http://localhost:${dashboardPort}/api/tasks/cancel`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(cancelData)
			});

			const result = await response.json();
			expect(result.success).toBe(true);
			expect(result.data.status).toBe("cancelled");
		});

		it("should retry failed task", async () => {
			const retryData = {
				id: "test-4"
			};

			const response = await fetch(`http://localhost:${dashboardPort}/api/tasks/retry`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(retryData)
			});

			const result = await response.json();
			expect(result.success).toBe(true);
			expect(result.data.status).toBe("todo");
		});

		it("should delete task", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/api/tasks/delete?id=test-3`, {
				method: "DELETE"
			});

			const result = await response.json();
			expect(result.success).toBe(true);
		});
	});

	describe("Task Search and Filtering", () => {
		it("should search tasks by title", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/api/tasks/search?q=Test`);
			const tasks = await response.json();

			expect(tasks).toBeInstanceOf(Array);
			expect(tasks.length).toBeGreaterThan(0);
			tasks.forEach(task => {
				expect(
					task.title.toLowerCase().includes("test") ||
					task.description.toLowerCase().includes("test")
				).toBe(true);
			});
		});

		it("should filter tasks by status", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/api/tasks/search?status=todo`);
			const tasks = await response.json();

			expect(tasks).toBeInstanceOf(Array);
			tasks.forEach(task => {
				expect(task.status).toBe("todo");
			});
		});

		it("should filter tasks by priority", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/api/tasks/search?priority=high`);
			const tasks = await response.json();

			expect(tasks).toBeInstanceOf(Array);
			tasks.forEach(task => {
				expect(task.priority).toBe("high");
			});
		});

		it("should combine multiple filters", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/api/tasks/search?status=todo&priority=high`);
			const tasks = await response.json();

			expect(tasks).toBeInstanceOf(Array);
			tasks.forEach(task => {
				expect(task.status).toBe("todo");
				expect(task.priority).toBe("high");
			});
		});
	});

	describe("Queue Status API", () => {
		it("should return detailed queue status", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/api/queue/status`);
			const data = await response.json();

			expect(data).toHaveProperty('total');
			expect(data).toHaveProperty('pending');
			expect(data).toHaveProperty('inProgress');
			expect(data).toHaveProperty('completed');
			expect(data).toHaveProperty('failed');
			expect(data).toHaveProperty('queueByPriority');
			expect(data).toHaveProperty('processingTimes');

			expect(data.total).toBe(4);
			expect(data.pending).toBe(1);
			expect(data.inProgress).toBe(1);
			expect(data.completed).toBe(1);
			expect(data.failed).toBe(1);

			// Check priority queues
			expect(data.queueByPriority.high).toBeInstanceOf(Array);
			expect(data.queueByPriority.medium).toBeInstanceOf(Array);
			expect(data.queueByPriority.low).toBeInstanceOf(Array);
		});

		it("should calculate processing times correctly", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/api/queue/status`);
			const data = await response.json();

			expect(data.processingTimes).toHaveProperty('averageProcessingTime');
			expect(data.processingTimes).toHaveProperty('fastestTask');
			expect(data.processingTimes).toHaveProperty('slowestTask');
			expect(typeof data.processingTimes.averageProcessingTime).toBe('number');
		});
	});

	describe("Health Monitoring API", () => {
		it("should return health status", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/api/health`);
			const health = await response.json();

			expect(health).toHaveProperty('status');
			expect(health).toHaveProperty('timestamp');
			expect(health).toHaveProperty('daemon');
			expect(health).toHaveProperty('websocket');

			expect(['healthy', 'unhealthy', 'degraded'].some(status => health.status === status)).toBe(true);
		});

		it("should return performance metrics", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/api/performance`);
			const performance = await response.json();

			expect(performance).toHaveProperty('memory');
			expect(performance).toHaveProperty('cpu');
			expect(performance).toHaveProperty('tasks');
			expect(performance).toHaveProperty('daemon');

			// Check memory metrics
			expect(performance.memory.heap).toHaveProperty('used');
			expect(performance.memory.heap).toHaveProperty('total');
			expect(performance.memory.heap).toHaveProperty('percentage');

			// Check task throughput
			expect(performance.tasks.throughput).toHaveProperty('completed');
			expect(performance.tasks.throughput).toHaveProperty('averageProcessingTime');
		});

		it("should return system status", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/api/status`);
			const status = await response.json();

			expect(status).toHaveProperty('daemon');
			expect(status).toHaveProperty('tasks');
			expect(status).toHaveProperty('connections');
			expect(status).toHaveProperty('system');

			// Check system info
			expect(status.system).toHaveProperty('nodeVersion');
			expect(status.system).toHaveProperty('platform');
			expect(status.system).toHaveProperty('arch');
		});
	});

	describe("Activity Logs API", () => {
		it("should return activity logs", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/api/logs?limit=10`);
			const logs = await response.json();

			expect(logs).toBeInstanceOf(Array);
			logs.forEach(log => {
				expect(log).toHaveProperty('id');
				expect(log).toHaveProperty('type');
				expect(log).toHaveProperty('message');
				expect(log).toHaveProperty('timestamp');
				expect(log).toHaveProperty('level');
			});
		});

		it("should respect limit parameter", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/api/logs?limit=5`);
			const logs = await response.json();

			expect(logs.length).toBeLessThanOrEqual(5);
		});
	});

	describe("WebSocket Real-time Updates", () => {
		it("should initialize WebSocket server", () => {
			expect(dashboardServer.getDashboardConnectionCount()).toBeGreaterThanOrEqual(0);
		});

		it("should handle WebSocket connection", async () => {
			const ws = new WebSocket(`ws://localhost:${dashboardPort}/dashboard-ws`);
			
			await new Promise<void>((resolve, reject) => {
				ws.on('open', () => resolve());
				ws.on('error', reject);
				
				// Timeout after 1 second
				setTimeout(() => reject(new Error('WebSocket connection timeout')), 1000);
			});

			ws.close();
		});

		it("should send initial state to new WebSocket clients", async () => {
			const ws = new WebSocket(`ws://localhost:${dashboardPort}/dashboard-ws`);
			
			const message = await new Promise<any>((resolve, reject) => {
				ws.on('message', (data) => {
					try {
						const message = JSON.parse(data.toString());
						resolve(message);
					} catch (e) {
						reject(e);
					}
				});
				ws.on('error', reject);
				
				// Timeout after 2 seconds
				setTimeout(() => reject(new Error('Message timeout')), 2000);
			});

			expect(message.type).toBe('initial_state');
			expect(message.data).toHaveProperty('metrics');
			expect(message.data).toHaveProperty('tasks');

			ws.close();
		});
	});

	describe("Dashboard HTML Interface", () => {
		it("should serve dashboard HTML", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/`);
			
			expect(response.status).toBe(200);
			expect(response.headers.get('content-type')).toBe('text/html');
			
			const html = await response.text();
			expect(html).toContain('<!DOCTYPE html>');
			expect(html).toContain('Task Manager Dashboard');
			expect(html).toContain('id="totalTasks"');
			expect(html).toContain('class="tab"');
		});

		it("should include all required UI components", async () => {
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
			expect(html).toContain('WebSocket');
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

		it("should return 404 for unknown endpoints", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/api/unknown`);
			expect(response.status).toBe(404);
		});
	});

	describe("Daemon Control API", () => {
		it("should get daemon status", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/api/dashboard/status`, {
				method: "GET"
			});

			const result = await response.json();
			expect(result.success).toBe(true);
			expect(result.data).toHaveProperty('paused');
			expect(result.data).toHaveProperty('processingActive');
		});

		it("should pause daemon", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/api/dashboard/pause`, {
				method: "POST"
			});

			const result = await response.json();
			expect(result.success).toBe(true);
			expect(result.message).toContain('paused');
		});

		it("should resume daemon", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/api/dashboard/resume`, {
				method: "POST"
			});

			const result = await response.json();
			expect(result.success).toBe(true);
			expect(result.message).toContain('resumed');
		});
	});
});
