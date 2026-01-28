# Task Manager Dashboard

A comprehensive web-based dashboard for monitoring and managing tasks in real-time through an intuitive user interface.

## Overview

The Task Manager Dashboard provides a modern, responsive web interface for the Isomorphiq task management system. It connects to the existing TCP API on port 3001 and provides real-time updates via WebSocket connections.

## Features

### 🎯 Core Dashboard Functionality

- **Real-time Task Monitoring**: Live updates of task status, queue depth, and system health
- **Task Management**: Create, update, delete tasks with priority and status management
- **Advanced Search & Filtering**: Filter tasks by status, priority, assignee, with text search
- **Multi-tab Interface**: Organized views for Overview, Queue, Tasks, Create, Health, and Logs
- **Responsive Design**: Works seamlessly on desktop, tablet, and mobile devices

### 📊 Metrics & Monitoring

- **System Metrics**: CPU usage, memory consumption, daemon uptime
- **Task Statistics**: Total tasks, pending/in-progress/completed counts
- **Queue Analytics**: Processing times, failed tasks, priority distribution
- **Health Indicators**: Real-time system health status with visual indicators
- **Performance Tracking**: Average processing times, fastest/slowest tasks

### 🔄 Real-time Features

- **WebSocket Integration**: Live updates without page refresh
- **Event Broadcasting**: Task creation, status changes, priority updates, deletions
- **Connection Management**: Support for multiple simultaneous dashboard connections
- **Automatic Reconnection**: Resilient WebSocket connections with auto-retry

### 🎨 User Interface

- **Modern Design**: Clean, professional interface with gradient backgrounds
- **Interactive Elements**: Hover effects, smooth transitions, loading states
- **Task Cards**: Detailed task information with action buttons
- **Modal Dialogs**: Task details and editing in elegant popups
- **Status Indicators**: Color-coded status and priority badges

## API Endpoints

### Task Management

| Method | Endpoint | Description |
|---------|-----------|-------------|
| `GET` | `/api/tasks` | List all tasks with optional filtering |
| `POST` | `/api/tasks` | Create a new task |
| `PUT` | `/api/tasks/update` | Update task status or priority |
| `DELETE` | `/api/tasks/delete` | Delete a task |
| `GET` | `/api/tasks/search` | Search tasks by text query |
| `POST` | `/api/tasks/filtered` | Advanced task filtering |
| `GET` | `/api/tasks/status/:id` | Get specific task status |

### Queue & System Status

| Method | Endpoint | Description |
|---------|-----------|-------------|
| `GET` | `/api/metrics` | System and task metrics |
| `GET` | `/api/queue/status` | Detailed queue information |
| `GET` | `/api/health` | System health check |
| `GET` | `/api/performance` | Performance metrics |
| `GET` | `/api/status` | System status information |
| `GET` | `/api/logs` | Activity logs |

### Notifications & Real-time

| Method | Endpoint | Description |
|---------|-----------|-------------|
| `POST` | `/api/notifications/subscribe` | Subscribe to task notifications |
| `WebSocket` | `/dashboard-ws` | Real-time updates connection |

## Request/Response Formats

### Task Object

```json
{
  "id": "task-1234567890",
  "title": "Example Task Title",
  "description": "Detailed task description",
  "status": "todo" | "in-progress" | "done" | "failed" | "cancelled",
  "priority": "high" | "medium" | "low",
  "type": "task",
  "createdBy": "username",
  "assignedTo": "assignee",
  "collaborators": ["user1", "user2"],
  "watchers": ["user3"],
  "dependencies": ["task-123"],
  "createdAt": "2026-01-25T02:23:38.677Z",
  "updatedAt": "2026-01-25T02:23:38.677Z"
}
```

### Create Task Request

```json
{
  "title": "New Task Title",
  "description": "Task description",
  "priority": "medium",
  "assignedTo": "username",
  "createdBy": "creator",
  "collaborators": ["user1"],
  "watchers": ["user2"],
  "type": "task"
}
```

### Update Task Request

```json
{
  "id": "task-1234567890",
  "status": "done",
  "priority": "high"
}
```

### Filter Request

```json
{
  "filters": {
    "status": ["todo", "in-progress"],
    "priority": "high",
    "createdBy": "username",
    "assignedTo": "assignee",
    "type": "task",
    "search": "search term",
    "limit": 10,
    "offset": 0
  }
}
```

### Metrics Response

```json
{
  "daemon": {
    "uptime": 9199.622838,
    "memory": {
      "rss": 159916032,
      "heapTotal": 57487360,
      "heapUsed": 47851784,
      "external": 11128171
    },
    "pid": 2055265
  },
  "tasks": {
    "total": 22,
    "pending": 0,
    "inProgress": 1,
    "completed": 21,
    "byPriority": {
      "high": 20,
      "medium": 2,
      "low": 0
    },
    "byStatus": {
      "todo": 0,
      "in-progress": 1,
      "done": 21
    },
    "recent": [...]
  },
  "health": {
    "status": "healthy" | "unhealthy" | "degraded",
    "lastUpdate": "2026-01-25T02:25:46.834Z",
    "wsConnections": 0,
    "tcpConnected": true,
    "memoryUsage": 83
  },
  "system": {
    "nodeVersion": "v22.21.1",
    "platform": "linux",
    "arch": "x64",
    "totalmem": 134641299456,
    "freemem": 101899722752
  }
}
```

## WebSocket Events

### Connection

```javascript
const ws = new WebSocket('ws://localhost:3005/dashboard-ws');

ws.onopen = function() {
  console.log('Connected to dashboard real-time updates');
};
```

### Message Types

#### Initial State
```json
{
  "type": "initial_state",
  "data": {
    "metrics": { /* metrics object */ },
    "tasks": [ /* task array */ ]
  }
}
```

#### Task Created
```json
{
  "type": "task_created",
  "data": {
    /* full task object */
  }
}
```

#### Task Status Changed
```json
{
  "type": "task_status_changed",
  "data": {
    "taskId": "task-123",
    "oldStatus": "todo",
    "newStatus": "in-progress",
    "task": { /* full task object */ }
  }
}
```

#### Task Priority Changed
```json
{
  "type": "task_priority_changed",
  "data": {
    "taskId": "task-123",
    "oldPriority": "medium",
    "newPriority": "high",
    "task": { /* full task object */ }
  }
}
```

#### Task Deleted
```json
{
  "type": "task_deleted",
  "data": {
    "taskId": "task-123"
  }
}
```

#### Metrics Update
```json
{
  "type": "metrics_update",
  "data": {
    /* metrics object */
  }
}
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DASHBOARD_PORT` | 3005 | Dashboard HTTP server port |
| `DAEMON_HTTP_PORT` | 3004 | Daemon HTTP API port |
| `TCP_PORT` | 3001 | TCP API port |

### Package Dependencies

```json
{
  "dependencies": {
    "@isomorphiq/realtime": "workspace:*",
    "@isomorphiq/tasks": "workspace:*",
    "ws": "^8.14.2"
  }
}
```

## Usage

### Starting the Dashboard

The dashboard is automatically started when running the daemon:

```bash
yarn run daemon
```

Dashboard will be available at: `http://localhost:3005`

### Accessing Features

1. **Overview Tab**: System metrics and task statistics
2. **Queue Tab**: Detailed queue status and failed tasks
3. **Tasks Tab**: Search, filter, and manage individual tasks
4. **Create Tab**: Form to create new tasks
5. **Health Tab**: System health and performance metrics
6. **Logs Tab**: Activity and change logs

### Real-time Updates

The dashboard automatically establishes a WebSocket connection for live updates. No manual configuration required - updates appear instantly as tasks change.

## Security Considerations

- **Input Validation**: All inputs are sanitized and validated
- **XSS Protection**: Task content is safely rendered
- **SQL Injection Prevention**: Parameterized queries for filtering
- **Path Traversal Protection**: File access is restricted
- **Rate Limiting**: Built-in protection against rapid requests

## Performance Features

- **Connection Pooling**: Efficient database connection management
- **Caching**: Metrics caching for rapid response
- **Lazy Loading**: Large task lists loaded incrementally
- **Compression**: Response compression for faster transfers
- **Debounced Search**: Reduced API calls during typing

## Browser Support

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## Mobile Responsiveness

- **Responsive Grid**: Adapts to screen size
- **Touch Actions**: Optimized for mobile interactions
- **Readable Text**: Scales appropriately on all devices
- **Fast Interactions**: Optimized JavaScript performance

## Testing

### Unit Tests
- Edge cases and error handling
- Input validation and sanitization
- Component functionality
- WebSocket message handling

### Integration Tests
- End-to-end user workflows
- TCP API connectivity
- Real-time updates verification
- Performance and load testing

### Test Files

- `src/web/dashboard-integration.spec.ts` - Core functionality
- `src/web/dashboard-edge-cases.spec.ts` - Edge cases and errors
- `src/web/dashboard-realtime.spec.ts` - WebSocket functionality
- `src/web/dashboard-tcp-integration.spec.ts` - TCP API integration

## Troubleshooting

### Common Issues

1. **Dashboard Not Loading**
   - Check if daemon is running: `yarn run daemon`
   - Verify port 3005 is available
   - Check browser console for errors

2. **Real-time Updates Not Working**
   - Verify WebSocket connection in browser console
   - Check firewall settings
   - Ensure WebSocket port is accessible

3. **Tasks Not Appearing**
   - Check TCP API connection on port 3001
   - Verify database permissions
   - Check daemon logs for errors

### Debug Mode

Enable debug logging by setting environment variable:

```bash
DEBUG=dashboard yarn run daemon
```

## Architecture

### Components

- **DashboardServer**: Main HTTP and WebSocket server
- **DaemonTcpClient**: TCP API integration
- **WebSocketManager**: Real-time communication
- **TaskMonitor**: Task state monitoring
- **ProductManager**: Core task management logic

### Data Flow

1. Client makes HTTP request to dashboard server
2. Dashboard server queries TCP API for task data
3. Updates are broadcast via WebSocket to connected clients
4. UI updates automatically reflect changes

## Contributing

### Development Setup

```bash
cd packages/daemon
yarn install
yarn start
```

### Adding New Features

1. Update `src/web/dashboard.ts` for server logic
2. Modify HTML/JS in `getDashboardHTML()` method
3. Add tests in appropriate test files
4. Update documentation

### Code Style

- TypeScript with strict typing
- Functional programming patterns
- No mutation of data structures
- 4-space indentation
- Double quotes for strings

## Implementation Summary

The web dashboard for task management has been successfully implemented with the following key accomplishments:

### ✅ Completed Features

1. **Full Web Dashboard Interface**
   - Modern, responsive HTML/CSS/JavaScript interface
   - Multi-tab layout (Overview, Queue, Tasks, Create, Health, Logs)
   - Real-time metrics and system monitoring
   - Professional gradient design with smooth animations

2. **Complete API Integration**
   - Full TCP API connectivity via DaemonTcpClient
   - RESTful HTTP endpoints for all task operations
   - Advanced filtering and search capabilities
   - Queue status and performance metrics

3. **Real-time WebSocket Functionality**
   - Live updates without page refresh
   - Event broadcasting for task changes
   - Automatic reconnection handling
   - Support for multiple simultaneous connections

4. **Comprehensive Testing Suite**
   - Unit tests for dashboard components
   - Integration tests for TCP API connectivity
   - Edge case and error handling tests
   - Real-time WebSocket functionality tests

5. **Security & Performance**
   - Input validation and sanitization
   - XSS and SQL injection protection
   - Efficient connection pooling
   - Debounced search and lazy loading

### 📊 Current Status

- **Dashboard Server**: Running on port 3005
- **WebSocket Endpoint**: `/dashboard-ws` for real-time updates
- **TCP API Integration**: Fully connected to port 3001
- **Test Coverage**: Comprehensive test suite implemented
- **Documentation**: Complete API and usage documentation

### 🚀 Usage

```bash
# Start the daemon (includes dashboard)
yarn run daemon

# Access the dashboard
http://localhost:3005
```

The dashboard provides a complete visual interface for task management, replacing the need for TCP API-only interactions while maintaining full compatibility with existing systems.

## License

This dashboard is part of the Isomorphiq project and follows the same licensing terms.
