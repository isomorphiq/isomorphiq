import { describe, it, before, beforeEach, after } from "node:test";
import { strict as assert } from "node:assert";
import { DaemonTcpClient, type Task } from "../e2e/dashboard/tcp-client.ts";
import { startTestDaemon, type TestDaemonHandle } from "./daemon-test-harness.ts";

interface PerformanceMetrics {
    totalOperations: number;
    successfulOperations: number;
    failedOperations: number;
    totalTime: number;
    averageTime: number;
    operationsPerSecond: number;
    successRate: number;
}

interface LoadTestResult extends PerformanceMetrics {
    testName: string;
    concurrentOperations: number;
    errors: string[];
}

describe("Concurrent Load Testing - Task b7c2d592", () => {
    const TASK_ID_PREFIX = "task-b7c2d592-load";
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
        await daemon.cleanup();
    });

    describe("Concurrent Creation Performance", () => {
        it("should measure performance of concurrent task creation", async () => {
            const concurrentCount = 20;
            const creationPromises = Array.from({ length: concurrentCount }, (_, i) =>
                tcpClient.createTask({
                    title: `${TASK_ID_PREFIX} Load Creation ${i}`,
                    description: `Load testing task creation ${i}`,
                    priority: ["high", "medium", "low"][i % 3],
                    createdBy: "integration-test-b7c2d592"
                })
            );
            
            const metrics = await measureLoadPerformance("Concurrent Task Creation", creationPromises, concurrentCount);
            
            // Performance assertions
            assert.ok(metrics.successRate >= 0.8, `Success rate should be >=80%: ${metrics.successRate}`);
            assert.ok(metrics.operationsPerSecond >= 5, `Should handle at least 5 ops/sec: ${metrics.operationsPerSecond}`);
            assert.ok(metrics.averageTime <= 1000, `Average operation time should be <=1s: ${metrics.averageTime}ms`);
            
            console.log(`Concurrent Creation Performance:`, metrics);
        });

        it("should measure performance under sustained concurrent load", async () => {
            const waves = 3;
            const operationsPerWave = 10;
            const allMetrics: LoadTestResult[] = [];
            
            for (let wave = 0; wave < waves; wave++) {
                const wavePromises = Array.from({ length: operationsPerWave }, (_, i) => 
                    tcpClient.createTask({
                        title: `${TASK_ID_PREFIX} Sustained Wave ${wave} Task ${i}`,
                        description: `Sustained load wave ${wave} task ${i}`,
                        priority: "medium",
                        createdBy: "integration-test-b7c2d592"
                    })
                );
                
                const metrics = await measureLoadPerformance(
                    `Sustained Load Wave ${wave}`, 
                    wavePromises, 
                    operationsPerWave
                );
                allMetrics.push(metrics);
                
                // Small delay between waves
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            
            // Analyze sustained performance
            const avgSuccessRate = allMetrics.reduce((sum, m) => sum + m.successRate, 0) / allMetrics.length;
            const avgOpsPerSec = allMetrics.reduce((sum, m) => sum + m.operationsPerSecond, 0) / allMetrics.length;
            
            assert.ok(avgSuccessRate >= 0.75, `Sustained success rate should be >=75%: ${avgSuccessRate}`);
            assert.ok(avgOpsPerSec >= 3, `Sustained ops/sec should be >=3: ${avgOpsPerSec}`);
            
            console.log("Sustained Load Performance:", { avgSuccessRate, avgOpsPerSec, waves: allMetrics });
        });
    });

    describe("Mixed Operation Performance", () => {
        it("should measure performance of concurrent mixed operations", async () => {
            // Create some initial tasks for mixed operations
            const initialTaskIds: string[] = [];
            for (let i = 0; i < 5; i++) {
                const result = await tcpClient.createTask({
                    title: `${TASK_ID_PREFIX} Mixed Base ${i}`,
                    description: `Base task for mixed operations ${i}`,
                    priority: "medium",
                    createdBy: "integration-test-b7c2d592"
                });
                
                if (result.success && result.data) {
                    initialTaskIds.push(result.data.id);
                }
            }
            
            // Mix of different operation types
            const mixedPromises = [
                // Reads (40%)
                ...Array.from({ length: 8 }, () => tcpClient.listTasks()),
                ...initialTaskIds.flatMap(taskId => 
                    Array.from({ length: 4 }, () => tcpClient.getTask(taskId))
                ),
                // Updates (30%)
                ...initialTaskIds.map(taskId => tcpClient.updateTaskStatus(taskId, "in-progress")),
                ...initialTaskIds.map(taskId => tcpClient.updateTaskPriority(taskId, "high")),
                // Creates (30%)
                ...Array.from({ length: 6 }, (_, i) =>
                    tcpClient.createTask({
                        title: `${TASK_ID_PREFIX} Mixed New ${i}`,
                        description: `New task during mixed load ${i}`,
                        priority: "low",
                        createdBy: "integration-test-b7c2d592"
                    })
                )
            ];
            
            const metrics = await measureLoadPerformance("Mixed Operations", mixedPromises, mixedPromises.length);
            
            assert.ok(metrics.successRate >= 0.8, `Mixed operations success rate should be >=80%: ${metrics.successRate}`);
            assert.ok(metrics.operationsPerSecond >= 8, `Mixed operations should handle at least 8 ops/sec: ${metrics.operationsPerSecond}`);
            
            console.log("Mixed Operations Performance:", metrics);
        });

        it("should measure performance degradation under high concurrency", async () => {
            const concurrencyLevels = [5, 10, 20];
            const performanceResults: { concurrency: number; metrics: LoadTestResult }[] = [];
            
            for (const concurrency of concurrencyLevels) {
                const promises = Array.from({ length: concurrency }, (_, i) =>
                    tcpClient.createTask({
                        title: `${TASK_ID_PREFIX} Degradation Test ${concurrency}-${i}`,
                        description: `Performance degradation test for ${concurrency} concurrent operations`,
                        priority: "medium",
                        createdBy: "integration-test-b7c2d592"
                    })
                );
                
                const metrics = await measureLoadPerformance(`Concurrency ${concurrency}`, promises, concurrency);
                performanceResults.push({ concurrency, metrics });
                
                // Clean up for next test
                await new Promise(resolve => setTimeout(resolve, 200));
            }
            
            // Analyze performance degradation
            const lowConcurrency = performanceResults.find(r => r.concurrency === 5);
            const highConcurrency = performanceResults.find(r => r.concurrency === 20);
            
            if (lowConcurrency && highConcurrency) {
                const degradationRatio = highConcurrency.metrics.operationsPerSecond / lowConcurrency.metrics.operationsPerSecond;
                
                // Performance should degrade, but not catastrophically
                assert.ok(degradationRatio >= 0.3, `Performance degradation should be manageable: ${degradationRatio}`);
                
                console.log("Performance Degradation Analysis:", {
                    lowConcurrency: lowConcurrency.metrics.operationsPerSecond,
                    highConcurrency: highConcurrency.metrics.operationsPerSecond,
                    degradationRatio
                });
            }
        });
    });

    describe("Resource Contention Testing", () => {
        it("should measure performance under resource contention", async () => {
            // Create a shared resource (task)
            const createResult = await tcpClient.createTask({
                title: `${TASK_ID_PREFIX} Shared Resource`,
                description: "Shared task for contention testing",
                priority: "medium",
                createdBy: "integration-test-b7c2d592"
            });
            
            assert.ok(createResult.success);
            assert.ok(createResult.data);
            const sharedTaskId = createResult.data.id;
            
            // All operations target the same resource (high contention)
            const contentionPromises = [
                // Multiple updates to the same task
                ...Array.from({ length: 10 }, () => tcpClient.updateTaskStatus(sharedTaskId, "in-progress")),
                ...Array.from({ length: 10 }, () => tcpClient.updateTaskPriority(sharedTaskId, "high")),
                // Multiple reads of the same task
                ...Array.from({ length: 10 }, () => tcpClient.getTask(sharedTaskId))
            ];
            
            const metrics = await measureLoadPerformance("Resource Contention", contentionPromises, contentionPromises.length);
            
            // High contention should still work reasonably well
            assert.ok(metrics.successRate >= 0.7, `Contention success rate should be >=70%: ${metrics.successRate}`);
            assert.ok(metrics.operationsPerSecond >= 5, `Contention should handle at least 5 ops/sec: ${metrics.operationsPerSecond}`);
            
            // Verify final state consistency
            const finalResult = await tcpClient.getTask(sharedTaskId);
            assert.ok(finalResult.success);
            assert.ok(finalResult.data);
            
            console.log("Resource Contention Performance:", metrics);
        });

        it("should measure performance of concurrent filtering and searching", async () => {
            // Create a larger dataset for filtering tests
            const datasetSize = 15;
            for (let i = 0; i < datasetSize; i++) {
                await tcpClient.createTask({
                    title: `${TASK_ID_PREFIX} Filter Test ${i}`,
                    description: `Task for filtering performance ${i}`,
                    priority: ["high", "medium", "low"][i % 3],
                    createdBy: "integration-test-b7c2d592"
                });
            }
            
            // Concurrent filtering operations
            const filterPromises = [
                ...Array.from({ length: 5 }, () => tcpClient.listTasksFiltered({ status: "todo" })),
                ...Array.from({ length: 5 }, () => tcpClient.listTasksFiltered({ priority: "high" })),
                ...Array.from({ length: 5 }, () => tcpClient.listTasksFiltered({ search: "Filter Test" })),
                ...Array.from({ length: 5 }, () => tcpClient.listTasks()),
                ...Array.from({ length: 5 }, () => tcpClient.listTasksFiltered({ limit: 10 }))
            ];
            
            const metrics = await measureLoadPerformance("Filtering Performance", filterPromises, filterPromises.length);
            
            assert.ok(metrics.successRate >= 0.85, `Filtering success rate should be >=85%: ${metrics.successRate}`);
            assert.ok(metrics.operationsPerSecond >= 10, `Filtering should handle at least 10 ops/sec: ${metrics.operationsPerSecond}`);
            
            console.log("Filtering Performance:", metrics);
        });
    });

    describe("Error Recovery Performance", () => {
        it("should measure performance under mixed success/failure scenarios", async () => {
            // Mix valid operations with invalid operations
            const mixedErrorPromises = [
                // Valid operations (70%)
                ...Array.from({ length: 7 }, (_, i) =>
                    tcpClient.createTask({
                        title: `${TASK_ID_PREFIX} Error Recovery Valid ${i}`,
                        description: `Valid operation during error recovery test ${i}`,
                        priority: "medium",
                        createdBy: "integration-test-b7c2d592"
                    })
                ),
                tcpClient.listTasks(),
                ...Array.from({ length: 3 }, () => tcpClient.listTasksFiltered({ status: "todo" })),
                
                // Invalid operations (30%)
                tcpClient.getTask("non-existent-task-id"),
                tcpClient.updateTaskStatus("non-existent-task-id", "done"),
                tcpClient.deleteTask("non-existent-task-id"),
                tcpClient.updateTaskPriority("non-existent-task-id", "high"),
                tcpClient.getTask("")
            ];
            
            const metrics = await measureLoadPerformance("Error Recovery", mixedErrorPromises, mixedErrorPromises.length);
            
            // Should handle errors gracefully without major performance impact
            assert.ok(metrics.successRate >= 0.6, `Error recovery success rate should be >=60%: ${metrics.successRate}`);
            assert.ok(metrics.operationsPerSecond >= 5, `Error recovery should handle at least 5 ops/sec: ${metrics.operationsPerSecond}`);
            
            console.log("Error Recovery Performance:", metrics);
        });
    });

    describe("Performance Baselines", () => {
        it("should establish performance baselines for comparison", async () => {
            const baselineTests = [
                { name: "Simple Create", ops: 5, generator: (i: number) => tcpClient.createTask({
                    title: `${TASK_ID_PREFIX} Baseline Create ${i}`,
                    description: `Baseline test ${i}`,
                    priority: "medium",
                    createdBy: "integration-test-b7c2d592"
                })},
                { name: "Simple Read", ops: 5, generator: () => tcpClient.listTasks() },
                { name: "Simple Filter", ops: 5, generator: () => tcpClient.listTasksFiltered({ status: "todo" }) }
            ];
            
            const baselineResults: { name: string; metrics: LoadTestResult }[] = [];
            
            for (const test of baselineTests) {
                const promises = Array.from({ length: test.ops }, (_, i) => test.generator(i));
                const metrics = await measureLoadPerformance(test.name, promises, test.ops);
                baselineResults.push({ name: test.name, metrics });
                
                // Small delay between tests
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            
            // Baseline assertions
            baselineResults.forEach(result => {
                assert.ok(result.metrics.successRate >= 0.9, `${result.name} baseline success rate should be >=90%`);
                assert.ok(result.metrics.operationsPerSecond >= 10, `${result.name} baseline should handle at least 10 ops/sec`);
            });
            
            console.log("Performance Baselines:", baselineResults);
            
            // Store baselines for future comparison
            const baselineSummary = {
                timestamp: new Date().toISOString(),
                results: baselineResults.map(r => ({
                    name: r.name,
                    opsPerSecond: r.metrics.operationsPerSecond,
                    successRate: r.metrics.successRate,
                    avgTime: r.metrics.averageTime
                }))
            };
            
            console.log("Baseline Summary:", JSON.stringify(baselineSummary, null, 2));
        });
    });

    // Helper function to measure load performance
    async function measureLoadPerformance(
        testName: string, 
        promises: Promise<any>[], 
        concurrentOperations: number
    ): Promise<LoadTestResult> {
        const startTime = Date.now();
        const results = await Promise.allSettled(promises);
        const endTime = Date.now();
        
        const successfulOperations = results.filter(r => 
            r.status === 'fulfilled' && 
            (r as PromiseFulfilledResult<any>).value.success
        ).length;
        
        const failedOperations = results.length - successfulOperations;
        const totalTime = endTime - startTime;
        const averageTime = totalTime / results.length;
        const operationsPerSecond = (successfulOperations / totalTime) * 1000;
        const successRate = successfulOperations / results.length;
        
        const errors: string[] = [];
        results.forEach((result, index) => {
            if (result.status === 'rejected') {
                errors.push(`Operation ${index}: ${result.reason}`);
            } else if (!(result as PromiseFulfilledResult<any>).value.success) {
                errors.push(`Operation ${index}: ${(result as PromiseFulfilledResult<any>).value.error?.message || 'Unknown error'}`);
            }
        });
        
        return {
            testName,
            totalOperations: results.length,
            successfulOperations,
            failedOperations,
            totalTime,
            averageTime,
            operationsPerSecond,
            successRate,
            concurrentOperations,
            errors
        };
    }
});
