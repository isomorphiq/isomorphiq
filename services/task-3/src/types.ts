// Core types for Mixed Base 3 Operations - Task b7c2d592-load

export interface TaskEntity {
    id: string;
    title: string;
    description: string;
    status: "todo" | "in-progress" | "done" | "invalid";
    priority: "high" | "medium" | "low";
    type: string;
    dependencies: string[];
    createdBy: string;
    assignedTo?: string;
    collaborators?: string[];
    watchers?: string[];
    actionLog: TaskActionLog[];
    createdAt: Date;
    updatedAt: Date;
}

export interface TaskActionLog {
    action: string;
    timestamp: Date;
    userId: string;
    details?: Record<string, any>;
}

export interface MixedOperationConfig {
    concurrentOperations: number;
    operationMix: {
        creates: number;    // percentage (0-100)
        reads: number;      // percentage (0-100)
        updates: number;    // percentage (0-100)
        deletes: number;    // percentage (0-100)
    };
    resourceContention: boolean;
    errorRecovery: boolean;
    timingConfig: {
        minDelay: number;
        maxDelay: number;
        contentionMultiplier: number;
    };
}

export interface MixedOperationResult {
    operationType: "create" | "read" | "update" | "delete";
    operationId: string;
    success: boolean;
    duration: number;
    error?: string;
    dataSize?: number;
    contentionLevel?: number;
    retryAttempts?: number;
    resourceLocks?: string[];
}

export interface MixedOperationMetrics {
    totalOperations: number;
    successfulOperations: number;
    failedOperations: number;
    averageDuration: number;
    operationsPerSecond: number;
    contentionEvents: number;
    errorRecoveryEvents: number;
    successRate: number;
    performanceByType: Record<string, {
        count: number;
        successRate: number;
        avgDuration: number;
        avgRetries: number;
    }>;
    resourceUtilization: {
        maxConcurrentOperations: number;
        avgConcurrentOperations: number;
        lockContentionRate: number;
    };
}

export interface TaskOperation {
    type: "create" | "read" | "update" | "delete";
    id: string;
    data: any;
    priority: number;
    dependencies?: string[];
    retryCount?: number;
    createdAt: Date;
}

export interface ResourceLock {
    resourceId: string;
    lockType: "read" | "write";
    operationId: string;
    acquiredAt: Date;
    timeout: number;
}

export interface PerformanceBaseline {
    operationType: string;
    avgDuration: number;
    p95Duration: number;
    p99Duration: number;
    successRate: number;
    throughput: number;
    sampleSize: number;
    lastUpdated: Date;
}

export interface ContentionScenario {
    id: string;
    description: string;
    operations: TaskOperation[];
    expectedContentionLevel: number;
    maxAllowedDuration: number;
    successCriteria: {
        minSuccessRate: number;
        maxDataCorruption: number;
        maxDeadlocks: number;
    };
}

export interface ErrorRecoveryConfig {
    maxRetries: number;
    baseDelay: number;
    maxDelay: number;
    backoffMultiplier: number;
    retryableErrors: string[];
    circuitBreakerThreshold: number;
    circuitBreakerTimeout: number;
}

export interface TaskFilterOptions {
    status?: string;
    priority?: string;
    assignedTo?: string;
    createdBy?: string;
    search?: string;
    limit?: number;
    offset?: number;
    sortBy?: string;
    sortOrder?: "asc" | "desc";
}

export interface BatchOperationResult<T = any> {
    totalCount: number;
    successCount: number;
    failureCount: number;
    results: Array<{
        success: boolean;
        data?: T;
        error?: string;
        index: number;
    }>;
    duration: number;
}

export interface TaskUpdateData {
    status?: "todo" | "in-progress" | "done" | "invalid";
    priority?: "high" | "medium" | "low";
    assignedTo?: string;
    description?: string;
    collaborators?: string[];
    watchers?: string[];
    dependencies?: string[];
}

export interface TaskCreateData extends Omit<TaskEntity, "id" | "actionLog" | "createdAt" | "updatedAt"> {}

// Validation schemas for type safety
export const TaskEntityValidation = {
    id: (id: string): boolean => typeof id === "string" && id.length > 0,
    title: (title: string): boolean => typeof title === "string" && title.length > 0,
    status: (status: string): boolean => ["todo", "in-progress", "done", "invalid"].includes(status),
    priority: (priority: string): boolean => ["high", "medium", "low"].includes(priority),
    dependencies: (deps: string[]): boolean => Array.isArray(deps) && deps.every(dep => typeof dep === "string")
};

export const MixedOperationConfigValidation = {
    concurrentOperations: (n: number): boolean => Number.isInteger(n) && n > 0 && n <= 100,
    operationMix: (mix: MixedOperationConfig["operationMix"]): boolean => {
        const total = mix.creates + mix.reads + mix.updates + mix.deletes;
        return total === 100 && 
               Object.values(mix).every(val => Number.isInteger(val) && val >= 0 && val <= 100);
    }
};

// Error types
export class MixedOperationError extends Error {
    public operationType: string;
    public operationId: string;
    public cause?: Error;

    constructor(
        message: string,
        operationType: string,
        operationId: string,
        cause?: Error
    ) {
        super(message);
        this.operationType = operationType;
        this.operationId = operationId;
        this.cause = cause;
        this.name = "MixedOperationError";
    }
}

export class ResourceContentionError extends MixedOperationError {
    public resourceId: string;
    public contentionLevel: number;

    constructor(
        message: string,
        operationType: string,
        operationId: string,
        resourceId: string,
        contentionLevel: number
    ) {
        super(message, operationType, operationId);
        this.resourceId = resourceId;
        this.contentionLevel = contentionLevel;
        this.name = "ResourceContentionError";
    }
}

export class TaskValidationError extends MixedOperationError {
    public validationErrors: string[];

    constructor(
        message: string,
        operationType: string,
        operationId: string,
        validationErrors: string[]
    ) {
        super(message, operationType, operationId);
        this.validationErrors = validationErrors;
        this.name = "TaskValidationError";
    }
}

// Utility types
export type OperationResult<T = any> = {
    success: boolean;
    data?: T;
    error?: string;
    duration?: number;
};

export type TaskOperationExecutor = (
    operation: TaskOperation,
    context: MixedOperationContext
) => Promise<MixedOperationResult>;

export interface MixedOperationContext {
    config: MixedOperationConfig;
    resourceLocks: Map<string, ResourceLock[]>;
    performanceBaselines: Map<string, PerformanceBaseline>;
    errorRecoveryConfig: ErrorRecoveryConfig;
    metrics: Partial<MixedOperationMetrics>;
}

// Export values that are not types
export const TypesExport = {
    TaskEntityValidation,
    MixedOperationConfigValidation,
    MixedOperationError,
    ResourceContentionError,
    TaskValidationError
};