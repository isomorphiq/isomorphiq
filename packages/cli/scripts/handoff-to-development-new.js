#!/usr/bin/env node
import { ProductManager } from "@isomorphiq/user-profile";
import path from 'node:path';

async function handoffTaskToDevelopment() {
    console.log('[HANDOFF] Finding highest priority task and assigning to development...');
    
    const testDbPath = path.join(process.cwd(), 'test-priority-db');
    const pm = new ProductManager(testDbPath);
    
    try {
        await pm.initialize();
        
        // Get all tasks and find highest priority that needs implementation
        const allTasks = await pm.getAllTasks();
        const todoTasks = allTasks.filter(task => task.status === 'todo');
        
        if (todoTasks.length === 0) {
            console.log('[HANDOFF] No todo tasks found');
            return;
        }
        
        // Sort by priority (high > medium > low)
        const priorityOrder = { high: 3, medium: 2, low: 1 };
        const sortedTasks = todoTasks.sort((a, b) => {
            const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
            if (priorityDiff !== 0) return priorityDiff;
            // If same priority, sort by creation time (newer first)
            return new Date(b.createdAt) - new Date(a.createdAt);
        });
        
        const targetTask = sortedTasks[0];
        
        console.log(`[HANDOFF] Selected task: ${targetTask.title} (${targetTask.priority} priority)`);
        
        // Update to in-progress and assign to development
        await pm.updateTask(targetTask.id, { 
            status: 'in-progress',
            assignedTo: 'development'
        });
        
        console.log(`[HANDOFF] ✅ Task ${targetTask.id} assigned to development and set to in-progress`);
        
    } catch (error) {
        console.error('[HANDOFF] ❌ Error:', error);
    } finally {
        await pm.cleanup();
    }
}

handoffTaskToDevelopment().catch(console.error);