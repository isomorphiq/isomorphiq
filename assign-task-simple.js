#!/usr/bin/env node

// Assign specific task to development
import * as net from 'net';

const DAEMON_PORT = 3001;
const DAEMON_HOST = 'localhost';

function sendCommand(command) {
  return new Promise((resolve, reject) => {
    const client = net.createConnection(DAEMON_PORT, DAEMON_HOST);
    
    client.on('connect', () => {
      console.log('Connected to daemon');
      client.write(JSON.stringify(command) + '\n');
    });
    
    let responseData = '';
    client.on('data', (data) => {
      responseData += data.toString();
    });
    
    client.on('end', () => {
      try {
        const response = JSON.parse(responseData.trim());
        resolve(response);
      } catch (e) {
        resolve({ raw: responseData.trim() });
      }
    });
    
    client.on('error', (err) => {
      reject(err);
    });
    
    client.setTimeout(5000, () => {
      client.destroy();
      reject(new Error('Connection timeout'));
    });
  });
}

async function main() {
  const taskId = process.argv[2];
  if (!taskId) {
    console.error('❌ Please provide a task ID');
    process.exit(1);
  }

  try {
    console.log(`🎯 Assigning task ${taskId} to development...`);
    
    // Update task status to in-progress and assign to development
    const updateResponse = await sendCommand({
      type: 'update_task',
      taskId: taskId,
      updates: {
        status: 'in-progress',
        assignedTo: 'development',
        notes: 'Assigned to development team for implementation',
        assignedTime: new Date().toISOString()
      }
    });
    
    console.log('✅ Task assignment response:', updateResponse);
    
    if (updateResponse.success) {
      console.log(`\n🚀 Task ${taskId} has been assigned to development team!`);
      console.log(`⏰ Assignment time: ${new Date().toISOString()}`);
    } else {
      console.error('❌ Failed to assign task');
    }
    
  } catch (error) {
    console.error('❌ Error during assignment:', error.message);
  }
}

main();