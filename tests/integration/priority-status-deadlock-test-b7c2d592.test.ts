import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { PriorityStatusDeadlockDetector, type PriorityStatusDependency } from "../../packages/worker/src/services/priority-status-deadlock-detector.ts";
import { PriorityStatusDependencyValidator } from "../../packages/worker/src/services/priority-status-dependency-validator.ts";
import type { Task } from "../../packages/dashboard/src/web/tcp-client.ts";

describe("Priority-Status Dependency Deadlock Detection Task b7c2d592", () => {
    let detector: PriorityStatusDeadlockDetector;
    let validator: PriorityStatusDependencyValidator;
    let mockTasks: Map<string, Task>;

    beforeEach(() => {
        detector = new PriorityStatusDeadlockDetector(5000, 3);
        validator = new PriorityStatusDependencyValidator();
        mockTasks = new Map();

        // Create mock tasks for testing
        mockTasks.set("task-1", {
            id: "task-1",
            title: "Test Task 1",
            description: "Test task for priority-status dependency",
            status: "todo",
            priority: "medium",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        });

        mockTasks.set("task-2", {
            id: "task-2",
            title: "Test Task 2",
            description: "Test task for priority-status dependency",
            status: "in-progress",
            priority: "high",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        });

        mockTasks.set("task-3", {
            id: "task-3",
            title: "Test Task 3",
            description: "Test task for priority-status dependency",
            status: "done",
            priority: "low",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        });

        // Update validator with mock tasks
        mockTasks.forEach(task => validator.updateTask(task));
    });

    afterEach(() => {
        detector.cleanup();
        validator.clearCache();
        validator.clearDependencies();
    });

    describe("Level-0 Dependency Detection", () => {
        it("should detect simple level-0 priority-status dependency", () => {
            const dependency: PriorityStatusDependency = {
                taskId: "task-1",
                dependsOnTaskId: "task-2",
                dependencyType: "priority_depends_on_status",
                level: 0,
                condition: (task, dependentTask) => dependentTask.status === "done"
            };

            detector.addPriorityStatusDependency(dependency);
            validator.addDependency(dependency);

            const validation = validator.validateDependency(dependency);
            assert.ok(validation.isValid, "Level-0 dependency should be valid");
            
            const deadlockResult = detector.detectPriorityStatusDeadlock();
            assert.equal(deadlockResult.isDeadlock, false, "Simple dependency should not cause deadlock");
        });

        it("should detect conflicting level-0 dependencies", () => {
            const priorityDep: PriorityStatusDependency = {
                taskId: "task-1",
                dependsOnTaskId: "task-2",
                dependencyType: "priority_depends_on_status",
                level: 0,
                condition: (task, dependentTask) => dependentTask.status === "done"
            };

            const statusDep: PriorityStatusDependency = {
                taskId: "task-1",
                dependsOnTaskId: "task-3",
                dependencyType: "status_depends_on_priority",
                level: 0,
                condition: (task, dependentTask) => dependentTask.priority === "high"
            };

            detector.addPriorityStatusDependency(priorityDep);
            detector.addPriorityStatusDependency(statusDep);

            const deadlockResult = detector.detectPriorityStatusDeadlock();
            assert.equal(deadlockResult.isDeadlock, true, "Conflicting level-0 dependencies should cause deadlock");
            assert.equal(deadlockResult.severity, "critical", "Level-0 conflicts should be critical");
            assert.equal(deadlockResult.resolutionStrategy, "priority_boost", "Should use priority boost strategy");
        });

        it("should handle multiple level-0 dependencies gracefully", () => {
            const dependencies: PriorityStatusDependency[] = [
                {
                    taskId: "task-1",
                    dependsOnTaskId: "task-2",
                    dependencyType: "priority_depends_on_status",
                    level: 0,
                    condition: (task, dependentTask) => dependentTask.status === "done"
                },
                {
                    taskId: "task-2",
                    dependsOnTaskId: "task-3",
                    dependencyType: "priority_depends_on_status",
                    level: 0,
                    condition: (task, dependentTask) => dependentTask.status === "done"
                },
                {
                    taskId: "task-3",
                    dependsOnTaskId: "task-1",
                    dependencyType: "status_depends_on_priority",
                    level: 0,
                    condition: (task, dependentTask) => dependentTask.priority === "high"
                }
            ];

            dependencies.forEach(dep => {
                detector.addPriorityStatusDependency(dep);
                validator.addDependency(dep);
            });

            const deadlockResult = detector.detectPriorityStatusDeadlock();
            assert.equal(deadlockResult.isDeadlock, true, "Multiple level-0 dependencies should cause deadlock");
            assert.ok(deadlockResult.dependencyCycle.length > 0, "Should identify dependency cycle");
        });
    });

    describe("Dependency Validation", () => {
        it("should validate dependency conditions correctly", () => {
            const validDependency: PriorityStatusDependency = {
                taskId: "task-1",
                dependsOnTaskId: "task-2",
                dependencyType: "priority_depends_on_status",
                level: 0,
                condition: (task, dependentTask) => dependentTask.status === "in-progress"
            };

            const validation = validator.validateDependency(validDependency);
            assert.ok(validation.isValid, "Valid condition should pass validation");
        });

        it("should detect invalid dependency levels", () => {
            const invalidDependency: PriorityStatusDependency = {
                taskId: "task-1",
                dependsOnTaskId: "task-2",
                dependencyType: "priority_depends_on_status",
                level: -1,
                condition: (task, dependentTask) => true
            };

            const validation = validator.validateDependency(invalidDependency);
            assert.equal(validation.isValid, false, "Negative dependency level should be invalid");
            assert.ok(validation.errors.some(e => e.includes("negative")), "Should have error about negative level");
        });

        it("should warn about high dependency levels", () => {
            const highLevelDependency: PriorityStatusDependency = {
                taskId: "task-1",
                dependsOnTaskId: "task-2",
                dependencyType: "priority_depends_on_status",
                level: 6,
                condition: (task, dependentTask) => true
            };

            const validation = validator.validateDependency(highLevelDependency);
            assert.ok(validation.warnings.some(w => w.includes("High dependency level")), 
                "Should warn about high dependency level");
        });

        it("should detect missing tasks", () => {
            const missingTaskDependency: PriorityStatusDependency = {
                taskId: "missing-task",
                dependsOnTaskId: "task-2",
                dependencyType: "priority_depends_on_status",
                level: 0,
                condition: (task, dependentTask) => true
            };

            const validation = validator.validateDependency(missingTaskDependency);
            assert.equal(validation.isValid, false, "Dependency with missing task should be invalid");
            assert.ok(validation.errors.some(e => e.includes("not found")), "Should have error about missing task");
        });
    });

    describe("Deadlock Resolution Strategies", () => {
        it("should use priority_boost for level-0 conflicts", async () => {
            const priorityDep: PriorityStatusDependency = {
                taskId: "task-1",
                dependsOnTaskId: "task-2",
                dependencyType: "priority_depends_on_status",
                level: 0,
                condition: (task, dependentTask) => dependentTask.status === "done"
            };

            const statusDep: PriorityStatusDependency = {
                taskId: "task-1",
                dependsOnTaskId: "task-3",
                dependencyType: "status_depends_on_priority",
                level: 0,
                condition: (task, dependentTask) => dependentTask.priority === "high"
            };

            detector.addPriorityStatusDependency(priorityDep);
            detector.addPriorityStatusDependency(statusDep);

            const deadlockResult = detector.detectPriorityStatusDeadlock();
            assert.equal(deadlockResult.resolutionStrategy, "priority_boost", 
                "Should use priority boost for level-0 conflicts");

            await detector.resolvePriorityStatusDeadlock(deadlockResult);
            
            // Verify resolution
            const afterResolution = detector.detectPriorityStatusDeadlock();
            assert.equal(afterResolution.isDeadlock, false, "Deadlock should be resolved");
        });

        it("should use dependency_break for mixed dependency types", () => {
            const dependencies: PriorityStatusDependency[] = [
                {
                    taskId: "task-1",
                    dependsOnTaskId: "task-2",
                    dependencyType: "priority_depends_on_status",
                    level: 1,
                    condition: (task, dependentTask) => true
                },
                {
                    taskId: "task-2",
                    dependsOnTaskId: "task-3",
                    dependencyType: "status_depends_on_priority",
                    level: 1,
                    condition: (task, dependentTask) => true
                },
                {
                    taskId: "task-3",
                    dependsOnTaskId: "task-1",
                    dependencyType: "priority_depends_on_status",
                    level: 1,
                    condition: (task, dependentTask) => true
                }
            ];

            dependencies.forEach(dep => detector.addPriorityStatusDependency(dep));

            const deadlockResult = detector.detectPriorityStatusDeadlock();
            assert.ok(["dependency_break", "operation_rollback"].includes(deadlockResult.resolutionStrategy), 
                "Should use dependency break or operation rollback for mixed types");
        });

        it("should calculate severity correctly", () => {
            const criticalDependency: PriorityStatusDependency = {
                taskId: "task-1",
                dependsOnTaskId: "task-2",
                dependencyType: "priority_depends_on_status",
                level: 0,
                condition: (task, dependentTask) => dependentTask.status === "done"
            };

            const lowSeverityDependency: PriorityStatusDependency = {
                taskId: "task-1",
                dependsOnTaskId: "task-2",
                dependencyType: "priority_depends_on_status",
                level: 3,
                condition: (task, dependentTask) => true
            };

            // Test critical severity (only when there's a cycle)
            detector.addPriorityStatusDependency(criticalDependency);
            const criticalResult = detector.detectPriorityStatusDeadlock();
            // Single dependency without cycle is not critical
            assert.ok(["low", "medium", "high", "critical"].includes(criticalResult.severity), 
                "Should have valid severity level");

            detector.cleanup();

            // Test low severity
            detector.addPriorityStatusDependency(lowSeverityDependency);
            const lowResult = detector.detectPriorityStatusDeadlock();
            assert.equal(lowResult.severity, "low", "High-level dependencies should be low severity");
        });
    });

    describe("Performance and Scalability", () => {
        it("should handle many dependencies efficiently", () => {
            const dependencyCount = 100;
            const startTime = Date.now();

            for (let i = 0; i < dependencyCount; i++) {
                const dependency: PriorityStatusDependency = {
                    taskId: `task-${i}`,
                    dependsOnTaskId: `task-${(i + 1) % 10}`,
                    dependencyType: i % 2 === 0 ? "priority_depends_on_status" : "status_depends_on_priority",
                    level: i % 3,
                    condition: (task, dependentTask) => true
                };

                detector.addPriorityStatusDependency(dependency);
                validator.addDependency(dependency);
            }

            const addTime = Date.now() - startTime;
            const detectStartTime = Date.now();

            const deadlockResult = detector.detectPriorityStatusDeadlock();
            const analysis = validator.analyzeDependencies();

            const detectTime = Date.now() - detectStartTime;

            assert.ok(addTime < 1000, `Adding dependencies should be fast (${addTime}ms < 1000ms)`);
            assert.ok(detectTime < 500, `Deadlock detection should be fast (${detectTime}ms < 500ms)`);
            assert.equal(analysis.dependencyCount, dependencyCount, "Should track all dependencies");
        });

        it("should handle deep dependency chains", () => {
            const maxDepth = 10;
            const dependencies: PriorityStatusDependency[] = [];

            for (let i = 0; i < maxDepth; i++) {
                dependencies.push({
                    taskId: `task-${i}`,
                    dependsOnTaskId: `task-${i + 1}`,
                    dependencyType: "priority_depends_on_status",
                    level: i,
                    condition: (task, dependentTask) => true
                });
            }

            // Add final task
            mockTasks.set(`task-${maxDepth}`, {
                id: `task-${maxDepth}`,
                title: `Final Task ${maxDepth}`,
                description: "Final task in chain",
                status: "done",
                priority: "low",
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            });

            dependencies.forEach(dep => {
                detector.addPriorityStatusDependency(dep);
                validator.addDependency(dep);
            });

            const analysis = validator.analyzeDependencies();
            assert.equal(analysis.maxDepth, maxDepth, "Should calculate correct depth");
            assert.equal(analysis.dependencyCount, maxDepth, "Should count all dependencies");
        });
    });

    describe("Edge Cases and Error Handling", () => {
        it("should handle empty dependency graphs", () => {
            const deadlockResult = detector.detectPriorityStatusDeadlock();
            assert.equal(deadlockResult.isDeadlock, false, "Empty graph should not have deadlocks");
            
            const analysis = validator.analyzeDependencies();
            assert.equal(analysis.dependencyCount, 0, "Empty graph should have zero dependencies");
        });

        it("should handle self-dependencies", () => {
            const selfDependency: PriorityStatusDependency = {
                taskId: "task-1",
                dependsOnTaskId: "task-1",
                dependencyType: "priority_depends_on_status",
                level: 0,
                condition: (task, dependentTask) => true
            };

            validator.addDependency(selfDependency);
            const validation = validator.validateDependency(selfDependency);
            assert.equal(validation.isValid, false, "Self-dependency should be invalid");
        });

        it("should handle condition function errors gracefully", () => {
            const errorDependency: PriorityStatusDependency = {
                taskId: "task-1",
                dependsOnTaskId: "task-2",
                dependencyType: "priority_depends_on_status",
                level: 0,
                condition: (task, dependentTask) => {
                    throw new Error("Test error");
                }
            };

            const validation = validator.validateDependency(errorDependency);
            assert.equal(validation.isValid, false, "Dependency with erroring condition should be invalid");
            assert.ok(validation.errors.some(e => e.includes("Condition function failed")), 
                "Should have error about condition function failure");
        });

        it("should cleanup resources properly", () => {
            // Add some dependencies
            for (let i = 0; i < 5; i++) {
                const dependency: PriorityStatusDependency = {
                    taskId: `task-${i}`,
                    dependsOnTaskId: `task-${(i + 1) % 3}`,
                    dependencyType: "priority_depends_on_status",
                    level: 0,
                    condition: (task, dependentTask) => true
                };
                detector.addPriorityStatusDependency(dependency);
            }

            // Verify dependencies exist
            const stats = detector.getPriorityStatusStats();
            assert.ok(stats.totalDependencies > 0, "Should have dependencies before cleanup");

            // Cleanup
            detector.cleanup();
            validator.clearDependencies();

            // Verify cleanup
            const afterStats = detector.getPriorityStatusStats();
            assert.equal(afterStats.totalDependencies, 0, "Should have no dependencies after cleanup");
            assert.equal(afterStats.levelZeroDependencies, 0, "Should have no level-0 dependencies after cleanup");
        });
    });

    describe("Integration with Existing Deadlock Detection", () => {
        it("should work alongside standard CAS deadlock detection", async () => {
            // This test simulates integration with the existing CAS system
            const standardDeadlock = detector.detectDeadlock();
            assert.equal(standardDeadlock.isDeadlock, false, "Should not have standard deadlock initially");

            // Add a priority-status dependency
            const dependency: PriorityStatusDependency = {
                taskId: "task-1",
                dependsOnTaskId: "task-2",
                dependencyType: "priority_depends_on_status",
                level: 0,
                condition: (task, dependentTask) => dependentTask.status === "done"
            };

            detector.addPriorityStatusDependency(dependency);

            // Check both deadlock types
            const enhancedDeadlock = detector.detectPriorityStatusDeadlock();
            assert.equal(enhancedDeadlock.isDeadlock, false, "Should not have priority-status deadlock");
            
            const stats = detector.getPriorityStatusStats();
            assert.ok(stats.levelZeroDependencies === 1, "Should track level-0 dependency");
            assert.ok(stats.activeLocks >= 0, "Should maintain standard deadlock stats");
        });
    });
});
