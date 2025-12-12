#!/usr/bin/env node
import { ProductManager } from './src/product-manager.ts';
import path from 'node:path';

async function checkTaskStatus() {
    console.log('[CHECK] Checking status of implemented High Priority Task...');
    
    const testDbPath = path.join(process.cwd(), 'test-priority-db');
    const pm = new ProductManager(testDbPath);
    
    try {
        await pm.initialize();
        
        // Get all tasks
        const allTasks = await pm.getAllTasks();
        
        // Find the specific task we implemented
        const implementedTask = allTasks.find(task => 
            task.id === 'task-1765515832725-97bmmoxk2'
        );
        
        if (implementedTask) {
            console.log(`[CHECK] ✅ Found implemented task:`);
            console.log(`   ID: ${implementedTask.id}`);
            console.log(`   Title: ${implementedTask.title}`);
            console.log(`   Description: ${implementedTask.description}`);
            console.log(`   Priority: ${implementedTask.priority}`);
            console.log(`   Status: ${implementedTask.status}`);
        } else {
            console.log(`[CHECK] ❌ Task task-1765515832725-97bmmoxk2 not found`);
        }
        
        // Show all High Priority Tasks with their statuses
        const highPriorityTasks = allTasks.filter(task => 
            task.title === 'High Priority Task' && task.priority === 'high'
        );
        
        console.log(`\n[CHECK] 📋 All High Priority Tasks (${highPriorityTasks.length}):`);
        highPriorityTasks.forEach((task, index) => {
            const statusIcon = task.status === 'completed' ? '✅' : 
                              task.status === 'in_progress' ? '🔄' : 
                              task.status === 'pending' ? '⏳' : '⭕';
            console.log(`   ${index + 1}. ${statusIcon} ${task.id} (${task.status})`);
        });
        
    } catch (error) {
        console.error('[CHECK] ❌ Error:', error);
    } finally {
        await pm.cleanup();
    }
}

checkTaskStatus().catch(console.error);