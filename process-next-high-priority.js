#!/usr/bin/env node

/**
 * Try to claim one of the high-priority tasks shown in daemon
 */

import net from 'net';

async function claimTask(taskId) {
  return new Promise((resolve, reject) => {
    const client = net.createConnection({ port: 3001 }, () => {
      console.log('🔌 Connected to daemon');
      
      const request = {
        action: 'processNextTask',
        data: { 
          priority: 'high'
        }
      };
      
      client.write(JSON.stringify(request));
    });
    
    let responseData = '';
    
    client.on('data', (data) => {
      responseData += data.toString();
      
      try {
        const response = JSON.parse(responseData);
        console.log('Response:', response);
        if (response.success) {
          resolve(response);
        } else {
          reject(new Error(response.error || JSON.stringify(response)));
        }
        client.end();
      } catch (e) {
        // Not complete JSON yet, keep reading
      }
    });
    
    client.on('end', () => {
      try {
        const response = JSON.parse(responseData);
        if (response.success) {
          resolve(response);
        } else {
          reject(new Error(response.error || JSON.stringify(response)));
        }
      } catch (e) {
        reject(new Error('Invalid response from daemon: ' + responseData));
      }
    });
    
    client.on('error', (error) => {
      reject(error);
    });
  });
}

async function main() {
  try {
    console.log("🎯 Processing next high-priority task for development...");
    
    const result = await claimTask();
    
    console.log("✅ High-priority task successfully processed!");
    console.log("🚀 Development team can now start working on the task.");
    console.log(`📋 Task Details:`, result.data);
  } catch (error) {
    console.error("❌ Failed to process task:", error.message);
    process.exit(1);
  }
}

main();