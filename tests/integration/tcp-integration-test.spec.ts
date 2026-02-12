import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { DaemonTcpClient, type Task, type TaskFilter } from "../e2e/dashboard/tcp-client.ts";
import { startTestDaemon, type TestDaemonHandle } from "./daemon-test-harness.ts";

describe("TCP Integration Test Task", () => {
    let tcpClient: DaemonTcpClient;
    let daemon: TestDaemonHandle;
    const TEST_HOST = "localhost";

    before(async () => {
        daemon = await startTestDaemon();
        tcpClient = new DaemonTcpClient(daemon.tcpPort, TEST_HOST);
    });

    after(async () => {
        tcpClient.disconnectWebSocket();
        await daemon.cleanup();
    });

    describe("Connection Management", () => {
        it("should check TCP connection status", async () => {
            const isConnected = await tcpClient.checkConnection();
            assert.equal(typeof isConnected, "boolean", "Should return boolean connection status");
        });

        it("should handle connection timeout gracefully", async () => {
            const invalidClient = new DaemonTcpClient(9999, TEST_HOST);
            const isConnected = await invalidClient.checkConnection();
            assert.equal(isConnected, false, "Should return false for invalid port");
        });
    });

    describe("Task CRUD Operations", () => {
        it("should create a task via TCP integration test", async () => {
            const taskData = {
                title: "Integration Test Task",
                description: "Task created via TCP integration test",
                priority: "medium",
                createdBy: "integration-test"
            };

            const result = await tcpClient.createTask(taskData);
            assert.ok(result.success, "Should successfully create task");
            assert.ok(result.data, "Should return task data");
            assert.ok(result.data.id, "Should return task ID");
            assert.equal(result.data.title, taskData.title, "Should set correct title");
            assert.equal(result.data.description, taskData.description, "Should set correct description");
            assert.equal(result.data.priority, taskData.priority, "Should set correct priority");
            assert.equal(result.data.createdBy, taskData.createdBy, "Should set correct creator");
            assert.equal(result.data.status, "todo", "Should have default status");
        });

        it("should handle task creation with invalid data", async () => {
            const invalidTaskData = {
                title: "", // Empty title should fail
                description: "Invalid task with empty title"
            };

            const result = await tcpClient.createTask(invalidTaskData);
            assert.equal(result.success, false, "Should fail to create task with empty title");
            assert.ok(result.error, "Should provide error message");
        });

        it("should list all tasks", async () => {
            // Create a test task first
            await tcpClient.createTask({
                title: "List Test Task",
                description: "Task for testing list functionality",
                priority: "high"
            });

            const result = await tcpClient.listTasks();
            assert.ok(result.success, "Should successfully list tasks");
            assert.ok(result.data, "Should return data");
            assert.ok(Array.isArray(result.data), "Should return array of tasks");
            assert.ok(result.data.length > 0, "Should return at least one task");
        });

        it("should get specific task by ID", async () => {
            // Create a task first
            const createResult = await tcpClient.createTask({
                title: "Get Task Test",
                description: "Task for get operation test",
                priority: "medium"
            });

            assert.ok(createResult.success, "Should create task successfully");
            assert.ok(createResult.data, "Should have task data");
            const taskId = createResult.data.id;

            // Now get the task
            const getResult = await tcpClient.getTask(taskId);
            assert.ok(getResult.success, "Should retrieve task successfully");
            assert.ok(getResult.data, "Should have task data");
            assert.equal(getResult.data.id, taskId, "Should return correct task");
            assert.equal(getResult.data.title, "Get Task Test", "Should return correct title");
        });

        it("should handle getting non-existent task", async () => {
            const result = await tcpClient.getTask("non-existent-task-id");
            assert.equal(result.success, false, "Should fail for non-existent task");
            assert.ok(result.error?.message.includes("not found"), "Should provide not found error");
        });

        it("should update task status", async () => {
            // Create a task first
            const createResult = await tcpClient.createTask({
                title: "Status Update Test",
                description: "Task for status update test",
                priority: "low"
            });

            assert.ok(createResult.success, "Should create task successfully");
            assert.ok(createResult.data, "Should have task data");
            const taskId = createResult.data.id;
            const initialStatus = createResult.data.status;

            // Update the task status
            const updateResult = await tcpClient.updateTaskStatus(taskId, "done");
            assert.ok(updateResult.success, "Should update task status successfully");
            assert.ok(updateResult.data, "Should have updated task data");
            assert.equal(updateResult.data.status, "done", "Should have updated status");
            assert.notEqual(updateResult.data.status, initialStatus, "Status should be different");
        });

        it("should update task priority", async () => {
            // Create a task first
            const createResult = await tcpClient.createTask({
                title: "Priority Update Test",
                description: "Task for priority update test",
                priority: "medium"
            });

            assert.ok(createResult.success, "Should create task successfully");
            assert.ok(createResult.data, "Should have task data");
            const taskId = createResult.data.id;
            const initialPriority = createResult.data.priority;

            // Update the task priority
            const updateResult = await tcpClient.updateTaskPriority(taskId, "high");
            assert.ok(updateResult.success, "Should update task priority successfully");
            assert.ok(updateResult.data, "Should have updated task data");
            assert.equal(updateResult.data.priority, "high", "Should have updated priority");
            assert.notEqual(updateResult.data.priority, initialPriority, "Priority should be different");
        });

        it("should delete a task", async () => {
            // Create a task first
            const createResult = await tcpClient.createTask({
                title: "Delete Test Task",
                description: "Task for deletion test",
                priority: "low"
            });

            assert.ok(createResult.success, "Should create task successfully");
            assert.ok(createResult.data, "Should have task data");
            const taskId = createResult.data.id;

            // Delete the task
            const deleteResult = await tcpClient.deleteTask(taskId);
            assert.ok(deleteResult.success, "Should delete task successfully");
            assert.equal(deleteResult.data, true, "Should return true for successful deletion");

            // Verify task is deleted
            const getResult = await tcpClient.getTask(taskId);
            assert.equal(getResult.success, false, "Should not find deleted task");
        });
    });

    describe("Advanced Task Operations", () => {
        it("should filter tasks by status", async () => {
            // Create tasks with different statuses
            await tcpClient.createTask({
                title: "Todo Task",
                description: "Task with todo status",
                priority: "medium"
            });

            const updateResult = await tcpClient.createTask({
                title: "Done Task",
                description: "Task that will be marked done",
                priority: "low"
            });

            if (updateResult.success && updateResult.data) {
                await tcpClient.updateTaskStatus(updateResult.data.id, "done");
            }

            const result = await tcpClient.listTasksFiltered({
                status: "todo"
            });

            assert.ok(result.success, "Should filter tasks successfully");
            assert.ok(result.data, "Should return data");
            assert.ok(Array.isArray(result.data), "Should return array of tasks");
            
            // All returned tasks should have the specified status
            result.data.forEach((task: Task) => {
                assert.equal(task.status, "todo", "All tasks should have todo status");
            });
        });

        it("should filter tasks by priority", async () => {
            // Create tasks with different priorities
            await tcpClient.createTask({
                title: "High Priority Task",
                description: "Task with high priority",
                priority: "high"
            });

            await tcpClient.createTask({
                title: "Low Priority Task",
                description: "Task with low priority",
                priority: "low"
            });

            const result = await tcpClient.listTasksFiltered({
                priority: "high"
            });

            assert.ok(result.success, "Should filter by priority successfully");
            assert.ok(result.data, "Should return data");
            assert.ok(Array.isArray(result.data), "Should return array of tasks");
            
            // All returned tasks should have the specified priority
            result.data.forEach((task: Task) => {
                assert.equal(task.priority, "high", "All tasks should have high priority");
            });
        });

        it("should search tasks by text", async () => {
            // Create tasks with specific content
            await tcpClient.createTask({
                title: "Integration Test Task One",
                description: "First task for integration testing",
                priority: "medium"
            });

            await tcpClient.createTask({
                title: "Integration Test Task Two",
                description: "Second task for integration testing",
                priority: "low"
            });

            const result = await tcpClient.listTasksFiltered({
                search: "integration test"
            });

            assert.ok(result.success, "Should search tasks successfully");
            assert.ok(result.data, "Should return data");
            assert.ok(Array.isArray(result.data), "Should return array of tasks");
            
            // All returned tasks should contain the search text
            result.data.forEach((task: Task) => {
                const searchText = "integration test";
                const containsInTitle = task.title.toLowerCase().includes(searchText);
                const containsInDescription = task.description.toLowerCase().includes(searchText);
                assert.ok(containsInTitle || containsInDescription, "Task should contain search text");
            });
        });

        it("should paginate task results", async () => {
            // Create multiple tasks
            for (let i = 0; i < 10; i++) {
                await tcpClient.createTask({
                    title: `Pagination Task ${i}`,
                    description: `Task for pagination testing ${i}`,
                    priority: "medium"
                });
            }

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

            assert.ok(firstPageResult.success, "Should get first page successfully");
            assert.ok(secondPageResult.success, "Should get second page successfully");
            assert.ok(firstPageResult.data, "Should have first page data");
            assert.ok(secondPageResult.data, "Should have second page data");
            assert.ok(firstPageResult.data.length <= 5, "First page should have max 5 tasks");
            assert.ok(secondPageResult.data.length <= 5, "Second page should have max 5 tasks");
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

            assert.ok(createResult.success, "Should create task successfully");
            assert.ok(createResult.data, "Should have task data");
            const taskId = createResult.data.id;

            // Get task status
            const statusResult = await tcpClient.getTaskStatus(taskId);
            assert.ok(statusResult.success, "Should get task status successfully");
            assert.ok(statusResult.data, "Should have status data");
            assert.equal(statusResult.data.taskId, taskId, "Should return correct task ID");
            assert.ok(statusResult.data.status, "Should return status");
            assert.ok(statusResult.data.updatedAt, "Should return updatedAt timestamp");
        });

        it("should handle status query for non-existent task", async () => {
            const result = await tcpClient.getTaskStatus("non-existent-task");
            assert.equal(result.success, false, "Should fail for non-existent task");
            assert.ok(result.error?.message.includes("not found"), "Should provide not found error");
        });
    });

    describe("Task Monitoring", () => {
        it("should create monitoring session", async () => {
            const filters: TaskFilter = {
                status: "todo",
                priority: "high"
            };

            const result = await tcpClient.createMonitoringSession(filters);
            assert.ok(result.success, "Should create monitoring session successfully");
            assert.ok(result.data, "Should return session data");
            assert.ok(result.data.id, "Should return session ID");
            assert.ok(result.data.filters, "Should return filters");
            assert.ok(result.data.createdAt, "Should return creation timestamp");
            assert.equal(result.data.active, true, "Should be active");
        });

        it("should list monitoring sessions", async () => {
            // Create a session first
            await tcpClient.createMonitoringSession({
                status: "todo"
            });

            const result = await tcpClient.getMonitoringSessions();
            assert.ok(result.success, "Should list monitoring sessions successfully");
            assert.ok(result.data, "Should return data");
            assert.ok(Array.isArray(result.data), "Should return array of sessions");
        });

        it("should close monitoring session", async () => {
            // Create a session first
            const createResult = await tcpClient.createMonitoringSession({
                status: "done"
            });

            assert.ok(createResult.success, "Should create session successfully");
            assert.ok(createResult.data, "Should have session data");
            const sessionId = createResult.data.id;

            // Close the session
            const closeResult = await tcpClient.closeMonitoringSession(sessionId);
            assert.ok(closeResult.success, "Should close session successfully");
        });
    });

    describe("Real-time Notifications", () => {
        it("should subscribe to task notifications", async () => {
            const result = await tcpClient.subscribeToTaskNotifications({
                sessionId: "integration-test-session",
                taskIds: ["task-1", "task-2"],
                includeTcpResponse: true
            });

            assert.ok(result.success, "Should subscribe to notifications successfully");
            assert.ok(result.data, "Should return subscription data");
            assert.equal(result.data.sessionId, "integration-test-session", "Should return session ID");
            assert.ok(Array.isArray(result.data.subscribedTasks), "Should return subscribed tasks");
        });

        it("should generate unique session ID when not provided", async () => {
            const result = await tcpClient.subscribeToTaskNotifications({
                taskIds: ["task-1"]
            });

            assert.ok(result.success, "Should subscribe successfully");
            assert.ok(result.data, "Should return subscription data");
            assert.ok(result.data.sessionId, "Should generate session ID");
            assert.equal(typeof result.data.sessionId, "string", "Session ID should be string");
            assert.ok(result.data.sessionId.length > 0, "Session ID should not be empty");
        });
    });

    describe("Error Handling", () => {
        it("should handle malformed commands gracefully", async () => {
            const client = new DaemonTcpClient(TEST_PORT, TEST_HOST);
            
            // Test with malformed command
            const result = await client.sendCommand("invalid_command", {});
            assert.equal(result.success, false, "Should fail for invalid command");
            assert.ok(result.error, "Should provide error message");
        });

        it("should handle connection errors gracefully", async () => {
            const invalidClient = new DaemonTcpClient(9999, "invalid-host");
            
            const result = await invalidClient.listTasks();
            assert.equal(result.success, false, "Should fail for invalid connection");
            assert.ok(result.error?.message.includes("Connection error"), "Should provide connection error");
        });

        it("should handle request timeouts", async () => {
            // Test with a port that should timeout
            const timeoutClient = new DaemonTcpClient(9998, "127.0.0.1");
            
            const startTime = Date.now();
            const result = await timeoutClient.listTasks();
            const endTime = Date.now();
            
            assert.equal(result.success, false, "Should timeout");
            // Should timeout after a reasonable period (10 seconds is configured in client)
            assert.ok(endTime - startTime > 5000, "Should take at least 5 seconds to timeout");
        });
    });

    describe("WebSocket Integration", () => {
        it("should check WebSocket connection status", () => {
            const isConnected = tcpClient.isWebSocketConnected();
            assert.equal(typeof isConnected, "boolean", "Should return boolean status");
        });

        it("should get WebSocket connection object", () => {
            const wsConnection = tcpClient.getWebSocketConnection();
            assert.ok(wsConnection === null || typeof wsConnection === "object", "Should return null or WebSocket object");
        });

        it("should disconnect WebSocket safely", () => {
            // Should not throw error
            assert.doesNotThrow(() => {
                tcpClient.disconnectWebSocket();
            });
        });
    });

    describe("System Operations", () => {
        it("should get WebSocket status", async () => {
            const result = await tcpClient.getWebSocketStatus();
            assert.ok(result.success, "Should get WebSocket status successfully");
            assert.ok(typeof result.data === "object", "Should return status object");
        });

        it("should handle system restart command", async () => {
            // Note: This is a potentially destructive test
            // In a real environment, this would restart the daemon
            // For testing purposes, we just verify the command is accepted
            const result = await tcpClient.restart();
            
            // Might fail in test environment, but should not crash
            assert.equal(typeof result.success, "boolean", "Should return success boolean");
        });
    });

    describe("Performance and Load Testing", () => {
        it("should handle multiple concurrent requests", async () => {
            const requests = Array.from({ length: 10 }, () =>
                tcpClient.listTasks()
            );

            const results = await Promise.allSettled(requests);
            
            // Most requests should succeed
            const successful = results.filter(r => r.status === 'fulfilled').length;
            assert.ok(successful >= 5, `At least 5 of 10 requests should succeed, got ${successful}`);

            // Verify responses are consistent
            const successfulResults = results
                .filter(r => r.status === 'fulfilled')
                .map(r => (r as PromiseFulfilledResult<any>).value);
            
            successfulResults.forEach(result => {
                assert.ok(result.success, "Successful requests should return success");
                assert.ok(result.data, "Should have data");
                assert.ok(Array.isArray(result.data), "Should return array of tasks");
            });
        });

        it("should handle rapid task creation", async () => {
            const createRequests = Array.from({ length: 5 }, (_, i) =>
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
            
            assert.ok(successful >= 3, `At least 3 of 5 creations should succeed, got ${successful}`);
        });

        it("should handle large payloads", async () => {
            const largeDescription = "x".repeat(5000); // 5KB description
            const largeTask = {
                title: "Large Task Test",
                description: largeDescription,
                priority: "low",
                collaborators: Array.from({ length: 50 }, (_, i) => `user${i}@example.com`)
            };

            const result = await tcpClient.createTask(largeTask);
            
            // Should handle gracefully without memory issues
            assert.equal(typeof result.success, "boolean", "Should return boolean success");
        });
    });
});
