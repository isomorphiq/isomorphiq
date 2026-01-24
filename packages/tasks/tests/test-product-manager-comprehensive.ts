import { ProductManager } from "@isomorphiq/tasks";

/**
 * Comprehensive test for ProductManager functionality
 */
async function testProductManagerComprehensive(): Promise<void> {
    console.log("=== Comprehensive ProductManager Test ===");
    
    const productManager = new ProductManager("./test-db-comprehensive");
    
    try {
        // Initialize
        await productManager.initialize();
        console.log("✅ ProductManager initialized successfully");
        
        // Test 1: Create multiple tasks with different priorities
        console.log("\n--- Test 1: Creating tasks ---");
        const task1 = await productManager.createTask(
            "High Priority Feature",
            "Implement user authentication system",
            "high",
            [],
            "product-manager"
        );
        
        const task2 = await productManager.createTask(
            "Medium Priority Bug Fix",
            "Fix login page validation error",
            "medium",
            [task1.id], // depends on task1
            "product-manager"
        );
        
        const task3 = await productManager.createTask(
            "Low Priority Documentation",
            "Write API documentation",
            "low",
            [],
            "product-manager"
        );
        
        console.log("✅ Created 3 tasks with different priorities and dependencies");
        
        // Test 2: Get tasks by status
        console.log("\n--- Test 2: Query tasks by status ---");
        const todoTasks = await productManager.getTasksByStatus("todo");
        console.log(`✅ Found ${todoTasks.length} todo tasks`);
        
        // Test 3: Update task with assignment
        console.log("\n--- Test 3: Task assignment ---");
        const assignedTask = await productManager.assignTask(task1.id, "developer-1", "product-manager");
        console.log(`✅ Assigned task to: ${assignedTask.assignedTo}`);
        
        // Test 4: Add collaborators
        console.log("\n--- Test 4: Add collaborators ---");
        const collabTask = await productManager.addCollaborator(task1.id, "designer-1", "product-manager");
        console.log(`✅ Added collaborator: ${collabTask.collaborators?.join(", ")}`);
        
        // Test 5: Update task priority
        console.log("\n--- Test 5: Update priority ---");
        const priorityTask = await productManager.updateTaskPriority(task3.id, "high", "product-manager");
        console.log(`✅ Updated priority to: ${priorityTask.priority}`);
        
        // Test 6: Search tasks
        console.log("\n--- Test 6: Search tasks ---");
        const searchResult = await productManager.searchTasks({
            query: "authentication",
            filters: { priority: ["high"] },
            sort: { field: "createdAt", direction: "desc" }
        });
        console.log(`✅ Search found ${searchResult.total} tasks`);
        
        // Test 7: Get tasks for user
        console.log("\n--- Test 7: Get tasks for user ---");
        const userTasks = await productManager.getTasksForUser("product-manager");
        console.log(`✅ Found ${userTasks.length} tasks for user`);
        
        // Test 8: Dependency validation
        console.log("\n--- Test 8: Dependency validation ---");
        const allTasks = await productManager.getAllTasks();
        const validation = productManager.validateDependencies(allTasks);
        console.log(`✅ Dependency validation: ${validation.isValid ? "Valid" : "Invalid"}`);
        if (validation.warnings.length > 0) {
            console.log(`⚠️  Warnings: ${validation.warnings.join(", ")}`);
        }
        
        // Test 9: Get tasks sorted by dependencies
        console.log("\n--- Test 9: Tasks sorted by dependencies ---");
        const sortedTasks = await productManager.getTasksSortedByDependencies();
        console.log(`✅ Tasks sorted by dependencies: ${sortedTasks.length} tasks`);
        sortedTasks.forEach((task, index) => {
            console.log(`  ${index + 1}. ${task.title} (${task.priority}) - deps: [${task.dependencies.join(", ")}]`);
        });
        
        // Test 10: Create task from template
        console.log("\n--- Test 10: Template operations ---");
        const templateManager = productManager.getTemplateManager();
        const templates = await templateManager.getAllTemplates();
        if (templates.length > 0) {
            const templateResult = await productManager.createTaskFromTemplate({
                templateId: templates[0].id,
                variables: { featureName: "Test Feature", description: "Testing template system" },
                subtasks: true
            });
            console.log(`✅ Created task from template: ${templateResult.mainTask.title}`);
            console.log(`✅ Created ${templateResult.subtasks.length} subtasks`);
        }
        
        // Test 11: Task lifecycle
        console.log("\n--- Test 11: Task lifecycle ---");
        await productManager.updateTaskStatus(task1.id, "in-progress");
        await productManager.updateTaskStatus(task1.id, "done");
        console.log("✅ Task lifecycle completed");
        
        // Test 12: Cleanup
        console.log("\n--- Test 12: Cleanup ---");
        await productManager.deleteTask(task3.id, "product-manager");
        console.log("✅ Task deleted");
        
        console.log("\n=== All ProductManager tests completed successfully ===");
        
        // Cleanup
        await productManager.cleanup();
        
    } catch (error) {
        console.error("❌ ProductManager comprehensive test failed:", error);
        process.exit(1);
    }
}

// Run the comprehensive test
testProductManagerComprehensive().catch(console.error);
