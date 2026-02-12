#!/usr/bin/env node

import { createDaemonConnection } from "@isomorphiq/cli";

function sendCommand(command) {
    return new Promise((resolve, reject) => {
        const client = createDaemonConnection({ host: 'localhost', port: 3001 }, () => {
            const data = Buffer.from(JSON.stringify(command));
            const header = Buffer.alloc(4);
            header.writeUInt32BE(data.length, 0);
            client.write(Buffer.concat([header, data]));
        });

        let response = '';
        client.on('data', (data) => {
            response += data.toString();
            try {
                const parsed = JSON.parse(response);
                client.end();
                resolve(parsed);
            } catch (e) {
                // Not complete JSON yet
            }
        });

        client.on('error', reject);
        client.setTimeout(5000, () => {
            client.destroy();
            reject(new Error('Timeout'));
        });
    });
}

async function handoffTaskToDevelopment() {
    try {
        console.log("🎯 Finding highest priority task to hand off to development...");
        
        // Query for highest priority task
        const queryResponse = await sendCommand({
            type: 'query',
            action: 'findHighestPriority'
        });

        if (!queryResponse.success || !queryResponse.task) {
            console.log("❌ No tasks found");
            return;
        }

        const task = queryResponse.task;
        console.log(`📋 Found task: ${task.title} (${task.id})`);

        // Update task status to in-progress and assign to development
        const updateResponse = await sendCommand({
            type: 'update',
            taskId: task.id,
            updates: {
                status: 'in-progress',
                assignedTo: 'development',
                assignedAt: new Date().toISOString(),
                handoffFrom: 'task-manager',
                notes: `Task handed off to development for implementation on ${new Date().toISOString()}`
            }
        });

        if (updateResponse.success) {
            console.log(`✅ Task ${task.id} successfully handed off to development!`);
            console.log(`   Title: ${task.title}`);
            console.log(`   Priority: ${task.priority}`);
            console.log(`   Status: in-progress`);
            console.log(`   Assigned to: development`);
        } else {
            console.log(`❌ Failed to hand off task: ${updateResponse.message}`);
        }

    } catch (error) {
        console.error("💥 Error handing off task:", error instanceof Error ? error.message : String(error));
    }
}

handoffTaskToDevelopment().then(() => {
    console.log("🚀 Task handoff completed");
    process.exit(0);
}).catch((error) => {
    console.error("💥 Task handoff failed:", error);
    process.exit(1);
});