# Complete OpenCode + MCP Integration Setup

## 🎯 **Overview**

This project demonstrates a complete integration between:
- **OpenCode ACP Client** - Communicates with OpenCode agents via stdio
- **MCP Server** - Provides task management tools to agents
- **LevelDB Storage** - Persistent task storage with priority management
- **Comprehensive Logging** - Real-time visibility into agent activities

## 🚀 **Quick Start**

### 1. Setup
```bash
# Install dependencies
yarn install

# Build the project
yarn run build
```

### 2. Start MCP Server
```bash
# Terminal 1: Start MCP server
yarn run start-mcp
```

### 3. Configure OpenCode
```bash
# Terminal 2: Configure MCP integration
opencode config set mcp.servers.task-manager '{
  "command": "node",
  "args": ["packages/mcp/src/mcp-server.ts"],
  "env": {}
}'
```

### 4. Test Integration
```bash
# Test MCP server functionality
yarn run test-mcp

# Run with agent integration
opencode run "Create a high-priority task to implement user authentication"
```

## 📁 **Project Structure**

```
├── src/
│   ├── index.ts          # Main ACP client & task manager
│   └── mcp-server.ts     # MCP server with task management tools
├── tests/
│   ├── start-mcp-server.js    # MCP server launcher
│   └── test-mcp-server.js     # MCP server test script
├── prompts/              # Agent work prompts by category
├── mcp-config.md         # Detailed MCP configuration guide
├── opencode-mcp-setup.md # Step-by-step setup instructions
└── config/
    └── mcp-server-config.json # MCP server configuration
```

## 🛠️ **Available Scripts**

```bash
yarn run build        # Compile TypeScript
yarn run mcp-server   # Run MCP server directly
yarn run start-mcp    # Start MCP server with instructions
yarn run test-mcp     # Test MCP server functionality
```

## 🔧 **MCP Tools**

The MCP server exposes these tools to OpenCode agents:

| Tool | Description | Parameters |
|------|-------------|------------|
| `create_task` | Create new task | title, description, priority |
| `list_tasks` | List all tasks | - |
| `get_task` | Get task by ID | id |
| `update_task_status` | Update status | id, status |
| `update_task_priority` | Update priority | id, priority |
| `delete_task` | Delete task | id |

## 📋 **Task Management Features**

- **Priority Levels**: low, medium, high
- **Status Tracking**: todo, in-progress, done
- **Persistent Storage**: LevelDB backend
- **Agent Integration**: Agents can create/manage tasks autonomously
- **Real-time Updates**: Live task status monitoring

## 🎭 **Agent Modes**

| Mode | Use Case | Example |
|------|----------|---------|
| `architect` | Planning & design | System architecture, API design |
| `build` | Implementation | Feature development, bug fixes |
| `ask` | Analysis & docs | Code review, documentation |

## 📖 **Usage Examples**

### Basic Task Creation
```
opencode run "Create a high-priority task to implement JWT authentication"
```

### Complex Project Planning
```
opencode run --mode architect \
  "Design a complete e-commerce system and create a task breakdown for implementation"
```

### Code Implementation
```
opencode run --mode build \
  "Implement the user authentication system we planned, including registration, login, and password reset"
```

### Testing & Quality
```
opencode run --mode build \
  "Write comprehensive unit tests for the authentication service we just implemented"
```

## 🔍 **Monitoring Agent Activity**

The system provides detailed logging:

```
[ACP] Running opencode command: Create a task...
[ACP] STDERR: INFO service=bus type=tool.executed tool=create_task
[APP] Task created successfully: task-1234567890
[ACP] STDERR: DEBUG service=mcp-server task_created id=task-1234567890
```

## 🐛 **Troubleshooting**

### MCP Server Issues
```bash
# Test MCP server directly
yarn run test-mcp

# Check server logs
yarn run start-mcp
```

### OpenCode Connection Issues
```bash
# Verify OpenCode installation
opencode --version

# Check MCP configuration
opencode config get mcp.servers
```

### Database Issues
```bash
# Check database directory
ls -la db/

# Reset database if corrupted
rm -rf db/
```

## 🎉 **Success Indicators**

When everything is working correctly, you should see:

1. ✅ MCP server starts without errors
2. ✅ OpenCode can execute MCP tools
3. ✅ Tasks are created and stored in LevelDB
4. ✅ Agent can manage its own work via MCP tools
5. ✅ Real-time logging shows agent activities
6. ✅ Task priorities and status updates work

## 🚀 **Advanced Usage**

### Custom MCP Tools
Extend `packages/mcp/src/mcp-server.ts` to add more tools:
- Code analysis tools
- Documentation generators
- Testing utilities
- Deployment helpers

### Multiple MCP Servers
Configure multiple MCP servers for different domains:
- Task management
- Code analysis
- Documentation
- Testing tools

### Integration Patterns
- **Agent-Driven Development**: Agents create and manage their own tasks
- **Feedback Loops**: Task completion triggers next steps
- **Quality Gates**: Automated testing and review tasks
- **Documentation**: Auto-generated docs from implementation

This setup creates a powerful autonomous development environment where AI agents can plan, implement, test, and document software projects with full task management capabilities! 🎊
