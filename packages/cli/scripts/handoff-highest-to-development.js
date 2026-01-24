#!/usr/bin/env node

import { createDaemonConnection } from "@isomorphiq/cli";

const handoffHighestPriorityTask = async () => {
  return new Promise((resolve, reject) => {
    const client = createDaemonConnection({ port: 3001 }, () => {
      console.log('🔌 Connected to daemon');
      
      // First get all tasks
      const listCommand = {
        command: 'list_tasks'
      };
      
      client.write(JSON.stringify(listCommand));
    });

    let tasksReceived = false;
    
    client.on('data', (data) => {
      try {
        const response = JSON.parse(data.toString().trim());
        
        if (!tasksReceived) {
          // First response - handle tasks list
          tasksReceived = true;
          
          if (response.success && response.data) {
            const tasks = response.data;
            console.log(`📋 Found ${tasks.length} tasks`);
            
            // Find highest priority todo task
            const todoTasks = tasks.filter(task => task.status === 'todo');
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
              console.log(`📝 Task Details:`);
              console.log(`   ID: ${targetTask.id}`);
              console.log(`   Title: ${targetTask.title}`);
              console.log(`   Priority: ${targetTask.priority}`);
              console.log(`   Status: ${targetTask.status}`);
              console.log(`   Description: ${targetTask.description}`);
              
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
        } else {
          // Second response - handle task update
          if (response.success) {
            console.log(`\n✅ Task successfully handed off to development!`);
            console.log(`📊 Updated task:`, response.data);
            resolve({ success: true, task: response.data });
          } else {
            console.log('❌ Failed to update task:', response.error);
            resolve({ success: false, error: response.error });
          }
          client.end();
        }
      } catch (error) {
        console.log('❌ Parse error:', error.message);
        reject(error);
        client.end();
      }
    });

    client.on('error', (error) => {
      console.log('❌ Connection error:', error.message);
      reject(error);
    });

    client.on('end', () => {
      console.log('🔌 Disconnected from daemon');
    });
  });
};

handoffHighestPriorityTask()
  .then((result) => {
    if (result.success) {
      console.log('\n🎉 Task handoff completed successfully!');
      process.exit(0);
    } else {
      console.log('\n💥 Task handoff failed');
      process.exit(1);
    }
  })
  .catch((error) => {
    console.error('\n💥 Unexpected error:', error);
    process.exit(1);
  });