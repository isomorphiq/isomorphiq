import "../../../../tests/test-utils/env-fetch.ts";
import { describe, it, expect, beforeEach, afterEach } from "node:test";
import { DashboardServer } from "../src/web/dashboard.ts";
import { WebSocketManager } from "@isomorphiq/realtime";
import { ProductManager } from "@isomorphiq/tasks";
import { DashboardAnalyticsService } from "../src/services/dashboard-analytics-service.ts";
import { createServer, type Server } from "node:http";
import { WebSocket } from "ws";

describe("Dashboard Server Tests", () => {
	let dashboardServer: DashboardServer;
	let productManager: ProductManager;
	let webSocketManager: WebSocketManager;
	let analyticsService: DashboardAnalyticsService;
	let httpServer: Server;
	let serverPort: number;

	beforeEach(async () => {
		// Initialize mock dependencies
		productManager = {} as ProductManager;
		webSocketManager = {} as WebSocketManager;
		analyticsService = new DashboardAnalyticsService(productManager);
		
		// Create dashboard server
		const environment = "test";
		const environmentServices = new Map([
			[
				environment,
				{
					environment,
					productManager,
					webSocketManager,
					analyticsService,
				},
			],
		]);
		dashboardServer = new DashboardServer(environmentServices, () => environment, environment);
		
		// Find available port for testing
		serverPort = 3006 + Math.floor(Math.random() * 1000);
		httpServer = createServer((req, res) => {
			dashboardServer.handleRequest(req, res).catch(() => {
				res.writeHead(500);
				res.end("Internal Server Error");
			});
		});
		
		// Initialize WebSocket server
		await dashboardServer.initializeWebSocketServer(httpServer);
	});

	afterEach(async () => {
		// Clean up
		if (httpServer) {
			await new Promise<void>((resolve) => {
				httpServer.close(() => resolve());
			});
		}
	});

	describe("HTTP API Endpoints", () => {
		it("should serve main dashboard page", async () => {
			const response = await fetch(`http://localhost:${serverPort}/`);
			expect(response.status).toBe(200);
			expect(response.headers.get("content-type")).toContain("text/html");
			const html = await response.text();
			expect(html).toContain("Task Manager Dashboard");
		});

		it("should serve metrics API", async () => {
			// Mock product manager
			productManager.getAllTasks = async () => [
				{
					id: "test-1",
					title: "Test Task",
					status: "todo",
					priority: "medium",
					createdAt: new Date().toISOString(),
					updatedAt: new Date().toISOString()
				}
			];

			const response = await fetch(`http://localhost:${serverPort}/api/metrics`);
			expect(response.status).toBe(200);
			expect(response.headers.get("content-type")).toBe("application/json");
			
			const metrics = await response.json();
			expect(metrics).toHaveProperty("tasks");
			expect(metrics).toHaveProperty("daemon");
			expect(metrics).toHaveProperty("health");
			expect(metrics).toHaveProperty("system");
		});

		it("should serve tasks API with filtering", async () => {
			// Mock product manager
			productManager.getAllTasks = async () => [
				{
					id: "test-1",
					title: "High Priority Task",
					status: "todo",
					priority: "high",
					createdAt: new Date().toISOString(),
					updatedAt: new Date().toISOString()
				},
				{
					id: "test-2", 
					title: "Low Priority Task",
					status: "done",
					priority: "low",
					createdAt: new Date().toISOString(),
					updatedAt: new Date().toISOString()
				}
			];

			// Test status filter
			const response = await fetch(`http://localhost:${serverPort}/api/tasks?status=todo`);
			expect(response.status).toBe(200);
			
			const tasks = await response.json();
			expect(tasks).toHaveLength(1);
			expect(tasks[0].status).toBe("todo");
		});

		it("should serve queue status API", async () => {
			// Mock TCP client
			dashboardServer["tcpClient"] = {
				checkConnection: async () => true,
				sendCommand: async (command: string) => {
					if (command === "list_tasks") {
						return {
							success: true,
							data: [
								{ id: "1", status: "todo", priority: "high" },
								{ id: "2", status: "in-progress", priority: "medium" },
								{ id: "3", status: "failed", priority: "low" }
							]
						};
					}
					return { success: false, error: "Unknown command" };
				}
			};

			const response = await fetch(`http://localhost:${serverPort}/api/queue/status`);
			expect(response.status).toBe(200);
			
			const queueStatus = await response.json();
			expect(queueStatus).toHaveProperty("total");
			expect(queueStatus).toHaveProperty("highPriority");
			expect(queueStatus).toHaveProperty("failed");
			expect(queueStatus).toHaveProperty("processingTimes");
		});

		it("should serve activity logs API", async () => {
			// Mock TCP client
			dashboardServer["tcpClient"] = {
				sendCommand: async () => ({
					success: true,
					data: [
						{ id: "1", title: "Task 1", status: "done", updatedAt: new Date().toISOString() },
						{ id: "2", title: "Task 2", status: "failed", updatedAt: new Date().toISOString() }
					]
				})
			};

			const response = await fetch(`http://localhost:${serverPort}/api/logs?limit=10`);
			expect(response.status).toBe(200);
			
			const logs = await response.json();
			expect(Array.isArray(logs)).toBe(true);
			expect(logs).toHaveLength(2);
		});
	});

	describe("WebSocket Integration", () => {
		it("should establish WebSocket connection", (done) => {
			const ws = new WebSocket(`ws://localhost:${serverPort}/dashboard-ws`);
			
			ws.on("open", () => {
				expect(ws.readyState).toBe(WebSocket.OPEN);
				ws.close();
				done();
			});

			ws.on("error", (error) => {
				done(error);
			});
		});

		it("should send initial state on connection", (done) => {
			// Mock product manager
			productManager.getAllTasks = async () => [
				{
					id: "test-1",
					title: "Test Task",
					status: "todo",
					priority: "medium",
					createdAt: new Date().toISOString(),
					updatedAt: new Date().toISOString()
				}
			];

			const ws = new WebSocket(`ws://localhost:${serverPort}/dashboard-ws`);
			
			ws.on("message", (data) => {
				const message = JSON.parse(data.toString());
				expect(message.type).toBe("initial_state");
				expect(message.data).toHaveProperty("metrics");
				expect(message.data).toHaveProperty("tasks");
				ws.close();
				done();
			});

			ws.on("error", (error) => {
				done(error);
			});
		});

		it("should handle real-time task updates", (done) => {
			const ws = new WebSocket(`ws://localhost:${serverPort}/dashboard-ws`);
			let messageCount = 0;
			
			ws.on("message", (data) => {
				const message = JSON.parse(data.toString());
				messageCount++;
				
				if (messageCount === 1) {
					// Initial state
					expect(message.type).toBe("initial_state");
				} else if (messageCount === 2) {
					// Metrics update
					expect(message.type).toBe("metrics_update");
					ws.close();
					done();
				}
			});

			// Simulate periodic metrics broadcast
			setTimeout(() => {
				// This would trigger the periodic broadcast
			}, 100);
		});
	});

	describe("Task Management", () => {
		it("should handle task creation via API", async () => {
			const taskData = {
				title: "New Test Task",
				description: "Test description",
				priority: "high",
				createdBy: "test-user"
			};

			// Mock TCP client
			dashboardServer["tcpClient"] = {
				sendCommand: async (command: string, data: any) => {
					if (command === "create_task") {
						return {
							success: true,
							data: {
								id: "new-task-id",
								...data,
								status: "todo",
								createdAt: new Date().toISOString(),
								updatedAt: new Date().toISOString()
							}
						};
					}
					return { success: false, error: "Unknown command" };
				}
			};

			const response = await fetch(`http://localhost:${serverPort}/api/tasks`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(taskData)
			});

			expect(response.status).toBe(201);
			const result = await response.json();
			expect(result.success).toBe(true);
			expect(result.data.title).toBe(taskData.title);
		});

		it("should handle task status updates", async () => {
			// Mock TCP client
			dashboardServer["tcpClient"] = {
				sendCommand: async (command: string, data: any) => {
					if (command === "update_task_status") {
						return {
							success: true,
							data: {
								id: data.id,
								status: data.status,
								updatedAt: new Date().toISOString()
							}
						};
					}
					return { success: false, error: "Unknown command" };
				}
			};

			const response = await fetch(`http://localhost:${serverPort}/api/tasks/test-task-id`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ status: "in-progress" })
			});

			expect(response.status).toBe(200);
			const result = await response.json();
			expect(result.success).toBe(true);
			expect(result.data.status).toBe("in-progress");
		});

		it("should handle task deletion", async () => {
			// Mock TCP client
			dashboardServer["tcpClient"] = {
				sendCommand: async (command: string, data: any) => {
					if (command === "delete_task") {
						return { success: true, data: true };
					}
					return { success: false, error: "Unknown command" };
				}
			};

			const response = await fetch(`http://localhost:${serverPort}/api/tasks/test-task-id`, {
				method: "DELETE"
			});

			expect(response.status).toBe(200);
			const result = await response.json();
			expect(result.success).toBe(true);
		});
	});

	describe("Analytics Integration", () => {
		it("should serve analytics endpoints", async () => {
			// Mock analytics service
			analyticsService.handleAnalyticsRequest = async (req, res) => {
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify({
					success: true,
					data: {
						totalTasks: 100,
						completionRate: 85,
						averageProcessingTime: 45
					},
					timestamp: new Date().toISOString()
				}));
			};

			const response = await fetch(`http://localhost:${serverPort}/api/analytics/dashboard-summary`);
			expect(response.status).toBe(200);
			
			const analytics = await response.json();
			expect(analytics.success).toBe(true);
			expect(analytics.data).toHaveProperty("totalTasks");
			expect(analytics.data).toHaveProperty("completionRate");
		});

		it("should handle progress tracking requests", async () => {
			// Mock progress service
			const mockProgressData = [
				{
					taskId: "task-1",
					title: "Test Task",
					progressPercentage: 75,
					performanceScore: 85,
					isOverdue: false
				}
			];

			analyticsService.handleAnalyticsRequest = async (req, res) => {
				const url = new URL(req.url || "", `http://localhost`);
				if (url.pathname.includes("task-progress")) {
					res.writeHead(200, { "Content-Type": "application/json" });
					res.end(JSON.stringify({
						success: true,
						data: mockProgressData,
						timestamp: new Date().toISOString()
					}));
				}
			};

			const response = await fetch(`http://localhost:${serverPort}/api/analytics/task-progress`);
			expect(response.status).toBe(200);
			
			const progress = await response.json();
			expect(progress.success).toBe(true);
			expect(progress.data).toHaveLength(1);
			expect(progress.data[0].progressPercentage).toBe(75);
		});
	});

	describe("Error Handling", () => {
		it("should handle invalid API endpoints", async () => {
			const response = await fetch(`http://localhost:${serverPort}/api/invalid`);
			expect(response.status).toBe(404);
		});

		it("should handle malformed JSON requests", async () => {
			const response = await fetch(`http://localhost:${serverPort}/api/tasks`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: "invalid json"
			});

			expect(response.status).toBe(400);
		});

		it("should handle TCP client errors gracefully", async () => {
			// Mock failing TCP client
			dashboardServer["tcpClient"] = {
				sendCommand: async () => ({
					success: false,
					error: "Connection failed"
				})
			};

			const response = await fetch(`http://localhost:${serverPort}/api/tasks`);
			expect(response.status).toBe(500);
			
			const error = await response.json();
			expect(error.error).toContain("Failed to search tasks");
		});
	});

	describe("Security", () => {
		it("should sanitize HTML output", async () => {
			const response = await fetch(`http://localhost:${serverPort}/`);
			const html = await response.text();
			
			// Check for potential XSS vectors
			expect(html).not.toContain("<script>");
			expect(html).not.toContain("javascript:");
		});

		it("should handle large requests gracefully", async () => {
			// Create a very large search query
			const largeQuery = "a".repeat(10000);
			const response = await fetch(`http://localhost:${serverPort}/api/tasks?q=${largeQuery}`);
			
			// Should either handle gracefully or return appropriate error
			expect(response.status).toBeLessThan(500);
		});
	});
});

describe("Dashboard Analytics Service Tests", () => {
	let analyticsService: DashboardAnalyticsService;
	let productManager: ProductManager;

	beforeEach(() => {
		productManager = {} as ProductManager;
		analyticsService = new DashboardAnalyticsService(productManager);
	});

	describe("Progress Analytics", () => {
		it("should calculate task progress metrics", async () => {
			// Mock product manager with test tasks
			productManager.getAllTasks = async () => [
				{
					id: "task-1",
					title: "Completed Task",
					status: "done",
					priority: "high",
					createdAt: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
					updatedAt: new Date(Date.now() - 1800000).toISOString()  // 30 min ago
				},
				{
					id: "task-2",
					title: "In Progress Task",
					status: "in-progress",
					priority: "medium",
					createdAt: new Date(Date.now() - 7200000).toISOString(), // 2 hours ago
					updatedAt: new Date(Date.now() - 600000).toISOString()   // 10 min ago
				}
			];

			const progressData = await analyticsService.getTasksProgress({
				status: ["done", "in-progress"]
			});

			expect(progressData).toHaveLength(2);
			expect(progressData[0].progressPercentage).toBeGreaterThan(0);
			expect(progressData[0].performanceScore).toBeGreaterThan(0);
		});

		it("should generate productivity trends", async () => {
			// Mock tasks with different creation dates
			const now = new Date();
			const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
			
			productManager.getAllTasks = async () => [
				{
					id: "task-1",
					title: "Today's Task",
					status: "done",
					priority: "medium",
					createdAt: now.toISOString(),
					updatedAt: now.toISOString()
				},
				{
					id: "task-2",
					title: "Yesterday's Task",
					status: "done",
					priority: "low",
					createdAt: yesterday.toISOString(),
					updatedAt: yesterday.toISOString()
				}
			];

			const trends = await analyticsService.getProductivityTrends({
				from: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
				to: now
			});

			expect(trends).toHaveProperty("trends");
			expect(trends).toHaveProperty("completionRate");
			expect(trends.completionRate).toBeGreaterThan(0);
		});
	});

	describe("Performance Metrics", () => {
		it("should identify bottlenecks", async () => {
			// Mock tasks with various completion times
			productManager.getAllTasks = async () => [
				{
					id: "task-1",
					title: "Fast Task",
					status: "done",
					priority: "low",
					createdAt: new Date(Date.now() - 60000).toISOString(), // 1 min ago
					updatedAt: new Date(Date.now() - 30000).toISOString()  // 30 sec ago
				},
				{
					id: "task-2",
					title: "Slow Task",
					status: "done",
					priority: "high",
					createdAt: new Date(Date.now() - 7200000).toISOString(), // 2 hours ago
					updatedAt: new Date(Date.now() - 3600000).toISOString()  // 1 hour ago
				}
			];

			const metrics = await analyticsService.getPerformanceMetrics();

			expect(metrics).toHaveProperty("bottlenecks");
			expect(metrics).toHaveProperty("overallMetrics");
			expect(metrics.overallMetrics.totalTasks).toBe(2);
		});

		it("should calculate performance distribution", async () => {
			// Mock tasks with different performance characteristics
			productManager.getAllTasks = async () => [
				{ id: "task-1", status: "done", priority: "high" },
				{ id: "task-2", status: "done", priority: "medium" },
				{ id: "task-3", status: "done", priority: "low" },
				{ id: "task-4", status: "in-progress", priority: "high" },
				{ id: "task-5", status: "failed", priority: "medium" }
			];

			const metrics = await analyticsService.getPerformanceMetrics();

			expect(metrics.performanceDistribution).toHaveProperty("excellent");
			expect(metrics.performanceDistribution).toHaveProperty("good");
			expect(metrics.performanceDistribution).toHaveProperty("fair");
			expect(metrics.performanceDistribution).toHaveProperty("poor");
		});
	});

	describe("Retention Management", () => {
		it("should calculate retention statistics", async () => {
			// Mock service with retention data
			const mockStats = await analyticsService.getRetentionStatistics();

			expect(mockStats).toHaveProperty("retention");
			expect(mockStats).toHaveProperty("recommendations");
			expect(mockStats.recommendations).toBeInstanceOf(Array);
		});

		it("should apply retention policy", async () => {
			const policy = {
				olderThanDays: 30,
				keepHighPriorityTasks: true,
				keepFailedTasks: false,
				keepTasksWithDependencies: true,
				minEventsPerTask: 5,
				maxEventsPerTask: 100,
				dryRun: true
			};

			const result = await analyticsService.applyRetentionPolicy(policy);

			expect(result).toHaveProperty("policyApplied");
			expect(result).toHaveProperty("result");
			expect(result.result).toHaveProperty("deletedEvents");
			expect(result.result).toHaveProperty("keptEvents");
		});
	});
});
