# Event-Driven Architecture Implementation

This document describes the event-driven architecture implementation for the Isomorphiq Task Manager, providing real-time updates via WebSocket.

## Overview

The event-driven architecture enables decoupled communication between different components of the system through a publish-subscribe pattern. This allows for:

- **Real-time updates** via WebSocket connections
- **Event persistence** for audit trails and replay
- **Middleware processing** for logging, metrics, and transformation
- **Type-safe event creation** with factory functions

## Core Components

### 1. Event System (`src/core/events.ts`)

Defines the event types and interfaces:

```typescript
// Base event interface
interface BaseEvent {
    id: string;
    type: string;
    timestamp: Date;
    data: any;
    metadata?: EventMetadata;
}

// Task-specific events
interface TaskEvent extends BaseEvent {
    type: "task_created" | "task_updated" | "task_deleted" | 
          "task_status_changed" | "task_priority_changed" | 
          "task_assigned" | "task_collaborators_updated" | 
          "task_watchers_updated" | "task_dependency_added" | 
          "task_dependency_removed";
    data: any;
}
```

### 2. Event Bus (`src/core/event-bus.ts`)

Central event management system with:

- **Publish/Subscribe pattern** for event distribution
- **Middleware pipeline** for event processing
- **Metrics collection** for performance monitoring
- **Error handling** with timeout protection

```typescript
// Global event bus instance
export const globalEventBus = new EventBus({
    enableMetrics: true,
    enablePersistence: false,
    maxListeners: 1000,
});

// Event factory for type-safe creation
export const EventFactory = {
    createTaskCreated: (task, createdBy) => ({...}),
    createTaskUpdated: (task, changes, updatedBy) => ({...}),
    // ... other event types
};
```

### 3. Event Middleware (`src/core/event-middleware.ts`)

Provides middleware for:

- **Logging**: Automatic event logging
- **Metrics**: Performance and usage statistics
- **Filtering**: Event type and source filtering
- **Transformation**: Event data enrichment
- **Rate Limiting**: Prevent event flooding
- **Validation**: Event schema validation
- **Error Handling**: Centralized error processing

```typescript
// Usage example
const metricsMiddleware = new MetricsMiddleware();
eventBus.use(loggingMiddleware);
eventBus.use(metricsMiddleware.middleware);
eventBus.use(new ErrorHandlingMiddleware().middleware);
```

### 4. Event Store (`src/core/event-store.ts`)

Persistence layer for events:

- **In-memory store** for development and testing
- **LevelDB store** for production persistence
- **Event replay** functionality for state reconstruction
- **Snapshot service** for performance optimization

```typescript
// In-memory event store
const eventStore = new InMemoryEventStore(10000);

// Event replay service
const replayService = new EventReplayService(eventStore);
await replayService.replayEvents();
```

### 5. Enhanced WebSocket Manager (`src/services/enhanced-websocket-server.ts`)

Advanced WebSocket server with:

- **Connection pooling** for efficient resource management
- **Message queuing** for reliable delivery
- **Health monitoring** with ping/pong
- **Compression support** for bandwidth optimization
- **Graceful shutdown** handling

### 6. WebSocket Event Bridge (`src/services/websocket-event-bridge.ts`)

Converts domain events to WebSocket events:

- **Event type mapping** between domain and WebSocket formats
- **Data transformation** for client compatibility
- **Subscription management** for selective updates
- **Error handling** for failed conversions

### 7. Enhanced Task Service (`src/services/enhanced-task-service.ts`)

Task service with event emission:

- **Event publishing** for all task operations
- **Change tracking** with detailed diff information
- **Permission checking** before operations
- **Dependency validation** for circular dependency prevention

## Event Flow

### Task Creation Flow

1. **Client Request** → HTTP API or TCP command
2. **Validation** → Domain rules and input validation
3. **Task Creation** → TaskFactory creates entity
4. **Database Save** → Repository persists task
5. **Event Publishing** → TaskCreatedEvent emitted
6. **Middleware Processing** → Logging, metrics, validation
7. **WebSocket Broadcast** → Real-time update to clients
8. **Event Persistence** → Store in event log

### Task Update Flow

1. **Get Existing Task** → Retrieve from database
2. **Validate Changes** → Domain rules validation
3. **Apply Changes** → TaskFactory updates entity
4. **Database Update** → Repository saves changes
5. **Calculate Diff** → Determine what changed
6. **Event Publishing** → TaskUpdatedEvent with changes
7. **Middleware Processing** → Pipeline processing
8. **WebSocket Broadcast** → Update all subscribed clients
9. **Event Persistence** → Store for audit trail

## Real-Time Features

### WebSocket Events

Clients receive real-time updates for:

- `task_created` - New task created
- `task_updated` - Task modified with changes
- `task_deleted` - Task removed
- `task_status_changed` - Status transition
- `task_priority_changed` - Priority modification
- `task_assigned` - Assignment to user
- `task_collaborators_updated` - Collaborator changes
- `task_watchers_updated` - Watcher modifications

### Subscription Management

Clients can subscribe to specific event types:

```javascript
// Subscribe to task creation events
ws.send(JSON.stringify({
    type: "subscribe",
    eventTypes: ["task_created", "task_updated"]
}));

// Unsubscribe from specific events
ws.send(JSON.stringify({
    type: "unsubscribe", 
    eventTypes: ["task_deleted"]
}));
```

## Performance Features

### Connection Management

- **Connection pooling** with configurable limits
- **Health monitoring** via ping/pong
- **Automatic cleanup** of stale connections
- **Graceful degradation** under load

### Event Processing

- **Async middleware** pipeline
- **Timeout protection** for long-running handlers
- **Error isolation** prevents cascade failures
- **Metrics collection** for performance tuning

### Persistence Optimization

- **Event snapshots** for fast state reconstruction
- **Circular dependency** detection
- **Batch operations** for bulk updates
- **Event replay** for system recovery

## Configuration

### Event Bus Configuration

```typescript
const eventBusConfig = {
    maxListeners: 1000,        // Maximum concurrent listeners
    enablePersistence: true,     // Enable event storage
    enableMetrics: true,        // Collect performance metrics
    middlewareTimeout: 5000,    // Middleware timeout in ms
};
```

### WebSocket Configuration

```typescript
const wsConfig = {
    port: 3002,               // WebSocket port
    path: "/ws",               // WebSocket path
    maxConnections: 1000,       // Max concurrent connections
    heartbeatInterval: 30000,     // Ping interval in ms
    enableCompression: false,     // Enable message compression
    messageQueueSize: 10000,    // Max queued messages
};
```

## Testing

### Event-Driven Test Suite

Run the comprehensive test:

```bash
node test-event-driven-simple.js
```

This test demonstrates:

- ✅ Event publishing and subscription
- ✅ Middleware pipeline processing
- ✅ Real-time WebSocket updates
- ✅ Event type filtering
- ✅ Metrics collection
- ✅ Error handling
- ✅ Event persistence
- ✅ Performance monitoring

## Integration

### Daemon Integration

The daemon (`packages/worker/src/daemon.ts`) integrates the event system:

```typescript
// Setup event bus with persistence
const eventStore = new LevelDBEventStore("./events");
globalEventBus.setEventStore(eventStore);

// Setup WebSocket manager with event bridge
const wsManager = new EventIntegratedWebSocketManager();
wsManager.subscribeToEventBus(globalEventBus);

// Enhanced task service with event emission
const taskService = new EnhancedTaskService(taskRepository);
```

### HTTP API Integration

The REST API server uses the event system:

```typescript
// API endpoints trigger events
app.post("/api/tasks", async (req, res) => {
    const result = await taskService.createTask(req.body, req.user.id);
    // Event automatically published by task service
    res.json(result);
});
```

## Benefits

### Decoupling

- **Loose coupling** between components
- **Independent evolution** of services
- **Easy testing** with mock events
- **Flexible architecture** for new features

### Scalability

- **Horizontal scaling** with multiple instances
- **Load balancing** via event distribution
- **Resource efficiency** with connection pooling
- **Performance monitoring** for optimization

### Reliability

- **Event persistence** for audit trails
- **Error isolation** prevents cascade failures
- **Graceful degradation** under load
- **Recovery capabilities** with event replay

### Observability

- **Comprehensive metrics** for all operations
- **Event logging** for debugging
- **Performance tracking** with timing data
- **Health monitoring** of connections

## Migration Guide

### From Direct WebSocket to Event-Driven

1. **Replace direct WebSocket calls** with event publishing
2. **Add event listeners** for real-time updates
3. **Implement middleware** for cross-cutting concerns
4. **Setup event persistence** for audit trails
5. **Update client code** to handle new event format

### Backward Compatibility

- **Legacy WebSocket events** still supported
- **Gradual migration** path available
- **Feature flags** for controlled rollout
- **Fallback mechanisms** for compatibility

## Future Enhancements

### Planned Features

- **Event sourcing** with full state reconstruction
- **CQRS pattern** for read/write separation
- **Distributed events** across multiple instances
- **Event versioning** for schema evolution
- **Advanced filtering** with complex queries
- **Performance analytics** with detailed insights

### Extensibility

- **Custom event types** easily added
- **Plugin architecture** for middleware
- **Third-party integrations** via events
- **Configuration-driven** behavior
- **Hot-reloading** of event handlers

## Troubleshooting

### Common Issues

**Events not received by clients:**
- Check WebSocket connection status
- Verify event subscription
- Check middleware filtering
- Review event type mappings

**Performance issues:**
- Monitor event processing times
- Check middleware bottlenecks
- Review connection pool usage
- Analyze event queue sizes

**Memory leaks:**
- Monitor event store size
- Check listener cleanup
- Review connection management
- Analyze middleware state

### Debug Tools

```typescript
// Enable debug logging
globalEventBus.use((event, next) => {
    console.log("DEBUG:", event.type, event.data);
    next();
});

// Monitor metrics
setInterval(() => {
    console.log("METRICS:", globalEventBus.getMetrics());
}, 10000);
```

This event-driven architecture provides a robust foundation for real-time features, scalability, and maintainability of the Isomorphiq Task Manager system.
