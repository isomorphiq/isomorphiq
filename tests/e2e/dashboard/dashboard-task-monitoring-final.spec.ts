import { describe, it, beforeEach, afterEach } from "node:test";
import { expect } from "../../test-utils/expect.ts";
import { DashboardServer } from "@isomorphiq/dashboard";
import { WebSocketManager } from "@isomorphiq/realtime";
import { ProductManager } from "@isomorphiq/user-profile";
import { createServer, type Server } from "node:http";

describe("Dashboard Task Monitoring", () => {
	let dashboardServer: DashboardServer;
	let productManager: ProductManager;
	let webSocketManager: WebSocketManager;
	let httpServer: Server;
	let baseUrl: string;

	beforeEach(async () => {
		productManager = {
			getAllTasks: async () => [],
		} as unknown as ProductManager;
		webSocketManager = new WebSocketManager({ path: "/ws" }) as any;
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

	describe("Task Status Monitoring", () => {
		it("should provide dashboard metrics", async () => {
			const response = await fetch(`${baseUrl}/api/metrics`);
			
			expect(response.status).toBe(200);
			const data = await response.json();
			
			expect(data).toHaveProperty('daemon');
			expect(data).toHaveProperty('tasks');
			expect(data).toHaveProperty('health');
			expect(data).toHaveProperty('system');
		});

		it("should track active tasks", async () => {
			const response = await fetch(`${baseUrl}/api/tasks?status=in-progress`);
			
			expect(response.status).toBe(200);
			const data = await response.json();
			
			expect(Array.isArray(data)).toBe(true);
			data.forEach((task: any) => {
				expect(task.status).toBe('in-progress');
			});
		});

		it("should monitor queue status", async () => {
			const response = await fetch(`${baseUrl}/api/queue/status`);
			
			expect(response.status).toBe(200);
			const data = await response.json();
			
			expect(data).toHaveProperty('total');
			expect(data).toHaveProperty('pending');
			expect(data).toHaveProperty('inProgress');
			expect(data).toHaveProperty('completed');
			expect(data).toHaveProperty('queueByPriority');
		});

		it("should provide task history", async () => {
			const response = await fetch(`${baseUrl}/api/tasks?status=done&limit=10`);
			
			expect(response.status).toBe(200);
			const data = await response.json();
			
			expect(Array.isArray(data)).toBe(true);
			if (data.length > 0) {
				data.forEach((task: any) => {
					expect(task.status).toBe('done');
					expect(task).toHaveProperty('updatedAt');
				});
			}
		});
	});

	describe("Real-time Updates", () => {
		it("should support WebSocket connection", async () => {
			// Test that dashboard has WebSocket capabilities
			const dashboardAny = dashboardServer as any;
			
			expect(typeof dashboardAny.initializeWebSocketServer).toBe('function');
			expect(dashboardAny.getDashboardConnectionCount()).toBe(0);
		});

		it("should broadcast task updates", async () => {
			const dashboardAny = dashboardServer as any;
			
			// Test that broadcasting method exists
			expect(typeof dashboardAny.broadcastToDashboard).toBe('function');
			
			// Mock active connections for testing
			dashboardAny.activeConnections = new Set();
			
			// Should not throw when broadcasting
			expect(() => {
				dashboardAny.broadcastToDashboard({
					type: 'test_message',
					data: { test: true }
				});
			}).not.toThrow();
		});
	});

	describe("Task Filtering and Search", () => {
		it("should filter by status", async () => {
			const response = await fetch(`${baseUrl}/api/tasks/search?status=todo`);
			
			expect(response.status).toBe(200);
			const data = await response.json();
			
			expect(Array.isArray(data)).toBe(true);
		});

		it("should search by text", async () => {
			const response = await fetch(`${baseUrl}/api/tasks/search?q=test`);
			
			expect(response.status).toBe(200);
			const data = await response.json();
			
			expect(Array.isArray(data)).toBe(true);
		});

		it("should combine multiple filters", async () => {
			const response = await fetch(`${baseUrl}/api/tasks/search?status=todo&priority=high`);
			
			expect(response.status).toBe(200);
			const data = await response.json();
			
			expect(Array.isArray(data)).toBe(true);
		});
	});

	describe("Performance Monitoring", () => {
		it("should provide performance metrics", async () => {
			const response = await fetch(`${baseUrl}/api/performance`);
			
			expect(response.status).toBe(200);
			const data = await response.json();
			
			expect(data).toHaveProperty('memory');
			expect(data).toHaveProperty('cpu');
			expect(data).toHaveProperty('tasks');
			expect(data).toHaveProperty('daemon');
		});

		it("should include memory usage statistics", async () => {
			const response = await fetch(`${baseUrl}/api/performance`);
			
			expect(response.status).toBe(200);
			const data = await response.json();
			
			expect(data.memory).toHaveProperty('heap');
			expect(data.memory.heap).toHaveProperty('used');
			expect(data.memory.heap).toHaveProperty('total');
			expect(data.memory.heap).toHaveProperty('percentage');
		});

		it("should track task throughput", async () => {
			const response = await fetch(`${baseUrl}/api/performance`);
			
			expect(response.status).toBe(200);
			const data = await response.json();
			
			expect(data.tasks).toHaveProperty('throughput');
			expect(data.tasks.throughput).toHaveProperty('completed');
			expect(data.tasks.throughput).toHaveProperty('tasksPerMinute');
		});
	});

	describe("Health Monitoring", () => {
		it("should provide health status", async () => {
			const response = await fetch(`${baseUrl}/api/health`);
			
			expect(response.status).toBe(200);
			const data = await response.json();
			
			expect(data).toHaveProperty('status');
			expect(['healthy', 'degraded', 'unhealthy']).toContain(data.status);
		});

		it("should include daemon information", async () => {
			const response = await fetch(`${baseUrl}/api/health`);
			
			expect(response.status).toBe(200);
			const data = await response.json();
			
			expect(data).toHaveProperty('daemon');
			expect(data.daemon).toHaveProperty('pid');
			expect(data.daemon).toHaveProperty('uptime');
			expect(data.daemon).toHaveProperty('memory');
		});

		it("should track connection status", async () => {
			const response = await fetch(`${baseUrl}/api/health`);
			
			expect(response.status).toBe(200);
			const data = await response.json();
			
			expect(data).toHaveProperty('websocket');
			expect(typeof data.websocket.connected).toBe('boolean');
		});
	});

	describe("Task Management Operations", () => {
		it("should support task creation", async () => {
			const taskData = {
				title: "Test Task for Monitoring",
				description: "This is a test task",
				priority: "medium"
			};

			const response = await fetch(`${baseUrl}/api/tasks`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(taskData)
			});

			// Should either succeed or fail gracefully
			expect([200, 201, 400]).toContain(response.status);
		});

		it("should support task updates", async () => {
			const updateData = {
				id: "test-task-id",
				status: "done"
			};

			const response = await fetch(`${baseUrl}/api/tasks/update`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(updateData)
			});

			// Should either succeed or fail gracefully
			expect([200, 400, 404]).toContain(response.status);
		});

		it("should support task deletion", async () => {
			const response = await fetch(`${baseUrl}/api/tasks/delete?id=test-task-id`, {
				method: "DELETE"
			});

			// Should either succeed or fail gracefully
			expect([200, 400, 404]).toContain(response.status);
		});
	});

	describe("Activity Logging", () => {
		it("should provide activity logs", async () => {
			const response = await fetch(`${baseUrl}/api/logs?limit=10`);
			
			expect(response.status).toBe(200);
			const data = await response.json();
			
			expect(Array.isArray(data)).toBe(true);
		});

		it("should include log metadata", async () => {
			const response = await fetch(`${baseUrl}/api/logs`);
			
			expect(response.status).toBe(200);
			const data = await response.json();
			
			if (data.length > 0) {
				data.forEach((log: any) => {
					expect(log).toHaveProperty('message');
					expect(log).toHaveProperty('timestamp');
					expect(log).toHaveProperty('level');
				});
			}
		});
	});

	describe("Error Handling", () => {
		it("should handle invalid endpoints", async () => {
			const response = await fetch(`${baseUrl}/api/invalid-endpoint`);
			
			expect(response.status).toBe(404);
		});

		it("should handle invalid request methods", async () => {
			const response = await fetch(`${baseUrl}/api/metrics`, {
				method: "INVALID"
			});

			expect([400, 405, 404]).toContain(response.status);
		});

		it("should handle malformed JSON", async () => {
			const response = await fetch(`${baseUrl}/api/tasks`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: "invalid json"
			});

			expect(response.status).toBe(400);
		});
	});

	describe("Dashboard HTML Interface", () => {
		it("should serve dashboard HTML", async () => {
			const response = await fetch(baseUrl);
			
			expect(response.status).toBe(200);
			expect(response.headers.get('content-type')).toContain('text/html');
			
			const html = await response.text();
			expect(html).toContain('Task Manager Dashboard');
			expect(html).toContain('dashboard-ws');
		});

		it("should include essential dashboard features", async () => {
			const response = await fetch(baseUrl);
			
			expect(response.status).toBe(200);
			const html = await response.text();
			
			// Check for key dashboard elements
			expect(html).toContain('metrics'); // Metrics section
			expect(html).toContain('tasks'); // Task management
			expect(html).toContain('queue'); // Queue status
			expect(html).toContain('WebSocket'); // Real-time updates
		});
	});

	describe("Response Performance", () => {
		it("should respond quickly to API requests", async () => {
			const startTime = Date.now();
			const response = await fetch(`${baseUrl}/api/metrics`);
			const endTime = Date.now();
			
			expect(response.status).toBe(200);
			const responseTime = endTime - startTime;
			expect(responseTime).toBeLessThan(1000); // Should respond within 1 second
		});

		it("should handle concurrent requests", async () => {
			const requests = Array(5).fill(null).map(() =>
				fetch(`${baseUrl}/api/tasks`)
			);

			const startTime = Date.now();
			const responses = await Promise.all(requests);
			const endTime = Date.now();

			// All requests should succeed
			responses.forEach(response => {
				expect(response.status).toBe(200);
			});

			// Should handle concurrent requests efficiently
			const totalTime = endTime - startTime;
			expect(totalTime).toBeLessThan(2000); // Should complete within 2 seconds
		});
	});
});
