#!/usr/bin/env node

// Manually identify the highest priority todo task from the previous output
// From the task list we saw, we need to find tasks with status "todo" and highest priority

console.log('Analyzing tasks from previous output...');

// From the data we saw, the todo tasks with medium priority include:
// - "Add Mobile-Responsive Task Management Interface" (task-1765349101299) 
// - "Implement Task Analytics and Insights Dashboard" (task-1765349111526)
// - "Add Task Bulk Operations and Batch Processing" (task-1765349164990)
// - "Implement Task Custom Fields and Metadata" (task-1765349187368)
// - "Implement Task AI-Powered Smart Suggestions" (task-1765349259574)
// And many more...

// All todo tasks appear to be medium or low priority, with no high priority todo tasks
// The oldest medium priority todo task appears to be "Add Mobile-Responsive Task Management Interface"
// Created at: "2025-12-10T06:45:01.299Z"

const selectedTask = {
  id: "task-1765349101299",
  title: "Add Mobile-Responsive Task Management Interface",
  description: "Create a fully responsive web interface optimized for mobile devices with touch-friendly controls, offline capabilities, and native app-like experience for managing tasks on smartphones and tablets.",
  priority: "medium",
  status: "todo"
};

console.log(`Selected task: ${selectedTask.title}`);
console.log(`Priority: ${selectedTask.priority}`);
console.log(`Task ID: ${selectedTask.id}`);

// Now let's assign this task to development
import { createConnection } from 'net';

const client = createConnection({ port: 3001 }, () => {
  console.log('Connected to daemon');
  
  // Update the task status to in-progress
  const updateCommand = JSON.stringify({
    command: 'update_task_status',
    data: {
      id: selectedTask.id,
      status: 'in-progress'
    }
  });
  
  console.log('Assigning task to development...');
  client.write(updateCommand + '\n');
});

client.on('data', (data) => {
  try {
    const response = JSON.parse(data.toString().trim());
    if (response.success) {
      console.log('✅ Task successfully assigned to development!');
      console.log('Task updated:', JSON.stringify(response.data, null, 2));
    } else {
      console.error('❌ Failed to assign task:', response.error);
    }
  } catch (error) {
    console.log('Response:', data.toString());
  }
  client.end();
});

client.on('end', () => {
  console.log('Disconnected from daemon');
});

client.on('error', (err) => {
  console.error('Connection error:', err.message);
});