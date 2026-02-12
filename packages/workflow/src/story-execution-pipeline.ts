import type { Result } from "@isomorphiq/core";
import { ValidationError } from "@isomorphiq/core";
import type { WorkflowDefinition, WorkflowExecution, WorkflowNodeExecution } from "./types.ts";
import { AutomaticTransitionLogger, getGlobalAutomaticTransitionLogger } from "./automatic-transition-logger.ts";

export interface PipelineTriggerConfig {
    eventTypes: string[];
    conditions: Record<string, unknown>;
    enabled: boolean;
}

export interface PipelineStage {
    id: string;
    name: string;
    nodeIds: string[];
    dependsOn: string[];
    timeout: number;
    retryPolicy: {
        maxAttempts: number;
        backoffMultiplier: number;
        maxDelay: number;
    };
}

export interface PipelineDefinition {
    id: string;
    name: string;
    workflowId: string;
    stages: PipelineStage[];
    triggers: PipelineTriggerConfig[];
    globalTimeout: number;
    enabled: boolean;
}

/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class PipelineTrigger {
    private config: PipelineTriggerConfig;
    private listeners: Array<(data: Record<string, unknown>) => void> = [];

    constructor(config: PipelineTriggerConfig) {
        this.config = config;
    }

    shouldTrigger(eventType: string, eventData: Record<string, unknown>): boolean {
        if (!this.config.enabled) {
            return false;
        }

        if (!this.config.eventTypes.includes(eventType)) {
            return false;
        }

        for (const [key, value] of Object.entries(this.config.conditions)) {
            if (eventData[key] !== value) {
                return false;
            }
        }

        return true;
    }

    onTrigger(callback: (data: Record<string, unknown>) => void): void {
        this.listeners.push(callback);
    }

    trigger(data: Record<string, unknown>): void {
        for (const listener of this.listeners) {
            listener(data);
        }
    }
}

export interface StageExecutionResult {
    stageId: string;
    success: boolean;
    nodeResults: WorkflowNodeExecution[];
    duration: number;
    error?: string;
}

/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class StageExecutor {
    private stage: PipelineStage;
    private execution: WorkflowExecution;
    private attemptCount: number = 0;

    constructor(stage: PipelineStage, execution: WorkflowExecution) {
        this.stage = stage;
        this.execution = execution;
    }

    async execute(): Promise<Result<StageExecutionResult>> {
        const startTime = Date.now();
        this.attemptCount = 0;

        while (this.attemptCount < this.stage.retryPolicy.maxAttempts) {
            this.attemptCount++;

            try {
                const nodeResults: WorkflowNodeExecution[] = [];

                for (const nodeId of this.stage.nodeIds) {
                    const nodeResult = await this.executeNode(nodeId);
                    nodeResults.push(nodeResult);

                    if (nodeResult.status === "failed") {
                        throw new Error(`Node ${nodeId} failed: ${nodeResult.error?.message || "Unknown error"}`);
                    }
                }

                const duration = Date.now() - startTime;

                return {
                    success: true,
                    data: {
                        stageId: this.stage.id,
                        success: true,
                        nodeResults,
                        duration,
                    },
                };
            } catch (error) {
                if (this.attemptCount >= this.stage.retryPolicy.maxAttempts) {
                    const duration = Date.now() - startTime;
                    return {
                        success: false,
                        error: new ValidationError(
                            `Stage ${this.stage.id} failed after ${this.attemptCount} attempts: ${error instanceof Error ? error.message : String(error)}`,
                            "stage",
                        ),
                    };
                }

                const delay = Math.min(
                    this.stage.retryPolicy.maxDelay,
                    1000 * Math.pow(this.stage.retryPolicy.backoffMultiplier, this.attemptCount - 1),
                );
                await this.sleep(delay);
            }
        }

        return {
            success: false,
            error: new ValidationError(`Stage ${this.stage.id} exhausted all retry attempts`, "stage"),
        };
    }

    private async executeNode(nodeId: string): Promise<WorkflowNodeExecution> {
        const nodeExecution: WorkflowNodeExecution = {
            nodeId,
            status: "running",
            startedAt: new Date(),
            input: {},
            logs: [],
        };

        try {
            await this.sleep(100);

            nodeExecution.status = "completed";
            nodeExecution.completedAt = new Date();
            nodeExecution.duration = Date.now() - nodeExecution.startedAt.getTime();
            nodeExecution.output = { success: true };

            return nodeExecution;
        } catch (error) {
            nodeExecution.status = "failed";
            nodeExecution.completedAt = new Date();
            nodeExecution.error = {
                code: "EXECUTION_ERROR",
                message: error instanceof Error ? error.message : String(error),
                timestamp: new Date(),
            };

            return nodeExecution;
        }
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    getAttemptCount(): number {
        return this.attemptCount;
    }
}

export interface PipelineExecutionStatus {
    pipelineId: string;
    executionId: string;
    status: "pending" | "running" | "completed" | "failed" | "cancelled";
    currentStage?: string;
    completedStages: string[];
    failedStages: string[];
    startTime: Date;
    endTime?: Date;
    progress: number;
}

/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class PipelineMonitor {
    private executions: Map<string, PipelineExecutionStatus> = new Map();
    private listeners: Array<(status: PipelineExecutionStatus) => void> = [];

    startExecution(pipelineId: string, executionId: string): PipelineExecutionStatus {
        const status: PipelineExecutionStatus = {
            pipelineId,
            executionId,
            status: "running",
            completedStages: [],
            failedStages: [],
            startTime: new Date(),
            progress: 0,
        };

        this.executions.set(executionId, status);
        this.notifyListeners(status);

        return status;
    }

    updateStageProgress(executionId: string, stageId: string, completed: boolean, failed: boolean = false): void {
        const status = this.executions.get(executionId);
        if (!status) {
            return;
        }

        status.currentStage = stageId;

        if (completed && !status.completedStages.includes(stageId)) {
            status.completedStages.push(stageId);
        }

        if (failed && !status.failedStages.includes(stageId)) {
            status.failedStages.push(stageId);
        }

        this.notifyListeners(status);
    }

    completeExecution(executionId: string, success: boolean): void {
        const status = this.executions.get(executionId);
        if (!status) {
            return;
        }

        status.status = success ? "completed" : "failed";
        status.endTime = new Date();
        status.progress = 100;

        this.notifyListeners(status);
    }

    cancelExecution(executionId: string): void {
        const status = this.executions.get(executionId);
        if (!status) {
            return;
        }

        status.status = "cancelled";
        status.endTime = new Date();

        this.notifyListeners(status);
    }

    onStatusChange(callback: (status: PipelineExecutionStatus) => void): void {
        this.listeners.push(callback);
    }

    private notifyListeners(status: PipelineExecutionStatus): void {
        for (const listener of this.listeners) {
            listener(status);
        }
    }

    getExecutionStatus(executionId: string): PipelineExecutionStatus | undefined {
        return this.executions.get(executionId);
    }

    getAllExecutions(): PipelineExecutionStatus[] {
        return Array.from(this.executions.values());
    }

    getExecutionsForPipeline(pipelineId: string): PipelineExecutionStatus[] {
        return Array.from(this.executions.values()).filter((e) => e.pipelineId === pipelineId);
    }
}

export interface PipelineRecoveryStrategy {
    type: "retry" | "skip" | "rollback" | "manual";
    config: Record<string, unknown>;
}

/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class PipelineRecovery {
    private strategies: Map<string, PipelineRecoveryStrategy> = new Map();

    registerStrategy(stageId: string, strategy: PipelineRecoveryStrategy): void {
        this.strategies.set(stageId, strategy);
    }

    async recoverFromFailure(
        stageId: string,
        error: Error,
        context: Record<string, unknown>,
    ): Promise<Result<{ recovered: boolean; action: string }>> {
        const strategy = this.strategies.get(stageId);

        if (!strategy) {
            return {
                success: false,
                error: new ValidationError(`No recovery strategy for stage ${stageId}`, "stageId"),
            };
        }

        switch (strategy.type) {
            case "retry":
                return { success: true, data: { recovered: true, action: "retry" } };

            case "skip":
                return { success: true, data: { recovered: true, action: "skip" } };

            case "rollback":
                await this.performRollback(stageId, context);
                return { success: true, data: { recovered: true, action: "rollback" } };

            case "manual":
                return { success: true, data: { recovered: false, action: "manual_intervention_required" } };

            default:
                return {
                    success: false,
                    error: new ValidationError(`Unknown recovery strategy type: ${strategy.type}`, "strategy"),
                };
        }
    }

    private async performRollback(stageId: string, context: Record<string, unknown>): Promise<void> {
        console.log(`Performing rollback for stage ${stageId}`, context);
    }

    getStrategy(stageId: string): PipelineRecoveryStrategy | undefined {
        return this.strategies.get(stageId);
    }
}

/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class StoryExecutionPipeline {
    private definition: PipelineDefinition;
    private triggers: PipelineTrigger[] = [];
    private monitor: PipelineMonitor;
    private recovery: PipelineRecovery;
    private logger: AutomaticTransitionLogger;

    constructor(definition: PipelineDefinition, logger?: AutomaticTransitionLogger) {
        this.definition = definition;
        this.monitor = new PipelineMonitor();
        this.recovery = new PipelineRecovery();
        this.logger = logger || getGlobalAutomaticTransitionLogger();

        for (const triggerConfig of definition.triggers) {
            this.triggers.push(new PipelineTrigger(triggerConfig));
        }
    }

    async execute(triggerData: Record<string, unknown>): Promise<Result<PipelineExecutionStatus>> {
        if (!this.definition.enabled) {
            return {
                success: false,
                error: new ValidationError(`Pipeline ${this.definition.id} is disabled`, "pipeline"),
            };
        }

        const executionId = `exec-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        const storyId = triggerData.storyId as string | undefined;

        // Log pipeline trigger
        this.logger.logPipelineTriggered(
            executionId,
            this.definition.id,
            "event_triggered",
            storyId,
            { triggerData },
        );

        const status = this.monitor.startExecution(this.definition.id, executionId);
        const executedStages = new Set<string>();

        try {
            for (const stage of this.definition.stages) {
                const canExecute = stage.dependsOn.every((depId) => executedStages.has(depId));

                if (!canExecute) {
                    throw new Error(`Stage ${stage.id} has unmet dependencies: ${stage.dependsOn.filter((d) => !executedStages.has(d)).join(", ")}`);
                }

                this.monitor.updateStageProgress(executionId, stage.id, false);

                const mockExecution = {} as WorkflowExecution;
                const executor = new StageExecutor(stage, mockExecution);
                const result = await executor.execute();

                if (!result.success) {
                    // Log stage failure
                    this.logger.logStageFailed(
                        executionId,
                        this.definition.id,
                        stage.id,
                        {
                            code: "STAGE_EXECUTION_ERROR",
                            message: result.error.message,
                        },
                        storyId,
                    );

                    const recoveryResult = await this.recovery.recoverFromFailure(
                        stage.id,
                        new Error(result.error.message),
                        triggerData,
                    );

                    if (!recoveryResult.success || !recoveryResult.data.recovered) {
                        this.monitor.updateStageProgress(executionId, stage.id, false, true);
                        this.monitor.completeExecution(executionId, false);

                        // Log pipeline failure
                        this.logger.logTransition(
                            "workflow_failed",
                            "system_initiated",
                            "failed",
                            executionId,
                            {
                                pipelineId: this.definition.id,
                                storyId,
                                error: {
                                    code: "PIPELINE_EXECUTION_ERROR",
                                    message: `Pipeline failed at stage ${stage.id}: ${result.error.message}`,
                                },
                            },
                        );

                        return {
                            success: false,
                            error: new ValidationError(
                                `Pipeline failed at stage ${stage.id}: ${result.error.message}`,
                                "pipeline",
                            ),
                        };
                    } else {
                        // Log recovery
                        this.logger.logStageRecovered(
                            executionId,
                            this.definition.id,
                            stage.id,
                            recoveryResult.data.action,
                            storyId,
                        );
                    }
                } else {
                    // Log stage completion
                    this.logger.logStageCompleted(
                        executionId,
                        this.definition.id,
                        stage.id,
                        result.data.duration,
                        storyId,
                    );
                }

                executedStages.add(stage.id);
                this.monitor.updateStageProgress(executionId, stage.id, true);
            }

            this.monitor.completeExecution(executionId, true);

            // Log pipeline completion
            const endTime = new Date();
            const duration = endTime.getTime() - status.startTime.getTime();
            this.logger.logTransition(
                "workflow_completed",
                "system_initiated",
                "completed",
                executionId,
                {
                    pipelineId: this.definition.id,
                    storyId,
                    duration,
                    details: {
                        completedStages: Array.from(executedStages),
                    },
                },
            );

            return { success: true, data: this.monitor.getExecutionStatus(executionId)! };
        } catch (error) {
            this.monitor.completeExecution(executionId, false);

            // Log pipeline failure
            this.logger.logTransition(
                "workflow_failed",
                "system_initiated",
                "failed",
                executionId,
                {
                    pipelineId: this.definition.id,
                    storyId,
                    error: {
                        code: "PIPELINE_EXECUTION_ERROR",
                        message: error instanceof Error ? error.message : String(error),
                    },
                },
            );

            return {
                success: false,
                error: new ValidationError(
                    `Pipeline execution failed: ${error instanceof Error ? error.message : String(error)}`,
                    "pipeline",
                ),
            };
        }
    }

    onEvent(eventType: string, eventData: Record<string, unknown>): void {
        for (const trigger of this.triggers) {
            if (trigger.shouldTrigger(eventType, eventData)) {
                trigger.trigger(eventData);
            }
        }
    }

    getMonitor(): PipelineMonitor {
        return this.monitor;
    }

    getRecovery(): PipelineRecovery {
        return this.recovery;
    }

    registerRecoveryStrategy(stageId: string, strategy: PipelineRecoveryStrategy): void {
        this.recovery.registerStrategy(stageId, strategy);
    }
}

export function createStoryExecutionPipeline(
    workflowDefinition: WorkflowDefinition,
    stages: PipelineStage[],
    triggers: PipelineTriggerConfig[],
): StoryExecutionPipeline {
    const pipelineDefinition: PipelineDefinition = {
        id: `pipeline-${workflowDefinition.id}`,
        name: `Pipeline for ${workflowDefinition.name}`,
        workflowId: workflowDefinition.id,
        stages,
        triggers,
        globalTimeout: workflowDefinition.settings.timeout || 300000,
        enabled: workflowDefinition.enabled,
    };

    return new StoryExecutionPipeline(pipelineDefinition);
}

