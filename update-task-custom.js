#!/usr/bin/env node

import { createConnection } from "node:net";

const taskId = process.argv[2];
const status = process.argv[3];
const assignedTo = process.argv[4];

if (!taskId || !status) {
    console.error("Usage: node update-task.js <taskId> <status> [assignedTo]");
    process.exit(1);
}

console.log(`Updating task ${taskId} status to ${status}${assignedTo ? ` and assigning to ${assignedTo}` : ""}...`);

const message = `${JSON.stringify({
    command: "update_task_status",
    data: {
        id: taskId,
        status: status
    }
})}\n`;

const client = createConnection({ port: 3001 }, () => {
    console.log("Connected to daemon, updating task status...");
    client.write(message);
});

client.on("data", (data) => {
    const response = JSON.parse(data.toString());
    console.log("Daemon response:", response);
    client.end();
});

client.on("error", (err) => {
    console.error("Error connecting to daemon:", err);
    process.exit(1);
});

client.on("end", () => {
    console.log("Disconnected from daemon");
});