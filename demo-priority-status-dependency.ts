import { PriorityStatusDeadlockDetector, type PriorityStatusDependency } from "./packages/worker/src/services/priority-status-deadlock-detector.ts";

console.log("=== Priority-Status Dependency Demonstration ===\n");

// Create the deadlock detector
const detector = new PriorityStatusDeadlockDetector(5000, 3);

// Sample task IDs
const tasks = ["task-1", "task-2", "task-3", "task-4"];

// Create priority-status dependencies
const dependencies: PriorityStatusDependency[] = [
    {
        taskId: tasks[0],
        dependsOnTaskId: tasks[1],
        dependencyType: "priority_depends_on_status",
        level: 0,
        condition: (task, dependent) => dependent.status === "done"
    },
    {
        taskId: tasks[1],
        dependsOnTaskId: tasks[2],
        dependencyType: "status_depends_on_priority",
        level: 0,
        condition: (task, dependent) => dependent.priority === "high"
    },
    {
        taskId: tasks[2],
        dependsOnTaskId: tasks[3],
        dependencyType: "priority_depends_on_status",
        level: 0,
        condition: (task, dependent) => dependent.status === "in-progress"
    },
    {
        taskId: tasks[3],
        dependsOnTaskId: tasks[0],
        dependencyType: "status_depends_on_priority",
        level: 0,
        condition: (task, dependent) => dependent.priority !== "low"
    }
];

console.log("Adding priority-status dependencies...");
for (const dep of dependencies) {
    detector.addPriorityStatusDependency(dep);
    console.log(`  Added: ${dep.taskId} ${dep.dependencyType} ${dep.dependsOnTaskId}`);
}

console.log("\nDetecting deadlocks...");
const result = detector.detectPriorityStatusDeadlock();

console.log(`Deadlock detected: ${result.isDeadlock}`);
if (result.isDeadlock) {
    console.log(`  Severity: ${result.severity}`);
    console.log(`  Resolution Strategy: ${result.resolutionStrategy}`);
    console.log(`  Victims: ${result.victimOperations.join(", ")}`);
    console.log(`  Cycle length: ${result.dependencyCycle.length}`);
    
    console.log("\nResolving deadlock...");
    detector.resolvePriorityStatusDeadlock(result).then(() => {
        console.log("Deadlock resolved!");
        
        const afterResult = detector.detectPriorityStatusDeadlock();
        console.log(`After resolution - Deadlock detected: ${afterResult.isDeadlock}`);
        
        const stats = detector.getPriorityStatusStats();
        console.log("\nFinal stats:", stats);
        
        detector.cleanup();
        console.log("\n=== Demonstration Complete ===");
    });
} else {
    console.log("No deadlock detected.");
    detector.cleanup();
    console.log("=== Demonstration Complete ===");
}