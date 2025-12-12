#!/usr/bin/env node

import http from 'http';

/**
 * Claim highest priority task for development
 */
async function claimHighestPriorityTask() {
  try {
    console.log("[HANDOFF] Claiming highest priority task for development...");
    
    // Make request to daemon API
    const client = {
      claimHighestPriorityTask: async (assignedTo) => {
        return new Promise((resolve, reject) => {
          const postData = JSON.stringify({ assignedTo });
          
          const options = {
            hostname: 'localhost',
            port: 3003,
            path: '/claim-highest-priority-task',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(postData)
            }
          };

          const req = http.request(options, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
              data += chunk;
            });
            
            res.on('end', () => {
              try {
                const response = JSON.parse(data);
                if (res.statusCode === 200 && response.success) {
                  resolve(response.task);
                } else {
                  resolve(null);
                }
              } catch (error) {
                reject(error);
              }
            });
          });

          req.on('error', (error) => {
            reject(error);
          });

          req.write(postData);
          req.end();
        });
      }
    };
    
    const result = await client.claimHighestPriorityTask("development");
    
    if (result) {
      console.log("[HANDOFF] ✅ Successfully claimed task:");
      console.log(`   ID: ${result.id}`);
      console.log(`   Title: ${result.title}`);
      console.log(`   Priority: ${result.priority}`);
      console.log(`   Status: ${result.status}`);
      console.log(`   Assigned to: ${result.assignedTo}`);
      console.log(`   Description: ${result.description || 'No description'}`);
      console.log("\n[HANDOFF] 🚀 Task handed to development for implementation!");
      process.exit(0);
    } else {
      console.log("[HANDOFF] ❌ No tasks available to claim");
      process.exit(1);
    }
  } catch (error) {
    console.error("[HANDOFF] Error claiming task:", error.message);
    process.exit(1);
  }
}

// Get task ID from command line args if provided
const taskId = process.argv[2];

if (taskId) {
  console.log(`[HANDOFF] Attempting to claim specific task: ${taskId}`);
  // For now, we'll just claim the highest priority task
  // The specific task claiming can be implemented later
}

claimHighestPriorityTask();