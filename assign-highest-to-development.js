#!/usr/bin/env node

import { connect } from "net";

const taskData = {
  action: "assignTask",
  data: {
    assignee: "development",
    priority: "high",
    status: "todo"
  }
};

const client = connect(3001, "localhost", () => {
  console.log("Connected to daemon");
  client.write(JSON.stringify(taskData));
});

client.on("data", (data) => {
  const response = JSON.parse(data.toString());
  console.log("Response:", response);
  
  if (response.success && response.data && response.data.length > 0) {
    const task = response.data[0];
    console.log(`🎯 Assigning highest priority task to development:`);
    console.log(`   ID: ${task.id}`);
    console.log(`   Title: ${task.title}`);
    console.log(`   Priority: ${task.priority}`);
    console.log(`   Status: ${task.status}`);
    
    // Now actually assign this task to development
    const assignData = {
      action: "updateTask",
      data: {
        id: task.id,
        assignee: "development",
        status: "in-progress"
      }
    };
    
    client.write(JSON.stringify(assignData));
  } else {
    console.log("❌ No suitable tasks found for assignment");
  }
  
  client.end();
});

client.on("error", (err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});