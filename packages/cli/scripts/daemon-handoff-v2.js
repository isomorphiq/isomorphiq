#!/usr/bin/env node

import { createDaemonConnection } from "@isomorphiq/cli";

function sendDaemonCommand(command) {
    return new Promise((resolve, reject) => {
        const client = createDaemonConnection({ host: 'localhost', port: 3001 }, () => {
            console.log("📡 Connected to daemon");
            const message = JSON.stringify(command);
            console.log("📤 Sending:", message);
            client.write(message);
        });

        let fullData = '';
        client.on('data', (data) => {
            fullData += data.toString();
            console.log("📥 Received raw data:", data);
            
            try {
                // Try to parse the response
                const response = JSON.parse(fullData.trim());
                client.end();
                resolve(response);
            } catch (e) {
                console.log("⚠️  JSON parse error, waiting for more data...");
                // Keep reading for more data
            }
        });

        client.on('end', () => {
            if (fullData) {
                try {
                    const response = JSON.parse(fullData.trim());
                    resolve(response);
                } catch (e) {
                    reject(new Error(`Invalid JSON response: ${fullData}`));
                }
            } else {
                reject(new Error('No response received'));
            }
        });

        client.on('error', (err) => {
            console.error("🔥 Connection error:", err);
            reject(err);
        });

        client.setTimeout(10000, () => {
            client.destroy();
            reject(new Error('Timeout waiting for response'));
        });
    });
}

async function findAndHandoffTask() {
    try {
        console.log("🎯 Finding highest priority task...");
        
        // Get all tasks
        const listResponse = await sendDaemonCommand({
            type: 'query',
            action: 'list'
        });
        
        console.log("📋 Tasks response:", listResponse);
        
        if (listResponse.success && listResponse.tasks) {
            // Find highest priority todo task
            const todoTasks = listResponse.tasks.filter(task => task.status === 'todo');
            const highPriorityTasks = todoTasks.filter(task => task.priority === 'high');
            
            if (highPriorityTasks.length > 0) {
                const task = highPriorityTasks[0];
                console.log(`🎯 Found highest priority task: ${task.title} (${task.id})`);
                
                // Update task to in-progress and assign to development
                const updateResponse = await sendDaemonCommand({
                    type: 'update',
                    taskId: task.id,
                    updates: {
                        status: 'in-progress',
                        assignedTo: 'development',
                        assignedAt: new Date().toISOString(),
                        handoffFrom: 'task-manager',
                        notes: `Task handed off to development for implementation`
                    }
                });
                
                if (updateResponse.success) {
                    console.log(`✅ Successfully handed off task to development!`);
                    console.log(`   Task: ${task.title}`);
                    console.log(`   ID: ${task.id}`);
                    console.log(`   Priority: ${task.priority}`);
                    console.log(`   Status: in-progress`);
                    console.log(`   Assigned to: development`);
                } else {
                    console.log(`❌ Failed to update task: ${updateResponse.message}`);
                }
            } else {
                console.log("ℹ️  No high priority tasks found");
            }
        } else {
            console.log("❌ Failed to get tasks:", listResponse.message || 'Unknown error');
        }
        
    } catch (error) {
        console.error("💥 Error:", error.message);
    }
}

findAndHandoffTask().then(() => {
    console.log("🚀 Handoff process completed");
    process.exit(0);
}).catch((error) => {
    console.error("💥 Handoff failed:", error);
    process.exit(1);
});