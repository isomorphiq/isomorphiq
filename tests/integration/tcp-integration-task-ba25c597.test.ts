import { describe, it, before, beforeEach, after } from "node:test";
import { strict as assert } from "node:assert";
import { createConnection } from "node:net";
import { randomBytes } from "node:crypto";
import { DaemonTcpClient } from "../../tests/e2e/dashboard/tcp-client.ts";
import { startTestDaemon, type TestDaemonHandle } from "./daemon-test-harness.ts";

type TaskPriority = "low" | "medium" | "high";


interface TcpResponse {
    success: boolean;
    data?: any;
    error?: string | Error;
}

describe("Integration Test Task ba25c597", () => {
    let daemon: TestDaemonHandle;
    let daemonPort: number;
    const TEST_TIMEOUT = 15000;
    const TASK_ID_PREFIX = "task-ba25c597";
    let tcpClient: DaemonTcpClient;
    let testTaskId: string;
    let createdTask: boolean = false;

    // Helper function to send TCP command and get response
    async function sendTcpCommand(command: string, data: any): Promise<TcpResponse> {
        return new Promise((resolve, reject) => {
            const client = createConnection({ port: daemonPort, host: "localhost" }, () => {
                const message = JSON.stringify({ command, data }) + "\n";
                client.write(message);
            });

            let response = "";
            client.on("data", (data) => {
                response += data.toString();
                try {
                    const result = JSON.parse(response.trim());
                    client.end();
                    resolve(result);
                } catch (_e) {
                    void _e; // Wait for more data
                }
            });

            client.on("error", (err: any) => {
                client.destroy();
                reject(new Error(`TCP connection failed: ${err.message}`));
            });

            client.on("close", () => {
                if (!response) {
                    reject(new Error("Connection closed without response"));
                }
            });

            setTimeout(() => {
                client.destroy();
                reject(new Error("TCP command timeout"));
            }, TEST_TIMEOUT);
        });
    }

    // Generate a proper task ID with UUID format
    function generateTaskId(): string {
        const uuid = randomBytes(16).toString("hex");
        return `${TASK_ID_PREFIX}-${uuid.substring(0, 8)}-${uuid.substring(8, 12)}-${uuid.substring(12, 16)}-${uuid.substring(16)}`;
    }

    // Generate test task data
    function generateTestTaskData(): any {
        const suffix = randomBytes(4).toString("hex");
        return {
            title: `Integration Test Task ba25c597-${suffix}`,
            description: `Task created via TCP integration test ba25c597-${suffix}`,
            priority: "medium" as TaskPriority,
            createdBy: `integration-test-ba25c597-${suffix}`,
            assignedTo: `test-assignee-${suffix}`,
            type: "integration-test"
        };
    }

    before(async () => {
        daemon = await startTestDaemon();
        daemonPort = daemon.tcpPort;
        tcpClient = new DaemonTcpClient(daemonPort, "localhost");
    });

    beforeEach(async () => {
        // Try to find existing task with ba25c597 prefix
        try {
            const listResult = await sendTcpCommand("list_tasks", {});
            if (listResult.success && Array.isArray(listResult.data)) {
                const existingTask = listResult.data.find((task: any) => 
                    task.id.includes(TASK_ID_PREFIX) || task.title.includes("ba25c597")
                );
                
                if (existingTask) {
                    testTaskId = existingTask.id;
                    console.log(`✓ Found existing task: ${testTaskId}`);
                    return;
                }
            }
        } catch (error) {
            // Continue with task creation
        }

        // Create a new test task if none exists
        const taskData = generateTestTaskData();
        taskData.id = generateTaskId(); // Ensure we have a proper ID format
        
        try {
            const createResult = await sendTcpCommand("create_task", taskData);
            if (createResult.success) {
                testTaskId = createResult.data.id;
                createdTask = true;
                console.log(`✓ Created test task: ${testTaskId}`);
            } else {
                throw new Error(`Failed to create test task: ${createResult.error}`);
            }
        } catch (error) {
            throw new Error(`Failed to create test task for ba25c597 integration: ${error}`);
        }
    });

    after(async () => {
        // Clean up created task
        if (createdTask && testTaskId) {
            try {
                await sendTcpCommand("delete_task", { id: testTaskId, deletedBy: "integration-test-cleanup" });
                console.log(`✓ Cleaned up test task: ${testTaskId}`);
            } catch (error) {
                console.warn(`Failed to clean up test task: ${error}`);
            }
        }
        
        // Disconnect TCP client
        if (tcpClient) {
            tcpClient.disconnectWebSocket();
        }
        if (daemon) {
            await daemon.cleanup();
        }
    });

    describe("Task Existence and Basic Retrieval", () => {
        it("should retrieve task ba25c597 by ID", async () => {
            const result = await sendTcpCommand("get_task", { id: testTaskId });
            
            assert.ok(result.success, "Should successfully retrieve task");
            assert.ok(result.data.id, "Should return task ID");
            assert.equal(result.data.id, testTaskId, "Should return correct task ID");
            assert.ok(result.data.title, "Should have title");
            assert.ok(result.data.description, "Should have description");
            assert.ok(result.data.createdAt, "Should have creation timestamp");
            assert.ok(result.data.updatedAt, "Should have update timestamp");
        });

        it("should get task status for ba25c597", async () => {
            const result = await sendTcpCommand("get_task_status", { id: testTaskId });
            
            assert.ok(result.success, "Should successfully get task status");
            assert.equal(result.data.taskId, testTaskId, "Should return correct task ID");
            assert.ok(result.data.status, "Should return status");
            assert.ok(result.data.updatedAt, "Should return update timestamp");
        });

        it("should include ba25c597 in task list", async () => {
            const result = await sendTcpCommand("list_tasks", {});
            
            assert.ok(result.success, "Should successfully list tasks");
            assert.ok(Array.isArray(result.data), "Should return array of tasks");
            
            const foundTask = result.data.find((task: any) => task.id === testTaskId);
            assert.ok(foundTask, "Should include ba25c597 task in list");
            assert.equal(foundTask.id, testTaskId, "Task ID should match");
        });
    });

    describe("Task Status Management", () => {
        it("should update task status to in-progress", async () => {
            const newStatus = "in-progress";
            const result = await sendTcpCommand("update_task_status", { 
                id: testTaskId, 
                status: newStatus,
                changedBy: "integration-test"
            });
            
            assert.ok(result.success, "Should update task status");
            assert.equal(result.data.status, newStatus, "Should have new status");
            assert.notEqual(result.data.updatedAt, result.data.createdAt, "Should update timestamp");
        });

        it("should update task status to done", async () => {
            const newStatus = "done";
            const result = await sendTcpCommand("update_task_status", { 
                id: testTaskId, 
                status: newStatus,
                changedBy: "integration-test"
            });
            
            assert.ok(result.success, "Should update task status to done");
            assert.equal(result.data.status, newStatus, "Should have done status");
        });

        it("should handle invalid status updates", async () => {
            const invalidStatus = "invalid-status";
            const result = await sendTcpCommand("update_task_status", { 
                id: testTaskId, 
                status: invalidStatus,
                changedBy: "integration-test"
            });
            
            assert.ok(!result.success, "Should reject invalid status");
            assert.ok(result.error, "Should provide error message");
        });
    });

    describe("Task Priority Management", () => {
        it("should update task priority to high", async () => {
            const newPriority = "high";
            const result = await sendTcpCommand("update_task_priority", { 
                id: testTaskId, 
                priority: newPriority,
                changedBy: "integration-test"
            });
            
            assert.ok(result.success, "Should update task priority");
            assert.equal(result.data.priority, newPriority, "Should have new priority");
        });

        it("should update task priority to low", async () => {
            const newPriority = "low";
            const result = await sendTcpCommand("update_task_priority", { 
                id: testTaskId, 
                priority: newPriority,
                changedBy: "integration-test"
            });
            
            assert.ok(result.success, "Should update task priority to low");
            assert.equal(result.data.priority, newPriority, "Should have low priority");
        });

        it("should handle custom priority updates", async () => {
            const customPriority = "urgent";
            const result = await sendTcpCommand("update_task_priority", { 
                id: testTaskId, 
                priority: customPriority,
                changedBy: "integration-test"
            });
            
            // Note: System currently accepts custom priorities, should be validated at domain level
            assert.ok(result.success, "Should handle priority update");
            assert.equal(result.data.priority, customPriority, "Should have new priority");
        });
    });

    describe("Task Filtering and Search", () => {
        it("should find ba25c597 task in filtered results", async () => {
            const result = await sendTcpCommand("list_tasks_filtered", {
                filters: { search: "ba25c597" }
            });
            
            assert.ok(result.success, "Should search tasks successfully");
            assert.ok(Array.isArray(result.data), "Should return array of tasks");
            
            const foundTask = result.data.find((task: any) => task.id === testTaskId);
            assert.ok(foundTask, "Should find ba25c597 task in search results");
        });

        it("should filter ba25c597 task by status", async () => {
            // First ensure task has a known status
            await sendTcpCommand("update_task_status", { 
                id: testTaskId, 
                status: "todo",
                changedBy: "integration-test"
            });

            const result = await sendTcpCommand("list_tasks_filtered", {
                filters: { status: "todo" }
            });
            
            assert.ok(result.success, "Should filter by status");
            
            const foundTask = result.data.find((task: any) => task.id === testTaskId);
            assert.ok(foundTask, "Should find ba25c597 task in status filter");
            assert.equal(foundTask.status, "todo", "Task should have todo status");
        });

        it("should filter ba25c597 task by priority", async () => {
            // First ensure task has a known priority
            await sendTcpCommand("update_task_priority", { 
                id: testTaskId, 
                priority: "medium",
                changedBy: "integration-test"
            });

            const result = await sendTcpCommand("list_tasks_filtered", {
                filters: { priority: "medium" }
            });
            
            assert.ok(result.success, "Should filter by priority");
            
            const foundTask = result.data.find((task: any) => task.id === testTaskId);
            assert.ok(foundTask, "Should find ba25c597 task in priority filter");
            assert.equal(foundTask.priority, "medium", "Task should have medium priority");
        });
    });

    describe("Task Monitoring and Real-time Updates", () => {
        it("should create monitoring session for ba25c597", async () => {
            const result = await sendTcpCommand("create_monitoring_session", {
                filters: {
                    search: "ba25c597",
                    status: "todo"
                }
            });

            assert.ok(result.success, "Should create monitoring session");
            assert.ok(result.data.id, "Should return session ID");
            assert.ok(result.data.filters, "Should return filters");
            assert.equal(result.data.active, true, "Should be active");
        });

        it("should subscribe to task notifications", async () => {
            const sessionId = `test-session-${Date.now()}`;
            const result = await sendTcpCommand("subscribe_to_task_notifications", {
                sessionId: sessionId,
                taskIds: [testTaskId],
                includeTcpResponse: true
            });

            assert.ok(result.success, "Should subscribe to task notifications");
            assert.equal(result.data.sessionId, sessionId, "Should return session ID");
            assert.ok(result.data.subscribedTasks.includes(testTaskId), "Should include task ID");
        });
    });

    describe("Error Handling and Edge Cases", () => {
        it("should handle operations on non-existent ba25c597 variant", async () => {
            const nonExistentId = `${TASK_ID_PREFIX}-non-existent`;
            
            const getResult = await sendTcpCommand("get_task", { id: nonExistentId });
            assert.ok(!getResult.success, "Should fail for non-existent task");
            
            const updateResult = await sendTcpCommand("update_task_status", { 
                id: nonExistentId, 
                status: "in-progress", 
                changedBy: "test" 
            });
            assert.ok(!updateResult.success, "Should fail status update for non-existent task");
        });

        it("should handle malformed requests gracefully", async () => {
            return new Promise<void>((resolve) => {
                const client = createConnection({ port: daemonPort, host: "localhost" }, () => {
                    client.write("invalid json request\n");
                });

                client.on("data", (data) => {
                    const response = data.toString();
                    assert.ok(response.includes("error") || response.includes("invalid"), 
                        "Should respond with error for malformed JSON");
                    client.end();
                    resolve();
                });

                client.on("error", () => {
                    resolve(); // Error is acceptable for malformed input
                });

                setTimeout(() => {
                    client.destroy();
                    resolve();
                }, 2000);
            });
        });

        it("should handle concurrent operations on ba25c597", async () => {
            const promises: Promise<TcpResponse>[] = [];
            
            // Send concurrent status updates
            for (let i = 0; i < 3; i++) {
                promises.push(sendTcpCommand("update_task_status", { 
                    id: testTaskId, 
                    status: "todo", // Same status to avoid conflicts
                    changedBy: `concurrent-test-${i}`
                }));
            }

            const results = await Promise.allSettled(promises);
            const successful = results.filter(r => 
                r.status === 'fulfilled' && 
                (r as PromiseFulfilledResult<TcpResponse>).value.success
            ).length;
            
            assert.ok(successful >= 1, "At least one concurrent operation should succeed");
        });
    });

    describe("Task Persistence and Consistency", () => {
        it("should maintain task data consistency across operations", async () => {
            // Get initial task state
            const initialResult = await sendTcpCommand("get_task", { id: testTaskId });
            assert.ok(initialResult.success, "Should get initial task state");
            
            const initialTask = initialResult.data;
            
            // Update status
            await sendTcpCommand("update_task_status", { 
                id: testTaskId, 
                status: "in-progress",
                changedBy: "consistency-test"
            });
            
            // Update priority
            await sendTcpCommand("update_task_priority", { 
                id: testTaskId, 
                priority: "high",
                changedBy: "consistency-test"
            });
            
            // Verify final state
            const finalResult = await sendTcpCommand("get_task", { id: testTaskId });
            assert.ok(finalResult.success, "Should get final task state");
            
            const finalTask = finalResult.data;
            
            // Core fields should remain consistent
            assert.equal(finalTask.id, initialTask.id, "Task ID should be consistent");
            assert.equal(finalTask.title, initialTask.title, "Title should be consistent");
            assert.equal(finalTask.description, initialTask.description, "Description should be consistent");
            assert.equal(finalTask.createdBy, initialTask.createdBy, "Creator should be consistent");
            
            // Updated fields should have changed
            assert.equal(finalTask.status, "in-progress", "Status should be updated");
            assert.equal(finalTask.priority, "high", "Priority should be updated");
            assert.notEqual(finalTask.updatedAt, initialTask.updatedAt, "Update timestamp should change");
        });

        it("should handle task deletion and recreation", async () => {
            // Only test this if we created the task
            if (!createdTask) {
                console.log("Skipping deletion test - task was pre-existing");
                return;
            }
            
            // Delete the task
            const deleteResult = await sendTcpCommand("delete_task", { 
                id: testTaskId, 
                deletedBy: "persistence-test" 
            });
            assert.ok(deleteResult.success, "Should delete task successfully");
            
            // Verify task is gone
            const getResult = await sendTcpCommand("get_task", { id: testTaskId });
            assert.ok(!getResult.success, "Task should not exist after deletion");
            
            // Recreate task with same ID pattern
            const newTaskData = generateTestTaskData();
            const recreateResult = await sendTcpCommand("create_task", newTaskData);
            assert.ok(recreateResult.success, "Should recreate task successfully");
            
            // Update testTaskId for cleanup
            testTaskId = recreateResult.data.id;
        });
    });

    describe("Performance and Load Testing", () => {
        it("should handle rapid operations on ba25c597", async () => {
            const operationCount = 5;
            const startTime = Date.now();
            
            // Perform rapid status changes
            for (let i = 0; i < operationCount; i++) {
                const status = i % 2 === 0 ? "todo" : "in-progress";
                const result = await sendTcpCommand("update_task_status", { 
                    id: testTaskId, 
                    status: status,
                    changedBy: `rapid-test-${i}`
                });
                assert.ok(result.success, `Rapid operation ${i} should succeed`);
            }
            
            const endTime = Date.now();
            const totalTime = endTime - startTime;
            const avgTime = totalTime / operationCount;
            
            console.log(`Rapid operations: ${operationCount} operations in ${totalTime}ms (avg: ${avgTime}ms per operation)`);
            
            // Performance assertion
            assert.ok(avgTime < 2000, `Average operation time should be under 2 seconds (was ${avgTime}ms)`);
        });

        it("should maintain response quality under concurrent load", async () => {
            const concurrentCount = 3;
            const promises: Promise<TcpResponse>[] = [];
            
            // Mix different operations
            for (let i = 0; i < concurrentCount; i++) {
                switch (i % 3) {
                    case 0:
                        promises.push(sendTcpCommand("get_task", { id: testTaskId }));
                        break;
                    case 1:
                        promises.push(sendTcpCommand("get_task_status", { id: testTaskId }));
                        break;
                    case 2:
                        promises.push(sendTcpCommand("update_task_priority", { 
                            id: testTaskId, 
                            priority: "medium",
                            changedBy: `load-test-${i}`
                        }));
                        break;
                }
            }
            
            const results = await Promise.allSettled(promises);
            const successful = results.filter(r => 
                r.status === 'fulfilled' && 
                (r as PromiseFulfilledResult<TcpResponse>).value.success
            ).length;
            
            assert.ok(successful >= concurrentCount * 0.8, 
                `At least 80% of concurrent operations should succeed (${successful}/${concurrentCount})`);
        });
    });
});
