#!/usr/bin/env node

import net from 'net';

const handoffTaskToDevelopment = () => {
  return new Promise((resolve, reject) => {
    const client = net.createConnection({ port: 3001 }, () => {
      console.log('🔌 Connected to daemon');
      
      // Get all tasks first
      const command = {
        command: 'list_tasks'
      };
      
      client.write(JSON.stringify(command));
    });

    let buffer = '';
    let responseCount = 0;
    
    client.on('data', (data) => {
      buffer += data.toString();
      
      // Try to parse complete JSON objects from buffer
      while (buffer.length > 0) {
        try {
          const response = JSON.parse(buffer.trim());
          buffer = ''; // Clear buffer after successful parse
          responseCount++;
          
          if (responseCount === 1) {
            // First response - handle tasks list
            if (response.success && response.data) {
              const tasks = response.data;
              console.log(`📋 Found ${tasks.length} tasks`);
              
              // Find highest priority todo task
              const todoTasks = tasks.filter(task => task.status === 'todo');
              console.log(`📝 Found ${todoTasks.length} todo tasks`);
              
              const highPriorityTasks = todoTasks.filter(task => task.priority === 'high');
              const mediumPriorityTasks = todoTasks.filter(task => task.priority === 'medium');
              
              let targetTask = null;
              if (highPriorityTasks.length > 0) {
                targetTask = highPriorityTasks[0];
                console.log(`🎯 Found high priority task: ${targetTask.title}`);
              } else if (mediumPriorityTasks.length > 0) {
                targetTask = mediumPriorityTasks[0];
                console.log(`🎯 Found medium priority task: ${targetTask.title}`);
              } else if (todoTasks.length > 0) {
                targetTask = todoTasks[0];
                console.log(`🎯 Found low priority task: ${targetTask.title}`);
              }
              
              if (targetTask) {
                console.log(`\n📝 Task Details:`);
                console.log(`   ID: ${targetTask.id}`);
                console.log(`   Title: ${targetTask.title}`);
                console.log(`   Priority: ${targetTask.priority}`);
                console.log(`   Status: ${targetTask.status}`);
                console.log(`   Created: ${targetTask.createdAt}`);
                if (targetTask.description && targetTask.description.length < 100) {
                  console.log(`   Description: ${targetTask.description}`);
                }
                
                // Now assign this task to development by updating its status
                console.log(`\n🚀 Assigning task to development...`);
                const updateCommand = {
                  command: 'update_task_status',
                  data: {
                    id: targetTask.id,
                    status: 'in-progress'
                  }
                };
                
                client.write(JSON.stringify(updateCommand));
              } else {
                console.log('❌ No available todo tasks found');
                client.end();
                resolve({ success: false, message: 'No available tasks' });
              }
            } else {
              console.log('❌ Failed to get tasks:', response.error);
              client.end();
              resolve({ success: false, error: response.error });
            }
          } else if (responseCount === 2) {
            // Second response - handle task update
            if (response.success) {
              console.log(`\n✅ Task successfully handed off to development!`);
              console.log(`📊 Task status updated to: in-progress`);
              resolve({ success: true, task: response.data });
            } else {
              console.log('❌ Failed to update task:', response.error);
              resolve({ success: false, error: response.error });
            }
            client.end();
          }
        } catch (parseError) {
          // If we can't parse, it might be incomplete data, wait for more
          if (buffer.length > 50000) {
            // If buffer is too large, something is wrong
            console.log('❌ Response too large, truncating...');
            buffer = buffer.substring(0, 50000);
          }
          break;
        }
      }
    });

    client.on('error', (error) => {
      console.log('❌ Connection error:', error.message);
      reject(error);
    });

    client.on('end', () => {
      console.log('🔌 Disconnected from daemon');
      if (responseCount === 0) {
        resolve({ success: false, error: 'No response received' });
      }
    });

    // Set timeout
    setTimeout(() => {
      if (responseCount === 0) {
        console.log('❌ Timeout waiting for response');
        client.end();
        resolve({ success: false, error: 'Timeout' });
      }
    }, 10000);
  });
};

handoffTaskToDevelopment()
  .then((result) => {
    if (result.success) {
      console.log('\n🎉 Task handoff completed successfully!');
      console.log('The highest priority task has been assigned to development for implementation.');
      process.exit(0);
    } else {
      console.log('\n💥 Task handoff failed');
      console.log('Error:', result.error || result.message);
      process.exit(1);
    }
  })
  .catch((error) => {
    console.error('\n💥 Unexpected error:', error);
    process.exit(1);
  });