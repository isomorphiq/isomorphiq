# Task Manager Web Dashboard

## Overview

The Task Manager Web Dashboard provides a comprehensive, real-time web interface for monitoring and managing tasks in the Isomorphiq task management system. The dashboard is fully implemented and accessible at `http://localhost:3005`.

## Features

### 🎯 Core Features

1. **Real-time Task Status Display**
   - Live task status updates with progress indicators
   - WebSocket-based real-time notifications
   - Visual status badges (todo, in-progress, done, failed, cancelled)
   - Priority indicators (high, medium, low)

2. **Task Creation and Management**
   - Interactive task creation form
   - Task editing and status updates
   - Priority assignment and changes
   - Task deletion and cancellation
   - Bulk operations support

3. **System Health Monitoring**
   - Daemon status and uptime
   - Memory usage tracking
   - WebSocket connection status
   - TCP connectivity monitoring
   - Performance metrics

4. **Task History and Filtering**
   - Advanced search functionality
   - Filter by status, priority, assignee
   - Sort by creation date, updates, priority
   - Activity log with recent changes

5. **Responsive Design**
   - Mobile-friendly interface
   - Adaptive layout for all screen sizes
   - Touch-enabled interactions
   - Print-friendly styles

## Architecture

### Server Components

- **DashboardServer** (`src/web/dashboard.ts`): Main HTTP and WebSocket server
- **DaemonTcpClient** (`src/web/tcp-client.ts`): TCP API client for daemon communication
- **DependencyGraphService**: Task dependency visualization

### API Endpoints

#### Task Management
- `GET /api/tasks` - List tasks with optional filtering
- `POST /api/tasks/create` - Create new task
- `PUT/PATCH /api/tasks/update` - Update task status or priority
- `DELETE /api/tasks/delete` - Delete task
- `POST /api/tasks/cancel` - Cancel task
- `POST /api/tasks/retry` - Retry failed task
- `GET /api/tasks/search` - Search tasks with filters

#### System Monitoring
- `GET /api/metrics` - System metrics and task statistics
- `GET /api/health` - Health status check
- `GET /api/status` - Detailed system status
- `GET /api/performance` - Performance metrics
- `GET /api/logs` - Activity log

#### Queue Management
- `GET /api/queue/status` - Queue status and statistics
- `GET /api/dependencies/graph` - Dependency graph visualization
- `GET /api/dependencies/critical-path` - Critical path analysis
- `GET /api/dependencies/validate` - Dependency validation

### WebSocket Events

#### Client to Server
- `refresh_metrics` - Request metrics update
- `refresh_tasks` - Request tasks refresh

#### Server to Client
- `initial_state` - Initial dashboard data
- `metrics_update` - Real-time metrics updates
- `tasks_update` - Task list updates
- `task_created` - New task notification
- `task_status_changed` - Task status changes
- `task_priority_changed` - Task priority changes
- `task_deleted` - Task deletion notifications

## Usage

### Accessing the Dashboard

1. **Start the daemon**: `yarn run daemon`
2. **Open dashboard**: Navigate to `http://localhost:3005`
3. **WebSocket endpoint**: `ws://localhost:3005/dashboard-ws`

### Tab Navigation

The dashboard is organized into six main tabs:

1. **Overview**: System metrics and statistics
2. **Queue Status**: Task queues and processing information
3. **Tasks**: Task list with filtering and search
4. **Create Task**: Task creation form
5. **Health**: System health monitoring
6. **Activity Log**: Recent system events

### Creating Tasks

1. Navigate to the **Create Task** tab
2. Fill in the required fields:
   - **Title**: Descriptive task name
   - **Description**: Detailed task information
   - **Priority**: High, Medium, or Low
   - **Assigned To**: Optional assignee
3. Click **Create Task**

### Managing Tasks

1. Navigate to the **Tasks** tab
2. Use filters to find specific tasks
3. Click on task actions:
   - **View Details**: Show task information
   - **Change Status**: Update task progress
   - **Update Priority**: Modify task priority
   - **Delete**: Remove task

### Monitoring System Health

1. **Health Tab**: System-wide health indicators
2. **Overview Tab**: Real-time metrics
3. **Queue Status**: Task processing statistics

## Real-time Updates

The dashboard provides real-time updates through WebSocket connections:

- **Metrics**: Updated every 2 seconds
- **Task Status**: Instant notifications on changes
- **System Events**: Real-time event broadcasting

## API Integration

### JavaScript Client Example

```javascript
// Fetch tasks
const response = await fetch('/api/tasks');
const tasks = await response.json();

// Create task
const newTask = await fetch('/api/tasks/create', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    title: 'New Task',
    description: 'Task description',
    priority: 'high'
  })
});

// WebSocket connection
const ws = new WebSocket('ws://localhost:3005/dashboard-ws');
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('Real-time update:', data);
};
```

### TCP Client Integration

```typescript
import { DaemonTcpClient } from './src/web/tcp-client.ts';

const client = new DaemonTcpClient();

// Create task via TCP
const result = await client.createTask({
  title: 'TCP Task',
  description: 'Created via TCP API',
  priority: 'medium'
});

// Subscribe to real-time updates
await client.subscribeToRealTimeUpdates(['task-id']);
```

## Configuration

### Environment Variables

- `DASHBOARD_PORT`: Dashboard server port (default: 3005)
- `TCP_PORT`: Daemon TCP port (default: 3001)
- `HTTP_PORT`: Main HTTP server port (default: 3004)

### Customization

The dashboard can be customized by modifying:

- **HTML Template**: `getDashboardHTML()` method in `DashboardServer`
- **Styling**: CSS rules in the dashboard HTML
- **API Endpoints**: Request handlers in `handleRequest()` method

## Testing

### Unit Tests

```bash
yarn test src/web/dashboard*.spec.ts
```

### Integration Tests

```bash
yarn test src/web/tcp-client*.spec.ts
```

### Manual Testing

1. **Load Testing**: Access dashboard at `http://localhost:3005`
2. **API Testing**: Use curl or API clients
3. **WebSocket Testing**: Connect to `ws://localhost:3005/dashboard-ws`

## Troubleshooting

### Common Issues

1. **Dashboard not accessible**:
   - Check if daemon is running
   - Verify port 3005 is not blocked
   - Check daemon logs for errors

2. **Real-time updates not working**:
   - Verify WebSocket connection
   - Check browser console for errors
   - Ensure firewall allows WebSocket connections

3. **Task creation fails**:
   - Check TCP connection to daemon
   - Verify required fields
   - Check daemon logs

### Health Checks

```bash
# Check dashboard server
curl http://localhost:3005/api/health

# Check TCP connection
curl http://localhost:3005/api/status

# Check WebSocket
curl -i -N -H "Connection: Upgrade" \
     -H "Upgrade: websocket" \
     -H "Sec-WebSocket-Key: test" \
     -H "Sec-WebSocket-Version: 13" \
     http://localhost:3005/dashboard-ws
```

## Performance Considerations

- **Memory Usage**: Dashboard maintains task cache for fast responses
- **WebSocket Limits**: Concurrent connections limited by system resources
- **Metrics Updates**: Configurable update intervals (default: 2 seconds)
- **Database Queries**: Optimized filtering and pagination

## Security

- **No Authentication**: Currently no built-in authentication
- **Network Access**: Accessible on localhost by default
- **Data Validation**: Input validation on all endpoints
- **Rate Limiting**: Not implemented (add if needed)

## Future Enhancements

Potential improvements for the dashboard:

1. **Authentication & Authorization**: User management and access control
2. **Enhanced UI**: More interactive elements and visualizations
3. **Analytics**: Advanced analytics and reporting
4. **Mobile App**: Native mobile application
5. **Integration**: Third-party service integrations
6. **Notifications**: Email/SMS notifications for task events

## Support

For issues and questions:

1. Check daemon logs: `daemon.log` in project root
2. Verify system requirements: Node.js, TypeScript
3. Test API endpoints individually
4. Check network connectivity and firewall settings

---

*Last Updated: January 28, 2026*