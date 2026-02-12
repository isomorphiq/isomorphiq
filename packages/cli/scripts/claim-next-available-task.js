#!/usr/bin/env node

import { createDaemonConnection } from "@isomorphiq/cli";

const client = createDaemonConnection({ port: 3001 }, () => {
  console.log('🚀 Connecting to task manager daemon...');
  
  // First, get all tasks to find available todo tasks
  const listRequest = {
    command: 'list_tasks',
    timestamp: new Date().toISOString()
  };
  
  console.log('📤 Requesting task list...');
  client.write(JSON.stringify(listRequest) + '\n');
});

let isFirstResponse = true;
client.on('data', (data) => {
  try {
    const response = JSON.parse(data.toString().trim());
    
    if (isFirstResponse) {
      isFirstResponse = false;
      
      if (response.success) {
        const tasks = response.data || [];
        const todoTasks = tasks.filter(t => t.status === 'todo');
        const highPriorityTasks = todoTasks.filter(t => t.priority === 'high');
        
        if (highPriorityTasks.length > 0) {
          const taskToClaim = highPriorityTasks[0];
          console.log(`🎯 Found high priority task to claim: ${taskToClaim.title}`);
          console.log(`📋 Task ID: ${taskToClaim.id}`);
          console.log(`📄 Description: ${taskToClaim.description.substring(0, 100)}...`);
          
          // Now claim this task by updating its status
          const claimRequest = {
            command: 'update_task_status',
            data: {
              id: taskToClaim.id,
              status: 'in-progress'
            },
            timestamp: new Date().toISOString()
          };
          
          console.log('🔄 Claiming task...');
          client.write(JSON.stringify(claimRequest) + '\n');
        } else if (todoTasks.length > 0) {
          const taskToClaim = todoTasks[0];
          console.log(`🎯 Found available task to claim: ${taskToClaim.title}`);
          console.log(`📋 Task ID: ${taskToClaim.id}`);
          console.log(`📄 Description: ${taskToClaim.description.substring(0, 100)}...`);
          
          const claimRequest = {
            command: 'update_task_status',
            data: {
              id: taskToClaim.id,
              status: 'in-progress'
            },
            timestamp: new Date().toISOString()
          };
          
          console.log('🔄 Claiming task...');
          client.write(JSON.stringify(claimRequest) + '\n');
        } else {
          console.log('📝 No available tasks found. All tasks are either done or in progress.');
          client.end();
        }
      } else {
        console.log('❌ Failed to get task list:', response.error);
        client.end();
      }
    } else {
      // This is the response to the claim request
      if (response.success) {
        console.log('✅ Task claimed successfully!');
        const task = response.data;
        console.log(`📋 Task ID: ${task.id}`);
        console.log(`📝 Task Title: ${task.title}`);
        console.log(`📄 Description: ${task.description}`);
        console.log(`⚡ Priority: ${task.priority}`);
        console.log(`📊 Status: ${task.status}`);
        console.log(`🕐 Created: ${new Date(task.createdAt).toLocaleString()}`);
        console.log('\n🚀 You can now begin working on this task!');
      } else {
        console.log('❌ Failed to claim task:', response.error?.message || response.error);
      }
      client.end();
    }
  } catch (error) {
    console.log('🔧 Raw response:', data.toString());
    client.end();
  }
});

client.on('error', (err) => {
  console.error('❌ Connection error:', err.message);
  process.exit(1);
});

client.on('end', () => {
  console.log('🔌 Disconnected from daemon');
});