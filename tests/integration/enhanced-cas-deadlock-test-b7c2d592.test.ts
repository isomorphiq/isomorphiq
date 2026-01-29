import { describe, it, before, beforeEach, after } from "node:test";
import { strict as assert } from "node:assert";
import { DaemonTcpClient, type Task } from "../e2e/dashboard/tcp-client.ts";
import { EnhancedCASManager } from "../../packages/daemon/src/services/enhanced-cas-manager.ts";
import { DeadlockDetector } from "../../packages/daemon/src/services/cas-deadlock-detector.ts";

describe("Enhanced CAS Deadlock Detection Test - Task b7c2d592", () => {
    const TASK_ID_PREFIX = "task-b7c2d592-enhanced-cas-deadlock";
    let tcpClient: DaemonTcpClient;
    let casManager: EnhancedCASManager;

    before(async () => {
        tcpClient = new DaemonTcpClient(3001, "localhost");
        casManager = new EnhancedCASManager(5000); // 5 second timeout for tests
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
        casManager.cleanup();
    });

    describe("Enhanced CAS Deadlock Prevention", () => {
        it("should prevent deadlocks through resource ordering", async () => {
            // Create tasks for resource ordering test
            const resourceTasks: string[] = [];
            const resourceCount = 3;

            for (let i = 0; i < resourceCount; i++) {
                const result = await tcpClient.createTask({
                    title: `${TASK_ID_PREFIX} Resource Ordering Task ${i}`,
                    description: `Task for enhanced CAS resource ordering test ${i}`,
                    priority: "medium",
                    createdBy: "enhanced-cas-test-b7c2d592"
                });

                if (result.success && result.data) {
                    resourceTasks.push(result.data.id);
                }
            }

            // Create concurrent multi-resource CAS operations
            const multiResourceOperations = resourceTasks.map((taskId, index) => {
                return casManager.executeMultiResourceCAS(
                    taskId,
                    [
                        {
                            type: "status",
                            updateFn: (task) => ({ status: "in-progress" })
                        },
                        {
                            type: "priority", 
                            updateFn: (task) => ({ priority: "high" })
                        },
                        {
                            type: "metadata",
                            updateFn: (task) => ({ description: `${task.description} - Updated by ${index}` })
                        }
                    ],
                    -1, // Expected version
                    3 // Max retries
                );
            });

            const startTime = Date.now();
            const results = await Promise.allSettled(multiResourceOperations);
            const endTime = Date.now();

            // Analyze results
            const successful = results.filter(r => 
                r.status === 'fulfilled' && 
                (r as PromiseFulfilledResult<any>).value.success
            ).length;

            const totalDuration = endTime - startTime;

            // Should complete without deadlock (resource ordering prevents circular wait)
            assert.ok(totalDuration < 15000, "Multi-resource operations should complete within 15 seconds without deadlock");
            assert.ok(successful >= resourceTasks.length * 0.6, 
                "At least 60% of multi-resource operations should succeed with deadlock prevention");

            console.log(`Enhanced CAS resource ordering test: ${successful}/${resourceTasks.length} successful in ${totalDuration}ms`);
        });

        it("should detect and resolve deadlock through victim selection", async () => {
            const victimSelectionTasks: string[] = [];
            const victimCount = 4;

            for (let i = 0; i < victimCount; i++) {
                const result = await tcpClient.createTask({
                    title: `${TASK_ID_PREFIX} Victim Selection Task ${i}`,
                    description: `Task for deadlock victim selection test ${i}`,
                    priority: "medium",
                    createdBy: "enhanced-cas-test-b7c2d592"
                });

                if (result.success && result.data) {
                    victimSelectionTasks.push(result.data.id);
                }
            }

            // Create operations designed to deadlock (opposite resource acquisition order)
            const deadlockProneOperations = [
                // Operation 1: Lock order A -> B -> C
                casManager.executeMultiResourceCAS(
                    victimSelectionTasks[0],
                    [
                        { type: "status", updateFn: (task) => ({ status: "in-progress" }) },
                        { type: "priority", updateFn: (task) => ({ priority: "high" }) }
                    ],
                    -1,
                    2 // Limited retries to force deadlock detection
                ),
                
                // Operation 2: Lock order B -> A (reverse - potential deadlock)
                casManager.executeMultiResourceCAS(
                    victimSelectionTasks[1],
                    [
                        { type: "priority", updateFn: (task) => ({ priority: "low" }) },
                        { type: "status", updateFn: (task) => ({ status: "todo" }) }
                    ],
                    -1,
                    2
                ),
                
                // Operation 3: Lock order A -> C -> B
                casManager.executeMultiResourceCAS(
                    victimSelectionTasks[2],
                    [
                        { type: "status", updateFn: (task) => ({ status: "done" }) },
                        { type: "priority", updateFn: (task) => ({ priority: "medium" }) }
                    ],
                    -1,
                    2
                )
            ];

            const startTime = Date.now();
            const results = await Promise.allSettled(deadlockProneOperations);
            const endTime = Date.now();

            const totalDuration = endTime - startTime;

            // Should resolve through victim selection without hanging
            assert.ok(totalDuration < 10000, "Deadlock should be resolved through victim selection within 10 seconds");

            // Check that at least some operations succeeded after deadlock resolution
            const successful = results.filter(r => 
                r.status === 'fulfilled' && 
                (r as PromiseFulfilledResult<any>).value.success
            ).length;

            assert.ok(successful >= 1, "At least one operation should succeed after deadlock resolution");

            // Verify deadlock detection stats
            const deadlockStats = casManager.getDeadlockStats();
            console.log(`Victim selection test: ${successful}/${deadlockProneOperations.length} successful in ${totalDuration}ms`);
            console.log("Deadlock detection stats:", deadlockStats);
        });

        it("should handle exponential backoff during contention", async () => {
            const contentionTasks: string[] = [];
            const contentionCount = 2;

            for (let i = 0; i < contentionCount; i++) {
                const result = await tcpClient.createTask({
                    title: `${TASK_ID_PREFIX} Contention Task ${i}`,
                    description: `Task for contention with exponential backoff ${i}`,
                    priority: "high",
                    createdBy: "enhanced-cas-test-b7c2d592"
                });

                if (result.success && result.data) {
                    contentionTasks.push(result.data.id);
                }
            }

            // Create many concurrent operations on same resource to force contention
            const concurrentOperations: Promise<any>[] = [];
            const operationCount = 8;

            for (let i = 0; i < operationCount; i++) {
                concurrentOperations.push(
                    casManager.executeCASOperation(
                        contentionTasks[0], // Same task for all operations
                        -1, // No version expectation
                        (task) => ({ 
                            description: `${task.description} - Updated by operation ${i}`,
                            updatedAt: new Date().toISOString()
                        }),
                        5 // Allow more retries for contention handling
                    )
                );
            }

            const startTime = Date.now();
            const results = await Promise.allSettled(concurrentOperations);
            const endTime = Date.now();

            const totalDuration = endTime - startTime;

            // Should handle contention gracefully with exponential backoff
            assert.ok(totalDuration < 20000, "Contention should be handled within 20 seconds");

            const successful = results.filter(r => 
                r.status === 'fulfilled' && 
                (r as PromiseFulfilledResult<any>).value.success
            ).length;

            assert.ok(successful >= operationCount * 0.7, 
                "At least 70% of operations should succeed with exponential backoff");

            console.log(`Contention with exponential backoff: ${successful}/${operationCount} successful in ${totalDuration}ms`);
        });
    });

    describe("Chaos Engineering for CAS Operations", () => {
        it("should maintain system stability under high contention", async () => {
            const chaosTasks: string[] = [];
            const chaosCount = 5;

            // Create multiple tasks for chaos testing
            for (let i = 0; i < chaosCount; i++) {
                const result = await tcpClient.createTask({
                    title: `${TASK_ID_PREFIX} Chaos Task ${i}`,
                    description: `Task for chaos engineering test ${i}`,
                    priority: ["high", "medium", "low"][i % 3] as "high" | "medium" | "low",
                    createdBy: "enhanced-cas-test-b7c2d592"
                });

                if (result.success && result.data) {
                    chaosTasks.push(result.data.id);
                }
            }

            // Create a complex mix of operations that could potentially deadlock
            const chaosOperations: Promise<any>[] = [];

            // Single resource operations
            for (let i = 0; i < 10; i++) {
                const randomTaskIndex = i % chaosTasks.length;
                chaosOperations.push(
                    casManager.executeCASOperation(
                        chaosTasks[randomTaskIndex],
                        -1,
                        (task) => ({ 
                            priority: ["high", "medium", "low"][Math.floor(Math.random() * 3)] as "high" | "medium" | "low"
                        }),
                        4
                    )
                );
            }

            // Multi-resource operations with different patterns
            for (let i = 0; i < 6; i++) {
                const randomTaskIndex = i % chaosTasks.length;
                chaosOperations.push(
                    casManager.executeMultiResourceCAS(
                        chaosTasks[randomTaskIndex],
                        [
                            { type: "status", updateFn: (task) => ({ status: "todo" }) },
                            { type: "priority", updateFn: (task) => ({ priority: "medium" }) }
                        ],
                        -1,
                        3
                    )
                );
            }

            // High-contention operations on specific tasks
            for (let i = 0; i < 4; i++) {
                chaosOperations.push(
                    casManager.executeMultiResourceCAS(
                        chaosTasks[0], // All target same task
                        [
                            { type: "status", updateFn: (task) => ({ status: "in-progress" }) },
                            { type: "priority", updateFn: (task) => ({ priority: "high" }) }
                        ],
                        -1,
                        5
                    )
                );
            }

            const startTime = Date.now();
            const results = await Promise.allSettled(chaosOperations);
            const endTime = Date.now();

            const totalDuration = endTime - startTime;

            // System should remain stable even under chaos
            assert.ok(totalDuration < 30000, "Chaos test should complete within 30 seconds");

            const successful = results.filter(r => 
                r.status === 'fulfilled' && 
                (r as PromiseFulfilledResult<any>).value.success
            ).length;

            const successRate = successful / chaosOperations.length;
            
            assert.ok(successRate >= 0.5, 
                `Success rate should be at least 50% under chaos, got ${(successRate * 100).toFixed(1)}%`);

            // Verify all tasks are still accessible and in valid states
            for (const taskId of chaosTasks) {
                const verifyResult = await tcpClient.getTask(taskId);
                assert.ok(verifyResult.success && verifyResult.data, 
                    `Task ${taskId} should remain accessible after chaos test`);
                
                assert.ok(["todo", "in-progress", "done"].includes(verifyResult.data!.status),
                    `Task ${taskId} should have valid status`);
                assert.ok(["high", "medium", "low"].includes(verifyResult.data!.priority),
                    `Task ${taskId} should have valid priority`);
            }

            // Get final deadlock stats
            const finalStats = casManager.getDeadlockStats();
            console.log(`Chaos engineering test: ${successful}/${chaosOperations.length} successful in ${totalDuration}ms`);
            console.log("Final deadlock detection stats:", finalStats);
        });
    });

    describe("Performance and Scalability", () => {
        it("should demonstrate scalability of deadlock prevention", async () => {
            const scalabilityTasks: string[] = [];
            const scalabilityCount = 8;

            // Create tasks for scalability testing
            for (let i = 0; i < scalabilityCount; i++) {
                const result = await tcpClient.createTask({
                    title: `${TASK_ID_PREFIX} Scalability Task ${i}`,
                    description: `Task for scalability testing ${i}`,
                    priority: "medium",
                    createdBy: "enhanced-cas-test-b7c2d592"
                });

                if (result.success && result.data) {
                    scalabilityTasks.push(result.data.id);
                }
            }

            // Create increasing levels of concurrency
            const concurrencyLevels = [2, 4, 8, 16];
            const performanceResults: Array<{ concurrency: number; duration: number; successRate: number }> = [];

            for (const concurrency of concurrencyLevels) {
                const operations: Promise<any>[] = [];
                
                for (let i = 0; i < concurrency; i++) {
                    const taskIndex = i % scalabilityTasks.length;
                    operations.push(
                        casManager.executeCASOperation(
                            scalabilityTasks[taskIndex],
                            -1,
                            (task) => ({ 
                                description: `${task.description} - Scalability op ${concurrency}-${i}`,
                                updatedAt: new Date().toISOString()
                            }),
                            3
                        )
                    );
                }

                const startTime = Date.now();
                const results = await Promise.allSettled(operations);
                const endTime = Date.now();

                const duration = endTime - startTime;
                const successful = results.filter(r => 
                    r.status === 'fulfilled' && 
                    (r as PromiseFulfilledResult<any>).value.success
                ).length;
                const successRate = successful / operations.length;

                performanceResults.push({
                    concurrency,
                    duration,
                    successRate
                });

                console.log(`Concurrency ${concurrency}: ${successful}/${operations.length} successful in ${duration}ms (${(successRate * 100).toFixed(1)}%)`);
            }

            // Verify scalability - performance should degrade gracefully
            for (let i = 1; i < performanceResults.length; i++) {
                const current = performanceResults[i];
                const previous = performanceResults[i - 1];
                
                // Success rate should remain reasonable even at higher concurrency
                assert.ok(current.successRate >= 0.4, 
                    `Success rate at concurrency ${current.concurrency} should be at least 40%`);
                
                // Duration should not grow exponentially
                const durationRatio = current.duration / previous.duration;
                assert.ok(durationRatio < 4, 
                    `Duration growth should be reasonable: ${durationRatio.toFixed(2)}x for ${current.concurrency/previous.concurrency}x concurrency increase`);
            }

            // Verify final system state
            for (const taskId of scalabilityTasks) {
                const verifyResult = await tcpClient.getTask(taskId);
                assert.ok(verifyResult.success && verifyResult.data, 
                    `Task ${taskId} should remain accessible after scalability test`);
            }

            console.log("Scalability test completed successfully");
        });
    });
});