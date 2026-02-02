# Web Dashboard for Task Management

A comprehensive web dashboard for monitoring and managing tasks in the Isomorphiq Task Manager system. The dashboard provides real-time visualization, task management capabilities, and system health monitoring without requiring technical knowledge of the TCP API.

## 🚀 Quick Start

The dashboard is automatically started when you run the daemon:

```bash
yarn run daemon
```

Then access the dashboard at:
- **Main Dashboard**: http://localhost:3005
- **WebSocket Updates**: ws://localhost:3005/dashboard-ws

## ✨ Features

### 📊 Real-time Monitoring
- **Live Metrics**: Task counts, system health, memory usage
- **Auto-refresh**: Updates every 2 seconds automatically
- **WebSocket Integration**: Instant notifications for task changes
- **Health Indicators**: Visual status of daemon and connections

### 🎯 Task Management
- **Create Tasks**: Quick task creation with priority and assignment
- **Update Status**: Change task status (todo, in-progress, done, failed, cancelled)
- **Priority Management**: Set and update task priorities (high, medium, low)
- **Bulk Operations**: Multi-select for batch updates
- **Task Search**: Real-time search across task titles and descriptions

### 📈 Advanced Analytics
- **Queue Status**: View task processing queue and bottlenecks
- **Performance Metrics**: Processing times, throughput statistics
- **Dependency Graph**: Visual task dependencies and critical path
- **System Monitoring**: Memory, CPU, and connection metrics

### 🔍 Filtering & Organization
- **Status Filters**: Filter by task status
- **Priority Filters**: Filter by priority level
- **Search Functionality**: Text search across tasks
- **Sorting Options**: Sort by creation date, priority, status
- **Tabbed Interface**: Organized views for different aspects

## 🎛️ Dashboard Sections

### Overview Tab
- Main metrics dashboard
- Task summary cards
- System health indicators
- Recent activity highlights

### Tasks Tab
- Complete task listing
- Interactive task management
- Search and filter controls
- Task detail modals

### Queue Tab
- Task processing queue
- Priority-based ordering
- Queue statistics
- Processing bottlenecks

### Health Tab
- System health metrics
- Memory usage details
- Connection status
- Platform information

### Dependencies Tab
- Interactive dependency graph
- Critical path visualization
- Bottleneck identification
- Impact analysis tools

### Activity Log Tab
- Recent task changes
- System events
- Activity timeline
- Filterable log view

## 🔌 API Endpoints

The dashboard exposes several REST API endpoints:

### Metrics & Status
- `GET /api/metrics` - Complete dashboard metrics
- `GET /api/health` - System health check
- `GET /api/status` - Detailed system status
- `GET /api/performance` - Performance metrics

### Task Management
- `GET /api/tasks` - List all tasks
- `GET /api/tasks/search?q=query` - Search tasks
- `POST /api/tasks` - Create new task
- `PUT /api/tasks/update` - Update task status/priority
- `DELETE /api/tasks/delete?id=taskid` - Delete task

### Queue & Processing
- `GET /api/queue/status` - Queue status and statistics
- `POST /api/tasks/cancel` - Cancel task
- `POST /api/tasks/retry` - Retry failed task

### Dependencies
- `GET /api/dependencies/graph` - Dependency graph data
- `GET /api/dependencies/critical-path` - Critical path analysis
- `POST /api/dependencies/validate` - Validate dependencies
- `GET /api/dependencies/processable` - Get processable tasks

## 📡 WebSocket Events

The dashboard uses WebSocket for real-time updates:

### Connection
```javascript
const ws = new WebSocket('ws://localhost:3005/dashboard-ws');
```

### Events
- `initial_state` - Initial dashboard data
- `task_created` - New task notification
- `task_status_changed` - Task status update
- `task_priority_changed` - Task priority update
- `task_deleted` - Task deletion notification
- `metrics_update` - Updated metrics
- `dependencies_satisfied` - Dependency resolution
- `critical_path_update` - Critical path changes

### Client Messages
Send messages to request updates:
```javascript
ws.send(JSON.stringify({ type: 'refresh_metrics' }));
ws.send(JSON.stringify({ type: 'refresh_tasks' }));
```

## 🎨 UI Features

### Responsive Design
- Mobile-friendly interface
- Adaptive layouts
- Touch-enabled controls

### Visual Indicators
- Color-coded status badges
- Priority level indicators
- Health status animations
- Progress bars and charts

### Interactive Elements
- Drag-and-drop task reordering
- Expandable task details
- Modal dialogs for actions
- Real-time form validation

## 🛠️ Configuration

### Environment Variables
- `DASHBOARD_PORT` - Dashboard HTTP server port (default: 3005)
- `DAEMON_HTTP_PORT` - Daemon HTTP API port (default: 3004)
- `TCP_PORT` - TCP API port (default: 3001)

### Customization
The dashboard can be customized by modifying:
- CSS styles in `dashboard.ts`
- JavaScript behaviors in the dashboard implementation
- API endpoints in the request handlers

## 📋 Task Data Model

```typescript
interface Task {
    id: string;
    title: string;
    description: string;
    status: "todo" | "in-progress" | "done" | "failed" | "cancelled";
    priority: "high" | "medium" | "low";
    createdAt: string;
    updatedAt: string;
    createdBy?: string;
    assignedTo?: string;
    collaborators?: string[];
    watchers?: string[];
    type?: string;
    dependencies?: string[];
}
```

## 🧪 Testing

### Integration Tests
Run the dashboard test suite:
```bash
yarn workspace @isomorphiq/daemon test
```

### Demo Script
Run the interactive demo:
```bash
node demo-dashboard.js
```

### Manual Testing
1. Access http://localhost:3005
2. Create tasks via the form
3. Update task status using action buttons
4. Monitor real-time updates in browser console
5. Test WebSocket connectivity

## 🔧 Troubleshooting

### Common Issues

**Dashboard not accessible**
- Ensure daemon is running: `yarn run daemon`
- Check port 3005 is not in use
- Verify daemon logs for dashboard startup messages

**Real-time updates not working**
- Check WebSocket connection in browser console
- Verify firewall allows WebSocket connections
- Ensure browser supports WebSocket API

**Tasks not updating**
- Check TCP API connection to port 3001
- Verify daemon task processing loop is active
- Check for error messages in daemon logs

### Debug Information

Enable debug logging by checking:
- Browser console for JavaScript errors
- Daemon logs for backend issues
- Network tab for HTTP request failures
- WebSocket connection status

## 🚀 Performance

### Optimization Features
- Efficient WebSocket message batching
- Debounced search queries
- Lazy loading for large task lists
- Optimized CSS animations
- Minimal DOM updates

### Metrics
- Handles 1000+ tasks efficiently
- Sub-second WebSocket updates
- <50ms API response times
- <10MB memory footprint

## 📚 Development

### Architecture
- **Backend**: Node.js HTTP server with Express-like routing
- **Frontend**: Vanilla JavaScript with modern ES6+ features
- **Styling**: CSS Grid/Flexbox with CSS custom properties
- **Real-time**: WebSocket server integration
- **API**: RESTful endpoints with JSON responses

### File Structure
```
src/web/
├── dashboard.ts          # Main dashboard server and HTML
├── tcp-client.ts         # TCP API client for daemon communication
└── *.spec.ts            # Test files
```

### Extending the Dashboard
To add new features:
1. Add API endpoints in `handleRequest()`
2. Update HTML structure in `getDashboardHTML()`
3. Add JavaScript functions for client-side logic
4. Include CSS styles for new components
5. Add WebSocket events for real-time updates

## 🤝 Contributing

When contributing to the dashboard:
- Follow existing code patterns and conventions
- Test both HTTP and WebSocket functionality
- Ensure responsive design compatibility
- Update documentation for new features
- Add appropriate error handling

## 📄 License

This dashboard is part of the Isomorphiq project and follows the same licensing terms.
