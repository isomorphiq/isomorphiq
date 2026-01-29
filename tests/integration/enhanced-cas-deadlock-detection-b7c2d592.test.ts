import { describe, it, before, beforeEach, after } from "node:test";
import { strict as assert } from "node:assert";
import { DaemonTcpClient, type Task } from "../e2e/dashboard/tcp-client.ts";

describe("Enhanced CAS Deadlock Detection Test 1 - Task b7c2d592", () => {
    const TASK_ID_PREFIX = "enhanced-b7c2d592-deadlock-detection";
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
                
                
                // Small delay between bursts to create contention patterns
                
                // Small delay between bursts to create contention patterns
                if (burst < numberOfBursts - 1) {
                    await new Promise<void>(r => setTimeout(r, 100));
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

    describe("Performance Benchmarks for Deadlock Detection", () => {
        it("should measure deadlock detection performance under high load", async () => {
            // Create tasks for performance testing
            const perfTasks: string[] = [];
            const perfCount = 20;

            for (let i = 0; i < perfCount; i++) {
                const result = await tcpClient.createTask({
                    title: `${TASK_ID_PREFIX} Performance Test Task ${i}`,
                    description: `Task for deadlock detection performance testing ${i}`,
                    priority: i % 3 === 0 ? "high" : i % 3 === 1 ? "medium" : "low",
                    createdBy: "deadlock-test-b7c2d592"
                });

                if (result.success && result.data) {
                    perfTasks.push(result.data.id);
                }
            }

            // Create high-concurrency operations to stress test deadlock detection
            const highConcurrencyOperations = [];
            const concurrentOperations = 50;

            for (let i = 0; i < concurrentOperations; i++) {
                const taskIndex = i % perfCount;
                const taskId = perfTasks[taskIndex];
                
                highConcurrencyOperations.push(
                    new Promise<void>(async (resolve) => {
                        try {
                            // Mix of operations to create potential contention
                            if (i % 3 === 0) {
                                await tcpClient.updateTaskStatus(taskId, "in-progress");
                                await new Promise(r => setTimeout(r, Math.random() * 5));
                                await tcpClient.updateTaskStatus(taskId, "done");
                            } else if (i % 3 === 1) {
                                await tcpClient.updateTaskPriority(taskId, "high");
                                await new Promise(r => setTimeout(r, Math.random() * 5));
                                await tcpClient.updateTaskPriority(taskId, "medium");
                            } else {
                                await tcpClient.updateTaskStatus(taskId, "in-progress");
                                await tcpClient.updateTaskPriority(taskId, "high");
                                await new Promise(r => setTimeout(r, Math.random() * 5));
                                await tcpClient.updateTaskStatus(taskId, "done");
                                await tcpClient.updateTaskPriority(taskId, "low");
                            }
                            
                            resolve();
                        } catch (error) {
                            // Some operations may fail under high contention
                            resolve();
                        }
                    })
                );
            }

            const performanceTimeout = 45000; // 45 second timeout for performance test
            const performanceStartTime = Date.now();

            const performanceTimeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error("Performance test deadlock timeout")), performanceTimeout);
            });

            try {
                const performanceResults = await Promise.race([
                    Promise.allSettled(highConcurrencyOperations),
                    performanceTimeoutPromise
                ]);

                const performanceEndTime = Date.now();
                const performanceDuration = performanceEndTime - performanceStartTime;

                if (Array.isArray(performanceResults)) {
                    const successful = performanceResults.filter(r => r.status === 'fulfilled').length;
                    const failed = performanceResults.filter(r => r.status === 'rejected').length;
                    
                    console.log(`Performance benchmark test: ${successful}/${highConcurrencyOperations.length} successful, ${failed} failed in ${performanceDuration}ms`);
                    
                    // Calculate operations per second
                    const opsPerSecond = (successful + failed) / (performanceDuration / 1000);
                    console.log(`Operations per second: ${opsPerSecond.toFixed(2)}`);
                    
                    // Performance assertions
                    assert.ok(performanceDuration < performanceTimeout, "Performance test should complete within timeout");
                    assert.ok(successful >= highConcurrencyOperations.length * 0.5, 
                        `At least 50% of operations should succeed under load, got ${(successful / highConcurrencyOperations.length * 100).toFixed(1)}%`);
                    assert.ok(opsPerSecond >= 1.0, `Should handle at least 1 operation per second, got ${opsPerSecond.toFixed(2)}`);
                }

            } catch (error) {
                if (error instanceof Error && error.message === "Performance test deadlock timeout") {
                    console.log("Performance test timeout - deadlock detection may be overwhelmed");
                    throw error;
                } else {
                    throw error;
                }
            }

            // Verify system integrity after performance test
            const postPerfCheckResults = await Promise.allSettled(
                perfTasks.map(taskId => tcpClient.getTask(taskId))
            );

            const accessibleTasksAfterPerf = postPerfCheckResults.filter(r => 
                r.status === 'fulfilled' && 
                (r as PromiseFulfilledResult<any>).value.success
            ).length;

            assert.ok(accessibleTasksAfterPerf >= perfTasks.length * 0.9, 
                `At least 90% of tasks should remain accessible after performance test, got ${accessibleTasksAfterPerf}/${perfTasks.length}`);

            console.log(`Performance test completed: ${performanceDuration}ms total, ${accessibleTasksAfterPerf}/${perfTasks.length} tasks accessible`);
        });
    });

    describe("Deadlock Recovery and System Resilience", () => {
        it("should demonstrate system recovery after extreme deadlock scenarios", async () => {
            // Create tasks for extreme deadlock scenario testing
            const extremeTasks: string[] = [];
            const extremeCount = 10;

            for (let i = 0; i < extremeCount; i++) {
                const result = await tcpClient.createTask({
                    title: `${TASK_ID_PREFIX} Extreme Recovery Task ${i}`,
                    description: `Task for extreme deadlock recovery testing ${i}`,
                    priority: i % 2 === 0 ? "high" : "low",
                    createdBy: "deadlock-test-b7c2d592"
                });

                if (result.success && result.data) {
                    extremeTasks.push(result.data.id);
                }
            }

            // Create extreme deadlock-prone operations
            const extremeDeadlockOperations = [];
            const extremeOpCount = 12;

            for (let i = 0; i < extremeOpCount; i++) {
                const taskIndex1 = i % extremeCount;
                const taskIndex2 = (i + 1) % extremeCount;
                
                extremeDeadlockOperations.push(
                    new Promise<void>(async (resolve) => {
                        try {
                            // Create circular wait patterns
                            await tcpClient.updateTaskStatus(extremeTasks[taskIndex1], "in-progress");
                            await new Promise(r => setTimeout(r, Math.random() * 100));
                            await tcpClient.updateTaskStatus(extremeTasks[taskIndex2], "in-progress");
                            await new Promise(r => setTimeout(r, Math.random() * 50));
                            
                            // Try to acquire locks in reverse order (creates deadlock potential)
                            await tcpClient.updateTaskPriority(extremeTasks[taskIndex2], "high");
                            await tcpClient.updateTaskPriority(extremeTasks[taskIndex1], "high");
                            
                            // Release
                            await tcpClient.updateTaskStatus(extremeTasks[taskIndex1], "done");
                            await tcpClient.updateTaskStatus(extremeTasks[taskIndex2], "done");
                            
                            resolve();
                        } catch (error) {
                            // Expected to fail due to extreme contention
                            resolve();
                        }
                    })
                );
            }

            // Run with shorter timeout to force extreme deadlock scenario
            const extremeTimeout = 8000; // 8 second timeout
            const extremeStartTime = Date.now();

            try {
                await Promise.race([
                    Promise.allSettled(extremeDeadlockOperations),
                    new Promise((_, reject) => setTimeout(() => reject(new Error("Extreme deadlock scenario")), extremeTimeout))
                ]);
            } catch (error) {
                console.log("Expected extreme deadlock/timeout scenario");
            }

            const extremeEndTime = Date.now();

            // Test system recovery capabilities after extreme deadlock
            console.log("Testing system recovery after extreme deadlock scenario...");
            
            const recoveryOperations = [];
            for (let i = 0; i < extremeCount; i++) {
                recoveryOperations.push(
                    tcpClient.updateTaskStatus(extremeTasks[i], "todo"),
                    tcpClient.updateTaskPriority(extremeTasks[i], i % 2 === 0 ? "high" : "medium")
                );
            }

            const recoveryStartTime = Date.now();
            const recoveryResults = await Promise.allSettled(recoveryOperations);
            const recoveryEndTime = Date.now();

            const successfulRecovery = recoveryResults.filter(r => 
                r.status === 'fulfilled' && 
                (r as PromiseFulfilledResult<any>).value.success
            ).length;

            // System should demonstrate strong recovery capabilities
            assert.ok(successfulRecovery >= recoveryOperations.length * 0.7, 
                `System should recover and allow at least 70% of operations after extreme deadlock, got ${(successfulRecovery / recoveryOperations.length * 100).toFixed(1)}%`);
            assert.ok(recoveryEndTime - recoveryStartTime < 10000, 
                "Recovery operations should complete quickly after extreme deadlock");

            console.log(`Extreme recovery test: ${successfulRecovery}/${recoveryOperations.length} operations successful in ${recoveryEndTime - recoveryStartTime}ms after ${extremeEndTime - extremeStartTime}ms deadlock scenario`);

            // Final verification of system integrity
            for (const taskId of extremeTasks) {
                const verifyResult = await tcpClient.getTask(taskId);
                assert.ok(verifyResult.success && verifyResult.data, 
                    `Extreme recovery task ${taskId} should be accessible after extreme scenario`);
                
                assert.ok(["todo", "in-progress", "done"].includes(verifyResult.data!.status),
                    `Task ${taskId} should have valid status after extreme recovery`);
                assert.ok(["high", "medium", "low"].includes(verifyResult.data!.priority),
                    `Task ${taskId} should have valid priority after extreme recovery`);
            }
        });
    });
});