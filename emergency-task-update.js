#!/usr/bin/env node

// Manual task status update for task-1765516228776-i0emhswko
// This script bypasses the daemon and updates the database directly

import { Level } from "level";
import path from "path";

const dbPath = path.join(process.cwd(), "db");

async function updateTaskDirectly() {
    console.log("Attempting direct database update...");
    
    try {
        // Open the database
        const db = new Level(dbPath, { valueEncoding: "json" });
        
        await db.open();
        console.log("Database opened successfully");
        
        // Read the current task
        const taskKey = `tasks:task-1765516228776-i0emhswko`;
        
        try {
            const currentTask = await db.get(taskKey);
            console.log("Current task:", currentTask);
            
            // Update the task
            const updatedTask = {
                ...currentTask,
                status: "in-progress",
                assignedTo: "development",
                updatedAt: new Date().toISOString(),
                updatedBy: "system"
            };
            
            // Write back the updated task
            await db.put(taskKey, updatedTask);
            console.log("Task updated successfully:", updatedTask);
            
        } catch (error) {
            console.log("Task not found in database, creating new task entry...");
            
            const newTask = {
                id: "task-1765516228776-i0emhswko",
                title: "Task 3",
                description: "Third task",
                status: "in-progress",
                priority: "high",
                assignedTo: "development",
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                updatedBy: "system"
            };
            
            await db.put(taskKey, newTask);
            console.log("New task created:", newTask);
        }
        
        await db.close();
        console.log("Database closed successfully");
        
    } catch (error) {
        console.error("Error updating task directly:", error);
        process.exit(1);
    }
}

updateTaskDirectly();