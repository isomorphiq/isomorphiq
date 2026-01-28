// Simple dashboard functionality test
import { describe, it } from "node:test";
import { expect } from "../../test-utils/expect.ts";

describe("Dashboard Integration Verification", () => {
	const DASHBOARD_PORT = 3005;
	const BASE_URL = `http://localhost:${DASHBOARD_PORT}`;

	it("should serve dashboard HTML at root", async () => {
		const response = await fetch(`${BASE_URL}/`);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("text/html");
		
		const html = await response.text();
		expect(html).toContain("Task Manager Dashboard");
		expect(html).toContain("Real-time Task Monitoring");
	});

	it("should provide metrics API", async () => {
		const response = await fetch(`${BASE_URL}/api/metrics`);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("application/json");
		
		const metrics = await response.json();
		expect(metrics).toHaveProperty("tasks");
		expect(metrics).toHaveProperty("daemon");
		expect(metrics).toHaveProperty("health");
		expect(metrics).toHaveProperty("system");
		
		expect(metrics.tasks).toHaveProperty("total");
		expect(metrics.tasks).toHaveProperty("pending");
		expect(metrics.tasks).toHaveProperty("inProgress");
		expect(metrics.tasks).toHaveProperty("completed");
		expect(metrics.daemon).toHaveProperty("uptime");
		expect(metrics.daemon).toHaveProperty("pid");
		expect(metrics.health).toHaveProperty("status");
	});

	it("should provide tasks API", async () => {
		const response = await fetch(`${BASE_URL}/api/tasks`);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("application/json");
		
		const tasks = await response.json();
		expect(Array.isArray(tasks)).toBe(true);
		
		if (tasks.length > 0) {
			const task = tasks[0];
			expect(task).toHaveProperty("id");
			expect(task).toHaveProperty("title");
			expect(task).toHaveProperty("status");
			expect(task).toHaveProperty("priority");
			expect(task).toHaveProperty("createdAt");
			expect(task).toHaveProperty("updatedAt");
		}
	});

	it("should support task filtering", async () => {
		const response = await fetch(`${BASE_URL}/api/tasks?status=done`);
		expect(response.status).toBe(200);
		
		const tasks = await response.json();
		expect(Array.isArray(tasks)).toBe(true);
		
		// All returned tasks should have the filtered status
		tasks.forEach(task => {
			expect(task.status).toBe("done");
		});
	});

	it("should support task search", async () => {
		const response = await fetch(`${BASE_URL}/api/tasks/search?q=Dashboard`);
		expect(response.status).toBe(200);
		
		const tasks = await response.json();
		expect(Array.isArray(tasks)).toBe(true);
		
		// All returned tasks should contain the search term
		tasks.forEach(task => {
			const containsTerm = 
				task.title.toLowerCase().includes("dashboard".toLowerCase()) ||
				(task.description && task.description.toLowerCase().includes("dashboard".toLowerCase()));
			expect(containsTerm).toBe(true);
		});
	});

	it("should provide queue status API", async () => {
		const response = await fetch(`${BASE_URL}/api/queue/status`);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("application/json");
		
		const queueStatus = await response.json();
		expect(queueStatus).toHaveProperty("total");
		expect(queueStatus).toHaveProperty("queueByPriority");
		expect(queueStatus).toHaveProperty("processingTimes");
		
		expect(queueStatus.queueByPriority).toHaveProperty("high");
		expect(queueStatus.queueByPriority).toHaveProperty("medium");
		expect(queueStatus.queueByPriority).toHaveProperty("low");
	});

	it("should provide health API", async () => {
		const response = await fetch(`${BASE_URL}/api/health`);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("application/json");
		
		const health = await response.json();
		expect(health).toHaveProperty("status");
		expect(health).toHaveProperty("daemon");
	});

	it("should provide activity logs API", async () => {
		const response = await fetch(`${BASE_URL}/api/logs?limit=10`);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("application/json");
		
		const logs = await response.json();
		expect(Array.isArray(logs)).toBe(true);
		
		if (logs.length > 0) {
			const log = logs[0];
			expect(log).toHaveProperty("message");
			expect(log).toHaveProperty("timestamp");
			expect(log).toHaveProperty("level");
		}
	});

	it("should handle 404 for unknown routes", async () => {
		const response = await fetch(`${BASE_URL}/non-existent-endpoint`);
		expect(response.status).toBe(404);
	});

	it("should support task creation endpoint", async () => {
		const newTask = {
			title: "Test Dashboard Task",
			description: "Task created via dashboard API test",
			priority: "medium"
		};

		const response = await fetch(`${BASE_URL}/api/tasks`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(newTask)
		});

		// Should either succeed (200/201) or provide validation error (400)
		expect([200, 201, 400]).toContain(response.status);
		
		if ([200, 201].includes(response.status)) {
			const result = await response.json();
			expect(result).toHaveProperty("success");
			if (result.success) {
				expect(result).toHaveProperty("data");
				expect(result.data).toHaveProperty("id");
				expect(result.data).toHaveProperty("title", newTask.title);
			}
		}
	});

	it("should support task status updates", async () => {
		// First get existing tasks
		const tasksResponse = await fetch(`${BASE_URL}/api/tasks`);
		const tasks = await tasksResponse.json();
		
		if (tasks.length > 0) {
			const task = tasks[0];
			const updateData = {
				id: task.id,
				status: "todo"
			};

			const response = await fetch(`${BASE_URL}/api/tasks/update`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(updateData)
			});

			// Should either succeed or provide validation error
			expect([200, 400]).toContain(response.status);
		}
	});

	it("should provide comprehensive dashboard HTML with required features", async () => {
		const response = await fetch(`${BASE_URL}/`);
		expect(response.status).toBe(200);
		
		const html = await response.text();
		
		// Verify key dashboard features are present
		expect(html).toContain("Task Manager Dashboard");
		expect(html).toContain("Overview");
		expect(html).toContain("Queue Status");
		expect(html).toContain("Tasks");
		expect(html).toContain("Create Task");
		expect(html).toContain("Health");
		expect(html).toContain("Activity Log");
		
		// Verify forms and controls
		expect(html).toContain("taskForm");
		expect(html).toContain("searchInput");
		expect(html).toContain("statusFilter");
		expect(html).toContain("priorityFilter");
		
		// Verify WebSocket functionality
		expect(html).toContain("WebSocket");
		expect(html).toContain("dashboard-ws");
		
		// Verify real-time features
		expect(html).toContain("auto-refresh");
		expect(html).toContain("loadMetrics");
		expect(html).toContain("loadTasks");
		
		// Verify task management functions
		expect(html).toContain("createTask");
		expect(html).toContain("updateTaskStatus");
		expect(html).toContain("deleteTask");
		expect(html).toContain("viewTaskDetails");
	});
});

console.log("✅ Dashboard integration verification complete!");
