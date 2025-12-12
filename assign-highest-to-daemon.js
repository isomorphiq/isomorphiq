#!/usr/bin/env node

import { createConnection } from 'net';

const client = createConnection({ port: 3001 }, () => {
  console.log('🔌 Connected to task manager daemon');
  
  // Query for available tasks sorted by priority
  const queryCommand = JSON.stringify({ 
    action: 'queryTasks',
    filters: { status: 'todo' },
    sortBy: 'priority',
    sortOrder: 'desc'
  });
  client.write(queryCommand);
});

let taskData = null;

client.on('data', (data) => {
  const response = data.toString().trim();
  
  if (!taskData) {
    // First response - parse tasks
    try {
      const parsed = JSON.parse(response);
      if (parsed.success && parsed.data && parsed.data.tasks) {
        const tasks = parsed.data.tasks;
        
        if (tasks.length === 0) {
          console.log('❌ No available todo tasks found');
          client.end();
          return;
        }
        
        // Get highest priority task (already sorted by priority desc)
        const highestPriorityTask = tasks[0];
        taskData = highestPriorityTask;
        
        console.log(`\n🎯 Highest priority task found:`);
        console.log(`🆔 ID: ${highestPriorityTask.id}`);
        console.log(`📝 Title: ${highestPriorityTask.title}`);
        console.log(`🔥 Priority: ${highestPriorityTask.priority}`);
        console.log(`📋 Status: ${highestPriorityTask.status}`);
        console.log(`📅 Created: ${highestPriorityTask.createdAt}`);
        
        // Now assign this task to development
        console.log(`\n🔧 Assigning task to development team...`);
        const assignCommand = JSON.stringify({ 
          action: 'updateTask',
          taskId: highestPriorityTask.id,
          updates: {
            assignedTo: 'development',
            status: 'in-progress'
          }
        });
        client.write(assignCommand);
      } else {
        console.log('❌ Failed to query tasks:', parsed.error || 'Unknown error');
        client.end();
      }
    } catch (error) {
      console.error('💥 Error parsing tasks response:', error.message);
      client.end();
    }
  } else {
    // Second response - assignment result
    try {
      const parsed = JSON.parse(response);
      if (parsed.success) {
        console.log(`\n✅ Task successfully assigned to development team!`);
        console.log(`🆔 Task ID: ${taskData.id}`);
        console.log(`📝 Title: ${taskData.title}`);
        console.log(`👤 Assigned to: development`);
        console.log(`🔄 Status: in-progress`);
        console.log(`\n🚀 Development team can now start working on this task!`);
      } else {
        console.log(`\n❌ Failed to assign task: ${parsed.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('💥 Error parsing assignment response:', error.message);
    }
    client.end();
  }
});

client.on('end', () => {
  console.log('\n🔌 Disconnected from task manager daemon');
});

client.on('error', (err) => {
  console.error('💥 Connection error:', err.message);
});