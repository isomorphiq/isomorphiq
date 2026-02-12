#!/usr/bin/env node

/**
 * Assign specific high-priority Task 3 to development
 */

import { assignTaskToDevelopment } from "./src/index.ts";

async function main() {
  try {
    console.log("🎯 Assigning high-priority Task 3 to development...");
    
    // Use the first Task 3 ID from the query results
    const taskId = "task-1765516137864-6sgm4m3mv";
    
    const result = await assignTaskToDevelopment(taskId);
    
    if (result.success) {
      console.log("✅ Task 3 successfully assigned to development!");
      console.log("🚀 Development team can now start working on Task 3.");
      console.log(`📋 Task ID: ${result.taskId}`);
      console.log(`📝 Task Title: ${result.taskTitle}`);
    } else {
      console.error("❌ Failed to assign task:", result.error);
    }
  } catch (error) {
    console.error("💥 Error assigning task:", error);
    process.exit(1);
  }
}

main();