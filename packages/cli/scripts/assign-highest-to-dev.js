#!/usr/bin/env node

import pkg from 'level';
const { Level } = pkg;

async function checkAndAssignTask() {
  try {
    console.log('🔍 Checking tasks database...');
    
    // Open task database
    const db = new Level('./db/tasks', { valueEncoding: 'json' });
    
    // Get all tasks
    const tasks = [];
    for await (const [key, value] of db.iterator()) {
      tasks.push({ id: key, ...value });
    }
    
    console.log(`📊 Found ${tasks.length} total tasks`);
    
    // Group by status
    const byStatus = {};
    tasks.forEach(task => {
      if (!byStatus[task.status]) {
        byStatus[task.status] = [];
      }
      byStatus[task.status].push(task);
    });
    
    Object.keys(byStatus).forEach(status => {
      console.log(`\n${status.toUpperCase()}: ${byStatus[status].length} tasks`);
      byStatus[status].slice(0, 3).forEach((task, i) => {
        console.log(`  ${i + 1}. ${task.title} (${task.priority})`);
      });
      if (byStatus[status].length > 3) {
        console.log(`  ... and ${byStatus[status].length - 3} more`);
      }
    });
    
    // Find highest priority task that needs development work
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    
    // First try to find todo tasks
    const todoTasks = tasks.filter(task => task.status === 'todo');
    todoTasks.sort((a, b) => {
      const aPriority = priorityOrder[a.priority] || 3;
      const bPriority = priorityOrder[b.priority] || 3;
      return aPriority - bPriority;
    });
    
    let targetTask = null;
    
    if (todoTasks.length > 0) {
      targetTask = todoTasks[0];
      console.log(`\n🎯 Found highest priority todo task: ${targetTask.title}`);
    } else {
      // Fallback: find any high priority task not assigned to development
      const highPriorityTasks = tasks.filter(task => 
        task.priority === 'high' && 
        task.status === 'in-progress' && 
        (!task.assignedTo || task.assignedTo !== 'development')
      );
      
      if (highPriorityTasks.length > 0) {
        targetTask = highPriorityTasks[0];
        console.log(`\n🔄 Found high priority in-progress task to hand to development: ${targetTask.title}`);
      }
    }
    
    if (targetTask) {
      console.log(`   Status: ${targetTask.status}`);
      console.log(`   Priority: ${targetTask.priority}`);
      console.log(`   Currently assigned to: ${targetTask.assignedTo || 'unassigned'}`);
      
      // Update task to assign to development
      const updatedTask = {
        ...targetTask,
        assignedTo: 'development',
        handoffTime: new Date().toISOString(),
        handoffNotes: targetTask.status === 'todo' ? 
          'Handed off to development team for implementation' :
          'Task handed off to development team for continued work',
        status: 'in-progress'
      };
      
      await db.put(targetTask.id, updatedTask);
      
      console.log(`\n✅ Task successfully handed to development!`);
      console.log(`🚀 Task "${updatedTask.title}"`);
      console.log(`👥 Assigned to: development`);
      console.log(`📋 Task ID: ${updatedTask.id}`);
      console.log(`📊 Status: ${updatedTask.status}`);
      console.log(`⏰ Handoff time: ${updatedTask.handoffTime}`);
      
    } else {
      console.log('\n❌ No suitable tasks found for development handoff');
    }
    
    await db.close();
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

checkAndAssignTask();