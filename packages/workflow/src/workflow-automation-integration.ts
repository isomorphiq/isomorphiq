import type { Result } from "@isomorphiq/core";
import { ValidationError } from "@isomorphiq/core";
import type {
    StoryWorkflowTriggerType,
} from "./story-prioritization-types.ts";
import type { WorkflowExecution, WorkflowNodeExecution } from "./types.ts";
import type {
    PriorityThresholdConfig,
    PriorityThresholdServiceConfig,
    PriorityThresholdEvaluationResult,
} from "./priority-threshold-types.ts";
import {
    PriorityThresholdTriggerService,
    createPriorityThresholdTriggerService,
} from "./priority-threshold-trigger-service.ts";

export interface WorkflowTriggerAdapterConfig {
    enabled: boolean;
    eventBufferSize: number;
    processingIntervalMs: number;
    maxRetries: number;
}

export const defaultWorkflowTriggerAdapterConfig: WorkflowTriggerAdapterConfig = {
    enabled: true,
    eventBufferSize: 1000,
    processingIntervalMs: 100,
    maxRetries: 3,
};

export interface AutomationEvent {
    id: string;
    type: StoryWorkflowTriggerType;
    storyId?: string;
    storyIds?: string[];
    workflowId: string;
    timestamp: Date;
    data: Record<string, unknown>;
    processed: boolean;
    retryCount: number;
}

export interface AutomationAction {
    id: string;
    type: string;
    parameters: Record<string, unknown>;
    execute: () => Promise<Result<unknown>>;
}

/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class WorkflowTriggerAdapter {
    private config: WorkflowTriggerAdapterConfig;
    private eventBuffer: AutomationEvent[] = [];
    private processingTimer: ReturnType<typeof setInterval> | null = null;
    private eventHandlers: Map<StoryWorkflowTriggerType, Array<(event: AutomationEvent) => Promise<void>>> = new Map();

    constructor(config: Partial<WorkflowTriggerAdapterConfig> = {}) {
        this.config = { ...defaultWorkflowTriggerAdapterConfig, ...config };
    }

    start(): void {
        if (!this.config.enabled || this.processingTimer) {
            return;
        }

        this.processingTimer = setInterval(() => {
            this.processEvents();
        }, this.config.processingIntervalMs);
    }

    stop(): void {
        if (this.processingTimer) {
            clearInterval(this.processingTimer);
            this.processingTimer = null;
        }
    }

    convertWorkflowStateChangeToEvent(
        execution: WorkflowExecution,
        nodeExecution: WorkflowNodeExecution,
    ): Result<AutomationEvent> {
        const eventType = this.inferEventType(nodeExecution);
        if (!eventType) {
            return {
                success: false,
                error: new ValidationError(
                    `Cannot infer event type from node execution: ${nodeExecution.nodeId}`,
                    "nodeExecution",
                ),
            };
        }

        const event: AutomationEvent = {
            id: `event-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            type: eventType,
            workflowId: execution.workflowId,
            timestamp: new Date(),
            data: {
                executionId: execution.id,
                nodeId: nodeExecution.nodeId,
                nodeStatus: nodeExecution.status,
                context: execution.context,
            },
            processed: false,
            retryCount: 0,
        };

        if (execution.triggerData.storyId) {
            event.storyId = execution.triggerData.storyId as string;
        }
        if (execution.triggerData.storyIds) {
            event.storyIds = execution.triggerData.storyIds as string[];
        }

        return { success: true, data: event };
    }

    private inferEventType(nodeExecution: WorkflowNodeExecution): StoryWorkflowTriggerType | null {
        const actionType = nodeExecution.output?.actionType as string;
        if (!actionType) {
            return null;
        }

        const actionToEventMap: Record<string, StoryWorkflowTriggerType> = {
            evaluate_priority: "evaluation_completed",
            load_story: "story_status_changed",
            batch_update_priorities: "batch_priority_update",
            resolve_conflicts: "story_priority_changed",
        };

        return actionToEventMap[actionType] || null;
    }

    queueEvent(event: AutomationEvent): void {
        if (this.eventBuffer.length >= this.config.eventBufferSize) {
            this.eventBuffer.shift();
        }
        this.eventBuffer.push(event);
    }

    registerEventHandler(
        eventType: StoryWorkflowTriggerType,
        handler: (event: AutomationEvent) => Promise<void>,
    ): void {
        const handlers = this.eventHandlers.get(eventType) || [];
        handlers.push(handler);
        this.eventHandlers.set(eventType, handlers);
    }

    private async processEvents(): Promise<void> {
        const unprocessedEvents = this.eventBuffer.filter((e) => !e.processed);

        for (const event of unprocessedEvents) {
            const handlers = this.eventHandlers.get(event.type) || [];

            for (const handler of handlers) {
                try {
                    await handler(event);
                    event.processed = true;
                } catch (error) {
                    event.retryCount++;
                    if (event.retryCount >= this.config.maxRetries) {
                        event.processed = true;
                        console.error(`Event ${event.id} failed after ${this.config.maxRetries} retries:`, error);
                    }
                }
            }
        }

        this.eventBuffer = this.eventBuffer.filter((e) => !e.processed);
    }

    getPendingEvents(): AutomationEvent[] {
        return this.eventBuffer.filter((e) => !e.processed);
    }

    getEventStats(): { total: number; pending: number; processed: number } {
        return {
            total: this.eventBuffer.length,
            pending: this.eventBuffer.filter((e) => !e.processed).length,
            processed: this.eventBuffer.filter((e) => e.processed).length,
        };
    }

    clearBuffer(): void {
        this.eventBuffer = [];
    }
}

/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class AutomationActionExecutor {
    private actions: Map<string, AutomationAction> = new Map();

    registerAction(action: AutomationAction): void {
        this.actions.set(action.id, action);
    }

    async executeAction(actionId: string): Promise<Result<unknown>> {
        const action = this.actions.get(actionId);
        if (!action) {
            return {
                success: false,
                error: new ValidationError(`Action ${actionId} not found`, "actionId"),
            };
        }

        try {
            const result = await action.execute();
            return result;
        } catch (error) {
            return {
                success: false,
                error: new ValidationError(
                    `Action execution failed: ${error instanceof Error ? error.message : String(error)}`,
                    "execution",
                ),
            };
        }
    }

    async executeActionsInSequence(actionIds: string[]): Promise<Result<unknown[]>> {
        const results: unknown[] = [];
        const errors: string[] = [];

        for (const actionId of actionIds) {
            const result = await this.executeAction(actionId);
            if (result.success) {
                results.push(result.data);
            } else {
                errors.push(`${actionId}: ${result.error.message}`);
            }
        }

        if (errors.length > 0) {
            return {
                success: false,
                error: new ValidationError(`Some actions failed: ${errors.join("; ")}`, "batch"),
            };
        }

        return { success: true, data: results };
    }

    listActions(): string[] {
        return Array.from(this.actions.keys());
    }

    unregisterAction(actionId: string): boolean {
        return this.actions.delete(actionId);
    }
}

export interface PriorityChangeAutomationConfig {
    autoAdjustDependentStories: boolean;
    notifyStakeholders: boolean;
    requireApprovalForHighPriority: boolean;
}

export const defaultPriorityChangeAutomationConfig: PriorityChangeAutomationConfig = {
    autoAdjustDependentStories: true,
    notifyStakeholders: true,
    requireApprovalForHighPriority: true,
};

/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class PriorityChangeAutomation {
    private config: PriorityChangeAutomationConfig;

    constructor(config: Partial<PriorityChangeAutomationConfig> = {}) {
        this.config = { ...defaultPriorityChangeAutomationConfig, ...config };
    }

    async onPriorityChanged(
        storyId: string,
        oldPriority: "low" | "medium" | "high",
        newPriority: "low" | "medium" | "high",
        changedBy: string,
    ): Promise<Result<{ notificationsSent: number; dependentStoriesAdjusted: number }>> {
        const result = {
            notificationsSent: 0,
            dependentStoriesAdjusted: 0,
        };

        if (this.config.notifyStakeholders) {
            result.notificationsSent = await this.notifyStakeholders(storyId, oldPriority, newPriority, changedBy);
        }

        if (this.config.autoAdjustDependentStories) {
            result.dependentStoriesAdjusted = await this.adjustDependentStories(storyId, newPriority);
        }

        return { success: true, data: result };
    }

    private async notifyStakeholders(
        storyId: string,
        oldPriority: string,
        newPriority: string,
        changedBy: string,
    ): Promise<number> {
        console.log(`Notifying stakeholders: Story ${storyId} priority changed from ${oldPriority} to ${newPriority} by ${changedBy}`);
        return 1;
    }

    private async adjustDependentStories(storyId: string, newPriority: "low" | "medium" | "high"): Promise<number> {
        console.log(`Adjusting dependent stories for ${storyId} based on new priority ${newPriority}`);
        return 0;
    }
}

export interface DependencySatisfactionAutomationConfig {
    autoPromoteBlockedStories: boolean;
    notifyWhenUnblocked: boolean;
    recalculatePrioritiesOnSatisfaction: boolean;
}

export const defaultDependencySatisfactionAutomationConfig: DependencySatisfactionAutomationConfig = {
    autoPromoteBlockedStories: false,
    notifyWhenUnblocked: true,
    recalculatePrioritiesOnSatisfaction: true,
};

/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class DependencySatisfactionAutomation {
    private config: DependencySatisfactionAutomationConfig;

    constructor(config: Partial<DependencySatisfactionAutomationConfig> = {}) {
        this.config = { ...defaultDependencySatisfactionAutomationConfig, ...config };
    }

    async onDependenciesSatisfied(
        storyId: string,
        satisfiedDependencies: string[],
    ): Promise<Result<{ storiesUnblocked: number; prioritiesRecalculated: number }>> {
        const result = {
            storiesUnblocked: 0,
            prioritiesRecalculated: 0,
        };

        if (this.config.notifyWhenUnblocked) {
            await this.notifyStoryUnblocked(storyId, satisfiedDependencies);
        }

        if (this.config.autoPromoteBlockedStories) {
            result.storiesUnblocked = await this.promoteBlockedStories(storyId);
        }

        if (this.config.recalculatePrioritiesOnSatisfaction) {
            result.prioritiesRecalculated = await this.recalculatePriorities(storyId);
        }

        return { success: true, data: result };
    }

    private async notifyStoryUnblocked(storyId: string, dependencies: string[]): Promise<void> {
        console.log(`Story ${storyId} unblocked. Satisfied dependencies: ${dependencies.join(", ")}`);
    }

    private async promoteBlockedStories(storyId: string): Promise<number> {
        console.log(`Promoting blocked stories dependent on ${storyId}`);
        return 0;
    }

    private async recalculatePriorities(storyId: string): Promise<number> {
        console.log(`Recalculating priorities for stories affected by ${storyId}`);
        return 0;
    }
}

/**
 * Priority Threshold Automation
 * 
 * Integrates priority threshold triggers with the workflow automation system
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class PriorityThresholdAutomation {
    private service: PriorityThresholdTriggerService;

    constructor(config?: Partial<PriorityThresholdServiceConfig>) {
        this.service = createPriorityThresholdTriggerService(config);
    }

    /**
     * Register a threshold configuration
     */
    registerThreshold(config: PriorityThresholdConfig): Result<void> {
        return this.service.registerThresholdConfig(config);
    }

    /**
     * Get the underlying service for advanced operations
     */
    getService(): PriorityThresholdTriggerService {
        return this.service;
    }

    /**
     * Evaluate priority change and trigger pipelines if thresholds are met
     */
    async onPriorityChanged(
        storyId: string,
        oldPriority: "low" | "medium" | "high",
        newPriority: "low" | "medium" | "high",
        metadata?: Record<string, unknown>,
    ): Promise<Result<PriorityThresholdEvaluationResult[]>> {
        try {
            const results = await this.service.evaluatePriorityChange(
                storyId,
                oldPriority,
                newPriority,
                metadata,
            );
            return { success: true, data: results };
        } catch (error) {
            return {
                success: false,
                error: new ValidationError(
                    `Priority threshold evaluation failed: ${error instanceof Error ? error.message : String(error)}`,
                    "priority_threshold",
                ),
            };
        }
    }

    /**
     * Stop the automation service
     */
    stop(): void {
        this.service.stop();
    }
}

export function createWorkflowAutomationIntegration(
    triggerConfig?: Partial<WorkflowTriggerAdapterConfig>,
    priorityConfig?: Partial<PriorityChangeAutomationConfig>,
    dependencyConfig?: Partial<DependencySatisfactionAutomationConfig>,
    thresholdConfig?: Partial<PriorityThresholdServiceConfig>,
): {
    triggerAdapter: WorkflowTriggerAdapter;
    actionExecutor: AutomationActionExecutor;
    priorityAutomation: PriorityChangeAutomation;
    dependencyAutomation: DependencySatisfactionAutomation;
    thresholdAutomation: PriorityThresholdAutomation;
} {
    const triggerAdapter = new WorkflowTriggerAdapter(triggerConfig);
    const actionExecutor = new AutomationActionExecutor();
    const priorityAutomation = new PriorityChangeAutomation(priorityConfig);
    const dependencyAutomation = new DependencySatisfactionAutomation(dependencyConfig);
    const thresholdAutomation = new PriorityThresholdAutomation(thresholdConfig);

    return {
        triggerAdapter,
        actionExecutor,
        priorityAutomation,
        dependencyAutomation,
        thresholdAutomation,
    };
}

