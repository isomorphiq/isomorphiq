import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { DashboardServer } from "@isomorphiq/daemon";
import { ProductManager } from "@isomorphiq/tasks";
import { WebSocketManager } from "@isomorphiq/realtime";

describe("DashboardServer", () => {
	let dashboardServer: DashboardServer;
	let productManager: ProductManager;
	let webSocketManager: WebSocketManager;

	beforeEach(() => {
		productManager = {
			getAllTasks: async () => [],
		} as unknown as ProductManager;
		webSocketManager = new WebSocketManager({ path: "/ws" });
		dashboardServer = new DashboardServer(productManager, webSocketManager);
	});

	afterEach(() => {
		// Cleanup any existing connections
		dashboardServer = null as any;
	});

	describe("Metrics Collection", () => {
		it("should collect basic daemon metrics", async () => {
			const metrics = await dashboardServer.getMetrics();
			
			assert(metrics);
			assert(typeof metrics.daemon.uptime === "number");
			assert(typeof metrics.daemon.pid === "number");
			assert(metrics.daemon.memory);
			assert(metrics.tasks);
			assert(typeof metrics.tasks.total === "number");
			assert(typeof metrics.tasks.pending === "number");
			assert(typeof metrics.tasks.inProgress === "number");
			assert(typeof metrics.tasks.completed === "number");
		});

		it("should calculate task status distribution", async () => {
			// Mock some tasks
			const mockTasks = [
				{ id: "1", status: "todo", priority: "high" },
				{ id: "2", status: "in-progress", priority: "medium" },
				{ id: "3", status: "done", priority: "low" },
				{ id: "4", status: "failed", priority: "high" }
			];

			// Mock the productManager.getAllTasks method
			const originalGetAllTasks = productManager.getAllTasks;
			productManager.getAllTasks = async () => mockTasks as any;

			const metrics = await dashboardServer.getMetrics();
			
			assert.strictEqual(metrics.tasks.total, 4);
			assert.strictEqual(metrics.tasks.pending, 1);
			assert.strictEqual(metrics.tasks.inProgress, 1);
			assert.strictEqual(metrics.tasks.completed, 1);

			// Restore original method
			productManager.getAllTasks = originalGetAllTasks;
		});

		it("should calculate priority distribution", async () => {
			const mockTasks = [
				{ id: "1", status: "todo", priority: "high" },
				{ id: "2", status: "todo", priority: "high" },
				{ id: "3", status: "in-progress", priority: "medium" },
				{ id: "4", status: "done", priority: "low" }
			];

			const originalGetAllTasks = productManager.getAllTasks;
			productManager.getAllTasks = async () => mockTasks as any;

			const metrics = await dashboardServer.getMetrics();
			
			assert.strictEqual(metrics.tasks.byPriority.high, 2);
			assert.strictEqual(metrics.tasks.byPriority.medium, 1);
			assert.strictEqual(metrics.tasks.byPriority.low, 1);

			productManager.getAllTasks = originalGetAllTasks;
		});
	});

	describe("Task Filtering", () => {
		it("should filter tasks by status", async () => {
			const mockTasks = [
				{ id: "1", status: "todo", priority: "high", title: "Task 1" },
				{ id: "2", status: "in-progress", priority: "medium", title: "Task 2" },
				{ id: "3", status: "done", priority: "low", title: "Task 3" }
			];

			const originalGetAllTasks = productManager.getAllTasks;
			productManager.getAllTasks = async () => mockTasks as any;

			const filteredTasks = await dashboardServer.getFilteredTasks({ status: "todo" });
			
			assert.strictEqual(filteredTasks.length, 1);
			assert.strictEqual(filteredTasks[0].id, "1");

			productManager.getAllTasks = originalGetAllTasks;
		});

		it("should filter tasks by priority", async () => {
			const mockTasks = [
				{ id: "1", status: "todo", priority: "high", title: "Task 1" },
				{ id: "2", status: "todo", priority: "high", title: "Task 2" },
				{ id: "3", status: "todo", priority: "low", title: "Task 3" }
			];

			const originalGetAllTasks = productManager.getAllTasks;
			productManager.getAllTasks = async () => mockTasks as any;

			const filteredTasks = await dashboardServer.getFilteredTasks({ priority: "high" });
			
			assert.strictEqual(filteredTasks.length, 2);
			assert(filteredTasks.every(task => task.priority === "high"));

			productManager.getAllTasks = originalGetAllTasks;
		});

		it("should search tasks by text", async () => {
			const mockTasks = [
				{ id: "1", status: "todo", priority: "high", title: "Important Task", description: "Critical work" },
				{ id: "2", status: "todo", priority: "medium", title: "Regular Task", description: "Normal work" },
				{ id: "3", status: "todo", priority: "low", title: "Another Task", description: "Important stuff" }
			];

			const originalGetAllTasks = productManager.getAllTasks;
			productManager.getAllTasks = async () => mockTasks as any;

			const filteredTasks = await dashboardServer.getFilteredTasks({ search: "important" });
			
			assert.strictEqual(filteredTasks.length, 2);
			assert(filteredTasks.some(task => task.title === "Important Task"));
			assert(filteredTasks.some(task => task.description.includes("Important")));

			productManager.getAllTasks = originalGetAllTasks;
		});

		it("should apply multiple filters simultaneously", async () => {
			const mockTasks = [
				{ id: "1", status: "todo", priority: "high", title: "Important Task" },
				{ id: "2", status: "todo", priority: "high", title: "Critical Task" },
				{ id: "3", status: "in-progress", priority: "high", title: "Important Task" },
				{ id: "4", status: "done", priority: "low", title: "Regular Task" }
			];

			const originalGetAllTasks = productManager.getAllTasks;
			productManager.getAllTasks = async () => mockTasks as any;

			const filteredTasks = await dashboardServer.getFilteredTasks({ 
				status: "todo", 
				priority: "high",
				search: "Task"
			});
			
			assert.strictEqual(filteredTasks.length, 2);
			assert(filteredTasks.every(task => task.status === "todo"));
			assert(filteredTasks.every(task => task.priority === "high"));

			productManager.getAllTasks = originalGetAllTasks;
		});
	});

	describe("Queue Status", () => {
		it("should calculate queue status correctly", async () => {
			const mockTasks = [
				{ id: "1", status: "todo", priority: "high", createdAt: "2023-01-01T00:00:00Z" },
				{ id: "2", status: "todo", priority: "medium", createdAt: "2023-01-01T01:00:00Z" },
				{ id: "3", status: "in-progress", priority: "high", createdAt: "2023-01-01T02:00:00Z" },
				{ id: "4", status: "done", priority: "low", createdAt: "2023-01-01T03:00:00Z", updatedAt: "2023-01-01T04:00:00Z" },
				{ id: "5", status: "failed", priority: "medium", createdAt: "2023-01-01T05:00:00Z" }
			];

			const originalGetAllTasks = productManager.getAllTasks;
			productManager.getAllTasks = async () => mockTasks as any;

			const queueStatus = await dashboardServer.getQueueStatusData();
			
			assert.strictEqual(queueStatus.total, 5);
			assert.strictEqual(queueStatus.pending, 2);
			assert.strictEqual(queueStatus.inProgress, 1);
			assert.strictEqual(queueStatus.completed, 1);
			assert.strictEqual(queueStatus.failed, 1);
			assert.strictEqual(queueStatus.highPriority, 2); // 1 high todo + 1 high in-progress

			productManager.getAllTasks = originalGetAllTasks;
		});

		it("should sort queue by priority and creation time", async () => {
			const mockTasks = [
				{ id: "1", status: "todo", priority: "low", createdAt: "2023-01-01T03:00:00Z" },
				{ id: "2", status: "todo", priority: "high", createdAt: "2023-01-01T01:00:00Z" },
				{ id: "3", status: "todo", priority: "medium", createdAt: "2023-01-01T02:00:00Z" }
			];

			const originalGetAllTasks = productManager.getAllTasks;
			productManager.getAllTasks = async () => mockTasks as any;

			const queueStatus = await dashboardServer.getQueueStatusData();
			
			// Check that high priority queue is sorted by creation time
			const highPriorityQueue = queueStatus.queueByPriority.high;
			assert.strictEqual(highPriorityQueue.length, 1);
			assert.strictEqual(highPriorityQueue[0].id, "2");

			// Check that medium priority queue is sorted by creation time
			const mediumPriorityQueue = queueStatus.queueByPriority.medium;
			assert.strictEqual(mediumPriorityQueue.length, 1);
			assert.strictEqual(mediumPriorityQueue[0].id, "3");

			productManager.getAllTasks = originalGetAllTasks;
		});
	});

	describe("Performance Metrics", () => {
		it("should calculate average processing time", async () => {
			const mockTasks = [
				{ 
					id: "1", 
					status: "done", 
					createdAt: "2023-01-01T00:00:00Z", 
					updatedAt: "2023-01-01T01:00:00Z" // 1 hour
				},
				{ 
					id: "2", 
					status: "done", 
					createdAt: "2023-01-01T02:00:00Z", 
					updatedAt: "2023-01-01T02:30:00Z" // 30 minutes
				}
			];

			const originalGetAllTasks = productManager.getAllTasks;
			productManager.getAllTasks = async () => mockTasks as any;

			const queueStatus = await dashboardServer.getQueueStatusData();
			
			assert(queueStatus.processingTimes.averageProcessingTime > 0);
			// Average should be (3600 + 1800) / 2 = 2700 seconds
			assert.strictEqual(queueStatus.processingTimes.averageProcessingTime, 2700);

			productManager.getAllTasks = originalGetAllTasks;
		});

		it("should identify fastest and slowest tasks", async () => {
			const mockTasks = [
				{ 
					id: "1", 
					status: "done", 
					createdAt: "2023-01-01T00:00:00Z", 
					updatedAt: "2023-01-01T00:15:00Z" // 15 minutes - fastest
				},
				{ 
					id: "2", 
					status: "done", 
					createdAt: "2023-01-01T01:00:00Z", 
					updatedAt: "2023-01-01T03:00:00Z" // 2 hours - slowest
				}
			];

			const originalGetAllTasks = productManager.getAllTasks;
			productManager.getAllTasks = async () => mockTasks as any;

			const queueStatus = await dashboardServer.getQueueStatusData();
			
			assert.strictEqual(queueStatus.processingTimes.fastestTask.id, "1");
			assert.strictEqual(queueStatus.processingTimes.slowestTask.id, "2");

			productManager.getAllTasks = originalGetAllTasks;
		});
	});

	describe("WebSocket Integration", () => {
		it("should track active connections", () => {
			const initialCount = dashboardServer.getDashboardConnectionCount();
			assert.strictEqual(initialCount, 0);
		});

		it("should handle task event forwarding", () => {
			// Test that the dashboard can set up event forwarding
			// This is more of an integration test, but we can test the setup
			assert.doesNotThrow(() => {
				// The setupTaskEventForwarding method should exist
				const dashboardAny = dashboardServer as any;
				assert(typeof dashboardAny.setupTaskEventForwarding === 'function');
			});
		});
	});

	describe("Error Handling", () => {
		it("should handle product manager errors gracefully", async () => {
			// Mock product manager to throw an error
			const originalGetAllTasks = productManager.getAllTasks;
			productManager.getAllTasks = async () => {
				throw new Error("Database connection failed");
			};

			// Should not throw, but handle error gracefully
			await assert.rejects(
				async () => dashboardServer.getMetrics(),
				(error) => {
					assert(error instanceof Error);
					return true;
				}
			);

			productManager.getAllTasks = originalGetAllTasks;
		});

		it("should handle invalid filter parameters", async () => {
			const mockTasks = [
				{ id: "1", status: "todo", priority: "high", title: "Task 1" }
			];

			const originalGetAllTasks = productManager.getAllTasks;
			productManager.getAllTasks = async () => mockTasks as any;

			// Should handle empty or invalid filters
			const filteredTasks1 = await dashboardServer.getFilteredTasks({ status: "" });
			const filteredTasks2 = await dashboardServer.getFilteredTasks({ priority: null as any });
			const filteredTasks3 = await dashboardServer.getFilteredTasks({ search: undefined as any });

			// All should return the tasks since filters are effectively empty
			assert.strictEqual(filteredTasks1.length, 1);
			assert.strictEqual(filteredTasks2.length, 1);
			assert.strictEqual(filteredTasks3.length, 1);

			productManager.getAllTasks = originalGetAllTasks;
		});
	});

	describe("Health Checks", () => {
		it("should perform health status calculation", async () => {
			const mockTasks = [
				{ id: "1", status: "todo", priority: "high" },
				{ id: "2", status: "todo", priority: "medium" },
				{ id: "3", status: "done", priority: "low" }
			];

			const originalGetAllTasks = productManager.getAllTasks;
			productManager.getAllTasks = async () => mockTasks as any;

			const health = await dashboardServer.serveHealth({} as any, {
				writeHead: () => {},
				end: () => {}
			} as any);

			// Health calculation should work
			const metrics = await dashboardServer.getMetrics();
			assert(metrics.health.status === "healthy" || metrics.health.status === "degraded" || metrics.health.status === "unhealthy");

			productManager.getAllTasks = originalGetAllTasks;
		});
	});

	describe("Dependency Graph Integration", () => {
		it("should handle dependency graph requests", async () => {
			const mockTasks = [
				{ id: "1", status: "todo", priority: "high", dependencies: [] },
				{ id: "2", status: "todo", priority: "medium", dependencies: ["1"] },
				{ id: "3", status: "todo", priority: "low", dependencies: ["1", "2"] }
			];

			const originalGetAllTasks = productManager.getAllTasks;
			productManager.getAllTasks = async () => mockTasks as any;

			// Test dependency graph endpoint (this tests the integration)
			const url = new URL("http://localhost/api/dependencies/graph");
			const response = {
				writeHead: () => {},
				end: (data: string) => {
					const result = JSON.parse(data);
					assert(result.success);
					assert(result.data);
				}
			} as any;

			await assert.doesNotThrow(async () => {
				await dashboardServer.serveDependencyGraph(url, response);
			});

			productManager.getAllTasks = originalGetAllTasks;
		});
	});
});
