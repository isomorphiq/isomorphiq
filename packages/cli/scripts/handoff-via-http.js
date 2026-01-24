#!/usr/bin/env node

import http from 'http';

const handoffTaskViaHttp = async () => {
  const options = {
    hostname: 'localhost',
    port: 3003,
    path: '/api/tasks',
    method: 'GET',
    headers: {
      'Content-Type': 'application/json'
    }
  };

  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          resolve(response);
        } catch (error) {
          reject(error);
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.end();
  });
};

const updateTaskViaHttp = async (taskId) => {
  const updateData = JSON.stringify({
    status: 'in-progress',
    assignedTo: 'development'
  });

  const options = {
    hostname: 'localhost',
    port: 3003,
    path: `/api/tasks/${taskId}`,
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(updateData)
    }
  };

  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          resolve(response);
        } catch (error) {
          reject(error);
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.write(updateData);
    req.end();
  });
};

const main = async () => {
  try {
    console.log('🔌 Fetching tasks from HTTP API...');
    
    // Get all tasks
    const tasksResponse = await handoffTaskViaHttp();
    
    if (tasksResponse.success && tasksResponse.tasks) {
      const tasks = tasksResponse.tasks;
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
        
        // Now assign this task to development
        console.log(`\n🚀 Assigning task to development...`);
        const updateResponse = await updateTaskViaHttp(targetTask.id);
        
        if (updateResponse.success) {
          console.log(`\n✅ Task successfully handed off to development!`);
          console.log(`📊 Updated task:`, updateResponse.task);
          console.log('\n🎉 Task handoff completed successfully!');
        } else {
          console.log('❌ Failed to update task:', updateResponse.error);
          console.log('\n💥 Task handoff failed');
        }
      } else {
        console.log('❌ No available todo tasks found');
      }
    } else {
      console.log('❌ Failed to get tasks:', tasksResponse.error);
    }
  } catch (error) {
    console.error('💥 Unexpected error:', error);
  }
};

main();