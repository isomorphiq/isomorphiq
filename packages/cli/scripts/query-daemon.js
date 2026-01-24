#!/usr/bin/env node

import { createDaemonConnection } from "@isomorphiq/cli";

const client = createDaemonConnection({ port: 3001 }, () => {
  console.log('Connected to daemon');
  
  // Send command to list tasks
  const command = JSON.stringify({ command: 'list_tasks' });
  client.write(command + '\n');
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