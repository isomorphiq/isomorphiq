#!/usr/bin/env node

import { createDaemonConnection } from "@isomorphiq/cli";

const taskId = process.argv[2];
if (!taskId) {
  console.error('Usage: node handoff-task.js <task-id>');
  process.exit(1);
}

const client = createDaemonConnection({ port: 3001 }, () => {
  console.log(`🚀 Handing off task ${taskId} to development team...`);
  
  const handoffRequest = {
    action: 'update_task',
    taskId: taskId,
    updates: {
      status: 'in_progress',
      assignedTo: 'development-team',
      notes: 'Task handed off to development team for implementation. Priority: HIGH.',
      handoffTime: new Date().toISOString()
    }
  };
  
  client.write(JSON.stringify(handoffRequest));
});

let responseData = '';
client.on('data', (data) => {
  responseData += data.toString();
});

client.on('end', () => {
  try {
    const response = JSON.parse(responseData);
    if (response.success) {
      console.log('✅ Task successfully handed off to development team!');
      console.log(`📋 Task ID: ${taskId}`);
      console.log(`👥 Assigned to: development-team`);
      console.log(`⏰ Handoff time: ${new Date().toISOString()}`);
      console.log(`🔥 Priority: HIGH - Start implementation immediately!`);
    } else {
      console.log('❌ Failed to handoff task:', response.error);
    }
  } catch (error) {
    console.log('Error parsing response:', error.message);
    console.log('Raw response:', responseData);
  }
  process.exit(0);
});

client.on('error', (error) => {
  console.log('❌ Connection error:', error.message);
  process.exit(1);
});