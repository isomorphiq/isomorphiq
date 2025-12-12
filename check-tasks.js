#!/usr/bin/env node

import { ProductManager } from "./src/index.ts";

async function main() {
    const pm = new ProductManager();
    try {
        const tasks = await pm.getAllTasks();
        console.log(`Found ${tasks.length} tasks:`);
        
        if (tasks.length === 0) {
            console.log("No tasks found. Creating a sample high-priority task...");
            const newTask = await pm.createTask(
                "Implement critical security fix",
                "Fix authentication vulnerability in user login system",
                "high",
                [],
                "system",
                "development"
            );
            console.log("Created task:", newTask.id);
            return;
        }
        
        // Sort by priority (high > medium > low) and then by creation date
        const priorityOrder = { high: 3, medium: 2, low: 1 };
        const sortedTasks = tasks.sort((a, b) => {
            const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
            if (priorityDiff !== 0) return priorityDiff;
            return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        });
        
        console.log("\nTasks sorted by priority:");
        sortedTasks.forEach((task, index) => {
            console.log(`${index + 1}. [${task.priority.toUpperCase()}] ${task.title} (${task.id}) - ${task.status}`);
        });
        
        const highestPriorityTask = sortedTasks[0];
        console.log(`\nHighest priority task: [${highestPriorityTask.priority.toUpperCase()}] ${highestPriorityTask.title}`);
        console.log(`Task ID: ${highestPriorityTask.id}`);
        console.log(`Status: ${highestPriorityTask.status}`);
        console.log(`Description: ${highestPriorityTask.description}`);
        
    } catch (error) {
        console.error("Error:", error);
    }
}

main().catch(console.error);