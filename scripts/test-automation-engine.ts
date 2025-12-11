#!/usr/bin/env node

// Simple test for automation rule engine functionality
import { AutomationRuleEngine } from '../src/automation-rule-engine.ts'
import type { Task, AutomationRule } from '../src/types.ts'

async function testAutomationEngine() {
  console.log('[TEST] Testing automation rule engine...')
  
  const engine = new AutomationRuleEngine()
  
  // Create test automation rules
  const testRules: AutomationRule[] = [
    {
      id: 'test-rule-1',
      name: 'Test High Priority Bug Assignment',
      trigger: {
        type: 'task_created',
        parameters: {}
      },
      conditions: [
        {
          field: 'task.title',
          operator: 'contains',
          value: 'Fix:'
        },
        {
          field: 'task.priority',
          operator: 'equals',
          value: 'high'
        }
      ],
      actions: [
        {
          type: 'assign_user',
          parameters: {
            assignedTo: 'senior-developer'
          }
        },
        {
          type: 'send_notification',
          parameters: {
            message: 'High priority bug "{{taskTitle}}" has been auto-assigned',
            recipient: 'team-lead'
          }
        }
      ],
      enabled: true,
      createdAt: new Date()
    },
    {
      id: 'test-rule-2',
      name: 'Test Feature Priority Setting',
      trigger: {
        type: 'task_created',
        parameters: {}
      },
      conditions: [
        {
          field: 'task.title',
          operator: 'contains',
          value: 'Feature:'
        }
      ],
      actions: [
        {
          type: 'set_priority',
          parameters: {
            priority: 'medium'
          }
        }
      ],
      enabled: true,
      createdAt: new Date()
    }
  ]
  
  // Load rules into engine
  engine.loadRules(testRules)
  
  // Test task 1: High priority bug (should trigger rule 1)
  const bugTask: Task = {
    id: 'test-bug-1',
    title: 'Fix: Critical login issue',
    description: 'Users cannot log in',
    status: 'todo',
    priority: 'high',
    dependencies: [],
    createdBy: 'test-user',
    createdAt: new Date(),
    updatedAt: new Date()
  }
  
  console.log('[TEST] Testing high priority bug task...')
  const bugResults = await engine.processTaskEvent('task_created', bugTask, [bugTask])
  console.log('[TEST] Bug task results:', bugResults.length, 'rules processed')
  bugResults.forEach(result => {
    console.log(`[TEST] - Rule "${result.ruleName}": ${result.success ? 'SUCCESS' : 'FAILED'}`)
    result.executedActions.forEach(action => {
      console.log(`[TEST]   * Action ${action.type}: ${action.success ? 'SUCCESS' : 'FAILED'}`)
      if (action.result) {
        console.log(`[TEST]     Result:`, action.result)
      }
      if (action.error) {
        console.log(`[TEST]     Error:`, action.error)
      }
    })
  })
  
  // Test task 2: Feature with low priority (should trigger rule 2)
  const featureTask: Task = {
    id: 'test-feature-1',
    title: 'Feature: Add dark mode',
    description: 'Implement dark mode',
    status: 'todo',
    priority: 'low',
    dependencies: [],
    createdBy: 'test-user',
    createdAt: new Date(),
    updatedAt: new Date()
  }
  
  console.log('[TEST] Testing feature task...')
  const featureResults = await engine.processTaskEvent('task_created', featureTask, [featureTask])
  console.log('[TEST] Feature task results:', featureResults.length, 'rules processed')
  featureResults.forEach(result => {
    console.log(`[TEST] - Rule "${result.ruleName}": ${result.success ? 'SUCCESS' : 'FAILED'}`)
    result.executedActions.forEach(action => {
      console.log(`[TEST]   * Action ${action.type}: ${action.success ? 'SUCCESS' : 'FAILED'}`)
      if (action.result) {
        console.log(`[TEST]     Result:`, action.result)
      }
      if (action.error) {
        console.log(`[TEST]     Error:`, action.error)
      }
    })
  })
  
  // Test task 3: Regular task (should not trigger any rules)
  const regularTask: Task = {
    id: 'test-regular-1',
    title: 'Regular maintenance task',
    description: 'Update dependencies',
    status: 'todo',
    priority: 'medium',
    dependencies: [],
    createdBy: 'test-user',
    createdAt: new Date(),
    updatedAt: new Date()
  }
  
  console.log('[TEST] Testing regular task...')
  const regularResults = await engine.processTaskEvent('task_created', regularTask, [regularTask])
  console.log('[TEST] Regular task results:', regularResults.length, 'rules processed')
  
  // Test status change
  console.log('[TEST] Testing status change event...')
  const statusResults = await engine.processTaskEvent('task_status_changed', {
    taskId: bugTask.id,
    oldStatus: 'todo',
    newStatus: 'done',
    task: bugTask
  }, [bugTask])
  console.log('[TEST] Status change results:', statusResults.length, 'rules processed')
  
  // Get rule statistics
  const stats = engine.getRuleStats()
  console.log('[TEST] Rule statistics:', stats)
  
  console.log('[TEST] Automation rule engine test completed successfully!')
}

// Run the test
testAutomationEngine().catch(console.error)