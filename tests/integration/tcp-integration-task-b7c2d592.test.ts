import { describe, it, before, beforeEach, after } from "node:test";
import { strict as assert } from "node:assert";
import { DaemonTcpClient, type Task, type TaskFilter } from "../../tests/e2e/dashboard/tcp-client.ts";
import { startTestDaemon, type TestDaemonHandle } from "./daemon-test-harness.ts";

describe("Integration Test Task b7c2d592", () => {
    const TASK_ID_PREFIX = "task-b7c2d592";
    let tcpClient: DaemonTcpClient;
    let daemon: TestDaemonHandle;

    before(async () => {
        daemon = await startTestDaemon();
        tcpClient = new DaemonTcpClient(daemon.tcpPort, "localhost");
    });

    beforeEach(async () => {
        // Clean up any existing test tasks
        try {
            const listResult = await tcpClient.listTasks();
            if (listResult.success && listResult.data) {
                const testTasks = listResult.data.filter((task: Task) => 
                    task.title.includes(TASK_ID_PREFIX)
                );
                
                for (const task of testTasks) {
                    await tcpClient.deleteTask(task.id);
                }
            }
        } catch (error) {
            // Ignore cleanup errors
        }
    });

    after(async () => {
        tcpClient.disconnectWebSocket();
        await daemon.cleanup();
    });

    describe("Task Existence and Basic Retrieval", () => {
        it("should verify daemon connectivity", async () => {
            const isConnected = await tcpClient.checkConnection();
            assert.ok(isConnected, "Should connect to daemon successfully");
        });

        it("should create a basic task for b7c2d592", async () => {
            const taskData = {
                title: `${TASK_ID_PREFIX} Basic Task`,
                description: "Basic task for integration testing",
                priority: "medium",
                createdBy: "integration-test-b7c2d592"
            };

            const result = await tcpClient.createTask(taskData);
            assert.ok(result.success, "Should create task successfully");
            assert.ok(result.data, "Should return task data");
            assert.ok(result.data.id, "Should return task ID");
            
            assert.equal(result.data.title, taskData.title);
            assert.equal(result.data.description, taskData.description);
            assert.equal(result.data.priority, taskData.priority);
            assert.equal(result.data.createdBy, taskData.createdBy);
            assert.equal(result.data.status, "todo");
        });

        it("should retrieve the created task by ID", async () => {
            // Create a task first
            const createResult = await tcpClient.createTask({
                title: `${TASK_ID_PREFIX} Retrieval Test`,
                description: "Task for retrieval testing",
                priority: "high",
                createdBy: "integration-test-b7c2d592"
            });
            
            assert.ok(createResult.success);
            assert.ok(createResult.data);
            const taskId = createResult.data.id;

            const result = await tcpClient.getTask(taskId);
            assert.ok(result.success, "Should retrieve task successfully");
            assert.ok(result.data, "Should return task data");
            assert.equal(result.data.id, taskId);
            assert.ok(result.data.title.includes(TASK_ID_PREFIX));
        });

        it("should list all tasks including the test task", async () => {
            // Create a test task first
            await tcpClient.createTask({
                title: `${TASK_ID_PREFIX} List Test`,
                description: "Task for list testing",
                priority: "medium",
                createdBy: "integration-test-b7c2d592"
            });

            const result = await tcpClient.listTasks();
            assert.ok(result.success, "Should list tasks successfully");
            assert.ok(Array.isArray(result.data), "Should return array of tasks");
            
            const testTask = result.data.find((task: Task) => 
                task.title.includes(TASK_ID_PREFIX)
            );
            assert.ok(testTask, "Should find the created test task in list");
        });
    });

    describe("Task Status Management", () => {
        it("should update task status from todo to in-progress", async () => {
            const createResult = await tcpClient.createTask({
                title: `${TASK_ID_PREFIX} Status Test`,
                description: "Task for status testing",
                priority: "medium",
                createdBy: "integration-test-b7c2d592"
            });
            
            assert.ok(createResult.success);
            assert.ok(createResult.data);
            const taskId = createResult.data.id;
            
            const updateResult = await tcpClient.updateTaskStatus(taskId, "in-progress");
            assert.ok(updateResult.success, "Should update task status");
            assert.equal(updateResult.data?.status, "in-progress");
            
            const getResult = await tcpClient.getTask(taskId);
            assert.equal(getResult.data?.status, "in-progress");
        });

        it("should update task status from in-progress to done", async () => {
            const createResult = await tcpClient.createTask({
                title: `${TASK_ID_PREFIX} Completion Test`,
                description: "Task for completion testing",
                priority: "low",
                createdBy: "integration-test-b7c2d592"
            });
            
            assert.ok(createResult.success);
            assert.ok(createResult.data);
            const taskId = createResult.data.id;
            
            // First update to in-progress
            await tcpClient.updateTaskStatus(taskId, "in-progress");
            
            // Then update to done
            const updateResult = await tcpClient.updateTaskStatus(taskId, "done");
            assert.ok(updateResult.success, "Should mark task as done");
            assert.equal(updateResult.data?.status, "done");
        });

        it("should get task status by ID", async () => {
            const createResult = await tcpClient.createTask({
                title: `${TASK_ID_PREFIX} Status Query Test`,
                description: "Task for status query testing",
                priority: "high",
                createdBy: "integration-test-b7c2d592"
            });
            
            assert.ok(createResult.success);
            assert.ok(createResult.data);
            const taskId = createResult.data.id;

            const statusResult = await tcpClient.getTaskStatus(taskId);
            assert.ok(statusResult.success, "Should get task status successfully");
            assert.ok(statusResult.data, "Should have status data");
            assert.equal(statusResult.data.taskId, taskId, "Should return correct task ID");
            assert.ok(statusResult.data.status, "Should return status");
            assert.ok(statusResult.data.updatedAt, "Should return updatedAt timestamp");
        });
    });

    describe("Task Priority Management", () => {
        it("should update task priority", async () => {
            const createResult = await tcpClient.createTask({
                title: `${TASK_ID_PREFIX} Priority Test`,
                description: "Task for priority testing",
                priority: "low",
                createdBy: "integration-test-b7c2d592"
            });
            
            assert.ok(createResult.success);
            assert.ok(createResult.data);
            const taskId = createResult.data.id;
            
            const updateResult = await tcpClient.updateTaskPriority(taskId, "high");
            assert.ok(updateResult.success, "Should update task priority");
            assert.equal(updateResult.data?.priority, "high");
        });

        it("should handle priority ordering in filtered results", async () => {
            // Create tasks with different priorities
            await tcpClient.createTask({
                title: `${TASK_ID_PREFIX} High Priority`,
                description: "High priority task",
                priority: "high",
                createdBy: "integration-test-b7c2d592"
            });
            
            await tcpClient.createTask({
                title: `${TASK_ID_PREFIX} Low Priority`,
                description: "Low priority task", 
                priority: "low",
                createdBy: "integration-test-b7c2d592"
            });
            
            // Filter by high priority
            const result = await tcpClient.listTasksFiltered({ priority: "high" });
            assert.ok(result.success);
            assert.ok(result.data);
            
            const highPriorityTasks = result.data.filter((task: Task) => 
                task.title.includes(TASK_ID_PREFIX)
            );
            
            assert.ok(highPriorityTasks.length >= 1, "Should find at least one high priority test task");
            highPriorityTasks.forEach((task: Task) => {
                assert.equal(task.priority, "high");
            });
        });
    });

    describe("Task Filtering and Search", () => {
        beforeEach(async () => {
            // Create test tasks for filtering
            await tcpClient.createTask({
                title: `${TASK_ID_PREFIX} Search Alpha`,
                description: "Alpha task for search testing",
                priority: "high",
                createdBy: "integration-test-b7c2d592"
            });
            
            await tcpClient.createTask({
                title: `${TASK_ID_PREFIX} Search Beta`, 
                description: "Beta task for search testing",
                priority: "low",
                createdBy: "integration-test-b7c2d592"
            });
        });

        it("should filter tasks by status", async () => {
            const result = await tcpClient.listTasksFiltered({ status: "todo" });
            assert.ok(result.success);
            assert.ok(Array.isArray(result.data));
            
            const todoTasks = result.data.filter((task: Task) => 
                task.title.includes(TASK_ID_PREFIX)
            );
            
            todoTasks.forEach((task: Task) => {
                assert.equal(task.status, "todo");
            });
        });

        it("should search tasks by text in title", async () => {
            const result = await tcpClient.listTasksFiltered({ search: "Search Alpha" });
            assert.ok(result.success);
            assert.ok(result.data);
            
            const matchingTasks = result.data.filter((task: Task) => 
                task.title.includes(TASK_ID_PREFIX)
            );
            
            assert.ok(matchingTasks.length >= 1, "Should find at least one matching task");
            matchingTasks.forEach((task: Task) => {
                const titleContains = task.title.includes("Search Alpha");
                const descContains = task.description.includes("Search Alpha");
                assert.ok(titleContains || descContains);
            });
        });

        it("should combine multiple filters", async () => {
            const result = await tcpClient.listTasksFiltered({
                status: "todo",
                priority: "high",
                search: "Search"
            });
            
            assert.ok(result.success);
            assert.ok(result.data);
            
            result.data.forEach((task: Task) => {
                assert.equal(task.status, "todo");
                assert.equal(task.priority, "high");
                const titleContains = task.title.includes("Search");
                const descContains = task.description.includes("Search");
                assert.ok(titleContains || descContains);
            });
        });

        it("should handle pagination", async () => {
            // Create additional tasks for pagination
            for (let i = 0; i < 5; i++) {
                await tcpClient.createTask({
                    title: `${TASK_ID_PREFIX} Page ${i}`,
                    description: `Pagination test task ${i}`,
                    priority: "medium",
                    createdBy: "integration-test-b7c2d592"
                });
            }
            
            const page1 = await tcpClient.listTasksFiltered({ limit: 3, offset: 0 });
            const page2 = await tcpClient.listTasksFiltered({ limit: 3, offset: 3 });
            
            assert.ok(page1.success);
            assert.ok(page2.success);
            assert.ok(page1.data);
            assert.ok(page2.data);
            assert.ok(page1.data.length <= 3);
            assert.ok(page2.data.length <= 3);
        });
    });

    describe("Task Assignment and Collaboration", () => {
        it("should create task with assigned user", async () => {
            const taskData = {
                title: `${TASK_ID_PREFIX} Assignment Test`,
                description: "Task for assignment testing",
                priority: "medium",
                createdBy: "integration-test-b7c2d592",
                assignedTo: "user@example.com"
            };
            
            const result = await tcpClient.createTask(taskData);
            assert.ok(result.success, "Should create assigned task successfully");
            assert.equal(result.data?.assignedTo, "user@example.com");
        });

        it("should handle task with collaborators", async () => {
            const taskData = {
                title: `${TASK_ID_PREFIX} Collaboration Test`,
                description: "Task for collaboration testing",
                priority: "high",
                createdBy: "integration-test-b7c2d592",
                collaborators: ["user1@example.com", "user2@example.com"]
            };
            
            const result = await tcpClient.createTask(taskData);
            assert.ok(result.success);
            assert.deepEqual(result.data?.collaborators, taskData.collaborators);
        });

        it("should handle task with dependencies", async () => {
            const taskData = {
                title: `${TASK_ID_PREFIX} Dependency Test`,
                description: "Task with dependencies",
                priority: "medium",
                createdBy: "integration-test-b7c2d592",
                dependencies: ["dep-1", "dep-2"]
            };
            
            const result = await tcpClient.createTask(taskData);
            assert.ok(result.success);
            assert.deepEqual(result.data?.dependencies, taskData.dependencies);
        });
    });

    describe("Error Handling and Edge Cases", () => {
        it("should handle non-existent task operations", async () => {
            const fakeId = "non-existent-task-b7c2d592";
            
            const getResult = await tcpClient.getTask(fakeId);
            assert.equal(getResult.success, false);
            
            const updateResult = await tcpClient.updateTaskStatus(fakeId, "done");
            assert.equal(updateResult.success, false);
            
            const deleteResult = await tcpClient.deleteTask(fakeId);
            assert.equal(deleteResult.success, false);
        });

        it("should validate required fields on creation", async () => {
            const invalidTask = {
                title: "", // Empty title
                description: "Task with empty title"
            };
            
            const result = await tcpClient.createTask(invalidTask);
            assert.equal(result.success, false);
            assert.ok(result.error?.message.toLowerCase().includes("title"));
        });

        it("should handle malformed TCP commands", async () => {
            const result = await tcpClient.sendCommand("invalid_command", {});
            assert.equal(result.success, false);
        });

        it("should handle connection timeouts", async () => {
            const invalidClient = new DaemonTcpClient(9999, "localhost");
            const result = await invalidClient.listTasks();
            assert.equal(result.success, false);
        });
    });

    describe("Task Persistence and Consistency", () => {
        it("should maintain task data across operations", async () => {
            const originalTask = {
                title: `${TASK_ID_PREFIX} Persistence Test`,
                description: "Task for persistence testing",
                priority: "medium",
                createdBy: "integration-test-b7c2d592",
                collaborators: ["user1@example.com"],
                dependencies: ["dep-1"]
            };
            
            const createResult = await tcpClient.createTask(originalTask);
            assert.ok(createResult.success);
            assert.ok(createResult.data);
            const taskId = createResult.data.id;
            
            // Update status
            await tcpClient.updateTaskStatus(taskId, "in-progress");
            
            // Update priority
            await tcpClient.updateTaskPriority(taskId, "high");
            
            // Verify all data is preserved
            const finalResult = await tcpClient.getTask(taskId);
            assert.ok(finalResult.success);
            assert.ok(finalResult.data);
            assert.equal(finalResult.data.title, originalTask.title);
            assert.equal(finalResult.data.description, originalTask.description);
            assert.equal(finalResult.data.createdBy, originalTask.createdBy);
            assert.deepEqual(finalResult.data.collaborators, originalTask.collaborators);
            assert.deepEqual(finalResult.data.dependencies, originalTask.dependencies);
            assert.equal(finalResult.data.status, "in-progress");
            assert.equal(finalResult.data.priority, "high");
        });

        it("should handle concurrent operations safely", async () => {
            const createResult = await tcpClient.createTask({
                title: `${TASK_ID_PREFIX} Concurrent Test`,
                description: "Task for concurrent operation testing",
                priority: "medium",
                createdBy: "integration-test-b7c2d592"
            });
            
            assert.ok(createResult.success);
            assert.ok(createResult.data);
            const taskId = createResult.data.id;
            
            // Concurrent operations
            const operations = [
                tcpClient.updateTaskStatus(taskId, "in-progress"),
                tcpClient.updateTaskPriority(taskId, "high"),
                tcpClient.getTask(taskId)
            ];
            
            const results = await Promise.allSettled(operations);
            
            // At least some operations should succeed
            const successful = results.filter(r => 
                r.status === 'fulfilled' && 
                (r as PromiseFulfilledResult<any>).value.success
            ).length;
            
            assert.ok(successful >= 1, "At least one concurrent operation should succeed");
        });
    });

    describe("Advanced Concurrent Operations", () => {
        it("should handle competing status updates on the same task", async () => {
            const createResult = await tcpClient.createTask({
                title: `${TASK_ID_PREFIX} Competing Updates`,
                description: "Task for competing status update testing",
                priority: "medium",
                createdBy: "integration-test-b7c2d592"
            });
            
            assert.ok(createResult.success);
            assert.ok(createResult.data);
            const taskId = createResult.data.id;
            
            // Launch competing status updates
            const competingUpdates = Array.from({ length: 10 }, (_, i) => 
                tcpClient.updateTaskStatus(taskId, i % 2 === 0 ? "in-progress" : "done")
            );
            
            const results = await Promise.allSettled(competingUpdates);
            const successful = results.filter(r => 
                r.status === 'fulfilled' && 
                (r as PromiseFulfilledResult<any>).value.success
            );
            
            // At least some updates should succeed
            assert.ok(successful.length >= 1, "At least one competing update should succeed");
            
            // Verify final state is consistent
            const finalResult = await tcpClient.getTask(taskId);
            assert.ok(finalResult.success);
            assert.ok(finalResult.data);
            assert.ok(["in-progress", "done"].includes(finalResult.data.status));
        });

        it("should handle simultaneous read and delete operations", async () => {
            const taskIds: string[] = [];
            
            // Create multiple tasks for deletion testing
            for (let i = 0; i < 5; i++) {
                const result = await tcpClient.createTask({
                    title: `${TASK_ID_PREFIX} Delete Test ${i}`,
                    description: `Task for delete testing ${i}`,
                    priority: "medium",
                    createdBy: "integration-test-b7c2d592"
                });
                
                if (result.success && result.data) {
                    taskIds.push(result.data.id);
                }
            }
            
            // Mix read and delete operations
            const mixedOperations = taskIds.flatMap(taskId => [
                tcpClient.getTask(taskId),
                tcpClient.deleteTask(taskId)
            ]);
            
            const results = await Promise.allSettled(mixedOperations);
            
            // Some operations should succeed, some might fail due to race conditions
            const successful = results.filter(r => r.status === 'fulfilled').length;
            assert.ok(successful >= taskIds.length, "Should have significant success rate with mixed operations");
        });

        it("should handle concurrent task creation with unique constraints", async () => {
            const creationPromises = Array.from({ length: 20 }, (_, i) =>
                tcpClient.createTask({
                    title: `${TASK_ID_PREFIX} Concurrent ${i}`,
                    description: `Concurrent creation test ${i}`,
                    priority: ["high", "medium", "low"][i % 3],
                    createdBy: "integration-test-b7c2d592"
                })
            );
            
            const results = await Promise.allSettled(creationPromises);
            const successful = results.filter(r => 
                r.status === 'fulfilled' && 
                (r as PromiseFulfilledResult<any>).value.success
            );
            
            assert.ok(successful.length >= 15, "Should create at least 15 of 20 concurrent tasks");
            
            // Verify all created tasks are unique
            const taskIds = successful
                .filter(r => r.status === 'fulfilled')
                .map(r => (r as PromiseFulfilledResult<any>).value.data?.id)
                .filter(Boolean);
            
            const uniqueIds = new Set(taskIds);
            assert.equal(uniqueIds.size, taskIds.length, "All task IDs should be unique");
        });

        it("should maintain data consistency under concurrent priority updates", async () => {
            const createResult = await tcpClient.createTask({
                title: `${TASK_ID_PREFIX} Priority Consistency`,
                description: "Task for priority consistency testing",
                priority: "medium",
                createdBy: "integration-test-b7c2d592"
            });
            
            assert.ok(createResult.success);
            assert.ok(createResult.data);
            const taskId = createResult.data.id;
            
            // Concurrent priority updates
            const priorityUpdates = ["high", "medium", "low"].flatMap(priority =>
                Array.from({ length: 3 }, () => tcpClient.updateTaskPriority(taskId, priority))
            );
            
            const results = await Promise.allSettled(priorityUpdates);
            const successful = results.filter(r => 
                r.status === 'fulfilled' && 
                (r as PromiseFulfilledResult<any>).value.success
            );
            
            // Verify final state is valid
            const finalResult = await tcpClient.getTask(taskId);
            assert.ok(finalResult.success);
            assert.ok(finalResult.data);
            assert.ok(["high", "medium", "low"].includes(finalResult.data.priority));
        });
    });

    describe("Performance and Load Testing", () => {
        it("should handle rapid sequential operations", async () => {
            const taskIds: string[] = [];
            
            // Create multiple tasks rapidly
            for (let i = 0; i < 5; i++) {
                const result = await tcpClient.createTask({
                    title: `${TASK_ID_PREFIX} Rapid ${i}`,
                    description: `Rapid test task ${i}`,
                    priority: "medium",
                    createdBy: "integration-test-b7c2d592"
                });
                
                if (result.success && result.data) {
                    taskIds.push(result.data.id);
                }
            }
            
            assert.ok(taskIds.length >= 3, "Should create at least 3 tasks rapidly");
            
            // Clean up
            for (const id of taskIds) {
                await tcpClient.deleteTask(id);
            }
        });

        it("should handle concurrent requests with performance metrics", async () => {
            const startTime = Date.now();
            const concurrentCount = 10;
            
            const requests = Array.from({ length: concurrentCount }, () =>
                tcpClient.listTasks()
            );
            
            const results = await Promise.allSettled(requests);
            const endTime = Date.now();
            const duration = endTime - startTime;
            
            const successful = results.filter(r => r.status === 'fulfilled').length;
            const successRate = successful / concurrentCount;
            
            assert.ok(successRate >= 0.8, "At least 80% of concurrent requests should succeed");
            assert.ok(duration < 5000, "Concurrent requests should complete within 5 seconds");
        });

        it("should handle large task descriptions", async () => {
            const largeDescription = "x".repeat(10000); // 10KB description
            
            const result = await tcpClient.createTask({
                title: `${TASK_ID_PREFIX} Large Description`,
                description: largeDescription,
                priority: "low",
                createdBy: "integration-test-b7c2d592"
            });
            
            assert.ok(result.success, "Should handle large task descriptions");
            assert.equal(result.data?.description.length, largeDescription.length);
        });

        it("should handle sustained concurrent load", async () => {
            const waves = 3;
            const waveSize = 5;
            const allResults: any[] = [];
            
            for (let wave = 0; wave < waves; wave++) {
                const wavePromises = Array.from({ length: waveSize }, (i) => 
                    tcpClient.createTask({
                        title: `${TASK_ID_PREFIX} Load Wave ${wave} Task ${i}`,
                        description: `Load testing wave ${wave} task ${i}`,
                        priority: "medium",
                        createdBy: "integration-test-b7c2d592"
                    })
                );
                
                const waveResults = await Promise.allSettled(wavePromises);
                allResults.push(...waveResults);
                
                // Small delay between waves to simulate real usage
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            
            const successful = allResults.filter(r => 
                r.status === 'fulfilled' && 
                (r as PromiseFulfilledResult<any>).value.success
            );
            
            const totalOperations = waves * waveSize;
            const successRate = successful.length / totalOperations;
            
            assert.ok(successRate >= 0.8, "Should handle sustained load with >=80% success rate");
        });
    });

    describe("Task Monitoring and Real-time Updates", () => {
        it("should create monitoring session", async () => {
            const filters = {
                status: "todo",
                priority: "high"
            };
            
            const result = await tcpClient.createMonitoringSession(filters);
            assert.ok(result.success, "Should create monitoring session");
            assert.ok(result.data, "Should return session data");
            assert.ok(result.data.id, "Should return session ID");
            assert.deepEqual(result.data.filters, filters);
            assert.equal(result.data.active, true);
        });

        it("should list monitoring sessions", async () => {
            // Create a session first
            await tcpClient.createMonitoringSession({
                status: "todo"
            });
            
            const result = await tcpClient.getMonitoringSessions();
            assert.ok(result.success, "Should list monitoring sessions");
            assert.ok(Array.isArray(result.data), "Should return array of sessions");
        });

        it("should close monitoring session", async () => {
            const createResult = await tcpClient.createMonitoringSession({
                status: "done"
            });
            
            assert.ok(createResult.success);
            assert.ok(createResult.data);
            const sessionId = createResult.data.id;
            
            const closeResult = await tcpClient.closeMonitoringSession(sessionId);
            assert.ok(closeResult.success, "Should close monitoring session");
        });

        it("should subscribe to task notifications", async () => {
            const result = await tcpClient.subscribeToTaskNotifications({
                sessionId: `${TASK_ID_PREFIX}-session`,
                taskIds: ["dummy-task"],
                includeTcpResponse: true
            });
            
            assert.ok(result.success, "Should subscribe to notifications");
            assert.equal(result.data?.sessionId, `${TASK_ID_PREFIX}-session`);
            assert.ok(Array.isArray(result.data?.subscribedTasks));
        });
    });

    describe("System Operations and Health Checks", () => {
        it("should get WebSocket status", async () => {
            const result = await tcpClient.getWebSocketStatus();
            assert.ok(result.success, "Should get WebSocket status");
            assert.ok(typeof result.data === "object", "Should return status object");
        });

        it("should handle restart command", async () => {
            const result = await tcpClient.restart();
            // Might fail in test environment, but should not crash
            assert.equal(typeof result.success, "boolean", "Should return success boolean");
        });

        it("should check WebSocket connection status", () => {
            const isConnected = tcpClient.isWebSocketConnected();
            assert.equal(typeof isConnected, "boolean", "Should return boolean status");
        });

        it("should get WebSocket connection object", () => {
            const wsConnection = tcpClient.getWebSocketConnection();
            assert.ok(wsConnection === null || typeof wsConnection === "object", "Should return null or WebSocket object");
        });
    });
});
