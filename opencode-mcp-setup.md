# OpenCode MCP Configuration Example

## Step-by-Step Setup

### 1. Build the Project
```bash
npm run build
```

### 2. Start MCP Server (Terminal 1)
```bash
npm run start-mcp
```
This will start the MCP server and show connection instructions.

### 3. Configure OpenCode (Terminal 2)
```bash
# Option A: Set global MCP server configuration
opencode config set mcp.servers.task-manager '{
  "command": "node",
  "args": ["src/mcp-server.ts"],
  "env": {
    "NODE_ENV": "development"
  }
}'

# Option B: Use inline configuration
opencode run --mcp-server '{"name": "task-manager", "command": "node", "args": ["src/mcp-server.ts"]}' "Your prompt here"
```

### 4. Test the Integration
```bash
opencode run "Create a high-priority task to implement user authentication"
```

The agent should now be able to use MCP tools to manage tasks.

## Expected Output

When working correctly, you should see logs like:
```
[ACP] STDERR: INFO service=bus type=tool.executed tool=create_task
[ACP] STDERR: DEBUG service=mcp-server task_created id=task-1234567890
```

## Troubleshooting

### MCP Server Not Starting
```bash
# Check if the build succeeded
ls -la src/mcp-server.ts

# Try running directly
node src/mcp-server.ts
```

### OpenCode Not Connecting
```bash
# Check OpenCode version
opencode --version

# Verify MCP support
opencode config get mcp.enabled
```

### Tools Not Available
```bash
# Check MCP server logs for initialization errors
# Ensure the MCP server is responding to tool listing requests
```

## Complete Example Session

```bash
# Terminal 1: Start MCP server
npm run start-mcp

# Terminal 2: Run OpenCode with task management
opencode run --mode build \
  "Create a comprehensive task breakdown for implementing a user management system with authentication, profiles, and permissions. Use the MCP task management tools to organize this work."
```

The agent will:
1. Use MCP tools to create structured tasks
2. Break down the work into manageable pieces
3. Set appropriate priorities and dependencies
4. Track progress as implementation proceeds