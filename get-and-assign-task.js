#!/usr/bin/env node

import net from 'net';

async function getAllTasksViaDaemon() {
  return new Promise((resolve, reject) => {
    console.log('🔍 Getting all tasks via daemon API...');
    
    const client = net.createConnection({ port: 3001, host: 'localhost' }, () => {
      console.log('✅ Connected to daemon');
      
      const request = {
        method: 'list_tasks',
        params: {}
      };
      
      client.write(JSON.stringify(request) + '\n');
    });
    
    client.on('data', (data) => {
      try {
        const response = JSON.parse(data.toString());
        console.log('📡 Response received');
        
        if (response.success && response.tasks) {
          // Find high priority todo tasks
          const highPriorityTodoTasks = response.tasks.filter(task => 
            task.priority === 'high' && task.status === 'todo'
          );
          
          console.log(`🎯 Found ${highPriorityTodoTasks.length} high priority todo tasks:`);
          highPriorityTodoTasks.forEach((task, index) => {
            console.log(`  ${index + 1}. ${task.title} (ID: ${task.id})`);
          });
          
          if (highPriorityTodoTasks.length > 0) {
            const taskToAssign = highPriorityTodoTasks[0];
            console.log(`\n🎯 Assigning "${taskToAssign.title}" to development...`);
            
            // Now assign the first task
            const updateData = {
              assignedTo: 'development',
              status: 'in-progress'
            };
            
            const assignRequest = {
              method: 'update_task',
              params: {
                taskId: taskToAssign.id,
                updates: updateData
              }
            };
            
            client.write(JSON.stringify(assignRequest) + '\n');
          } else {
            console.log('❌ No high priority todo tasks found');
            client.end();
          }
        } else {
          console.log('❌ Failed to get tasks:', response);
          client.end();
        }
      } catch (error) {
        console.error('❌ Error parsing response:', error);
        reject(error);
        client.end();
      }
    });
    
    client.on('data', (data) => {
      try {
        const response = JSON.parse(data.toString());
        
        if (response.method === 'update_task' && response.success) {
          console.log('✅ Task successfully assigned to development!');
          resolve(response);
        } else if (response.method === 'update_task' && !response.success) {
          console.log('❌ Failed to assign task:', response.error);
          resolve(response);
        }
      } catch (error) {
        // Ignore parsing errors for subsequent data
      }
    });
    
    client.on('error', (error) => {
      console.error('❌ Connection error:', error.message);
      reject(error);
    });
    
    client.on('end', () => {
      console.log('📡 Disconnected from daemon');
      resolve();
    });
  });
}

getAllTasksViaDaemon().catch(console.error);