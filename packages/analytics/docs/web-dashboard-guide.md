# Web Dashboard Documentation

## Overview

The Task Manager Web Dashboard provides a real-time interface for monitoring and managing tasks through a React-based frontend. It connects to the backend API via tRPC with WebSocket subscriptions for live updates.

## Architecture

- **Frontend**: React 18 with TypeScript, built with Rsbuild
- **State Management**: Jotai with tRPC integration
- **Real-time Communication**: WebSocket subscriptions via tRPC
- **Styling**: Inline styles with CSS Grid/Flexbox
- **API Communication**: tRPC client with WebSocket links

## Setup Instructions

### Prerequisites

- Node.js 14+ with TypeScript support
- Task Manager daemon running on port 3003
- All project dependencies installed

### Installation

1. **Install dependencies:**
   ```bash
   yarn install
   ```

2. **Start the backend services:**
   ```bash
   # Start the task daemon (required)
   yarn run daemon
   
   # Start the HTTP API server (required)
   yarn run http-api
   ```

3. **Start the development server:**
   ```bash
   yarn run web:dev
   ```

4. **Access the dashboard:**
   - Development: http://localhost:4173
   - Production: http://localhost:3003 (when served by daemon)

### Production Build

```bash
# Build for production
yarn run web:build

# The built files will be in ./dist/
# The daemon automatically serves these files when running
```

## Configuration

### Development Configuration

The development server is configured in `rsbuild.config.ts`:

- **Port**: 4173 (configurable via `RSBUILD_PORT` environment variable)
- **Proxy**: Routes API calls to backend on port 3003
- **Hot Reload**: Enabled for development

### Environment Variables

- `RSBUILD_PORT`: Development server port (default: 4173)
- `HTTP_PORT`: Backend API port (default: 3003)

## Usage Guide

### Dashboard Interface

The dashboard consists of two main sections:

#### 1. All Tasks Panel
- **Location**: Left side of the dashboard
- **Content**: Complete list of all tasks in the system
- **Features**:
  - Task count display
  - Color-coded priority indicators
  - Status badges (todo, in-progress, done)
  - Real-time updates

#### 2. Next Up Panel
- **Location**: Right side of the dashboard
- **Content**: Prioritized queue of tasks pending execution
- **Features**:
  - Queue count display
  - Priority-ordered task list
  - Live updates when tasks are processed

### Real-time Features

The dashboard automatically updates when:
- New tasks are created
- Task status changes
- Task priority is modified
- Tasks are completed or deleted
- Queue order changes

### Task Status Indicators

- **Todo**: Gray background, pending execution
- **In Progress**: Blue background, currently being processed
- **Done**: Green background, completed successfully

### Priority Levels

- **High**: Red indicator - highest priority
- **Medium**: Yellow indicator - normal priority
- **Low**: Green indicator - lowest priority

## API Endpoints

### REST API Endpoints

#### Authentication
- `POST /api/auth/login` - User login
- `POST /api/auth/logout` - User logout
- `GET /api/auth/me` - Get current user info

#### Task Management
- `GET /api/tasks` - List all tasks
- `GET /api/tasks/:id` - Get specific task
- `POST /api/tasks` - Create new task
- `PUT /api/tasks/:id/status` - Update task status
- `PUT /api/tasks/:id/priority` - Update task priority
- `DELETE /api/tasks/:id` - Delete task
- `GET /api/tasks/status/:status` - Get tasks by status
- `GET /api/tasks/priority/:priority` - Get tasks by priority

#### Queue and Analytics
- `GET /api/queue` - Get prioritized task queue
- `GET /api/health` - Health check
- `GET /api/stats` - Task statistics
- `GET /api/analytics` - Advanced analytics

#### User Management (Admin only)
- `GET /api/users` - List all users
- `POST /api/users` - Create new user
- `PUT /api/users/:id` - Update user
- `DELETE /api/users/:id` - Delete user

### tRPC Endpoints

#### Queries
- `tasks` - Get all tasks
- `queue` - Get prioritized task queue
- `searchTasks` - Search and filter tasks

#### Subscriptions
- `taskUpdates` - Real-time task updates via WebSocket

## Component Structure

### Core Components

#### App.tsx
Main application component that:
- Initializes tRPC subscriptions
- Manages real-time updates
- Renders the layout and sections

#### Layout Components
- `Layout.tsx` - Main layout wrapper
- `SectionCard.tsx` - Reusable card component for sections
- `Header.tsx` - Dashboard header with title and subtitle

#### Task Components
- `TaskCard.tsx` - Individual task display component
- `PriorityBadge.tsx` - Priority level indicator
- `Band.tsx` - Legend for priority levels

#### State Management
- `atoms.ts` - Jotai atoms for state management
- `trpc.ts` - tRPC client configuration

### Data Flow

1. **Initial Load**: Tasks and queue data fetched via tRPC queries
2. **Real-time Updates**: WebSocket subscriptions push updates
3. **State Updates**: Jotai atoms manage component state
4. **UI Re-render**: Components update automatically on state changes

## Development Guide

### Adding New Features

1. **Create Component**: Add new component in `packages/appshell/src/components/`
2. **Update State**: Add new atoms in `packages/appshell/src/atoms.ts` if needed
3. **API Integration**: Add tRPC procedures in `src/http-api-server.ts`
4. **Styling**: Use inline styles or create CSS modules

### Testing

```bash
# Test the API endpoints
yarn run test-rest-api

# Test the MCP server integration
yarn run test-mcp

# Test WebSocket connections
yarn run ws-client
```

### Debugging

- **Browser DevTools**: Use React DevTools for component debugging
- **Network Tab**: Monitor WebSocket connections and API calls
- **Console Logs**: Check for tRPC subscription events
- **Backend Logs**: Monitor daemon and HTTP API server logs

## Deployment

### Development Deployment

```bash
# Start all services
yarn run daemon &      # Background task processing
yarn run http-api &    # REST API server
yarn run web:dev       # Development frontend
```

### Production Deployment

```bash
# Build frontend
yarn run web:build

# Start production services
yarn run daemon &      # Serves static files from ./dist/
yarn run http-api &
```

The daemon automatically serves the built frontend from the `./public/` directory when running in production mode.

## Troubleshooting

### Common Issues

#### Dashboard Not Loading
- Check if the daemon is running on port 3003
- Verify the HTTP API server is started
- Check browser console for JavaScript errors

#### Real-time Updates Not Working
- Verify WebSocket connection in browser network tab
- Check if tRPC subscription is active
- Ensure backend services are running

#### API Errors
- Check HTTP API server logs
- Verify database connection
- Check task manager daemon status

### Health Checks

```bash
# Check API health
curl http://localhost:3003/api/health

# Check daemon status
curl http://localhost:3003/api/stats

# Test WebSocket connection
yarn run ws-client
```

## Performance Considerations

- **WebSocket Subscriptions**: Efficient real-time updates without polling
- **Component Optimization**: React.memo for expensive components
- **State Management**: Jotai provides efficient state updates
- **Build Optimization**: Rsbuild optimizes production builds

## Security Notes

- API endpoints include authentication and authorization
- WebSocket connections use same-origin policy
- User management with role-based permissions
- Input validation on all API endpoints

## Future Enhancements

Potential improvements for the web dashboard:

- **Task Creation UI**: Form-based task creation
- **Advanced Filtering**: Date ranges, status filters
- **User Management**: Admin interface for user management
- **Analytics Dashboard**: Charts and graphs for task metrics
- **Mobile Responsiveness**: Responsive design for mobile devices
- **Theme Support**: Dark/light mode toggle
- **Export Features**: CSV/PDF export of task data