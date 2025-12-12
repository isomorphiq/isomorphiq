# Multi-User Support Documentation

## Overview

The Isomorphiq Task Manager now supports comprehensive multi-user functionality with role-based access control, user authentication, and task isolation. This document provides an overview of the multi-user features and how to use them.

## User Management

### User Roles

The system supports four user roles with different permission levels:

#### Admin
- Full system access
- User management (create, read, update, delete users)
- Task management (all operations on any task)
- Template and automation rule management
- System administration (logs, backup, restore)
- Analytics and reporting
- Settings management

#### Manager
- Team management capabilities
- Task management (create, read, update, delete)
- Can assign tasks to team members
- Template and automation rule management
- Analytics and reporting
- Limited user management (can update developers and viewers)

#### Developer
- Task creation and management
- Can update tasks they created or are assigned to
- Can delete only their own tasks
- Read-only access to templates and automation rules
- Basic analytics (own tasks only)
- Profile management

#### Viewer
- Read-only access to assigned tasks
- Read-only access to templates and automation rules
- Basic analytics (own tasks only)
- Profile management

### User Authentication

#### Login
```bash
curl -X POST http://localhost:3003/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "password": "AdminPass123!"
  }'
```

#### Token Management
- JWT access tokens (15-minute expiry)
- Refresh tokens (7-day expiry)
- Session management with device tracking
- Automatic session cleanup

#### Password Security
- Minimum 8 characters
- Requires uppercase, lowercase, numbers, and special characters
- Failed login attempt tracking
- Account lockout after 5 failed attempts (30 minutes)

## Task Management

### Task Ownership Model

Each task includes:
- `createdBy`: User who created the task
- `assignedTo`: User responsible for completing the task
- `collaborators`: Array of users who can contribute to the task
- `watchers`: Array of users who receive notifications about task changes

### Task Access Control

#### Read Access
- Task creator
- Assigned user
- Collaborators
- Watchers
- Admin users

#### Write Access
- Task creator
- Assigned user
- Admin users
- Manager users (for team tasks)

#### Delete Access
- Task creator
- Admin users

### Creating Tasks with User Assignment

```bash
curl -X POST http://localhost:3003/api/tasks \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "title": "Implement user authentication",
    "description": "Add JWT-based authentication to the API",
    "priority": "high",
    "assignedTo": "user-123",
    "collaborators": ["user-456", "user-789"],
    "watchers": ["user-123", "user-456"]
  }'
```

### User-Specific Task Filtering

Get tasks for a specific user:
```bash
curl -X GET "http://localhost:3003/api/users/user-123/tasks?include=created,assigned,collaborating" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## API Endpoints

### Authentication
- `POST /api/auth/login` - User login
- `POST /api/auth/logout` - User logout
- `POST /api/auth/refresh` - Refresh access token
- `GET /api/auth/me` - Get current user info
- `PUT /api/auth/profile` - Update user profile
- `PUT /api/auth/password` - Change password
- `GET /api/auth/sessions` - Get user sessions
- `DELETE /api/auth/sessions` - Invalidate all sessions
- `GET /api/auth/permissions` - Get user permissions

### User Management (Admin only)
- `GET /api/users` - List all users
- `POST /api/users` - Create new user
- `PUT /api/users/:id` - Update user
- `DELETE /api/users/:id` - Delete user

### Task Management
- `GET /api/tasks` - List tasks (filtered by user permissions)
- `POST /api/tasks` - Create task
- `GET /api/tasks/:id` - Get specific task
- `PUT /api/tasks/:id/status` - Update task status
- `PUT /api/tasks/:id/priority` - Update task priority
- `PUT /api/tasks/:id/assign` - Assign task to user
- `PUT /api/tasks/:id/collaborators` - Update task collaborators
- `PUT /api/tasks/:id/watchers` - Update task watchers
- `DELETE /api/tasks/:id` - Delete task

## Permission System

### Permission Structure

Permissions are defined by:
- **Resource**: The entity being accessed (e.g., 'tasks', 'users', 'system')
- **Action**: The operation being performed (e.g., 'create', 'read', 'update', 'delete')
- **Conditions**: Optional constraints (e.g., 'created_by_self', 'assigned_to_self')

### Permission Evaluation

The system evaluates permissions based on:
1. User role permissions
2. Custom permissions (if any)
3. Contextual conditions
4. Task ownership relationships

### Example Permissions

```json
{
  "resource": "tasks",
  "action": "update",
  "conditions": {
    "can_update_task": true
  }
}
```

This allows users to update tasks they created or are assigned to.

## WebSocket Events

The system broadcasts real-time events for task changes:

- `task_created` - New task created
- `task_updated` - Task modified
- `task_deleted` - Task removed
- `task_status_changed` - Task status updated
- `task_priority_changed` - Task priority updated
- `task_assigned` - Task assigned to user
- `task_collaborators_updated` - Task collaborators changed
- `task_watchers_updated` - Task watchers changed

## Security Features

### Session Management
- Device tracking and fingerprinting
- Automatic session expiration
- Session invalidation on password change
- Concurrent session limits

### Data Isolation
- Users can only access tasks they have permission for
- Role-based access control enforced at API level
- Task ownership respected in all operations

### Audit Trail
- All task operations include user context
- WebSocket events track who made changes
- Authentication events are logged

## Testing

Run the multi-user functionality test:

```bash
npm run build
node scripts/test-multi-user.ts
```

This test creates users with different roles, tests task creation and assignment, verifies permissions, and validates access control.

## Database Schema

### Users Collection
```typescript
interface User {
  id: string
  username: string
  email: string
  passwordHash: string
  role: UserRole
  isActive: boolean
  isEmailVerified: boolean
  profile: UserProfile
  preferences: UserPreferences
  createdAt: Date
  updatedAt: Date
  lastLoginAt?: Date
  passwordChangedAt?: Date
  failedLoginAttempts: number
  lockedUntil?: Date
}
```

### Sessions Collection
```typescript
interface Session {
  id: string
  userId: string
  token: string
  refreshToken: string
  deviceInfo?: DeviceInfo
  ipAddress?: string
  userAgent?: string
  createdAt: Date
  expiresAt: Date
  refreshExpiresAt: Date
  isActive: boolean
  lastAccessAt: Date
}
```

### Tasks Collection (Enhanced)
```typescript
interface Task {
  id: string
  title: string
  description: string
  status: TaskStatus
  priority: 'low' | 'medium' | 'high'
  dependencies: string[]
  createdBy: string
  assignedTo?: string
  collaborators?: string[]
  watchers?: string[]
  createdAt: Date
  updatedAt: Date
}
```

## Migration Notes

### Existing Single-User Systems
When upgrading from a single-user setup:
1. Existing tasks will be assigned to a default admin user
2. User accounts will need to be created
3. Task ownership may need to be reassigned

### Backward Compatibility
- All existing API endpoints remain functional
- Single-user mode still supported (no authentication required)
- Gradual migration path available

## Best Practices

### User Management
1. Create users with appropriate roles
2. Regularly review user permissions
3. Monitor session activity
4. Enforce strong password policies

### Task Organization
1. Assign tasks to specific users
2. Use collaborators for team projects
3. Add watchers for stakeholders
4. Regularly update task status

### Security
1. Use HTTPS in production
2. Implement proper token handling
3. Regular session cleanup
4. Monitor failed login attempts

## Troubleshooting

### Common Issues

#### Permission Denied
- Check user role and permissions
- Verify task ownership/assignment
- Ensure user is active

#### Authentication Failures
- Verify credentials
- Check account lockout status
- Ensure user is active

#### Task Access Issues
- Verify user is creator, assignee, collaborator, or watcher
- Check role-based permissions
- Review task ownership

### Debug Commands

```bash
# Check user permissions
curl -X GET http://localhost:3003/api/auth/permissions \
  -H "Authorization: Bearer YOUR_TOKEN"

# List user sessions
curl -X GET http://localhost:3003/api/auth/sessions \
  -H "Authorization: Bearer YOUR_TOKEN"

# Get task access info
curl -X GET http://localhost:3003/api/tasks/task-123 \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## Future Enhancements

### Planned Features
- Multi-tenant support
- Team-based permissions
- Granular permission controls
- OAuth integration
- Two-factor authentication
- Advanced audit logging
- User groups and roles

### Scalability Considerations
- Database indexing for user queries
- Caching for permission checks
- Load balancing for multi-instance deployments
- Session storage optimization
