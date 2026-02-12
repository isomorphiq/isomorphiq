#!/usr/bin/env node

import { LevelDbTaskRepository } from "./packages/tasks/src/persistence/leveldb-task-repository.ts";

async function debugThemeTasks() {
    console.log("🔍 Debugging theme tasks in database...");
    
    const repo = new LevelDbTaskRepository();
    
    try {
        const result = await repo.findAll();
        if (!result.success) {
            console.error("❌ Failed to fetch tasks:", result.error);
            return;
        }
        
        const allTasks = result.data || [];
        console.log(`📊 Total tasks in database: ${allTasks.length}`);
        
        // Group tasks by type
        const tasksByType: Record<string, number> = {};
        const themeTasks: any[] = [];
        
        if (!allTasks) {
            console.error("❌ No tasks data available");
            return;
        }
        
        for (const task of allTasks) {
            const type = task.type || "undefined";
            tasksByType[type] = (tasksByType[type] || 0) + 1;
            
            if (type === "theme") {
                themeTasks.push(task);
            }
        }
        
        console.log("\n📈 Tasks by type:");
        for (const [type, count] of Object.entries(tasksByType)) {
            console.log(`  ${type}: ${count}`);
        }
        
        console.log(`\n🎨 Theme tasks found: ${themeTasks.length}`);
        if (themeTasks.length > 0) {
            console.log("Theme task details:");
            for (const task of themeTasks) {
                console.log(`  - ID: ${task.id}`);
                console.log(`    Title: ${task.title}`);
                console.log(`    Status: ${task.status}`);
                console.log(`    Type: ${task.type}`);
                console.log(`    CreatedAt: ${task.createdAt}`);
                console.log("");
            }
        } else {
            console.log("❌ No theme tasks found in database!");
            
            // Show some example tasks to understand the data
            console.log("\n🔍 Sample tasks (first 5):");
            for (let i = 0; i < Math.min(5, allTasks.length); i++) {
                const task = allTasks[i];
                console.log(`  - ID: ${task.id}`);
                console.log(`    Title: ${task.title}`);
                console.log(`    Status: ${task.status}`);
                console.log(`    Type: ${task.type}`);
                console.log("");
            }
        }
        
    } catch (error) {
        console.error("❌ Error:", error);
    } finally {
        // Close the database connection if needed
        process.exit(0);
    }
}

debugThemeTasks();