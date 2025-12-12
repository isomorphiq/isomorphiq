#!/usr/bin/env node

import { createConnection } from 'net';

function sendCommand(socket, command) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Command timeout'));
      socket.end();
    }, 5000);

    socket.once('data', (data) => {
      clearTimeout(timeout);
      try {
        const response = JSON.parse(data.toString());
        resolve(response);
      } catch (error) {
        reject(error);
      }
      socket.end();
    });

    socket.write(JSON.stringify(command) + '\n');
  });
}

async function claimHighestPriorityTask() {
  console.log('🔍 Finding highest priority todo task...');
  
  const client = createConnection({ port: 3001 });
  
  try {
    // Get all tasks
    const response = await sendCommand(client, { command: 'list_tasks' });
    
    if (!response.success) {
      throw new Error(response.error?.message || 'Failed to get tasks');
    }
    
    const tasks = response.data;
    const todoTasks = tasks.filter(task => task.status === 'todo');
    
    if (todoTasks.length === 0) {
      console.log('❌ No todo tasks found');
      return;
    }
    
    // Sort by priority (high -> medium -> low) and then by creation date
    const priorityOrder = { 'high': 3, 'medium': 2, 'low': 1 };
    const sortedTasks = todoTasks.sort((a, b) => {
      const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
    
    const highestPriorityTask = sortedTasks[0];
    
    console.log(`\n🎯 Highest priority todo task:`);
    console.log(`ID: ${highestPriorityTask.id}`);
    console.log(`Title: ${highestPriorityTask.title}`);
    console.log(`Priority: ${highestPriorityTask.priority}`);
    
    // Now create a new connection to update the task
    const updateClient = createConnection({ port: 3001 });
    
    const updateResponse = await sendCommand(updateClient, {
      command: 'update_task_status',
      data: {
        id: highestPriorityTask.id,
        status: 'in-progress'
      }
    });
    
    if (updateResponse.success) {
      console.log(`\n✅ Task successfully assigned to development!`);
      console.log(`Status: in-progress`);
      console.log(`Ready for implementation`);
    } else {
      console.log(`\n❌ Failed to assign task:`, updateResponse.error?.message || 'Unknown error');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

claimHighestPriorityTask();