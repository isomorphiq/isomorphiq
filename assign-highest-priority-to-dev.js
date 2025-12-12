#!/usr/bin/env node

import { createConnection } from "net";

const client = createConnection({ port: 3001 }, () => {
  console.log("[DAEMON] Connected to task manager daemon");
  
  // Get all tasks to find the highest priority one
  const query = {
    command: "list_tasks"
  };
  
  client.write(JSON.stringify(query) + "\n");
});

let responseData = "";
let tasks = [];

client.on("data", (data) => {
  responseData += data.toString();
  
  // Try to parse the complete response when we get data
  try {
    const response = JSON.parse(responseData.trim());
    
    if (response.success && response.data) {
      tasks = response.data;
      console.log(`[QUERY] Found ${tasks.length} total tasks`);
      
      // Find the highest priority todo task
      const todoTasks = tasks.filter(task => task.status === 'todo' && task.priority === 'high');
      
      if (todoTasks.length === 0) {
        console.log("[QUERY] ℹ️ No high-priority todo tasks found");
        console.log("[QUERY] Looking for any todo tasks...");
        
        const anyTodoTasks = tasks.filter(task => task.status === 'todo');
        if (anyTodoTasks.length === 0) {
          console.log("[QUERY] ℹ️ No todo tasks found at all");
          client.end();
          return;
        }
        
        // Sort by priority (high > medium > low)
        const priorityOrder = { high: 0, medium: 1, low: 2 };
        const sortedTodoTasks = anyTodoTasks.sort((a, b) => {
          return (priorityOrder[a.priority] || 999) - (priorityOrder[b.priority] || 999);
        });
        
        assignTaskToDevelopment(sortedTodoTasks[0]);
        return;
      }

      const targetTask = todoTasks[0];
      assignTaskToDevelopment(targetTask);
      return;
    }
    
    if (response.error) {
      console.error("[ERROR] Daemon response error:", response.error?.message || response.error);
      client.end();
      return;
    }
  } catch (error) {
    // Ignore partial JSON errors, continue accumulating data
  }
});

function assignTaskToDevelopment(task) {
  console.log(`[ASSIGN] 🎯 Found task to assign to development:`);
  console.log(`   ID: ${task.id}`);
  console.log(`   Title: ${task.title}`);
  console.log(`   Priority: ${task.priority}`);
  console.log(`   Status: ${task.status}`);
  console.log(`   Created: ${task.createdAt}`);
  if (task.description) {
    console.log(`   Description: ${task.description}`);
  }
  
  // Update task status to in-progress (assign to development)
  const updateCommand = {
    command: "update_task_status",
    data: {
      id: task.id,
      status: "in-progress"
    }
  };
  
  console.log(`[ASSIGN] 🔄 Assigning task to development...`);
  client.write(JSON.stringify(updateCommand) + "\n");
  
  // Wait for the response and then end the connection
  setTimeout(() => {
    console.log("[ASSIGN] ✅ Task successfully handed to development for implementation!");
    console.log("[ASSIGN] 🚀 Development team can now start working on this task.");
    client.end();
  }, 1000);
}

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