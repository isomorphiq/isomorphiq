# MCP Server Configuration for OpenCode ACP

This document shows how to configure the MCP (Model Context Protocol) server to work with OpenCode's ACP (Agent Client Protocol) interface.

## Overview

The MCP server provides task management tools that the OpenCode agent can use to:
- Create, read, update, and delete tasks
- Manage task priorities and status
- Track work progress and completion

## Configuration Options

### Option 1: MCP Server as Separate Process (Recommended)

Start the MCP server separately, then configure OpenCode to connect to it:

```bash
# Terminal 1: Start the MCP server
yarn run mcp-server

# Terminal 2: Configure OpenCode to use the MCP server
opencode config set mcp.servers.task-manager '{
  "command": "node",
  "args": ["packages/mcp/src/mcp-server.ts"],
  "env": {
    "NODE_ENV": "production"
  }
}'
```

### Option 2: Inline MCP Configuration in Session

Configure MCP servers directly in the ACP session (if supported):

```typescript
// In your ACP client code
const sessionResult = await connection.newSession({
  cwd: process.cwd(),
  mcpServers: [{
    name: "task-manager",
    command: "node",
    args: ["packages/mcp/src/mcp-server.ts"],
    env: {
      "NODE_ENV": "development",
      "LOG_LEVEL": "debug"
    }
  }]
})
```

## MCP Server Capabilities

The task management MCP server exposes these tools:

### `create_task`
Creates a new task with priority
```json
{
  "title": "Implement user authentication",
  "description": "Add JWT-based authentication system",
  "priority": "high"
}
```

### `list_tasks`
Lists all tasks in the database
```json
{}
```

### `get_task`
Retrieves a specific task by ID
```json
{
  "id": "task-1234567890"
}
```

### `update_task`
Updates task fields (including dependencies)
```json
{
  "id": "task-1234567890",
  "updates": {
    "dependencies": ["task-111", "task-222"],
    "priority": "medium"
  },
  "changedBy": "system"
}
```

### `update_task_status`
Updates task status
```json
{
  "id": "task-1234567890",
  "status": "completed"
}
```

### `update_task_priority`
Updates task priority
```json
{
  "id": "task-1234567890",
  "priority": "medium"
}
```

### `delete_task`
Deletes a task by ID
```json
{
  "id": "task-1234567890"
}
```

## Usage Examples

### Basic Task Management
```
Create a high-priority task to implement user authentication with JWT tokens and comprehensive error handling.
```

### Complex Multi-Step Work
```
Create a task breakdown for implementing a full e-commerce checkout system:
1. Design database schema for orders and payments
2. Implement payment processing with Stripe
3. Create checkout UI components
4. Add order confirmation and email notifications
5. Implement order history and tracking

Set appropriate priorities and dependencies for each task.
```

### Code Review and Updates
```
Review the authentication implementation I just created. Update the task status to completed if it meets requirements, or create follow-up tasks for any issues found.
```

## Configuration Files

### OpenCode Config (`~/.config/opencode/config.json`)
```json
{
  "mcp": {
    "servers": {
      "task-manager": {
        "command": "node",
        "args": ["/path/to/your/project/packages/mcp/src/mcp-server.ts"],
        "env": {
          "NODE_ENV": "production",
          "LOG_LEVEL": "info"
        }
      }
    }
  }
}
```

### Environment Variables
```bash
# For the MCP server
NODE_ENV=development
LOG_LEVEL=debug
DB_PATH=./db

# For OpenCode
OPENCODE_MCP_ENABLED=true
OPENCODE_LOG_LEVEL=debug
```

## Troubleshooting

### MCP Server Not Connecting
1. Ensure the MCP server is running: `yarn run mcp-server`
2. Check that the command path is correct
3. Verify environment variables are set properly
4. Check OpenCode logs for connection errors

### Tools Not Available
1. Confirm MCP server is responding to initialization
2. Check that the `list_tools` request succeeds
3. Verify tool schemas are valid JSON Schema
4. Ensure tool names don't conflict with built-in tools

### Database Issues
1. Check that LevelDB database exists: `ls -la db/`
2. Ensure proper permissions on database directory
3. Verify database isn't corrupted
4. Check logs for database operation errors

## Advanced Configuration

### Multiple MCP Servers
```json
{
  "mcp": {
    "servers": {
      "task-manager": {
        "command": "node",
        "args": ["packages/mcp/src/mcp-server.ts"]
      },
      "code-analysis": {
        "command": "python",
        "args": ["mcp_servers/code_analyzer.py"]
      },
      "documentation": {
        "command": "node",
        "args": ["mcp_servers/docs_generator.js"]
      }
    }
  }
}
```

### Custom Tool Schemas
Extend the MCP server with additional tools:

```typescript
// Add to mcp-server.ts
{
  name: 'analyze_codebase',
  description: 'Analyze codebase for patterns and issues',
  inputSchema: {
    type: 'object',
    properties: {
      analysis_type: {
        type: 'string',
        enum: ['complexity', 'dependencies', 'patterns', 'security']
      },
      target_directory: {
        type: 'string',
        default: '.'
      }
    }
  }
}
```

## Integration with Task Manager App

The MCP server integrates seamlessly with the main task manager application:

1. **Agent Creates Tasks**: Agent uses MCP tools to create structured tasks
2. **Progress Tracking**: Tasks are stored in LevelDB with full metadata
3. **Status Updates**: Agent can update task status as work progresses
4. **Priority Management**: Agent can adjust priorities based on dependencies
5. **Completion Tracking**: Tasks marked complete when work finishes

This creates a powerful feedback loop where the agent can manage its own work and track progress autonomously.
