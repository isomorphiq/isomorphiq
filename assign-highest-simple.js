#!/usr/bin/env node

import { createConnection } from 'net';

function sendCommand(socket, command, data = {}) {
  const message = JSON.stringify({ command, data });
  socket.write(message + '\n');
}

const client = createConnection({ port: 3001 }, () => {
  console.log('Connected to daemon');
  
  // Get the task list first
  sendCommand(client, 'list_tasks');
});

let buffer = '';

client.on('data', (data) => {
  buffer += data.toString();
  
  // Check if we have a complete JSON message (ending with \n)
  const newlineIndex = buffer.indexOf('\n');
  if (newlineIndex !== -1) {
    const message = buffer.substring(0, newlineIndex);
    buffer = buffer.substring(newlineIndex + 1);
    
    try {
      const parsed = JSON.parse(message);
      
      if (parsed.data && Array.isArray(parsed.data)) {
        // This is the task list
        console.log('Found tasks, looking for highest priority todo task...');
        
        const availableTasks = parsed.data.filter(task => task.status === 'todo');
        
        if (availableTasks.length === 0) {
          console.log('No available tasks found');
          client.end();
          return;
        }
        
        // Sort by priority (high -> medium -> low)
        const priorityOrder = { 'high': 3, 'medium': 2, 'low': 1 };
        const sortedTasks = availableTasks.sort((a, b) => {
          const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
          if (priorityDiff !== 0) return priorityDiff;
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        });
        
        const highestPriorityTask = sortedTasks[0];
        console.log(`\n🎯 Highest priority task found:`);
        console.log(`ID: ${highestPriorityTask.id}`);
        console.log(`Title: ${highestPriorityTask.title}`);
        console.log(`Priority: ${highestPriorityTask.priority}`);
        console.log(`Status: ${highestPriorityTask.status}`);
        console.log(`Created: ${highestPriorityTask.createdAt}`);
        
        // Update task status to in-progress and assign to development
        console.log(`\n🔧 Assigning task to development...`);
        
        // First, update the status to in-progress
        sendCommand(client, 'update_task_status', {
          id: highestPriorityTask.id,
          status: 'in-progress'
        });
        
      } else if (parsed.success) {
        console.log(`✅ Task status updated successfully!`);
        console.log(`Task is now marked as in-progress`);
        client.end();
      } else {
        console.log(`❌ Error: ${parsed.error || 'Unknown error'}`);
        client.end();
      }
      
    } catch (error) {
      console.error('Error parsing response:', error.message);
      client.end();
    }
  }
});

client.on('end', () => {
  console.log('\nDisconnected from daemon');
});

client.on('error', (err) => {
  console.error('Connection error:', err.message);
});