#!/usr/bin/env node

import net from 'net';

const client = net.createConnection({ port: 3001 }, () => {
  console.log('🚀 Connecting to task manager daemon...');
  
  // Request next available task by getting high priority todo tasks
  const request = {
    command: 'list_tasks',
    agent: 'opencode',
    timestamp: new Date().toISOString()
  };
  
  console.log('📤 Sending task claim request:', JSON.stringify(request, null, 2));
  client.write(JSON.stringify(request) + '\n');
});

client.on('data', (data) => {
  try {
    const response = JSON.parse(data.toString().trim());
    console.log('📥 Daemon response:', JSON.stringify(response, null, 2));
    
    if (response.success) {
      console.log('✅ Tasks retrieved successfully!');
      const tasks = response.data || [];
      const todoTasks = tasks.filter(t => t.status === 'todo');
      const highPriorityTasks = todoTasks.filter(t => t.priority === 'high');
      
      if (highPriorityTasks.length > 0) {
        const nextTask = highPriorityTasks[0];
        console.log('🎯 Next high priority task to work on:');
        console.log(`📋 Task ID: ${nextTask.id}`);
        console.log(`📝 Task Title: ${nextTask.title}`);
        console.log(`📄 Description: ${nextTask.description}`);
        console.log(`⚡ Priority: ${nextTask.priority}`);
        console.log(`📊 Status: ${nextTask.status}`);
        console.log(`🕐 Created: ${new Date(nextTask.createdAt).toLocaleString()}`);
        
        // Now try to claim this task
        console.log('\n🔄 Attempting to claim this task...');
        const claimRequest = {
          command: 'update_task_status',
          data: {
            id: nextTask.id,
            status: 'in-progress'
          }
        };
        client.write(JSON.stringify(claimRequest) + '\n');
      } else if (todoTasks.length > 0) {
        const nextTask = todoTasks[0];
        console.log('🎯 Next available task to work on:');
        console.log(`📋 Task ID: ${nextTask.id}`);
        console.log(`📝 Task Title: ${nextTask.title}`);
        console.log(`📄 Description: ${nextTask.description}`);
        console.log(`⚡ Priority: ${nextTask.priority}`);
        console.log(`📊 Status: ${nextTask.status}`);
      } else {
        console.log('📝 No available tasks found. All tasks are either done or in progress.');
      }
    } else {
      console.log('❌ Failed to retrieve tasks:', response.error || 'Unknown error');
    }
  } catch (error) {
    console.log('🔧 Raw response:', data.toString());
  }
  
  client.end();
});

client.on('error', (err) => {
  console.error('❌ Connection error:', err.message);
  process.exit(1);
});

client.on('end', () => {
  console.log('🔌 Disconnected from daemon');
});