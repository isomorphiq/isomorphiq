#!/usr/bin/env node

// Simple script to handoff highest priority task to development
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
  try {
    console.log('🎯 Finding highest priority task to handoff to development...');
    
    // Get next task from queue
    const queueResponse = await sendCommand({
      type: 'get_queue',
      priority: 'high',
      status: 'todo'
    });
    
    console.log('Queue response:', queueResponse);
    
    if (queueResponse.tasks && queueResponse.tasks.length > 0) {
      const task = queueResponse.tasks[0];
      console.log(`📋 Found task: ${task.title} (${task.id})`);
      
      // Update task status to in-progress and assign to development
      const updateResponse = await sendCommand({
        type: 'update_task',
        taskId: task.id,
        updates: {
          status: 'in-progress',
          assignedTo: 'development',
          notes: 'Handed off to development team for implementation',
          handoffTime: new Date().toISOString()
        }
      });
      
      console.log('✅ Task handoff successful:', updateResponse);
      console.log(`\n🚀 Task "${task.title}" has been handed off to development team!`);
      console.log(`📝 Task ID: ${task.id}`);
      console.log(`⏰ Handoff time: ${new Date().toISOString()}`);
    } else {
      console.log('❌ No high priority todo tasks found for handoff');
    }
    
  } catch (error) {
    console.error('❌ Error during handoff:', error.message);
  }
}

main();