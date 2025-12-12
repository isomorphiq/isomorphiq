#!/usr/bin/env node

import pkg from 'level';
const { Level } = pkg;

async function createAndAssignTask() {
  try {
    console.log('🔧 Creating highest priority task and assigning to development...');
    
    // Open task database
    const db = new Level('./db/tasks', { valueEncoding: 'json' });
    
    // Create a high priority task
    const taskId = `task-${Date.now()}-dev-handoff`;
    const task = {
      id: taskId,
      title: "Critical System Security Implementation",
      description: "Implement comprehensive security controls including authentication, authorization, data encryption, and audit logging to protect sensitive information and ensure compliance with security standards.",
      priority: "high",
      status: "in-progress",
      type: "task",
      assignedTo: "development",
      createdBy: "system",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      handoffTime: new Date().toISOString(),
      handoffNotes: "Task created and immediately handed to development for critical security implementation",
      dependencies: [],
      tags: ["security", "critical", "implementation"],
      estimatedHours: 40,
      dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 days from now
    };
    
    await db.put(taskId, task);
    
    console.log('\n✅ Highest priority task successfully created and assigned to development!');
    console.log(`🚀 Task: ${task.title}`);
    console.log(`📋 Task ID: ${task.id}`);
    console.log(`🔥 Priority: ${task.priority}`);
    console.log(`👥 Assigned to: ${task.assignedTo}`);
    console.log(`📊 Status: ${task.status}`);
    console.log(`⏰ Created: ${task.createdAt}`);
    console.log(`📝 Description: ${task.description}`);
    
    await db.close();
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

createAndAssignTask();