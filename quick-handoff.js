#!/usr/bin/env node

import net from 'net';

const taskId = process.argv[2] || 'task-1765516137864-6sgm4m3mv';

const client = net.createConnection({ port: 3001 }, () => {
  console.log('Connected to daemon');
  
  // Send handoff request
  const request = JSON.stringify({
    action: "handoff_to_development",
    taskId: taskId
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