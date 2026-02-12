#!/usr/bin/env node

import { createDaemonConnection } from "@isomorphiq/cli";

const client = createDaemonConnection({ port: 3001 }, () => {
  console.log('Connected to daemon');
  
  // Get available tasks first
  const listCommand = JSON.stringify({ command: 'list_tasks' });
  client.write(listCommand + '\n');
});

let tasksData = null;

client.on('data', (data) => {
  const response = data.toString();
  
  if (!tasksData) {
    // First response - parse tasks
    try {
      const parsed = JSON.parse(response);
      if (parsed.success && parsed.data) {
        tasksData = parsed.data;
        const availableTasks = tasksData.filter(task => task.status === 'todo');
        
        if (availableTasks.length === 0) {
          console.log('No available tasks found');
          client.end();
          return;
        }
        
        // Sort by priority (high -> medium -> low) and then by creation date
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
        
        // Now claim this task for development
        console.log(`\n🔧 Assigning task to development...`);
        const claimCommand = JSON.stringify({ 
          command: 'claim_task', 
          taskId: highestPriorityTask.id,
          assignee: 'development'
        });
        client.write(claimCommand + '\n');
      }
    } catch (error) {
      console.error('Error parsing tasks:', error.message);
      console.log('Response length:', response.length);
      console.log('Response preview:', response.substring(0, 200) + '...');
      client.end();
    }
  } else {
    // Second response - claim result
    try {
      const parsed = JSON.parse(response);
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
  }
});

client.on('end', () => {
  console.log('\nDisconnected from daemon');
});

client.on('error', (err) => {
  console.error('Connection error:', err.message);
});