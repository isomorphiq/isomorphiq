#!/usr/bin/env node

import { createConnection } from "net";

const client = createConnection({ port: 3001 }, () => {
  console.log("Connected to daemon");
  
  // Get highest priority task
  const query = {
    type: "query",
    payload: {
      priority: "high",
      status: "todo",
      sortBy: "createdAt",
      sortOrder: "asc",
      limit: 1
    }
  };
  
  client.write(JSON.stringify(query) + "\n");
});

let responseData = "";

client.on("data", (data) => {
  responseData += data.toString();
  
  try {
    const lines = responseData.split("\n").filter(line => line.trim());
    for (const line of lines) {
      const response = JSON.parse(line);
      if (response.type === "query_response" && response.data && response.data.length > 0) {
        const task = response.data[0];
        console.log(`Found highest priority task: ${task.title} (${task.id})`);
        
        // Assign to development
        const update = {
          type: "update",
          payload: {
            id: task.id,
            assignedTo: "development",
            status: "in-progress"
          }
        };
        
        client.write(JSON.stringify(update) + "\n");
        console.log(`Task "${task.title}" assigned to development team`);
        client.end();
        return;
      }
    }
  } catch (error) {
    // Ignore partial JSON errors
  }
});

client.on("end", () => {
  console.log("Disconnected from daemon");
});

client.on("error", (error) => {
  console.error("Connection error:", error.message);
  process.exit(1);
});

setTimeout(() => {
  console.error("Timeout - no response received");
  client.end();
  process.exit(1);
}, 5000);