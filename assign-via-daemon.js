#!/usr/bin/env node

import net from 'net';

async function assignViaDaemonAPI(taskId) {
  return new Promise((resolve, reject) => {
    console.log(`🎯 Assigning task ${taskId} to development via daemon API...`);
    
    const client = net.createConnection({ port: 3001, host: 'localhost' }, () => {
      console.log('✅ Connected to daemon');
      
      const updateData = {
        assignedTo: 'development',
        status: 'in-progress'
      };
      
      const request = {
        method: 'update_task',
        params: {
          taskId: taskId,
          updates: updateData
        }
      };
      
      client.write(JSON.stringify(request) + '\n');
    });
    
    client.on('data', (data) => {
      try {
        const response = JSON.parse(data.toString());
        console.log('📡 Response:', response);
        
        if (response.success) {
          console.log(`✅ Task ${taskId} successfully assigned to development!`);
        } else {
          console.log(`❌ Failed to assign task: ${response.error}`);
        }
        
        resolve(response);
      } catch (error) {
        console.error('❌ Error parsing response:', error);
        reject(error);
      }
      
      client.end();
    });
    
    client.on('error', (error) => {
      console.error('❌ Connection error:', error.message);
      reject(error);
    });
    
    client.on('end', () => {
      console.log('📡 Disconnected from daemon');
    });
  });
}

// Use the Task 3 ID from our earlier query
assignViaDaemonAPI('task-1765516137864-6sgm4m3mv').catch(console.error);