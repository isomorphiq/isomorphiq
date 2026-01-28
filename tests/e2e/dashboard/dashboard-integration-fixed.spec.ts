// Dashboard Integration Tests
import { describe, it, beforeEach, afterEach } from "node:test";
import { expect } from "../../test-utils/expect.ts";
import { createServer } from "node:http";

describe("Dashboard Integration", () => {
	let httpServer: any;
	let dashboardPort: number;

	beforeEach(async () => {
		// Start a mock dashboard server for testing
		httpServer = createServer((req: any, res: any) => {
			if (req.url === "/") {
				res.writeHead(200, { "Content-Type": "text/html" });
				res.end("<!DOCTYPE html><html><head><title>Test Dashboard</title></head><body>Dashboard</body></html>");
			} else if (req.url?.startsWith("/api/metrics")) {
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify({
					tasks: { total: 5, pending: 2, inProgress: 1, completed: 2 },
					daemon: { uptime: 3600, memory: { used: 50000000, total: 100000000 } },
					health: { status: "healthy", memoryUsage: 50, wsConnections: 1, tcpConnected: true }
				}));
			} else if (req.url?.startsWith("/api/tasks")) {
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify([
					{
						id: "task-1",
						title: "Test Task 1",
						description: "First test task",
						status: "todo",
						priority: "high",
						createdAt: new Date().toISOString(),
						updatedAt: new Date().toISOString()
					},
					{
						id: "task-2", 
						title: "Test Task 2",
						description: "Second test task",
						status: "in-progress",
						priority: "medium",
						createdAt: new Date().toISOString(),
						updatedAt: new Date().toISOString()
					}
				]));
			} else if (req.url?.startsWith("/api/tasks/search")) {
				const url = new URL(req.url, `http://localhost:${dashboardPort}`);
				const query = url.searchParams.get("q") || "";
				
				res.writeHead(200, { "Content-Type": "application/json" });
				
				// Mock search functionality
				const allTasks = [
					{ id: "task-1", title: "Test Task 1", description: "First test task", status: "todo", priority: "high" },
					{ id: "task-2", title: "Test Task 2", description: "Second test task", status: "in-progress", priority: "medium" },
					{ id: "task-3", title: "Important Task", description: "Critical task", status: "done", priority: "high" }
				];
				
				const filtered = query ? 
					allTasks.filter(task => 
						task.title.toLowerCase().includes(query.toLowerCase()) ||
						task.description.toLowerCase().includes(query.toLowerCase())
					) : allTasks;
				
				res.end(JSON.stringify(filtered));
			} else {
				res.writeHead(404);
				res.end("Not Found");
			}
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

	describe("Basic Dashboard Functionality", () => {
		it("should load dashboard homepage", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/`);
			expect(response.status).toBe(200);
			expect(response.headers.get("content-type")).toContain("text/html");
			
			const html = await response.text();
			expect(html).toContain("Test Dashboard");
		});

		it("should fetch and display metrics", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/api/metrics`);
			expect(response.status).toBe(200);
			
			const metrics = await response.json();
			expect(metrics).toHaveProperty("tasks");
			expect(metrics).toHaveProperty("daemon");
			expect(metrics).toHaveProperty("health");
			expect(metrics.tasks.total).toBe(5);
			expect(metrics.tasks.pending).toBe(2);
			expect(metrics.health.status).toBe("healthy");
		});

		it("should fetch and display task list", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/api/tasks`);
			expect(response.status).toBe(200);
			
			const tasks = await response.json();
			expect(Array.isArray(tasks)).toBe(true);
			expect(tasks.length).toBe(2);
			expect(tasks[0].title).toBe("Test Task 1");
			expect(tasks[1].status).toBe("in-progress");
		});

		it("should search tasks by text", async () => {
			// Test search functionality
			const searchResponse1 = await fetch(`http://localhost:${dashboardPort}/api/tasks/search?q=Test`);
			const searchResults1 = await searchResponse1.json();
			expect(searchResults1.length).toBe(2);
			expect(searchResults1.every((task: any) => task.title.includes("Test"))).toBe(true);

			const searchResponse2 = await fetch(`http://localhost:${dashboardPort}/api/tasks/search?q=Important`);
			const searchResults2 = await searchResponse2.json();
			expect(searchResults2.length).toBe(1);
			expect(searchResults2[0].title).toBe("Important Task");
		});

		it("should handle 404 for unknown routes", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/non-existent-endpoint`);
			expect(response.status).toBe(404);
		});
	});

	describe("Dashboard Features", () => {
		it("should handle filtering by status", async () => {
			const todoResponse = await fetch(`http://localhost:${dashboardPort}/api/tasks/search?q=Task&status=todo`);
			const todoTasks = await todoResponse.json();
			expect(todoTasks.length).toBe(1);
			expect(todoTasks[0].status).toBe("todo");
		});

		it("should provide comprehensive task data", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/api/tasks`);
			const tasks = await response.json();
			
			tasks.forEach((task: any) => {
				expect(task).toHaveProperty("id");
				expect(task).toHaveProperty("title");
				expect(task).toHaveProperty("description");
				expect(task).toHaveProperty("status");
				expect(task).toHaveProperty("priority");
				expect(task).toHaveProperty("createdAt");
				expect(task).toHaveProperty("updatedAt");
			});
		});

		it("should handle concurrent requests", async () => {
			// Test multiple concurrent requests
			const promises = Array(10).fill(null).map(() => 
				fetch(`http://localhost:${dashboardPort}/api/metrics`)
			);
			
			const responses = await Promise.all(promises);
			responses.forEach(response => {
				expect(response.status).toBe(200);
			});
		});
	});
});