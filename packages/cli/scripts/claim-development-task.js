#!/usr/bin/env node

import { createDaemonConnection } from "@isomorphiq/cli";

// Known high priority task IDs from the earlier listing
const highPriorityTaskIds = [
  'task-1765349468004',  // Enable Task Predictive Analytics and Forecasting - todo
  'task-1765349479463',  // Add Task Advanced Reporting and Business Intelligence - todo
  'task-1765349495640',  // Implement Task Blockchain Verification and Audit Trail - todo (low priority)
];

async function claimTask(taskId) {
  return new Promise((resolve, reject) => {
    const client = createDaemonConnection({ port: 3001 }, () => {
      console.log(`Connected to daemon, claiming task ${taskId}...`);
      
      const command = JSON.stringify({
        command: 'update_task_status',
        data: {
          id: taskId,
          status: 'in-progress'
        }
      });
      
      client.write(command + '\n');
    });
    
    client.on('data', (data) => {
      try {
        const response = JSON.parse(data.toString());
        resolve(response);
      } catch (error) {
        reject(error);
      }
      client.end();
    });
    
    client.on('error', (err) => {
      reject(err);
    });
    
    setTimeout(() => {
      client.destroy();
      reject(new Error('Timeout'));
    }, 5000);
  });
}

async function claimHighPriorityTask() {
  for (const taskId of highPriorityTaskIds) {
    try {
      console.log(`\n🔧 Attempting to claim task: ${taskId}`);
      const response = await claimTask(taskId);
      
      if (response.success) {
        console.log(`\n✅ SUCCESS! Task assigned to development:`);
        console.log(`Task ID: ${response.data.id}`);
        console.log(`Title: ${response.data.title}`);
        console.log(`Priority: ${response.data.priority}`);
        console.log(`Status: ${response.data.status}`);
        console.log(`\n🚀 Ready for implementation!`);
        return;
      } else {
        console.log(`❌ Failed: ${response.error?.message || 'Unknown error'}`);
      }
    } catch (error) {
      console.log(`❌ Error: ${error.message}`);
    }
  }
  
  console.log('\n❌ Could not claim any high-priority tasks');
}

claimHighPriorityTask();