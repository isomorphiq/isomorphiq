# Isomorphiq Task Manager

A TypeScript application that uses LevelDB to track task progress and delegates to an opencode ACP server via stdio.

## Features

- Uses LevelDB for persistent task storage
- Implements Product Manager class with CRUD operations
- Communicates with opencode ACP server for task execution
- Tracks task status: todo → in-progress → done

## Architecture

The application follows this workflow:
1. Create tasks with title and description
2. For each task, spawn opencode ACP server process and communicate via stdio
3. Send command in ACP format to execute the task prompt
4. Update task status based on execution result

## Requirements

- opencode CLI installed and available in PATH
- Node.js 24+ (uses native TypeScript type stripping)

## Usage

```bash
# Install dependencies
yarn install

# Build the application
yarn run build

# Run the application
yarn start
```

## Implementation Details

The implementation demonstrates how to:
1. Spawn opencode ACP server process and communicate via stdio
2. Send commands in the proper ACP protocol format
3. Handle responses from the server
4. Integrate with LevelDB for task persistence

Note: The current implementation spawns the opencode process for each command. Ensure opencode CLI is properly installed and configured.

## MCP Server Integration

The application includes an MCP (Model Context Protocol) server that allows Isomorphiq agents to directly manage tasks. The MCP server exposes tools for creating, reading, updating, and prioritizing tasks stored in LevelDB via the tasks microservice.

Note: MCP task and context operations currently talk directly to the tasks/context microservices (tRPC) to avoid daemon-held LevelDB locks. The long-term plan is to route these operations through the gateway once it exposes orchestration endpoints (see TODO in `packages/mcp/src/mcp-server.ts`).

### Starting the MCP Server
```bash
# Build the project first
yarn run build

# Start MCP server with helpful output
yarn run start-mcp
```

### Configuring OpenCode to Use MCP
```bash
# Option 1: Global configuration
opencode config set mcp.servers.task-manager '{
  "command": "node",
  "args": ["packages/mcp/src/mcp-server.ts"],
  "env": {}
}'

# Option 2: Inline configuration
opencode run --mcp-server '{"name": "task-manager", "command": "node", "args": ["packages/mcp/src/mcp-server.ts"]}' "Your prompt here"
```

### MCP Tools Available
- `create_task` - Create new tasks with priority levels
- `list_tasks` - List all tasks in the database
- `get_task` - Retrieve specific tasks by ID
- `update_task_status` - Update task status (todo/in-progress/done)
- `update_task_priority` - Change task priority (low/medium/high)
- `delete_task` - Remove tasks from the database

See `mcp-config.md` and `opencode-mcp-setup.md` for detailed configuration instructions.

## 🚀 Launch Status: READY FOR PRODUCTION

The Isomorphiq Task Manager MCP app is now **launch-ready** with full MCP server functionality and automated task processing.

### ✅ Launch Checklist Completed
- [x] MCP server with task + context tools
- [x] Daemon task processing with realistic simulation
- [x] Comprehensive error handling and detection
- [x] End-to-end integration testing
- [x] Production-ready documentation

### Quick Start

1. **Install dependencies:**
   ```bash
   yarn install
   ```

2. **Start the MCP server:**
   ```bash
   yarn run start-mcp
   ```

3. **Start the task daemon:**
   ```bash
   yarn run supervisor
   ```
   This starts the daemon and the tasks microservice together.

4. **Test MCP tools:**
   ```bash
   yarn run test-mcp
   ```

### MCP Tools Available

| Tool | Description | Status |
|------|-------------|--------|
| `create_task` | Create new tasks with priority | ✅ Working |
| `list_tasks` | List all tasks in database | ✅ Working |
| `get_task` | Retrieve specific tasks | ✅ Working |
| `update_task_status` | Update task status | ✅ Working |
| `update_task_priority` | Change task priority | ✅ Working |
| `delete_task` | Remove tasks | ✅ Working |
| `create_context` | Create a workflow context record | ✅ Working |
| `get_context` | Retrieve a context record | ✅ Working |
| `update_context` | Merge updates into context data | ✅ Working |
| `replace_context` | Replace full context data | ✅ Working |
| `delete_context` | Remove a context record | ✅ Working |
| `list_contexts` | List context records | ✅ Working |
| `check_daemon_status` | Check daemon health | ✅ Working |
| `start_daemon` | Start daemon if stopped | ✅ Working |
| `restart_daemon` | Gracefully restart daemon | ✅ Working |

### Architecture

- **MCP Server**: Provides tools for task management to OpenCode agents
- **Gateway**: Orchestrates cross-service requests and proxies `/trpc` to the tasks microservice
- **Tasks Microservice**: Owns task-only logic, holds the LevelDB lock, and exposes the tRPC API
- **Context Microservice**: Owns workflow context storage, holds the LevelDB lock, and exposes the tRPC API
- **Task Daemon**: Processes tasks in background with realistic simulation (non-task orchestration stays in gateway)
- **LevelDB Storage**: Persistent task storage with priority management
- **TCP Communication**: Reliable inter-process communication

### Production Deployment

```bash
# Build for production
yarn run build

# Start services
yarn run start-mcp &
yarn run supervisor &
yarn run gateway &

# Monitor logs
tail -f mcp-server.log daemon.log
```

## 📚 API Documentation

### MCP Tool Specifications

#### create_task
Creates a new task with specified parameters.

**Parameters:**
- `title` (string, required): Task title
- `description` (string, required): Detailed task description
- `priority` (string, optional): "low", "medium", "high" (default: "medium")

**Response:** Task object with ID, status, timestamps

#### list_tasks
Retrieves all tasks from the database.

**Parameters:** None

**Response:** Array of task objects

#### get_task
Retrieves a specific task by ID.

**Parameters:**
- `id` (string, required): Task ID

**Response:** Task object or null if not found

#### update_task_status
Updates the status of an existing task.

**Parameters:**
- `id` (string, required): Task ID
- `status` (string, required): "todo", "in-progress", "done"

**Response:** Updated task object

#### update_task_priority
Changes the priority of a task.

**Parameters:**
- `id` (string, required): Task ID
- `priority` (string, required): "low", "medium", "high"

**Response:** Updated task object

#### delete_task
Removes a task from the database.

**Parameters:**
- `id` (string, required): Task ID to delete

**Response:** Success confirmation

#### check_daemon_status
Checks if the task daemon is running and accessible.

**Parameters:** None

**Response:** Daemon status information

#### start_daemon
Starts the task daemon if it's not running.

**Parameters:** None

**Response:** Startup confirmation

#### restart_daemon
Gracefully restarts the task daemon.

**Parameters:** None

**Response:** Restart confirmation

### Task Processing

The daemon automatically processes tasks with realistic simulation:

- **Testing tasks**: Generate test results with coverage metrics
- **Documentation tasks**: Create documentation artifacts
- **Bug fixes**: Simulate debugging and fixing process
- **Features**: Implement new functionality
- **Refactoring**: Code structure improvements

### Error Handling

Tasks are automatically retried if they fail. The system detects errors through:
- Output analysis for error keywords
- Exception detection in task descriptions
- Success indicator validation

### Monitoring

Monitor system health through logs:
```bash
# MCP server logs
tail -f mcp-server.log

# Daemon processing logs
tail -f daemon.log

# Database status
ls -la db/
```

## Available Prompts

The `./prompts/` directory contains various prompt templates for different types of work:

- **Architecture & Planning** - System design, API design, database schemas
- **Implementation & Development** - Feature development, component creation, integrations
- **Testing & Quality** - Unit tests, integration tests, security testing
- **Refactoring & Maintenance** - Code cleanup, performance optimization, debt reduction
- **Documentation & Knowledge** - API docs, user guides, technical specifications
- **Examples** - Ready-to-use prompts for common development tasks

See `./prompts/README.md` for detailed usage instructions and mode recommendations.
