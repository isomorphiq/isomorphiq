#!/usr/bin/env node

import { createConnection } from 'net';

const client = createConnection({ port: 3001 }, () => {
  console.log('Connected to daemon');
  
  // Send command to list tasks
  const command = JSON.stringify({ command: 'list_tasks' });
  client.write(command + '\n');
});

client.on('data', async (data) => {
  try {
    const response = JSON.parse(data.toString());
    if (response.success) {
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
      console.log(`Highest priority todo task: ${highestPriorityTask.title} (${highestPriorityTask.priority})`);
      
      // Now assign this task to development by updating its status to in-progress
      console.log('Assigning task to development...');
      
      const updateCommand = JSON.stringify({
        command: 'update_task_status',
        data: {
          id: highestPriorityTask.id,
          status: 'in-progress'
        }
      });
      
      // Write the update command
      client.write(updateCommand + '\n');
      
    } else {
      console.error('Failed to get tasks:', response.error);
      client.end();
    }
  } catch (error) {
    console.error('Error parsing response:', error);
    client.end();
  }
});

client.on('data', (data) => {
  // This might be the response to our update command
  try {
    const response = JSON.parse(data.toString());
    if (response.success) {
      console.log('✅ Task successfully assigned to development!');
      console.log('Task updated:', JSON.stringify(response.data, null, 2));
    } else {
      console.error('❌ Failed to assign task:', response.error);
    }
  } catch (error) {
    // This might be partial data or another response
    console.log('Additional response data:', data.toString());
  }
  client.end();
});

client.on('end', () => {
  console.log('Disconnected from daemon');
});

client.on('error', (err) => {
  console.error('Error:', err.message);
});