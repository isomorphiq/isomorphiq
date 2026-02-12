import type { Result } from "@isomorphiq/core";
import { ValidationError } from "@isomorphiq/core";
import { globalEventBus } from "@isomorphiq/core";
import type { TaskPriority } from "@isomorphiq/types";
import type {
    PriorityThresholdConfig,
    PriorityThresholdServiceConfig,
    PriorityThresholdEvaluationResult,
    PriorityTriggerEventLog,
    StoryTriggerState,
    PipelineExecutionRequest,
    PriorityThresholdServiceStats,
    PriorityThresholdLevel,
} from "./priority-threshold-types.ts";
import {
    PriorityThresholdConfigStruct,
    PriorityTriggerEventLogStruct,
    StoryTriggerStateStruct,
    PipelineExecutionRequestStruct,
} from "./priority-threshold-types.ts";
import { AutomaticTransitionLogger, getGlobalAutomaticTransitionLogger } from "./automatic-transition-logger.ts";

/**
 * Default priority weights for comparison operations
 */
const DEFAULT_PRIORITY_WEIGHTS: Record<TaskPriority | PriorityThresholdLevel, number> = {
    low: 1,
    medium: 2,
    high: 3,
    critical: 4,
};

/**
 * Default service configuration
 */
export const defaultPriorityThresholdServiceConfig: PriorityThresholdServiceConfig = {
    defaultDebounceMs: 1000,
    defaultCooldownMs: 3600000,
    defaultMaxTriggersPerStory: 10,
    enableLogging: true,
    maxLogEntries: 1000,
    batchProcessingIntervalMs: 500,
    enableRealTimeEvaluation: true,
};

/**
 * Priority Threshold Trigger Service
 * 
 * Evaluates configured priority thresholds and automatically triggers execution pipelines
 * when a story's priority meets or exceeds the defined level.
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class PriorityThresholdTriggerService {
    private config: PriorityThresholdServiceConfig;
    private thresholdConfigs: Map<string, PriorityThresholdConfig> = new Map();
    private storyTriggerStates: Map<string, StoryTriggerState> = new Map();
    private eventLogs: PriorityTriggerEventLog[] = [];
    private pendingRequests: Map<string, PipelineExecutionRequest> = new Map();
    private debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
    private batchProcessingTimer: ReturnType<typeof setInterval> | null = null;
    private pipelineExecutors: Map<string, (request: PipelineExecutionRequest) => Promise<Result<unknown>>> = new Map();
    private stats = {
        totalTriggers: 0,
        totalEvaluations: 0,
        lastEvaluationAt: undefined as Date | undefined,
        lastTriggerAt: undefined as Date | undefined,
    };
    private logger: AutomaticTransitionLogger;

    constructor(config: Partial<PriorityThresholdServiceConfig> = {}, logger?: AutomaticTransitionLogger) {
        this.config = { ...defaultPriorityThresholdServiceConfig, ...config };
        this.logger = logger || getGlobalAutomaticTransitionLogger();
        this.startBatchProcessing();
    }

    /**
     * Register a threshold configuration
     */
    registerThresholdConfig(config: PriorityThresholdConfig): Result<void> {
        try {
            const validatedConfig = PriorityThresholdConfigStruct.from(config);
            this.thresholdConfigs.set(validatedConfig.id, validatedConfig);
            return { success: true, data: undefined };
        } catch (error) {
            return {
                success: false,
                error: new ValidationError(
                    `Invalid threshold config: ${error instanceof Error ? error.message : String(error)}`,
                    "config",
                ),
            };
        }
    }

    /**
     * Remove a threshold configuration
     */
    unregisterThresholdConfig(configId: string): boolean {
        return this.thresholdConfigs.delete(configId);
    }

    /**
     * Get all threshold configurations
     */
    getThresholdConfigs(): PriorityThresholdConfig[] {
        return Array.from(this.thresholdConfigs.values());
    }

    /**
     * Get a specific threshold configuration
     */
    getThresholdConfig(configId: string): PriorityThresholdConfig | undefined {
        return this.thresholdConfigs.get(configId);
    }

    /**
     * Register a pipeline executor function
     */
    registerPipelineExecutor(
        pipelineId: string,
        executor: (request: PipelineExecutionRequest) => Promise<Result<unknown>>,
    ): void {
        this.pipelineExecutors.set(pipelineId, executor);
    }

    /**
     * Evaluate priority change against all registered thresholds
     * This is the main entry point for real-time priority change evaluation
     */
    async evaluatePriorityChange(
        storyId: string,
        previousPriority: TaskPriority | undefined,
        newPriority: TaskPriority,
        metadata?: Record<string, unknown>,
    ): Promise<PriorityThresholdEvaluationResult[]> {
        this.stats.totalEvaluations++;
        this.stats.lastEvaluationAt = new Date();

        const results: PriorityThresholdEvaluationResult[] = [];

        for (const config of this.thresholdConfigs.values()) {
            if (!config.enabled) {
                continue;
            }

            const result = await this.evaluateSingleThreshold(
                storyId,
                config,
                previousPriority,
                newPriority,
                metadata,
            );

            results.push(result);
        }

        return results;
    }

    /**
     * Evaluate a single threshold configuration
     */
    private async evaluateSingleThreshold(
        storyId: string,
        config: PriorityThresholdConfig,
        previousPriority: TaskPriority | undefined,
        newPriority: TaskPriority,
        metadata?: Record<string, unknown>,
    ): Promise<PriorityThresholdEvaluationResult> {
        const stateKey = `${storyId}-${config.id}`;
        let state = this.storyTriggerStates.get(stateKey);

        if (!state) {
            state = StoryTriggerStateStruct.from({
                storyId,
                thresholdConfigId: config.id,
                triggerCount: 0,
                pipelineExecutionIds: [],
            });
            this.storyTriggerStates.set(stateKey, state);
        }

        const priorityWeight = DEFAULT_PRIORITY_WEIGHTS[newPriority];
        const thresholdWeight = DEFAULT_PRIORITY_WEIGHTS[config.thresholdLevel];

        let shouldTrigger = false;
        let reason = "";
        let cooldownActive = false;
        let maxTriggersReached = false;

        // Check if priority meets threshold criteria
        const meetsThreshold = this.checkPriorityMeetsThreshold(
            priorityWeight,
            thresholdWeight,
            config.comparison,
        );

        if (!meetsThreshold) {
            reason = `Priority ${newPriority} (weight: ${priorityWeight}) does not meet threshold ${config.thresholdLevel} (weight: ${thresholdWeight}) with comparison ${config.comparison}`;
        } else {
            // Check cooldown period
            if (state.lastTriggeredAt) {
                const cooldownElapsed = Date.now() - state.lastTriggeredAt.getTime();
                if (cooldownElapsed < config.cooldownMs) {
                    cooldownActive = true;
                    reason = `Cooldown period active. ${Math.ceil((config.cooldownMs - cooldownElapsed) / 1000)}s remaining`;
                }
            }

            // Check max triggers limit
            if (state.triggerCount >= config.maxTriggersPerStory) {
                maxTriggersReached = true;
                reason = `Maximum triggers (${config.maxTriggersPerStory}) reached for this story`;
            }

            if (!cooldownActive && !maxTriggersReached) {
                const statusValue =
                    typeof metadata?.status === "string" ? metadata.status : undefined;
                const assigneeValue =
                    typeof metadata?.assignee === "string" ? metadata.assignee : undefined;
                const tagValue =
                    typeof metadata?.tags === "string" ? metadata.tags : undefined;

                if (
                    config.requiredStatus
                    && (!statusValue || !config.requiredStatus.includes(statusValue))
                ) {
                    shouldTrigger = false;
                    reason = statusValue
                        ? `Status ${statusValue} does not match required status`
                        : "Status condition not met";
                } else if (
                    config.requiredAssignee
                    && (!assigneeValue || assigneeValue !== config.requiredAssignee)
                ) {
                    shouldTrigger = false;
                    reason = `Assignee ${assigneeValue ?? "unknown"} does not match required assignee`;
                } else if (
                    config.requiredTags
                    && (!tagValue || !config.requiredTags.includes(tagValue))
                ) {
                    shouldTrigger = false;
                    reason = "Tags condition not met";
                } else {
                    shouldTrigger = true;
                    reason = `Priority ${newPriority} meets threshold ${config.thresholdLevel}`;
                }
            }
        }

        const result: PriorityThresholdEvaluationResult = {
            storyId,
            thresholdConfigId: config.id,
            shouldTrigger,
            reason,
            priorityWeight,
            thresholdWeight,
            comparison: config.comparison,
            cooldownActive,
            maxTriggersReached,
        };

        // Log the evaluation
        await this.logTriggerEvent({
            storyId,
            thresholdConfigId: config.id,
            previousPriority,
            newPriority,
            triggered: shouldTrigger,
            timestamp: new Date(),
            reason,
            metadata,
        });

        // Log automatic transition for threshold evaluation
        const executionId = `eval-${Date.now()}-${storyId}-${config.id}`;
        if (shouldTrigger) {
            this.logger.logThresholdMet(
                executionId,
                storyId,
                config.id,
                newPriority,
                { reason, priorityWeight, thresholdWeight, comparison: config.comparison },
            );
        } else {
            this.logger.logThresholdNotMet(executionId, storyId, config.id, reason);
        }

        // Schedule trigger if needed
        if (shouldTrigger) {
            this.scheduleTrigger(storyId, config, newPriority, result);
        }

        // Update state
        state.lastPriority = newPriority;
        this.storyTriggerStates.set(stateKey, state);

        return result;
    }

    /**
     * Check if priority meets threshold based on comparison operator
     */
    private checkPriorityMeetsThreshold(
        priorityWeight: number,
        thresholdWeight: number,
        comparison: "equals" | "greater_than_or_equal" | "greater_than",
    ): boolean {
        switch (comparison) {
            case "equals":
                return priorityWeight === thresholdWeight;
            case "greater_than_or_equal":
                return priorityWeight >= thresholdWeight;
            case "greater_than":
                return priorityWeight > thresholdWeight;
            default:
                return false;
        }
    }

    /**
     * Schedule a trigger with debouncing
     */
    private scheduleTrigger(
        storyId: string,
        config: PriorityThresholdConfig,
        priority: TaskPriority,
        evaluationResult: PriorityThresholdEvaluationResult,
    ): void {
        const debounceKey = `${storyId}-${config.id}`;

        // Clear existing timer
        const existingTimer = this.debounceTimers.get(debounceKey);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }

        // Set new timer
        const timer = setTimeout(() => {
            this.executeTrigger(storyId, config, priority, evaluationResult);
            this.debounceTimers.delete(debounceKey);
        }, config.debounceMs);

        this.debounceTimers.set(debounceKey, timer);
    }

    /**
     * Execute the trigger and create pipeline execution request
     */
    private async executeTrigger(
        storyId: string,
        config: PriorityThresholdConfig,
        priority: TaskPriority,
        evaluationResult: PriorityThresholdEvaluationResult,
    ): Promise<void> {
        const stateKey = `${storyId}-${config.id}`;
        const state = this.storyTriggerStates.get(stateKey);

        if (!state) {
            return;
        }

        // Create execution request
        const request = PipelineExecutionRequestStruct.from({
            id: `req-${Date.now()}-${storyId}-${config.id}`,
            storyId,
            thresholdConfigId: config.id,
            pipelineId: config.pipelineId,
            priority,
            requestedAt: new Date(),
            status: "pending",
        });

        this.pendingRequests.set(request.id, request);

        // Update state
        state.triggerCount++;
        state.lastTriggeredAt = new Date();
        state.pendingExecution = true;
        this.storyTriggerStates.set(stateKey, state);

        // Update stats
        this.stats.totalTriggers++;
        this.stats.lastTriggerAt = new Date();

        // Publish event - using task_priority_changed as the base event type
        // since priority_threshold_triggered is not in the DomainEvent union
        const event = {
            id: `priority_threshold_triggered_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
            type: "task_priority_changed" as const,
            timestamp: new Date(),
            data: {
                taskId: storyId,
                oldPriority: "low",
                newPriority: priority,
                task: {
                    id: storyId,
                    thresholdConfigId: config.id,
                    pipelineId: config.pipelineId,
                    requestId: request.id,
                    triggered: true,
                },
                updatedBy: "priority-threshold-service",
            },
        };
        await globalEventBus.publish(event);

        // Execute pipeline if executor is registered
        const executor = this.pipelineExecutors.get(config.pipelineId);
        if (executor) {
            await this.executePipeline(request, executor);
        }

        // Log the trigger
        await this.logTriggerEvent({
            storyId,
            thresholdConfigId: config.id,
            previousPriority: undefined,
            newPriority: priority,
            triggered: true,
            pipelineExecutionId: request.id,
            timestamp: new Date(),
            reason: `Pipeline execution scheduled: ${evaluationResult.reason}`,
        });
    }

    /**
     * Execute the pipeline
     */
    private async executePipeline(
        request: PipelineExecutionRequest,
        executor: (request: PipelineExecutionRequest) => Promise<Result<unknown>>,
    ): Promise<void> {
        request.status = "running";
        this.pendingRequests.set(request.id, request);

        try {
            const result = await executor(request);

            if (result.success) {
                request.status = "completed";
                request.completedAt = new Date();

                // Update state
                const stateKey = `${request.storyId}-${request.thresholdConfigId}`;
                const state = this.storyTriggerStates.get(stateKey);
                if (state) {
                    state.pendingExecution = false;
                    state.pipelineExecutionIds.push(request.id);
                    this.storyTriggerStates.set(stateKey, state);
                }
            } else {
                request.status = "failed";
                request.error = result.error?.message || "Pipeline execution failed";
            }
        } catch (error) {
            request.status = "failed";
            request.error = error instanceof Error ? error.message : String(error);
        }

        this.pendingRequests.set(request.id, request);
    }

    /**
     * Log a trigger event
     */
    private async logTriggerEvent(
        eventData: Omit<PriorityTriggerEventLog, "id">,
    ): Promise<void> {
        if (!this.config.enableLogging) {
            return;
        }

        const event = PriorityTriggerEventLogStruct.from({
            ...eventData,
            id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        });

        this.eventLogs.push(event);

        // Trim logs if exceeding max
        if (this.eventLogs.length > this.config.maxLogEntries) {
            this.eventLogs = this.eventLogs.slice(-this.config.maxLogEntries);
        }
    }

    /**
     * Start batch processing timer
     */
    private startBatchProcessing(): void {
        if (!this.config.enableRealTimeEvaluation) {
            return;
        }

        this.batchProcessingTimer = setInterval(() => {
            this.processPendingRequests();
        }, this.config.batchProcessingIntervalMs);
    }

    /**
     * Process pending pipeline execution requests
     */
    private async processPendingRequests(): Promise<void> {
        const pending = Array.from(this.pendingRequests.values()).filter(
            (req) => req.status === "pending",
        );

        for (const request of pending) {
            const executor = this.pipelineExecutors.get(request.pipelineId);
            if (executor) {
                await this.executePipeline(request, executor);
            }
        }
    }

    /**
     * Get event logs for a story
     */
    getEventLogs(storyId?: string): PriorityTriggerEventLog[] {
        if (storyId) {
            return this.eventLogs.filter((log) => log.storyId === storyId);
        }
        return [...this.eventLogs];
    }

    /**
     * Get trigger state for a story
     */
    getStoryTriggerState(storyId: string, configId: string): StoryTriggerState | undefined {
        return this.storyTriggerStates.get(`${storyId}-${configId}`);
    }

    /**
     * Get all trigger states for a story
     */
    getAllStoryTriggerStates(storyId: string): StoryTriggerState[] {
        return Array.from(this.storyTriggerStates.values()).filter(
            (state) => state.storyId === storyId,
        );
    }

    /**
     * Get pending execution requests
     */
    getPendingRequests(): PipelineExecutionRequest[] {
        return Array.from(this.pendingRequests.values()).filter(
            (req) => req.status === "pending" || req.status === "running",
        );
    }

    /**
     * Get service statistics
     */
    getStats(): PriorityThresholdServiceStats {
        const configs = Array.from(this.thresholdConfigs.values());
        const states = Array.from(this.storyTriggerStates.values());

        const totalTriggers = states.reduce((sum, state) => sum + state.triggerCount, 0);
        const avgTriggers = states.length > 0 ? totalTriggers / states.length : 0;

        return {
            totalConfigs: configs.length,
            enabledConfigs: configs.filter((c) => c.enabled).length,
            totalTriggers: this.stats.totalTriggers,
            totalEvaluations: this.stats.totalEvaluations,
            averageTriggersPerStory: avgTriggers,
            lastEvaluationAt: this.stats.lastEvaluationAt,
            lastTriggerAt: this.stats.lastTriggerAt,
        };
    }

    /**
     * Reset story trigger state (useful for testing or manual reset)
     */
    resetStoryTriggerState(storyId: string, configId: string): boolean {
        const stateKey = `${storyId}-${configId}`;
        const state = this.storyTriggerStates.get(stateKey);

        if (state) {
            state.triggerCount = 0;
            state.lastTriggeredAt = undefined;
            state.pendingExecution = false;
            this.storyTriggerStates.set(stateKey, state);
            return true;
        }

        return false;
    }

    /**
     * Clear all event logs
     */
    clearEventLogs(): void {
        this.eventLogs = [];
    }

    /**
     * Stop the service and cleanup
     */
    stop(): void {
        // Clear all debounce timers
        for (const timer of this.debounceTimers.values()) {
            clearTimeout(timer);
        }
        this.debounceTimers.clear();

        // Clear batch processing timer
        if (this.batchProcessingTimer) {
            clearInterval(this.batchProcessingTimer);
            this.batchProcessingTimer = null;
        }
    }

    /**
     * Create a default threshold configuration
     */
    static createDefaultConfig(
        name: string,
        thresholdLevel: PriorityThresholdLevel,
        pipelineId: string,
        createdBy: string,
    ): PriorityThresholdConfig {
        return PriorityThresholdConfigStruct.from({
            id: `threshold-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
            name,
            thresholdLevel,
            pipelineId,
            enabled: true,
            debounceMs: 1000,
            maxTriggersPerStory: 10,
            cooldownMs: 3600000,
            requireConfirmation: false,
            createdAt: new Date(),
            updatedAt: new Date(),
            createdBy,
        });
    }
}

/**
 * Factory function to create a configured service instance
 */
export function createPriorityThresholdTriggerService(
    config?: Partial<PriorityThresholdServiceConfig>,
): PriorityThresholdTriggerService {
    return new PriorityThresholdTriggerService(config);
}

/**
 * Singleton instance for global use
 */
let globalService: PriorityThresholdTriggerService | null = null;

export function getGlobalPriorityThresholdTriggerService(): PriorityThresholdTriggerService {
    if (!globalService) {
        globalService = new PriorityThresholdTriggerService();
    }
    return globalService;
}

export function setGlobalPriorityThresholdTriggerService(service: PriorityThresholdTriggerService): void {
    globalService = service;
}

