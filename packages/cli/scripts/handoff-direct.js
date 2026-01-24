#!/usr/bin/env node

// Direct database update to handoff task
import fs from 'fs';

async function handoffTask(taskId) {
  try {
    console.log(`🚀 Handing off task ${taskId} to development...`);
    
    // Read the current database files
    
    // Find the task file
    const taskFiles = fs.readdirSync('./test-priority-db/tasks')
      .filter(file => file.includes(taskId));
    
    if (taskFiles.length === 0) {
      console.log('❌ Task not found in database');
      return;
    }
    
    const taskFile = taskFiles[0];
    const taskData = JSON.parse(fs.readFileSync(`./test-priority-db/tasks/${taskFile}`, 'utf8'));
    
    console.log(`📋 Found task: ${taskData.title}`);
    console.log(`🔥 Priority: ${taskData.priority}`);
    
    // Update task
    const updatedTask = {
      ...taskData,
      status: 'in-progress',
      assignedTo: 'development',
      handoffTime: new Date().toISOString(),
      notes: 'Handed off to development team for implementation',
      updatedAt: new Date().toISOString()
    };
    
    // Write back to database
    fs.writeFileSync(`./test-priority-db/tasks/${taskFile}`, JSON.stringify(updatedTask, null, 2));
    
    console.log('\n✅ Task successfully handed off to development!');
    console.log(`🚀 Task "${updatedTask.title}" is now in-progress`);
    console.log(`👥 Assigned to: development`);
    console.log(`⏰ Handoff time: ${new Date().toISOString()}`);
    console.log(`📋 Task ID: ${taskId}`);
    
  } catch (error) {
    console.error('❌ Error during handoff:', error.message);
  }
}

const taskId = process.argv[2] || 'task-1765349323358';
handoffTask(taskId);