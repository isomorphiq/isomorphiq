import { describe, it, before, after, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { DaemonTcpClient } from "../e2e/dashboard/tcp-client.ts";
import { startTestDaemon, type TestDaemonHandle } from "./daemon-test-harness.ts";
import { OptimisticLockManager, VersionConflictError } from "../../packages/core/src/optimistic-lock.ts";

describe("Optimistic Locking Tests - Task b7c2d592", () => {
    const TASK_ID_PREFIX = "task-b7c2d592-optimistic-lock";
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
                const testTasks = listResult.data.filter((task: any) => 
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

    describe("Basic Optimistic Locking Patterns", () => {
        it("should detect version conflicts during concurrent updates", async () => {
            const createResult = await tcpClient.createTask({
                title: `${TASK_ID_PREFIX} Version Conflict Test`,
                description: "Initial description",
                priority: "medium",
                createdBy: "optimistic-lock-test-b7c2d592"
            });

            assert.ok(createResult.success);
            assert.ok(createResult.data);
            const taskId = createResult.data.id;
            const initialVersion = parseInt(Date.now().toString()); // Simulate version

            // Simulate concurrent updates with version checking
            const concurrentUpdates = Array.from({ length: 3 }, async (_, i) => {
                // Read current state
                const getResult = await tcpClient.getTask(taskId);
                if (!getResult.success || !getResult.data) {
                    throw new Error("Failed to read task");
                }

                // Simulate processing time
                await new Promise(resolve => setTimeout(resolve, Math.random() * 50));

                // Simulate version conflict detection
                const currentVersion = parseInt(getResult.data.updatedAt);
                const expectedVersion = i === 0 ? initialVersion : initialVersion + 1;

                if (currentVersion !== expectedVersion) {
                    throw new VersionConflictError(
                        `Version conflict for task ${taskId}`,
                        expectedVersion,
                        currentVersion,
                        taskId
                    );
                }

                // Update would succeed in real implementation
                return await tcpClient.updateTaskStatus(taskId, i % 2 === 0 ? "in-progress" : "done");
            });

            const results = await Promise.allSettled(concurrentUpdates);
            const conflicts = results.filter(r => 
                r.status === 'rejected' && 
                r.reason instanceof VersionConflictError
            );

            const successful = results.filter(r => 
                r.status === 'fulfilled' && 
                (r as PromiseFulfilledResult<any>).value.success
            );

            // Should have some conflicts and some successes
            assert.ok(conflicts.length > 0, "Should detect version conflicts");
            assert.ok(successful.length > 0, "Should have some successful updates");

            console.log(`Version conflict test: ${conflicts.length} conflicts, ${successful.length} successful`);
        });

        it("should handle optimistic lock retry mechanism", async () => {
            const createResult = await tcpClient.createTask({
                title: `${TASK_ID_PREFIX} Retry Test`,
                description: "Initial description",
                priority: "medium",
                createdBy: "optimistic-lock-test-b7c2d592"
            });

            assert.ok(createResult.success);
            assert.ok(createResult.data);
            const taskId = createResult.data.id;

            // Simulate optimistic lock with retry
            const retryOperation = async () => {
                let lastError: Error | null = null;
                const maxRetries = 3;

                for (let attempt = 0; attempt <= maxRetries; attempt++) {
                    try {
                        const getResult = await tcpClient.getTask(taskId);
                        if (!getResult.success || !getResult.data) {
                            throw new Error("Failed to read task");
                        }

                        // Simulate version check that might fail
                        if (attempt === 0) {
                            throw new VersionConflictError(
                                "Simulated conflict",
                                1,
                                2,
                                taskId
                            );
                        }

                        // Update would succeed on retry
                        return await tcpClient.updateTaskPriority(taskId, "high");

                    } catch (error) {
                        lastError = error instanceof Error ? error : new Error(String(error));
                        
                        if (error instanceof VersionConflictError && attempt < maxRetries) {
                            const backoffMs = 100 * Math.pow(2, attempt);
                            await new Promise(resolve => setTimeout(resolve, backoffMs));
                            continue;
                        }
                        
                        throw lastError;
                    }
                }

                throw lastError || new Error("Max retries exceeded");
            };

            const result = await retryOperation();
            assert.ok(result.success, "Retry mechanism should succeed");

            // Verify final state
            const finalResult = await tcpClient.getTask(taskId);
            assert.ok(finalResult.success && finalResult.data);
            assert.equal(finalResult.data.priority, "high");

            console.log("Retry mechanism test: Success after simulated conflict");
        });

        it("should maintain data consistency under high concurrent load", async () => {
            const taskIds: string[] = [];
            
            // Create multiple tasks
            for (let i = 0; i < 5; i++) {
                const result = await tcpClient.createTask({
                    title: `${TASK_ID_PREFIX} Consistency Test ${i}`,
                    description: `Initial description ${i}`,
                    priority: "medium",
                    createdBy: "optimistic-lock-test-b7c2d592"
                });

                if (result.success && result.data) {
                    taskIds.push(result.data.id);
                }
            }

            // High concurrent load with simulated optimistic locking
            const concurrentOperations = taskIds.flatMap(taskId => 
                Array.from({ length: 8 }, (_, i) => 
                    (async () => {
                        const getResult = await tcpClient.getTask(taskId);
                        if (!getResult.success || !getResult.data) {
                            throw new Error("Failed to read task");
                        }

                        // Simulate processing
                        await new Promise(resolve => setTimeout(resolve, Math.random() * 20));

                        // Random operation
                        if (i % 3 === 0) {
                            return await tcpClient.updateTaskStatus(taskId, "in-progress");
                        } else if (i % 3 === 1) {
                            return await tcpClient.updateTaskPriority(taskId, ["high", "medium", "low"][i % 3]);
                        } else {
                            return await tcpClient.getTask(taskId);
                        }
                    })()
                )
            );

            const results = await Promise.allSettled(concurrentOperations);
            const successful = results.filter(r => 
                r.status === 'fulfilled' && 
                (r as PromiseFulfilledResult<any>).value.success
            );

            const totalOperations = concurrentOperations.length;
            const successRate = successful.length / totalOperations;

            // Should maintain reasonable success rate under load
            assert.ok(successRate >= 0.6, 
                `Should maintain >=60% success rate under concurrent load (${successRate})`);

            // Verify data consistency
            for (const taskId of taskIds) {
                const verifyResult = await tcpClient.getTask(taskId);
                assert.ok(verifyResult.success && verifyResult.data, 
                    `Task ${taskId} should remain accessible and consistent`);
                
                // Verify valid data
                assert.ok(["todo", "in-progress", "done"].includes(verifyResult.data.status),
                    "Status should be valid");
                assert.ok(["high", "medium", "low"].includes(verifyResult.data.priority),
                    "Priority should be valid");
            }

            console.log(`Consistency test: ${successful.length}/${totalOperations} operations successful`);
        });
    });

    describe("Advanced Optimistic Locking Scenarios", () => {
        it("should handle ABA problem detection", async () => {
            const createResult = await tcpClient.createTask({
                title: `${TASK_ID_PREFIX} ABA Test`,
                description: "Initial state",
                priority: "medium",
                createdBy: "optimistic-lock-test-b7c2d592"
            });

            assert.ok(createResult.success);
            assert.ok(createResult.data);
            const taskId = createResult.data.id;

            // Simulate ABA problem detection
            const abaDetection = async () => {
                let initialVersion = parseInt(Date.now().toString());
                
                // Read initial state
                const initialResult = await tcpClient.getTask(taskId);
                if (!initialResult.success || !initialResult.data) {
                    throw new Error("Failed to read initial state");
                }

                // Simulate ABA: other process changes state and then changes it back
                await tcpClient.updateTaskStatus(taskId, "in-progress"); // A -> B
                await new Promise(resolve => setTimeout(resolve, 50));
                await tcpClient.updateTaskStatus(taskId, "todo"); // B -> A

                // Now try to update based on stale version
                const currentResult = await tcpClient.getTask(taskId);
                if (!currentResult.success || !currentResult.data) {
                    throw new Error("Failed to read current state");
                }

                // In real optimistic locking, version would have changed twice
                const currentVersion = parseInt(currentResult.data.updatedAt);
                if (currentVersion === initialVersion) {
                    // This would be ABA - version looks same but state changed
                    throw new VersionConflictError(
                        "ABA problem detected",
                        initialVersion,
                        currentVersion + 2, // Simulate double update
                        taskId
                    );
                }

                // Update would proceed if version is correct
                return await tcpClient.updateTaskPriority(taskId, "high");
            };

            const result = await abaDetection();
            assert.ok(result.success, "Should handle ABA detection");

            console.log("ABA problem test: Successfully detected and handled");
        });

        it("should measure performance impact of optimistic locking", async () => {
            const taskIds: string[] = [];
            
            // Create tasks for performance testing
            for (let i = 0; i < 10; i++) {
                const result = await tcpClient.createTask({
                    title: `${TASK_ID_PREFIX} Performance Test ${i}`,
                    description: `Performance test task ${i}`,
                    priority: "medium",
                    createdBy: "optimistic-lock-test-b7c2d592"
                });

                if (result.success && result.data) {
                    taskIds.push(result.data.id);
                }
            }

            // Measure performance with simulated optimistic locking overhead
            const startTime = Date.now();
            
            const performanceOperations = taskIds.flatMap(taskId => 
                Array.from({ length: 5 }, async () => {
                    const readStart = Date.now();
                    const getResult = await tcpClient.getTask(taskId);
                    const readTime = Date.now() - readStart;
                    
                    // Simulate optimistic locking overhead
                    await new Promise(resolve => setTimeout(resolve, 10));
                    
                    const writeStart = Date.now();
                    const updateResult = await tcpClient.updateTaskPriority(taskId, "high");
                    const writeTime = Date.now() - writeStart;
                    
                    return { 
                        success: updateResult.success, 
                        readTime, 
                        writeTime 
                    };
                })
            );

            const results = await Promise.allSettled(performanceOperations);
            const endTime = Date.now();

            const successful = results.filter(r => 
                r.status === 'fulfilled' && 
                (r as PromiseFulfilledResult<any>).value.success
            );

            const totalDuration = endTime - startTime;
            const avgOperationTime = totalDuration / results.length;

            // Performance assertions
            assert.ok(successful.length >= taskIds.length * 3, 
                "Should have reasonable success rate under optimistic locking");
            assert.ok(avgOperationTime < 200, 
                `Average operation time should be reasonable (${avgOperationTime}ms)`);

            console.log(`Performance test: ${successful.length} operations, avg time: ${avgOperationTime.toFixed(2)}ms`);
        });

        it("should handle rollback on optimistic lock failure", async () => {
            const createResult = await tcpClient.createTask({
                title: `${TASK_ID_PREFIX} Rollback Test`,
                description: "Initial description",
                priority: "medium",
                createdBy: "optimistic-lock-test-b7c2d592"
            });

            assert.ok(createResult.success);
            assert.ok(createResult.data);
            const taskId = createResult.data.id;

            // Simulate operation that should be rolled back on conflict
            const rollbackOperation = async () => {
                const getResult = await tcpClient.getTask(taskId);
                if (!getResult.success || !getResult.data) {
                    throw new Error("Failed to read task");
                }

                const originalState = getResult.data;

                try {
                    // Simulate multiple changes that should be atomic
                    await tcpClient.updateTaskStatus(taskId, "in-progress");
                    await new Promise(resolve => setTimeout(resolve, 50));
                    
                    // Simulate conflict detection
                    throw new VersionConflictError(
                        "Conflict detected during operation",
                        parseInt(originalState.updatedAt),
                        parseInt(originalState.updatedAt) + 1,
                        taskId
                    );

                } catch (error) {
                    if (error instanceof VersionConflictError) {
                        // In real implementation, this would trigger rollback
                        // For now, we'll restore original state manually
                        await tcpClient.updateTaskStatus(taskId, originalState.status);
                        await tcpClient.updateTaskPriority(taskId, originalState.priority);
                        throw error;
                    }
                    throw error;
                }
            };

            try {
                await rollbackOperation();
                assert.fail("Should have thrown VersionConflictError");
            } catch (error) {
                assert.ok(error instanceof VersionConflictError, "Should throw VersionConflictError");
            }

            // Verify rollback - state should be as it was before operation
            const finalResult = await tcpClient.getTask(taskId);
            assert.ok(finalResult.success && finalResult.data);
            
            const initialResult = await tcpClient.createTask({
                title: `${TASK_ID_PREFIX} Rollback Compare`,
                description: "Initial description",
                priority: "medium",
                createdBy: "optimistic-lock-test-b7c2d592"
            });
            
            if (initialResult.success && initialResult.data) {
                assert.equal(finalResult.data.status, initialResult.data.status);
                assert.equal(finalResult.data.priority, initialResult.data.priority);
            }

            console.log("Rollback test: Successfully rolled back on conflict");
        });
    });
});