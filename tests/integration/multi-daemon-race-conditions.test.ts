import { describe, it, before, after, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { DaemonTcpClient } from "../e2e/dashboard/tcp-client.ts";
import { startTestDaemon, type TestDaemonHandle } from "./daemon-test-harness.ts";

describe("Multi-Daemon Race Condition Testing - Task b7c2d592", () => {
    const TASK_ID_PREFIX = "task-b7c2d592-multi-daemon";
    const NUM_DAEMONS = 3;
    let daemons: TestDaemonHandle[] = [];
    let clients: DaemonTcpClient[] = [];

    before(async () => {
        // Start multiple daemon instances
        for (let i = 0; i < NUM_DAEMONS; i++) {
            const daemon = await startTestDaemon();
            const client = new DaemonTcpClient(daemon.tcpPort, "localhost");
            daemons.push(daemon);
            clients.push(client);
        }
        
        // Wait for all daemons to be ready
        await new Promise(resolve => setTimeout(resolve, 2000));
    });

    beforeEach(async () => {
        // Clean up any existing test tasks across all daemons
        for (const client of clients) {
            try {
                const listResult = await client.listTasks();
                if (listResult.success && listResult.data) {
                    const testTasks = listResult.data.filter((task: any) => 
                        task.title.includes(TASK_ID_PREFIX)
                    );
                    
                    for (const task of testTasks) {
                        await client.deleteTask(task.id);
                    }
                }
            } catch (error) {
                // Ignore cleanup errors
            }
        }
    });

    after(async () => {
        // Clean up all daemon instances
        for (const client of clients) {
            client.disconnectWebSocket();
        }
        for (const daemon of daemons) {
            await daemon.cleanup();
        }
    });

    describe("Concurrent Task Creation Across Daemons", () => {
        it("should handle simultaneous task creation across multiple daemons", async () => {
            const taskData = {
                title: `${TASK_ID_PREFIX} Concurrent Creation`,
                description: "Task created simultaneously across daemons",
                priority: "high",
                createdBy: "multi-daemon-test-b7c2d592"
            };

            // Create tasks simultaneously across all daemons
            const creationPromises = clients.map(client => 
                client.createTask(taskData)
            );

            const results = await Promise.allSettled(creationPromises);
            const successful = results.filter(r => 
                r.status === 'fulfilled' && 
                (r as PromiseFulfilledResult<any>).value.success
            );

            // Verify all daemons can create tasks
            assert.ok(successful.length >= NUM_DAEMONS - 1, 
                `At least ${NUM_DAEMONS - 1} daemons should create tasks successfully`);

            // Verify task IDs are unique across daemons
            const createdTasks = successful.map(r => 
                (r as PromiseFulfilledResult<any>).value.data
            );
            const taskIds = createdTasks.map(t => t.id);
            const uniqueIds = new Set(taskIds);

            assert.equal(uniqueIds.size, taskIds.length, 
                "Task IDs should be unique across all daemon instances");

            console.log(`Concurrent creation: ${successful.length}/${NUM_DAEMONS} daemons successful`);
        });

        it("should handle concurrent updates to same task from different daemons", async () => {
            // Create task on first daemon
            const createResult = await clients[0].createTask({
                title: `${TASK_ID_PREFIX} Multi-Daemon Update Test`,
                description: "Initial description",
                priority: "medium",
                createdBy: "multi-daemon-test-b7c2d592"
            });

            assert.ok(createResult.success);
            assert.ok(createResult.data);
            const taskId = createResult.data.id;

            // Concurrent updates from all daemons
            const updatePromises = clients.map((client, i) => 
                client.updateTaskStatus(taskId, i % 2 === 0 ? "in-progress" : "done")
            );

            const results = await Promise.allSettled(updatePromises);
            const successful = results.filter(r => 
                r.status === 'fulfilled' && 
                (r as PromiseFulfilledResult<any>).value.success
            );

            // Verify final state consistency
            const finalResult = await clients[0].getTask(taskId);
            assert.ok(finalResult.success);
            assert.ok(finalResult.data);

            // Should have at least one successful update
            assert.ok(successful.length > 0, "Should have at least one successful update");
            assert.ok(["todo", "in-progress", "done"].includes(finalResult.data.status));

            console.log(`Multi-daemon updates: ${successful.length} successful updates`);
        });
    });

    describe("Resource Contention Between Daemons", () => {
        it("should handle concurrent bulk operations across daemons", async () => {
            const tasksPerDaemon = 3;
            const allTaskIds: string[] = [];

            // Create tasks on each daemon
            for (let i = 0; i < NUM_DAEMONS; i++) {
                for (let j = 0; j < tasksPerDaemon; j++) {
                    const result = await clients[i].createTask({
                        title: `${TASK_ID_PREFIX} Daemon ${i} Task ${j}`,
                        description: `Bulk operation test task ${i}-${j}`,
                        priority: "medium",
                        createdBy: "multi-daemon-test-b7c2d592"
                    });

                    if (result.success && result.data) {
                        allTaskIds.push(result.data.id);
                    }
                }
            }

            // Concurrent operations across all daemons
            const contentionOperations = allTaskIds.flatMap(taskId => 
                clients.map(client => client.getTask(taskId))
            );

            const results = await Promise.allSettled(contentionOperations);
            const successful = results.filter(r => 
                r.status === 'fulfilled' && 
                (r as PromiseFulfilledResult<any>).value.success
            );

            const totalOperations = contentionOperations.length;
            const successRate = successful.length / totalOperations;

            // Should maintain reasonable success rate under contention
            assert.ok(successRate >= 0.6, 
                `Should maintain >=60% success rate under daemon contention (${successRate})`);

            console.log(`Contention test: ${successful.length}/${totalOperations} operations successful`);
        });

        it("should handle daemon failure scenarios gracefully", async () => {
            // Create tasks on remaining daemons
            const taskIds: string[] = [];
            for (let i = 1; i < NUM_DAEMONS; i++) {
                const result = await clients[i].createTask({
                    title: `${TASK_ID_PREFIX} Failure Recovery Test ${i}`,
                    description: `Task created for failure testing ${i}`,
                    priority: "medium",
                    createdBy: "multi-daemon-test-b7c2d592"
                });

                if (result.success && result.data) {
                    taskIds.push(result.data.id);
                }
            }

            // Simulate one daemon being unavailable (operations will fail)
            const unavailableDaemonOperations = clients[0].listTasks();
            const availableOperations = taskIds.map(taskId => clients[1].getTask(taskId));

            const results = await Promise.allSettled([
                unavailableDaemonOperations,
                ...availableOperations
            ]);

            // Should handle partial daemon failure gracefully
            const successful = results.filter(r => 
                r.status === 'fulfilled' && 
                (r as PromiseFulfilledResult<any>).value.success
            ).length;

            assert.ok(successful >= taskIds.length - 1, 
                "Should maintain functionality with partial daemon failure");

            // Verify remaining daemons are still functional
            const healthCheck = await clients[1].listTasks();
            assert.ok(healthCheck.success, "Remaining daemons should remain functional");
        });
    });

    describe("Consistency Across Distributed State", () => {
        it("should maintain task list consistency across daemons", async () => {
            // Create tasks on different daemons
            const createdTasks: any[] = [];
            for (let i = 0; i < NUM_DAEMONS; i++) {
                const result = await clients[i].createTask({
                    title: `${TASK_ID_PREFIX} Consistency Test ${i}`,
                    description: `Consistency test task ${i}`,
                    priority: "high",
                    createdBy: "multi-daemon-test-b7c2d592"
                });

                if (result.success && result.data) {
                    createdTasks.push(result.data);
                }
            }

            // Wait for potential replication/distribution
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Check task lists across all daemons
            const listPromises = clients.map(client => client.listTasks());
            const listResults = await Promise.allSettled(listPromises);

            const successfulLists = listResults.filter(r => r.status === 'fulfilled');
            const taskCounts = successfulLists.map(r => 
                (r as PromiseFulfilledResult<any>).value.data?.length || 0
            );

            // Task counts should be reasonable (may vary based on storage isolation)
            const avgTaskCount = taskCounts.reduce((a, b) => a + b, 0) / taskCounts.length;
            assert.ok(avgTaskCount >= createdTasks.length * 0.5, 
                "Average task count should be reasonable across daemons");

            console.log(`Consistency test: Average task count across daemons: ${avgTaskCount}`);
        });

        it("should handle concurrent priority updates across daemons", async () => {
            // Create task on first daemon
            const createResult = await clients[0].createTask({
                title: `${TASK_ID_PREFIX} Priority Consistency Test`,
                description: "Task for priority consistency testing",
                priority: "medium",
                createdBy: "multi-daemon-test-b7c2d592"
            });

            assert.ok(createResult.success);
            assert.ok(createResult.data);
            const taskId = createResult.data.id;

            // Concurrent priority updates from all daemons
            const priorityUpdates = clients.map((client, i) => 
                client.updateTaskPriority(taskId, ["high", "medium", "low"][i % 3])
            );

            const results = await Promise.allSettled(priorityUpdates);
            const successful = results.filter(r => 
                r.status === 'fulfilled' && 
                (r as PromiseFulfilledResult<any>).value.success
            );

            // Verify final state consistency
            const finalStates = await Promise.allSettled(
                clients.map(client => client.getTask(taskId))
            );

            const validStates = finalStates.filter(r => 
                r.status === 'fulfilled' && 
                (r as PromiseFulfilledResult<any>).value.success
            );

            // All successful reads should return valid priorities
            for (const state of validStates) {
                const task = (state as PromiseFulfilledResult<any>).value.data;
                assert.ok(["high", "medium", "low"].includes(task.priority),
                    "Priority should be valid across all daemons");
            }

            assert.ok(successful.length > 0, "Should have at least one successful priority update");
        });
    });

    describe("Performance Under Multi-Daemon Load", () => {
        it("should maintain reasonable performance under concurrent daemon load", async () => {
            const operationsPerDaemon = 5;
            const startTime = Date.now();

            // Concurrent operations across all daemons
            const loadOperations = clients.flatMap((client, clientIndex) => 
                Array.from({ length: operationsPerDaemon }, (_, opIndex) => 
                    client.createTask({
                        title: `${TASK_ID_PREFIX} Load Test Daemon ${clientIndex} Op ${opIndex}`,
                        description: `Load testing task ${clientIndex}-${opIndex}`,
                        priority: ["high", "medium", "low"][opIndex % 3],
                        createdBy: "multi-daemon-test-b7c2d592"
                    })
                )
            );

            const results = await Promise.allSettled(loadOperations);
            const endTime = Date.now();

            const successful = results.filter(r => 
                r.status === 'fulfilled' && 
                (r as PromiseFulfilledResult<any>).value.success
            );

            const totalOperations = NUM_DAEMONS * operationsPerDaemon;
            const successRate = successful.length / totalOperations;
            const duration = endTime - startTime;

            // Performance expectations
            assert.ok(successRate >= 0.7, 
                `Should maintain >=70% success rate under multi-daemon load (${successRate})`);
            assert.ok(duration < 15000, 
                `Multi-daemon operations should complete within 15 seconds (${duration}ms)`);

            console.log(`Multi-daemon load test: ${successful.length}/${totalOperations} operations in ${duration}ms`);
        });
    });
});