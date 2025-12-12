#!/usr/bin/env node

import { createConnection } from "node:net";

const taskId = "task-1765516228776-i0emhswko";

console.log(`Updating task ${taskId} status to completed...`);

// First update to in-progress
const messageInProgress = JSON.stringify({
    command: "update_task_status",
    data: {
        id: taskId,
        status: "in-progress"
    }
});

// Then update to completed
const messageCompleted = JSON.stringify({
    command: "update_task_status", 
    data: {
        id: taskId,
        status: "completed"
    }
});

const client = createConnection({ port: 3001 }, () => {
    console.log("Connected to daemon, updating task status...");
    
    // Update to in-progress first
    client.write(messageInProgress);
    
    setTimeout(() => {
        // Then update to completed
        client.write(messageCompleted);
    }, 1000);
});

client.on("data", (data) => {
    const response = JSON.parse(data.toString());
    console.log("Daemon response:", response);
});

client.on("error", (err) => {
    console.error("Error connecting to daemon:", err);
});

client.on("end", () => {
    console.log("Disconnected from daemon");
});