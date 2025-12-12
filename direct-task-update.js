#!/usr/bin/env node

import { ProductManager } from "./src/product-manager.ts";

const pm = new ProductManager();
const taskId = "task-1765516228776-i0emhswko";

try {
    console.log("Initializing product manager...");
    await pm.initialize();
    
    console.log("Updating task status to in-progress...");
    const updatedTask = await pm.updateTaskStatus(taskId, "in-progress", "development");
    
    console.log("Task updated successfully:", updatedTask);
    
    await pm.close();
} catch (error) {
    console.error("Error:", error);
    process.exit(1);
}