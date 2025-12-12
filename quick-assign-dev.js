#!/usr/bin/env node

import net from 'net';

const assignTask = async () => {
  return new Promise((resolve, reject) => {
    const client = net.createConnection({ port: 3001 }, () => {
      console.log('🔌 Connected to daemon');
      
      // Command to find and assign highest priority task to development
      const command = {
        type: 'assign_highest_priority',
        assignedTo: 'development'
      };
      
      client.write(JSON.stringify(command));
    });

    client.on('data', (data) => {
      try {
        const response = JSON.parse(data.toString().trim());
        console.log('📋 Response:', response);
        
        if (response.success) {
          console.log(`✅ Task "${response.task.title}" assigned to development`);
          console.log(`🆔 Task ID: ${response.task.id}`);
          console.log(`🔥 Priority: ${response.task.priority}`);
        } else {
          console.log('❌ Assignment failed:', response.error);
        }
        
        resolve(response);
      } catch (error) {
        console.log('❌ Parse error:', error.message);
        reject(error);
      }
      
      client.end();
    });

    client.on('error', (error) => {
      console.log('❌ Connection error:', error.message);
      reject(error);
    });

    client.on('end', () => {
      console.log('🔌 Disconnected from daemon');
    });
  });
};

assignTask().catch(console.error);