#!/usr/bin/env node

import { ProductManager } from "@isomorphiq/profiles";

async function directHandoffToDevelopment() {
  console.log("🎯 Direct handoff: Finding highest priority task for development...");
  
  const productManager = new ProductManager();
  
  try {
    // Get all tasks
    const allTasks = await productManager.getAllTasks();
    
    // Filter for high priority todo tasks
    const highPriorityTodoTasks = allTasks.filter(task => 
      task.priority === 'high' && task.status === 'todo'
    );
    
    if (highPriorityTodoTasks.length === 0) {
      console.log("❌ No high priority todo tasks found");
      return;
    }
    
    // Get the first (highest priority) task
    const task = highPriorityTodoTasks[0];
    console.log(`✅ Found highest priority task: ${task.title} (ID: ${task.id})`);
    
    // Assign to development user
    const updateData = {
      assignedTo: 'development',
      status: 'in-progress',
      handoffTime: new Date().toISOString()
    };
    
    const updatedTask = await productManager.updateTask(task.id, updateData);
    console.log(`🎯 Task "${updatedTask.title}" successfully handed off to development!`);
    console.log(`📝 Task status: ${updatedTask.status}`);
    console.log(`👤 Assigned to: ${updatedTask.assignedTo}`);
    
  } catch (error) {
    console.error("❌ Error during handoff:", error.message);
  } finally {
    await productManager.close();
  }
}

directHandoffToDevelopment();