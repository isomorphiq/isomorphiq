import { describe, it, before, beforeEach, after } from "node:test";
import { strict as assert } from "node:assert";
import { DaemonTcpClient, type Task } from "../e2e/dashboard/tcp-client.ts";
import { startTestDaemon, type TestDaemonHandle } from "./daemon-test-harness.ts";

describe("Advanced Concurrent Operations - Task b7c2d592", () => {
    const TASK_ID_PREFIX = "task-b7c2d592-advanced";
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
        // No cleanup needed when using existing daemon
    });

    describe("Race Condition Detection", () => {
        it("should detect and handle simultaneous status and priority updates", async () => {
            const createResult = await tcpClient.createTask({
                title: `${TASK_ID_PREFIX} Race Condition Test`,
                description: "Task for race condition testing",
                priority: "medium",
                createdBy: "integration-test-b7c2d592"
            });
            
            assert.ok(createResult.success);
            assert.ok(createResult.data);
            const taskId = createResult.data.id;
            
            // Launch simultaneous status and priority updates
            const raceOperations = [
                ...Array.from({ length: 5 }, () => tcpClient.updateTaskStatus(taskId, "in-progress")),
                ...Array.from({ length: 5 }, () => tcpClient.updateTaskPriority(taskId, "high")),
                ...Array.from({ length: 3 }, () => tcpClient.getTask(taskId))
            ];
            
            const startTime = Date.now();
            const results = await Promise.allSettled(raceOperations);
            const endTime = Date.now();
            
            // Analyze results
            const successful = results.filter(r => 
                r.status === 'fulfilled' && 
                (r as PromiseFulfilledResult<any>).value.success
            );
            
            const failed = results.filter(r => r.status === 'rejected' || 
                !(r as PromiseFulfilledResult<any>).value.success);
            
            // Verify final consistency
            const finalResult = await tcpClient.getTask(taskId);
            assert.ok(finalResult.success);
            assert.ok(finalResult.data);
            
            // The final state should be one of the valid states
            assert.ok(["todo", "in-progress", "done"].includes(finalResult.data.status));
            assert.ok(["high", "medium", "low"].includes(finalResult.data.priority));
            
            // Performance check - should complete within reasonable time
            assert.ok(endTime - startTime < 3000, "Race operations should complete within 3 seconds");
            
            console.log(`Race condition test: ${successful.length} successful, ${failed.length} failed operations`);
        });

        it("should handle competing task creation with same identifiers", async () => {
            const baseTitle = `${TASK_ID_PREFIX} Competing Creation`;
            const creationPromises = Array.from({ length: 10 }, (_, i) =>
                tcpClient.createTask({
                    title: `${baseTitle} ${i}`,
                    description: `Competing creation test ${i}`,
                    priority: "medium",
                    createdBy: "integration-test-b7c2d592"
                })
            );
            
            const results = await Promise.allSettled(creationPromises);
            
            // Analyze uniqueness
            const successful = results
                .filter(r => r.status === 'fulfilled' && 
                    (r as PromiseFulfilledResult<any>).value.success)
                .map(r => (r as PromiseFulfilledResult<any>).value.data);
            
            const titles = successful.map(t => t.title);
            const uniqueTitles = new Set(titles);
            
            assert.equal(uniqueTitles.size, titles.length, "All task titles should be unique");
            assert.ok(successful.length >= 8, "Should create at least 8 of 10 competing tasks");
        });

        it("should handle resource contention during bulk operations", async () => {
            // Create initial tasks
            const taskIds: string[] = [];
            for (let i = 0; i < 5; i++) {
                const result = await tcpClient.createTask({
                    title: `${TASK_ID_PREFIX} Resource Test ${i}`,
                    description: `Resource contention test ${i}`,
                    priority: "medium",
                    createdBy: "integration-test-b7c2d592"
                });
                
                if (result.success && result.data) {
                    taskIds.push(result.data.id);
                }
            }
            
            // Launch competing operations on all tasks
            const contentionOperations = taskIds.flatMap(taskId => [
                tcpClient.updateTaskStatus(taskId, "in-progress"),
                tcpClient.updateTaskPriority(taskId, "high"),
                tcpClient.getTask(taskId),
                tcpClient.listTasksFiltered({ search: taskId })
            ]);
            
            const results = await Promise.allSettled(contentionOperations);
            const successful = results.filter(r => r.status === 'fulfilled').length;
            const totalOperations = contentionOperations.length;
            
            // Should handle resource contention reasonably well
            const successRate = successful / totalOperations;
            assert.ok(successRate >= 0.7, `Should maintain at least 70% success rate under contention (${successRate})`);
        });
    });

    describe("Deadlock Prevention", () => {
        it("should prevent circular dependency scenarios", async () => {
            // Create tasks that could have circular dependencies
            const taskPromises = Array.from({ length: 3 }, (_, i) =>
                tcpClient.createTask({
                    title: `${TASK_ID_PREFIX} Deadlock Test ${i}`,
                    description: `Deadlock prevention test ${i}`,
                    priority: "medium",
                    createdBy: "integration-test-b7c2d592",
                    dependencies: i > 0 ? [`deadlock-${i-1}`] : []
                })
            );
            
            const results = await Promise.allSettled(taskPromises);
            const successful = results.filter(r => 
                r.status === 'fulfilled' && 
                (r as PromiseFulfilledResult<any>).value.success
            );
            
            // Should either succeed or fail gracefully without hanging
            assert.ok(successful.length >= 1, "Should create at least one task in potential deadlock scenario");
        });

        it("should handle simultaneous task dependency updates", async () => {
            // Create base tasks
            const taskIds: string[] = [];
            for (let i = 0; i < 3; i++) {
                const result = await tcpClient.createTask({
                    title: `${TASK_ID_PREFIX} Dependency Base ${i}`,
                    description: `Base task for dependency testing ${i}`,
                    priority: "medium",
                    createdBy: "integration-test-b7c2d592"
                });
                
                if (result.success && result.data) {
                    taskIds.push(result.data.id);
                }
            }
            
            // Simultaneous dependency updates (if supported)
            const dependencyUpdates = taskIds.map(taskId =>
                tcpClient.createTask({
                    title: `${TASK_ID_PREFIX} Dependent on ${taskId}`,
                    description: `Dependent task for ${taskId}`,
                    priority: "low",
                    createdBy: "integration-test-b7c2d592",
                    dependencies: [taskId]
                })
            );
            
            const results = await Promise.allSettled(dependencyUpdates);
            const successful = results.filter(r => 
                r.status === 'fulfilled' && 
                (r as PromiseFulfilledResult<any>).value.success
            );
            
            // Should handle dependency creation without deadlocks
            assert.ok(successful.length >= 1, "Should create at least one dependent task");
        });
    });

    describe("Concurrency Stress Testing", () => {
        it("should maintain consistency under high concurrent load", async () => {
            const concurrentWaves = 3;
            const operationsPerWave = 10;
            const allResults: any[] = [];
            
            for (let wave = 0; wave < concurrentWaves; wave++) {
                const waveOperations = Array.from({ length: operationsPerWave }, (_, i) => 
                    tcpClient.createTask({
                        title: `${TASK_ID_PREFIX} Stress Wave ${wave} Op ${i}`,
                        description: `Stress test wave ${wave} operation ${i}`,
                        priority: ["high", "medium", "low"][i % 3],
                        createdBy: "integration-test-b7c2d592"
                    })
                );
                
                const waveResults = await Promise.allSettled(waveOperations);
                allResults.push(...waveResults);
                
                // Small delay between waves
                await new Promise(resolve => setTimeout(resolve, 50));
            }
            
            const successful = allResults.filter(r => 
                r.status === 'fulfilled' && 
                (r as PromiseFulfilledResult<any>).value.success
            );
            
            const totalOperations = concurrentWaves * operationsPerWave;
            const successRate = successful.length / totalOperations;
            
            assert.ok(successRate >= 0.75, `Should maintain >=75% success rate under stress (${successRate})`);
            
            // Verify data integrity
            const taskIds = successful
                .filter(r => r.status === 'fulfilled')
                .map(r => (r as PromiseFulfilledResult<any>).value.data?.id)
                .filter(Boolean);
            
            const uniqueIds = new Set(taskIds);
            assert.equal(uniqueIds.size, taskIds.length, "All task IDs should remain unique under stress");
        });

        it("should handle mixed read/write operations under load", async () => {
            // Create initial dataset
            const baseTaskIds: string[] = [];
            for (let i = 0; i < 5; i++) {
                const result = await tcpClient.createTask({
                    title: `${TASK_ID_PREFIX} Mixed Load Base ${i}`,
                    description: `Base task for mixed load testing ${i}`,
                    priority: "medium",
                    createdBy: "integration-test-b7c2d592"
                });
                
                if (result.success && result.data) {
                    baseTaskIds.push(result.data.id);
                }
            }
            
            // Mix of read and write operations
            const mixedOperations = [
                // Heavy reads
                ...Array.from({ length: 15 }, () => tcpClient.listTasks()),
                ...baseTaskIds.flatMap(taskId => 
                    Array.from({ length: 3 }, () => tcpClient.getTask(taskId))
                ),
                // Mixed writes
                ...baseTaskIds.map(taskId => tcpClient.updateTaskStatus(taskId, "in-progress")),
                ...Array.from({ length: 5 }, (_, i) =>
                    tcpClient.createTask({
                        title: `${TASK_ID_PREFIX} Mixed Load New ${i}`,
                        description: `New task during mixed load ${i}`,
                        priority: "low",
                        createdBy: "integration-test-b7c2d592"
                    })
                )
            ];
            
            const startTime = Date.now();
            const results = await Promise.allSettled(mixedOperations);
            const endTime = Date.now();
            
            const successful = results.filter(r => r.status === 'fulfilled').length;
            const totalOperations = mixedOperations.length;
            const successRate = successful / totalOperations;
            const duration = endTime - startTime;
            
            assert.ok(successRate >= 0.8, `Should handle mixed load with >=80% success rate (${successRate})`);
            assert.ok(duration < 10000, `Mixed operations should complete within 10 seconds (${duration}ms)`);
            
            console.log(`Mixed load test: ${successful}/${totalOperations} operations successful in ${duration}ms`);
        });

        it("should recover gracefully from concurrent failures", async () => {
            // Create tasks for failure testing
            const testTaskIds: string[] = [];
            for (let i = 0; i < 3; i++) {
                const result = await tcpClient.createTask({
                    title: `${TASK_ID_PREFIX} Recovery Test ${i}`,
                    description: `Task for recovery testing ${i}`,
                    priority: "medium",
                    createdBy: "integration-test-b7c2d592"
                });
                
                if (result.success && result.data) {
                    testTaskIds.push(result.data.id);
                }
            }
            
            // Mix valid operations with intentional failures
            const mixedOperations = [
                // Valid operations
                ...testTaskIds.map(taskId => tcpClient.updateTaskStatus(taskId, "in-progress")),
                ...testTaskIds.map(taskId => tcpClient.getTask(taskId)),
                tcpClient.listTasks(),
                // Invalid operations (these should fail gracefully)
                tcpClient.getTask("invalid-task-id"),
                tcpClient.updateTaskStatus("invalid-task-id", "done"),
                tcpClient.deleteTask("invalid-task-id")
            ];
            
            const results = await Promise.allSettled(mixedOperations);
            
            // Should handle both successes and failures gracefully
            const totalOperations = mixedOperations.length;
            const successful = results.filter(r => 
                r.status === 'fulfilled' && 
                (r as PromiseFulfilledResult<any>).value.success
            ).length;
            const failedGracefully = results.filter(r => 
                r.status === 'fulfilled' && 
                !(r as PromiseFulfilledResult<any>).value.success
            ).length;
            
            assert.ok(successful >= 3, "Should have successful operations");
            assert.ok(failedGracefully >= 2, "Should handle invalid operations gracefully");
            
            // System should still be functional after failures
            const healthCheck = await tcpClient.listTasks();
            assert.ok(healthCheck.success, "System should remain functional after concurrent failures");
        });
    });

    describe("Data Consistency Under Concurrency", () => {
        it("should maintain task state consistency during concurrent updates", async () => {
            const createResult = await tcpClient.createTask({
                title: `${TASK_ID_PREFIX} State Consistency Test`,
                description: "Task for state consistency testing",
                priority: "medium",
                createdBy: "integration-test-b7c2d592"
            });
            
            assert.ok(createResult.success);
            assert.ok(createResult.data);
            const taskId = createResult.data.id;
            
            // Concurrent state transitions
            const stateTransitions = [
                tcpClient.updateTaskStatus(taskId, "in-progress"),
                tcpClient.updateTaskPriority(taskId, "high"),
                tcpClient.updateTaskStatus(taskId, "done"),
                tcpClient.updateTaskPriority(taskId, "low")
            ];
            
            await Promise.allSettled(stateTransitions);
            
            // Verify final state is consistent
            const finalResult = await tcpClient.getTask(taskId);
            assert.ok(finalResult.success);
            assert.ok(finalResult.data);
            
            // State should be one of the valid states
            assert.ok(["todo", "in-progress", "done"].includes(finalResult.data.status));
            assert.ok(["high", "medium", "low"].includes(finalResult.data.priority));
            
            // Core data should remain unchanged
            assert.ok(finalResult.data.title.includes("State Consistency Test"));
            assert.equal(finalResult.data.createdBy, "integration-test-b7c2d592");
        });

        it("should prevent data corruption during concurrent access", async () => {
            const taskData = {
                title: `${TASK_ID_PREFIX} Corruption Test`,
                description: "Task for corruption prevention testing",
                priority: "medium",
                createdBy: "integration-test-b7c2d592",
                collaborators: ["user1@example.com", "user2@example.com"],
                dependencies: ["dep-1", "dep-2"]
            };
            
            const createResult = await tcpClient.createTask(taskData);
            assert.ok(createResult.success);
            assert.ok(createResult.data);
            const taskId = createResult.data.id;
            
            // Concurrent read operations
            const readOperations = Array.from({ length: 10 }, () => tcpClient.getTask(taskId));
            const readResults = await Promise.allSettled(readOperations);
            
            // All successful reads should return consistent data
            const successfulReads = readResults
                .filter(r => r.status === 'fulfilled' && 
                    (r as PromiseFulfilledResult<any>).value.success)
                .map(r => (r as PromiseFulfilledResult<any>).value.data);
            
            if (successfulReads.length > 1) {
                // All reads should return the same data
                const firstRead = successfulReads[0];
                successfulReads.forEach(read => {
                    assert.equal(read.id, firstRead.id);
                    assert.equal(read.title, firstRead.title);
                    assert.equal(read.description, firstRead.description);
                    assert.deepEqual(read.collaborators, firstRead.collaborators);
                    assert.deepEqual(read.dependencies, firstRead.dependencies);
                });
            }
        });
    });

    describe("Advanced Race Condition Patterns", () => {
        it("should handle CAS (Compare-And-Swap) style operations", async () => {
            const createResult = await tcpClient.createTask({
                title: `${TASK_ID_PREFIX} CAS Test`,
                description: "Task for CAS operation testing",
                priority: "medium",
                createdBy: "integration-test-b7c2d592"
            });
            
            assert.ok(createResult.success);
            assert.ok(createResult.data);
            const taskId = createResult.data.id;
            
            // Get initial version
            const initialResult = await tcpClient.getTask(taskId);
            assert.ok(initialResult.success);
            assert.ok(initialResult.data);
            const initialVersion = initialResult.data.updatedAt;
            
            // Simulate concurrent CAS-style updates
            const casOperations = Array.from({ length: 5 }, (_, i) => 
                tcpClient.updateTaskStatus(taskId, i % 2 === 0 ? "in-progress" : "done")
            );
            
            const results = await Promise.allSettled(casOperations);
            const successful = results.filter(r => 
                r.status === 'fulfilled' && 
                (r as PromiseFulfilledResult<any>).value.success
            );
            
            // Final state should be consistent
            const finalResult = await tcpClient.getTask(taskId);
            assert.ok(finalResult.success);
            assert.ok(finalResult.data);
            assert.ok(finalResult.data.updatedAt !== initialVersion);
            
            // Should have at least one successful update
            assert.ok(successful.length > 0, "Should have at least one successful CAS operation");
        });

        it("should handle high-frequency status transitions with backpressure", async () => {
            const createResult = await tcpClient.createTask({
                title: `${TASK_ID_PREFIX} Backpressure Test`,
                description: "Task for backpressure testing",
                priority: "medium",
                createdBy: "integration-test-b7c2d592"
            });
            
            assert.ok(createResult.success);
            assert.ok(createResult.data);
            const taskId = createResult.data.id;
            
            const statusCycle = ["todo", "in-progress", "done"];
            const startTime = Date.now();
            
            // Rapid-fire status updates
            const rapidUpdates = Array.from({ length: 20 }, (_, i) => 
                tcpClient.updateTaskStatus(taskId, statusCycle[i % 3])
            );
            
            const results = await Promise.allSettled(rapidUpdates);
            const endTime = Date.now();
            
            const successful = results.filter(r => 
                r.status === 'fulfilled' && 
                (r as PromiseFulfilledResult<any>).value.success
            );
            
            // Verify system handles rapid updates gracefully
            assert.ok(successful.length >= 10, "Should handle at least 50% of rapid updates");
            assert.ok(endTime - startTime < 15000, "Should complete rapid updates within 15 seconds");
            
            // Final state should be valid
            const finalResult = await tcpClient.getTask(taskId);
            assert.ok(finalResult.success);
            assert.ok(finalResult.data);
            assert.ok(statusCycle.includes(finalResult.data.status));
        });

        it("should maintain isolation between concurrent task operations", async () => {
            const taskCount = 5;
            const taskIds: string[] = [];
            
            // Create multiple tasks
            for (let i = 0; i < taskCount; i++) {
                const result = await tcpClient.createTask({
                    title: `${TASK_ID_PREFIX} Isolation Test ${i}`,
                    description: `Isolation test task ${i}`,
                    priority: "medium",
                    createdBy: "integration-test-b7c2d592"
                });
                
                if (result.success && result.data) {
                    taskIds.push(result.data.id);
                }
            }
            
            // Perform concurrent operations on different tasks
            const isolationOperations = taskIds.flatMap((taskId, index) => [
                tcpClient.updateTaskStatus(taskId, "in-progress"),
                tcpClient.updateTaskPriority(taskId, index % 2 === 0 ? "high" : "low"),
                tcpClient.getTask(taskId)
            ]);
            
            const results = await Promise.allSettled(isolationOperations);
            const successful = results.filter(r => 
                r.status === 'fulfilled' && 
                (r as PromiseFulfilledResult<any>).value.success
            );
            
            // Each task should be independently modifiable
            assert.ok(successful.length >= taskCount * 2, "Each task should be independently operable");
            
            // Verify all tasks still exist and are accessible
            for (const taskId of taskIds) {
                const verifyResult = await tcpClient.getTask(taskId);
                assert.ok(verifyResult.success, `Task ${taskId} should remain accessible`);
            }
        });
    });

    describe("Performance and Timing Analysis", () => {
        it("should measure response time degradation under concurrency", async () => {
            const createResult = await tcpClient.createTask({
                title: `${TASK_ID_PREFIX} Performance Test`,
                description: "Task for performance testing",
                priority: "medium",
                createdBy: "integration-test-b7c2d592"
            });
            
            assert.ok(createResult.success);
            assert.ok(createResult.data);
            const taskId = createResult.data.id;
            
            const concurrencyLevels = [1, 5, 10, 15];
            const responseTimes: number[] = [];
            
            for (const level of concurrencyLevels) {
                const operations = Array.from({ length: level }, () => 
                    tcpClient.getTask(taskId)
                );
                
                const startTime = Date.now();
                const results = await Promise.allSettled(operations);
                const endTime = Date.now();
                
                const avgResponseTime = (endTime - startTime) / level;
                responseTimes.push(avgResponseTime);
                
                const successful = results.filter(r => 
                    r.status === 'fulfilled' && 
                    (r as PromiseFulfilledResult<any>).value.success
                );
                
                assert.ok(successful.length >= level * 0.8, 
                    `Should maintain >=80% success rate at concurrency level ${level}`);
            }
            
            // Response time should not degrade exponentially
            for (let i = 1; i < responseTimes.length; i++) {
                const degradationRatio = responseTimes[i] / responseTimes[i - 1];
                assert.ok(degradationRatio < 5, 
                    `Response time degradation should be reasonable (${degradationRatio}x)`);
            }
            
            console.log("Response times by concurrency level:", 
                concurrencyLevels.map((level, i) => `${level}: ${responseTimes[i]}ms`).join(", "));
        });

        it("should measure throughput under sustained load", async () => {
            const duration = 5000; // 5 seconds
            const batchSize = 3;
            const startTime = Date.now();
            let totalOperations = 0;
            let successfulOperations = 0;
            
            // Create initial task
            const createResult = await tcpClient.createTask({
                title: `${TASK_ID_PREFIX} Throughput Test`,
                description: "Task for throughput testing",
                priority: "medium",
                createdBy: "integration-test-b7c2d592"
            });
            
            assert.ok(createResult.success);
            assert.ok(createResult.data);
            const taskId = createResult.data.id;
            
            // Sustained load test
            while (Date.now() - startTime < duration) {
                const batch = Array.from({ length: batchSize }, () => 
                    tcpClient.getTask(taskId)
                );
                
                const results = await Promise.allSettled(batch);
                const batchSuccessful = results.filter(r => 
                    r.status === 'fulfilled' && 
                    (r as PromiseFulfilledResult<any>).value.success
                ).length;
                
                totalOperations += batchSize;
                successfulOperations += batchSuccessful;
                
                // Small delay to prevent overwhelming
                await new Promise(resolve => setTimeout(resolve, 10));
            }
            
            const actualDuration = Date.now() - startTime;
            const throughput = (successfulOperations / actualDuration) * 1000; // ops/sec
            const successRate = successfulOperations / totalOperations;
            
            assert.ok(throughput >= 10, `Should maintain at least 10 ops/sec (${throughput.toFixed(2)})`);
            assert.ok(successRate >= 0.9, `Should maintain >=90% success rate (${(successRate * 100).toFixed(1)}%)`);
            
            console.log(`Throughput: ${throughput.toFixed(2)} ops/sec, Success rate: ${(successRate * 100).toFixed(1)}%`);
        });
    });

    describe("Advanced Race Condition Patterns - Enhanced", () => {
        it("should handle lost update scenario with concurrent modifications", async () => {
            const createResult = await tcpClient.createTask({
                title: `${TASK_ID_PREFIX} Lost Update Test`,
                description: "Initial description",
                priority: "medium",
                createdBy: "integration-test-b7c2d592"
            });
            
            assert.ok(createResult.success);
            assert.ok(createResult.data);
            const taskId = createResult.data.id;
            
            // Simulate concurrent read-modify-write operations using status/priority updates
            const concurrentUpdates = Array.from({ length: 5 }, async (_, i) => {
                const getResult = await tcpClient.getTask(taskId);
                if (getResult.success && getResult.data) {
                    // Simulate processing time
                    await new Promise(resolve => setTimeout(resolve, Math.random() * 100));
                    // Alternate between status and priority updates to simulate modifications
                    if (i % 2 === 0) {
                        return await tcpClient.updateTaskStatus(taskId, i % 4 === 0 ? "in-progress" : "done");
                    } else {
                        return await tcpClient.updateTaskPriority(taskId, ["high", "medium", "low"][i % 3]);
                    }
                }
                return { success: false, error: "Failed to read task" };
            });
            
            const results = await Promise.allSettled(concurrentUpdates);
            const successful = results.filter(r => 
                r.status === 'fulfilled' && 
                (r as PromiseFulfilledResult<any>).value.success
            );
            
            // Verify final consistency
            const finalResult = await tcpClient.getTask(taskId);
            assert.ok(finalResult.success);
            assert.ok(finalResult.data);
            
            // Should have at least one successful update
            assert.ok(successful.length > 0, "Should have at least one successful update");
            
            console.log(`Lost update test: ${successful.length} successful concurrent updates`);
        });

        it("should handle priority inversion scenario", async () => {
            const taskIds: string[] = [];
            
            // Create tasks with different priorities
            for (let i = 0; i < 3; i++) {
                const result = await tcpClient.createTask({
                    title: `${TASK_ID_PREFIX} Priority Inversion ${i}`,
                    description: `Priority inversion test task ${i}`,
                    priority: ["high", "medium", "low"][i],
                    createdBy: "integration-test-b7c2d592"
                });
                
                if (result.success && result.data) {
                    taskIds.push(result.data.id);
                }
            }
            
            // Rapid priority changes to simulate priority inversion
            const priorityOperations = taskIds.flatMap(taskId => 
                Array.from({ length: 4 }, (_, i) => 
                    tcpClient.updateTaskPriority(taskId, ["high", "medium", "low"][i % 3])
                )
            );
            
            const results = await Promise.allSettled(priorityOperations);
            const successful = results.filter(r => 
                r.status === 'fulfilled' && 
                (r as PromiseFulfilledResult<any>).value.success
            );
            
            // Verify system maintains consistency
            for (const taskId of taskIds) {
                const verifyResult = await tcpClient.getTask(taskId);
                assert.ok(verifyResult.success && verifyResult.data, `Task ${taskId} should remain accessible`);
                assert.ok(["high", "medium", "low"].includes(verifyResult.data.priority), 
                    "Priority should be valid");
            }
            
            assert.ok(successful.length >= taskIds.length * 2, "Should handle most priority changes");
        });

        it("should detect and handle ABA problem scenarios", async () => {
            const createResult = await tcpClient.createTask({
                title: `${TASK_ID_PREFIX} ABA Problem Test`,
                description: "Initial state",
                priority: "medium",
                createdBy: "integration-test-b7c2d592"
            });
            
            assert.ok(createResult.success);
            assert.ok(createResult.data);
            const taskId = createResult.data.id;
            
            // Simulate ABA: status -> A -> B -> A while operations are in progress
            const abaOperations = [
                tcpClient.updateTaskStatus(taskId, "in-progress"), // A -> B
                tcpClient.updateTaskStatus(taskId, "todo"), // B -> A
                // Concurrent operation that might miss the intermediate state
                tcpClient.updateTaskPriority(taskId, "high")
            ];
            
            const results = await Promise.allSettled(abaOperations);
            const successful = results.filter(r => 
                r.status === 'fulfilled' && 
                (r as PromiseFulfilledResult<any>).value.success
            );
            
            // Verify final state
            const finalResult = await tcpClient.getTask(taskId);
            assert.ok(finalResult.success);
            assert.ok(finalResult.data);
            
            // Should handle ABA without corruption
            assert.ok(["todo", "in-progress", "done"].includes(finalResult.data.status));
            assert.ok(["high", "medium", "low"].includes(finalResult.data.priority));
            
            console.log(`ABA test: ${successful.length} successful operations`);
        });

        it("should handle high-frequency task creation with ID collision potential", async () => {
            // Test rapid task creation to stress ID generation
            const rapidCreations = Array.from({ length: 20 }, (_, i) =>
                tcpClient.createTask({
                    title: `${TASK_ID_PREFIX} Rapid Creation ${i}`,
                    description: `Rapid creation test ${i}`,
                    priority: "medium",
                    createdBy: "integration-test-b7c2d592"
                })
            );
            
            const results = await Promise.allSettled(rapidCreations);
            const successful = results.filter(r => 
                r.status === 'fulfilled' && 
                (r as PromiseFulfilledResult<any>).value.success
            );
            
            // Verify uniqueness of created tasks
            const createdTasks = successful.map(r => 
                (r as PromiseFulfilledResult<any>).value.data
            );
            const taskIds = createdTasks.map(t => t.id);
            const uniqueIds = new Set(taskIds);
            
            assert.equal(uniqueIds.size, taskIds.length, "All task IDs should be unique under rapid creation");
            assert.ok(successful.length >= 15, "Should create at least 15 of 20 rapid tasks");
            
            // Clean up created tasks
            for (const task of createdTasks) {
                await tcpClient.deleteTask(task.id);
            }
        });
    });

    describe("Error Handling and Recovery", () => {
        it("should handle partial failures during batch operations", async () => {
            const taskIds: string[] = [];
            
            // Create tasks for testing
            for (let i = 0; i < 3; i++) {
                const result = await tcpClient.createTask({
                    title: `${TASK_ID_PREFIX} Recovery Test ${i}`,
                    description: `Recovery test task ${i}`,
                    priority: "medium",
                    createdBy: "integration-test-b7c2d592"
                });
                
                if (result.success && result.data) {
                    taskIds.push(result.data.id);
                }
            }
            
            // Verify invalid operations fail gracefully
            const invalidResult1 = await tcpClient.updateTaskStatus("invalid-id-1", "done");
            const invalidResult2 = await tcpClient.getTask("invalid-id-2");
            
            assert.ok(!invalidResult1.success || invalidResult1.error, "Invalid update should fail");
            assert.ok(!invalidResult2.success || invalidResult2.error, "Invalid get should fail");
            
            // Verify valid operations still work
            const validOperations = taskIds.map(taskId => tcpClient.updateTaskStatus(taskId, "in-progress"));
            const validResults = await Promise.allSettled(validOperations);
            const successfulValid = validResults.filter(r => 
                r.status === 'fulfilled' && 
                (r as PromiseFulfilledResult<any>).value.success
            ).length;
            
            assert.ok(successfulValid >= 2, "Valid operations should succeed after invalid ones");
            
            // System should remain functional
            const healthCheck = await tcpClient.listTasks();
            assert.ok(healthCheck.success, "System should remain functional after partial failures");
        });

        it("should recover from temporary connection issues", async () => {
            const createResult = await tcpClient.createTask({
                title: `${TASK_ID_PREFIX} Connection Recovery Test`,
                description: "Task for connection recovery testing",
                priority: "medium",
                createdBy: "integration-test-b7c2d592"
            });
            
            assert.ok(createResult.success);
            assert.ok(createResult.data);
            const taskId = createResult.data.id;
            
            // Perform operations with potential connection issues
            const recoveryOperations = Array.from({ length: 8 }, (_, i) => 
                tcpClient.updateTaskPriority(taskId, ["high", "medium", "low"][i % 3])
            );
            
            const results = await Promise.allSettled(recoveryOperations);
            const successful = results.filter(r => 
                r.status === 'fulfilled' && 
                (r as PromiseFulfilledResult<any>).value.success
            );
            
            // Should recover and complete most operations
            assert.ok(successful.length >= 5, "Should recover and complete at least 5/8 operations");
            
            // Final verification
            const finalResult = await tcpClient.getTask(taskId);
            assert.ok(finalResult.success, "Should be able to verify final state after recovery");
        });
    });

    describe("Advanced Edge Cases - Enhanced Race Conditions", () => {
        it("should handle write skew phenomenon with concurrent dependent tasks", async () => {
            // Create two tasks that depend on each other conditionally
            const task1Result = await tcpClient.createTask({
                title: `${TASK_ID_PREFIX} Write Skew Task 1`,
                description: "First task for write skew testing",
                priority: "high",
                createdBy: "integration-test-b7c2d592"
            });
            
            const task2Result = await tcpClient.createTask({
                title: `${TASK_ID_PREFIX} Write Skew Task 2`,
                description: "Second task for write skew testing",
                priority: "high",
                createdBy: "integration-test-b7c2d592"
            });
            
            assert.ok(task1Result.success && task2Result.success);
            const task1Id = task1Result.data!.id;
            const task2Id = task2Result.data!.id;
            
            // Concurrent operations that could create write skew
            const skewOperations: Promise<any>[] = [
                // Simulate checking both tasks and updating based on state
                tcpClient.updateTaskStatus(task1Id, "in-progress"),
                tcpClient.updateTaskStatus(task2Id, "in-progress"),
                tcpClient.updateTaskPriority(task1Id, "low"),
                tcpClient.updateTaskPriority(task2Id, "low"),
                // Concurrent reads that might see inconsistent state
                tcpClient.getTask(task1Id),
                tcpClient.getTask(task2Id),
                tcpClient.listTasks()
            ];
            
            const results = await Promise.allSettled(skewOperations);
            const successful = results.filter(r => 
                r.status === 'fulfilled' && 
                (r as PromiseFulfilledResult<any>).value.success
            );
            
            // Verify system maintains consistency
            const finalTask1 = await tcpClient.getTask(task1Id);
            const finalTask2 = await tcpClient.getTask(task2Id);
            
            assert.ok(finalTask1.success && finalTask2.success);
            assert.ok(successful.length >= 4, "Should handle most write skew operations");
            
            console.log(`Write skew test: ${successful.length}/${skewOperations.length} successful`);
        });

        it("should handle livelock scenarios with competing priorities", async () => {
            const taskIds: string[] = [];
            
            // Create tasks for livelock testing
            for (let i = 0; i < 4; i++) {
                const result = await tcpClient.createTask({
                    title: `${TASK_ID_PREFIX} Livelock Task ${i}`,
                    description: `Livelock test task ${i}`,
                    priority: "medium",
                    createdBy: "integration-test-b7c2d592"
                });
                
                if (result.success && result.data) {
                    taskIds.push(result.data.id);
                }
            }
            
            // Simulate competing priority changes that could cause livelock
            const livelockOperations: Promise<any>[] = [];
            for (let round = 0; round < 3; round++) {
                for (const taskId of taskIds) {
                    // Rapid priority cycling
                    livelockOperations.push(
                        tcpClient.updateTaskPriority(taskId, "high"),
                        tcpClient.updateTaskStatus(taskId, "in-progress"),
                        tcpClient.updateTaskPriority(taskId, "low"),
                        tcpClient.updateTaskStatus(taskId, "todo")
                    );
                }
            }
            
            const startTime = Date.now();
            const results = await Promise.allSettled(livelockOperations);
            const endTime = Date.now();
            
            const successful = results.filter(r => 
                r.status === 'fulfilled' && 
                (r as PromiseFulfilledResult<any>).value.success
            );
            
            // Should complete within reasonable time (no livelock)
            assert.ok(endTime - startTime < 20000, "Should complete operations within 20 seconds (avoid livelock)");
            assert.ok(successful.length >= livelockOperations.length * 0.6, 
                "Should handle at least 60% of livelock operations");
            
            // Verify all tasks remain accessible
            for (const taskId of taskIds) {
                const verifyResult = await tcpClient.getTask(taskId);
                assert.ok(verifyResult.success && verifyResult.data, 
                    `Task ${taskId} should remain accessible after livelock test`);
            }
            
            console.log(`Livelock test: ${successful.length}/${livelockOperations.length} successful in ${endTime - startTime}ms`);
        });

        it("should handle timestamp-based race conditions with rapid updates", async () => {
            const createResult = await tcpClient.createTask({
                title: `${TASK_ID_PREFIX} Timestamp Race Test`,
                description: "Task for timestamp race condition testing",
                priority: "medium",
                createdBy: "integration-test-b7c2d592"
            });
            
            assert.ok(createResult.success && createResult.data);
            const taskId = createResult.data.id;
            
            // Rapid updates to test timestamp handling
            const timestampOperations: Promise<any>[] = Array.from({ length: 15 }, (_, i) => 
                tcpClient.updateTaskStatus(taskId, i % 2 === 0 ? "in-progress" : "done")
            );
            
            // Add some priority updates to increase complexity
            const priorityOperations: Promise<any>[] = Array.from({ length: 10 }, (_, i) => 
                tcpClient.updateTaskPriority(taskId, ["high", "medium", "low"][i % 3])
            );
            
            const allOperations = [...timestampOperations, ...priorityOperations];
            const results = await Promise.allSettled(allOperations);
            
            const successful = results.filter(r => 
                r.status === 'fulfilled' && 
                (r as PromiseFulfilledResult<any>).value.success
            );
            
            // Verify final state consistency
            const finalResult = await tcpClient.getTask(taskId);
            assert.ok(finalResult.success && finalResult.data);
            
            // Check timestamp progression
            const initialTime = new Date(createResult.data.createdAt).getTime();
            const finalTime = new Date(finalResult.data.updatedAt).getTime();
            assert.ok(finalTime >= initialTime, "Final timestamp should be >= initial timestamp");
            
            assert.ok(successful.length >= allOperations.length * 0.7, 
                "Should handle at least 70% of timestamp race operations");
            
            console.log(`Timestamp race: ${successful.length}/${allOperations.length} successful operations`);
        });

        it("should handle nested transaction-like behavior with task dependencies", async () => {
            // Create a chain of dependent tasks
            const taskChain: string[] = [];
            const chainLength = 3;
            
            for (let i = 0; i < chainLength; i++) {
                const result = await tcpClient.createTask({
                    title: `${TASK_ID_PREFIX} Chain Task ${i}`,
                    description: `Chain task ${i} with dependencies`,
                    priority: "medium",
                    createdBy: "integration-test-b7c2d592",
                    dependencies: i > 0 ? [taskChain[i - 1]] : []
                });
                
                if (result.success && result.data) {
                    taskChain.push(result.data.id);
                }
            }
            
            // Concurrent operations on the dependency chain
            const chainOperations: Promise<any>[] = taskChain.flatMap((taskId, index) => [
                // Update status based on position in chain
                tcpClient.updateTaskStatus(taskId, index === 0 ? "in-progress" : "todo"),
                // Update priority based on dependencies
                tcpClient.updateTaskPriority(taskId, index % 2 === 0 ? "high" : "medium"),
                // Read operations to verify consistency
                tcpClient.getTask(taskId)
            ]);
            
            const results = await Promise.allSettled(chainOperations);
            const successful = results.filter(r => 
                r.status === 'fulfilled' && 
                (r as PromiseFulfilledResult<any>).value.success
            );
            
            // Verify chain integrity
            for (let i = 0; i < taskChain.length; i++) {
                const verifyResult = await tcpClient.getTask(taskChain[i]);
                assert.ok(verifyResult.success && verifyResult.data, 
                    `Chain task ${i} should remain accessible`);
                
                // Verify dependencies are maintained
                if (i > 0) {
                    const expectedDeps = [taskChain[i - 1]];
                    assert.deepEqual(verifyResult.data!.dependencies, expectedDeps, 
                        `Task ${i} should maintain dependency on task ${i - 1}`);
                }
            }
            
            assert.ok(successful.length >= chainOperations.length * 0.8, 
                "Should handle at least 80% of dependency chain operations");
            
            console.log(`Dependency chain: ${successful.length}/${chainOperations.length} successful operations`);
        });

        it("should handle memory consistency model scenarios", async () => {
            const taskIds: string[] = [];
            const taskCount = 6;
            
            // Create tasks for memory consistency testing
            for (let i = 0; i < taskCount; i++) {
                const result = await tcpClient.createTask({
                    title: `${TASK_ID_PREFIX} Memory Model Task ${i}`,
                    description: `Memory consistency test task ${i}`,
                    priority: "medium",
                    createdBy: "integration-test-b7c2d592"
                });
                
                if (result.success && result.data) {
                    taskIds.push(result.data.id);
                }
            }
            
            // Simulate operations that might expose memory consistency issues
            const memoryOps: Promise<any>[] = [];
            
            // Phase 1: Parallel writes
            for (const taskId of taskIds) {
                memoryOps.push(
                    tcpClient.updateTaskStatus(taskId, "in-progress"),
                    tcpClient.updateTaskPriority(taskId, "high")
                );
            }
            
            // Phase 2: Parallel reads while writes are happening
            for (let i = 0; i < 5; i++) {
                memoryOps.push(...taskIds.map(taskId => tcpClient.getTask(taskId)));
            }
            
            // Phase 3: More writes
            for (const taskId of taskIds) {
                memoryOps.push(
                    tcpClient.updateTaskStatus(taskId, "done"),
                    tcpClient.updateTaskPriority(taskId, "low")
                );
            }
            
            const results = await Promise.allSettled(memoryOps);
            const successful = results.filter(r => 
                r.status === 'fulfilled' && 
                (r as PromiseFulfilledResult<any>).value.success
            );
            
            // Verify memory consistency - all reads should see valid states
            const readResults = results.filter(r => 
                r.status === 'fulfilled' && 
                (r as PromiseFulfilledResult<any>).value.success &&
                (r as PromiseFulfilledResult<any>).value.data?.id
            );
            
            for (const read of readResults) {
                const data = (read as PromiseFulfilledResult<any>).value.data;
                assert.ok(["todo", "in-progress", "done"].includes(data.status), 
                    `Read should see valid status: ${data.status}`);
                assert.ok(["high", "medium", "low"].includes(data.priority), 
                    `Read should see valid priority: ${data.priority}`);
            }
            
            // Final verification of all tasks
            for (const taskId of taskIds) {
                const finalResult = await tcpClient.getTask(taskId);
                assert.ok(finalResult.success && finalResult.data, 
                    `Final check: Task ${taskId} should be accessible`);
            }
            
            assert.ok(successful.length >= memoryOps.length * 0.6, 
                "Should handle at least 60% of memory consistency operations");
            
            console.log(`Memory model: ${successful.length}/${memoryOps.length} successful operations`);
        });
    });
});
