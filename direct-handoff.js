#!/usr/bin/env node

import { Level } from 'level';
import path from 'path';

async function directlyHandoffTask() {
    try {
        console.log("🎯 Accessing task database directly...");
        
        const taskDb = new Level(path.join(process.cwd(), 'test-priority-db'), { valueEncoding: 'json' });
        
        const tasks = [];
        for await (const [key, value] of taskDb.iterator()) {
            tasks.push(value);
        }
        
        console.log(`📊 Found ${tasks.length} tasks in database`);
        
        // Find highest priority todo task
        const todoTasks = tasks.filter(task => task.status === 'todo');
        const highPriorityTasks = todoTasks.filter(task => task.priority === 'high');
        
        if (highPriorityTasks.length > 0) {
            const task = highPriorityTasks[0];
            console.log(`🎯 Selected highest priority task: ${task.title} (${task.id})`);
            console.log(`   Current status: ${task.status}`);
            console.log(`   Priority: ${task.priority}`);
            
            // Update task to in-progress and assign to development
            const updatedTask = {
                ...task,
                status: 'in-progress',
                assignedTo: 'development',
                assignedAt: new Date().toISOString(),
                handoffFrom: 'task-manager',
                notes: `Task handed off to development for implementation on ${new Date().toISOString()}`
            };
            
            await taskDb.put(task.id, updatedTask);
            
            console.log(`✅ Successfully handed off task to development!`);
            console.log(`   Task: ${task.title}`);
            console.log(`   ID: ${task.id}`);
            console.log(`   Priority: ${task.priority}`);
            console.log(`   New status: in-progress`);
            console.log(`   Assigned to: development`);
            console.log(`   Handed off at: ${updatedTask.assignedAt}`);
            
        } else {
            console.log("ℹ️  No high priority todo tasks found");
            
            if (todoTasks.length > 0) {
                console.log(`📋 Found ${todoTasks.length} todo tasks with other priorities:`);
                todoTasks.forEach(task => {
                    console.log(`   - ${task.title} (${task.priority})`);
                });
            } else {
                console.log("📋 No todo tasks found");
            }
        }
        
        await taskDb.close();
        
    } catch (error) {
        console.error("💥 Error:", error.message);
    }
}

directlyHandoffTask().then(() => {
    console.log("🚀 Direct handoff completed");
    process.exit(0);
}).catch((error) => {
    console.error("💥 Direct handoff failed:", error);
    process.exit(1);
});