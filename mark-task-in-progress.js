#!/usr/bin/env node

import net from 'net';

async function markTaskInProgress(taskId) {
  return new Promise((resolve, reject) => {
    console.log(`🔄 Marking task ${taskId} as in-progress...`);
    
    const client = net.createConnection({ port: 3001, host: 'localhost' }, () => {
      console.log('✅ Connected to daemon');
      
      const request = {
        command: 'update_task_status',
        data: {
          id: taskId,
          status: 'in-progress'
        }
      };
      
      console.log('📤 Sending status update request...');
      client.write(JSON.stringify(request) + '\n');
    });
    
    client.on('data', (data) => {
      try {
        const response = JSON.parse(data.toString());
        console.log('📡 Response:', response);
        
        if (response.success) {
          console.log(`✅ Task ${taskId} successfully marked as in-progress!`);
          console.log('🎯 Development team can now begin implementation!');
        } else {
          console.log(`❌ Failed to update task: ${response.error}`);
        }
        
        resolve(response);
      } catch (error) {
        console.error('❌ Error parsing response:', error);
        console.log('Raw response:', data.toString());
        resolve(data.toString());
      }
      
      client.end();
    });
    
    client.on('error', (error) => {
      console.error('❌ Connection error:', error.message);
      reject(error);
    });
    
    client.on('end', () => {
      console.log('🔌 Disconnected from daemon');
    });
  });
}

// Use the task ID from the previous response
const taskId = 'task-1765549638218';
markTaskInProgress(taskId).catch(console.error);