# Task Approval Workflow System

## Overview

The Task Approval Workflow System is a comprehensive, configurable approval system that integrates seamlessly with the existing task management application. It provides multi-stage review processes, role-based permissions, automated routing, and complete audit trails for tasks requiring formal sign-off.

## Features

### ✅ Core Features Implemented

1. **Configurable Approval Workflows**
   - Create custom approval workflows with multiple stages
   - Support for sequential, parallel, and conditional approval stages
   - Define approvers by user, role, or group
   - Set timeouts and escalation rules

2. **Multi-stage Review Processes**
   - Sequential approvals (each stage must complete before next starts)
   - Parallel approvals (multiple approvers can review simultaneously)
   - Conditional approvals (based on task properties)
   - Required vs optional approvers

3. **Role-based Permissions**
   - Integration with existing permission system
   - Approver roles: admin, manager, developer, viewer
   - Fine-grained access control
   - Delegation capabilities

4. **Automated Routing**
   - Rule-based workflow matching
   - Auto-assignment based on task properties
   - Trigger conditions for automatic workflow start
   - Smart approver selection

5. **Complete Audit Trails**
   - Full history of all approval actions
   - Timestamp tracking for all events
   - User action logging
   - Comment and reason tracking

6. **Task Integration**
   - Seamless integration with existing task system
   - Approval status reflected in task lifecycle
   - Real-time updates via WebSocket
   - Event-driven architecture

## Architecture

### Data Models

```typescript
// Core approval workflow
interface ApprovalWorkflow {
    id: string;
    name: string;
    description: string;
    isActive: boolean;
    stages: WorkflowStage[];
    rules: WorkflowRule[];
    createdBy: string;
    createdAt: Date;
    updatedAt: Date;
}

// Approval stage with approvers
interface WorkflowStage {
    id: string;
    name: string;
    description: string;
    type: "sequential" | "parallel" | "conditional";
    approvers: ApproverConfig[];
    conditions: StageCondition[];
    isRequired: boolean;
    timeoutDays?: number;
    escalationRules?: EscalationRule[];
}

// Task approval instance
interface TaskApproval {
    id: string;
    taskId: string;
    workflowId: string;
    workflowName: string;
    currentStage: number;
    status: "pending" | "approved" | "rejected" | "cancelled";
    requestedBy: string;
    requestedAt: Date;
    completedAt?: Date;
    completedBy?: string;
    reason?: string;
    stages: StageApproval[];
    auditTrail: ApprovalAuditEntry[];
    metadata: Record<string, any>;
}
```

### Service Layer

```typescript
// Main service interface
interface IApprovalWorkflowService {
    workflow: {
        create(input: CreateApprovalWorkflowInput, createdBy: string): Promise<Result<ApprovalWorkflow>>;
        get(id: string): Promise<Result<ApprovalWorkflow>>;
        getAll(): Promise<Result<ApprovalWorkflow[]>>;
        update(id: string, input: UpdateApprovalWorkflowInput, updatedBy: string): Promise<Result<ApprovalWorkflow>>;
        delete(id: string, deletedBy: string): Promise<Result<void>>;
        getActive(): Promise<Result<ApprovalWorkflow[]>>;
        getByCreator(createdBy: string): Promise<Result<ApprovalWorkflow[]>>;
    };

    approval: {
        start(input: StartTaskApprovalInput): Promise<Result<TaskApproval>>;
        get(id: string): Promise<Result<TaskApproval>>;
        getByTask(taskId: string): Promise<Result<TaskApproval[]>>;
        getByApprover(approverId: string): Promise<Result<TaskApproval[]>>;
        getPending(): Promise<Result<TaskApproval[]>>;
        process(input: ProcessApprovalInput): Promise<Result<TaskApproval>>;
        cancel(approvalId: string, userId: string, reason?: string): Promise<Result<TaskApproval>>;
        escalate(approvalId: string, stageId: string, userId: string, reason?: string): Promise<Result<TaskApproval>>;
        delegate(approvalId: string, stageId: string, fromUserId: string, toUserId: string): Promise<Result<TaskApproval>>;
    };

    template: {
        create(input: Omit<ApprovalTemplate, "id" | "createdAt" | "updatedAt">): Promise<Result<ApprovalTemplate>>;
        get(id: string): Promise<Result<ApprovalTemplate>>;
        getAll(): Promise<Result<ApprovalTemplate[]>>;
        getPublic(): Promise<Result<ApprovalTemplate[]>>;
        getByCategory(category: string): Promise<Result<ApprovalTemplate[]>>;
        update(id: string, input: Partial<ApprovalTemplate>): Promise<Result<ApprovalTemplate>>;
        delete(id: string): Promise<Result<void>>;
    };

    stats: {
        getStats(): Promise<Result<ApprovalStats>>;
        getUserStats(userId: string): Promise<Result<ApprovalStats>>;
        getWorkflowStats(workflowId: string): Promise<Result<ApprovalStats>>;
    };
}
```

### Repository Layer

```typescript
// In-memory implementations for testing
class InMemoryApprovalWorkflowRepository implements IApprovalWorkflowRepository
class InMemoryTaskApprovalRepository implements ITaskApprovalRepository  
class InMemoryApprovalTemplateRepository implements IApprovalTemplateRepository
```

## API Endpoints

### Workflow Management
- `POST /api/approval/workflows` - Create new workflow
- `GET /api/approval/workflows` - List all workflows
- `GET /api/approval/workflows/:id` - Get specific workflow
- `PUT /api/approval/workflows/:id` - Update workflow
- `DELETE /api/approval/workflows/:id` - Delete workflow
- `GET /api/approval/workflows/active` - Get active workflows

### Approval Process
- `POST /api/approval/approvals/start` - Start approval process
- `GET /api/approval/approvals` - List approvals (with filters)
- `GET /api/approval/approvals/:id` - Get specific approval
- `POST /api/approval/approvals/:id/process` - Process approval (approve/reject/request changes)
- `POST /api/approval/approvals/:id/cancel` - Cancel approval
- `POST /api/approval/approvals/:id/escalate` - Escalate approval
- `POST /api/approval/approvals/:id/delegate` - Delegate approval

### Templates
- `POST /api/approval/templates` - Create template
- `GET /api/approval/templates` - List templates
- `GET /api/approval/templates/:id` - Get specific template
- `PUT /api/approval/templates/:id` - Update template
- `DELETE /api/approval/templates/:id` - Delete template

### Statistics
- `GET /api/approval/stats` - Get system statistics
- `GET /api/approval/stats?userId=X` - Get user statistics
- `GET /api/approval/stats?workflowId=X` - Get workflow statistics

## Frontend Components

### React Components

1. **ApprovalWorkflowList**
   - Display all approval workflows
   - Create new workflow button
   - Workflow status indicators

2. **ApprovalWorkflowForm**
   - Create/edit workflow form
   - Stage management
   - Approver configuration
   - Rule definition

3. **ApprovalDashboard**
   - Main dashboard for approvals
   - Pending approvals view
   - My approvals view
   - Statistics and analytics

4. **ApprovalCard**
   - Individual approval display
   - Action buttons (approve/reject/request changes)
   - Status indicators
   - Comment functionality

## Usage Examples

### Creating a Basic Workflow

```typescript
const workflowInput: CreateApprovalWorkflowInput = {
    name: "Code Review Approval",
    description: "Two-stage approval for code changes",
    stages: [
        {
            name: "Peer Review",
            description: "Team member must review first",
            type: "sequential",
            approvers: [
                {
                    type: "role",
                    value: "developer",
                    isRequired: true,
                    canDelegate: true,
                },
            ],
            isRequired: true,
            timeoutDays: 2,
        },
        {
            name: "Lead Review",
            description: "Team lead final approval",
            type: "sequential",
            approvers: [
                {
                    type: "role",
                    value: "manager",
                    isRequired: true,
                    canDelegate: false,
                },
            ],
            isRequired: true,
            timeoutDays: 3,
        },
    ],
};

const result = await approvalService.workflow.create(workflowInput, "user-123");
```

### Starting an Approval Process

```typescript
const startInput: StartTaskApprovalInput = {
    taskId: "task-456",
    workflowId: "workflow-123",
    requestedBy: "user-789",
    reason: "Code changes require formal approval",
    metadata: {
        priority: "high",
        category: "development",
    },
};

const approval = await approvalService.approval.start(startInput);
```

### Processing an Approval

```typescript
const processInput: ProcessApprovalInput = {
    approvalId: "approval-789",
    stageId: "stage-123",
    approverId: "user-456",
    action: "approve",
    comment: "Code looks good, approved for next stage",
};

const result = await approvalService.approval.process(processInput);
```

## Event System

### Approval Events

```typescript
// Workflow events
"approval_workflow_created"
"approval_workflow_updated" 
"approval_workflow_deleted"

// Approval process events
"task_approval_started"
"task_approval_processed"
"task_approval_cancelled"
"task_approval_escalated"
"task_approval_delegated"
```

### Event Data Structure

```typescript
interface ApprovalEvent {
    id: string;
    type: string;
    timestamp: Date;
    data: {
        workflow?: ApprovalWorkflow;
        approval?: TaskApproval;
        userId?: string;
        action?: string;
        reason?: string;
    };
}
```

## Security & Permissions

### Role-based Access

- **Admin**: Full access to all workflows and approvals
- **Manager**: Can create workflows, approve tasks in team
- **Developer**: Can participate in approvals, view own tasks
- **Viewer**: Read-only access to approval status

### Permission Checks

```typescript
// Example permission check
const hasPermission = await permissionService.hasPermission(
    userPermissions,
    "approval_workflows",
    "create",
    { userId: "user-123" }
);
```

## Testing

### Comprehensive Test Suite

The system includes a comprehensive test suite (`scripts/test-approval-workflow.ts`) that covers:

1. **Workflow Creation & Management**
2. **Approval Process Flow**
3. **Multi-stage Approvals**
4. **Rejection Handling**
5. **Delegation Functionality**
6. **Escalation Process**
7. **Cancellation Handling**
8. **Parallel Approvals**
9. **Statistics & Analytics**
10. **Error Handling**

### Running Tests

```bash
# Run the complete test suite
npx tsx scripts/test-approval-workflow.ts
```

## Performance Considerations

### Optimization Strategies

1. **Efficient Queries**
   - Indexed lookups for approval status
   - Optimized approver filtering
   - Cached workflow definitions

2. **Real-time Updates**
   - WebSocket integration for live status
   - Event-driven updates
   - Minimal polling overhead

3. **Scalability**
   - Repository pattern for data access
   - Service layer for business logic
   - Event-driven architecture

## Integration Points

### Existing System Integration

1. **Task Management**
   - Approval status affects task completion
   - Workflow triggers based on task properties
   - Seamless user experience

2. **Permission System**
   - Role-based approver assignment
   - Access control for workflow management
   - Delegation permissions

3. **Event Bus**
   - Real-time approval status updates
   - Audit trail events
   - System-wide notifications

4. **User Management**
   - Approver identification
   - User profile integration
   - Team-based assignments

## Configuration

### Environment Variables

```typescript
// Approval system configuration
const approvalConfig = {
    defaultTimeoutDays: 5,
    maxApproversPerStage: 10,
    enableDelegation: true,
    enableEscalation: true,
    auditRetentionDays: 365,
};
```

### Workflow Templates

Pre-built templates for common scenarios:

1. **Development Approval**
   - Code review stages
   - Peer and lead approval
   - Quality gates

2. **Deployment Approval**
   - Environment-specific stages
   - Ops and security approval
   - Rollback permissions

3. **Access Request**
   - Resource access approval
   - Manager and security review
   - Time-based access

## Monitoring & Analytics

### Key Metrics

- Approval completion time
- Rejection rate by stage
- Delegation frequency
- Escalation rate
- User participation metrics
- Workflow efficiency

### Dashboard Analytics

Real-time dashboard showing:
- Pending approvals count
- Approval trends
- Bottleneck identification
- Performance metrics
- User workload distribution

## Future Enhancements

### Planned Features

1. **Advanced Workflow Designer**
   - Visual workflow builder
   - Drag-and-drop stage creation
   - Conditional logic builder

2. **Mobile App**
   - Native mobile approvals
   - Push notifications
   - Offline approval capability

3. **Integration Hub**
   - Third-party system connections
   - Webhook support
   - API extensibility

4. **AI-powered Insights**
   - Approval pattern analysis
   - Bottleneck prediction
   - Automated workflow optimization

## Troubleshooting

### Common Issues

1. **Approval Not Starting**
   - Check workflow is active
   - Verify user permissions
   - Validate task properties

2. **Approvers Not Notified**
   - Check WebSocket connection
   - Verify notification settings
   - Review user preferences

3. **Stage Not Progressing**
   - Check required approvers
   - Verify delegation rules
   - Review timeout settings

### Debug Information

Enable debug logging:
```typescript
// Set debug level
const logger = createLogger({ level: "debug" });

// Monitor approval events
eventBus.on("task_approval_processed", (event) => {
    logger.debug("Approval processed:", event.data);
});
```

---

## Summary

The Task Approval Workflow System provides a robust, scalable solution for formal approval processes within the task management application. It offers:

- ✅ Complete workflow management
- ✅ Flexible approval processes  
- ✅ Role-based security
- ✅ Comprehensive audit trails
- ✅ Real-time updates
- ✅ Performance analytics
- ✅ Extensive testing coverage

The system is production-ready and integrates seamlessly with the existing task management infrastructure while providing room for future enhancements and scalability.