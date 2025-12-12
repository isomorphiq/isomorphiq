#!/usr/bin/env node

import pkg from 'level';
const { Level } = pkg;

async function checkTasks() {
  try {
    console.log('🔍 Checking available tasks...');
    
    // Open task database
    const db = new Level('./test-priority-db', { valueEncoding: 'json' });
    
    // Get all tasks
    const tasks = [];
    for await (const [key, value] of db.iterator()) {
      if (key.startsWith('task-')) {
        tasks.push({ id: key, ...value });
      }
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
      byStatus[status].forEach((task, i) => {
        console.log(`  ${i + 1}. ${task.title} (${task.priority})`);
      });
    });
    
    // Find any task we can assign (even if not todo)
    const anyAssignableTask = tasks.find(task => !task.assignedTo || task.assignedTo !== 'development');
    
    if (anyAssignableTask) {
      console.log(`\n🎯 Found assignable task: ${anyAssignableTask.title}`);
      console.log(`   Status: ${anyAssignableTask.status}`);
      console.log(`   Priority: ${anyAssignableTask.priority}`);
      
      // If it's not todo, we can still hand it to development by updating assignee
      const updatedTask = {
        ...anyAssignableTask,
        assignedTo: 'development',
        handoffTime: new Date().toISOString(),
        handoffNotes: anyAssignableTask.status === 'todo' ? 
          'Handed off to development team for implementation' :
          'Task handed off to development team for continued work'
      };
      
      await db.put(anyAssignableTask.id, updatedTask);
      
      console.log(`\n✅ Task successfully handed to development!`);
      console.log(`🚀 Task "${updatedTask.title}"`);
      console.log(`👥 Assigned to: development`);
      console.log(`📋 Task ID: ${updatedTask.id}`);
      console.log(`📊 Status: ${updatedTask.status}`);
      
    } else {
      console.log('\n❌ No assignable tasks found');
    }
    
    await db.close();
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

checkTasks();