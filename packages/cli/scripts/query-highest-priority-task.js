#!/usr/bin/env node
import { ProductManager } from "@isomorphiq/user-profile";
import path from 'node:path';

async function queryHighestPriorityTask() {
    console.log('[QUERY] Finding highest priority task that needs implementation...');
    
    const testDbPath = path.join(process.cwd(), 'test-priority-db');
    const pm = new ProductManager(testDbPath);
    
    try {
        await pm.initialize();
        
        // Get all tasks
        const allTasks = await pm.getAllTasks();
        console.log(`[QUERY] Found ${allTasks.length} total tasks`);
        
        // First, let's see what statuses exist
        const statusCounts = {};
        allTasks.forEach(task => {
            statusCounts[task.status] = (statusCounts[task.status] || 0) + 1;
        });
        console.log('[QUERY] Task status breakdown:', statusCounts);
        
// First, let's see what statuses exist
        const taskStatusCounts = {};
        allTasks.forEach(task => {
            taskStatusCounts[task.status] = (taskStatusCounts[task.status] || 0) + 1;
        });
        console.log('[QUERY] Task status breakdown:', taskStatusCounts);
        
        // Filter for tasks that need implementation (pending or in_progress)
        const tasksNeedingImplementation = allTasks.filter(task => 
            task.status === 'pending' || task.status === 'in_progress'
        );
        
        console.log(`[QUERY] Found ${tasksNeedingImplementation.length} tasks needing implementation`);
        
        // If no pending/in_progress tasks, look for all tasks and show the highest priority one
        const tasksToConsider = tasksNeedingImplementation.length > 0 
            ? tasksNeedingImplementation 
            : allTasks;
            
        if (tasksNeedingImplementation.length === 0) {
            console.log('[QUERY] No pending/in_progress tasks found, showing highest priority task from all tasks');
        }
        
        // Sort by priority (high > medium > low) and then by creation date (most recent first)
        const priorityOrder = { 'high': 3, 'medium': 2, 'low': 1 };
        
        tasksToConsider.sort((a, b) => {
            const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
            if (priorityDiff !== 0) return priorityDiff;
            
            // If same priority, sort by creation date (most recent first)
            const dateA = new Date(a.createdAt || 0);
            const dateB = new Date(b.createdAt || 0);
            return dateB.getTime() - dateA.getTime();
        });
        
        // Get the highest priority task
        const highestPriorityTask = tasksToConsider[0];
        
        console.log('\n[QUERY] 🎯 HIGHEST PRIORITY TASK FOUND:');
        console.log(`   ID: ${highestPriorityTask.id}`);
        console.log(`   Title: ${highestPriorityTask.title}`);
        console.log(`   Description: ${highestPriorityTask.description}`);
        console.log(`   Priority: ${highestPriorityTask.priority}`);
        console.log(`   Status: ${highestPriorityTask.status}`);
        console.log(`   Created: ${highestPriorityTask.createdAt}`);
        if (highestPriorityTask.dependencies && highestPriorityTask.dependencies.length > 0) {
            console.log(`   Dependencies: ${highestPriorityTask.dependencies.join(', ')}`);
        }
        
        // Show all tasks needing implementation for reference
        console.log('\n[QUERY] 📋 ALL TASKS NEEDING IMPLEMENTATION:');
        tasksNeedingImplementation.forEach((task, index) => {
            const priorityIcon = task.priority === 'high' ? '🔴' : task.priority === 'medium' ? '🟡' : '🟢';
            const statusIcon = task.status === 'pending' || task.status === 'in_progress' ? '⏳' : '✅';
            console.log(`   ${index + 1}. ${priorityIcon} ${statusIcon} ${task.title} (${task.priority}, ${task.status})`);
        });
        
        // Show all tasks sorted by priority for complete picture
        console.log('\n[QUERY] 📊 ALL TASKS SORTED BY PRIORITY:');
        tasksToConsider.forEach((task, index) => {
            const priorityIcon = task.priority === 'high' ? '🔴' : task.priority === 'medium' ? '🟡' : '🟢';
            console.log(`   ${index + 1}. ${priorityIcon} ${task.title} (${task.priority}, ${task.status})`);
        });
        
    } catch (error) {
        console.error('[QUERY] ❌ Error querying tasks:', error);
    } finally {
        await pm.cleanup();
    }
}

// Run the query
queryHighestPriorityTask().catch(console.error);