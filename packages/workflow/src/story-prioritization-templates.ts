import type {
    WorkflowDefinition,
    WorkflowNode,
    WorkflowConnection,
    WorkflowVariable,
} from "./types.ts";

export interface StoryPrioritizationTemplate {
    id: string;
    name: string;
    description: string;
    category: "story_management" | "priority_evaluation" | "dependency_management";
    definition: Omit<WorkflowDefinition, "id" | "createdAt" | "updatedAt" | "createdBy" | "updatedBy">;
    defaultVariables: WorkflowVariable[];
}

export const StoryCreationWithPriorityTemplate: StoryPrioritizationTemplate = {
    id: "story-creation-with-priority",
    name: "Story Creation with Priority Evaluation",
    description: "Creates a new story with mandatory priority criteria evaluation",
    category: "story_management",
    definition: {
        name: "Story Creation with Priority",
        description: "Workflow for creating stories with comprehensive priority evaluation",
        version: "1.0.0",
        category: "task_management",
        nodes: [
            {
                id: "trigger",
                type: "trigger",
                position: { x: 100, y: 100 },
                data: {
                    eventType: "story_creation_requested",
                },
            },
            {
                id: "validate-input",
                type: "condition",
                position: { x: 300, y: 100 },
                data: {
                    operator: "and",
                    conditions: [
                        { field: "title", operator: "not_empty" },
                        { field: "description", operator: "not_empty" },
                        { field: "featureId", operator: "not_empty" },
                    ],
                },
            },
            {
                id: "create-story",
                type: "task_create",
                position: { x: 500, y: 100 },
                data: {
                    title: "{{storyTitle}}",
                    description: "{{storyDescription}}",
                    type: "story",
                    priority: "medium",
                    dependencies: ["{{featureId}}"],
                },
            },
            {
                id: "evaluate-priority",
                type: "action",
                position: { x: 700, y: 100 },
                data: {
                    actionType: "evaluate_priority",
                    parameters: {
                        criteria: "{{priorityCriteria}}",
                        storyId: "{{createdStoryId}}",
                    },
                },
            },
            {
                id: "check-conflicts",
                type: "condition",
                position: { x: 900, y: 100 },
                data: {
                    operator: "and",
                    conditions: [
                        { field: "conflicts", operator: "empty" },
                    ],
                },
            },
            {
                id: "notify-creation",
                type: "notification",
                position: { x: 1100, y: 100 },
                data: {
                    recipients: ["{{createdBy}}"],
                    subject: "Story Created with Priority",
                    message: "Story '{{storyTitle}}' has been created and prioritized as {{priority}}",
                    type: "email",
                },
            },
            {
                id: "handle-conflicts",
                type: "action",
                position: { x: 900, y: 300 },
                data: {
                    actionType: "resolve_conflicts",
                    parameters: {
                        strategy: "manual_review",
                    },
                },
            },
        ],
        connections: [
            { id: "c1", sourceNodeId: "trigger", sourcePortId: "output", targetNodeId: "validate-input", targetPortId: "input" },
            { id: "c2", sourceNodeId: "validate-input", sourcePortId: "true", targetNodeId: "create-story", targetPortId: "input" },
            { id: "c3", sourceNodeId: "create-story", sourcePortId: "output", targetNodeId: "evaluate-priority", targetPortId: "input" },
            { id: "c4", sourceNodeId: "evaluate-priority", sourcePortId: "output", targetNodeId: "check-conflicts", targetPortId: "input" },
            { id: "c5", sourceNodeId: "check-conflicts", sourcePortId: "true", targetNodeId: "notify-creation", targetPortId: "input" },
            { id: "c6", sourceNodeId: "check-conflicts", sourcePortId: "false", targetNodeId: "handle-conflicts", targetPortId: "input" },
        ],
        variables: [
            { name: "storyTitle", type: "string", scope: "local" },
            { name: "storyDescription", type: "string", scope: "local" },
            { name: "featureId", type: "string", scope: "local" },
            { name: "priorityCriteria", type: "object", scope: "local" },
            { name: "createdStoryId", type: "string", scope: "local" },
            { name: "createdBy", type: "string", scope: "local" },
            { name: "priority", type: "string", scope: "local" },
        ],
        settings: {
            timeout: 300000,
            retryPolicy: {
                maxAttempts: 3,
                backoffMultiplier: 2,
                maxDelay: 30000,
            },
            errorHandling: "retry",
            logging: {
                enabled: true,
                level: "info",
                includeData: false,
            },
        },
        metadata: {
            tags: ["story", "priority", "creation"],
            author: "system",
            documentation: "Creates stories with comprehensive priority evaluation",
        },
        enabled: true,
    },
    defaultVariables: [
        { name: "minCriteria", type: "number", scope: "global", defaultValue: 3 },
        { name: "autoResolveConflicts", type: "boolean", scope: "global", defaultValue: false },
    ],
};

export const PriorityEvaluationWorkflowTemplate: StoryPrioritizationTemplate = {
    id: "priority-evaluation-workflow",
    name: "Priority Evaluation Workflow",
    description: "Structured workflow for evaluating and adjusting story priorities",
    category: "priority_evaluation",
    definition: {
        name: "Priority Evaluation",
        description: "Multi-step priority evaluation with stakeholder input",
        version: "1.0.0",
        category: "task_management",
        nodes: [
            {
                id: "trigger",
                type: "trigger",
                position: { x: 100, y: 100 },
                data: {
                    eventType: "priority_evaluation_requested",
                },
            },
            {
                id: "load-story",
                type: "action",
                position: { x: 300, y: 100 },
                data: {
                    actionType: "load_story",
                    parameters: {
                        storyId: "{{storyId}}",
                    },
                },
            },
            {
                id: "collect-criteria",
                type: "action",
                position: { x: 500, y: 100 },
                data: {
                    actionType: "collect_criteria",
                    parameters: {
                        requiredCriteria: ["businessValue", "userImpact", "effort"],
                        optionalCriteria: ["risk", "dependencies", "strategicAlignment"],
                    },
                },
            },
            {
                id: "validate-criteria",
                type: "condition",
                position: { x: 700, y: 100 },
                data: {
                    operator: "and",
                    conditions: [
                        { field: "criteriaCount", operator: "greater_than", value: 2 },
                        { field: "weightSum", operator: "equals", value: 1.0 },
                    ],
                },
            },
            {
                id: "calculate-score",
                type: "action",
                position: { x: 900, y: 100 },
                data: {
                    actionType: "calculate_priority_score",
                    parameters: {
                        criteria: "{{collectedCriteria}}",
                    },
                },
            },
            {
                id: "detect-conflicts",
                type: "action",
                position: { x: 1100, y: 100 },
                data: {
                    actionType: "detect_priority_conflicts",
                    parameters: {
                        storyId: "{{storyId}}",
                        newPriority: "{{calculatedPriority}}",
                    },
                },
            },
            {
                id: "has-conflicts",
                type: "condition",
                position: { x: 1300, y: 100 },
                data: {
                    operator: "and",
                    conditions: [
                        { field: "conflicts", operator: "empty" },
                    ],
                },
            },
            {
                id: "update-priority",
                type: "task_update",
                position: { x: 1500, y: 100 },
                data: {
                    taskId: "{{storyId}}",
                    updates: {
                        priority: "{{calculatedPriority}}",
                    },
                },
            },
            {
                id: "notify-completion",
                type: "notification",
                position: { x: 1700, y: 100 },
                data: {
                    recipients: ["{{requestor}}"],
                    subject: "Priority Evaluation Complete",
                    message: "Story priority evaluated as {{calculatedPriority}} with score {{score}}",
                    type: "email",
                },
            },
            {
                id: "resolve-conflicts",
                type: "action",
                position: { x: 1300, y: 300 },
                data: {
                    actionType: "resolve_conflicts",
                    parameters: {
                        strategy: "{{conflictResolutionStrategy}}",
                    },
                },
            },
        ],
        connections: [
            { id: "c1", sourceNodeId: "trigger", sourcePortId: "output", targetNodeId: "load-story", targetPortId: "input" },
            { id: "c2", sourceNodeId: "load-story", sourcePortId: "output", targetNodeId: "collect-criteria", targetPortId: "input" },
            { id: "c3", sourceNodeId: "collect-criteria", sourcePortId: "output", targetNodeId: "validate-criteria", targetPortId: "input" },
            { id: "c4", sourceNodeId: "validate-criteria", sourcePortId: "true", targetNodeId: "calculate-score", targetPortId: "input" },
            { id: "c5", sourceNodeId: "calculate-score", sourcePortId: "output", targetNodeId: "detect-conflicts", targetPortId: "input" },
            { id: "c6", sourceNodeId: "detect-conflicts", sourcePortId: "output", targetNodeId: "has-conflicts", targetPortId: "input" },
            { id: "c7", sourceNodeId: "has-conflicts", sourcePortId: "true", targetNodeId: "update-priority", targetPortId: "input" },
            { id: "c8", sourceNodeId: "update-priority", sourcePortId: "output", targetNodeId: "notify-completion", targetPortId: "input" },
            { id: "c9", sourceNodeId: "has-conflicts", sourcePortId: "false", targetNodeId: "resolve-conflicts", targetPortId: "input" },
        ],
        variables: [
            { name: "storyId", type: "string", scope: "local" },
            { name: "requestor", type: "string", scope: "local" },
            { name: "collectedCriteria", type: "object", scope: "local" },
            { name: "calculatedPriority", type: "string", scope: "local" },
            { name: "score", type: "number", scope: "local" },
            { name: "conflictResolutionStrategy", type: "string", scope: "local", defaultValue: "manual_review" },
        ],
        settings: {
            timeout: 600000,
            retryPolicy: {
                maxAttempts: 2,
                backoffMultiplier: 2,
                maxDelay: 60000,
            },
            errorHandling: "stop",
            logging: {
                enabled: true,
                level: "info",
                includeData: true,
            },
        },
        metadata: {
            tags: ["priority", "evaluation", "story"],
            author: "system",
            documentation: "Structured priority evaluation with conflict detection",
        },
        enabled: true,
    },
    defaultVariables: [
        { name: "evaluationTimeout", type: "number", scope: "global", defaultValue: 600000 },
        { name: "requireApproval", type: "boolean", scope: "global", defaultValue: true },
    ],
};

export const DependencyAwarePrioritizationTemplate: StoryPrioritizationTemplate = {
    id: "dependency-aware-prioritization",
    name: "Dependency-Aware Prioritization",
    description: "Prioritizes stories considering their dependencies and impact on critical path",
    category: "dependency_management",
    definition: {
        name: "Dependency-Aware Prioritization",
        description: "Considers story dependencies in priority calculation",
        version: "1.0.0",
        category: "task_management",
        nodes: [
            {
                id: "trigger",
                type: "trigger",
                position: { x: 100, y: 100 },
                data: {
                    eventType: "dependency_aware_prioritization_requested",
                },
            },
            {
                id: "load-dependency-graph",
                type: "action",
                position: { x: 300, y: 100 },
                data: {
                    actionType: "load_dependency_graph",
                    parameters: {
                        storyIds: "{{storyIds}}",
                    },
                },
            },
            {
                id: "calculate-critical-path",
                type: "action",
                position: { x: 500, y: 100 },
                data: {
                    actionType: "calculate_critical_path",
                    parameters: {
                        includeStories: "{{storyIds}}",
                    },
                },
            },
            {
                id: "prioritize-by-dependencies",
                type: "action",
                position: { x: 700, y: 100 },
                data: {
                    actionType: "prioritize_by_dependencies",
                    parameters: {
                        stories: "{{stories}}",
                        criticalPath: "{{criticalPath}}",
                        baseCriteria: "{{baseCriteria}}",
                    },
                },
            },
            {
                id: "validate-priorities",
                type: "condition",
                position: { x: 900, y: 100 },
                data: {
                    operator: "and",
                    conditions: [
                        { field: "priorityInversions", operator: "empty" },
                    ],
                },
            },
            {
                id: "apply-priorities",
                type: "action",
                position: { x: 1100, y: 100 },
                data: {
                    actionType: "batch_update_priorities",
                    parameters: {
                        updates: "{{priorityUpdates}}",
                    },
                },
            },
            {
                id: "notify-stakeholders",
                type: "notification",
                position: { x: 1300, y: 100 },
                data: {
                    recipients: "{{stakeholders}}",
                    subject: "Dependency-Aware Prioritization Complete",
                    message: "{{updatedCount}} stories have been re-prioritized based on dependencies",
                    type: "email",
                },
            },
        ],
        connections: [
            { id: "c1", sourceNodeId: "trigger", sourcePortId: "output", targetNodeId: "load-dependency-graph", targetPortId: "input" },
            { id: "c2", sourceNodeId: "load-dependency-graph", sourcePortId: "output", targetNodeId: "calculate-critical-path", targetPortId: "input" },
            { id: "c3", sourceNodeId: "calculate-critical-path", sourcePortId: "output", targetNodeId: "prioritize-by-dependencies", targetPortId: "input" },
            { id: "c4", sourceNodeId: "prioritize-by-dependencies", sourcePortId: "output", targetNodeId: "validate-priorities", targetPortId: "input" },
            { id: "c5", sourceNodeId: "validate-priorities", sourcePortId: "true", targetNodeId: "apply-priorities", targetPortId: "input" },
            { id: "c6", sourceNodeId: "apply-priorities", sourcePortId: "output", targetNodeId: "notify-stakeholders", targetPortId: "input" },
        ],
        variables: [
            { name: "storyIds", type: "array", scope: "local" },
            { name: "stories", type: "array", scope: "local" },
            { name: "criticalPath", type: "array", scope: "local" },
            { name: "baseCriteria", type: "object", scope: "local" },
            { name: "priorityUpdates", type: "array", scope: "local" },
            { name: "stakeholders", type: "array", scope: "local" },
            { name: "updatedCount", type: "number", scope: "local" },
        ],
        settings: {
            timeout: 900000,
            retryPolicy: {
                maxAttempts: 2,
                backoffMultiplier: 2,
                maxDelay: 60000,
            },
            errorHandling: "stop",
            logging: {
                enabled: true,
                level: "info",
                includeData: true,
            },
        },
        metadata: {
            tags: ["dependency", "prioritization", "critical-path"],
            author: "system",
            documentation: "Prioritizes stories considering dependencies and critical path impact",
        },
        enabled: true,
    },
    defaultVariables: [
        { name: "criticalPathBoost", type: "number", scope: "global", defaultValue: 1.2 },
        { name: "dependencyPenalty", type: "number", scope: "global", defaultValue: 0.9 },
    ],
};

export const storyPrioritizationTemplates: StoryPrioritizationTemplate[] = [
    StoryCreationWithPriorityTemplate,
    PriorityEvaluationWorkflowTemplate,
    DependencyAwarePrioritizationTemplate,
];

export function getStoryPrioritizationTemplate(id: string): StoryPrioritizationTemplate | undefined {
    return storyPrioritizationTemplates.find((t) => t.id === id);
}

export function listStoryPrioritizationTemplates(
    category?: StoryPrioritizationTemplate["category"],
): StoryPrioritizationTemplate[] {
    if (category) {
        return storyPrioritizationTemplates.filter((t) => t.category === category);
    }
    return storyPrioritizationTemplates;
}
