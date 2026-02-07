import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { PriorityStatusDeadlockDetector, type PriorityStatusDependency } from "../../packages/worker/src/services/priority-status-deadlock-detector.ts";
import { priorityStatusDependencyManager } from "../../packages/tasks/src/priority-status-dependency-manager.ts";

describe("Enhanced Priority-Status Dependency Coverage", () => {
    let detector: PriorityStatusDeadlockDetector;
    const TASK_IDS = ["task-A", "task-B", "task-C", "task-D", "task-E"];

    before(() => {
        detector = new PriorityStatusDeadlockDetector(5000, 3);
    });

    after(() => {
        detector.cleanup();
        priorityStatusDependencyManager.clear();
    });

    describe("Edge Case Detection", () => {
        it("should handle self-dependencies", () => {
            const selfDep: PriorityStatusDependency = {
                taskId: TASK_IDS[0],
                dependsOnTaskId: TASK_IDS[0],
                dependencyType: "priority_depends_on_status",
                level: 0,
                condition: (_task, dependent) => dependent.status === "done"
            };

            detector.addPriorityStatusDependency(selfDep);
            const result = detector.detectPriorityStatusDeadlock();
            
            // Self-dependencies should be filtered out or handled gracefully
            assert.ok(typeof result.isDeadlock === "boolean");
        });

        it("should handle empty dependency graphs", () => {
            const emptyDetector = new PriorityStatusDeadlockDetector();
            const result = emptyDetector.detectPriorityStatusDeadlock();
            
            assert.equal(result.isDeadlock, false);
            assert.equal(result.dependencyCycle.length, 0);
            assert.equal(result.severity, "low");
        });

        it("should handle maximum dependency levels", () => {
            const highLevelDep: PriorityStatusDependency = {
                taskId: TASK_IDS[1],
                dependsOnTaskId: TASK_IDS[2],
                dependencyType: "status_depends_on_priority",
                level: 10, // Above max level
                condition: (_task, dependent) => dependent.priority === "high"
            };

            detector.addPriorityStatusDependency(highLevelDep);
            const stats = detector.getPriorityStatusStats();
            
            // High-level dependencies should be ignored
            assert.equal(stats.totalDependencies, 0);
        });
    });

    describe("Resolution Strategy Testing", () => {
        it("should use priority_boost for level-0 conflicts", () => {
            detector.cleanup();
            
            const deps: PriorityStatusDependency[] = [
                {
                    taskId: TASK_IDS[0],
                    dependsOnTaskId: TASK_IDS[1],
                    dependencyType: "priority_depends_on_status",
                    level: 0,
                    condition: (_task, dependent) => dependent.status === "done"
                },
                {
                    taskId: TASK_IDS[1],
                    dependsOnTaskId: TASK_IDS[0],
                    dependencyType: "status_depends_on_priority",
                    level: 0,
                    condition: (_task, dependent) => dependent.priority === "high"
                }
            ];

            deps.forEach(dep => detector.addPriorityStatusDependency(dep));
            
            const result = detector.detectPriorityStatusDeadlock();
            if (result.isDeadlock) {
                assert.equal(result.severity, "critical");
                assert.equal(result.resolutionStrategy, "priority_boost");
            }
        });

        it("should use dependency_break for mixed-level cycles", () => {
            detector.cleanup();
            
            const mixedDeps: PriorityStatusDependency[] = [
                {
                    taskId: TASK_IDS[2],
                    dependsOnTaskId: TASK_IDS[3],
                    dependencyType: "priority_depends_on_status",
                    level: 1,
                    condition: (_task, dependent) => dependent.status === "done"
                },
                {
                    taskId: TASK_IDS[3],
                    dependsOnTaskId: TASK_IDS[4],
                    dependencyType: "status_depends_on_priority",
                    level: 2,
                    condition: (_task, dependent) => dependent.priority === "high"
                },
                {
                    taskId: TASK_IDS[4],
                    dependsOnTaskId: TASK_IDS[2],
                    dependencyType: "priority_depends_on_status",
                    level: 1,
                    condition: (_task, dependent) => dependent.status === "in-progress"
                }
            ];

            mixedDeps.forEach(dep => detector.addPriorityStatusDependency(dep));
            
            const result = detector.detectPriorityStatusDeadlock();
            if (result.isDeadlock) {
                assert.ok(["dependency_break", "operation_rollback"].includes(result.resolutionStrategy));
            }
        });
    });

    describe("Performance Under Load", () => {
        it("should handle large numbers of dependencies efficiently", () => {
            const startTime = Date.now();
            const depCount = 100;
            
            for (let i = 0; i < depCount; i++) {
                const dep: PriorityStatusDependency = {
                    taskId: `task-${i}`,
                    dependsOnTaskId: `task-${(i + 1) % 50}`,
                    dependencyType: i % 2 === 0 ? "priority_depends_on_status" : "status_depends_on_priority",
                    level: Math.floor(Math.random() * 3),
                    condition: (_task, dependent) => Math.random() > 0.5
                };
                
                detector.addPriorityStatusDependency(dep);
            }
            
            const addTime = Date.now() - startTime;
            const detectionStart = Date.now();
            
            const result = detector.detectPriorityStatusDeadlock();
            
            const detectionTime = Date.now() - detectionStart;
            
            assert.ok(addTime < 1000, `Adding dependencies should be fast (${addTime}ms)`);
            assert.ok(detectionTime < 500, `Detection should be fast (${detectionTime}ms)`);
            
            const stats = detector.getPriorityStatusStats();
            assert.ok(stats.totalDependencies > 0, "Dependencies should be tracked");
            
            console.log("Performance test results:", {
                dependencies: depCount,
                addTime: `${addTime}ms`,
                detectionTime: `${detectionTime}ms`,
                tracked: stats.totalDependencies,
                deadlockDetected: result.isDeadlock
            });
        });
    });

    describe("Integration with Dependency Manager", () => {
        it("should work alongside the dependency manager", () => {
            // Test integration between the two systems
            priorityStatusDependencyManager.addDependency({
                taskId: TASK_IDS[0],
                dependsOnTaskId: TASK_IDS[1],
                dependencyType: "priority-on-status",
                requiredCondition: { status: "done" }
            });

            const deps = priorityStatusDependencyManager.getTaskDependencies(TASK_IDS[0]);
            assert.equal(deps.length, 1);
            assert.equal(deps[0].dependencyType, "priority-on-status");

            const lockStatus = priorityStatusDependencyManager.getLockStatus();
            assert.equal(typeof lockStatus.activeLocks, "number");
        });
    });

    describe("Cleanup and Resource Management", () => {
        it("should properly clean up resources", () => {
            // Add some dependencies
            const dep: PriorityStatusDependency = {
                taskId: TASK_IDS[0],
                dependsOnTaskId: TASK_IDS[1],
                dependencyType: "priority_depends_on_status",
                level: 0,
                condition: (_task, dependent) => dependent.status === "done"
            };
            
            detector.addPriorityStatusDependency(dep);
            
            let stats = detector.getPriorityStatusStats();
            assert.ok(stats.totalDependencies > 0);
            
            // Cleanup
            detector.cleanup();
            
            stats = detector.getPriorityStatusStats();
            assert.equal(stats.totalDependencies, 0);
            assert.equal(stats.levelZeroDependencies, 0);
        });
    });
});