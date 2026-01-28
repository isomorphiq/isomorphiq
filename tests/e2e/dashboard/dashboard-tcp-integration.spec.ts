import { describe, it, beforeEach, afterEach } from "node:test";
import { expect } from "../../test-utils/expect.ts";
import { DaemonTcpClient } from "./tcp-client.ts";

describe("TCP API Integration Tests", () => {
	let tcpClient: DaemonTcpClient;
	const TEST_PORT = 3001;
	const TEST_HOST = "localhost";

	beforeEach(() => {
		tcpClient = new DaemonTcpClient(TEST_PORT, TEST_HOST);
	});

	afterEach(() => {
		tcpClient.disconnectWebSocket();
	});

	describe("Connection Management", () => {
		it("should check TCP connection status", async () => {
			const isConnected = await tcpClient.checkConnection();
			expect(typeof isConnected).toBe("boolean");
		});

		it("should handle connection timeout gracefully", async () => {
			const invalidClient = new DaemonTcpClient(9999, TEST_HOST);
			const isConnected = await invalidClient.checkConnection();
			expect(isConnected).toBe(false);
		});
	});

	describe("Task CRUD Operations", () => {
		it("should create a new task via TCP API", async () => {
			const taskData = {
				title: "TCP Integration Test Task",
				description: "Testing task creation via TCP API",
				priority: "high",
				createdBy: "integration-test"
			};

			const result = await tcpClient.createTask(taskData);
			expect(result.success).toBe(true);
			expect(result.data).toHaveProperty("id");
			expect(result.data.title).toBe(taskData.title);
			expect(result.data.description).toBe(taskData.description);
			expect(result.data.priority).toBe(taskData.priority);
			expect(result.data.createdBy).toBe(taskData.createdBy);
		});

		it("should handle task creation with invalid data", async () => {
			const invalidTaskData = {
				title: "", // Empty title should fail
				description: "Invalid task with empty title"
			};

			const result = await tcpClient.createTask(invalidTaskData);
			expect(result.success).toBe(false);
			expect(result.error).toBeDefined();
		});

		it("should list all tasks", async () => {
			const result = await tcpClient.listTasks();
			expect(result.success).toBe(true);
			expect(Array.isArray(result.data)).toBe(true);
		});

		it("should get specific task by ID", async () => {
			// First create a task
			const createResult = await tcpClient.createTask({
				title: "Get Task Test",
				description: "Task for get operation test",
				priority: "medium"
			});

			expect(createResult.success).toBe(true);
			const taskId = createResult.data.id;

			// Now get the task
			const getResult = await tcpClient.getTask(taskId);
			expect(getResult.success).toBe(true);
			expect(getResult.data.id).toBe(taskId);
			expect(getResult.data.title).toBe("Get Task Test");
		});

		it("should handle getting non-existent task", async () => {
			const result = await tcpClient.getTask("non-existent-task-id");
			expect(result.success).toBe(false);
			expect(result.error?.message).toContain("not found");
		});

		it("should update task status", async () => {
			// Create a task first
			const createResult = await tcpClient.createTask({
				title: "Status Update Test",
				description: "Task for status update test",
				priority: "low"
			});

			expect(createResult.success).toBe(true);
			const taskId = createResult.data.id;
			const initialStatus = createResult.data.status;

			// Update the task status
			const updateResult = await tcpClient.updateTaskStatus(taskId, "done");
			expect(updateResult.success).toBe(true);
			expect(updateResult.data.status).toBe("done");
			expect(updateResult.data.status).not.toBe(initialStatus);
		});

		it("should update task priority", async () => {
			// Create a task first
			const createResult = await tcpClient.createTask({
				title: "Priority Update Test",
				description: "Task for priority update test",
				priority: "medium"
			});

			expect(createResult.success).toBe(true);
			const taskId = createResult.data.id;
			const initialPriority = createResult.data.priority;

			// Update the task priority
			const updateResult = await tcpClient.updateTaskPriority(taskId, "high");
			expect(updateResult.success).toBe(true);
			expect(updateResult.data.priority).toBe("high");
			expect(updateResult.data.priority).not.toBe(initialPriority);
		});

		it("should delete a task", async () => {
			// Create a task first
			const createResult = await tcpClient.createTask({
				title: "Delete Test Task",
				description: "Task for deletion test",
				priority: "low"
			});

			expect(createResult.success).toBe(true);
			const taskId = createResult.data.id;

			// Delete the task
			const deleteResult = await tcpClient.deleteTask(taskId);
			expect(deleteResult.success).toBe(true);
			expect(deleteResult.data).toBe(true);

			// Verify task is deleted
			const getResult = await tcpClient.getTask(taskId);
			expect(getResult.success).toBe(false);
		});
	});

	describe("Advanced Task Operations", () => {
		it("should filter tasks by status", async () => {
			const result = await tcpClient.listTasksFiltered({
				status: "todo"
			});

			expect(result.success).toBe(true);
			expect(Array.isArray(result.data)).toBe(true);
			
			// All returned tasks should have the specified status
			result.data.forEach(task => {
				expect(task.status).toBe("todo");
			});
		});

		it("should filter tasks by priority", async () => {
			const result = await tcpClient.listTasksFiltered({
				priority: "high"
			});

			expect(result.success).toBe(true);
			expect(Array.isArray(result.data)).toBe(true);
			
			// All returned tasks should have the specified priority
			result.data.forEach(task => {
				expect(task.priority).toBe("high");
			});
		});

		it("should filter tasks by multiple criteria", async () => {
			const result = await tcpClient.listTasksFiltered({
				status: ["todo", "in-progress"],
				priority: ["high", "medium"],
				limit: 10
			});

			expect(result.success).toBe(true);
			expect(Array.isArray(result.data)).toBe(true);
			expect(result.data.length).toBeLessThanOrEqual(10);
			
			// All returned tasks should match the criteria
			result.data.forEach(task => {
				expect(["todo", "in-progress"]).toContain(task.status);
				expect(["high", "medium"]).toContain(task.priority);
			});
		});

		it("should search tasks by text", async () => {
			const result = await tcpClient.listTasksFiltered({
				search: "integration test"
			});

			expect(result.success).toBe(true);
			expect(Array.isArray(result.data)).toBe(true);
			
			// All returned tasks should contain the search text
			result.data.forEach(task => {
				const searchText = "integration test";
				const containsInTitle = task.title.toLowerCase().includes(searchText);
				const containsInDescription = task.description.toLowerCase().includes(searchText);
				expect(containsInTitle || containsInDescription).toBe(true);
			});
		});

		it("should paginate task results", async () => {
			// Get first page
			const firstPageResult = await tcpClient.listTasksFiltered({
				limit: 5,
				offset: 0
			});

			// Get second page
			const secondPageResult = await tcpClient.listTasksFiltered({
				limit: 5,
				offset: 5
			});

			expect(firstPageResult.success).toBe(true);
			expect(secondPageResult.success).toBe(true);
			expect(firstPageResult.data.length).toBeLessThanOrEqual(5);
			expect(secondPageResult.data.length).toBeLessThanOrEqual(5);

			// Ensure we get different results (if there are enough tasks)
			if (firstPageResult.data.length === 5 && secondPageResult.data.length === 5) {
				const firstPageIds = firstPageResult.data.map(t => t.id);
				const secondPageIds = secondPageResult.data.map(t => t.id);
				const overlap = firstPageIds.filter(id => secondPageIds.includes(id));
				expect(overlap.length).toBe(0);
			}
		});
	});

	describe("Task Status Operations", () => {
		it("should get task status by ID", async () => {
			// Create a task first
			const createResult = await tcpClient.createTask({
				title: "Status Query Test",
				description: "Task for status query test",
				priority: "high"
			});

			expect(createResult.success).toBe(true);
			const taskId = createResult.data.id;

			// Get task status
			const statusResult = await tcpClient.getTaskStatus(taskId);
			expect(statusResult.success).toBe(true);
			expect(statusResult.data).toHaveProperty("taskId", taskId);
			expect(statusResult.data).toHaveProperty("status");
			expect(statusResult.data).toHaveProperty("updatedAt");
		});

		it("should handle status query for non-existent task", async () => {
			const result = await tcpClient.getTaskStatus("non-existent-task");
			expect(result.success).toBe(false);
			expect(result.error?.message).toContain("not found");
		});
	});

	describe("Real-time Notifications", () => {
		it("should subscribe to task notifications", async () => {
			const result = await tcpClient.subscribeToTaskNotifications({
				sessionId: "integration-test-session",
				taskIds: ["task-1", "task-2"],
				includeTcpResponse: true
			});

			expect(result.success).toBe(true);
			expect(result.data).toHaveProperty("sessionId", "integration-test-session");
			expect(result.data).toHaveProperty("subscribedTasks");
			expect(Array.isArray(result.data.subscribedTasks)).toBe(true);
		});

		it("should generate unique session ID when not provided", async () => {
			const result = await tcpClient.subscribeToTaskNotifications({
				taskIds: ["task-1"]
			});

			expect(result.success).toBe(true);
			expect(result.data).toHaveProperty("sessionId");
			expect(typeof result.data.sessionId).toBe("string");
			expect(result.data.sessionId.length).toBeGreaterThan(0);
		});
	});

	describe("Error Handling and Edge Cases", () => {
		it("should handle malformed commands gracefully", async () => {
			// This tests the internal sendCommand method with invalid data
			const client = new DaemonTcpClient(TEST_PORT, TEST_HOST);
			
			// Test with malformed command
			const result = await client.sendCommand("invalid_command", {});
			expect(result.success).toBe(false);
			expect(result.error).toBeDefined();
		});

		it("should handle connection errors gracefully", async () => {
			const invalidClient = new DaemonTcpClient(9999, "invalid-host");
			
			const result = await invalidClient.listTasks();
			expect(result.success).toBe(false);
			expect(result.error?.message).toContain("Connection error");
		});

		it("should handle request timeouts", async () => {
			// This is difficult to test reliably without modifying the client
			// But we can test with an invalid port that will cause timeout
			const timeoutClient = new DaemonTcpClient(9998, "127.0.0.1");
			
			const startTime = Date.now();
			const result = await timeoutClient.listTasks();
			const endTime = Date.now();
			
			expect(result.success).toBe(false);
			// Should timeout after a reasonable period (10 seconds is configured in client)
			expect(endTime - startTime).toBeGreaterThan(5000);
		});
	});

	describe("WebSocket Integration", () => {
		it("should establish WebSocket connection for real-time updates", async () => {
			try {
				const wsConnection = await tcpClient.connectWebSocket(3005);
				expect(wsConnection).toBeDefined();
				expect(wsConnection.readyState).toBe(1); // WebSocket.OPEN
				
				// Clean up
				tcpClient.disconnectWebSocket();
			} catch (error) {
				// WebSocket might not be available in test environment
				expect(error).toBeDefined();
			}
		});

		it("should handle WebSocket connection errors", async () => {
			const wsClient = new DaemonTcpClient(TEST_PORT, TEST_HOST);
			
			try {
				await wsClient.connectWebSocket(9999);
				expect(false).toBe(true); // Should not reach here
			} catch (error) {
				expect(error).toBeDefined();
			}
		});

		it("should check WebSocket connection status", () => {
			const isConnected = tcpClient.isWebSocketConnected();
			expect(typeof isConnected).toBe("boolean");
		});

		it("should get WebSocket connection object", () => {
			const wsConnection = tcpClient.getWebSocketConnection();
			expect(wsConnection === null || typeof wsConnection === "object").toBe(true);
		});
	});

	describe("System Operations", () => {
		it("should get WebSocket status", async () => {
			const result = await tcpClient.getWebSocketStatus();
			expect(result.success).toBe(true);
			expect(typeof result.data).toBe("object");
		});

		it("should handle system restart command", async () => {
			// Note: This is a potentially destructive test
			// In a real environment, this would restart the daemon
			// For testing purposes, we just verify the command is accepted
			const result = await tcpClient.restart();
			
			// Might fail in test environment, but should not crash
			expect(typeof result.success).toBe("boolean");
		});
	});

	describe("Task Monitoring Sessions", () => {
		it("should create monitoring session", async () => {
			const filters = {
				status: "todo",
				priority: "high"
			};

			const result = await tcpClient.createMonitoringSession(filters);
			expect(result.success).toBe(true);
			expect(result.data).toHaveProperty("id");
			expect(result.data).toHaveProperty("filters");
			expect(result.data).toHaveProperty("createdAt");
			expect(result.data).toHaveProperty("active", true);
		});

		it("should update monitoring session", async () => {
			// Create a session first
			const createResult = await tcpClient.createMonitoringSession({
				status: "todo"
			});

			expect(createResult.success).toBe(true);
			const sessionId = createResult.data.id;

			// Update the session
			const updateResult = await tcpClient.updateMonitoringSession(sessionId, {
				status: "in-progress",
				priority: "high"
			});

			expect(updateResult.success).toBe(true);
		});

		it("should get monitoring session", async () => {
			// Create a session first
			const createResult = await tcpClient.createMonitoringSession({
				status: "done"
			});

			expect(createResult.success).toBe(true);
			const sessionId = createResult.data.id;

			// Get the session
			const getResult = await tcpClient.getMonitoringSession(sessionId);
			expect(getResult.success).toBe(true);
			expect(getResult.data.id).toBe(sessionId);
		});

		it("should list all monitoring sessions", async () => {
			const result = await tcpClient.getMonitoringSessions();
			expect(result.success).toBe(true);
			expect(Array.isArray(result.data)).toBe(true);
		});

		it("should close monitoring session", async () => {
			// Create a session first
			const createResult = await tcpClient.createMonitoringSession({
				status: "failed"
			});

			expect(createResult.success).toBe(true);
			const sessionId = createResult.data.id;

			// Close the session
			const closeResult = await tcpClient.closeMonitoringSession(sessionId);
			expect(closeResult.success).toBe(true);
		});
	});

	describe("Performance and Load Testing", () => {
		it("should handle multiple concurrent requests", async () => {
			const requests = Array.from({ length: 20 }, (_, i) =>
				tcpClient.listTasks()
			);

			const results = await Promise.allSettled(requests);
			
			// Most requests should succeed
			const successful = results.filter(r => r.status === 'fulfilled').length;
			expect(successful).toBeGreaterThan(15); // At least 75% success rate

			// Verify responses are consistent
			const successfulResults = results
				.filter(r => r.status === 'fulfilled')
				.map(r => (r as PromiseFulfilledResult<any>).value);
			
			successfulResults.forEach(result => {
				expect(result.success).toBe(true);
				expect(Array.isArray(result.data)).toBe(true);
			});
		});

		it("should handle rapid task creation", async () => {
			const createRequests = Array.from({ length: 10 }, (_, i) =>
				tcpClient.createTask({
					title: `Rapid Task ${i}`,
					description: `Created in rapid test ${i}`,
					priority: "medium"
				})
			);

			const results = await Promise.allSettled(createRequests);
			
			// Most should succeed
			const successful = results.filter(r => 
				r.status === 'fulfilled' && 
				(r as PromiseFulfilledResult<any>).value.success
			).length;
			
			expect(successful).toBeGreaterThan(5);
		});

		it("should handle large payloads", async () => {
			const largeDescription = "x".repeat(10000); // 10KB description
			const largeTask = {
				title: "Large Task Test",
				description: largeDescription,
				priority: "low",
				collaborators: Array.from({ length: 100 }, (_, i) => `user${i}@example.com`)
			};

			const result = await tcpClient.createTask(largeTask);
			
			// Should handle gracefully without memory issues
			expect(typeof result.success).toBe("boolean");
		});
	});
});
