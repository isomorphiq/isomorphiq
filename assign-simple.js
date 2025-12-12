#!/usr/bin/env node

import { connect } from "net";

const client = connect(3001, "localhost", () => {
  console.log("Connected to daemon");
  
  // First get all tasks to find high priority todo tasks
  const getTasksData = {
    action: "getAllTasks"
  };
  
  client.write(JSON.stringify(getTasksData));
});

let responseReceived = false;

client.on("data", (data) => {
  const response = JSON.parse(data.toString());
  
  if (!responseReceived) {
    responseReceived = true;
    console.log("Tasks retrieved successfully");
    
    if (response.success && response.data && response.data.length > 0) {
      // Find highest priority todo task
      const todoTasks = response.data.filter(task => task.status === "todo");
      const highPriorityTasks = todoTasks.filter(task => task.priority === "high");
      
      if (highPriorityTasks.length > 0) {
        const task = highPriorityTasks[0];
        console.log(`🎯 Found highest priority todo task:`);
        console.log(`   ID: ${task.id}`);
        console.log(`   Title: ${task.title}`);
        console.log(`   Priority: ${task.priority}`);
        console.log(`   Status: ${task.status}`);
        
        // Assign this task to development
        const assignData = {
          action: "updateTask",
          data: {
            id: task.id,
            assignee: "development",
            status: "in-progress"
          }
        };
        
        console.log("Assigning task to development...");
        client.write(JSON.stringify(assignData));
      } else {
        console.log("❌ No high-priority todo tasks found");
        // Show medium priority tasks as fallback
        const mediumPriorityTasks = todoTasks.filter(task => task.priority === "medium");
        if (mediumPriorityTasks.length > 0) {
          const task = mediumPriorityTasks[0];
          console.log(`🔄 Using medium priority task as fallback:`);
          console.log(`   ID: ${task.id}`);
          console.log(`   Title: ${task.title}`);
          
          const assignData = {
            action: "updateTask",
            data: {
              id: task.id,
              assignee: "development",
              status: "in-progress"
            }
          };
          
          console.log("Assigning task to development...");
          client.write(JSON.stringify(assignData));
        } else {
          console.log("❌ No available tasks found");
          client.end();
        }
      }
    } else {
      console.log("❌ Failed to retrieve tasks");
      client.end();
    }
  } else {
    console.log("Assignment response:", response);
    if (response.success) {
      console.log("✅ Task successfully assigned to development!");
    } else {
      console.log("❌ Task assignment failed");
    }
    client.end();
  }
});

client.on("error", (err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});