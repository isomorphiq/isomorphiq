#!/usr/bin/env node

import { ProductManager } from "@isomorphiq/user-profile";

async function completeTask() {
    const taskId = "task-1765516228776-i0emhswko";
    
    console.log("Initializing ProductManager...");
    const pm = new ProductManager();
    
    try {
        console.log(`Updating task ${taskId} status to in-progress...`);
        const taskInProgress = await pm.updateTaskStatus(taskId, "in-progress");
        console.log("Task updated to in-progress:", taskInProgress.id);
        
        setTimeout(async () => {
console.log(`Updating task ${taskId} status to done...`);
            const taskCompleted = await pm.updateTaskStatus(taskId, "done");
            console.log("Task updated to done:", taskCompleted.id);
            console.log("Task 3 implementation complete!");
            process.exit(0);
        }, 1000);
        
    } catch (error) {
        console.error("Error updating task:", error);
        process.exit(1);
    }
}

completeTask();
