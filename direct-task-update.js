#!/usr/bin/env node
import { ProductManager } from './src/product-manager.ts';
import path from 'node:path';

async function directTaskUpdate() {
    console.log('[DIRECT] Updating High Priority Task status directly...');
    
    const testDbPath = path.join(process.cwd(), 'test-priority-db');
    const pm = new ProductManager(testDbPath);
    
    try {
        await pm.initialize();
        
        // Get the specific task we need to update
        const allTasks = await pm.getAllTasks();
        const targetTask = allTasks.find(task => 
            task.id === 'task-1765515832725-97bmmoxk2'
        );
        
        if (!targetTask) {
            console.log('[DIRECT] ❌ Task not found');
            return;
        }
        
        console.log(`[DIRECT] Found task: ${targetTask.title} (current status: ${targetTask.status})`);
        
        // Update to in_progress first
        console.log('[DIRECT] Updating status to in_progress...');
        await pm.updateTask(targetTask.id, { status: 'in-progress' });
        
        // Wait a moment
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Update to completed
        console.log('[DIRECT] Updating status to completed...');
        await pm.updateTask(targetTask.id, { status: 'done' }); // Note: using 'done' instead of 'completed'
        
        // Verify the update
        const updatedTasks = await pm.getAllTasks();
        const updatedTask = updatedTasks.find(task => 
            task.id === 'task-1765515832725-97bmmoxk2'
        );
        
        if (updatedTask) {
            console.log(`[DIRECT] ✅ Task updated successfully:`);
            console.log(`   Title: ${updatedTask.title}`);
            console.log(`   Status: ${updatedTask.status}`);
            console.log(`   Priority: ${updatedTask.priority}`);
        }
        
        // Show all High Priority Tasks now
        const highPriorityTasks = updatedTasks.filter(task => 
            task.title === 'High Priority Task' && task.priority === 'high'
        );
        
        console.log(`\n[DIRECT] 📋 All High Priority Tasks (${highPriorityTasks.length}):`);
        highPriorityTasks.forEach((task, index) => {
            const statusIcon = task.status === 'done' ? '✅' : 
                              task.status === 'in-progress' ? '🔄' : 
                              task.status === 'pending' ? '⏳' : '⭕';
            console.log(`   ${index + 1}. ${statusIcon} ${task.id} (${task.status})`);
        });
        
    } catch (error) {
        console.error('[DIRECT] ❌ Error:', error);
    } finally {
        await pm.cleanup();
    }
}

directTaskUpdate().catch(console.error);