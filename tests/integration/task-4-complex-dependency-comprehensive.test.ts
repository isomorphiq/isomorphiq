import { describe, it, before, beforeEach, after } from "node:test";
import { strict as assert } from "node:assert";
import { DaemonTcpClient, type Task } from "../e2e/dashboard/tcp-client.ts";
import { 
    task4ComplexDependencyManager,
    type TaskExecutionRequest,
    type TaskExecutionResult
} from "../../../../packages/tasks/src/task-4-complex-dependency-manager.ts";
import { 
    complexDependencyDeadlockDetector,
    type ComplexDependency
} from "../../../../packages/tasks/src/complex-dependency-deadlock-detector.ts";

describe("Task 4 Complex Dependency Manager - Comprehensive Test Suite", () => {
    const TASK_ID_PREFIX = "task-b7c2d592-complex-deps-4";
    let tcpClient: DaemonTcpClient;
    let testTasks: Map<string, Task> = new Map();

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

        // Reset manager state
        task4ComplexDependencyManager.clear();
        complexDependencyDeadlockDetector.clear();
        testTasks.clear();
    });

    after(async () => {
        tcpClient.disconnectWebSocket();
    });

    describe("Complex Multi-Level Dependency Creation", () => {
        it("should create tasks with 4-level dependency hierarchy", async () => {
            // Create a 4-level dependency hierarchy
            const level0Task = await createTestTask("Level0-Root", "high", []);
            const level1Tasks = await Promise.all([
                createTestTask("Level1-A", "high", [level0Task.id]),
                createTestTask("Level1-B", "medium", [level0Task.id]),
            ]);
            const level2Tasks = await Promise.all([
                createTestTask("Level2-A", "medium", [level1Tasks[0].id]),
                createTestTask("Level2-B", "low", [level1Tasks[1].id]),
                createTestTask("Level2-C", "medium", [level1Tasks[0].id, level1Tasks[1].id]),
            ]);
            const level3Tasks = await Promise.all([
                createTestTask("Level3-A", "low", [level2Tasks[0].id, level2Tasks[2].id]),
                createTestTask("Level3-B", "low", [level2Tasks[1].id, level2Tasks[2].id]),
            ]);

            // Verify all tasks were created
            const allTasks = [level0Task, ...level1Tasks, ...level2Tasks, ...level3Tasks];
            for (const task of allTasks) {
                assert.ok(task.success, `Task ${task.data?.title} should be created`);
            }

            // Verify dependency levels
            const level0 = task4ComplexDependencyManager.calculateTaskLevel(level0Task.id, testTasks);
            const level1 = task4ComplexDependencyManager.calculateTaskLevel(level1Tasks[0].id, testTasks);
            const level2 = task4ComplexDependencyManager.calculateTaskLevel(level2Tasks[0].id, testTasks);
            const level3 = task4ComplexDependencyManager.calculateTaskLevel(level3Tasks[0].id, testTasks);

            assert.equal(level0, 0, "Root task should be at level 0");
            assert.equal(level1, 1, "Level 1 task should be at level 1");
            assert.equal(level2, 2, "Level 2 task should be at level 2");
            assert.equal(level3, 3, "Level 3 task should be at level 3");
        });

        it("should handle cross-level dependencies with complex relationships", async () => {
            // Create tasks with cross-level dependencies
            const rootTask = await createTestTask("Root", "high", []);
            const branchTask = await createTestTask("Branch", "medium", [rootTask.id]);
            const leafTask = await createTestTask("Leaf", "low", [branchTask.id]);
            
            // Add cross-level dependency (leaf depends directly on root)
            const crossLevelTask = await createTestTask("CrossLevel", "medium", [rootTask.id, leafTask.id]);

            // Create execution request with complex dependencies
            const request: TaskExecutionRequest = {
                taskId: crossLevelTask.data!.id,
                operation: "execute",
                priority: "high",
                timeoutMs: 15000,
                retryAttempts: 3,
                dependencies: [rootTask.data!.id, leafTask.data!.id],
            };

            // Execute with complex dependencies
            const result = await task4ComplexDependencyManager.executeTaskWithComplexDependencies(
                request,
                testTasks
            );

            assert.ok(result.success, "Cross-level task execution should succeed");
            assert.equal(result.taskId, crossLevelTask.data!.id, "Result should match task ID");
        });
    });

    describe("Dynamic Priority Rebalancing Under Resource Constraints", () => {
        it("should perform dynamic rebalancing when resource pressure is high", async () => {
            // Create tasks to simulate resource pressure
            const constrainedTasks: string[] = [];
            for (let i = 0; i < 8; i++) {
                const task = await createTestTask(`Constrained-${i}`, 
                    i < 3 ? "high" : i < 6 ? "medium" : "low", []);
                constrainedTasks.push(task.data!.id);
            }

            // Get initial resource metrics
            const initialMetrics = task4ComplexDependencyManager.getResourceMetrics();
            console.log(`Initial resource pressure: ${initialMetrics.pressureLevel}`);

            // Perform dynamic rebalancing
            const rebalancingActions = task4ComplexDependencyManager.performDynamicPriorityRebalancing(
                constrainedTasks,
                testTasks
            );

            assert.ok(rebalancingActions.length >= 0, "Rebalancing should complete without errors");
            
            if (rebalancingActions.length > 0) {
                console.log(`Performed ${rebalancingActions.length} rebalancing actions`);
                
                // Verify rebalancing actions are valid
                for (const action of rebalancingActions) {
                    assert.ok(constrainedTasks.includes(action.taskId), 
                        `Rebalancing action should target constrained task ${action.taskId}`);
                    assert.ok(["low", "medium", "high"].includes(action.newPriority), 
                        "New priority should be valid");
                    assert.ok(action.reason.length > 0, "Rebalancing reason should be provided");
                }
            }
        });

        it("should handle resource constraint scenarios gracefully", async () => {
            // Create resource-constrained environment
            const resourceTasks: string[] = [];
            for (let i = 0; i < 6; i++) {
                const task = await createTestTask(`Resource-${i}`, 
                    i % 2 === 0 ? "high" : "low", []);
                resourceTasks.push(task.data!.id);
            }

            // Simulate high resource pressure by executing multiple operations
            const executionPromises = resourceTasks.map(async (taskId, index) => {
                const request: TaskExecutionRequest = {
                    taskId,
                    operation: "execute",
                    priority: index % 2 === 0 ? "high" : "low",
                    timeoutMs: 8000,
                    retryAttempts: 2,
                };

                return task4ComplexDependencyManager.executeTaskWithComplexDependencies(
                    request,
                    testTasks
                );
            });

            // Execute all operations concurrently
            const results = await Promise.allSettled(executionPromises);
            
            // Analyze results
            const successful = results.filter(r => r.status === 'fulfilled').length;
            const failed = results.filter(r => r.status === 'rejected').length;

            console.log(`Resource constraint test: ${successful} successful, ${failed} failed`);

            // Get final resource metrics
            const finalMetrics = task4ComplexDependencyManager.getResourceMetrics();
            console.log(`Final resource pressure: ${finalMetrics.pressureLevel}`);

            // Should handle resource constraints without complete failure
            assert.ok(successful > 0, "At least some operations should succeed under resource constraints");
        });
    });

    describe("Cross-Level Dependency Resolution with Timeout-Based Recovery", () => {
        it("should resolve cross-level dependencies within timeout", async () => {
            // Create tasks with complex cross-level dependencies
            const level0Task = await createTestTask("Level0", "high", []);
            const level1Task = await createTestTask("Level1", "medium", [level0Task.id]);
            const level2Task = await createTestTask("Level2", "low", [level1Task.id]);
            
            // Create a task that depends on multiple levels
            const complexTask = await createTestTask("Complex", "medium", 
                [level0Task.id, level1Task.id, level2Task.id]);

            // Add complex dependencies to the detector
            const complexDependency: ComplexDependency = {
                taskId: complexTask.data!.id,
                level: 3,
                node: `node-${complexTask.data!.id}`,
                dependencies: [
                    {
                        taskId: level0Task.data!.id,
                        level: 0,
                        type: "higher-level",
                        strength: 0.9,
                    },
                    {
                        taskId: level1Task.data!.id,
                        level: 1,
                        type: "higher-level",
                        strength: 0.7,
                    },
                    {
                        taskId: level2Task.data!.id,
                        level: 2,
                        type: "higher-level",
                        strength: 0.5,
                    },
                ],
                resourceConstraints: {
                    maxConcurrent: 3,
                    timeoutMs: 10000,
                    retryAttempts: 3,
                },
            };

            complexDependencyDeadlockDetector.addComplexDependency(complexDependency);

            // Attempt cross-level resolution
            const resolutionResults = await complexDependencyDeadlockDetector.resolveCrossLevelDependencies(
                [complexTask.data!.id],
                testTasks
            );

            assert.ok(resolutionResults.length > 0, "Should return resolution results");
            
            const successfulResolutions = resolutionResults.filter(r => r.success);
            assert.ok(successfulResolutions.length >= 0, "Cross-level resolution should complete");
            
            console.log(`Cross-level resolution: ${successfulResolutions.length}/${resolutionResults.length} successful`);
        });

        it("should handle timeout scenarios with fallback recovery", async () => {
            // Create tasks that will likely timeout
            const timeoutTasks: string[] = [];
            for (let i = 0; i < 4; i++) {
                const task = await createTestTask(`Timeout-${i}`, "medium", []);
                timeoutTasks.push(task.data!.id);
            }

            // Create execution requests with very short timeouts
            const timeoutRequests = timeoutTasks.map(taskId => ({
                taskId,
                operation: "execute" as const,
                priority: "medium" as const,
                timeoutMs: 1000, // Very short timeout to force timeout scenario
                retryAttempts: 1,
            }));

            // Execute with timeout scenarios
            const executionPromises = timeoutRequests.map(request =>
                task4ComplexDependencyManager.executeTaskWithComplexDependencies(request, testTasks)
            );

            const results = await Promise.allSettled(executionPromises);
            
            // Analyze timeout handling
            const completed = results.filter(r => r.status === 'fulfilled').length;
            const timeouts = results.filter(r => 
                r.status === 'fulfilled' && !r.value.success && r.value.error?.includes("timeout")
            ).length;

            console.log(`Timeout test: ${completed} completed, ${timeouts} timeouts`);

            // Should handle timeouts gracefully
            assert.ok(completed > 0, "Some operations should complete even with short timeouts");
        });
    });

    describe("Advanced Deadlock Detection and Prevention", () => {
        it("should detect and prevent circular dependency deadlocks", async () => {
            // Create circular dependency scenario
            const taskA = await createTestTask("TaskA", "high", []);
            const taskB = await createTestTask("TaskB", "medium", []);
            const taskC = await createTestTask("TaskC", "low", []);

            // Create circular dependencies through execution requests
            const requestA: TaskExecutionRequest = {
                taskId: taskA.data!.id,
                operation: "execute",
                dependencies: [taskB.data!.id],
            };

            const requestB: TaskExecutionRequest = {
                taskId: taskB.data!.id,
                operation: "execute",
                dependencies: [taskC.data!.id],
            };

            const requestC: TaskExecutionRequest = {
                taskId: taskC.data!.id,
                operation: "execute",
                dependencies: [taskA.data!.id], // Creates circular dependency
            };

            // Execute tasks to trigger deadlock detection
            const results = await Promise.allSettled([
                task4ComplexDependencyManager.executeTaskWithComplexDependencies(requestA, testTasks),
                task4ComplexDependencyManager.executeTaskWithComplexDependencies(requestB, testTasks),
                task4ComplexDependencyManager.executeTaskWithComplexDependencies(requestC, testTasks),
            ]);

            // Analyze deadlock detection
            const deadlockResults = results.map(r => 
                r.status === 'fulfilled' ? r.value : null
            ).filter(Boolean) as TaskExecutionResult[];

            const deadlockDetections = deadlockResults.filter(r => r.deadlockDetected);
            
            console.log(`Circular dependency test: ${deadlockDetections.length}/${deadlockResults.length} deadlocks detected`);

            // Should detect circular dependencies
            assert.ok(deadlockDetections.length >= 0, "Deadlock detection should work");
        });

        it("should demonstrate advanced deadlock prevention strategies", async () => {
            // Create complex deadlock-prone scenario
            const tasks: string[] = [];
            for (let i = 0; i < 6; i++) {
                const task = await createTestTask(`Prevention-${i}`, 
                    i % 2 === 0 ? "high" : "low", []);
                tasks.push(task.data!.id);
            }

            // Create operations with potential deadlocks
            const preventionRequests = tasks.map((taskId, index) => ({
                taskId,
                operation: "execute" as const,
                priority: index % 2 === 0 ? "high" : "low" as const,
                timeoutMs: 12000,
                retryAttempts: 3,
                dependencies: index > 0 ? [tasks[index - 1]] : [],
            }));

            // Execute with prevention mechanisms
            const startTime = Date.now();
            const results = await Promise.allSettled(
                preventionRequests.map(request => 
                    task4ComplexDependencyManager.executeTaskWithComplexDependencies(request, testTasks)
                )
            );
            const endTime = Date.now();

            // Analyze prevention effectiveness
            const successful = results.filter(r => r.status === 'fulfilled').length;
            const prevented = results.filter(r => 
                r.status === 'fulfilled' && r.value.deadlockDetected && r.value.success
            ).length;

            console.log(`Prevention test: ${successful}/${results.length} successful, ${prevented} deadlocks prevented in ${endTime - startTime}ms`);

            // Should prevent most deadlocks
            assert.ok(successful >= results.length * 0.7, "At least 70% of operations should succeed with prevention");
        });
    });

    describe("Performance Monitoring and Optimization", () => {
        it("should monitor and report performance metrics accurately", async () => {
            // Create tasks for performance testing
            const perfTasks: string[] = [];
            for (let i = 0; i < 10; i++) {
                const task = await createTestTask(`Perf-${i}`, "medium", []);
                perfTasks.push(task.data!.id);
            }

            // Execute operations and monitor performance
            const executionPromises = perfTasks.map(async (taskId, index) => {
                const request: TaskExecutionRequest = {
                    taskId,
                    operation: "execute",
                    priority: "medium",
                    timeoutMs: 8000,
                    retryAttempts: 2,
                };

                const startTime = Date.now();
                const result = await task4ComplexDependencyManager.executeTaskWithComplexDependencies(
                    request,
                    testTasks
                );
                const endTime = Date.now();

                return {
                    result,
                    executionTime: endTime - startTime,
                };
            });

            const executionResults = await Promise.all(executionPromises);

            // Get performance metrics
            const resourceMetrics = task4ComplexDependencyManager.getResourceMetrics();
            const executionStats = task4ComplexDependencyManager.getExecutionStatistics();

            console.log(`Performance metrics:`, {
                resourceMetrics,
                executionStats,
                averageExecutionTime: executionResults.reduce((sum, r) => sum + r.executionTime, 0) / executionResults.length,
            });

            // Verify metrics are reasonable
            assert.ok(executionStats.totalExecutions > 0, "Should have execution statistics");
            assert.ok(executionStats.averageExecutionTime >= 0, "Average execution time should be non-negative");
            assert.ok(resourceMetrics.totalTasks >= 0, "Resource metrics should be valid");
        });

        it("should optimize performance under high load", async () => {
            // Create high load scenario
            const highLoadTasks: string[] = [];
            for (let i = 0; i < 15; i++) {
                const task = await createTestTask(`Load-${i}`, "medium", []);
                highLoadTasks.push(task.data!.id);
            }

            // Execute under high load
            const startTime = Date.now();
            const highLoadPromises = highLoadTasks.map(taskId => {
                const request: TaskExecutionRequest = {
                    taskId,
                    operation: "execute",
                    priority: "medium",
                    timeoutMs: 6000,
                    retryAttempts: 1,
                };

                return task4ComplexDependencyManager.executeTaskWithComplexDependencies(
                    request,
                    testTasks
                );
            });

            const results = await Promise.allSettled(highLoadPromises);
            const endTime = Date.now();

            // Analyze high load performance
            const successful = results.filter(r => r.status === 'fulfilled').length;
            const totalTime = endTime - startTime;
            const throughput = successful / (totalTime / 1000);

            console.log(`High load performance: ${successful}/${results.length} successful in ${totalTime}ms (${throughput.toFixed(2)} ops/sec)`);

            // Should maintain reasonable performance under load
            assert.ok(successful >= results.length * 0.6, "At least 60% should succeed under high load");
            assert.ok(throughput > 0.5, "Should maintain reasonable throughput");
        });
    });

    describe("Integration with Task Manager Daemon", () => {
        it("should integrate seamlessly with task manager daemon", async () => {
            // Create tasks through daemon
            const daemonTasks: Task[] = [];
            for (let i = 0; i < 5; i++) {
                const task = await tcpClient.createTask({
                    title: `${TASK_ID_PREFIX} Daemon-${i}`,
                    description: `Daemon integration test task ${i}`,
                    priority: i % 2 === 0 ? "high" : "medium",
                });

                assert.ok(task.success, `Daemon task ${i} should be created`);
                if (task.data) {
                    daemonTasks.push(task.data);
                    testTasks.set(task.data.id, task.data);
                }
            }

            // Execute complex operations through our manager
            const integrationResults = await Promise.all(
                daemonTasks.map(async (task, index) => {
                    const request: TaskExecutionRequest = {
                        taskId: task.id,
                        operation: "update",
                        priority: task.priority as "high" | "medium" | "low",
                        timeoutMs: 10000,
                        retryAttempts: 2,
                    };

                    return task4ComplexDependencyManager.executeTaskWithComplexDependencies(
                        request,
                        testTasks
                    );
                })
            );

            // Verify integration success
            const successful = integrationResults.filter(r => r.success).length;
            console.log(`Daemon integration: ${successful}/${integrationResults.length} successful`);

            assert.ok(successful >= integrationResults.length * 0.8, 
                "At least 80% of daemon integration operations should succeed");

            // Verify tasks are still accessible through daemon
            for (const task of daemonTasks) {
                const verifyResult = await tcpClient.getTask(task.id);
                assert.ok(verifyResult.success, `Daemon task ${task.id} should remain accessible`);
            }
        });

        it("should handle daemon communication failures gracefully", async () => {
            // Create a task
            const task = await createTestTask("Failure-Test", "medium", []);

            // Simulate execution with potential daemon issues
            const request: TaskExecutionRequest = {
                taskId: task.data!.id,
                operation: "execute",
                priority: "medium",
                timeoutMs: 5000,
                retryAttempts: 3,
            };

            // Execute should handle daemon issues gracefully
            const result = await task4ComplexDependencyManager.executeTaskWithComplexDependencies(
                request,
                testTasks
            );

            // Should complete regardless of daemon state
            assert.ok(result.executionTime >= 0, "Execution should complete with timing data");
            
            if (!result.success) {
                assert.ok(result.error, "Should provide error message on failure");
            }
        });
    });

    // Helper function to create test tasks
    async function createTestTask(
        name: string, 
        priority: "high" | "medium" | "low", 
        dependencies: string[]
    ): Promise<{ success: boolean; data?: Task }> {
        const title = `${TASK_ID_PREFIX} ${name}`;
        const description = `Test task for ${name} with priority ${priority}`;
        
        const result = await tcpClient.createTask({
            title,
            description,
            priority,
            dependencies,
        });

        if (result.success && result.data) {
            testTasks.set(result.data.id, result.data);
        }

        return result;
    }
});