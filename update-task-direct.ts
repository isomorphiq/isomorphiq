#!/usr/bin/env node

// Direct TCP API call to update task status
import net from "net";

const taskId = "task-1765516228776-i0emhswko";

function updateTaskStatus() {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ port: 3001 }, () => {
      console.log("Connected to daemon TCP API");
      
      const request = {
        type: "updateTaskStatus",
        data: {
          taskId,
          status: "done"
        }
      };
      
      socket.write(JSON.stringify(request) + "\n");
    });
    
    socket.on("data", (data) => {
      const response = JSON.parse(data.toString());
      console.log("Daemon response:", response);
      
      if (response.success) {
        console.log(`✅ Task ${taskId} status updated to "done" successfully!`);
        resolve(response);
      } else {
        console.error(`❌ Failed to update task status:`, response.error);
        reject(new Error(response.error || "Unknown error"));
      }
      
      socket.end();
    });
    
    socket.on("error", (err) => {
      console.error("Socket error:", err.message);
      reject(err);
    });
    
    socket.on("timeout", () => {
      console.error("Connection timeout");
      socket.destroy();
      reject(new Error("Connection timeout"));
    });
    
    socket.setTimeout(10000);
  });
}

updateTaskStatus()
  .then(() => {
    console.log("Task 3 implementation complete!");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Error:", err.message);
    process.exit(1);
  });