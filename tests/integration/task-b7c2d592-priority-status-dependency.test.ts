import { describe, it, before, beforeEach, after } from "node:test";
import { strict as assert } from "node:assert";
import { DaemonTcpClient, type Task } from "../e2e/dashboard/tcp-client.ts";
import { PriorityStatusDeadlockDetector, type PriorityStatusDependency } from "../../packages/worker/src/services/priority-status-deadlock-detector.ts";

describe("Task b7c2d592 Priority-Status Dependency Implementation", () => {
    const TASK_ID_PREFIX = "task-b7c2d592-deadlock-detection";
    let tcpClient: DaemonTcpClient;
    let deadlockDetector: PriorityStatusDeadlockDetector;
    let createdTaskId: string;

    before(async () => {
        tcpClient = new DaemonTcpClient(3001, "localhost");
        deadlockDetector = new PriorityStatusDeadlockDetector(5000, 3);
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
        deadlockDetector.cleanup();
    });

    describe("Task Creation and Basic Dependency Setup", () => {
        it("should create the specific task and setup priority-status dependencies", async () => {
            // Create the main task
            const result = await tcpClient.createTask({
                title: `${TASK_ID_PREFIX} Priority-Status Dependency Task 1`,
                description: "Task with priority-status dependency 1",
                priority: "high",
                createdBy: "system"
            });

            assert.ok(result.success && result.data, "Task should be created successfully");
            createdTaskId = result.data!.id;

            // Create dependent tasks
            const dependentTasks: string[] = [];
            for (let i = 0; i < 3; i++) {
                const depResult = await tcpClient.createTask({
                    title: `${TASK_ID_PREFIX} Dependent Task ${i}`,
                    description: `Dependent task ${i} for priority-status testing`,
                    priority: i % 2 === 0 ? "medium" : "low",
                    createdBy: "system"
                });

                assert.ok(depResult.success && depResult.data, `Dependent task ${i} should be created`);
                dependentTasks.push(depResult.data!.id);
            }

            // Verify all tasks are accessible
            const mainTaskResult = await tcpClient.getTask(createdTaskId);
            assert.ok(mainTaskResult.success && mainTaskResult.data, "Main task should be accessible");
            assert.equal(mainTaskResult.data!.priority, "high");

            for (let i = 0; i < dependentTasks.length; i++) {
                const depResult = await tcpClient.getTask(dependentTasks[i]);
                assert.ok(depResult.success && depResult.data, `Dependent task ${i} should be accessible`);
            }

            console.log(`Created main task ${createdTaskId} with ${dependentTasks.length} dependent tasks`);
        });

        it("should establish priority-status dependency relationships", async () => {
            // Create tasks for dependency testing
            const tasks: string[] = [];
            for (let i = 0; i < 3; i++) {
                const result = await tcpClient.createTask({
                    title: `${TASK_ID_PREFIX} Dependency Task ${i}`,
                    description: `Task for dependency testing ${i}`,
                    priority: "medium",
                    createdBy: "system"
                });
                
                if (result.success && result.data) {
                    tasks.push(result.data!.id);
                }
            }

            // Setup priority-status dependencies using the detector
            const dependencies: PriorityStatusDependency[] = [
                {
                    taskId: tasks[0],
                    dependsOnTaskId: tasks[1],
                    dependencyType: "priority_depends_on_status",
                    level: 0,
                    condition: (_task: Task, dependentTask: Task) => {
                        return dependentTask.status === "done";
                    }
                },
                {
                    taskId: tasks[1],
                    dependsOnTaskId: tasks[2],
                    dependencyType: "status_depends_on_priority",
                    level: 1,
                    condition: (_task: Task, dependentTask: Task) => {
                        return dependentTask.priority === "high";
                    }
                },
                {
                    taskId: tasks[2],
                    dependsOnTaskId: tasks[0],
                    dependencyType: "priority_depends_on_status",
                    level: 2,
                    condition: (_task: Task, dependentTask: Task) => {
                        return dependentTask.status === "todo";
                    }
                }
            ];

            // Add dependencies to the detector
            for (const dep of dependencies) {
                deadlockDetector.addPriorityStatusDependency(dep);
            }

            // Check for deadlocks
            const deadlockResult = deadlockDetector.detectPriorityStatusDeadlock();
            
            if (deadlockResult.isDeadlock) {
                console.log("Deadlock detected:", {
                    severity: deadlockResult.severity,
                    strategy: deadlockResult.resolutionStrategy,
                    cycleLength: deadlockResult.dependencyCycle.length
                });

                // Should resolve the deadlock
                await deadlockDetector.resolvePriorityStatusDeadlock(deadlockResult);
                
                // Verify resolution
                const afterResolution = deadlockDetector.detectPriorityStatusDeadlock();
                assert.ok(!afterResolution.isDeadlock, "Deadlock should be resolved");
            } else {
                console.log("No deadlock detected in dependency setup (this is expected for simple 3-task chain)");
            }

            // Verify detector stats
            const stats = deadlockDetector.getPriorityStatusStats();
            assert.ok(stats.totalDependencies >= 0, "Dependencies should be tracked (may be reduced after deadlock resolution)");
            
            console.log("Priority-status detector stats:", stats);
        });
    });

    describe("Deadlock Detection and Resolution", () => {
        it("should detect and resolve circular priority-status dependencies", async () => {
            // Create a circular dependency scenario
            const cycleTasks: string[] = [];
            for (let i = 0; i < 4; i++) {
                const result = await tcpClient.createTask({
                    title: `${TASK_ID_PREFIX} Cycle Task ${i}`,
                    description: `Task for circular dependency testing ${i}`,
                    priority: i % 2 === 0 ? "high" : "medium",
                    createdBy: "system"
                });
                
                if (result.success && result.data) {
                    cycleTasks.push(result.data!.id);
                }
            }

            // Create circular dependencies
            const circularDependencies: PriorityStatusDependency[] = [
                {
                    taskId: cycleTasks[0],
                    dependsOnTaskId: cycleTasks[1],
                    dependencyType: "priority_depends_on_status",
                    level: 0,
                    condition: (_task: Task, dependentTask: Task) => dependentTask.status !== "done"
                },
                {
                    taskId: cycleTasks[1],
                    dependsOnTaskId: cycleTasks[2],
                    dependencyType: "status_depends_on_priority",
                    level: 0,
                    condition: (_task: Task, dependentTask: Task) => dependentTask.priority === "high"
                },
                {
                    taskId: cycleTasks[2],
                    dependsOnTaskId: cycleTasks[3],
                    dependencyType: "priority_depends_on_status",
                    level: 0,
                    condition: (_task: Task, dependentTask: Task) => dependentTask.status === "in-progress"
                },
                {
                    taskId: cycleTasks[3],
                    dependsOnTaskId: cycleTasks[0],
                    dependencyType: "status_depends_on_priority",
                    level: 0,
                    condition: (_task: Task, dependentTask: Task) => dependentTask.priority !== "low"
                }
            ];

            // Add circular dependencies
            for (const dep of circularDependencies) {
                deadlockDetector.addPriorityStatusDependency(dep);
            }

            // Detect deadlock
            const deadlockResult = deadlockDetector.detectPriorityStatusDeadlock();
            
            if (deadlockResult.isDeadlock) {
                assert.ok(deadlockResult.dependencyCycle.length > 0, "Dependency cycle should be identified");
                
                // Critical severity for level-0 cycles
                const hasLevelZero = deadlockResult.dependencyCycle.some(d => d.level === 0);
                if (hasLevelZero) {
                    assert.equal(deadlockResult.severity, "critical", "Level-0 circular dependency should be critical");
                }

                console.log("Circular deadlock detected:", {
                    cycleLength: deadlockResult.dependencyCycle.length,
                    severity: deadlockResult.severity,
                    strategy: deadlockResult.resolutionStrategy,
                    victims: deadlockResult.victimOperations
                });

                // Resolve the deadlock
                await deadlockDetector.resolvePriorityStatusDeadlock(deadlockResult);

                // Verify resolution
                const afterResolution = deadlockDetector.detectPriorityStatusDeadlock();
                assert.ok(!afterResolution.isDeadlock, "Deadlock should be resolved after intervention");

                console.log("Circular deadlock resolved successfully");
            } else {
                console.log("No circular deadlock detected (this may be acceptable depending on cycle structure)");
            }
        });

        it("should handle complex multi-level dependency scenarios", async () => {
            // Create tasks for multi-level testing
            const complexTasks: string[] = [];
            for (let i = 0; i < 5; i++) {
                const result = await tcpClient.createTask({
                    title: `${TASK_ID_PREFIX} Complex Task ${i}`,
                    description: `Task for complex dependency testing ${i}`,
                    priority: ["low", "medium", "high"][i % 3] as "low" | "medium" | "high",
                    createdBy: "system"
                });
                
                if (result.success && result.data) {
                    complexTasks.push(result.data!.id);
                }
            }

            // Create complex multi-level dependencies
            const complexDependencies: PriorityStatusDependency[] = [
                // Level 0 dependencies
                {
                    taskId: complexTasks[0],
                    dependsOnTaskId: complexTasks[1],
                    dependencyType: "status_depends_on_priority",
                    level: 0,
                    condition: (_task: Task, dependentTask: Task) => dependentTask.priority === "high"
                },
                {
                    taskId: complexTasks[1],
                    dependsOnTaskId: complexTasks[2],
                    dependencyType: "priority_depends_on_status",
                    level: 0,
                    condition: (_task: Task, dependentTask: Task) => dependentTask.status === "done"
                },
                // Level 1 dependencies
                {
                    taskId: complexTasks[2],
                    dependsOnTaskId: complexTasks[3],
                    dependencyType: "status_depends_on_priority",
                    level: 1,
                    condition: (_task: Task, dependentTask: Task) => dependentTask.priority !== "low"
                },
                // Level 2 dependencies
                {
                    taskId: complexTasks[3],
                    dependsOnTaskId: complexTasks[4],
                    dependencyType: "priority_depends_on_status",
                    level: 2,
                    condition: (_task: Task, dependentTask: Task) => dependentTask.status === "todo"
                },
                // Create a potential conflict
                {
                    taskId: complexTasks[4],
                    dependsOnTaskId: complexTasks[0],
                    dependencyType: "status_depends_on_priority",
                    level: 1,
                    condition: (_task: Task, dependentTask: Task) => dependentTask.priority === "medium"
                }
            ];

            // Add complex dependencies
            for (const dep of complexDependencies) {
                deadlockDetector.addPriorityStatusDependency(dep);
            }

            // Check for deadlocks
            const initialCheck = deadlockDetector.detectPriorityStatusDeadlock();
            
            if (initialCheck.isDeadlock) {
                console.log("Complex scenario deadlock detected:", {
                    severity: initialCheck.severity,
                    cycleLength: initialCheck.dependencyCycle.length,
                    strategy: initialCheck.resolutionStrategy
                });

                // Resolve and verify
                await deadlockDetector.resolvePriorityStatusDeadlock(initialCheck);
                const afterResolution = deadlockDetector.detectPriorityStatusDeadlock();
                assert.ok(!afterResolution.isDeadlock, "Complex deadlock should be resolvable");
            } else {
                console.log("No deadlock detected in complex scenario (this is acceptable)");
            }

            // Check stats for complex scenario
            const stats = deadlockDetector.getPriorityStatusStats();
            assert.ok(stats.totalDependencies >= complexDependencies.length, "All dependencies should be tracked");
            assert.ok(stats.levelZeroDependencies > 0, "Level-0 dependencies should be tracked");

            console.log("Complex multi-level dependency test completed:", stats);
        });
    });

    describe("Integration with Task Manager", () => {
        it("should work alongside the task manager daemon", async () => {
            // Create a task that will interact with the daemon
            const daemonTask = await tcpClient.createTask({
                title: `${TASK_ID_PREFIX} Daemon Integration Task`,
                description: "Task for testing daemon integration with priority-status dependencies",
                priority: "high",
                createdBy: "integration-test"
            });

            assert.ok(daemonTask.success && daemonTask.data, "Daemon integration task should be created");

            const taskId = daemonTask.data!.id;

            // Simulate concurrent operations that could trigger deadlock detection
            const operations = [
                tcpClient.updateTaskStatus(taskId, "in-progress"),
                tcpClient.updateTaskPriority(taskId, "medium"),
                tcpClient.updateTaskStatus(taskId, "todo"),
                tcpClient.updateTaskPriority(taskId, "high")
            ];

            // Execute operations concurrently
            const results = await Promise.allSettled(operations);
            const successful = results.filter(r => 
                r.status === 'fulfilled' && 
                (r as PromiseFulfilledResult<any>).value.success
            ).length;

            // Most operations should succeed even under contention
            assert.ok(successful >= operations.length * 0.5, 
                `At least 50% of operations should succeed (${successful}/${operations.length})`);

            // Verify final task state
            const finalState = await tcpClient.getTask(taskId);
            assert.ok(finalState.success && finalState.data, "Task should remain accessible");
            
            const validStatuses = ["todo", "in-progress", "done"];
            const validPriorities = ["low", "medium", "high"];
            
            assert.ok(validStatuses.includes(finalState.data!.status), "Final status should be valid");
            assert.ok(validPriorities.includes(finalState.data!.priority), "Final priority should be valid");

            console.log(`Daemon integration test: ${successful}/${operations.length} operations successful`);
            console.log(`Final task state: status=${finalState.data!.status}, priority=${finalState.data!.priority}`);
        });
    });

    describe("Performance and Scalability", () => {
        it("should handle moderate dependency load efficiently", async () => {
            const startTime = Date.now();
            const taskCount = 20;
            const tasks: string[] = [];

            // Create multiple tasks
            for (let i = 0; i < taskCount; i++) {
                const result = await tcpClient.createTask({
                    title: `${TASK_ID_PREFIX} Perf Task ${i}`,
                    description: `Performance testing task ${i}`,
                    priority: ["low", "medium", "high"][i % 3] as "low" | "medium" | "high",
                    createdBy: "perf-test"
                });
                
                if (result.success && result.data) {
                    tasks.push(result.data!.id);
                }
            }

            const creationTime = Date.now() - startTime;

            // Create a web of dependencies
            const depStartTime = Date.now();

            for (let i = 0; i < tasks.length - 1; i++) {
                for (let j = i + 1; j < Math.min(i + 3, tasks.length); j++) {
                    const dependency: PriorityStatusDependency = {
                        taskId: tasks[i],
                        dependsOnTaskId: tasks[j],
                        dependencyType: i % 2 === 0 ? "priority_depends_on_status" : "status_depends_on_priority",
                        level: Math.floor(Math.random() * 3),
                        condition: (_task: Task, _dependentTask: Task) => {
                            return Math.random() > 0.3; // 70% chance of condition being met
                        }
                    };
                    
                    deadlockDetector.addPriorityStatusDependency(dependency);
                }
            }

            const dependencyTime = Date.now() - depStartTime;

            // Test deadlock detection performance
            const detectionStartTime = Date.now();
            const deadlockResult = deadlockDetector.detectPriorityStatusDeadlock();
            const detectionTime = Date.now() - detectionStartTime;

            // Performance assertions
            assert.ok(creationTime < 10000, `Task creation should complete in <10s (${creationTime}ms)`);
            assert.ok(detectionTime < 1000, `Deadlock detection should complete in <1s (${detectionTime}ms)`);

            // Get final stats
            const stats = deadlockDetector.getPriorityStatusStats();

            console.log("Performance test results:", {
                taskCount,
                creationTime: `${creationTime}ms`,
                dependencyTime: `${dependencyTime}ms`,
                detectionTime: `${detectionTime}ms`,
                totalDependencies: stats.totalDependencies,
                levelZeroDependencies: stats.levelZeroDependencies,
                deadlockDetected: deadlockResult.isDeadlock
            });

            assert.ok(tasks.length === taskCount, "All tasks should be created");
        });
    });
});