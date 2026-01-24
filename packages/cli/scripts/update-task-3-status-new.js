#!/usr/bin/env node

/**
 * Update task status to assign to development
 */

import { createDaemonConnection } from "@isomorphiq/cli";

async function updateTaskStatus(taskId, status, assignedTo = 'development') {
  return new Promise((resolve, reject) => {
    const client = createDaemonConnection({ port: 3001 }, () => {
      console.log('🔌 Connected to daemon');
      
      const request = {
        action: 'updateTask',
        data: { 
          taskId,
          updates: {
            status,
            assignedTo,
            updatedAt: new Date().toISOString()
          }
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
    console.log("🎯 Assigning high-priority Task 3 to development via status update...");
    
    // Use the Task 3 ID that was shown as high priority and todo
    const taskId = "task-1765516137864-6sgm4m3mv";
    
    const result = await updateTaskStatus(taskId, 'in-progress', 'development');
    
    console.log("✅ Task 3 successfully assigned to development!");
    console.log("🚀 Development team can now start working on Task 3.");
    console.log(`📋 Task ID: ${result.data?.taskId || taskId}`);
  } catch (error) {
    console.error("❌ Failed to assign task:", error.message);
    process.exit(1);
  }
}

main();