# Authentication System Documentation

## Overview

The task manager includes a comprehensive authentication and authorization system with the following features:

- **User Management**: Complete user lifecycle management with roles and profiles
- **Secure Authentication**: JWT-based authentication with refresh tokens
- **Role-Based Access Control (RBAC)**: Granular permissions with context-based evaluation
- **Security Features**: Password policies, account lockout, session management
- **Password Reset**: Secure password reset flow with email tokens
- **Email Verification**: Email verification system for new users

## User Schema

### Enhanced User Model

The user schema has been expanded to include comprehensive profile and preference management:

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

### User Profile

```typescript
interface UserProfile {
  firstName?: string
  lastName?: string
  avatar?: string
  bio?: string
  timezone?: string
  language?: string
}
```

### User Preferences

```typescript
interface UserPreferences {
  theme: 'light' | 'dark' | 'auto'
  notifications: {
    email: boolean
    push: boolean
    taskAssigned: boolean
    taskCompleted: boolean
    taskOverdue: boolean
  }
  dashboard: {
    defaultView: 'list' | 'kanban' | 'calendar'
    itemsPerPage: number
    showCompleted: boolean
  }
}
```

## Authentication System

### JWT-Based Authentication

The system uses JSON Web Tokens (JWT) for authentication with the following features:

- **Access Tokens**: Short-lived (15 minutes) tokens for API access
- **Refresh Tokens**: Long-lived (7 days) tokens for token renewal
- **Secure Hashing**: bcrypt with salt rounds for password storage
- **Device Tracking**: Automatic device detection and session tracking

### Password Security

- **Minimum Length**: 8 characters
- **Complexity Requirements**: Uppercase, lowercase, numbers, special characters
- **Password History**: Prevents reuse of recent passwords
- **Account Lockout**: Temporary lock after failed attempts

### Session Management

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

## Role-Based Access Control (RBAC)

### User Roles

1. **Admin**: Full system access
2. **Manager**: Team and task management
3. **Developer**: Task creation and management
4. **Viewer**: Read-only access

### Permission Matrix

| Resource | Admin | Manager | Developer | Viewer |
|----------|--------|---------|-----------|--------|
| users | create, read, update, delete, manage_sessions | read, update | - | - |
| tasks | create, read, update, delete, assign_any, view_all | create, read, update, delete, assign_team, view_all | create, read, update, delete, assign_self | read |
| templates | create, read, update, delete | create, read, update, delete | read | read |
| automation | create, read, update, delete, execute | read, update, execute | read | read |
| system | manage, view_logs, backup, restore | - | - | - |
| analytics | read | read | read (own tasks only) | read (own tasks only) |
| reports | create, read, export | create, read, export | - | - |
| settings | read, update | read | - | - |
| profile | read, update | read, update | read, update | read, update |

### Conditional Permissions

Permissions can include conditions for fine-grained control:

- `assigned_to_self`: Only for tasks assigned to the user
- `created_by_self`: Only for tasks created by the user
- `own_tasks_only`: Only for user's own tasks
- `team_member`: Only for team members
- `role`: Specific role requirements

## API Endpoints

### Authentication Endpoints

#### POST /api/auth/login
Authenticate user and receive tokens.

**Request:**
```json
{
  "username": "string",
  "password": "string"
}
```

**Response:**
```json
{
  "success": true,
  "user": { /* User object without passwordHash */ },
  "token": "jwt_access_token",
  "refreshToken": "jwt_refresh_token",
  "expiresIn": 900
}
```

#### POST /api/auth/refresh
Refresh access token using refresh token.

**Request:**
```json
{
  "refreshToken": "jwt_refresh_token"
}
```

**Response:**
```json
{
  "success": true,
  "token": "new_jwt_access_token",
  "refreshToken": "new_jwt_refresh_token",
  "expiresIn": 900
}
```

#### POST /api/auth/logout
Invalidate current session.

**Headers:** `Authorization: Bearer <token>`

#### GET /api/auth/me
Get current user information.

**Headers:** `Authorization: Bearer <token>`

**Response:**
```json
{
  "user": { /* User object without passwordHash */ }
}
```

### Profile Management

#### PUT /api/auth/profile
Update user profile and preferences.

**Headers:** `Authorization: Bearer <token>`

**Request:**
```json
{
  "profile": {
    "firstName": "John",
    "lastName": "Doe",
    "bio": "Software Developer"
  },
  "preferences": {
    "theme": "dark",
    "dashboard": {
      "defaultView": "kanban",
      "itemsPerPage": 25
    }
  }
}
```

#### PUT /api/auth/password
Change user password.

**Headers:** `Authorization: Bearer <token>`

**Request:**
```json
{
  "currentPassword": "old_password",
  "newPassword": "new_secure_password"
}
```

### Session Management

#### GET /api/auth/sessions
Get all active sessions for the current user.

**Headers:** `Authorization: Bearer <token>`

**Response:**
```json
{
  "sessions": [
    {
      "id": "session_id",
      "deviceInfo": {
        "type": "desktop",
        "os": "Windows",
        "browser": "Chrome"
      },
      "createdAt": "2023-01-01T00:00:00.000Z",
      "lastAccessAt": "2023-01-01T12:00:00.000Z"
    }
  ]
}
```

#### DELETE /api/auth/sessions
Invalidate all user sessions.

**Headers:** `Authorization: Bearer <token>`

#### GET /api/auth/permissions
Get user permissions and permission matrix.

**Headers:** `Authorization: Bearer <token>`

**Response:**
```json
{
  "userPermissions": {
    "userId": "user_id",
    "role": "developer",
    "permissions": [/* Permission array */],
    "customPermissions": []
  },
  "permissionMatrix": { /* Full permission matrix */ },
  "availableResources": ["users", "tasks", "templates", /* ... */]
}
```

## Security Features

### Password Security
- bcrypt hashing with 12 salt rounds
- Minimum 8-character length
- Complexity requirements (uppercase, lowercase, numbers, special chars)
- Password history tracking
- Secure password reset flow

### Token Security
- RS256 signing algorithm
- 15-minute access token expiration
- 7-day refresh token expiration
- Token blacklisting on logout
- Automatic token refresh

### Session Security
- Device fingerprinting
- IP address tracking
- Concurrent session limits
- Automatic session cleanup
- Session invalidation on password change

### Account Security
- Account lockout after 5 failed attempts
- 30-minute lockout duration
- Email verification requirements
- Activity monitoring
- Suspicious login detection

## Implementation Details

### Services

1. **AuthService**: JWT token management, password hashing, device detection
2. **PermissionService**: Role-based access control, permission evaluation
3. **UserManager**: User CRUD operations, session management, authentication

### Database Schema

- **Users Collection**: Enhanced user profiles and preferences
- **Sessions Collection**: Active session tracking with device info
- **Custom Permissions**: User-specific permission overrides

### Middleware

- **Authentication Middleware**: Token validation and user attachment
- **Authorization Middleware**: Permission checking with context
- **Session Middleware**: Session tracking and cleanup

## Testing

### Test Coverage

1. **User Creation**: Enhanced schema validation
2. **Authentication**: JWT token generation and validation
3. **Password Security**: Strength validation and hashing
4. **Role Permissions**: Matrix validation and evaluation
5. **Profile Management**: CRUD operations
6. **Session Management**: Multi-device support
7. **Token Refresh**: Automatic renewal
8. **Device Detection**: Accurate fingerprinting

### Running Tests

```bash
# Run authentication system tests
yarn run build && node dist/scripts/test-auth-system.js

# Run API endpoint tests
yarn run build && node dist/scripts/test-auth-api.js
```

## Best Practices

### For Developers

1. **Always validate tokens** using the authentication middleware
2. **Check permissions** before performing actions
3. **Use context** for conditional permissions
4. **Handle token refresh** automatically in clients
5. **Implement proper logout** to invalidate sessions

### For Users

1. **Use strong passwords** with complexity requirements
2. **Enable 2FA** when available (future feature)
3. **Monitor active sessions** regularly
4. **Log out from unused devices**
5. **Update passwords** periodically

### For Administrators

1. **Review user permissions** regularly
2. **Monitor failed login attempts**
3. **Implement account lockout policies**
4. **Backup user data** regularly
5. **Keep software updated**

## Migration Guide

### From Simple Authentication

1. **Update user schema** with new fields
2. **Migrate existing passwords** to bcrypt
3. **Implement JWT tokens** replacing simple tokens
4. **Add role-based permissions** to existing endpoints
5. **Update client applications** to handle token refresh

### Database Migration

```sql
-- Add new user fields
ALTER TABLE users ADD COLUMN isEmailVerified BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN profile JSON DEFAULT '{}';
ALTER TABLE users ADD COLUMN preferences JSON DEFAULT '{}';
ALTER TABLE users ADD COLUMN passwordChangedAt TIMESTAMP;
ALTER TABLE users ADD COLUMN failedLoginAttempts INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN lockedUntil TIMESTAMP;

-- Update sessions table
ALTER TABLE sessions ADD COLUMN refreshToken VARCHAR(255);
ALTER TABLE sessions ADD COLUMN deviceInfo JSON;
ALTER TABLE sessions ADD COLUMN ipAddress VARCHAR(45);
ALTER TABLE sessions ADD COLUMN userAgent TEXT;
ALTER TABLE sessions ADD COLUMN refreshExpiresAt TIMESTAMP;
ALTER TABLE sessions ADD COLUMN lastAccessAt TIMESTAMP;
```

## Future Enhancements

1. **Two-Factor Authentication (2FA)**
2. **Social Login Integration**
3. **Single Sign-On (SSO)**
4. **Advanced Threat Detection**
5. **Compliance Reporting**
6. **Audit Logging**
7. **Permission Templates**
8. **Dynamic Role Assignment**

## Support

For questions or issues related to the authentication system:

1. Check the test files for usage examples
2. Review the API documentation
3. Examine the permission matrix
4. Contact the development team for assistance

---

*This documentation covers the authentication and authorization system as of the current implementation. Features and endpoints may evolve over time.*