#!/usr/bin/env node

import net from 'net';

function sendCommand(command) {
    return new Promise((resolve, reject) => {
        const client = net.createConnection({ host: 'localhost', port: 3001 }, () => {
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

async function checkDaemonAndTasks() {
    try {
        console.log("🔍 Checking daemon status...");
        
        // Check daemon status
        const statusResponse = await sendCommand({
            type: 'status'
        });
        
        console.log("📊 Daemon status:", statusResponse);
        
        // Query all tasks
        const queryResponse = await sendCommand({
            type: 'query',
            action: 'list'
        });
        
        console.log("📋 Tasks response:", queryResponse);

    } catch (error) {
        console.error("💥 Error checking daemon:", error.message);
    }
}

checkDaemonAndTasks().then(() => {
    process.exit(0);
}).catch((error) => {
    console.error("💥 Check failed:", error);
    process.exit(1);
});