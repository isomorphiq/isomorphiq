import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { createServer, type Server } from "node:http";
import { DashboardServer } from "@isomorphiq/dashboard";
import { ProductManager } from "@isomorphiq/user-profile";
import { WebSocketManager } from "@isomorphiq/realtime";

describe("Dashboard Integration Tests", () => {
	let dashboardServer: DashboardServer;
	let productManager: ProductManager;
	let webSocketManager: WebSocketManager;
	let httpServer: Server;
	let baseUrl: string;

	beforeEach(async () => {
		productManager = {
			getAllTasks: async () => [],
		} as unknown as ProductManager;
		webSocketManager = new WebSocketManager({ path: "/ws" });
		dashboardServer = new DashboardServer(productManager, webSocketManager);
		
		// Create a test HTTP server
		httpServer = createServer(async (req, res) => {
			await dashboardServer.handleRequest(req, res);
		});
		
		await new Promise<void>((resolve) => {
			httpServer.listen(0, () => {
				const address = httpServer.address() as any;
				baseUrl = `http://localhost:${address.port}`;
				resolve();
			});
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
		it("should serve metrics endpoint", async () => {
			const response = await fetch(`${baseUrl}/api/metrics`);
			assert.strictEqual(response.status, 200);
			
			const data = await response.json();
			assert(data.daemon);
			assert(data.tasks);
			assert(data.health);
			assert(data.system);
		});

		it("should serve tasks endpoint", async () => {
			const response = await fetch(`${baseUrl}/api/tasks`);
			assert.strictEqual(response.status, 200);
			
			const data = await response.json();
			assert(Array.isArray(data));
		});

		it("should serve tasks with status filter", async () => {
			const response = await fetch(`${baseUrl}/api/tasks?status=todo`);
			assert.strictEqual(response.status, 200);
			
			const data = await response.json();
			assert(Array.isArray(data));
			// All returned tasks should have status "todo"
			data.forEach((task: any) => {
				assert.strictEqual(task.status, "todo");
			});
		});

		it("should serve tasks with priority filter", async () => {
			const response = await fetch(`${baseUrl}/api/tasks?priority=high`);
			assert.strictEqual(response.status, 200);
			
			const data = await response.json();
			assert(Array.isArray(data));
			// All returned tasks should have priority "high"
			data.forEach((task: any) => {
				assert.strictEqual(task.priority, "high");
			});
		});

		it("should serve queue status endpoint", async () => {
			const response = await fetch(`${baseUrl}/api/queue/status`);
			assert.strictEqual(response.status, 200);
			
			const data = await response.json();
			assert(typeof data.total === "number");
			assert(typeof data.pending === "number");
			assert(typeof data.inProgress === "number");
			assert(typeof data.completed === "number");
			assert(typeof data.failed === "number");
			assert(data.queueByPriority);
		});

		it("should serve health endpoint", async () => {
			const response = await fetch(`${baseUrl}/api/health`);
			assert.strictEqual(response.status, 200);
			
			const data = await response.json();
			assert(data.status);
			assert(data.daemon);
			assert(data.websocket);
		});

		it("should serve dashboard HTML", async () => {
			const response = await fetch(baseUrl);
			assert.strictEqual(response.status, 200);
			assert.strictEqual(response.headers.get("content-type"), "text/html");
			
			const html = await response.text();
			assert(html.includes("Task Manager Dashboard"));
			assert(html.includes("dashboard-ws"));
		});
	});

	describe("Task Creation", () => {
		it("should create a new task via POST", async () => {
			const taskData = {
				title: "Test Task",
				description: "Test Description",
				priority: "high",
				assignedTo: "testuser"
			};

			const response = await fetch(`${baseUrl}/api/tasks`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify(taskData),
			});

			assert.strictEqual(response.status, 201);
			
			const result = await response.json();
			assert(result.success);
			assert(result.data);
			assert.strictEqual(result.data.title, taskData.title);
			assert.strictEqual(result.data.description, taskData.description);
			assert.strictEqual(result.data.priority, taskData.priority);
			assert.strictEqual(result.data.assignedTo, taskData.assignedTo);
		});

		it("should validate required fields on task creation", async () => {
			const invalidTaskData = {
				// Missing required title field
				description: "Test Description",
				priority: "high"
			};

			const response = await fetch(`${baseUrl}/api/tasks`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify(invalidTaskData),
			});

			assert.strictEqual(response.status, 400);
			
			const result = await response.json();
			assert(!result.success);
			assert(result.error);
		});
	});

	describe("Task Updates", () => {
		it("should update task status", async () => {
			// First create a task
			const createResponse = await fetch(`${baseUrl}/api/tasks`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					title: "Update Test Task",
					description: "For testing updates",
					priority: "medium"
				}),
			});

			const createResult = await createResponse.json();
			const taskId = createResult.data.id;

			// Then update its status
			const updateResponse = await fetch(`${baseUrl}/api/tasks/update`, {
				method: "PUT",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					id: taskId,
					status: "in-progress"
				}),
			});

			assert.strictEqual(updateResponse.status, 200);
			
			const updateResult = await updateResponse.json();
			assert(updateResult.success);
			assert.strictEqual(updateResult.data.status, "in-progress");
		});

		it("should update task priority", async () => {
			// First create a task
			const createResponse = await fetch(`${baseUrl}/api/tasks`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					title: "Priority Test Task",
					description: "For testing priority updates",
					priority: "low"
				}),
			});

			const createResult = await createResponse.json();
			const taskId = createResult.data.id;

			// Then update its priority
			const updateResponse = await fetch(`${baseUrl}/api/tasks/update`, {
				method: "PUT",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					id: taskId,
					priority: "high"
				}),
			});

			assert.strictEqual(updateResponse.status, 200);
			
			const updateResult = await updateResponse.json();
			assert(updateResult.success);
			assert.strictEqual(updateResult.data.priority, "high");
		});
	});

	describe("Task Search", () => {
		it("should search tasks by title", async () => {
			const response = await fetch(`${baseUrl}/api/tasks/search?q=test`);
			assert.strictEqual(response.status, 200);
			
			const data = await response.json();
			assert(Array.isArray(data));
			// Results should contain "test" in title or description
			data.forEach((task: any) => {
				const titleMatch = task.title.toLowerCase().includes("test");
				const descMatch = task.description.toLowerCase().includes("test");
				assert(titleMatch || descMatch);
			});
		});

		it("should combine search with filters", async () => {
			const response = await fetch(`${baseUrl}/api/tasks/search?q=test&status=todo&priority=high`);
			assert.strictEqual(response.status, 200);
			
			const data = await response.json();
			assert(Array.isArray(data));
			// Results should match all criteria
			data.forEach((task: any) => {
				const textMatch = task.title.toLowerCase().includes("test") || 
								 task.description.toLowerCase().includes("test");
				const statusMatch = task.status === "todo";
				const priorityMatch = task.priority === "high";
				
				assert(textMatch && statusMatch && priorityMatch);
			});
		});
	});

	describe("Task Deletion", () => {
		it("should delete a task", async () => {
			// First create a task
			const createResponse = await fetch(`${baseUrl}/api/tasks`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					title: "Delete Test Task",
					description: "For testing deletion",
					priority: "medium"
				}),
			});

			const createResult = await createResponse.json();
			const taskId = createResult.data.id;

			// Then delete it
			const deleteResponse = await fetch(`${baseUrl}/api/tasks/delete?id=${taskId}`, {
				method: "DELETE",
			});

			assert.strictEqual(deleteResponse.status, 200);
			
			const deleteResult = await deleteResponse.json();
			assert(deleteResult.success);

			// Verify it's gone
			const verifyResponse = await fetch(`${baseUrl}/api/tasks`);
			const verifyData = await verifyResponse.json();
			const deletedTask = verifyData.find((task: any) => task.id === taskId);
			assert(!deletedTask);
		});
	});

	describe("Error Handling", () => {
		it("should handle 404 for unknown endpoints", async () => {
			const response = await fetch(`${baseUrl}/api/unknown`);
			assert.strictEqual(response.status, 404);
		});

		it("should handle invalid JSON in POST requests", async () => {
			const response = await fetch(`${baseUrl}/api/tasks`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: "invalid json{",
			});

			assert.strictEqual(response.status, 400);
		});

		it("should handle missing task ID for updates", async () => {
			const response = await fetch(`${baseUrl}/api/tasks/update`, {
				method: "PUT",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					status: "done"
					// Missing id
				}),
			});

			assert.strictEqual(response.status, 400);
			
			const result = await response.json();
			assert(!result.success);
			assert(result.error);
		});
	});

	describe("Performance Monitoring", () => {
		it("should include performance metrics", async () => {
			const response = await fetch(`${baseUrl}/api/performance`);
			assert.strictEqual(response.status, 200);
			
			const data = await response.json();
			assert(data.memory);
			assert(data.cpu);
			assert(data.tasks);
			assert(data.daemon);
			assert(typeof data.memory.heap.percentage === "number");
			assert(typeof data.daemon.uptime === "number");
		});

		it("should serve system status", async () => {
			const response = await fetch(`${baseUrl}/api/status`);
			assert.strictEqual(response.status, 200);
			
			const data = await response.json();
			assert(data.daemon);
			assert(data.tasks);
			assert(data.connections);
			assert(data.system);
			assert(typeof data.daemon.pid === "number");
			assert(typeof data.system.totalmem === "number");
		});
	});

	describe("Response Times", () => {
		it("should respond to metrics requests quickly", async () => {
			const startTime = Date.now();
			const response = await fetch(`${baseUrl}/api/metrics`);
			const endTime = Date.now();
			
			assert.strictEqual(response.status, 200);
			const responseTime = endTime - startTime;
			
			// Should respond within 1 second (generous for test environment)
			assert(responseTime < 1000, `Metrics response took ${responseTime}ms`);
		});

		it("should handle concurrent requests", async () => {
			const requests = Array(10).fill(null).map(() =>
				fetch(`${baseUrl}/api/tasks`)
			);

			const startTime = Date.now();
			const responses = await Promise.all(requests);
			const endTime = Date.now();

			// All requests should succeed
			responses.forEach(response => {
				assert.strictEqual(response.status, 200);
			});

			// Should handle concurrent requests efficiently
			const totalTime = endTime - startTime;
			assert(totalTime < 2000, `Concurrent requests took ${totalTime}ms`);
		});
	});
});
