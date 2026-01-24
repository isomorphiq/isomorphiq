#!/usr/bin/env node

import net from 'net';

async function createAndAssignHighPriorityTask() {
  return new Promise((resolve, reject) => {
    console.log('🚀 Creating high priority task for development...');
    
    const client = net.createConnection({ port: 3001, host: 'localhost' }, () => {
      console.log('✅ Connected to daemon');
      
      const taskData = {
        title: "Implement Real-Time Collaboration Features",
        description: "Add live task updates, team presence indicators, simultaneous editing, and instant notifications using WebSocket connections for seamless team coordination and real-time project management.",
        priority: "high",
        status: "in-progress", // Immediately set to in-progress
        type: "task",
        assignedTo: "development",
        createdBy: "product-manager",
        dependencies: [],
        tags: ["collaboration", "websocket", "real-time", "team-workflow"]
      };
      
      const request = {
        command: 'create_task',
        data: taskData
      };
      
      console.log('📤 Sending task creation request...');
      client.write(JSON.stringify(request) + '\n');
    });
    
    client.on('data', (data) => {
      try {
        const response = JSON.parse(data.toString());
        console.log('📡 Response:', response);
        
        if (response.success) {
          console.log('✅ High priority task successfully created and assigned to development!');
          console.log('🎯 Task ID:', response.taskId);
          console.log('🔥 Priority: HIGH');
          console.log('👥 Assigned to: development');
          console.log('📊 Status: in-progress');
          console.log('📝 Task: Implement Real-Time Collaboration Features');
        } else {
          console.log(`❌ Failed to create task: ${response.error}`);
        }
        
        resolve(response);
      } catch (error) {
        console.error('❌ Error parsing response:', error);
        console.log('Raw response:', data.toString());
        resolve(data.toString());
      }
      
      client.end();
    });
    
    client.on('error', (error) => {
      console.error('❌ Connection error:', error.message);
      reject(error);
    });
    
    client.on('end', () => {
      console.log('🔌 Disconnected from daemon');
    });
  });
}

createAndAssignHighPriorityTask().catch(console.error);