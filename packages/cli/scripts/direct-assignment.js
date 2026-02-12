#!/usr/bin/env node

import { createDaemonConnection } from "@isomorphiq/cli";

const taskId = process.argv[2] || 'task-1765516137864-6sgm4m3mv';

const client = createDaemonConnection({ port: 3001 }, () => {
  console.log('Connected to daemon');
  
  // Send direct task update to assign to development
  const request = JSON.stringify({
    action: "update_task",
    taskId: taskId,
    updates: {
      assignedTo: "development",
      status: "todo"
    }
  });
  
  client.write(request);
});

client.on('data', (data) => {
  console.log('Response:', data.toString());
  client.end();
});

client.on('end', () => {
  console.log('Disconnected from daemon');
});

client.on('error', (err) => {
  console.error('Error:', err.message);
});