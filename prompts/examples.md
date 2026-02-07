# Example Prompts for Common Tasks

## Web Application Feature
```
Implement a user dashboard for our TypeScript/React application using atomic, focused components:

Component Structure (one component per file):
- UserProfileCard - Display user profile information (keep under 100 lines)
- ActivityFeed - Show recent activity feed (extract list items to ActivityItem component)
- DashboardNavigation - Include navigation to key features
- DashboardLayout - Responsive container with loading/error states

Requirements per component:
- Single responsibility (one purpose per component)
- Max 80 lines per component function
- Extract helpers into separate utility files
- Responsive design for mobile/desktop
- Loading states and error handling

Use React hooks, TypeScript interfaces, and follow our existing design system.
```

## Database Migration
```
Create a database migration to add user preferences table. Requirements:
- Create users_preferences table with proper constraints
- Add foreign key relationship to users table
- Include migration rollback script
- Update existing user model to include preferences
- Add database indexes for performance

Use our existing migration patterns and ensure backward compatibility.
```

## API Endpoint Implementation
```
Implement REST API endpoint for user registration. Requirements:
- POST /api/users endpoint
- Input validation using Joi/Zod
- Password hashing with bcrypt
- JWT token generation
- Email verification workflow
- Comprehensive error responses

Follow REST conventions and include OpenAPI documentation.
```

## React Component Development
```
Create a reusable DataTable component for our admin interface. Requirements:
- Generic type support for different data types
- Sorting and filtering capabilities
- Pagination with customizable page sizes
- Row selection and bulk actions
- Export functionality (CSV/JSON)
- Responsive design and accessibility

Use TypeScript generics and follow our component library patterns.
```

## Testing Implementation
```
Write comprehensive unit tests for the user authentication service. Requirements:
- Test successful login/logout flows
- Test invalid credentials handling
- Test JWT token validation
- Test password reset functionality
- Mock external dependencies (database, email service)
- Achieve >90% code coverage

Use Jest and our existing testing utilities.
```

## Performance Optimization
```
Optimize the dashboard loading performance. Current issues:
- Slow initial page load (>3 seconds)
- Large bundle size
- Inefficient data fetching
- Missing caching strategy

Implement:
- Code splitting and lazy loading
- API response caching
- Image optimization
- Database query optimization

Target <1 second initial load time.
```