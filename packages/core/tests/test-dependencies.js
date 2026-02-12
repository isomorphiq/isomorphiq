#!/usr/bin/env node
import { ProductManager } from "@isomorphiq/profiles";
async function testDependencyProcessing() {
    console.log('[TEST] Starting dependency processing test...');
    const pm = new ProductManager();
    try {
        // Clear existing tasks for clean test
        const existingTasks = await pm.getAllTasks();
        for (const task of existingTasks) {
            await pm.deleteTask(task.id);
        }
        console.log('[TEST] Cleared existing tasks');
        // Create tasks with dependencies
        const task1 = await pm.createTask('Setup database schema', 'Create the initial database schema for user management', 'high', []);
        console.log(`[TEST] Created task 1: ${task1.id}`);
        const task2 = await pm.createTask('Implement user authentication', 'Add login and registration functionality', 'high', [task1.id]);
        console.log(`[TEST] Created task 2: ${task2.id} (depends on ${task1.id})`);
        const task3 = await pm.createTask('Create user profile page', 'Build the UI for user profile management', 'medium', [task2.id]);
        console.log(`[TEST] Created task 3: ${task3.id} (depends on ${task2.id})`);
        const task4 = await pm.createTask('Write unit tests', 'Create comprehensive unit tests for all modules', 'medium', []);
        console.log(`[TEST] Created task 4: ${task4.id} (no dependencies)`);
        // Test dependency-aware sorting
        console.log('\n[TEST] Testing dependency-aware sorting...');
        const sortedTasks = await pm.getTasksSortedByDependencies();
        console.log('\n[TEST] Tasks in execution order:');
        for (let i = 0; i < sortedTasks.length; i++) {
            const task = sortedTasks[i];
            if (task) {
                const depStr = task.dependencies.length > 0 ? ` (depends on: ${task.dependencies.join(', ')})` : ' (no dependencies)';
                console.log(`  ${i + 1}. ${task.title}${depStr}`);
            }
        }
        // Verify the order is correct
        const taskIds = sortedTasks.map(t => t.id);
        const task1Index = taskIds.indexOf(task1.id);
        const task2Index = taskIds.indexOf(task2.id);
        const task3Index = taskIds.indexOf(task3.id);
        console.log('\n[TEST] Validating dependency order...');
        if (task1Index < task2Index && task2Index < task3Index) {
            console.log('[TEST] ✅ Dependency order is correct');
        }
        else {
            console.log('[TEST] ❌ Dependency order is incorrect');
            console.log(`[TEST] Task1 index: ${task1Index}, Task2 index: ${task2Index}, Task3 index: ${task3Index}`);
        }
        // Test priority within dependency levels
        console.log('\n[TEST] Testing priority ordering within dependency levels...');
        const highPriorityTask = await pm.createTask('High priority independent task', 'This should come before other independent tasks', 'high', []);
        const sortedWithPriority = await pm.getTasksSortedByDependencies();
        const independentTasks = sortedWithPriority.filter(t => t.dependencies.length === 0);
        console.log('[TEST] Independent tasks (should be sorted by priority):');
        independentTasks.forEach((task, index) => {
            console.log(`  ${index + 1}. ${task.title} (${task.priority})`);
        });
        console.log('\n[TEST] ✅ Dependency processing test completed successfully!');
    }
    catch (error) {
        console.error('[TEST] ❌ Test failed:', error);
    }
}
// Run the test
testDependencyProcessing().catch(console.error);
//# sourceMappingURL=test-dependencies.js.map
