# Task Dependency Visualization and Critical Path Analysis

This feature provides comprehensive task dependency visualization and critical path analysis capabilities for the task management system.

## Features

### 1. Visual Dependency Graphs
- **Interactive D3.js Visualization**: Navigate complex task relationships with zoom, pan, and click interactions
- **Critical Path Highlighting**: Visual identification of the critical path in red
- **Task Status Indicators**: Color-coded status badges (Done, In Progress, Todo)
- **Priority Indicators**: Visual priority markers (H, M, L)
- **Level-based Layout**: Hierarchical arrangement showing dependency levels

### 2. Critical Path Analysis
- **CPM Algorithm**: Implements Critical Path Method (CPM) for accurate project timeline calculation
- **Slack Time Calculation**: Identifies tasks with scheduling flexibility
- **Project Duration**: Calculates total project timeline based on task dependencies
- **Critical Task Identification**: Highlights tasks that cannot be delayed without affecting project completion

### 3. Impact Analysis
- **Delay Simulation**: Analyze the impact of delaying any task by a specified number of days
- **Affected Tasks Identification**: Shows all tasks that will be impacted by a delay
- **Critical Path Impact Assessment**: Determines if a delay affects the overall project timeline
- **Timeline Recalculation**: Provides new project duration with delay impact

### 4. Task Management Insights
- **Available Tasks**: Shows tasks that can be started immediately (no unmet dependencies)
- **Blocking Tasks**: Identifies tasks that are preventing other tasks from starting
- **Dependency Tracking**: Complete dependency relationship mapping

## Architecture

### Backend Services

#### CriticalPathService (`src/services/critical-path-service.ts`)
Core service implementing critical path analysis algorithms:

```typescript
// Calculate critical path for all tasks
const result = CriticalPathService.calculateCriticalPath(tasks);

// Analyze impact of delaying a task
const impact = CriticalPathService.analyzeDelayImpact(tasks, taskId, delayDays);

// Get tasks that can be started
const available = CriticalPathService.getAvailableTasks(tasks);

// Get tasks that are blocking others
const blocking = CriticalPathService.getBlockingTasks(tasks);
```

#### Key Algorithms
- **Topological Sort**: For dependency level calculation
- **Forward Pass**: Calculates earliest start/finish times
- **Backward Pass**: Calculates latest start/finish times
- **Slack Calculation**: Identifies critical vs. non-critical tasks
- **Critical Path Identification**: Finds longest path through critical tasks

### Frontend Components

#### DependencyVisualization (`web/src/components/DependencyVisualization.tsx`)
Interactive D3.js visualization component:
- Zoom and pan functionality
- Task node interaction (click, hover)
- Critical path highlighting
- Real-time statistics display

#### ImpactAnalysis (`web/src/components/ImpactAnalysis.tsx`)
Impact analysis interface:
- Delay duration input
- Affected tasks listing
- Timeline impact visualization
- Recommendations display

#### DependencyAnalysisPage (`web/src/components/DependencyAnalysisPage.tsx`)
Main analysis dashboard:
- Tabbed interface (Visualization vs. Impact Analysis)
- Project statistics overview
- Selected task details
- Quick task lists (Available, Blocking)

## API Endpoints

### Critical Path Analysis
```
GET /api/tasks/critical-path
Authorization: Bearer <token>
```
Returns complete critical path analysis with nodes, links, and project statistics.

### Available Tasks
```
GET /api/tasks/available
Authorization: Bearer <token>
```
Returns tasks that can be started immediately.

### Blocking Tasks
```
GET /api/tasks/blocking
Authorization: Bearer <token>
```
Returns tasks that are currently blocking other tasks.

### Impact Analysis
```
POST /api/tasks/:taskId/impact
Authorization: Bearer <token>
Content-Type: application/json

{
  "delayDays": 2.5
}
```
Analyzes the impact of delaying a specific task.

## Usage Examples

### Basic Critical Path Analysis
```typescript
import { CriticalPathService } from './services/critical-path-service';

const tasks = await getAllTasks();
const analysis = CriticalPathService.calculateCriticalPath(tasks);

console.log(`Project Duration: ${analysis.projectDuration} days`);
console.log(`Critical Path: ${analysis.criticalPath.join(' → ')}`);
```

### Impact Analysis
```typescript
const impact = CriticalPathService.analyzeDelayImpact(tasks, 'task-123', 3);

if (impact.criticalPathImpact) {
  console.log('⚠️ This delay will affect project timeline!');
  console.log(`New project duration: ${impact.newProjectDuration} days`);
}

console.log(`Affected tasks: ${impact.affectedTasks.length}`);
```

### Frontend Integration
```tsx
import { DependencyVisualization } from './components/DependencyVisualization';

<DependencyVisualization
  tasks={tasks}
  onTaskClick={(task) => setSelectedTask(task)}
  onTaskHover={(task) => setHoveredTask(task)}
  selectedTaskId={selectedTask?.id}
/>
```

## Data Structures

### TaskNode
```typescript
interface TaskNode {
  id: string;
  task: Task;
  x: number;        // Visual position
  y: number;        // Visual position
  level: number;     // Dependency level
  dependencies: string[];
  dependents: string[];
  isCritical: boolean;
  earliestStart: number;
  earliestFinish: number;
  latestStart: number;
  latestFinish: number;
  slack: number;     // Scheduling flexibility
}
```

### CriticalPathResult
```typescript
interface CriticalPathResult {
  nodes: TaskNode[];
  links: DependencyLink[];
  criticalPath: string[];
  projectDuration: number;
  levels: number;
}
```

### ImpactAnalysis
```typescript
interface ImpactAnalysis {
  taskId: string;
  delayDays: number;
  affectedTasks: string[];
  criticalPathImpact: boolean;
  newProjectDuration: number;
  delayedTasks: Array<{
    taskId: string;
    delayDays: number;
    newStartDate: Date;
    newEndDate: Date;
  }>;
}
```

## Performance Considerations

### Algorithm Complexity
- **Critical Path Calculation**: O(V + E) where V = tasks, E = dependencies
- **Impact Analysis**: O(V + E) for transitive dependency calculation
- **Visualization Rendering**: O(V + E) for D3.js rendering

### Optimization Strategies
- **Memoization**: Caches calculated paths for repeated queries
- **Incremental Updates**: Only recalculates affected portions when tasks change
- **Lazy Loading**: Loads task details on-demand for large projects

## Testing

### Unit Tests
```bash
# Run critical path service tests
npx tsx test-critical-path.ts
```

### Integration Tests
- Test with various dependency structures
- Verify circular dependency detection
- Validate impact analysis accuracy
- Test visualization interactions

## Future Enhancements

### Planned Features
1. **Gantt Chart View**: Timeline-based visualization
2. **Resource Allocation**: Track resource assignments and conflicts
3. **What-If Scenarios**: Multiple delay simulations
4. **Export Capabilities**: PDF/PNG export of visualizations
5. **Real-time Updates**: Live dependency graph updates
6. **Multiple Project Views**: Portfolio-level dependency analysis

### Advanced Analytics
1. **Monte Carlo Simulation**: Probabilistic timeline analysis
2. **Resource Leveling**: Optimize resource allocation
3. **Earned Value Analysis**: Track project progress
4. **Risk Assessment**: Identify high-risk dependency paths

## Troubleshooting

### Common Issues

#### Circular Dependencies
The system detects and prevents circular dependencies:
```typescript
// This will be rejected
Task A depends on Task B
Task B depends on Task A
```

#### Performance Issues
For large projects (>1000 tasks):
- Use pagination for task loading
- Implement virtual scrolling in visualization
- Consider server-side calculations

#### Visualization Problems
- Ensure D3.js is properly loaded
- Check SVG container dimensions
- Verify task data integrity

### Debug Information
Enable debug logging:
```typescript
console.log('Critical Path Debug:', {
  taskCount: tasks.length,
  dependencyCount: tasks.reduce((sum, t) => sum + (t.dependencies?.length || 0), 0),
  criticalPathLength: analysis.criticalPath.length
});
```

## Contributing

When contributing to the dependency visualization feature:

1. **Algorithm Changes**: Update unit tests in `test-critical-path.ts`
2. **Visual Changes**: Test with various screen sizes and data volumes
3. **API Changes**: Update API documentation and tests
4. **Performance**: Profile with large datasets (>500 tasks)

## License

This feature follows the same license as the main project. See LICENSE file for details.