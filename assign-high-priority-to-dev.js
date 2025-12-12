#!/usr/bin/env node

import { createConnection } from 'net';

const client = createConnection({ port: 3001 }, () => {
  console.log('Connected to daemon');
  
  // Send command to list tasks
  const command = JSON.stringify({ command: 'list_tasks' });
  client.write(command + '\n');
});

let buffer = '';
let processedInitial = false;

client.on('data', (data) => {
  buffer += data.toString();
  
  // Try to parse complete JSON objects from the buffer
  try {
    const lines = buffer.split('\n').filter(line => line.trim());
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('{') && lines[i].endsWith('}')) {
        const response = JSON.parse(lines[i]);
        
        if (response.success && response.data && !processedInitial) {
          processedInitial = true;
          const tasks = response.data;
          
          // Filter tasks that are todo and find highest priority
          const todoTasks = tasks.filter(task => task.status === 'todo');
          
          if (todoTasks.length === 0) {
            console.log('No todo tasks found');
            client.end();
            return;
          }
          
          // Sort by priority (high > medium > low) and then by creation date
          const priorityOrder = { high: 3, medium: 2, low: 1 };
          const sortedTasks = todoTasks.sort((a, b) => {
            const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
            if (priorityDiff !== 0) return priorityDiff;
            
            // If same priority, sort by creation date (older first)
            return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          });
          
          const highestPriorityTask = sortedTasks[0];
          console.log(`🎯 Highest priority todo task found: "${highestPriorityTask.title}" (${highestPriorityTask.priority})`);
          console.log(`📋 Task ID: ${highestPriorityTask.id}`);
          
          // Now assign this task to development by updating its status to in-progress
          console.log('🚀 Assigning task to development team...');
          
          const updateCommand = JSON.stringify({
            command: 'update_task_status',
            data: {
              id: highestPriorityTask.id,
              status: 'in-progress',
              assignedTo: 'development'
            }
          });
          
          // Write the update command
          client.write(updateCommand + '\n');
          console.log(`✅ Task "${highestPriorityTask.title}" has been assigned to development team!`);
          client.end();
          return;
        }
      }
    }
  } catch (error) {
    // Ignore partial JSON errors and continue accumulating
  }
});

client.on('end', () => {
  console.log('Disconnected from daemon');
});

client.on('error', (err) => {
  console.error('Connection error:', err.message);
  process.exit(1);
});

// Timeout after 10 seconds
setTimeout(() => {
  console.error('Timeout - no response received');
  client.end();
  process.exit(1);
}, 10000);