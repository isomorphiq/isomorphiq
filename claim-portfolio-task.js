#!/usr/bin/env node

import net from 'net';

const client = net.createConnection({ port: 3001 }, () => {
  console.log('🚀 Connecting to task manager daemon...');
  
  // Look for a medium priority todo task to claim
  const claimRequest = {
    command: 'update_task_status',
    data: {
      id: 'task-1765349409630', // "Enable Task Portfolio and Program Management" - medium priority todo
      status: 'in-progress'
    },
    timestamp: new Date().toISOString()
  };
  
  console.log('🔄 Claiming task: Enable Task Portfolio and Program Management');
  client.write(JSON.stringify(claimRequest) + '\n');
});

client.on('data', (data) => {
  try {
    const response = JSON.parse(data.toString().trim());
    
    if (response.success) {
      console.log('✅ Task claimed successfully!');
      const task = response.data;
      console.log(`📋 Task ID: ${task.id}`);
      console.log(`📝 Task Title: ${task.title}`);
      console.log(`📄 Description: ${task.description}`);
      console.log(`⚡ Priority: ${task.priority}`);
      console.log(`📊 Status: ${task.status}`);
      console.log(`🕐 Created: ${new Date(task.createdAt).toLocaleString()}`);
      console.log('\n🚀 Task completed announcement: Previous task has been finished and this new task has been claimed!');
      console.log('📝 Ready to begin work on: Enable Task Portfolio and Program Management');
    } else {
      console.log('❌ Failed to claim task:', response.error?.message || response.error);
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