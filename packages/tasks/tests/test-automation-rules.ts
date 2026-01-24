#!/usr/bin/env node

// Test script for automation rule engine
import { ProductManager } from "@isomorphiq/tasks";

async function testAutomationRules() {
  console.log('[TEST] Starting automation rule engine test...')
  
  const pm = new ProductManager()
  
  try {
    // Initialize templates and automation rules
    await pm.initializeTemplates()
    console.log('[TEST] Templates and automation rules initialized')
    
    // Create a test task that should trigger automation rules
    console.log('[TEST] Creating high priority bug task...')
    const bugTask = await pm.createTask(
      'Fix: Critical login issue',
      'Users cannot log in with valid credentials',
      'high',
      [],
      'test-user'
    )
    
    console.log('[TEST] Created task:', bugTask.id, bugTask.title)
    
    // Wait a moment for automation to process
    await new Promise(resolve => setTimeout(resolve, 1000))
    
    // Create a feature task to test priority setting
    console.log('[TEST] Creating feature task...')
    const featureTask = await pm.createTask(
      'Feature: Add dark mode',
      'Implement dark mode for the application',
      'low', // This should be auto-set to medium
      [],
      'test-user'
    )
    
    console.log('[TEST] Created feature task:', featureTask.id, featureTask.priority)
    
    // Complete a development task to test follow-up task creation
    console.log('[TEST] Creating and completing development task...')
    const devTask = await pm.createTask(
      'Task: Implement user authentication',
      'Add login and registration functionality',
      'medium',
      [],
      'test-user'
    )
    
    // Mark task as done
    await pm.updateTaskStatus(devTask.id, 'done')
    console.log('[TEST] Marked task as done:', devTask.id)
    
    // Wait for automation to process
    await new Promise(resolve => setTimeout(resolve, 2000))
    
    // List all tasks to see what was created
    const allTasks = await pm.getAllTasks()
    console.log(`[TEST] Total tasks in system: ${allTasks.length}`)
    
    allTasks.forEach(task => {
      console.log(`[TEST] - ${task.id}: ${task.title} (${task.status}, ${task.priority})`)
    })
    
    console.log('[TEST] Automation rule engine test completed')
    
  } catch (error) {
    console.error('[TEST] Test failed:', error)
    process.exit(1)
  }
}

// Run the test
testAutomationRules().catch(console.error)
