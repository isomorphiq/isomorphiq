#!/usr/bin/env node

import http from 'http';

class TaskAssigner {
  constructor() {
    this.baseUrl = 'localhost';
    this.port = 3003;
    this.token = null;
  }

  async makeRequest(path, method = 'GET', data = null) {
    return new Promise((resolve, reject) => {
      const postData = data ? JSON.stringify(data) : null;
      
      const options = {
        hostname: this.baseUrl,
        port: this.port,
        path: path,
        method: method,
        headers: {
          'Content-Type': 'application/json',
          ...(this.token && { 'Authorization': `Bearer ${this.token}` }),
          ...(postData && { 'Content-Length': Buffer.byteLength(postData) })
        }
      };

      const req = http.request(options, (res) => {
        let responseData = '';
        
        res.on('data', (chunk) => {
          responseData += chunk;
        });
        
        res.on('end', () => {
          try {
            const parsed = JSON.parse(responseData);
            resolve({ status: res.statusCode, data: parsed });
          } catch (error) {
            resolve({ status: res.statusCode, data: responseData });
          }
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      if (postData) {
        req.write(postData);
      }

      req.end();
    });
  }

  async authenticate() {
    console.log("[AUTH] Attempting to authenticate as admin...");
    
    try {
      const response = await this.makeRequest('/api/auth/login', 'POST', {
        username: 'admin',
        password: 'admin123456'
      });

      if (response.status === 200 && response.data.token) {
        this.token = response.data.token;
        console.log("[AUTH] ✅ Authentication successful");
        return true;
      } else {
        console.error("[AUTH] ❌ Authentication failed:", response.data);
        return false;
      }
    } catch (error) {
      console.error("[AUTH] ❌ Authentication error:", error.message);
      return false;
    }
  }

  async getTasks() {
    console.log("[QUERY] Fetching all tasks...");
    
    try {
      const response = await this.makeRequest('/api/tasks');
      
      if (response.status === 200 && response.data.tasks) {
        console.log(`[QUERY] Found ${response.data.tasks.length} total tasks`);
        return response.data.tasks;
      } else {
        console.error("[QUERY] ❌ Failed to fetch tasks:", response.data);
        return [];
      }
    } catch (error) {
      console.error("[QUERY] ❌ Error fetching tasks:", error.message);
      return [];
    }
  }

  async assignTaskToDevelopment(taskId) {
    console.log(`[ASSIGN] Assigning task ${taskId} to development profile...`);
    
    try {
      const response = await this.makeRequest(`/api/tasks/${taskId}/assign`, 'PUT', {
        assignedTo: 'development'
      });

      if (response.status === 200 && response.data.task) {
        console.log("[ASSIGN] ✅ Task assigned successfully:");
        console.log(`   ID: ${response.data.task.id}`);
        console.log(`   Title: ${response.data.task.title}`);
        console.log(`   Priority: ${response.data.task.priority}`);
        console.log(`   Status: ${response.data.task.status}`);
        console.log(`   Assigned to: ${response.data.task.assignedTo}`);
        return response.data.task;
      } else {
        console.error("[ASSIGN] ❌ Failed to assign task:", response.data);
        return null;
      }
    } catch (error) {
      console.error("[ASSIGN] ❌ Error assigning task:", error.message);
      return null;
    }
  }

  async run() {
    try {
      // Step 1: Authenticate
      const authenticated = await this.authenticate();
      if (!authenticated) {
        console.log("[ASSIGN] ❌ Cannot proceed without authentication");
        process.exit(1);
      }

      // Step 2: Get all tasks
      const tasks = await this.getTasks();
      if (tasks.length === 0) {
        console.log("[ASSIGN] ❌ No tasks found");
        process.exit(1);
      }

      // Step 3: Find highest priority unassigned task
      const priorityWeight = { high: 0, medium: 1, low: 2, invalid: 3 };
      const availableTasks = tasks
        .filter(task => task.status === 'todo' && !task.assignedTo)
        .sort((a, b) => {
          const weightA = priorityWeight[a.priority] || 999;
          const weightB = priorityWeight[b.priority] || 999;
          if (weightA !== weightB) {
            return weightA - weightB;
          }
          // If same priority, sort by creation date (newest first)
          return new Date(b.createdAt) - new Date(a.createdAt);
        });

      if (availableTasks.length === 0) {
        console.log("[ASSIGN] ❌ No available tasks to assign (all todo tasks are already assigned)");
        process.exit(0);
      }

      // Step 4: Assign the highest priority task
      const targetTask = availableTasks[0];
      console.log(`[ASSIGN] 🎯 Found highest priority available task:`);
      console.log(`   ID: ${targetTask.id}`);
      console.log(`   Title: ${targetTask.title}`);
      console.log(`   Priority: ${targetTask.priority}`);
      console.log(`   Status: ${targetTask.status}`);
      console.log(`   Created: ${targetTask.createdAt}`);
      if (targetTask.description) {
        console.log(`   Description: ${targetTask.description}`);
      }

      const assignedTask = await this.assignTaskToDevelopment(targetTask.id);
      
      if (assignedTask) {
        console.log("\n[ASSIGN] 🚀 Task successfully handed to development for implementation!");
        process.exit(0);
      } else {
        console.log("\n[ASSIGN] ❌ Failed to hand off task to development");
        process.exit(1);
      }

    } catch (error) {
      console.error("[ASSIGN] ❌ Unexpected error:", error.message);
      process.exit(1);
    }
  }
}

// Run the task assigner
const assigner = new TaskAssigner();
assigner.run();