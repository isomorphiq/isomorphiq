#!/usr/bin/env node

// Direct task assignment script

// Direct database access
import pkg from 'level';
const { Level } = pkg;

async function assignHighestPriorityTask() {
  try {
    console.log('🎯 Finding highest priority task to assign to development...');
    
    // Open task database
    const db = new Level('./test-priority-db', { valueEncoding: 'json' });
    
    // Get all tasks
    const tasks = [];
    for await (const [key, value] of db.iterator()) {
      if (key.startsWith('task-')) {
        tasks.push({ id: key, ...value });
      }
    }
    
    // Filter for todo tasks and sort by priority (high first)
    const todoTasks = tasks.filter(task => task.status === 'todo');
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    todoTasks.sort((a, b) => {
      const aPriority = priorityOrder[a.priority] || 3;
      const bPriority = priorityOrder[b.priority] || 3;
      return aPriority - bPriority;
    });
    
    if (todoTasks.length > 0) {
      const task = todoTasks[0];
      console.log(`📋 Found task: ${task.title} (${task.id})`);
      console.log(`🔥 Priority: ${task.priority}`);
      console.log(`📝 Description: ${task.description?.substring(0, 100)}...`);
      
      // Update task status and assign to development
      const updatedTask = {
        ...task,
        status: 'in-progress',
        assignedTo: 'development',
        handoffTime: new Date().toISOString(),
        handoffNotes: 'Handed off to development team for implementation'
      };
      
      await db.put(task.id, updatedTask);
      
      console.log('\n✅ Task successfully assigned to development!');
      console.log(`🚀 Task "${task.title}" is now in-progress`);
      console.log(`👥 Assigned to: development`);
      console.log(`⏰ Handoff time: ${new Date().toISOString()}`);
      console.log(`📋 Task ID: ${task.id}`);
      
    } else {
      console.log('❌ No todo tasks found to assign');
    }
    
    await db.close();
    
  } catch (error) {
    console.error('❌ Error assigning task:', error.message);
  }
}

assignHighestPriorityTask();