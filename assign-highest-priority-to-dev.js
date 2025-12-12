#!/usr/bin/env node

import { createConnection } from "net";

const client = createConnection({ port: 3001 }, () => {
  console.log("[DAEMON] Connected to task manager daemon");
  
  // First, get all tasks to find the highest priority one
  const query = {
    command: "list_tasks",
    data: {}
  };
  
  client.write(JSON.stringify(query) + "\n");
});

let responseData = "";
let tasks = [];

client.on("data", (data) => {
  responseData += data.toString();
  
  try {
    const lines = responseData.split("\n").filter(line => line.trim());
    for (const line of lines) {
      const response = JSON.parse(line);
      
      if (response.command === "list_tasks_response" && response.success && response.data) {
        tasks = response.data;
        console.log(`[QUERY] Found ${tasks.length} total tasks`);
        
        // Filter for unassigned todo tasks and sort by priority
        const priorityWeight = { high: 0, medium: 1, low: 2, invalid: 3 };
        const availableTasks = tasks
          .filter(task => task.status === 'todo' && !task.assignedTo)
          .sort((a, b) => {
            const weightA = priorityWeight[a.priority] || 999;
            const weightB = priorityWeight[b.priority] || 999;
            if (weightA !== weightB) {
              return weightA - weightB;
            }
            // If same priority, sort by creation date (newest first)
            return new Date(b.createdAt) - new Date(a.createdAt);
          });

        if (availableTasks.length === 0) {
          console.log("[QUERY] ℹ️ No available tasks to assign (all todo tasks are already assigned)");
          client.end();
          return;
        }

        const targetTask = availableTasks[0];
        console.log(`[QUERY] 🎯 Found highest priority available task:`);
        console.log(`   ID: ${targetTask.id}`);
        console.log(`   Title: ${targetTask.title}`);
        console.log(`   Priority: ${targetTask.priority}`);
        console.log(`   Status: ${targetTask.status}`);
        console.log(`   Created: ${targetTask.createdAt}`);
        if (targetTask.description) {
          console.log(`   Description: ${targetTask.description}`);
        }
        
        // Assign to development profile using the assign_task_to_profile command
        const assignCommand = {
          command: "assign_task_to_profile",
          data: {
            profileName: "development",
            task: targetTask
          }
        };
        
        console.log(`[ASSIGN] Assigning task to development profile...`);
        client.write(JSON.stringify(assignCommand) + "\n");
        return;
      }
      
      if (response.command === "assign_task_to_profile_response") {
        if (response.success) {
          console.log("[ASSIGN] ✅ Task assigned successfully to development profile!");
          console.log("[ASSIGN] 🚀 Task successfully handed to development for implementation!");
        } else {
          console.error("[ASSIGN] ❌ Failed to assign task:", response.error?.message || "Unknown error");
        }
        client.end();
        return;
      }
      
      // Handle any error responses
      if (response.error) {
        console.error("[ERROR] Daemon response error:", response.error?.message || response.error);
        client.end();
        return;
      }
    }
  } catch (error) {
    // Ignore partial JSON errors, continue accumulating data
  }
});

client.on("end", () => {
  console.log("[DAEMON] Disconnected from daemon");
});

client.on("error", (error) => {
  console.error("[DAEMON] Connection error:", error.message);
  process.exit(1);
});

// Set a timeout to avoid hanging
setTimeout(() => {
  console.error("[TIMEOUT] No response received within 10 seconds");
  client.end();
  process.exit(1);
}, 10000);