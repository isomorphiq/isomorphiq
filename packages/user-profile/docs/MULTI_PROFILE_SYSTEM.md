# Multi-Profile Task Processing System

## Overview

The Multi-Profile Task Processing System enhances the existing task manager with intelligent profile-based task routing, real-time monitoring, and comprehensive analytics. This system enables specialized AI profiles to handle different types of tasks efficiently while providing visibility into system performance.

## Architecture

### Core Components

1. **Enhanced Profile Manager** (`packages/user-profile/src/acp-profiles.ts`)
   - Profile state management with real-time metrics
   - Task queue management per profile
   - Smart task routing based on capabilities and load
   - Performance tracking and analytics

2. **Profile Types**
   - **Product Manager**: Analysis, feature identification, prioritization
   - **Refinement Specialist**: Task breakdown, dependency analysis, estimation
   - **Developer**: Coding, testing, debugging, documentation

3. **Web Dashboard Components**
   - **Profile Management**: Real-time profile status and control
   - **Profile Analytics**: Performance metrics and trends
   - **Task Routing**: Intelligent assignment based on profile capabilities

### Key Features

#### 1. Profile State Management
```typescript
interface ProfileState {
  name: string
  isActive: boolean
  currentTasks: number
  completedTasks: number
  failedTasks: number
  averageProcessingTime: number
  lastActivity: Date
  queueSize: number
  isProcessing: boolean
}
```

#### 2. Performance Metrics
```typescript
interface ProfileMetrics {
  throughput: number // tasks per hour
  successRate: number // percentage
  averageTaskDuration: number // in seconds
  queueWaitTime: number // average time in queue
  errorRate: number // percentage
}
```

#### 3. Smart Task Routing
- Profiles have defined capabilities and concurrent task limits
- Tasks are routed to best-fit profiles based on:
  - Profile capabilities matching task requirements
  - Current load and availability
  - Priority levels
  - Historical performance

## API Endpoints

### Profile Management
- `GET /api/profiles/with-states` - Get all profiles with states and metrics
- `GET /api/profiles/states` - Get all profile states
- `GET /api/profiles/:name/state` - Get specific profile state
- `GET /api/profiles/:name/metrics` - Get specific profile metrics
- `GET /api/profiles/metrics` - Get all profile metrics
- `GET /api/profiles/:name/queue` - Get profile task queue
- `PUT /api/profiles/:name/status` - Update profile active status
- `POST /api/profiles/:name/assign-task` - Assign task to specific profile
- `POST /api/profiles/best-for-task` - Get best profile for a task

### Daemon Commands
- `get_profile_states` - Get all profile states
- `get_profile_state` - Get specific profile state
- `get_profile_metrics` - Get specific profile metrics
- `get_all_profile_metrics` - Get all profile metrics
- `get_profiles_with_states` - Get profiles with states
- `get_profile_task_queue` - Get profile task queue
- `update_profile_status` - Update profile status
- `get_best_profile_for_task` - Get best profile for task
- `assign_task_to_profile` - Assign task to profile

## Web Dashboard

### New Tabs

1. **Profiles Tab** (`/profiles`)
   - Real-time profile status monitoring
   - Profile information and capabilities
   - Current tasks and queue sizes
   - Performance metrics
   - Enable/disable profile controls

2. **Profile Analytics Tab** (`/profile-analytics`)
   - System-wide performance overview
   - Individual profile analytics
   - Throughput and success rate metrics
   - Performance indicators and health status
   - Time range filtering (1h, 24h, 7d)

### Features

#### Real-time Monitoring
- Live updates every 5 seconds
- Profile status indicators (Active/Inactive)
- Current task processing status
- Queue sizes and wait times

#### Performance Analytics
- Task throughput (tasks per hour)
- Success and error rates
- Average task duration
- Queue wait time estimates
- Performance health indicators

#### Profile Control
- Enable/disable profiles
- Task assignment to specific profiles
- Queue management
- Capability-based routing

## Implementation Details

### Enhanced Profile Processing

The system enhances the existing profile processing with:

1. **Concurrent Task Processing**
   - Each profile has configurable concurrent task limits
   - Tasks are processed in parallel up to the limit
   - Queue management for pending tasks

2. **Metrics Collection**
   - Task completion tracking
   - Success/failure rates
   - Processing time measurements
   - Historical performance data

3. **Smart Routing**
   - Task-profile capability matching
   - Load balancing across profiles
   - Priority-based assignment
   - Performance-based routing

### Error Handling and Resilience

1. **Profile Failure Recovery**
   - Automatic retry on task failures
   - Profile health monitoring
   - Graceful degradation

2. **Queue Management**
   - Task persistence in queues
   - Priority-based ordering
   - Overflow handling

## Testing

### Test Suite
Run the comprehensive test suite:
```bash
node test-multi-profile-system.js
```

### Test Coverage
1. Profile state retrieval
2. Metrics collection
3. Task queue management
4. Profile status updates
5. Smart task routing
6. Task assignment
7. Performance monitoring

## Usage Examples

### 1. Monitor Profile Performance
```javascript
// Get all profile metrics
const metrics = await fetch('/api/profiles/metrics')
console.log('Profile performance:', metrics)
```

### 2. Assign Task to Best Profile
```javascript
// Find best profile for a development task
const bestProfile = await fetch('/api/profiles/best-for-task', {
  method: 'POST',
  body: JSON.stringify({
    task: {
      title: 'Implement new feature',
      description: 'Add user authentication',
      type: 'development'
    }
  })
})
```

### 3. Control Profile Status
```javascript
// Disable a profile for maintenance
await fetch('/api/profiles/development/status', {
  method: 'PUT',
  body: JSON.stringify({ isActive: false })
})
```

## Benefits

1. **Improved Efficiency**
   - Specialized profiles handle appropriate tasks
   - Concurrent processing increases throughput
   - Smart routing reduces wait times

2. **Better Visibility**
   - Real-time monitoring of all profiles
   - Comprehensive performance analytics
   - Historical trend analysis

3. **Enhanced Control**
   - Manual profile management
   - Task assignment control
   - Performance optimization

4. **Scalability**
   - Easy addition of new profiles
   - Configurable concurrent limits
   - Load balancing capabilities

## Future Enhancements

1. **Dynamic Profile Scaling**
   - Auto-scaling based on load
   - Resource allocation optimization
   - Cost-aware routing

2. **Advanced Analytics**
   - Predictive performance modeling
   - Anomaly detection
   - Capacity planning

3. **Profile Customization**
   - User-defined profiles
   - Custom capability definitions
   - Workflow automation

## Configuration

### Profile Configuration
Each profile can be configured with:
- `maxConcurrentTasks`: Maximum concurrent tasks
- `priority`: Profile priority for routing
- `capabilities`: List of supported task types
- `color`: UI display color
- `icon`: UI display icon

### System Configuration
- Update intervals: 5 seconds for real-time data
- Metrics retention: 100 historical records
- Queue limits: Configurable per profile
- Health check intervals: 1 minute

This multi-profile system provides a robust, scalable, and intelligent task processing infrastructure that enhances the existing task manager with advanced capabilities for monitoring, control, and optimization.
