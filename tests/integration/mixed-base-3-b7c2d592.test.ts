// Comprehensive test suite for Mixed Base 3 Operations - Task b7c2d592-load
import { describe, it, before, after, beforeEach } from "node:test";
import { strict as assert } from "node:assert";

import { MixedOperationManager } from "../../services/task-3/src/mixed-base-3.ts";
import type {
    MixedOperationConfig,
    MixedOperationMetrics,
    TaskEntity,
    ErrorRecoveryConfig
} from "../../services/task-3/src/types.ts";

describe("Mixed Base 3 Operations - Task b7c2d592-load", () => {
    const TASK_ID_PREFIX = "task-b7c2d592-mixed-base-3";
    let testManager: MixedOperationManager;
    let initialTaskData: TaskEntity[];

    before(async () => {
        // Initialize test manager with custom configuration
        testManager = new MixedOperationManager(
            {
                concurrentOperations: 10,
                operationMix: {
                    creates: 25,
                    reads: 35,
                    updates: 25,
                    deletes: 15
                },
                resourceContention: true,
                errorRecovery: true,
                timingConfig: {
                    minDelay: 20,
                    maxDelay: 100,
                    contentionMultiplier: 2.0
                }
            },
            {
                maxRetries: 2,
                baseDelay: 50,
                maxDelay: 1000,
                backoffMultiplier: 2,
                retryableErrors: ['contention', 'timeout', 'connection'],
                circuitBreakerThreshold: 5,
                circuitBreakerTimeout: 15000
            }
        );

        // Create initial task data for testing
        initialTaskData = Array.from({ length: 5 }, (_, i) => ({
            id: `${TASK_ID_PREFIX}-initial-${i}`,
            title: `Initial Task ${i}`,
            description: `Initial task for mixed operations testing ${i}`,
            status: "todo" as const,
            priority: ["high", "medium", "low"][i % 3] as "high" | "medium" | "low",
            type: "task",
            dependencies: [],
            createdBy: "test-runner",
            actionLog: [],
            createdAt: new Date(),
            updatedAt: new Date()
        }));
    });

    beforeEach(() => {
        testManager.resetMetrics();
    });

    after(() => {
        testManager.resetMetrics();
    });

    describe("Basic Mixed Operations", () => {
        it("should execute mixed operations with default configuration", async () => {
            const config: Partial<MixedOperationConfig> = {
                concurrentOperations: 5,
                operationMix: {
                    creates: 20,
                    reads: 40,
                    updates: 30,
                    deletes: 10
                }
            };

            const metrics = await testManager.executeMixedOperations(config, initialTaskData);

            assert.ok(metrics.totalOperations > 0, "Should execute operations");
            assert.ok(metrics.successfulOperations >= 0, "Should have successful operations");
            assert.ok(metrics.failedOperations >= 0, "Should track failed operations");
            assert.ok(metrics.averageDuration >= 0, "Should calculate average duration");
            assert.ok(metrics.operationsPerSecond >= 0, "Should calculate throughput");
            
            console.log("Basic Mixed Operations Metrics:", metrics);
        });

        it("should handle balanced operation mix correctly", async () => {
            const config: Partial<MixedOperationConfig> = {
                concurrentOperations: 8,
                operationMix: {
                    creates: 25,
                    reads: 25,
                    updates: 25,
                    deletes: 25
                }
            };

            const metrics = await testManager.executeMixedOperations(config, initialTaskData);

            // Verify operation type distribution
            const operationTypes = Object.keys(metrics.performanceByType);
            assert.ok(operationTypes.length >= 2, "Should execute multiple operation types");
            
            // Verify each operation type has performance data
            operationTypes.forEach(type => {
                const perf = metrics.performanceByType[type];
                if (perf) {
                    assert.ok(perf.count > 0, `Operation type ${type} should have executions`);
                    assert.ok(perf.successRate >= 0, `Operation type ${type} should have valid success rate`);
                    assert.ok(perf.avgDuration >= 0, `Operation type ${type} should have valid duration`);
                }
            });

            console.log("Balanced Mix Performance:", metrics.performanceByType);
        });

        it("should handle read-heavy operation mix", async () => {
            const config: Partial<MixedOperationConfig> = {
                concurrentOperations: 15,
                operationMix: {
                    creates: 10,
                    reads: 70,
                    updates: 15,
                    deletes: 5
                }
            };

            const metrics = await testManager.executeMixedOperations(config, initialTaskData);

            // Read operations should be most common
            const readPerf = metrics.performanceByType["read"];
            if (readPerf) {
                assert.ok(readPerf.count > 0, "Should execute read operations");
                // Read operations should have higher success rate and lower duration
                assert.ok(readPerf.successRate >= 0.8, "Read operations should be highly successful");
            }

            console.log("Read-Heavy Mix Metrics:", metrics);
        });

        it("should handle write-heavy operation mix", async () => {
            const config: Partial<MixedOperationConfig> = {
                concurrentOperations: 12,
                operationMix: {
                    creates: 40,
                    reads: 20,
                    updates: 30,
                    deletes: 10
                }
            };

            const metrics = await testManager.executeMixedOperations(config, initialTaskData);

            // Create and update operations should be predominant
            const createPerf = metrics.performanceByType["create"];
            const updatePerf = metrics.performanceByType["update"];
            
            if (createPerf && updatePerf) {
                const totalWriteOps = createPerf.count + updatePerf.count;
                const readPerf = metrics.performanceByType["read"];
                const readOps = readPerf ? readPerf.count : 0;
                
                assert.ok(totalWriteOps > readOps, "Write operations should outnumber read operations");
            }

            console.log("Write-Heavy Mix Metrics:", metrics);
        });
    });

    describe("Concurrency Testing", () => {
        it("should handle high concurrency levels", async () => {
            const config: Partial<MixedOperationConfig> = {
                concurrentOperations: 25,
                operationMix: {
                    creates: 30,
                    reads: 30,
                    updates: 25,
                    deletes: 15
                }
            };

            const startTime = Date.now();
            const metrics = await testManager.executeMixedOperations(config, initialTaskData);
            const totalTime = Date.now() - startTime;

            // Should handle high concurrency reasonably well
            assert.ok(metrics.successfulOperations > 0, "Should have successful operations under high concurrency");
            assert.ok(totalTime < 30000, "Should complete high concurrency test within 30 seconds");
            assert.ok(metrics.operationsPerSecond > 0, "Should maintain positive throughput");

            // Resource utilization should reflect high concurrency
            assert.equal(metrics.resourceUtilization.maxConcurrentOperations, 25);
            
            console.log("High Concurrency Results:", {
                totalOperations: metrics.totalOperations,
                successfulOperations: metrics.successfulOperations,
                totalTime: totalTime,
                operationsPerSecond: metrics.operationsPerSecond,
                resourceUtilization: metrics.resourceUtilization
            });
        });

        it("should handle low concurrency efficiently", async () => {
            const config: Partial<MixedOperationConfig> = {
                concurrentOperations: 3,
                operationMix: {
                    creates: 20,
                    reads: 40,
                    updates: 30,
                    deletes: 10
                }
            };

            const metrics = await testManager.executeMixedOperations(config, initialTaskData);

            // Low concurrency should have good success rates
            assert.ok(metrics.successRate >= 0.9, "Low concurrency should have high success rate");
            assert.ok(metrics.averageDuration < 200, "Low concurrency should have reasonable duration");

            console.log("Low Concurrency Results:", metrics);
        });

        it("should maintain data consistency under concurrent access", async () => {
            const config: Partial<MixedOperationConfig> = {
                concurrentOperations: 20,
                operationMix: {
                    creates: 20,
                    reads: 50,
                    updates: 25,
                    deletes: 5
                }
            };

            const metrics = await testManager.executeMixedOperations(config, initialTaskData);

            // Verify no data corruption by checking consistency
            const totalOps = Object.values(metrics.performanceByType)
                .reduce((sum, perf) => sum + perf.count, 0);
            
            assert.equal(totalOps, metrics.totalOperations, "Operation counts should be consistent");
            
            // Success rate should be reasonable under concurrency
            assert.ok(metrics.successRate >= 0.7, "Should maintain reasonable success rate under concurrency");

            console.log("Concurrency Consistency Check:", {
                totalOperations: metrics.totalOperations,
                operationsByType: totalOps,
                successRate: metrics.successRate
            });
        });
    });

    describe("Resource Contention Testing", () => {
        it("should handle resource contention gracefully", async () => {
            const config: Partial<MixedOperationConfig> = {
                concurrentOperations: 15,
                operationMix: {
                    creates: 20,
                    reads: 30,
                    updates: 40,
                    deletes: 10
                },
                resourceContention: true
            };

            const metrics = await testManager.executeMixedOperations(config, initialTaskData);

            // Should detect and handle contention
            assert.ok(metrics.contentionEvents >= 0, "Should track contention events");
            
            if (metrics.contentionEvents > 0) {
                const contentionRate = metrics.contentionEvents / metrics.totalOperations;
                assert.ok(contentionRate <= 1.0, "Contention rate should be reasonable");
                console.log(`Contention Rate: ${contentionRate.toFixed(2)} (${metrics.contentionEvents}/${metrics.totalOperations})`);
            }

            // Should still maintain reasonable performance under contention
            assert.ok(metrics.successRate >= 0.6, "Should maintain reasonable success rate under contention");

            console.log("Resource Contention Results:", metrics);
        });

        it("should simulate lock contention scenarios", async () => {
            const config: Partial<MixedOperationConfig> = {
                concurrentOperations: 12,
                operationMix: {
                    creates: 15,
                    reads: 35,
                    updates: 45,
                    deletes: 5
                },
                resourceContention: true,
                timingConfig: {
                    minDelay: 10,
                    maxDelay: 50,
                    contentionMultiplier: 3.0
                }
            };

            const metrics = await testManager.executeMixedOperations(config, initialTaskData);

            // High update operations should increase contention
            const updatePerf = metrics.performanceByType["update"];
            if (updatePerf) {
                assert.ok(updatePerf.count > 0, "Should execute update operations");
                // Updates might have lower success rate due to contention
                assert.ok(updatePerf.successRate >= 0.5, "Updates should succeed at least 50% under contention");
            }

            // Lock contention rate should be tracked
            assert.ok(metrics.resourceUtilization.lockContentionRate >= 0, "Should track lock contention rate");

            console.log("Lock Contention Scenarios:", {
                updatePerformance: updatePerf,
                lockContentionRate: metrics.resourceUtilization.lockContentionRate,
                contentionEvents: metrics.contentionEvents
            });
        });
    });

    describe("Error Recovery Testing", () => {
        it("should handle error recovery scenarios", async () => {
            const config: Partial<MixedOperationConfig> = {
                concurrentOperations: 8,
                operationMix: {
                    creates: 25,
                    reads: 35,
                    updates: 30,
                    deletes: 10
                },
                errorRecovery: true
            };

            const metrics = await testManager.executeMixedOperations(config, initialTaskData);

            // Should track error recovery events
            assert.ok(metrics.errorRecoveryEvents >= 0, "Should track error recovery events");

            // Should maintain reasonable overall success rate
            assert.ok(metrics.successRate >= 0.7, "Should maintain reasonable success rate with error recovery");

            // Average retry attempts should be reasonable
            const totalRetries = Object.values(metrics.performanceByType)
                .reduce((sum: number, perf: any) => sum + (perf.avgRetries * perf.count), 0);
            const avgRetries = totalRetries / metrics.totalOperations;
            
            assert.ok(avgRetries <= 3, "Average retry attempts should be reasonable");

            console.log("Error Recovery Results:", {
                errorRecoveryEvents: metrics.errorRecoveryEvents,
                successRate: metrics.successRate,
                avgRetries: avgRetries
            });
        });

        it("should recover from mixed success/failure scenarios", async () => {
            // Create configuration that may trigger more errors
            const config: Partial<MixedOperationConfig> = {
                concurrentOperations: 20,
                operationMix: {
                    creates: 30,
                    reads: 25,
                    updates: 35,
                    deletes: 10
                },
                resourceContention: true,
                errorRecovery: true
            };

            const metrics = await testManager.executeMixedOperations(config, initialTaskData);

            // Should have both successes and failures
            assert.ok(metrics.successfulOperations > 0, "Should have successful operations");
            assert.ok(metrics.failedOperations >= 0, "Should track failed operations");

            // Overall performance should still be reasonable
            assert.ok(metrics.successRate >= 0.6, "Should maintain minimum success rate");
            assert.ok(metrics.operationsPerSecond > 0, "Should maintain positive throughput");

            console.log("Mixed Recovery Scenarios:", {
                successfulOperations: metrics.successfulOperations,
                failedOperations: metrics.failedOperations,
                successRate: metrics.successRate,
                throughput: metrics.operationsPerSecond
            });
        });
    });

    describe("Performance Baselines", () => {
        it("should establish and maintain performance baselines", async () => {
            const config: Partial<MixedOperationConfig> = {
                concurrentOperations: 10,
                operationMix: {
                    creates: 25,
                    reads: 35,
                    updates: 25,
                    deletes: 15
                }
            };

            // Run initial test to establish baselines
            await testManager.executeMixedOperations(config, initialTaskData);
            
            const baselines = testManager.getPerformanceBaselines();
            assert.ok(baselines.size > 0, "Should establish performance baselines");

            // Run second test to update baselines
            const metrics = await testManager.executeMixedOperations(config, initialTaskData);

            // Baselines should be updated
            const updatedBaselines = testManager.getPerformanceBaselines();
            
            updatedBaselines.forEach((baseline, operationType) => {
                assert.ok(baseline.avgDuration > 0, `${operationType} should have positive avg duration`);
                assert.ok(baseline.successRate >= 0, `${operationType} should have valid success rate`);
                assert.ok(baseline.sampleSize > 0, `${operationType} should have positive sample size`);
            });

            console.log("Performance Baselines:", Object.fromEntries(updatedBaselines));
        });

        it("should compare performance against baselines", async () => {
            const config: Partial<MixedOperationConfig> = {
                concurrentOperations: 15,
                operationMix: {
                    creates: 20,
                    reads: 40,
                    updates: 30,
                    deletes: 10
                }
            };

            // Establish baselines
            await testManager.executeMixedOperations(config, initialTaskData);
            const initialBaselines = testManager.getPerformanceBaselines();

            // Run performance test
            const metrics = await testManager.executeMixedOperations(config, initialTaskData);
            const finalBaselines = testManager.getPerformanceBaselines();

            // Compare performance
            Object.entries(metrics.performanceByType).forEach(([operationType, perf]: [string, any]) => {
                const baseline = initialBaselines.get(operationType);
                const updatedBaseline = finalBaselines.get(operationType);
                
                if (baseline && updatedBaseline) {
                    console.log(`${operationType} Performance:`, {
                        baselineAvg: baseline.avgDuration,
                        currentAvg: perf.avgDuration,
                        baselineSuccessRate: baseline.successRate,
                        currentSuccessRate: perf.successRate,
                        improvement: baseline.avgDuration - perf.avgDuration
                    });
                }
            });
        });
    });

    describe("Metrics and Monitoring", () => {
        it("should provide comprehensive metrics", async () => {
            const config: Partial<MixedOperationConfig> = {
                concurrentOperations: 12,
                operationMix: {
                    creates: 25,
                    reads: 30,
                    updates: 35,
                    deletes: 10
                }
            };

            const metrics = await testManager.executeMixedOperations(config, initialTaskData);

            // Verify all required metrics are present
            assert.ok(typeof metrics.totalOperations === "number", "Should have total operations");
            assert.ok(typeof metrics.successfulOperations === "number", "Should have successful operations");
            assert.ok(typeof metrics.failedOperations === "number", "Should have failed operations");
            assert.ok(typeof metrics.averageDuration === "number", "Should have average duration");
            assert.ok(typeof metrics.operationsPerSecond === "number", "Should have throughput");
            assert.ok(typeof metrics.contentionEvents === "number", "Should have contention events");
            assert.ok(typeof metrics.errorRecoveryEvents === "number", "Should have error recovery events");

            // Verify performance by type
            assert.ok(typeof metrics.performanceByType === "object", "Should have performance by type");
            assert.ok(Object.keys(metrics.performanceByType).length >= 2, "Should have multiple operation types");

            // Verify resource utilization
            assert.ok(typeof metrics.resourceUtilization === "object", "Should have resource utilization");
            assert.ok(typeof metrics.resourceUtilization.maxConcurrentOperations === "number", "Should have max concurrent");
            assert.ok(typeof metrics.resourceUtilization.avgConcurrentOperations === "number", "Should have avg concurrent");
            assert.ok(typeof metrics.resourceUtilization.lockContentionRate === "number", "Should have lock contention rate");

            console.log("Comprehensive Metrics:", metrics);
        });

        it("should track operation-specific performance", async () => {
            const config: Partial<MixedOperationConfig> = {
                concurrentOperations: 10,
                operationMix: {
                    creates: 30,
                    reads: 20,
                    updates: 40,
                    deletes: 10
                }
            };

            const metrics = await testManager.executeMixedOperations(config, initialTaskData);

            // Verify each operation type has detailed metrics
            Object.entries(metrics.performanceByType).forEach(([operationType, perf]: [string, any]) => {
                assert.ok(perf.count > 0, `${operationType} should have operations`);
                assert.ok(perf.successRate >= 0, `${operationType} should have valid success rate`);
                assert.ok(perf.avgDuration >= 0, `${operationType} should have valid duration`);
                assert.ok(perf.avgRetries >= 0, `${operationType} should have valid retry count`);

                // Success rate should be reasonable
                assert.ok(perf.successRate <= 1.0, `${operationType} success rate should be <= 1.0`);
            });

            console.log("Operation-Specific Performance:", metrics.performanceByType);
        });
    });

    describe("Edge Cases and Boundary Conditions", () => {
        it("should handle minimal operation counts", async () => {
            const config: Partial<MixedOperationConfig> = {
                concurrentOperations: 1,
                operationMix: {
                    creates: 100,
                    reads: 0,
                    updates: 0,
                    deletes: 0
                }
            };

            const metrics = await testManager.executeMixedOperations(config, initialTaskData);

            assert.ok(metrics.totalOperations > 0, "Should execute minimal operations");
            assert.ok(metrics.successRate >= 0.8, "Should have high success rate with minimal operations");

            console.log("Minimal Operations Test:", metrics);
        });

        it("should handle extreme operation mixes", async () => {
            const config: Partial<MixedOperationConfig> = {
                concurrentOperations: 8,
                operationMix: {
                    creates: 50,
                    reads: 0,
                    updates: 50,
                    deletes: 0
                }
            };

            const metrics = await testManager.executeMixedOperations(config, initialTaskData);

            // Should handle extreme mixes without crashing
            assert.ok(metrics.totalOperations > 0, "Should handle extreme operation mix");
            assert.ok(metrics.successRate >= 0.6, "Should maintain reasonable success rate");

            // Should only have create and update operations
            const operationTypes = Object.keys(metrics.performanceByType);
            assert.ok(operationTypes.includes("create"), "Should have create operations");
            assert.ok(operationTypes.includes("update"), "Should have update operations");
            assert.ok(!operationTypes.includes("read"), "Should not have read operations in this mix");
            assert.ok(!operationTypes.includes("delete"), "Should not have delete operations in this mix");

            console.log("Extreme Mix Test:", {
                operationTypes,
                metrics: metrics.performanceByType
            });
        });
    });

    describe("Configuration Validation", () => {
        it("should validate operation mix percentages", async () => {
            // Test invalid operation mix (doesn't sum to 100)
            try {
                const config: Partial<MixedOperationConfig> = {
                    concurrentOperations: 5,
                    operationMix: {
                        creates: 30,
                        reads: 30,
                        updates: 30,
                        deletes: 20 // Total = 110
                    }
                };

                await testManager.executeMixedOperations(config, initialTaskData);
                assert.fail("Should have thrown validation error");
            } catch (error) {
                assert.ok(error instanceof Error, "Should throw validation error");
                assert.ok(error.message.includes("Invalid operationMix"), "Should specify operation mix error");
            }
        });

        it("should validate concurrent operations limit", async () => {
            try {
                const config: Partial<MixedOperationConfig> = {
                    concurrentOperations: 150, // Too high
                    operationMix: {
                        creates: 25,
                        reads: 25,
                        updates: 25,
                        deletes: 25
                    }
                };

                await testManager.executeMixedOperations(config, initialTaskData);
                assert.fail("Should have thrown validation error");
            } catch (error) {
                assert.ok(error instanceof Error, "Should throw validation error");
                assert.ok(error.message.includes("Invalid concurrentOperations"), "Should specify concurrency error");
            }
        });
    });
});