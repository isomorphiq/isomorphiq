import { PriorityConsistencyValidator, type TaskPriority } from "@isomorphiq/tasks";
import { ProductManager } from "@isomorphiq/profiles";
import path from "node:path";

/**
 * Enhanced priority consistency testing with optimizations
 * Tests the improved priority update system for performance and consistency
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class EnhancedPriorityConsistencyTester {
    private pm: ProductManager;

    constructor(pm: ProductManager) {
        this.pm = pm;
    }

    /**
     * Test optimized priority updates with batching
     */
    async testOptimizedPriorityUpdates(): Promise<void> {
        console.log("[ENHANCED PRIORITY TEST] Testing optimized priority updates...");

        // Create test tasks
        const tasks = [];
        for (let i = 0; i < 5; i++) {
            const task = await this.pm.createTask(
                `Optimized Test Task ${i}`,
                `Testing optimized priority updates ${i}`,
                "medium",
            );
            tasks.push(task);
        }

        console.log(`[ENHANCED PRIORITY TEST] Created ${tasks.length} test tasks`);

        // Test rapid priority updates to verify batching
        const startTime = Date.now();
        
        for (let i = 0; i < tasks.length; i++) {
            const newPriority: TaskPriority = i % 2 === 0 ? "high" : "low";
            await this.pm.updateTaskPriority(tasks[i].id, newPriority);
        }

        const endTime = Date.now();
        const duration = endTime - startTime;

        console.log(`[ENHANCED PRIORITY TEST] Completed priority updates in ${duration}ms`);

        // Verify all updates were applied correctly
        for (let i = 0; i < tasks.length; i++) {
            const expectedPriority = i % 2 === 0 ? "high" : "low";
            const updatedTask = await this.pm.getTask(tasks[i].id);
            
            if (!updatedTask) {
                throw new Error(`Task ${tasks[i].id} not found after priority update`);
            }

            if (updatedTask.priority !== expectedPriority) {
                throw new Error(
                    `Priority update failed for task ${tasks[i].id}: expected ${expectedPriority}, got ${updatedTask.priority}`,
                );
            }
        }

        console.log("[ENHANCED PRIORITY TEST] ✅ Optimized priority updates work correctly");
    }

    /**
     * Test priority update performance with large datasets
     */
    async testPriorityUpdatePerformance(): Promise<void> {
        console.log("[ENHANCED PRIORITY TEST] Testing priority update performance...");

        // Create a larger set of tasks for performance testing
        const taskCount = 20;
        const tasks = [];

        console.log(`[ENHANCED PRIORITY TEST] Creating ${taskCount} tasks for performance test...`);
        
        const createStartTime = Date.now();
        for (let i = 0; i < taskCount; i++) {
            const task = await this.pm.createTask(
                `Performance Test Task ${i}`,
                `Performance testing task ${i}`,
                "medium",
            );
            tasks.push(task);
        }
        const createEndTime = Date.now();

        console.log(`[ENHANCED PRIORITY TEST] Created ${taskCount} tasks in ${createEndTime - createStartTime}ms`);

        // Test batch priority updates
        console.log("[ENHANCED PRIORITY TEST] Testing batch priority updates...");
        
        const updateStartTime = Date.now();
        const updatePromises = tasks.map(async (task, index) => {
            const priorities: TaskPriority[] = ["high", "medium", "low"];
            const priority = priorities[index % priorities.length];
            return this.pm.updateTaskPriority(task.id, priority);
        });

        await Promise.all(updatePromises);
        const updateEndTime = Date.now();

        console.log(`[ENHANCED PRIORITY TEST] Updated ${taskCount} task priorities in ${updateEndTime - updateStartTime}ms`);
        console.log(`[ENHANCED PRIORITY TEST] Average time per update: ${Math.round((updateEndTime - updateStartTime) / taskCount)}ms`);

        // Verify consistency
        const allTasks = await this.pm.getAllTasks();
        const testTasks = allTasks.filter(task => task.title.includes("Performance Test Task"));
        
        if (testTasks.length !== taskCount) {
            throw new Error(`Expected ${taskCount} test tasks, found ${testTasks.length}`);
        }

        console.log("[ENHANCED PRIORITY TEST] ✅ Priority update performance test completed");
    }

    /**
     * Test priority ordering validation
     */
    async testPriorityOrderingValidation(): Promise<void> {
        console.log("[ENHANCED PRIORITY TEST] Testing priority ordering validation...");

        // Create tasks with specific priorities and creation times
        const tasks = [
            await this.pm.createTask("High Priority Task 1", "High priority test", "high"),
            await this.pm.createTask("Medium Priority Task 1", "Medium priority test", "medium"),
            await this.pm.createTask("Low Priority Task 1", "Low priority test", "low"),
            await this.pm.createTask("High Priority Task 2", "High priority test", "high"),
            await this.pm.createTask("Medium Priority Task 2", "Medium priority test", "medium"),
            await this.pm.createTask("Low Priority Task 2", "Low priority test", "low"),
        ];

        // Add small delays to ensure different creation times
        await new Promise(resolve => setTimeout(resolve, 10));

        // Get prioritized task list
        const prioritizedTasks = await this.pm.getTasksSortedByDependencies();
        const testTasksInList = prioritizedTasks.filter(task => 
            task.title.includes("Priority Task") && !task.title.includes("Consistency Test")
        );

        // Validate priority ordering
        const validation = PriorityConsistencyValidator.validatePriorityOrdering(testTasksInList);
        
        if (!validation.isValid) {
            console.error("[ENHANCED PRIORITY TEST] Priority ordering errors:");
            validation.errors.forEach(error => console.error(`  - ${error}`));
            throw new Error("Priority ordering validation failed");
        }

        console.log("[ENHANCED PRIORITY TEST] ✅ Priority ordering validation passed");
    }

    /**
     * Test cross-source consistency validation
     */
    async testCrossSourceConsistency(): Promise<void> {
        console.log("[ENHANCED PRIORITY TEST] Testing cross-source consistency...");

        // Create a test task
        const task = await this.pm.createTask(
            "Cross-Source Test Task",
            "Testing consistency across data sources",
            "medium",
        );

        // Update priority
        const updatedTask = await this.pm.updateTaskPriority(task.id, "high");

        // Get task from different sources
        const taskFromList = await this.pm.getTask(task.id);
        const allTasks = await this.pm.getAllTasks();
        const taskFromAllList = allTasks.find(t => t.id === task.id);
        const prioritizedTasks = await this.pm.getTasksSortedByDependencies();
        const taskFromQueue = prioritizedTasks.find(t => t.id === task.id);

        // Validate cross-source consistency
        const validation = PriorityConsistencyValidator.validateCrossSourceConsistency(
            updatedTask,
            taskFromAllList || null,
            taskFromQueue || null,
        );

        if (!validation.isValid) {
            console.error("[ENHANCED PRIORITY TEST] Cross-source consistency errors:");
            validation.errors.forEach(error => console.error(`  - ${error}`));
            throw new Error("Cross-source consistency validation failed");
        }

        console.log("[ENHANCED PRIORITY TEST] ✅ Cross-source consistency validation passed");
    }

    /**
     * Test edge cases and error handling
     */
    async testEdgeCasesAndErrorHandling(): Promise<void> {
        console.log("[ENHANCED PRIORITY TEST] Testing edge cases and error handling...");

        const task = await this.pm.createTask(
            "Edge Case Test Task",
            "Testing edge cases",
            "medium",
        );

        // Test updating to same priority
        const samePriorityTask = await this.pm.updateTaskPriority(task.id, "medium");
        if (samePriorityTask.priority !== "medium") {
            throw new Error("Updating to same priority should maintain the priority");
        }

        // Test rapid priority changes
        await this.pm.updateTaskPriority(task.id, "high");
        await this.pm.updateTaskPriority(task.id, "low");
        const finalTask = await this.pm.updateTaskPriority(task.id, "medium");
        if (finalTask.priority !== "medium") {
            throw new Error("Rapid priority changes should work correctly");
        }

        // Test invalid priority values
        try {
            // @ts-expect-error - Testing invalid priority
            await this.pm.updateTaskPriority(task.id, "invalid");
            throw new Error("Should have thrown an error for invalid priority");
        } catch (error) {
            if (!(error instanceof Error) || !error.message.includes("Invalid priority")) {
                throw new Error("Should have thrown a proper error for invalid priority");
            }
        }

        // Test priority update with dependencies
        const dependentTask = await this.pm.createTask(
            "Dependent Task",
            "Task with dependencies",
            "low",
        );
        
        await this.pm.addDependency(dependentTask.id, task.id, "test-user");
        const updatedDependentTask = await this.pm.updateTaskPriority(dependentTask.id, "high");
        
        if (updatedDependentTask.priority !== "high") {
            throw new Error("Failed to update priority of task with dependencies");
        }

        // Verify dependencies are preserved
        if (!updatedDependentTask.dependencies.includes(task.id)) {
            throw new Error("Dependencies should be preserved when updating priority");
        }

        console.log("[ENHANCED PRIORITY TEST] ✅ Edge cases and error handling passed");
    }

    /**
     * Run all enhanced priority consistency tests
     */
    async runAllEnhancedTests(): Promise<void> {
        console.log("[ENHANCED PRIORITY TEST] Starting enhanced priority consistency tests...");

        try {
            await this.testOptimizedPriorityUpdates();
            await this.testPriorityUpdatePerformance();
            await this.testPriorityOrderingValidation();
            await this.testCrossSourceConsistency();
            await this.testEdgeCasesAndErrorHandling();

            console.log("[ENHANCED PRIORITY TEST] ✅ All enhanced priority consistency tests passed!");
        } catch (error) {
            console.error("[ENHANCED PRIORITY TEST] ❌ Enhanced priority consistency test failed:", error);
            throw error;
        }
    }
}

/**
 * Run enhanced priority consistency tests
 */
export async function runEnhancedPriorityConsistencyTests(): Promise<void> {
    const testDbPath = path.join(process.cwd(), "test-enhanced-priority-db");
    const pm = new ProductManager(testDbPath);
    await pm.initialize();
    
    const tester = new EnhancedPriorityConsistencyTester(pm);
    await tester.runAllEnhancedTests();
    
    await pm.cleanup();
}

// Run tests if this file is executed directly
if (import.meta.main) {
    await runEnhancedPriorityConsistencyTests();
}

