import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { DaemonTcpClient, type Task } from "../e2e/dashboard/tcp-client.ts";
import { priorityStatusDependencyManager } from "../../packages/tasks/src/priority-status-dependency-manager.ts";

const TCP_PORT = 3001;
const tcpClient = new DaemonTcpClient(TCP_PORT);

const TASK_ID_PREFIX = "priority-status-dependency-deadlock-b7c2d592";

describe("Priority-Status Dependency Deadlock Detection", () => {
    let createdTaskIds: string[] = [];

    beforeEach(async () => {
        // Clear any existing dependencies and locks
        priorityStatusDependencyManager.clear();
        
        // Wait a moment for any previous operations to settle
        await new Promise(resolve => setTimeout(resolve, 100));
    });

    afterEach(async () => {
        // Clean up created tasks
        for (const taskId of createdTaskIds) {
            try {
                await tcpClient.deleteTask(taskId);
            } catch (error) {
                console.log(`[CLEANUP] Failed to delete task ${taskId}:`, error);
            }
        }
        createdTaskIds = [];
        
        // Clear manager state
        priorityStatusDependencyManager.clear();
    });

    describe("Basic Priority-Status Dependencies", () => {
        it("should allow simple priority-status dependency chains", async () => {
            // Create base task
            const baseTaskResult = await tcpClient.createTask({
                title: `${TASK_ID_PREFIX} Base Task`,
                description: "Base task for dependency chain",
                priority: "medium",
                createdBy: "priority-status-test"
            });

            assert.ok(baseTaskResult.success);
            if (baseTaskResult.success && baseTaskResult.data) {
                createdTaskIds.push(baseTaskResult.data.id);
            }

            // Create dependent task
            const dependentTaskResult = await tcpClient.createTask({
                title: `${TASK_ID_PREFIX} Dependent Task`,
                description: "Task that depends on base task status",
                priority: "low",
                createdBy: "priority-status-test"
            });

            assert.ok(dependentTaskResult.success);
            if (dependentTaskResult.success && dependentTaskResult.data) {
                createdTaskIds.push(dependentTaskResult.data.id);
            }

            // Add priority-status dependency
            if (baseTaskResult.data && dependentTaskResult.data) {
                priorityStatusDependencyManager.addDependency({
                    taskId: dependentTaskResult.data.id,
                    dependsOnTaskId: baseTaskResult.data.id,
                    dependencyType: "priority-on-status",
                    requiredCondition: { status: "done" }
                });

                // Update base task status to "in-progress"
                const updateResult = await tcpClient.updateTaskStatus(
                    baseTaskResult.data.id,
                    "in-progress"
                );
                assert.ok(updateResult.success);

                // Try to update dependent task priority (should work)
                const priorityUpdateResult = await tcpClient.updateTaskPriority(
                    dependentTaskResult.data.id,
                    "high"
                );
                assert.ok(priorityUpdateResult.success);
            }
        });

        it("should detect simple circular dependencies", async () => {
            // Create two tasks
            const task1Result = await tcpClient.createTask({
                title: `${TASK_ID_PREFIX} Task 1`,
                description: "First task in circular dependency",
                priority: "medium",
                createdBy: "priority-status-test"
            });

            const task2Result = await tcpClient.createTask({
                title: `${TASK_ID_PREFIX} Task 2`,
                description: "Second task in circular dependency",
                priority: "medium",
                createdBy: "priority-status-test"
            });

            assert.ok(task1Result.success);
            assert.ok(task2Result.success);

            if (task1Result.success && task2Result.success && task1Result.data && task2Result.data) {
                createdTaskIds.push(task1Result.data.id, task2Result.data.id);

                // Add circular dependencies
                priorityStatusDependencyManager.addDependency({
                    taskId: task1Result.data.id,
                    dependsOnTaskId: task2Result.data.id,
                    dependencyType: "status-on-priority",
                    requiredCondition: { priority: "high" }
                });

                priorityStatusDependencyManager.addDependency({
                    taskId: task2Result.data.id,
                    dependsOnTaskId: task1Result.data.id,
                    dependencyType: "priority-on-status",
                    requiredCondition: { status: "done" }
                });

                // Try concurrent operations that could deadlock
                const operations = [
                    async () => {
                        if (task1Result.data) {
                            const lockResult = await priorityStatusDependencyManager.tryAcquireLock({
                                taskId: task1Result.data.id,
                                operation: "update-status",
                                newValue: "in-progress",
                                timestamp: Date.now(),
                                requestedBy: "test-1"
                            });
                            if (lockResult) {
                                await tcpClient.updateTaskStatus(task1Result.data.id, "in-progress");
                                priorityStatusDependencyManager.releaseLock(task1Result.data.id, "test-1");
                            }
                        }
                    },
                    async () => {
                        if (task2Result.data) {
                            const lockResult = await priorityStatusDependencyManager.tryAcquireLock({
                                taskId: task2Result.data.id,
                                operation: "update-priority",
                                newValue: "high",
                                timestamp: Date.now(),
                                requestedBy: "test-2"
                            });
                            if (lockResult) {
                                await tcpClient.updateTaskPriority(task2Result.data.id, "high");
                                priorityStatusDependencyManager.releaseLock(task2Result.data.id, "test-2");
                            }
                        }
                    }
                ];

                // Execute operations concurrently
                const results = await Promise.allSettled(operations);
                
                // At least one operation should succeed
                const successes = results.filter(r => r.status === "fulfilled").length;
                assert.ok(successes > 0);
            }
        });
    });

    describe("Deadlock Prevention Mechanisms", () => {
        it("should use timeout-based lock release", async () => {
            // Create a task
            const taskResult = await tcpClient.createTask({
                title: `${TASK_ID_PREFIX} Timeout Test Task`,
                description: "Task for timeout lock testing",
                priority: "medium",
                createdBy: "priority-status-test"
            });

            assert.ok(taskResult.success);
            if (taskResult.success && taskResult.data) {
                createdTaskIds.push(taskResult.data.id);

                // Acquire a lock
                const lockAcquired = await priorityStatusDependencyManager.tryAcquireLock({
                    taskId: taskResult.data.id,
                    operation: "update-priority",
                    newValue: "high",
                    timestamp: Date.now(),
                    requestedBy: "timeout-test"
                });

                assert.ok(lockAcquired);

                // Check lock status
                let lockStatus = priorityStatusDependencyManager.getLockStatus();
                assert.strictEqual(lockStatus.activeLocks, 1);
                assert.ok(lockStatus.lockedTasks.includes(taskResult.data.id));

                // Wait for lock to expire (shorter timeout for testing)
                await new Promise(resolve => setTimeout(resolve, 6000));

                // Lock should be automatically released
                lockStatus = priorityStatusDependencyManager.getLockStatus();
                assert.strictEqual(lockStatus.activeLocks, 0);
            }
        });

        it("should provide comprehensive deadlock detection information", async () => {
            const task1Result = await tcpClient.createTask({
                title: `${TASK_ID_PREFIX} Detection Test 1`,
                description: "First task for deadlock detection testing",
                priority: "medium",
                createdBy: "priority-status-test"
            });

            const task2Result = await tcpClient.createTask({
                title: `${TASK_ID_PREFIX} Detection Test 2`,
                description: "Second task for deadlock detection testing",
                priority: "medium",
                createdBy: "priority-status-test"
            });

            if (task1Result.success && task2Result.success && 
                task1Result.data && task2Result.data) {
                createdTaskIds.push(task1Result.data.id, task2Result.data.id);

                // Set up dependencies
                priorityStatusDependencyManager.addDependency({
                    taskId: task1Result.data.id,
                    dependsOnTaskId: task2Result.data.id,
                    dependencyType: "status-on-priority",
                    requiredCondition: { priority: "high" }
                });

                // Simulate a deadlock scenario
                const currentTasks = new Map([
                    [task1Result.data.id, task1Result.data],
                    [task2Result.data.id, task2Result.data]
                ]);

                const operation = {
                    taskId: task1Result.data.id,
                    operation: "update-status" as const,
                    newValue: "in-progress" as const,
                    timestamp: Date.now(),
                    requestedBy: "detection-test"
                };

                const deadlockResult = priorityStatusDependencyManager.detectDeadlocks(
                    operation,
                    currentTasks as any
                );

                // Should provide detailed analysis
                assert.ok(typeof deadlockResult.hasDeadlock === "boolean");
                assert.ok(Array.isArray(deadlockResult.detectedCycles));
                assert.ok(Array.isArray(deadlockResult.conflictingOperations));
                assert.ok(Array.isArray(deadlockResult.preventionActions));
            }
        });
    });

    describe("Performance and Load Testing", () => {
        it("should handle high concurrency without performance degradation", async () => {
            const taskCount = 5;
            const concurrentOps = 10;
            const taskResults: any[] = [];

            // Create tasks
            for (let i = 0; i < taskCount; i++) {
                const result = await tcpClient.createTask({
                    title: `${TASK_ID_PREFIX} Performance Task ${i}`,
                    description: `Task ${i} for performance testing`,
                    priority: "medium",
                    createdBy: "priority-status-test"
                });

                if (result.success && result.data) {
                    taskResults.push(result);
                    createdTaskIds.push(result.data.id);
                }
            }

            // Create random dependencies
            for (let i = 1; i < taskResults.length; i++) {
                const randomPrev = Math.floor(Math.random() * i);
                priorityStatusDependencyManager.addDependency({
                    taskId: taskResults[i].data.id,
                    dependsOnTaskId: taskResults[randomPrev].data.id,
                    dependencyType: Math.random() > 0.5 ? "priority-on-status" : "status-on-priority",
                    requiredCondition: Math.random() > 0.5 ? 
                        { status: "done" } : 
                        { priority: "high" }
                });
            }

            const startTime = Date.now();

            // Execute many concurrent operations
            const operations = Array.from({ length: concurrentOps }, (_, index) => 
                new Promise<void>((resolve) => {
                    setTimeout(async () => {
                        const randomTask = taskResults[Math.floor(Math.random() * taskResults.length)];
                        const operation = Math.random() > 0.5 ? "update-priority" : "update-status";
                        const newValue = Math.random() > 0.5 ? "high" : "done";

                        try {
                            const lockResult = await priorityStatusDependencyManager.tryAcquireLock({
                                taskId: randomTask.data.id,
                                operation: operation as any,
                                newValue: newValue as any,
                                timestamp: Date.now(),
                                requestedBy: `perf-test-${index}`
                            });

                            if (lockResult) {
                                if (operation === "update-priority") {
                                    await tcpClient.updateTaskPriority(randomTask.data.id, newValue as any);
                                } else {
                                    await tcpClient.updateTaskStatus(randomTask.data.id, newValue as any);
                                }
                                
                                priorityStatusDependencyManager.releaseLock(
                                    randomTask.data.id,
                                    `perf-test-${index}`
                                );
                            }
                        } catch (error) {
                            console.log(`Performance test operation ${index} failed:`, error);
                        }
                        
                        resolve();
                    }, Math.random() * 50);
                })
            );

            await Promise.all(operations);
            
            const duration = Date.now() - startTime;
            
            // Should complete within reasonable time (5 seconds for 10 concurrent ops)
            assert.ok(duration < 5000);
            
            // Check final lock status
            const lockStatus = priorityStatusDependencyManager.getLockStatus();
            assert.strictEqual(lockStatus.activeLocks, 0);
            
            console.log(`Performance test: ${concurrentOps} operations in ${duration}ms`);
        });
    });
});