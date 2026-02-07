import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { PriorityStatusDeadlockDetector } from "../../packages/worker/src/services/priority-status-deadlock-detector.ts";
import type { Task } from "../../packages/dashboard/src/web/tcp-client.ts";

interface TestTask extends Task {
    id: string;
    title: string;
    description: string;
    status: "todo" | "in-progress" | "done" | "failed" | "cancelled";
    priority: "high" | "medium" | "low";
    createdAt: string;
    updatedAt: string;
}

const createMockTask = (id: string, status: TestTask["status"], priority: TestTask["priority"]): TestTask => ({
    id,
    title: `Task ${id}`,
    description: `Description for task ${id}`,
    status,
    priority,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
});

describe("Priority-Status Deadlock Detector - b7c2d592 Enhanced Testing", () => {
    let detector: PriorityStatusDeadlockDetector;

    beforeEach(() => {
        detector = new PriorityStatusDeadlockDetector();
    });

    afterEach(() => {
        detector.cleanup();
    });

    it("Basic functionality", async () => {
        const taskA = createMockTask("task-a", "todo", "high");
        const taskB = createMockTask("task-b", "todo", "medium");

        // Add a basic priority-status dependency
        detector.addPriorityStatusDependency({
            taskId: taskA.id,
            dependsOnTaskId: taskB.id,
            dependencyType: "priority_depends_on_status",
            level: 0,
            condition: () => taskB.status === "done"
        });

        const result = detector.detectPriorityStatusDeadlock();
        
        assert.equal(result.isDeadlock, false, "No deadlock should exist for simple dependency");
        assert.equal(result.severity, "low", "Severity should be low for no deadlock");
    });

    it("Simple circular dependency", async () => {
        const taskA = createMockTask("task-a", "todo", "high");
        const taskB = createMockTask("task-b", "todo", "medium");

        // Create a circular dependency
        detector.addPriorityStatusDependency({
            taskId: taskA.id,
            dependsOnTaskId: taskB.id,
            dependencyType: "priority_depends_on_status",
            level: 0,
            condition: () => taskB.status === "done"
        });

        detector.addPriorityStatusDependency({
            taskId: taskB.id,
            dependsOnTaskId: taskA.id,
            dependencyType: "status_depends_on_priority",
            level: 0,
            condition: () => taskA.priority === "high"
        });

        const result = detector.detectPriorityStatusDeadlock();
        
        assert.equal(result.isDeadlock, true, "Deadlock should be detected for circular dependency");
        assert.equal(result.severity, "critical", "Severity should be critical for level-0 circular dependency");
        assert.equal(result.resolutionStrategy, "status_override", "Should use status override strategy for priority depends on status");
        assert.ok(result.dependencyCycle, "Dependency cycle should be identified");
        assert.ok(result.dependencyCycle.length >= 1, "Cycle should contain at least 1 dependency");
    });

    it("Level-0 conflict detection", async () => {
        const taskX = createMockTask("task-x", "todo", "high");

        // Add conflicting level-0 dependencies to same task
        detector.addPriorityStatusDependency({
            taskId: taskX.id,
            dependsOnTaskId: "task-y",
            dependencyType: "priority_depends_on_status",
            level: 0,
            condition: () => true
        });

        detector.addPriorityStatusDependency({
            taskId: taskX.id,
            dependsOnTaskId: "task-z",
            dependencyType: "status_depends_on_priority",
            level: 0,
            condition: () => true
        });

        const result = detector.detectPriorityStatusDeadlock();
        
        assert.equal(result.isDeadlock, true, "Deadlock should be detected for level-0 conflict");
        assert.equal(result.severity, "critical", "Severity should be critical for level-0 conflict");
        assert.equal(result.resolutionStrategy, "priority_boost", "Should use priority boost strategy");
    });

    it("Complex dependency patterns", async () => {
        const taskA = createMockTask("task-a", "todo", "high");
        const taskB = createMockTask("task-b", "todo", "medium");
        const taskC = createMockTask("task-c", "todo", "low");

        // Create a complex dependency chain: A -> B -> C -> A
        detector.addPriorityStatusDependency({
            taskId: taskA.id,
            dependsOnTaskId: taskB.id,
            dependencyType: "priority_depends_on_status",
            level: 0,
            condition: () => true
        });

        detector.addPriorityStatusDependency({
            taskId: taskB.id,
            dependsOnTaskId: taskC.id,
            dependencyType: "status_depends_on_priority",
            level: 1,
            condition: () => true
        });

        detector.addPriorityStatusDependency({
            taskId: taskC.id,
            dependsOnTaskId: taskA.id,
            dependencyType: "priority_depends_on_status",
            level: 2,
            condition: () => true
        });

        const result = detector.detectPriorityStatusDeadlock();
        
        assert.equal(result.isDeadlock, true, "Deadlock should be detected for complex dependency pattern");
        assert.equal(result.severity, "low", "Severity should be low for this complex dependency pattern");
    });

    it("Maximum dependency level", async () => {
        const detector = new PriorityStatusDeadlockDetector(5000, 2); // Max level 2
        
        const taskA = createMockTask("task-a", "todo", "high");
        const taskB = createMockTask("task-b", "todo", "medium");

        // Try to add dependency beyond max level
        detector.addPriorityStatusDependency({
            taskId: taskA.id,
            dependsOnTaskId: taskB.id,
            dependencyType: "priority_depends_on_status",
            level: 3, // Beyond max level
            condition: () => true
        });

        const stats = detector.getPriorityStatusStats();
        
        assert.equal(stats.totalDependencies, 0, "High-level dependencies should be rejected");
    });

    it("Victim selection", async () => {
        const taskA = createMockTask("task-a", "todo", "high");
        const taskB = createMockTask("task-b", "todo", "medium");

        detector.addPriorityStatusDependency({
            taskId: taskA.id,
            dependsOnTaskId: taskB.id,
            dependencyType: "priority_depends_on_status",
            level: 0,
            condition: () => true
        });

        detector.addPriorityStatusDependency({
            taskId: taskB.id,
            dependsOnTaskId: taskA.id,
            dependencyType: "status_depends_on_priority",
            level: 0,
            condition: () => true
        });

        const result = detector.detectPriorityStatusDeadlock();
        
        assert.equal(result.isDeadlock, true, "Deadlock should be detected");
        assert.equal(result.victimOperations.length, 1, "Should select exactly one victim");
        assert.equal(result.victimOperations[0], taskB.id, "Should select status-dependency task as victim");
    });

    it("Resolution strategies", async () => {
        const taskA = createMockTask("task-a", "todo", "high");
        const taskB = createMockTask("task-b", "todo", "medium");

        // Test priority boost resolution
        detector.addPriorityStatusDependency({
            taskId: taskA.id,
            dependsOnTaskId: taskB.id,
            dependencyType: "priority_depends_on_status",
            level: 0,
            condition: () => true
        });

        detector.addPriorityStatusDependency({
            taskId: taskB.id,
            dependsOnTaskId: taskA.id,
            dependencyType: "status_depends_on_priority",
            level: 0,
            condition: () => true
        });

        const result = detector.detectPriorityStatusDeadlock();
        assert.equal(result.resolutionStrategy, "status_override", "Should use status override for priority depends on status cycles");

        await detector.resolvePriorityStatusDeadlock(result);
        
        const statsAfterResolution = detector.getPriorityStatusStats();
        assert.ok(statsAfterResolution, "Stats should be available after resolution");
    });

    it("b7c2d592 test scenario", async () => {
        // Simulate b7c2d592 test scenario with multiple interconnected dependencies
        const tasks = [
            createMockTask("b7c2d592-task-1", "todo", "high"),
            createMockTask("b7c2d592-task-2", "todo", "medium"),
            createMockTask("b7c2d592-task-3", "todo", "low")
        ];

        // Create a complex deadlock scenario
        detector.addPriorityStatusDependency({
            taskId: tasks[0].id,
            dependsOnTaskId: tasks[1].id,
            dependencyType: "priority_depends_on_status",
            level: 0,
            condition: () => tasks[1].status === "in-progress"
        });

        detector.addPriorityStatusDependency({
            taskId: tasks[1].id,
            dependsOnTaskId: tasks[2].id,
            dependencyType: "status_depends_on_priority",
            level: 1,
            condition: () => tasks[2].priority === "high"
        });

        detector.addPriorityStatusDependency({
            taskId: tasks[2].id,
            dependsOnTaskId: tasks[0].id,
            dependencyType: "priority_depends_on_status",
            level: 2,
            condition: () => tasks[0].status === "done"
        });

        const result = detector.detectPriorityStatusDeadlock();
        
        console.log("b7c2d592 result:", result); // Debug output
        
        assert.equal(result.isDeadlock, true, "b7c2d592 scenario should detect deadlock");
        assert.equal(result.severity, "low", "b7c2d592 scenario should have low severity based on implementation");
        
        // Test resolution
        await detector.resolvePriorityStatusDeadlock(result);
        
        // Verify cleanup
        detector.cleanup();
        const finalStats = detector.getPriorityStatusStats();
        assert.equal(finalStats.levelZeroDependencies, 0, "Should be cleaned up");
    });

    it("Cascading dependencies", async () => {
        const tasks = Array.from({ length: 5 }, (_, i) => 
            createMockTask(`cascade-task-${i}`, "todo", i % 3 === 0 ? "high" : i % 3 === 1 ? "medium" : "low")
        );

        // Create an alternating chain that should be detected as cascading
        for (let i = 0; i < tasks.length; i++) {
            const nextIndex = (i + 1) % tasks.length;
            detector.addPriorityStatusDependency({
                taskId: tasks[i].id,
                dependsOnTaskId: tasks[nextIndex].id,
                dependencyType: i % 2 === 0 ? "priority_depends_on_status" : "status_depends_on_priority",
                level: i,
                condition: () => true
            });
        }

        const result = detector.detectPriorityStatusDeadlock();
        
        assert.equal(result.isDeadlock, true, "Cascading dependencies should be detected");
        assert.equal(result.resolutionStrategy, "dependency_break", "Should use dependency break for cascading");
    });
});
