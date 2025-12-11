# Automation Rule Engine Documentation

## Overview

The automation rule engine allows you to create powerful automation workflows that respond to task events in the system. It uses a trigger-condition-action model to automatically execute actions when specific conditions are met.

## Architecture

### Components

1. **AutomationRuleEngine** (`src/automation-rule-engine.ts`) - Core engine that processes events and executes rules
2. **TemplateManager** - Stores and manages automation rules in the database
3. **ProductManager** - Integrates automation into task lifecycle events

### Event Flow

1. Task events occur (create, update, status change, etc.)
2. ProductManager captures events and forwards them to AutomationRuleEngine
3. Engine evaluates rules matching the trigger type
4. If conditions are met, executes the defined actions
5. Actions can create tasks, update tasks, send notifications, etc.

## Rule Structure

### Trigger Types

- `task_created` - When a new task is created
- `task_status_changed` - When task status changes
- `task_completed` - When a task is marked as done
- `scheduled` - For time-based triggers (future feature)
- `manual` - For manually triggered rules

### Conditions

Conditions filter when rules should execute:

```typescript
{
  field: "task.title",           // Field to check
  operator: "contains",          // Comparison operator
  value: "Fix:"                  // Value to compare against
}
```

#### Available Operators

- `equals` - Exact match
- `not_equals` - Not equal to
- `contains` - Contains substring (case-insensitive)
- `not_contains` - Does not contain substring
- `greater_than` - Numeric greater than
- `less_than` - Numeric less than

#### Available Fields

- `task.title` - Task title
- `task.description` - Task description
- `task.status` - Task status
- `task.priority` - Task priority
- `task.createdBy` - Task creator
- `task.assignedTo` - Assigned user
- `oldStatus` - Previous status (for status changes)
- `newStatus` - New status (for status changes)
- `oldPriority` - Previous priority (for priority changes)
- `newPriority` - New priority (for priority changes)

### Actions

Actions define what happens when conditions are met:

#### create_task
Creates a new task with variable substitution:
```typescript
{
  type: "create_task",
  parameters: {
    title: "Test: {{taskTitle}}",
    description: "Test completed task: {{taskTitle}}",
    priority: "medium",
    dependencies: ["{{taskId}}"]
  }
}
```

#### update_task
Updates an existing task:
```typescript
{
  type: "update_task",
  parameters: {
    taskId: "{{taskId}}",
    status: "done",
    title: "Updated: {{taskTitle}}"
  }
}
```

#### send_notification
Sends a notification (currently logged to console):
```typescript
{
  type: "send_notification",
  parameters: {
    message: "Task {{taskTitle}} was completed",
    recipient: "team-lead"
  }
}
```

#### set_priority
Changes task priority:
```typescript
{
  type: "set_priority",
  parameters: {
    taskId: "{{taskId}}",
    priority: "high"
  }
}
```

#### assign_user
Assigns task to a user:
```typescript
{
  type: "assign_user",
  parameters: {
    taskId: "{{taskId}}",
    assignedTo: "senior-developer"
  }
}
```

## Variable Substitution

Actions support variable substitution using `{{variableName}}` syntax:

- `{{taskId}}` - ID of the triggering task
- `{{taskTitle}}` - Title of the triggering task
- `{{taskDescription}}` - Description of the triggering task
- `{{taskStatus}}` - Status of the triggering task
- `{{taskPriority}}` - Priority of the triggering task
- `{{oldStatus}}` - Previous status (for status changes)
- `{{newStatus}}` - New status (for status changes)
- `{{createdBy}}` - Creator of the triggering task
- `{{assignedTo}}` - Assigned user of the triggering task

## API Usage

### Creating Rules

```typescript
const templateManager = pm.getTemplateManager()
const rule = await templateManager.createAutomationRule({
  name: "Auto-assign High Priority Bugs",
  trigger: { type: "task_created" },
  conditions: [
    { field: "task.title", operator: "contains", value: "Fix:" },
    { field: "task.priority", operator: "equals", value: "high" }
  ],
  actions: [
    { type: "assign_user", parameters: { assignedTo: "senior-developer" } }
  ],
  enabled: true
})
```

### Managing Rules

```typescript
// List all rules
const rules = await templateManager.getAllAutomationRules()

// Update a rule
const updated = await templateManager.updateAutomationRule(ruleId, {
  enabled: false
})

// Delete a rule
await templateManager.deleteAutomationRule(ruleId)

// Reload rules in engine
await pm.loadAutomationRules()
```

## Predefined Rules

The system includes several predefined automation rules:

1. **Auto-assign High Priority Bugs** - Assigns high-priority bug tasks to senior developers
2. **Create Testing Task on Development Complete** - Creates testing tasks when development tasks are completed
3. **Set Priority for Feature Tasks** - Automatically sets medium priority for feature tasks
4. **Escalate Long-running Tasks** - Notifies about tasks stuck in progress (disabled by default)

## Testing

Run the automation engine test:

```bash
npm run test-automation-engine
```

This tests the core engine functionality without requiring a running daemon.

## TCP API Commands

The daemon supports automation rule management via TCP API:

- `create_automation_rule` - Create a new rule
- `list_automation_rules` - List all rules
- `update_automation_rule` - Update an existing rule
- `delete_automation_rule` - Delete a rule
- `reload_automation_rules` - Reload rules into the engine

## Best Practices

1. **Start Simple** - Begin with basic rules and gradually add complexity
2. **Test Thoroughly** - Use the test engine to verify rule logic
3. **Use Descriptive Names** - Make rule names clear and specific
4. **Consider Performance** - Rules are evaluated on every event, keep conditions efficient
5. **Monitor Logs** - Watch automation logs to ensure rules behave as expected
6. **Disable When Not Needed** - Disable rules instead of deleting them temporarily

## Example Use Cases

### Bug Triage
```typescript
{
  name: "Bug Triage Automation",
  trigger: { type: "task_created" },
  conditions: [
    { field: "task.title", operator: "contains", value: "Fix:" },
    { field: "task.priority", operator: "equals", value: "high" }
  ],
  actions: [
    { type: "assign_user", parameters: { assignedTo: "senior-developer" } },
    { type: "send_notification", parameters: { 
      message: "High priority bug {{taskTitle}} assigned to senior-developer",
      recipient: "team-lead"
    }}
  ]
}
```

### Testing Workflow
```typescript
{
  name: "Create Testing Tasks",
  trigger: { type: "task_status_changed" },
  conditions: [
    { field: "newStatus", operator: "equals", value: "done" },
    { field: "task.title", operator: "contains", value: "Task:" }
  ],
  actions: [
    { type: "create_task", parameters: {
      title: "Test: {{taskTitle}}",
      description: "Test completed task: {{taskTitle}}",
      priority: "medium"
    }}
  ]
}
```

### Feature Prioritization
```typescript
{
  name: "Feature Priority Setting",
  trigger: { type: "task_created" },
  conditions: [
    { field: "task.title", operator: "contains", value: "Feature:" }
  ],
  actions: [
    { type: "set_priority", parameters: { priority: "medium" } }
  ]
}
```