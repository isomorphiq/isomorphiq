import { v4 as uuidv4 } from "uuid";
import type {
    AutomaticTransitionLogEntry,
    AutomaticTransitionLogQuery,
    AutomaticTransitionLogStats,
    AutomaticTransitionType,
    AutomaticTransitionReason,
    AutomaticTransitionStatus,
} from "./automatic-transition-types.ts";
import { AutomaticTransitionLogEntryStruct } from "./automatic-transition-types.ts";

export interface AutomaticTransitionLoggerConfig {
    enabled: boolean;
    maxLogEntries: number;
    enableConsoleOutput: boolean;
    logLevel: "debug" | "info" | "warn" | "error";
}

export const defaultAutomaticTransitionLoggerConfig: AutomaticTransitionLoggerConfig = {
    enabled: true,
    maxLogEntries: 10000,
    enableConsoleOutput: true,
    logLevel: "info",
};

/**
 * Automatic Transition Logger
 * 
 * Comprehensive logging system for all automatic pipeline executions.
 * Ensures traceability and auditability of automatic transitions.
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class AutomaticTransitionLogger {
    private config: AutomaticTransitionLoggerConfig;
    private logEntries: AutomaticTransitionLogEntry[] = [];
    private listeners: Array<(entry: AutomaticTransitionLogEntry) => void> = [];

    constructor(config: Partial<AutomaticTransitionLoggerConfig> = {}) {
        this.config = { ...defaultAutomaticTransitionLoggerConfig, ...config };
    }

    /**
     * Log an automatic transition
     */
    logTransition(
        transitionType: AutomaticTransitionType,
        reason: AutomaticTransitionReason,
        status: AutomaticTransitionStatus,
        executionId: string,
        options: {
            pipelineId?: string;
            stageId?: string;
            storyId?: string;
            taskId?: string;
            workflowId?: string;
            nodeId?: string;
            details?: Record<string, unknown>;
            metadata?: {
                triggeredBy?: string;
                source?: "manual" | "automatic" | "scheduled" | "event";
                correlationId?: string;
                parentExecutionId?: string;
            };
            duration?: number;
            error?: {
                code: string;
                message: string;
                stack?: string;
            };
        } = {},
    ): AutomaticTransitionLogEntry {
        if (!this.config.enabled) {
            return this.createEmptyEntry();
        }

        const entry = AutomaticTransitionLogEntryStruct.from({
            id: uuidv4(),
            timestamp: new Date(),
            transitionType,
            reason,
            status,
            executionId,
            pipelineId: options.pipelineId,
            stageId: options.stageId,
            storyId: options.storyId,
            taskId: options.taskId,
            workflowId: options.workflowId,
            nodeId: options.nodeId,
            details: options.details,
            metadata: options.metadata,
            duration: options.duration,
            error: options.error,
        });

        this.logEntries.push(entry);

        // Trim logs if exceeding max
        if (this.logEntries.length > this.config.maxLogEntries) {
            this.logEntries = this.logEntries.slice(-this.config.maxLogEntries);
        }

        // Console output
        if (this.config.enableConsoleOutput) {
            this.outputToConsole(entry);
        }

        // Notify listeners
        this.notifyListeners(entry);

        return entry;
    }

    /**
     * Log a pipeline trigger event
     */
    logPipelineTriggered(
        executionId: string,
        pipelineId: string,
        reason: AutomaticTransitionReason,
        storyId?: string,
        details?: Record<string, unknown>,
    ): AutomaticTransitionLogEntry {
        return this.logTransition(
            "pipeline_triggered",
            reason,
            "in_progress",
            executionId,
            {
                pipelineId,
                storyId,
                details,
                metadata: {
                    source: "automatic",
                    triggeredBy: "system",
                },
            },
        );
    }

    /**
     * Log a stage completion
     */
    logStageCompleted(
        executionId: string,
        pipelineId: string,
        stageId: string,
        duration: number,
        storyId?: string,
    ): AutomaticTransitionLogEntry {
        return this.logTransition(
            "stage_completed",
            "system_initiated",
            "completed",
            executionId,
            {
                pipelineId,
                stageId,
                storyId,
                duration,
                metadata: {
                    source: "automatic",
                    triggeredBy: "system",
                },
            },
        );
    }

    /**
     * Log a stage failure
     */
    logStageFailed(
        executionId: string,
        pipelineId: string,
        stageId: string,
        error: { code: string; message: string; stack?: string },
        storyId?: string,
    ): AutomaticTransitionLogEntry {
        return this.logTransition(
            "stage_failed",
            "system_initiated",
            "failed",
            executionId,
            {
                pipelineId,
                stageId,
                storyId,
                error,
                metadata: {
                    source: "automatic",
                    triggeredBy: "system",
                },
            },
        );
    }

    /**
     * Log a stage recovery
     */
    logStageRecovered(
        executionId: string,
        pipelineId: string,
        stageId: string,
        recoveryAction: string,
        storyId?: string,
    ): AutomaticTransitionLogEntry {
        return this.logTransition(
            "stage_recovered",
            "recovery_action",
            "recovered",
            executionId,
            {
                pipelineId,
                stageId,
                storyId,
                details: { recoveryAction },
                metadata: {
                    source: "automatic",
                    triggeredBy: "system",
                },
            },
        );
    }

    /**
     * Log a condition evaluation
     */
    logConditionEvaluated(
        executionId: string,
        workflowId: string,
        nodeId: string,
        conditionPassed: boolean,
        details?: Record<string, unknown>,
    ): AutomaticTransitionLogEntry {
        return this.logTransition(
            "condition_evaluated",
            conditionPassed ? "condition_passed" : "condition_failed",
            "completed",
            executionId,
            {
                workflowId,
                nodeId,
                details: {
                    conditionPassed,
                    ...details,
                },
                metadata: {
                    source: "automatic",
                    triggeredBy: "system",
                },
            },
        );
    }

    /**
     * Log an action execution
     */
    logActionExecuted(
        executionId: string,
        workflowId: string,
        nodeId: string,
        actionType: string,
        success: boolean,
        duration: number,
    ): AutomaticTransitionLogEntry {
        return this.logTransition(
            "action_executed",
            "system_initiated",
            success ? "completed" : "failed",
            executionId,
            {
                workflowId,
                nodeId,
                duration,
                details: { actionType, success },
                metadata: {
                    source: "automatic",
                    triggeredBy: "system",
                },
            },
        );
    }

    /**
     * Log workflow completion
     */
    logWorkflowCompleted(
        executionId: string,
        workflowId: string,
        duration: number,
    ): AutomaticTransitionLogEntry {
        return this.logTransition(
            "workflow_completed",
            "system_initiated",
            "completed",
            executionId,
            {
                workflowId,
                duration,
                metadata: {
                    source: "automatic",
                    triggeredBy: "system",
                },
            },
        );
    }

    /**
     * Log workflow failure
     */
    logWorkflowFailed(
        executionId: string,
        workflowId: string,
        error: { code: string; message: string; stack?: string },
    ): AutomaticTransitionLogEntry {
        return this.logTransition(
            "workflow_failed",
            "system_initiated",
            "failed",
            executionId,
            {
                workflowId,
                error,
                metadata: {
                    source: "automatic",
                    triggeredBy: "system",
                },
            },
        );
    }

    /**
     * Log threshold met event
     */
    logThresholdMet(
        executionId: string,
        storyId: string,
        thresholdConfigId: string,
        priority: string,
        details?: Record<string, unknown>,
    ): AutomaticTransitionLogEntry {
        return this.logTransition(
            "threshold_met",
            "priority_threshold_met",
            "completed",
            executionId,
            {
                storyId,
                details: {
                    thresholdConfigId,
                    priority,
                    ...details,
                },
                metadata: {
                    source: "automatic",
                    triggeredBy: "system",
                },
            },
        );
    }

    /**
     * Log threshold not met event
     */
    logThresholdNotMet(
        executionId: string,
        storyId: string,
        thresholdConfigId: string,
        reason: string,
    ): AutomaticTransitionLogEntry {
        return this.logTransition(
            "threshold_not_met",
            "priority_threshold_met",
            "completed",
            executionId,
            {
                storyId,
                details: {
                    thresholdConfigId,
                    reason,
                },
                metadata: {
                    source: "automatic",
                    triggeredBy: "system",
                },
            },
        );
    }

    /**
     * Log dependency satisfaction
     */
    logDependencySatisfied(
        executionId: string,
        storyId: string,
        dependencyId: string,
    ): AutomaticTransitionLogEntry {
        return this.logTransition(
            "dependency_satisfied",
            "dependency_resolved",
            "completed",
            executionId,
            {
                storyId,
                details: { dependencyId },
                metadata: {
                    source: "automatic",
                    triggeredBy: "system",
                },
            },
        );
    }

    /**
     * Log priority change
     */
    logPriorityChanged(
        executionId: string,
        storyId: string,
        oldPriority: string,
        newPriority: string,
        changedBy: string,
    ): AutomaticTransitionLogEntry {
        return this.logTransition(
            "priority_changed",
            "priority_threshold_met",
            "completed",
            executionId,
            {
                storyId,
                details: {
                    oldPriority,
                    newPriority,
                    changedBy,
                },
                metadata: {
                    source: "automatic",
                    triggeredBy: changedBy,
                },
            },
        );
    }

    /**
     * Query log entries
     */
    queryLogs(query: AutomaticTransitionLogQuery): AutomaticTransitionLogEntry[] {
        let results = [...this.logEntries];

        if (query.executionId) {
            results = results.filter((e) => e.executionId === query.executionId);
        }

        if (query.pipelineId) {
            results = results.filter((e) => e.pipelineId === query.pipelineId);
        }

        if (query.storyId) {
            results = results.filter((e) => e.storyId === query.storyId);
        }

        if (query.taskId) {
            results = results.filter((e) => e.taskId === query.taskId);
        }

        if (query.workflowId) {
            results = results.filter((e) => e.workflowId === query.workflowId);
        }

        if (query.transitionType) {
            results = results.filter((e) => e.transitionType === query.transitionType);
        }

        if (query.status) {
            results = results.filter((e) => e.status === query.status);
        }

        if (query.reason) {
            results = results.filter((e) => e.reason === query.reason);
        }

        if (query.fromDate) {
            results = results.filter((e) => e.timestamp >= query.fromDate!);
        }

        if (query.toDate) {
            results = results.filter((e) => e.timestamp <= query.toDate!);
        }

        // Sort by timestamp descending
        results.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

        // Apply pagination
        const offset = query.offset || 0;
        const limit = query.limit || results.length;

        return results.slice(offset, offset + limit);
    }

    /**
     * Get log statistics
     */
    getStats(): AutomaticTransitionLogStats {
        const totalTransitions = this.logEntries.length;
        const completedTransitions = this.logEntries.filter((e) => e.status === "completed").length;
        const failedTransitions = this.logEntries.filter((e) => e.status === "failed").length;
        const recoveredTransitions = this.logEntries.filter((e) => e.status === "recovered").length;

        const durations = this.logEntries
            .filter((e) => e.duration !== undefined)
            .map((e) => e.duration!);
        const averageDuration = durations.length > 0
            ? durations.reduce((a, b) => a + b, 0) / durations.length
            : 0;

        const transitionsByType: Record<string, number> = {};
        const transitionsByReason: Record<string, number> = {};

        for (const entry of this.logEntries) {
            transitionsByType[entry.transitionType] = (transitionsByType[entry.transitionType] || 0) + 1;
            transitionsByReason[entry.reason] = (transitionsByReason[entry.reason] || 0) + 1;
        }

        const lastEntry = this.logEntries[this.logEntries.length - 1];

        return {
            totalTransitions,
            completedTransitions,
            failedTransitions,
            recoveredTransitions,
            averageDuration,
            transitionsByType,
            transitionsByReason,
            lastTransitionAt: lastEntry?.timestamp,
        };
    }

    /**
     * Get all log entries
     */
    getAllLogs(): AutomaticTransitionLogEntry[] {
        return [...this.logEntries];
    }

    /**
     * Clear all logs
     */
    clearLogs(): void {
        this.logEntries = [];
    }

    /**
     * Register a listener for new log entries
     */
    onLogEntry(callback: (entry: AutomaticTransitionLogEntry) => void): void {
        this.listeners.push(callback);
    }

    /**
     * Remove a listener
     */
    offLogEntry(callback: (entry: AutomaticTransitionLogEntry) => void): void {
        const index = this.listeners.indexOf(callback);
        if (index > -1) {
            this.listeners.splice(index, 1);
        }
    }

    /**
     * Update configuration
     */
    updateConfig(config: Partial<AutomaticTransitionLoggerConfig>): void {
        this.config = { ...this.config, ...config };
    }

    /**
     * Get current configuration
     */
    getConfig(): AutomaticTransitionLoggerConfig {
        return { ...this.config };
    }

    private outputToConsole(entry: AutomaticTransitionLogEntry): void {
        const timestamp = entry.timestamp.toISOString();
        const prefix = `[AUTO-TRANSITION] ${timestamp}`;
        const message = `${prefix} | ${entry.transitionType} | ${entry.status} | ${entry.reason} | exec:${entry.executionId}`;

        if (entry.error) {
            console.error(`${message} | ERROR: ${entry.error.message}`);
        } else if (entry.status === "failed") {
            console.error(message);
        } else if (entry.status === "recovered") {
            console.warn(message);
        } else {
            console.log(message);
        }
    }

    private notifyListeners(entry: AutomaticTransitionLogEntry): void {
        for (const listener of this.listeners) {
            try {
                listener(entry);
            } catch (error) {
                console.error("Error in log entry listener:", error);
            }
        }
    }

    private createEmptyEntry(): AutomaticTransitionLogEntry {
        return AutomaticTransitionLogEntryStruct.from({
            id: "",
            timestamp: new Date(),
            transitionType: "pipeline_triggered",
            reason: "system_initiated",
            status: "pending",
            executionId: "",
        });
    }
}

/**
 * Factory function to create a logger instance
 */
export function createAutomaticTransitionLogger(
    config?: Partial<AutomaticTransitionLoggerConfig>,
): AutomaticTransitionLogger {
    return new AutomaticTransitionLogger(config);
}

/**
 * Singleton instance for global use
 */
let globalLogger: AutomaticTransitionLogger | null = null;

export function getGlobalAutomaticTransitionLogger(): AutomaticTransitionLogger {
    if (!globalLogger) {
        globalLogger = new AutomaticTransitionLogger();
    }
    return globalLogger;
}

export function setGlobalAutomaticTransitionLogger(logger: AutomaticTransitionLogger): void {
    globalLogger = logger;
}

