#!/usr/bin/env node

import { createConnection } from 'net';

const client = createConnection({ port: 3001 }, () => {
  console.log('Connected to daemon');
  
  // Get specific task that needs assignment
  const getCommand = JSON.stringify({ 
    command: 'get_task', 
    taskId: 'task-1765349228780' 
  });
  client.write(getCommand + '\n');
});

client.on('data', (data) => {
  const response = data.toString();
  
  try {
    const parsed = JSON.parse(response);
    if (parsed.success && parsed.data) {
      const task = parsed.data;
      console.log(`\n🎯 Task found:`);
      console.log(`ID: ${task.id}`);
      console.log(`Title: ${task.title}`);
      console.log(`Priority: ${task.priority}`);
      console.log(`Status: ${task.status}`);
      
      if (task.status === 'todo') {
        console.log(`\n🔧 Assigning task to development...`);
        const claimCommand = JSON.stringify({ 
          command: 'claim_task', 
          taskId: task.id,
          assignee: 'development'
        });
        client.write(claimCommand + '\n');
      } else {
        console.log(`\n❌ Task is not available (status: ${task.status})`);
        client.end();
      }
    } else {
      console.log(`\n❌ Task not found: ${parsed.error || 'Unknown error'}`);
      client.end();
    }
  } catch (error) {
    console.error('Error parsing response:', error.message);
    client.end();
  }
});

let claimed = false;

client.on('data', (data) => {
  if (!claimed) {
    claimed = true;
    return; // Skip first data event, handled above
  }
  
  // Second response - claim result
  try {
    const parsed = JSON.parse(data.toString());
    if (parsed.success) {
      console.log(`\n✅ Task successfully assigned to development!`);
      console.log(`Task ID: ${parsed.data.taskId}`);
      console.log(`Assignee: ${parsed.data.assignee}`);
      console.log(`Status: ${parsed.data.status}`);
    } else {
      console.log(`\n❌ Failed to assign task: ${parsed.error || 'Unknown error'}`);
    }
  } catch (error) {
    console.error('Error parsing claim response:', error.message);
  }
  client.end();
});

client.on('end', () => {
  console.log('\nDisconnected from daemon');
});

client.on('error', (err) => {
  console.error('Connection error:', err.message);
});