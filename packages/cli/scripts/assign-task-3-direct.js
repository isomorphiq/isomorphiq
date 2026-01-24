#!/usr/bin/env node

/**
 * Direct TCP call to assign Task 3 to development
 */

import { createDaemonConnection } from "@isomorphiq/cli";

async function assignTaskToDevelopment(taskId) {
  return new Promise((resolve, reject) => {
    const client = createDaemonConnection({ port: 3001 }, () => {
      console.log('🔌 Connected to daemon');
      
      const request = {
        action: 'assignTaskToDevelopment',
        data: { taskId }
      };
      
      client.write(JSON.stringify(request));
    });
    
    let responseData = '';
    
    client.on('data', (data) => {
      responseData += data.toString();
      
      try {
        const response = JSON.parse(responseData);
        if (response.success) {
          resolve(response);
        } else {
          reject(new Error(response.error || 'Unknown error'));
        }
      } catch (e) {
        // Not complete JSON yet
      }
    });
    
    client.on('end', () => {
      try {
        const response = JSON.parse(responseData);
        if (response.success) {
          resolve(response);
        } else {
          reject(new Error(response.error || 'Unknown error'));
        }
      } catch (e) {
        reject(new Error('Invalid response from daemon'));
      }
    });
    
    client.on('error', (error) => {
      reject(error);
    });
  });
}

async function main() {
  try {
    console.log("🎯 Assigning high-priority Task 3 to development...");
    
    // Use the Task 3 ID that was shown as high priority and todo
    const taskId = "task-1765516137864-6sgm4m3mv";
    
    const result = await assignTaskToDevelopment(taskId);
    
    console.log("✅ Task 3 successfully assigned to development!");
    console.log("🚀 Development team can now start working on Task 3.");
    console.log(`📋 Task ID: ${result.data?.taskId || taskId}`);
  } catch (error) {
    console.error("❌ Failed to assign task:", error.message);
    process.exit(1);
  }
}

main();