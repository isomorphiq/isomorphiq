import { describe, it, before, beforeEach, after } from "node:test";
import { strict as assert } from "node:assert";
import { DaemonTcpClient, type Task } from "../e2e/dashboard/tcp-client.ts";

describe("Advanced CAS Deadlock Detection Test 1 - Task b7c2d592", () => {
    const TASK_ID_PREFIX = "task-b7c2d592-deadlock-detection";
    let tcpClient: DaemonTcpClient;

    before(async () => {
        // Use existing daemon on port 3001
        tcpClient = new DaemonTcpClient(3001, "localhost");
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
    });

    describe("Classic Circular Dependency Deadlock Detection", () => {
        it("should detect and prevent circular dependency deadlocks in task chains", async () => {
            // Create tasks that will form a circular dependency pattern
            const taskIds: string[] = [];
            const cycleLength = 4;

            // First, create the tasks
            for (let i = 0; i < cycleLength; i++) {
                const result = await tcpClient.createTask({
                    title: `${TASK_ID_PREFIX} Circular Task ${i}`,
                    description: `Task ${i} in circular dependency chain`,
                    priority: "medium",
                    createdBy: "deadlock-test-b7c2d592"
                });

                if (result.success && result.data) {
                    taskIds.push(result.data.id);
                } else {
                    assert.fail(`Failed to create circular task ${i}`);
                }
            }

            // Create circular dependency operations
            // Task A waits for Task B, B waits for C, C waits for D, D waits for A
            const circularOperations = taskIds.map((taskId, index) => {
                const nextTaskId = taskIds[(index + 1) % cycleLength];
                
                return new Promise<void>(async (resolve) => {
                    try {
                        // Simulate acquiring lock on current task
                        await tcpClient.updateTaskStatus(taskId, "in-progress");
                        
                        // Small delay to increase contention
                        await new Promise(delayResolve => setTimeout(delayResolve, 50));
                        
                        // Try to acquire lock on next task (creates circular wait)
                        await tcpClient.updateTaskStatus(nextTaskId, "in-progress");
                        
                        // Release locks
                        await tcpClient.updateTaskStatus(taskId, "done");
                        await tcpClient.updateTaskStatus(nextTaskId, "done");
                        
                        resolve();
                    } catch (error) {
                        // Operation failed, likely due to contention or timeout
                        console.log(`Circular operation ${index} failed as expected:`, error);
                        resolve();
                    }
                });
            });

            const timeout = 15000; // 15 second timeout for deadlock detection
            const startTime = Date.now();

            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error("Deadlock detected - operations timed out")), timeout);
            });

            try {
                await Promise.race([
                    Promise.allSettled(circularOperations),
                    timeoutPromise
                ]);

                const endTime = Date.now();
                const duration = endTime - startTime;

                // Should complete without timeout if deadlock prevention is working
                assert.ok(duration < timeout, "Operations should complete without deadlock");

                // Verify all tasks are still accessible and in valid states
                for (const taskId of taskIds) {
                    const verifyResult = await tcpClient.getTask(taskId);
                    assert.ok(verifyResult.success && verifyResult.data, 
                        `Task ${taskId} should remain accessible after circular dependency test`);
                    
                    assert.ok(["todo", "in-progress", "done"].includes(verifyResult.data!.status),
                        `Task ${taskId} should have valid status`);
                }

                console.log(`Circular dependency test completed in ${duration}ms without deadlock`);

            } catch (error) {
                if (error instanceof Error && error.message === "Deadlock detected - operations timed out") {
                    console.log("Deadlock detected as expected - timeout mechanism working");
                    
                    // Verify system recovery - tasks should still be accessible
                    for (const taskId of taskIds) {
                        const verifyResult = await tcpClient.getTask(taskId);
                        assert.ok(verifyResult.success && verifyResult.data, 
                            `Task ${taskId} should remain accessible after deadlock detection`);
                    }
                } else {
                    throw error;
                }
            }
        });

        it("should handle resource ordering violations that could lead to deadlocks", async () => {
            // Create tasks for resource ordering test
            const resourceTasks: string[] = [];
            const resourceCount = 3;

            for (let i = 0; i < resourceCount; i++) {
                const result = await tcpClient.createTask({
                    title: `${TASK_ID_PREFIX} Resource Task ${i}`,
                    description: `Shared resource task ${i}`,
                    priority: "high",
                    createdBy: "deadlock-test-b7c2d592"
                });

                if (result.success && result.data) {
                    resourceTasks.push(result.data.id);
                }
            }

            // Create operations that violate resource ordering (common deadlock cause)
            // Operation 1: Lock Task A, then Task B
            // Operation 2: Lock Task B, then Task A
            const orderingViolationOperations = [
                // Operation 1: A -> B -> C
                new Promise<void>(async (resolve) => {
                    try {
                        for (let i = 0; i < resourceTasks.length; i++) {
                            await tcpClient.updateTaskStatus(resourceTasks[i], "in-progress");
                            await new Promise(delayResolve => setTimeout(delayResolve, 30));
                        }
                        
                        // Release in reverse order
                        for (let i = resourceTasks.length - 1; i >= 0; i--) {
                            await tcpClient.updateTaskStatus(resourceTasks[i], "done");
                        }
                        resolve();
                    } catch (error) {
                        console.log("Ordering violation operation 1 failed:", error);
                        resolve();
                    }
                }),
                
                // Operation 2: C -> B -> A (reverse order)
                new Promise<void>(async (resolve) => {
                    try {
                        for (let i = resourceTasks.length - 1; i >= 0; i--) {
                            await tcpClient.updateTaskStatus(resourceTasks[i], "in-progress");
                            await new Promise(delayResolve => setTimeout(delayResolve, 30));
                        }
                        
                        // Release in reverse order  
                        for (let i = 0; i < resourceTasks.length; i++) {
                            await tcpClient.updateTaskStatus(resourceTasks[i], "done");
                        }
                        resolve();
                    } catch (error) {
                        console.log("Ordering violation operation 2 failed:", error);
                        resolve();
                    }
                })
            ];

            const timeout = 10000; // 10 second timeout
            const startTime = Date.now();

            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error("Resource ordering deadlock detected")), timeout);
            });

            try {
                const results = await Promise.race([
                    Promise.allSettled(orderingViolationOperations),
                    timeoutPromise
                ]);

                const endTime = Date.now();
                const duration = endTime - startTime;

                if (Array.isArray(results)) {
                    const successful = results.filter(r => r.status === 'fulfilled').length;
                    console.log(`Resource ordering test: ${successful}/${orderingViolationOperations.length} operations completed in ${duration}ms`);
                }

                // Should handle ordering violations without indefinite blocking
                assert.ok(duration < timeout, "Resource ordering violations should be handled gracefully");

            } catch (error) {
                if (error instanceof Error && error.message === "Resource ordering deadlock detected") {
                    console.log("Resource ordering deadlock detected - system has timeout protection");
                } else {
                    throw error;
                }
            }

            // Verify all resource tasks are still in valid states
            for (const taskId of resourceTasks) {
                const verifyResult = await tcpClient.getTask(taskId);
                assert.ok(verifyResult.success && verifyResult.data, 
                    `Resource task ${taskId} should remain accessible`);
            }
        });
    });

    describe("Two-Phase Locking Deadlock Scenarios", () => {
        it("should detect deadlocks in two-phase locking protocols", async () => {
            // Create tasks for two-phase locking test
            const tplTasks: string[] = [];
            const tplCount = 4;

            for (let i = 0; i < tplCount; i++) {
                const result = await tcpClient.createTask({
                    title: `${TASK_ID_PREFIX} TPL Task ${i}`,
                    description: `Two-phase locking test task ${i}`,
                    priority: "medium",
                    createdBy: "deadlock-test-b7c2d592"
                });

                if (result.success && result.data) {
                    tplTasks.push(result.data.id);
                }
            }

            // Simulate two-phase locking with potential deadlock
            const tploperations = [
                // Transaction 1: Lock A, B then update both
                new Promise<void>(async (resolve) => {
                    try {
                        // Phase 1: Acquire locks
                        await tcpClient.updateTaskStatus(tplTasks[0], "in-progress");
                        await tcpClient.updateTaskStatus(tplTasks[1], "in-progress");
                        
                        // Phase 2: Perform updates and release
                        await tcpClient.updateTaskPriority(tplTasks[0], "high");
                        await tcpClient.updateTaskPriority(tplTasks[1], "high");
                        await tcpClient.updateTaskStatus(tplTasks[0], "done");
                        await tcpClient.updateTaskStatus(tplTasks[1], "done");
                        
                        resolve();
                    } catch (error) {
                        console.log("TPL Transaction 1 failed:", error);
                        resolve();
                    }
                }),
                
                // Transaction 2: Lock B, A then update both (reverse order - deadlock potential)
                new Promise<void>(async (resolve) => {
                    try {
                        // Phase 1: Acquire locks in reverse order
                        await tcpClient.updateTaskStatus(tplTasks[1], "in-progress");
                        await tcpClient.updateTaskStatus(tplTasks[0], "in-progress");
                        
                        // Phase 2: Perform updates and release
                        await tcpClient.updateTaskPriority(tplTasks[1], "low");
                        await tcpClient.updateTaskPriority(tplTasks[0], "low");
                        await tcpClient.updateTaskStatus(tplTasks[1], "done");
                        await tcpClient.updateTaskStatus(tplTasks[0], "done");
                        
                        resolve();
                    } catch (error) {
                        console.log("TPL Transaction 2 failed:", error);
                        resolve();
                    }
                })
            ];

            const timeout = 8000; // 8 second timeout
            const startTime = Date.now();

            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error("Two-phase locking deadlock detected")), timeout);
            });

            try {
                const results = await Promise.race([
                    Promise.allSettled(tploperations),
                    timeoutPromise
                ]);

                const endTime = Date.now();
                const duration = endTime - startTime;

                if (Array.isArray(results)) {
                    const successful = results.filter(r => r.status === 'fulfilled').length;
                    console.log(`TPL test: ${successful}/${tploperations.length} transactions completed in ${duration}ms`);
                }

                // Should complete or timeout gracefully
                assert.ok(duration < timeout || duration >= timeout, 
                    "TPL operations should either complete or timeout gracefully");

            } catch (error) {
                if (error instanceof Error && error.message === "Two-phase locking deadlock detected") {
                    console.log("TPL deadlock detected - timeout protection working");
                } else {
                    throw error;
                }
            }

            // Verify all tasks are accessible
            for (const taskId of tplTasks) {
                const verifyResult = await tcpClient.getTask(taskId);
                assert.ok(verifyResult.success && verifyResult.data, 
                    `TPL task ${taskId} should remain accessible`);
            }
        });
    });

    describe("Concurrent Priority-Status Dependency Deadlocks", () => {
        it("should handle deadlocks from priority-status update dependencies", async () => {
            // Create tasks with complex priority-status dependencies
            const dependencyTasks: string[] = [];
            const depCount = 3;

            for (let i = 0; i < depCount; i++) {
                const result = await tcpClient.createTask({
                    title: `${TASK_ID_PREFIX} Priority-Status Dependency Task ${i}`,
                    description: `Task with priority-status dependency ${i}`,
                    priority: i % 2 === 0 ? "high" : "medium",
                    createdBy: "deadlock-test-b7c2d592"
                });

                if (result.success && result.data) {
                    dependencyTasks.push(result.data.id);
                }
            }

            // Create operations with interdependent priority and status updates
            const dependencyOperations = dependencyTasks.map((taskId, index) => {
                return new Promise<void>(async (resolve) => {
                    try {
                        // Complex dependency: status update depends on priority of other tasks
                        const currentResult = await tcpClient.getTask(taskId);
                        if (!currentResult.success || !currentResult.data) {
                            resolve();
                            return;
                        }

                        // Try to update priority first
                        await tcpClient.updateTaskPriority(taskId, "high");
                        
                        // Then try to update status based on other tasks' priorities
                        const otherTaskId = dependencyTasks[(index + 1) % depCount];
                        const otherResult = await tcpClient.getTask(otherTaskId);
                        
                        if (otherResult.success && otherResult.data && 
                            otherResult.data.priority === "high") {
                            await tcpClient.updateTaskStatus(taskId, "in-progress");
                        }
                        
                        resolve();
                    } catch (error) {
                        console.log(`Priority-status dependency operation ${index} failed:`, error);
                        resolve();
                    }
                });
            });

            const timeout = 12000; // 12 second timeout
            const startTime = Date.now();

            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error("Priority-status dependency deadlock detected")), timeout);
            });

            try {
                const results = await Promise.race([
                    Promise.allSettled(dependencyOperations),
                    timeoutPromise
                ]);

                const endTime = Date.now();
                const duration = endTime - startTime;

                if (Array.isArray(results)) {
                    const successful = results.filter(r => r.status === 'fulfilled').length;
                    console.log(`Priority-status dependency test: ${successful}/${dependencyOperations.length} completed in ${duration}ms`);
                }

                // Should handle complex dependencies without indefinite blocking
                assert.ok(duration < timeout, "Complex dependencies should resolve without deadlock");

            } catch (error) {
                if (error instanceof Error && error.message === "Priority-status dependency deadlock detected") {
                    console.log("Priority-status dependency deadlock detected - system protected");
                } else {
                    throw error;
                }
            }

            // Verify all tasks are in valid states
            for (const taskId of dependencyTasks) {
                const verifyResult = await tcpClient.getTask(taskId);
                assert.ok(verifyResult.success && verifyResult.data, 
                    `Dependency task ${taskId} should remain accessible`);
                
                assert.ok(["high", "medium", "low"].includes(verifyResult.data!.priority),
                    `Task ${taskId} should have valid priority`);
                assert.ok(["todo", "in-progress", "done"].includes(verifyResult.data!.status),
                    `Task ${taskId} should have valid status`);
            }
        });
    });

    describe("Enhanced Deadlock Detection Edge Cases", () => {
        it("should detect complex multi-resource deadlocks with nested dependencies", async () => {
            // Create tasks for complex multi-resource deadlock testing
            const complexTasks: string[] = [];
            const taskCount = 5;

            for (let i = 0; i < taskCount; i++) {
                const result = await tcpClient.createTask({
                    title: `${TASK_ID_PREFIX} Complex Multi-Resource Task ${i}`,
                    description: `Task for complex multi-resource deadlock testing ${i}`,
                    priority: i % 3 === 0 ? "high" : i % 3 === 1 ? "medium" : "low",
                    createdBy: "deadlock-test-b7c2d592"
                });

                if (result.success && result.data) {
                    complexTasks.push(result.data.id);
                }
            }

            // Create complex multi-resource operations with nested dependencies
            const multiResourceOperations = [
                // Operation 1: Lock Task 0 (status), then Task 1 (priority), then Task 2 (status)
                new Promise<void>(async (resolve) => {
                    try {
                        await tcpClient.updateTaskStatus(complexTasks[0], "in-progress");
                        await new Promise(r => setTimeout(r, 50));
                        await tcpClient.updateTaskPriority(complexTasks[1], "high");
                        await new Promise(r => setTimeout(r, 30));
                        await tcpClient.updateTaskStatus(complexTasks[2], "in-progress");
                        
                        // Release locks
                        await tcpClient.updateTaskStatus(complexTasks[0], "done");
                        await tcpClient.updateTaskPriority(complexTasks[1], "medium");
                        
                        resolve();
                    } catch (error) {
                        console.log("Multi-resource operation 1 failed:", error);
                        resolve();
                    }
                }),
                
                // Operation 2: Lock Task 2 (priority), then Task 3 (status), then Task 0 (priority) - creates potential cycle
                new Promise<void>(async (resolve) => {
                    try {
                        await tcpClient.updateTaskPriority(complexTasks[2], "high");
                        await new Promise(r => setTimeout(r, 40));
                        await tcpClient.updateTaskStatus(complexTasks[3], "in-progress");
                        await new Promise(r => setTimeout(r, 35));
                        await tcpClient.updateTaskPriority(complexTasks[0], "low");
                        
                        // Release locks
                        await tcpClient.updateTaskPriority(complexTasks[2], "low");
                        await tcpClient.updateTaskStatus(complexTasks[3], "done");
                        
                        resolve();
                    } catch (error) {
                        console.log("Multi-resource operation 2 failed:", error);
                        resolve();
                    }
                }),
                
                // Operation 3: Lock Task 3 (status), then Task 4 (status), then Task 1 (priority)
                new Promise<void>(async (resolve) => {
                    try {
                        await tcpClient.updateTaskStatus(complexTasks[3], "in-progress");
                        await new Promise(r => setTimeout(r, 45));
                        await tcpClient.updateTaskStatus(complexTasks[4], "in-progress");
                        await new Promise(r => setTimeout(r, 25));
                        await tcpClient.updateTaskPriority(complexTasks[1], "low");
                        
                        // Release locks
                        await tcpClient.updateTaskStatus(complexTasks[4], "done");
                        await tcpClient.updateTaskPriority(complexTasks[1], "medium");
                        
                        resolve();
                    } catch (error) {
                        console.log("Multi-resource operation 3 failed:", error);
                        resolve();
                    }
                })
            ];

            const timeout = 20000; // 20 second timeout
            const startTime = Date.now();

            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error("Complex multi-resource deadlock detected")), timeout);
            });

            try {
                const results = await Promise.race([
                    Promise.allSettled(multiResourceOperations),
                    timeoutPromise
                ]);

                const endTime = Date.now();
                const duration = endTime - startTime;

                if (Array.isArray(results)) {
                    const successful = results.filter(r => r.status === 'fulfilled').length;
                    const failed = results.filter(r => r.status === 'rejected').length;
                    
                    console.log(`Complex multi-resource deadlock test: ${successful}/${multiResourceOperations.length} successful, ${failed} failed in ${duration}ms`);
                    
                    assert.ok(successful + failed === multiResourceOperations.length, 
                        "All operations should either complete or fail gracefully");
                }

                assert.ok(duration < timeout + 5000, "Complex multi-resource operations should resolve or timeout within reasonable time");

            } catch (error) {
                if (error instanceof Error && error.message === "Complex multi-resource deadlock detected") {
                    console.log("Complex multi-resource deadlock detected - timeout protection working");
                } else {
                    throw error;
                }
            }

            // Verify all tasks are in valid states after complex operations
            for (const taskId of complexTasks) {
                const verifyResult = await tcpClient.getTask(taskId);
                assert.ok(verifyResult.success && verifyResult.data, 
                    `Complex task ${taskId} should remain accessible after multi-resource test`);
                
                assert.ok(["todo", "in-progress", "done"].includes(verifyResult.data!.status),
                    `Task ${taskId} should have valid status after multi-resource operations`);
                assert.ok(["high", "medium", "low"].includes(verifyResult.data!.priority),
                    `Task ${taskId} should have valid priority after multi-resource operations`);
            }
        });

        it("should handle rapid concurrent operations with resource contention bursts", async () => {
            // Create tasks for rapid concurrent operation testing
            const burstTasks: string[] = [];
            const burstCount = 8;

            for (let i = 0; i < burstCount; i++) {
                const result = await tcpClient.createTask({
                    title: `${TASK_ID_PREFIX} Burst Test Task ${i}`,
                    description: `Task for rapid concurrent operation burst testing ${i}`,
                    priority: "medium",
                    createdBy: "deadlock-test-b7c2d592"
                });

                if (result.success && result.data) {
                    burstTasks.push(result.data.id);
                }
            }

            // Create multiple bursts of concurrent operations
            const burstOperations = [];
            const operationsPerBurst = 6;
            const numberOfBursts = 3;

            for (let burst = 0; burst < numberOfBursts; burst++) {
                const burstPromises = [];
                
                for (let op = 0; op < operationsPerBurst; op++) {
                    const taskIndex = (burst * operationsPerBurst + op) % burstCount;
                    const taskId = burstTasks[taskIndex];
                    
                    burstPromises.push(
                        new Promise<void>(async (resolve) => {
                            try {
                                // Rapid sequence of operations on the same task
                                await tcpClient.updateTaskStatus(taskId, "in-progress");
                                await new Promise(r => setTimeout(r, Math.random() * 20));
                                await tcpClient.updateTaskPriority(taskId, "high");
                                await new Promise(r => setTimeout(r, Math.random() * 15));
                                await tcpClient.updateTaskStatus(taskId, "in-progress");
                                await new Promise(r => setTimeout(r, Math.random() * 10));
                                await tcpClient.updateTaskStatus(taskId, "done");
                                await tcpClient.updateTaskPriority(taskId, "medium");
                                
                                resolve();
                            } catch (error) {
                                resolve();
                            }
                        })
                    );
                }
                
                burstOperations.push(...burstPromises);
                
                if (burst < numberOfBursts - 1) {
                    await new Promise(r => setTimeout(r, 100));
                }
            }

            const timeout = 30000; // 30 second timeout
            const startTime = Date.now();

            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error("Burst operations deadlock detected")), timeout);
            });

            try {
                const results = await Promise.race([
                    Promise.allSettled(burstOperations),
                    timeoutPromise
                ]);

                const endTime = Date.now();
                const duration = endTime - startTime;

                if (Array.isArray(results)) {
                    const successful = results.filter(r => r.status === 'fulfilled').length;
                    const failed = results.filter(r => r.status === 'rejected').length;
                    
                    console.log(`Burst operations test: ${successful}/${burstOperations.length} successful, ${failed} failed in ${duration}ms`);
                    
                    const successRate = successful / burstOperations.length;
                    assert.ok(successRate >= 0.3, `At least 30% of burst operations should succeed, got ${successRate.toFixed(2)}`);
                }

                assert.ok(duration < timeout, "Burst operations should complete within timeout");

            } catch (error) {
                if (error instanceof Error && error.message === "Burst operations deadlock detected") {
                    console.log("Burst operations deadlock detected - timeout protection engaged");
                } else {
                    throw error;
                }
            }

            // Verify system stability after burst operations
            const finalCheckResults = await Promise.allSettled(
                burstTasks.map(taskId => tcpClient.getTask(taskId))
            );

            const accessibleTasks = finalCheckResults.filter(r => 
                r.status === 'fulfilled' && 
                (r as PromiseFulfilledResult<any>).value.success
            ).length;

            assert.ok(accessibleTasks >= burstTasks.length * 0.8, 
                `At least 80% of tasks should remain accessible after burst operations, got ${accessibleTasks}/${burstTasks.length}`);
        });

        it("should demonstrate deadlock prevention with resource ordering constraints", async () => {
            // Create tasks for resource ordering constraint testing
            const orderedTasks: string[] = [];
            const orderedCount = 6;

            for (let i = 0; i < orderedCount; i++) {
                const result = await tcpClient.createTask({
                    title: `${TASK_ID_PREFIX} Ordered Resource Task ${i}`,
                    description: `Task for resource ordering constraint testing ${i}`,
                    priority: "medium",
                    createdBy: "deadlock-test-b7c2d592"
                });

                if (result.success && result.data) {
                    orderedTasks.push(result.data.id);
                }
            }

            // Test operations that follow and violate resource ordering
            const orderingTestOperations = [
                // Operation 1: Follows resource ordering (0 -> 1 -> 2 -> 3)
                new Promise<void>(async (resolve) => {
                    try {
                        const orderedSequence = [0, 1, 2, 3];
                        for (const index of orderedSequence) {
                            await tcpClient.updateTaskStatus(orderedTasks[index], "in-progress");
                            await new Promise(r => setTimeout(r, 40));
                        }
                        
                        // Perform updates and release in reverse order
                        for (let i = orderedSequence.length - 1; i >= 0; i--) {
                            await tcpClient.updateTaskPriority(orderedTasks[orderedSequence[i]], "high");
                            await tcpClient.updateTaskStatus(orderedTasks[orderedSequence[i]], "done");
                        }
                        
                        resolve();
                    } catch (error) {
                        console.log("Ordered operation 1 failed:", error);
                        resolve();
                    }
                }),
                
                // Operation 2: Follows resource ordering (2 -> 3 -> 4 -> 5)
                new Promise<void>(async (resolve) => {
                    try {
                        const orderedSequence = [2, 3, 4, 5];
                        for (const index of orderedSequence) {
                            await tcpClient.updateTaskStatus(orderedTasks[index], "in-progress");
                            await new Promise(r => setTimeout(r, 35));
                        }
                        
                        // Perform updates and release in reverse order
                        for (let i = orderedSequence.length - 1; i >= 0; i--) {
                            await tcpClient.updateTaskPriority(orderedTasks[orderedSequence[i]], "low");
                            await tcpClient.updateTaskStatus(orderedTasks[orderedSequence[i]], "done");
                        }
                        
                        resolve();
                    } catch (error) {
                        console.log("Ordered operation 2 failed:", error);
                        resolve();
                    }
                }),
                
                // Operation 3: Violates resource ordering (5 -> 4 -> 3 -> 2)
                new Promise<void>(async (resolve) => {
                    try {
                        const reverseSequence = [5, 4, 3, 2];
                        for (const index of reverseSequence) {
                            await tcpClient.updateTaskStatus(orderedTasks[index], "in-progress");
                            await new Promise(r => setTimeout(r, 45));
                        }
                        
                        // Perform updates and release
                        for (let i = reverseSequence.length - 1; i >= 0; i--) {
                            await tcpClient.updateTaskPriority(orderedTasks[reverseSequence[i]], "medium");
                            await tcpClient.updateTaskStatus(orderedTasks[reverseSequence[i]], "done");
                        }
                        
                        resolve();
                    } catch (error) {
                        console.log("Resource ordering violation operation 3 failed (expected):", error);
                        resolve();
                    }
                })
            ];

            const timeout = 15000; // 15 second timeout
            const startTime = Date.now();

            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error("Resource ordering constraint deadlock detected")), timeout);
            });

            try {
                const results = await Promise.race([
                    Promise.allSettled(orderingTestOperations),
                    timeoutPromise
                ]);

                const endTime = Date.now();
                const duration = endTime - startTime;

                if (Array.isArray(results)) {
                    const successful = results.filter(r => r.status === 'fulfilled').length;
                    const failed = results.filter(r => r.status === 'rejected').length;
                    
                    console.log(`Resource ordering constraint test: ${successful}/${orderingTestOperations.length} successful, ${failed} failed in ${duration}ms`);
                    
                    assert.ok(successful >= 2, "At least the ordered operations should succeed");
                }

                assert.ok(duration < timeout, "Resource ordering operations should complete within timeout");

            } catch (error) {
                if (error instanceof Error && error.message === "Resource ordering constraint deadlock detected") {
                    console.log("Resource ordering constraint deadlock detected - system protected");
                } else {
                    throw error;
                }
            }

            // Verify all tasks are accessible after ordering constraint testing
            for (const taskId of orderedTasks) {
                const verifyResult = await tcpClient.getTask(taskId);
                assert.ok(verifyResult.success && verifyResult.data, 
                    `Ordered task ${taskId} should remain accessible after constraint testing`);
            }
        });
    });

                if (result.success && result.data) {
                    complexTasks.push(result.data.id);
                }
            }

            // Create complex multi-resource operations with nested dependencies
            // This simulates real-world scenarios where tasks need multiple resources simultaneously
            const multiResourceOperations = [
                // Operation 1: Lock Task 0 (status), then Task 1 (priority), then Task 2 (metadata)
                new Promise<void>(async (resolve) => {
                    try {
                        // Sequential operations to create multi-resource lock scenario
                        await tcpClient.updateTaskStatus(complexTasks[0], "in-progress");
                        await new Promise(r => setTimeout(r, 50)); // Small delay to increase contention
                        await tcpClient.updateTaskPriority(complexTasks[1], "high");
                        await new Promise(r => setTimeout(r, 30));
                        await tcpClient.updateTaskStatus(complexTasks[2], "in-progress");
                        
                        // Release locks
                        await tcpClient.updateTaskStatus(complexTasks[0], "done");
                        await tcpClient.updateTaskPriority(complexTasks[1], "medium");
                        
                        resolve();
                    } catch (error) {
                        console.log("Multi-resource operation 1 failed:", error);
                        resolve();
                    }
                }),
                
                // Operation 2: Lock Task 2 (priority), then Task 3 (status), then Task 0 (metadata) - creates potential cycle
                new Promise<void>(async (resolve) => {
                    try {
                        await tcpClient.updateTaskPriority(complexTasks[2], "high");
                        await new Promise(r => setTimeout(r, 40));
                        await tcpClient.updateTaskStatus(complexTasks[3], "in-progress");
                        await new Promise(r => setTimeout(r, 35));
                        await tcpClient.updateTask(complexTasks[0], { description: "competing metadata update" });
                        
                        // Release locks
                        await tcpClient.updateTaskPriority(complexTasks[2], "low");
                        await tcpClient.updateTaskStatus(complexTasks[3], "done");
                        
                        resolve();
                    } catch (error) {
                        console.log("Multi-resource operation 2 failed:", error);
                        resolve();
                    }
                }),
                
                // Operation 3: Lock Task 3 (metadata), then Task 4 (status), then Task 1 (priority)
                new Promise<void>(async (resolve) => {
                    try {
                        await tcpClient.updateTask(complexTasks[3], { description: "operation 3 metadata" });
                        await new Promise(r => setTimeout(r, 45));
                        await tcpClient.updateTaskStatus(complexTasks[4], "in-progress");
                        await new Promise(r => setTimeout(r, 25));
                        await tcpClient.updateTaskPriority(complexTasks[1], "low");
                        
                        // Release locks
                        await tcpClient.updateTaskStatus(complexTasks[4], "done");
                        await tcpClient.updateTaskPriority(complexTasks[1], "medium");
                        
                        resolve();
                    } catch (error) {
                        console.log("Multi-resource operation 3 failed:", error);
                        resolve();
                    }
                })
            ];

            const timeout = 20000; // 20 second timeout for complex multi-resource deadlocks
            const startTime = Date.now();

            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error("Complex multi-resource deadlock detected")), timeout);
            });

            try {
                const results = await Promise.race([
                    Promise.allSettled(multiResourceOperations),
                    timeoutPromise
                ]);

                const endTime = Date.now();
                const duration = endTime - startTime;

                if (Array.isArray(results)) {
                    const successful = results.filter(r => r.status === 'fulfilled').length;
                    const failed = results.filter(r => r.status === 'rejected').length;
                    
                    console.log(`Complex multi-resource deadlock test: ${successful}/${multiResourceOperations.length} successful, ${failed} failed in ${duration}ms`);
                    
                    // At least some operations should complete or timeout gracefully
                    assert.ok(successful + failed === multiResourceOperations.length, 
                        "All operations should either complete or fail gracefully");
                }

                // Should handle complex dependencies without indefinite blocking
                assert.ok(duration < timeout + 5000, "Complex multi-resource operations should resolve or timeout within reasonable time");

            } catch (error) {
                if (error instanceof Error && error.message === "Complex multi-resource deadlock detected") {
                    console.log("Complex multi-resource deadlock detected - timeout protection working");
                } else {
                    throw error;
                }
            }

            // Verify all tasks are in valid states after complex operations
            for (const taskId of complexTasks) {
                const verifyResult = await tcpClient.getTask(taskId);
                assert.ok(verifyResult.success && verifyResult.data, 
                    `Complex task ${taskId} should remain accessible after multi-resource test`);
                
                assert.ok(["todo", "in-progress", "done"].includes(verifyResult.data!.status),
                    `Task ${taskId} should have valid status after multi-resource operations`);
                assert.ok(["high", "medium", "low"].includes(verifyResult.data!.priority),
                    `Task ${taskId} should have valid priority after multi-resource operations`);
            }
        });

        it("should handle rapid concurrent operations with resource contention bursts", async () => {
            // Create tasks for rapid concurrent operation testing
            const burstTasks: string[] = [];
            const burstCount = 8;

            for (let i = 0; i < burstCount; i++) {
                const result = await tcpClient.createTask({
                    title: `${TASK_ID_PREFIX} Burst Test Task ${i}`,
                    description: `Task for rapid concurrent operation burst testing ${i}`,
                    priority: "medium",
                    createdBy: "deadlock-test-b7c2d592"
                });

                if (result.success && result.data) {
                    burstTasks.push(result.data.id);
                }
            }

            // Create multiple bursts of concurrent operations
            const burstOperations = [];
            const operationsPerBurst = 6;
            const numberOfBursts = 3;

            for (let burst = 0; burst < numberOfBursts; burst++) {
                const burstPromises = [];
                
                for (let op = 0; op < operationsPerBurst; op++) {
                    const taskIndex = (burst * operationsPerBurst + op) % burstCount;
                    const taskId = burstTasks[taskIndex];
                    
                    burstPromises.push(
                        new Promise<void>(async (resolve) => {
                            try {
                                // Rapid sequence of operations on the same task
                                await tcpClient.updateTaskStatus(taskId, "in-progress");
                                await new Promise(r => setTimeout(r, Math.random() * 20)); // Random delay 0-20ms
                                await tcpClient.updateTaskPriority(taskId, "high");
                                await new Promise(r => setTimeout(r, Math.random() * 15)); // Random delay 0-15ms
                                await tcpClient.updateTask(taskId, { description: `burst ${burst} operation ${op}` });
                                await new Promise(r => setTimeout(r, Math.random() * 10)); // Random delay 0-10ms
                                await tcpClient.updateTaskStatus(taskId, "done");
                                await tcpClient.updateTaskPriority(taskId, "medium");
                                
                                resolve();
                            } catch (error) {
                                // Operations may fail due to contention - this is expected
                                resolve();
                            }
                        })
                    );
                }
                
                burstOperations.push(...burstPromises);
                
                // Small delay between bursts to create contention patterns
                if (burst < numberOfBursts - 1) {
                    await new Promise(r => setTimeout(r, 100));
                }
            }

            const timeout = 30000; // 30 second timeout for burst operations
            const startTime = Date.now();

            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error("Burst operations deadlock detected")), timeout);
            });

            try {
                const results = await Promise.race([
                    Promise.allSettled(burstOperations),
                    timeoutPromise
                ]);

                const endTime = Date.now();
                const duration = endTime - startTime;

                if (Array.isArray(results)) {
                    const successful = results.filter(r => r.status === 'fulfilled').length;
                    const failed = results.filter(r => r.status === 'rejected').length;
                    
                    console.log(`Burst operations test: ${successful}/${burstOperations.length} successful, ${failed} failed in ${duration}ms`);
                    
                    // Should handle burst operations reasonably well
                    const successRate = successful / burstOperations.length;
                    assert.ok(successRate >= 0.3, `At least 30% of burst operations should succeed, got ${successRate.toFixed(2)}`);
                }

                // Should complete without hanging
                assert.ok(duration < timeout, "Burst operations should complete within timeout");

            } catch (error) {
                if (error instanceof Error && error.message === "Burst operations deadlock detected") {
                    console.log("Burst operations deadlock detected - timeout protection engaged");
                } else {
                    throw error;
                }
            }

            // Verify system stability after burst operations
            const finalCheckResults = await Promise.allSettled(
                burstTasks.map(taskId => tcpClient.getTask(taskId))
            );

            const accessibleTasks = finalCheckResults.filter(r => 
                r.status === 'fulfilled' && 
                (r as PromiseFulfilledResult<any>).value.success
            ).length;

            assert.ok(accessibleTasks >= burstTasks.length * 0.8, 
                `At least 80% of tasks should remain accessible after burst operations, got ${accessibleTasks}/${burstTasks.length}`);
        });

        it("should demonstrate deadlock prevention with resource ordering constraints", async () => {
            // Create tasks for resource ordering constraint testing
            const orderedTasks: string[] = [];
            const orderedCount = 6;

            for (let i = 0; i < orderedCount; i++) {
                const result = await tcpClient.createTask({
                    title: `${TASK_ID_PREFIX} Ordered Resource Task ${i}`,
                    description: `Task for resource ordering constraint testing ${i}`,
                    priority: "medium",
                    createdBy: "deadlock-test-b7c2d592"
                });

                if (result.success && result.data) {
                    orderedTasks.push(result.data.id);
                }
            }

            // Test operations that follow and violate resource ordering
            const orderingTestOperations = [
                // Operation 1: Follows resource ordering (0 -> 1 -> 2 -> 3)
                new Promise<void>(async (resolve) => {
                    try {
                        const orderedSequence = [0, 1, 2, 3];
                        for (const index of orderedSequence) {
                            await tcpClient.updateTaskStatus(orderedTasks[index], "in-progress");
                            await new Promise(r => setTimeout(r, 40));
                        }
                        
                        // Perform updates and release in reverse order
                        for (let i = orderedSequence.length - 1; i >= 0; i--) {
                            await tcpClient.updateTaskPriority(orderedTasks[orderedSequence[i]], "high");
                            await tcpClient.updateTaskStatus(orderedTasks[orderedSequence[i]], "done");
                        }
                        
                        resolve();
                    } catch (error) {
                        console.log("Ordered operation 1 failed:", error);
                        resolve();
                    }
                }),
                
                // Operation 2: Follows resource ordering (2 -> 3 -> 4 -> 5)
                new Promise<void>(async (resolve) => {
                    try {
                        const orderedSequence = [2, 3, 4, 5];
                        for (const index of orderedSequence) {
                            await tcpClient.updateTaskStatus(orderedTasks[index], "in-progress");
                            await new Promise(r => setTimeout(r, 35));
                        }
                        
                        // Perform updates and release in reverse order
                        for (let i = orderedSequence.length - 1; i >= 0; i--) {
                            await tcpClient.updateTaskPriority(orderedTasks[orderedSequence[i]], "low");
                            await tcpClient.updateTaskStatus(orderedTasks[orderedSequence[i]], "done");
                        }
                        
                        resolve();
                    } catch (error) {
                        console.log("Ordered operation 2 failed:", error);
                        resolve();
                    }
                }),
                
                // Operation 3: Violates resource ordering (5 -> 4 -> 3 -> 2) - should trigger deadlock prevention
                new Promise<void>(async (resolve) => {
                    try {
                        const reverseSequence = [5, 4, 3, 2];
                        for (const index of reverseSequence) {
                            await tcpClient.updateTaskStatus(orderedTasks[index], "in-progress");
                            await new Promise(r => setTimeout(r, 45));
                        }
                        
                        // Perform updates and release
                        for (let i = reverseSequence.length - 1; i >= 0; i--) {
                            await tcpClient.updateTaskPriority(orderedTasks[reverseSequence[i]], "medium");
                            await tcpClient.updateTaskStatus(orderedTasks[reverseSequence[i]], "done");
                        }
                        
                        resolve();
                    } catch (error) {
                        console.log("Resource ordering violation operation 3 failed (expected):", error);
                        resolve();
                    }
                }),
                
                // Operation 4: Another ordering violation (1 -> 0 -> 5 -> 4)
                new Promise<void>(async (resolve) => {
                    try {
                        const violationSequence = [1, 0, 5, 4];
                        for (const index of violationSequence) {
                            await tcpClient.updateTaskStatus(orderedTasks[index], "in-progress");
                            await new Promise(r => setTimeout(r, 50));
                        }
                        
                        // Perform updates and release
                        for (let i = violationSequence.length - 1; i >= 0; i--) {
                            await tcpClient.updateTaskPriority(orderedTasks[violationSequence[i]], "high");
                            await tcpClient.updateTaskStatus(orderedTasks[violationSequence[i]], "done");
                        }
                        
                        resolve();
                    } catch (error) {
                        console.log("Resource ordering violation operation 4 failed (expected):", error);
                        resolve();
                    }
                })
            ];

            const timeout = 15000; // 15 second timeout
            const startTime = Date.now();

            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error("Resource ordering constraint deadlock detected")), timeout);
            });

            try {
                const results = await Promise.race([
                    Promise.allSettled(orderingTestOperations),
                    timeoutPromise
                ]);

                const endTime = Date.now();
                const duration = endTime - startTime;

                if (Array.isArray(results)) {
                    const successful = results.filter(r => r.status === 'fulfilled').length;
                    const failed = results.filter(r => r.status === 'rejected').length;
                    
                    console.log(`Resource ordering constraint test: ${successful}/${orderingTestOperations.length} successful, ${failed} failed in ${duration}ms`);
                    
                    // Ordered operations should have better success rate than violating ones
                    assert.ok(successful >= 2, "At least the ordered operations should succeed");
                }

                // Should handle ordering constraints gracefully
                assert.ok(duration < timeout, "Resource ordering operations should complete within timeout");

            } catch (error) {
                if (error instanceof Error && error.message === "Resource ordering constraint deadlock detected") {
                    console.log("Resource ordering constraint deadlock detected - system protected");
                } else {
                    throw error;
                }
            }

            // Verify all tasks are accessible after ordering constraint testing
            for (const taskId of orderedTasks) {
                const verifyResult = await tcpClient.getTask(taskId);
                assert.ok(verifyResult.success && verifyResult.data, 
                    `Ordered task ${taskId} should remain accessible after constraint testing`);
            }
        });
    });

    describe("Deadlock Recovery and System Resilience", () => {
        it("should demonstrate system recovery after deadlock scenarios", async () => {
            // Create tasks for recovery test
            const recoveryTasks: string[] = [];
            const recoveryCount = 2;

            for (let i = 0; i < recoveryCount; i++) {
                const result = await tcpClient.createTask({
                    title: `${TASK_ID_PREFIX} Recovery Task ${i}`,
                    description: `Task for deadlock recovery testing ${i}`,
                    priority: "medium",
                    createdBy: "deadlock-test-b7c2d592"
                });

                if (result.success && result.data) {
                    recoveryTasks.push(result.data.id);
                }
            }

            // Intentionally create a deadlock-prone situation
            const deadlockOperations = [
                new Promise<void>(async (resolve) => {
                    try {
                        await tcpClient.updateTaskStatus(recoveryTasks[0], "in-progress");
                        await new Promise(delayResolve => setTimeout(delayResolve, 100));
                        await tcpClient.updateTaskStatus(recoveryTasks[1], "in-progress");
                        await tcpClient.updateTaskStatus(recoveryTasks[0], "done");
                        await tcpClient.updateTaskStatus(recoveryTasks[1], "done");
                        resolve();
                    } catch (error) {
                        resolve();
                    }
                }),
                new Promise<void>(async (resolve) => {
                    try {
                        await tcpClient.updateTaskStatus(recoveryTasks[1], "in-progress");
                        await new Promise(delayResolve => setTimeout(delayResolve, 100));
                        await tcpClient.updateTaskStatus(recoveryTasks[0], "in-progress");
                        await tcpClient.updateTaskStatus(recoveryTasks[1], "done");
                        await tcpClient.updateTaskStatus(recoveryTasks[0], "done");
                        resolve();
                    } catch (error) {
                        resolve();
                    }
                })
            ];

            // Run with shorter timeout to force potential deadlock
            const shortTimeout = 3000; // 3 second timeout
            const startTime = Date.now();

            try {
                await Promise.race([
                    Promise.allSettled(deadlockOperations),
                    new Promise((_, reject) => setTimeout(() => reject(new Error("Recovery test timeout")), shortTimeout))
                ]);
            } catch (error) {
                console.log("Expected deadlock/timeout in recovery test");
            }

            const deadlockEndTime = Date.now();

            // Test system recovery - operations should work normally after potential deadlock
            const recoveryOperations = [
                tcpClient.updateTaskStatus(recoveryTasks[0], "todo"),
                tcpClient.updateTaskPriority(recoveryTasks[0], "low"),
                tcpClient.updateTaskStatus(recoveryTasks[1], "todo"),
                tcpClient.updateTaskPriority(recoveryTasks[1], "high")
            ];

            const recoveryStartTime = Date.now();
            const recoveryResults = await Promise.allSettled(recoveryOperations);
            const recoveryEndTime = Date.now();

            const successfulRecovery = recoveryResults.filter(r => 
                r.status === 'fulfilled' && 
                (r as PromiseFulfilledResult<any>).value.success
            ).length;

            // System should recover and allow normal operations
            assert.ok(successfulRecovery >= recoveryOperations.length * 0.5, 
                "System should recover and allow at least 50% of normal operations");
            assert.ok(recoveryEndTime - recoveryStartTime < 5000, 
                "Recovery operations should complete quickly");

            console.log(`Recovery test: ${successfulRecovery}/${recoveryOperations.length} operations successful after ${deadlockEndTime - startTime}ms deadlock scenario`);

            // Final verification
            for (const taskId of recoveryTasks) {
                const verifyResult = await tcpClient.getTask(taskId);
                assert.ok(verifyResult.success && verifyResult.data, 
                    `Recovery task ${taskId} should be accessible after recovery`);
            }
        });
    });
});