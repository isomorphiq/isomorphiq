#!/usr/bin/env node

import { createDaemonConnection } from "@isomorphiq/cli";

async function assignHighestPriorityTask() {
  return new Promise((resolve, reject) => {
    const socket = createDaemonConnection({ port: 3001 });
    let response = "";
    
    socket.on("data", (data) => {
      response += data.toString();
    });
    
    socket.on("end", () => {
      try {
        const result = JSON.parse(response);
        if (result.success && result.data) {
          const tasks = result.data;
          const todoTasks = tasks.filter(t => t.status === "todo" && t.priority === "high");
          
          if (todoTasks.length > 0) {
            const highestPriorityTask = todoTasks[0];
            console.log("🎯 Found highest priority todo task:");
            console.log(`   ID: ${highestPriorityTask.id}`);
            console.log(`   Title: ${highestPriorityTask.title}`);
            console.log(`   Priority: ${highestPriorityTask.priority}`);
            console.log(`   Status: ${highestPriorityTask.status}`);
            
            // Now assign it to development
            assignToDevelopment(highestPriorityTask);
          } else {
            console.log("❌ No high-priority todo tasks found");
            console.log("Available tasks:");
            tasks.forEach(t => {
              console.log(`   ${t.priority}: ${t.title} (${t.status})`);
            });
          }
        } else {
          console.log("❌ Failed to get task list:", result);
        }
        resolve(result);
      } catch (e) {
        console.log("❌ Error parsing response:", e.message);
        console.log("Raw response:", response);
        reject(e);
      }
    });
    
    socket.on("error", (err) => {
      console.log("❌ Socket error:", err.message);
      reject(err);
    });
    
    socket.write(JSON.stringify({ action: "list_tasks" }) + "\n");
    socket.end();
  });
}

function assignToDevelopment(task) {
  const updateSocket = createDaemonConnection({ port: 3001 });
  let updateResponse = "";
  
  updateSocket.on("data", (data) => {
    updateResponse += data.toString();
  });
  
  updateSocket.on("end", () => {
    try {
      const updateResult = JSON.parse(updateResponse);
      if (updateResult.success) {
        console.log("\n✅ Task successfully assigned to development!");
        console.log(`   Task ID: ${task.id}`);
        console.log(`   Assignee: development`);
        console.log(`   Status: in-progress`);
        console.log(`   Handoff Time: ${new Date().toISOString()}`);
      } else {
        console.log("\n❌ Failed to assign task:", updateResult);
      }
    } catch (e) {
      console.log("\n❌ Error parsing update response:", e.message);
      console.log("Raw update response:", updateResponse);
    }
  });
  
  updateSocket.on("error", (err) => {
    console.log("❌ Update socket error:", err.message);
  });
  
  const updateData = {
    action: "update_task",
    taskId: task.id,
    updates: {
      status: "in-progress",
      assignee: "development",
      handoffTime: new Date().toISOString(),
      assignedAt: new Date().toISOString()
    }
  };
  
  console.log("\n🔄 Assigning task to development...");
  updateSocket.write(JSON.stringify(updateData) + "\n");
  updateSocket.end();
}

assignHighestPriorityTask().catch(console.error);