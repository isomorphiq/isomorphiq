#!/usr/bin/env node

import { ProductManager } from "./src/index.ts";

async function main() {
  try {
    console.log("🎯 Finding and assigning highest priority task to development...");
    
    const productManager = new ProductManager();
    
    // Get all tasks and find the highest priority todo task
    const allTasks = await productManager.getAllTasks();
    const todoTasks = allTasks.filter(task => task.status === 'todo');
    
    if (todoTasks.length === 0) {
      console.log("❌ No todo tasks found to assign");
      return;
    }
    
    // Sort by priority (high first) then by creation date
    const priorityOrder = { high: 3, medium: 2, low: 1 };
    const sortedTasks = todoTasks.sort((a, b) => {
      const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    
    const highestPriorityTask = sortedTasks[0];
    
    console.log(`📋 Found highest priority task: "${highestPriorityTask.title}" (${highestPriorityTask.priority})`);
    
    // Assign to development
    const assignedTask = await productManager.assignTask(
      highestPriorityTask.id,
      "development",
      "task-manager"
    );
    
    console.log("✅ Task successfully assigned to development!");
    console.log(`🆔 Task ID: ${assignedTask.id}`);
    console.log(`📝 Title: ${assignedTask.title}`);
    console.log(`🔥 Priority: ${assignedTask.priority}`);
    console.log(`👤 Assigned to: ${assignedTask.assignedTo}`);
    console.log(`⏰ Updated at: ${assignedTask.updatedAt.toISOString()}`);
    console.log("🚀 Development team can now start working on this task.");
    
  } catch (error) {
    console.error("💥 Error assigning task:", error);
    process.exit(1);
  }
}

main();