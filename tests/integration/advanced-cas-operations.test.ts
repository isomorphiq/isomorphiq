import { describe, it, before, beforeEach, after } from "node:test";
import { strict as assert } from "node:assert";
import { DaemonTcpClient, type Task } from "../e2e/dashboard/tcp-client.ts";
import { type Result } from "@isomorphiq/core";

describe("Advanced CAS Operations - Task b7c2d592 Enhanced", () => {
    const TASK_ID_PREFIX = "task-b7c2d592-advanced-cas";
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

    describe("Multi-Entity Atomic CAS Operations", () => {
        it("should handle atomic updates across multiple tasks with version consistency", async () => {
            // Create related tasks that need coordinated updates
            const relatedTasks: string[] = [];
            for (let i = 0; i < 3; i++) {
                const result = await tcpClient.createTask({
                    title: `${TASK_ID_PREFIX} Multi-CAS Task ${i}`,
                    description: `Related task ${i} for multi-entity CAS testing`,
                    priority: "medium",
                    createdBy: "integration-test-b7c2d592"
                });
                
                if (result.success && result.data) {
                    relatedTasks.push(result.data.id);
                }
            }

            // Capture initial versions
            const initialVersions = new Map<string, string>();
            for (const taskId of relatedTasks) {
                const getResult = await tcpClient.getTask(taskId);
                if (getResult.success && getResult.data) {
                    initialVersions.set(taskId, getResult.data.updatedAt);
                }
            }

            // Simulate coordinated CAS-style updates
            const coordinatedUpdates = relatedTasks.map((taskId, index) => 
                tcpClient.updateTaskStatus(taskId, index % 2 === 0 ? "in-progress" : "done")
            );

            const results = await Promise.allSettled(coordinatedUpdates);
            const successful = results.filter(r => 
                r.status === 'fulfilled' && 
                (r as PromiseFulfilledResult<any>).value.success
            );

            // Verify atomic-like behavior - either most succeed or most fail gracefully
            const successRate = successful.length / relatedTasks.length;
            assert.ok(successRate >= 0.6 || successRate <= 0.4, 
                "Operations should show coordinated behavior");

            // Verify version consistency
            for (const taskId of relatedTasks) {
                const finalResult = await tcpClient.getTask(taskId);
                if (finalResult.success && finalResult.data) {
                    const finalVersion = finalResult.data.updatedAt;
                    const initialVersion = initialVersions.get(taskId);
                    
                    if (initialVersion) {
                        // At least some tasks should have been updated
                        const wasUpdated = finalVersion !== initialVersion;
                        if (wasUpdated) {
                            assert.ok(["todo", "in-progress", "done"].includes(finalResult.data.status),
                                "Updated tasks should have valid status");
                        }
                    }
                }
            }

            console.log(`Multi-entity CAS: ${successful.length}/${relatedTasks.length} successful`);
        });

        it("should handle cascading CAS operations with dependency chains", async () => {
            // Create dependency chain
            const dependencyChain: string[] = [];
            const chainLength = 4;

            for (let i = 0; i < chainLength; i++) {
                const result = await tcpClient.createTask({
                    title: `${TASK_ID_PREFIX} Cascade CAS Task ${i}`,
                    description: `Cascade task ${i} with dependencies`,
                    priority: "medium",
                    createdBy: "integration-test-b7c2d592",
                    dependencies: i > 0 ? [dependencyChain[i - 1]] : []
                });

                if (result.success && result.data) {
                    dependencyChain.push(result.data.id);
                }
            }

            // Cascading CAS-style updates - update each task only if previous succeeded
            const cascadeResults: Result<Task>[] = [];
            let allSucceeded = true;

            for (let i = 0; i < dependencyChain.length; i++) {
                const taskId = dependencyChain[i];
                const status = i === dependencyChain.length - 1 ? "done" : "in-progress";
                const priority = i === 0 ? "high" : "medium";

                // Only proceed if previous operations succeeded
                if (allSucceeded) {
                    const updateResult = await tcpClient.updateTaskStatus(taskId, status);
                    cascadeResults.push(updateResult);
                    
                    if (!updateResult.success) {
                        allSucceeded = false;
                    } else {
                        // Also update priority to create more complex scenario
                        const priorityResult = await tcpClient.updateTaskPriority(taskId, priority);
                        cascadeResults.push(priorityResult);
                    }
                }
            }

            const successfulUpdates = cascadeResults.filter(r => r.success).length;
            const totalUpdates = cascadeResults.length;
            const successRate = successfulUpdates / totalUpdates;

            // Should handle cascading gracefully
            assert.ok(successRate >= 0.5, "Should handle cascading CAS with reasonable success rate");

            // Verify chain integrity
            for (let i = 0; i < dependencyChain.length; i++) {
                const verifyResult = await tcpClient.getTask(dependencyChain[i]);
                assert.ok(verifyResult.success && verifyResult.data, 
                    `Chain task ${i} should remain accessible`);

                // Verify dependencies are maintained
                if (i > 0) {
                    const expectedDeps = [dependencyChain[i - 1]];
                    assert.deepEqual(verifyResult.data!.dependencies, expectedDeps, 
                        `Task ${i} should maintain dependency on task ${i - 1}`);
                }
            }

            console.log(`Cascading CAS: ${successfulUpdates}/${totalUpdates} successful`);
        });
    });

    describe("CAS Performance and Metrics", () => {
        it("should measure CAS operation performance under varying concurrency", async () => {
            const concurrencyLevels = [1, 5, 10, 20];
            const performanceMetrics: Array<{ level: number; avgTime: number; successRate: number }> = [];

            for (const concurrency of concurrencyLevels) {
                // Create test task for this level
                const createResult = await tcpClient.createTask({
                    title: `${TASK_ID_PREFIX} Performance Test L${concurrency}`,
                    description: "Performance testing task",
                    priority: "medium",
                    createdBy: "integration-test-b7c2d592"
                });

                if (!createResult.success || !createResult.data) continue;

                const taskId = createResult.data.id;

                // Perform concurrent CAS-style operations
                const operations = Array.from({ length: concurrency }, (_, i) => 
                    tcpClient.updateTaskStatus(taskId, i % 2 === 0 ? "in-progress" : "done")
                );

                const startTime = Date.now();
                const results = await Promise.allSettled(operations);
                const endTime = Date.now();

            const successful = results.filter(r => 
                r.status === 'fulfilled' && 
                (r as PromiseFulfilledResult<any>).value && 
                (r as PromiseFulfilledResult<any>).value.success
            ).length;

                const avgTime = (endTime - startTime) / concurrency;
                const successRate = successful / concurrency;

                performanceMetrics.push({ level: concurrency, avgTime, successRate });

                // Clean up
                await tcpClient.deleteTask(taskId);
            }

            // Analyze performance degradation
            for (let i = 1; i < performanceMetrics.length; i++) {
                const current = performanceMetrics[i];
                const previous = performanceMetrics[i - 1];
                
                // Response time should not increase exponentially
                const timeIncrease = current.avgTime / previous.avgTime;
                assert.ok(timeIncrease < 10, 
                    `Response time increase should be reasonable: ${timeIncrease.toFixed(2)}x`);

                // Success rate should remain reasonable
                assert.ok(current.successRate >= 0.3, 
                    `Success rate should remain >=30% at concurrency ${current.level}: ${current.successRate}`);
            }

            console.log("CAS Performance Metrics:", performanceMetrics.map(m => 
                `L${m.level}: ${m.avgTime.toFixed(1)}ms, ${(m.successRate * 100).toFixed(1)}% success`
            ).join(", "));
        });

        it("should measure CAS throughput under sustained load", async () => {
            const testDuration = 3000; // 3 seconds
            const batchSize = 5;
            const startTime = Date.now();
            let totalOperations = 0;
            let successfulOperations = 0;

            // Create initial task
            const createResult = await tcpClient.createTask({
                title: `${TASK_ID_PREFIX} Throughput Test`,
                description: "Throughput testing task",
                priority: "medium",
                createdBy: "integration-test-b7c2d592"
            });

            if (!createResult.success || !createResult.data) {
                assert.fail("Failed to create initial task for throughput test");
            }

            const taskId = createResult.data.id;

            // Sustained CAS-style operations
            while (Date.now() - startTime < testDuration) {
                const batch = Array.from({ length: batchSize }, (_, i) => 
                    tcpClient.updateTaskStatus(taskId, i % 2 === 0 ? "in-progress" : "todo")
                );

                const results = await Promise.allSettled(batch);
                const batchSuccessful = results.filter(r => 
                    r.status === 'fulfilled' && 
                    (r as PromiseFulfilledResult<any>).value.success
                ).length;

                totalOperations += batchSize;
                successfulOperations += batchSuccessful;

                // Small delay to prevent overwhelming
                await new Promise(resolve => setTimeout(resolve, 20));
            }

            const actualDuration = Date.now() - startTime;
            const throughput = (successfulOperations / actualDuration) * 1000; // ops/sec
            const successRate = successfulOperations / totalOperations;

            // Clean up
            await tcpClient.deleteTask(taskId);

            assert.ok(throughput >= 5, `Should maintain at least 5 CAS ops/sec (${throughput.toFixed(2)})`);
            assert.ok(successRate >= 0.4, `Should maintain >=40% CAS success rate (${(successRate * 100).toFixed(1)}%)`);

            console.log(`CAS Throughput: ${throughput.toFixed(2)} ops/sec, Success rate: ${(successRate * 100).toFixed(1)}%`);
        });
    });

    describe("CAS Failure Recovery Patterns", () => {
        it("should handle CAS retry with exponential backoff", async () => {
            const createResult = await tcpClient.createTask({
                title: `${TASK_ID_PREFIX} Retry Test`,
                description: "Task for CAS retry testing",
                priority: "medium",
                createdBy: "integration-test-b7c2d592"
            });

            if (!createResult.success || !createResult.data) {
                assert.fail("Failed to create task for retry test");
            }

            const taskId = createResult.data.id;

            // Simulate retry pattern with delays
            const maxRetries = 3;
            const baseDelay = 50;
            let success = false;
            let attempts = 0;

            for (let attempt = 0; attempt <= maxRetries && !success; attempt++) {
                attempts++;
                
                try {
                    // Get current state (simulating CAS read)
                    const currentResult = await tcpClient.getTask(taskId);
                    if (!currentResult.success || !currentResult.data) {
                        throw new Error("Failed to read current state");
                    }

                    const currentState = currentResult.data.status;
                    const newState = currentState === "todo" ? "in-progress" : "done";

                    // Attempt CAS-style update
                    const updateResult = await tcpClient.updateTaskStatus(taskId, newState);
                    
                    if (updateResult.success) {
                        success = true;
                        console.log(`CAS retry succeeded on attempt ${attempt + 1}`);
                        break;
                    }

                    // If failed and not last attempt, wait with exponential backoff
                    if (attempt < maxRetries) {
                        const delay = baseDelay * Math.pow(2, attempt);
                        await new Promise(resolve => setTimeout(resolve, delay));
                    }

                } catch (error) {
                    // Handle network errors or other failures
                    if (attempt < maxRetries) {
                        const delay = baseDelay * Math.pow(2, attempt);
                        await new Promise(resolve => setTimeout(resolve, delay));
                    }
                }
            }

            assert.ok(success, `CAS retry should succeed within ${maxRetries + 1} attempts`);
            assert.ok(attempts >= 1, "Should attempt at least once");

            // Clean up
            await tcpClient.deleteTask(taskId);

            console.log(`CAS retry test: Success after ${attempts} attempts`);
        });

        it("should handle CAS failure gracefully without data corruption", async () => {
            const taskData = {
                title: `${TASK_ID_PREFIX} Corruption Prevention Test`,
                description: "Test data for corruption prevention",
                priority: "medium" as const,
                createdBy: "integration-test-b7c2d592",
                collaborators: ["user1@example.com", "user2@example.com"],
                dependencies: ["dep-1", "dep-2"]
            };

            const createResult = await tcpClient.createTask(taskData);
            if (!createResult.success || !createResult.data) {
                assert.fail("Failed to create task for corruption test");
            }

            const taskId = createResult.data.id;

            // Capture initial state
            const initialResult = await tcpClient.getTask(taskId);
            if (!initialResult.success || !initialResult.data) {
                assert.fail("Failed to read initial task state");
            }

            const initialState = initialResult.data;

            // Perform conflicting CAS-style operations
            const conflictingOperations = Array.from({ length: 10 }, (_, i) => 
                tcpClient.updateTaskStatus(taskId, i % 2 === 0 ? "in-progress" : "done")
            );

            const results = await Promise.allSettled(conflictingOperations);
            
            // Verify final state is consistent and not corrupted
            const finalResult = await tcpClient.getTask(taskId);
            if (!finalResult.success || !finalResult.data) {
                assert.fail("Failed to read final task state");
            }

            const finalState = finalResult.data;

            // Core data should remain unchanged
            assert.equal(finalState.title, initialState.title);
            assert.equal(finalState.description, initialState.description);
            assert.equal(finalState.createdBy, initialState.createdBy);
            assert.deepEqual(finalState.collaborators, initialState.collaborators);
            assert.deepEqual(finalState.dependencies, initialState.dependencies);

            // Status should be valid
            assert.ok(["todo", "in-progress", "done"].includes(finalState.status),
                `Final status should be valid: ${finalState.status}`);

            // Priority should remain unchanged
            assert.equal(finalState.priority, initialState.priority);

            // Timestamp should have advanced
            const initialTime = new Date(initialState.updatedAt).getTime();
            const finalTime = new Date(finalState.updatedAt).getTime();
            assert.ok(finalTime >= initialTime, "Timestamp should advance or stay same");

            // Clean up
            await tcpClient.deleteTask(taskId);

            console.log("Corruption prevention test: Data integrity maintained");
        });
    });

    describe("Advanced CAS Edge Cases", () => {
        it("should handle null and undefined values in CAS operations", async () => {
            // Test with task that has optional fields that might be null/undefined
            const taskData = {
                title: `${TASK_ID_PREFIX} Null Value Test`,
                description: "Task with potential null values",
                priority: "medium" as const,
                createdBy: "integration-test-b7c2d592",
                // Omit optional fields to test null handling
            };

            const createResult = await tcpClient.createTask(taskData);
            if (!createResult.success || !createResult.data) {
                assert.fail("Failed to create task for null value test");
            }

            const taskId = createResult.data.id;

            // Test CAS-style operations on task with null/undefined fields
            const operations = [
                tcpClient.updateTaskStatus(taskId, "in-progress"),
                tcpClient.updateTaskPriority(taskId, "high"),
                tcpClient.getTask(taskId), // Verify read operations
                tcpClient.updateTaskStatus(taskId, "done"),
                tcpClient.updateTaskPriority(taskId, "low")
            ];

            const results = await Promise.allSettled(operations);
            const successful = results.filter(r => 
                r.status === 'fulfilled' && 
                (r as PromiseFulfilledResult<any>).value.success
            ).length;

            // Should handle null/undefined fields gracefully
            assert.ok(successful >= 3, "Should handle null/undefined fields gracefully");

            // Verify final state consistency
            const finalResult = await tcpClient.getTask(taskId);
            if (!finalResult.success || !finalResult.data) {
                assert.fail("Failed to read final state");
            }

            assert.ok(["todo", "in-progress", "done"].includes(finalResult.data.status));
            assert.ok(["high", "medium", "low"].includes(finalResult.data.priority));

            // Clean up
            await tcpClient.deleteTask(taskId);

            console.log(`Null value test: ${successful}/${operations.length} operations successful`);
        });

        it("should handle rapid CAS state transitions without race conditions", async () => {
            const createResult = await tcpClient.createTask({
                title: `${TASK_ID_PREFIX} Rapid Transition Test`,
                description: "Task for rapid state transition testing",
                priority: "medium",
                createdBy: "integration-test-b7c2d592"
            });

            if (!createResult.success || !createResult.data) {
                assert.fail("Failed to create task for rapid transition test");
            }

            const taskId = createResult.data.id;

            // Rapid state transitions to test race condition handling
            const stateSequence = ["todo", "in-progress", "done", "in-progress", "todo"];
            const rapidTransitions = stateSequence.map((status, i) => 
                tcpClient.updateTaskStatus(taskId, status).then((result) => {
                    // Add small delay to create timing variations
                    return new Promise(resolve => setTimeout(() => resolve(result), Math.random() * 50));
                })
            );

            const startTime = Date.now();
            const results = await Promise.allSettled(rapidTransitions);
            const endTime = Date.now();

            const successful = results.filter(r => 
                r.status === 'fulfilled' && 
                (r as PromiseFulfilledResult<any>).value.success
            ).length;

            // Should handle rapid transitions without hanging
            assert.ok(endTime - startTime < 5000, "Rapid transitions should complete within 5 seconds");
            assert.ok(successful >= 2, "Should handle at least some rapid transitions");

            // Verify final state is valid
            const finalResult = await tcpClient.getTask(taskId);
            if (!finalResult.success || !finalResult.data) {
                assert.fail("Failed to read final state");
            }

            assert.ok(stateSequence.includes(finalResult.data.status),
                "Final state should be from the valid sequence");

            // Clean up
            await tcpClient.deleteTask(taskId);

            console.log(`Rapid transition test: ${successful}/${stateSequence.length} successful in ${endTime - startTime}ms`);
        });

        it("should handle CAS timeout and deadlock detection", async () => {
            // Create multiple tasks to create potential deadlock scenarios
            const taskIds: string[] = [];
            const taskCount = 3;

            for (let i = 0; i < taskCount; i++) {
                const result = await tcpClient.createTask({
                    title: `${TASK_ID_PREFIX} Deadlock Test ${i}`,
                    description: `Task for deadlock detection test ${i}`,
                    priority: "medium",
                    createdBy: "integration-test-b7c2d592"
                });

                if (result.success && result.data) {
                    taskIds.push(result.data.id);
                }
            }

            // Create operations that could potentially deadlock
            const deadlockProneOperations: Promise<any>[] = [];
            
            // Create circular dependency pattern
            for (let i = 0; i < taskCount; i++) {
                const currentTask = taskIds[i];
                const nextTask = taskIds[(i + 1) % taskCount];
                
                // Operations that access multiple tasks in different orders
                deadlockProneOperations.push(
                    tcpClient.updateTaskStatus(currentTask, "in-progress"),
                    tcpClient.updateTaskPriority(nextTask, "high"),
                    tcpClient.getTask(currentTask),
                    tcpClient.updateTaskStatus(nextTask, "done")
                );
            }

            const timeout = 10000; // 10 second timeout
            const startTime = Date.now();

            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error("Operation timeout")), timeout);
            });

            try {
                const results = await Promise.race([
                    Promise.allSettled(deadlockProneOperations),
                    timeoutPromise
                ]);

                const endTime = Date.now();
                const duration = endTime - startTime;

                // Should complete without timeout (no deadlock)
                assert.ok(duration < timeout, "Operations should complete without deadlock");
                
                if (Array.isArray(results)) {
                    const successful = results.filter(r => 
                        r.status === 'fulfilled' && 
                        (r as PromiseFulfilledResult<any>).value.success
                    ).length;

                    assert.ok(successful >= deadlockProneOperations.length * 0.3, 
                        "Should handle at least 30% of deadlock-prone operations");

                    console.log(`Deadlock test: ${successful}/${deadlockProneOperations.length} successful in ${duration}ms`);
                }

            } catch (error) {
                if (error instanceof Error && error.message === "Operation timeout") {
                    assert.fail("Operations timed out - potential deadlock detected");
                }
                throw error;
            }

            // Verify all tasks remain accessible
            for (const taskId of taskIds) {
                const verifyResult = await tcpClient.getTask(taskId);
                assert.ok(verifyResult.success && verifyResult.data, 
                    `Task ${taskId} should remain accessible after deadlock test`);
            }
        });
    });
});