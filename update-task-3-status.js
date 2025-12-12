#!/usr/bin/env node

import { createConnection } from "node:net";

const taskId = "task-1765516228776-i0emhswko";

function sendCommand(socket, command) {
    return new Promise((resolve, reject) => {
        const message = JSON.stringify(command);
        console.log("Sending:", message);
        
        socket.write(message);
        
        // Wait for response
        socket.once("data", (data) => {
            try {
                const response = JSON.parse(data.toString());
                resolve(response);
            } catch (error) {
                reject(error);
            }
        });
        
        socket.once("error", reject);
    });
}

async function completeTask() {
    console.log(`Connecting to daemon to update task ${taskId}...`);
    
    const client = createConnection({ port: 3001 }, () => {
        console.log("Connected to daemon");
    });
    
    try {
        // Update to in-progress
        const inProgressResponse = await sendCommand(client, {
            command: "update_task_status",
            data: {
                id: taskId,
                status: "in-progress"
            }
        });
        
        console.log("In-progress response:", inProgressResponse);
        
        // Wait a moment then update to done
        setTimeout(async () => {
            const doneResponse = await sendCommand(client, {
                command: "update_task_status",
                data: {
                    id: taskId,
                    status: "done"
                }
            });
            
            console.log("Done response:", doneResponse);
            client.end();
            console.log("Task 3 status updated successfully!");
        }, 1000);
        
    } catch (error) {
        console.error("Error:", error);
        client.end();
    }
}

completeTask();