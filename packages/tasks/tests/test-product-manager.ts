import { ProductManager } from "@isomorphiq/user-profile";

/**
 * Simple test for ProductManager functionality
 */
async function testProductManager(): Promise<void> {
    console.log("=== Testing ProductManager ===");
    
    const productManager = new ProductManager("./test-db");
    
    try {
        // Initialize
        await productManager.initialize();
        console.log("✅ ProductManager initialized successfully");
        
        // Create a test task
        const task = await productManager.createTask(
            "Test Task",
            "This is a test task for ProductManager",
            "high",
            [],
            "test-user"
        );
        console.log("✅ Task created:", task.id, task.title);
        
        // Get the task
        const retrievedTask = await productManager.getTask(task.id);
        if (retrievedTask) {
            console.log("✅ Task retrieved successfully:", retrievedTask.title);
        } else {
            console.log("❌ Failed to retrieve task");
        }
        
        // Update task status
        const updatedTask = await productManager.updateTaskStatus(task.id, "in-progress");
        console.log("✅ Task status updated:", updatedTask.status);
        
        // Get all tasks
        const allTasks = await productManager.getAllTasks();
        console.log("✅ Retrieved all tasks:", allTasks.length);
        
        // Test dependency validation
        const validation = productManager.validateDependencies(allTasks);
        console.log("✅ Dependency validation:", validation.isValid ? "Valid" : "Invalid");
        
        console.log("=== ProductManager test completed successfully ===");
        
        // Cleanup
        await productManager.cleanup();
        
    } catch (error) {
        console.error("❌ ProductManager test failed:", error);
        process.exit(1);
    }
}

// Run the test
testProductManager().catch(console.error);
