// Mixed Base 3 Operations Manager - Task b7c2d592-load
// Core implementation for mixed operations with configurable concurrency and resource contention

import type {
    TaskEntity,
    MixedOperationConfig,
    MixedOperationResult,
    MixedOperationMetrics,
    TaskOperation,
    ResourceLock,
    PerformanceBaseline,
    ErrorRecoveryConfig,
    TaskFilterOptions,
    BatchOperationResult,
    TaskUpdateData,
    TaskCreateData,
    MixedOperationContext,
    TaskOperationExecutor,
    MixedOperationError,
    ResourceContentionError,
    TaskValidationError
} from "./types.ts";

import {
    TaskEntityValidation,
    MixedOperationConfigValidation,
    TypesExport
} from "./types.ts";

export class MixedOperationManager {
    private resourceLocks: Map<string, ResourceLock[]> = new Map();
    private performanceBaselines: Map<string, PerformanceBaseline> = new Map();
    private operationQueue: TaskOperation[] = [];
    private activeOperations: Map<string, Promise<MixedOperationResult>> = new Map();
    private metrics: Partial<MixedOperationMetrics> = {};
    private defaultConfig: MixedOperationConfig;
    private errorRecoveryConfig: ErrorRecoveryConfig;

    constructor(
        defaultConfig: MixedOperationConfig,
        errorRecoveryConfig: ErrorRecoveryConfig
    ) {
        this.defaultConfig = defaultConfig;
        this.errorRecoveryConfig = errorRecoveryConfig;
        this.initializePerformanceBaselines();
    }

    /**
     * Execute mixed operations with configurable concurrency and operation mix
     */
    async executeMixedOperations(
        config: Partial<MixedOperationConfig> = {},
        initialTaskData: TaskEntity[] = []
    ): Promise<MixedOperationMetrics> {
        const finalConfig = this.mergeConfig(config);
        this.validateConfig(finalConfig);

        const results: MixedOperationResult[] = [];
        const startTime = Date.now();
        
        // Generate operation queue based on mix configuration
        const operationQueue = this.generateOperationQueue(finalConfig, initialTaskData);
        
        // Execute operations concurrently with controlled batch size
        const maxConcurrency = Math.min(finalConfig.concurrentOperations, 50);
        const context: MixedOperationContext = {
            config: finalConfig,
            resourceLocks: this.resourceLocks,
            performanceBaselines: this.performanceBaselines,
            errorRecoveryConfig: this.errorRecoveryConfig,
            metrics: this.metrics
        };

        // Process operations in batches to control concurrency
        for (let i = 0; i < operationQueue.length; i += maxConcurrency) {
            const batch = operationQueue.slice(i, i + maxConcurrency);
            const batchPromises = batch.map(op => this.executeOperationWithRetry(op, context));
            
            const batchResults = await Promise.allSettled(batchPromises);
            
            batchResults.forEach((result, index) => {
                if (result.status === 'fulfilled') {
                    results.push(result.value);
                } else {
                    results.push(this.createFailureResult(batch[index], result.reason));
                }
            });
            
            // Adaptive delay between batches based on contention
            if (i + maxConcurrency < operationQueue.length) {
                await this.calculateAdaptiveDelay(results, finalConfig);
            }
        }

        return this.calculateMetrics(results, Date.now() - startTime, finalConfig);
    }

    /**
     * Execute individual operation with retry logic and error handling
     */
    private async executeOperationWithRetry(
        operation: TaskOperation,
        context: MixedOperationContext
    ): Promise<MixedOperationResult> {
        const startTime = Date.now();
        let retryCount = 0;
        let lastError: Error | null = null;

        while (retryCount <= context.errorRecoveryConfig.maxRetries) {
            try {
                // Acquire resource locks if needed
                const lockInfo = await this.acquireResourceLocks(operation, context);
                
                try {
                    const result = await this.executeOperation(operation, context, lockInfo);
                    
                    // Update performance baselines
                    this.updatePerformanceBaseline(operation.type, result.duration, result.success);
                    
                    return result;
                } finally {
                    // Release resource locks
                    await this.releaseResourceLocks(operation.id, lockInfo);
                }
                
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                retryCount++;

                // Check if error is retryable
                if (!this.isRetryableError(lastError, retryCount, context.errorRecoveryConfig)) {
                    break;
                }

                // Exponential backoff with jitter
                const delay = this.calculateBackoffDelay(retryCount, context.errorRecoveryConfig);
                await this.delay(delay);
            }
        }

        return {
            operationType: operation.type,
            operationId: operation.id,
            success: false,
            duration: Date.now() - startTime,
            error: lastError?.message || 'Unknown error',
            retryAttempts: retryCount
        };
    }

    /**
     * Execute the actual operation based on type
     */
    private async executeOperation(
        operation: TaskOperation,
        context: MixedOperationContext,
        lockInfo: ResourceLock[]
    ): Promise<MixedOperationResult> {
        const startTime = Date.now();
        const operationType = operation.type;

        try {
            let result: any;
            
            switch (operationType) {
                case 'create':
                    result = await this.executeCreateOperation(operation.data, context);
                    break;
                case 'read':
                    result = await this.executeReadOperation(operation.data, context);
                    break;
                case 'update':
                    result = await this.executeUpdateOperation(operation.data, context);
                    break;
                case 'delete':
                    result = await this.executeDeleteOperation(operation.data, context);
                    break;
                default:
                    throw new TypesExport.MixedOperationError(
                        `Unknown operation type: ${operationType}`,
                        operationType,
                        operation.id
                    );
            }

            // Simulate resource contention if enabled
            let contentionLevel = 0;
            if (context.config.resourceContention) {
                contentionLevel = await this.simulateResourceContention(context);
            }

            return {
                operationType,
                operationId: operation.id,
                success: true,
                duration: Date.now() - startTime,
                dataSize: JSON.stringify(result).length,
                contentionLevel,
                resourceLocks: lockInfo.map(l => l.resourceId)
            };

        } catch (error) {
            // Error recovery if enabled
            if (context.config.errorRecovery) {
                await this.performErrorRecovery(operationType, error, context);
            }

            throw error;
        }
    }

    /**
     * Execute create operation with validation
     */
    private async executeCreateOperation(data: TaskCreateData, context: MixedOperationContext): Promise<TaskEntity> {
        // Validate task data
        this.validateTaskData(data);

        // Simulate database operation with realistic timing
        const baseDelay = context.config.timingConfig.minDelay;
        const variation = context.config.timingConfig.maxDelay - baseDelay;
        await this.delay(baseDelay + Math.random() * variation);

        const task: TaskEntity = {
            id: `task-b7c2d592-load-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            ...data,
            actionLog: [{
                action: 'created',
                timestamp: new Date(),
                userId: data.createdBy,
                details: { source: 'mixed-operation-manager' }
            }],
            createdAt: new Date(),
            updatedAt: new Date()
        };

        return task;
    }

    /**
     * Execute read operation
     */
    private async executeReadOperation(data: { taskId: string }, context: MixedOperationContext): Promise<TaskEntity> {
        // Simulate read operation
        await this.delay(context.config.timingConfig.minDelay + Math.random() * 50);

        // Return mock task data (in real implementation, this would query the database)
        return {
            id: data.taskId,
            title: 'Sample Task',
            description: 'Sample task for read operation',
            status: 'todo',
            priority: 'medium',
            type: 'task',
            dependencies: [],
            createdBy: 'system',
            actionLog: [],
            createdAt: new Date(),
            updatedAt: new Date()
        };
    }

    /**
     * Execute update operation
     */
    private async executeUpdateOperation(data: { taskId: string; updates: TaskUpdateData }, context: MixedOperationContext): Promise<TaskEntity> {
        // Validate update data
        this.validateUpdateData(data.updates);

        // Simulate update operation
        await this.delay(context.config.timingConfig.minDelay + Math.random() * 80);

        return {
            id: data.taskId,
            title: 'Updated Task',
            description: 'Updated task description',
            status: data.updates.status || 'todo',
            priority: data.updates.priority || 'medium',
            type: 'task',
            dependencies: data.updates.dependencies || [],
            createdBy: 'system',
            actionLog: [{
                action: 'updated',
                timestamp: new Date(),
                userId: 'mixed-operation-manager',
                details: data.updates
            }],
            createdAt: new Date(),
            updatedAt: new Date()
        };
    }

    /**
     * Execute delete operation
     */
    private async executeDeleteOperation(data: { taskId: string }, context: MixedOperationContext): Promise<{ id: string; deleted: boolean }> {
        // Simulate delete operation
        await this.delay(context.config.timingConfig.minDelay + Math.random() * 60);

        return {
            id: data.taskId,
            deleted: true
        };
    }

    /**
     * Generate operation queue based on configuration
     */
    private generateOperationQueue(config: MixedOperationConfig, taskData: TaskEntity[]): TaskOperation[] {
        const queue: TaskOperation[] = [];
        const totalOps = 100; // Base percentage scale
        const counts = {
            creates: Math.floor((config.operationMix.creates / 100) * totalOps),
            reads: Math.floor((config.operationMix.reads / 100) * totalOps),
            updates: Math.floor((config.operationMix.updates / 100) * totalOps),
            deletes: Math.floor((config.operationMix.deletes / 100) * totalOps)
        };

        // Add create operations
        for (let i = 0; i < counts.creates; i++) {
            queue.push({
                type: 'create',
                id: `create-${Date.now()}-${i}`,
                data: {
                    title: `Mixed Operation Create ${Date.now()}-${i}`,
                    description: `Mixed load test create operation ${i}`,
                    priority: ['high', 'medium', 'low'][i % 3] as "high" | "medium" | "low",
                    type: 'task',
                    dependencies: [],
                    createdBy: 'mixed-operation-manager-b7c2d592'
                },
                priority: this.getOperationPriority('create', i),
                createdAt: new Date()
            });
        }

        // Add read operations
        for (let i = 0; i < counts.reads; i++) {
            if (taskData.length > 0) {
                const randomTask = taskData[i % taskData.length];
                queue.push({
                    type: 'read',
                    id: `read-${Date.now()}-${i}`,
                    data: { taskId: randomTask.id },
                    priority: this.getOperationPriority('read', i),
                    createdAt: new Date()
                });
            }
        }

        // Add update operations
        for (let i = 0; i < counts.updates; i++) {
            if (taskData.length > 0) {
                const randomTask = taskData[i % taskData.length];
                queue.push({
                    type: 'update',
                    id: `update-${Date.now()}-${i}`,
                    data: {
                        taskId: randomTask.id,
                        updates: {
                            status: ['todo', 'in-progress', 'done'][i % 3] as "todo" | "in-progress" | "done",
                            priority: ['high', 'medium', 'low'][i % 3] as "high" | "medium" | "low"
                        }
                    },
                    priority: this.getOperationPriority('update', i),
                    createdAt: new Date()
                });
            }
        }

        // Add delete operations
        for (let i = 0; i < counts.deletes && i < taskData.length - 5; i++) {
            const randomTask = taskData[i % taskData.length];
            queue.push({
                type: 'delete',
                id: `delete-${Date.now()}-${i}`,
                data: { taskId: randomTask.id },
                priority: this.getOperationPriority('delete', i),
                createdAt: new Date()
            });
        }

        // Shuffle queue for realistic mixed operations
        return this.shuffleArray(queue);
    }

    /**
     * Resource lock management
     */
    private async acquireResourceLocks(operation: TaskOperation, context: MixedOperationContext): Promise<ResourceLock[]> {
        const locks: ResourceLock[] = [];
        
        if (operation.type === 'read') {
            const taskId = operation.data.taskId;
            if (taskId) {
                locks.push({
                    resourceId: taskId,
                    lockType: 'read',
                    operationId: operation.id,
                    acquiredAt: new Date(),
                    timeout: 5000
                });
            }
        } else if (operation.type === 'update' || operation.type === 'delete') {
            const taskId = operation.data.taskId;
            if (taskId) {
                locks.push({
                    resourceId: taskId,
                    lockType: 'write',
                    operationId: operation.id,
                    acquiredAt: new Date(),
                    timeout: 5000
                });
            }
        }

        // Check for lock contention
        for (const lock of locks) {
            const existingLocks = this.resourceLocks.get(lock.resourceId) || [];
            const hasConflictingLock = existingLocks.some(existing => 
                existing.lockType === 'write' || lock.lockType === 'write'
            );
            
            if (hasConflictingLock && context.config.resourceContention) {
                throw new TypesExport.ResourceContentionError(
                    `Lock contention on resource ${lock.resourceId}`,
                    operation.type,
                    operation.id,
                    lock.resourceId,
                    existingLocks.length
                );
            }
        }

        // Acquire locks
        locks.forEach(lock => {
            const resourceLocks = this.resourceLocks.get(lock.resourceId) || [];
            resourceLocks.push(lock);
            this.resourceLocks.set(lock.resourceId, resourceLocks);
        });

        return locks;
    }

    private async releaseResourceLocks(operationId: string, locks: ResourceLock[]): Promise<void> {
        locks.forEach(lock => {
            const resourceLocks = this.resourceLocks.get(lock.resourceId) || [];
            const index = resourceLocks.findIndex(l => l.operationId === operationId);
            if (index >= 0) {
                resourceLocks.splice(index, 1);
            }
            if (resourceLocks.length === 0) {
                this.resourceLocks.delete(lock.resourceId);
            } else {
                this.resourceLocks.set(lock.resourceId, resourceLocks);
            }
        });
    }

    /**
     * Performance and metrics utilities
     */
    private updatePerformanceBaseline(operationType: string, duration: number, success: boolean): void {
        const baseline = this.performanceBaselines.get(operationType) || {
            operationType,
            avgDuration: 0,
            p95Duration: 0,
            p99Duration: 0,
            successRate: 0,
            throughput: 0,
            sampleSize: 0,
            lastUpdated: new Date()
        };

        // Update with exponential moving average
        const alpha = 0.1; // Smoothing factor
        baseline.avgDuration = baseline.avgDuration * (1 - alpha) + duration * alpha;
        baseline.successRate = baseline.successRate * (1 - alpha) + (success ? 1 : 0) * alpha;
        baseline.sampleSize++;
        baseline.lastUpdated = new Date();

        this.performanceBaselines.set(operationType, baseline);
    }

    private calculateMetrics(
        results: MixedOperationResult[],
        totalDuration: number,
        config: MixedOperationConfig
    ): MixedOperationMetrics {
        const successfulOps = results.filter(r => r.success);
        const failedOps = results.filter(r => !r.success);

        // Calculate performance by operation type
        const performanceByType: Record<string, any> = {};
        results.forEach(result => {
            if (!performanceByType[result.operationType]) {
                performanceByType[result.operationType] = {
                    count: 0,
                    successCount: 0,
                    totalDuration: 0,
                    totalRetries: 0
                };
            }
            
            const typeMetrics = performanceByType[result.operationType];
            typeMetrics.count++;
            typeMetrics.totalDuration += result.duration;
            typeMetrics.totalRetries += result.retryAttempts || 0;
            
            if (result.success) {
                typeMetrics.successCount++;
            }
        });

        // Convert to final format
        Object.keys(performanceByType).forEach(type => {
            const metrics = performanceByType[type];
            performanceByType[type] = {
                count: metrics.count,
                successRate: metrics.successCount / metrics.count,
                avgDuration: metrics.totalDuration / metrics.count,
                avgRetries: metrics.totalRetries / metrics.count
            };
        });

        const contentionEvents = results.filter(r => r.contentionLevel && r.contentionLevel > 0).length;
        const errorRecoveryEvents = failedOps.length;

        return {
            totalOperations: results.length,
            successfulOperations: successfulOps.length,
            failedOperations: failedOps.length,
            averageDuration: results.reduce((sum, r) => sum + r.duration, 0) / results.length,
            operationsPerSecond: (successfulOps.length / totalDuration) * 1000,
            contentionEvents,
            errorRecoveryEvents,
            successRate: successfulOps.length / results.length,
            performanceByType,
            resourceUtilization: {
                maxConcurrentOperations: config.concurrentOperations,
                avgConcurrentOperations: results.length / Math.ceil(totalDuration / 100),
                lockContentionRate: contentionEvents / results.length
            }
        };
    }

    /**
     * Utility functions
     */
    private mergeConfig(config: Partial<MixedOperationConfig>): MixedOperationConfig {
        return {
            concurrentOperations: config.concurrentOperations ?? this.defaultConfig.concurrentOperations,
            operationMix: { ...this.defaultConfig.operationMix, ...config.operationMix },
            resourceContention: config.resourceContention ?? this.defaultConfig.resourceContention,
            errorRecovery: config.errorRecovery ?? this.defaultConfig.errorRecovery,
            timingConfig: { ...this.defaultConfig.timingConfig, ...config.timingConfig }
        };
    }

    private validateConfig(config: MixedOperationConfig): void {
        if (!MixedOperationConfigValidation.concurrentOperations(config.concurrentOperations)) {
            throw new Error(`Invalid concurrentOperations: ${config.concurrentOperations}`);
        }
        if (!MixedOperationConfigValidation.operationMix(config.operationMix)) {
            throw new Error(`Invalid operationMix: ${JSON.stringify(config.operationMix)}`);
        }
    }

    private validateTaskData(data: TaskCreateData): void {
        const errors: string[] = [];
        
        if (!TaskEntityValidation.title(data.title)) {
            errors.push('Invalid title');
        }
        if (!TaskEntityValidation.status(data.status)) {
            errors.push('Invalid status');
        }
        if (!TaskEntityValidation.priority(data.priority)) {
            errors.push('Invalid priority');
        }
        if (!TaskEntityValidation.dependencies(data.dependencies)) {
            errors.push('Invalid dependencies');
        }

        if (errors.length > 0) {
            throw new TypesExport.TaskValidationError(
                'Task validation failed',
                'create',
                'validation',
                errors
            );
        }
    }

    private validateUpdateData(data: TaskUpdateData): void {
        const errors: string[] = [];
        
        if (data.status && !TaskEntityValidation.status(data.status)) {
            errors.push('Invalid status');
        }
        if (data.priority && !TaskEntityValidation.priority(data.priority)) {
            errors.push('Invalid priority');
        }
        if (data.dependencies && !TaskEntityValidation.dependencies(data.dependencies)) {
            errors.push('Invalid dependencies');
        }

        if (errors.length > 0) {
            throw new TypesExport.TaskValidationError(
                'Update validation failed',
                'update',
                'validation',
                errors
            );
        }
    }

    private getOperationPriority(type: string, index: number): number {
        const priorityMap = { create: 3, read: 1, update: 2, delete: 4 };
        return priorityMap[type as keyof typeof priorityMap] || 1;
    }

    private shuffleArray<T>(array: T[]): T[] {
        const shuffled = [...array];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private createFailureResult(operation: TaskOperation, error: any): MixedOperationResult {
        return {
            operationType: operation.type,
            operationId: operation.id,
            success: false,
            duration: 0,
            error: error?.message || 'Unknown error',
            retryAttempts: 0
        };
    }

    private isRetryableError(error: Error, retryCount: number, config: ErrorRecoveryConfig): boolean {
        return retryCount <= config.maxRetries && 
               config.retryableErrors.some(pattern => error.message.includes(pattern));
    }

    private calculateBackoffDelay(retryCount: number, config: ErrorRecoveryConfig): number {
        const delay = Math.min(
            config.baseDelay * Math.pow(config.backoffMultiplier, retryCount - 1),
            config.maxDelay
        );
        // Add jitter to prevent thundering herd
        return delay + Math.random() * 100;
    }

    private async calculateAdaptiveDelay(results: MixedOperationResult[], config: MixedOperationConfig): Promise<void> {
        const recentResults = results.slice(-10);
        const avgDuration = recentResults.reduce((sum, r) => sum + r.duration, 0) / recentResults.length;
        const contentionRate = recentResults.filter(r => r.contentionLevel && r.contentionLevel > 0.5).length / recentResults.length;
        
        let baseDelay = 50;
        if (contentionRate > 0.7) {
            baseDelay = 200;
        } else if (contentionRate > 0.3) {
            baseDelay = 100;
        }
        
        await this.delay(baseDelay);
    }

    private async simulateResourceContention(context: MixedOperationContext): Promise<number> {
        const contentionLevel = Math.random();
        
        if (contentionLevel > 0.8) {
            // High contention
            await this.delay(context.config.timingConfig.contentionMultiplier * 200);
            return contentionLevel;
        } else if (contentionLevel > 0.5) {
            // Medium contention
            await this.delay(context.config.timingConfig.contentionMultiplier * 100);
            return contentionLevel;
        }
        
        return 0;
    }

    private async performErrorRecovery(operationType: string, error: any, context: MixedOperationContext): Promise<void> {
        const config = context.errorRecoveryConfig;
        
        for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
            await this.delay(config.baseDelay * Math.pow(config.backoffMultiplier, attempt - 1));
            
            try {
                await this.simulateRecoveryAttempt(operationType);
                break;
            } catch (recoveryError) {
                if (attempt === config.maxRetries) {
                    console.error(`Failed to recover from ${operationType} error:`, recoveryError);
                }
            }
        }
    }

    private async simulateRecoveryAttempt(operationType: string): Promise<void> {
        await this.delay(Math.random() * 50 + 10);
        
        if (Math.random() > 0.3) {
            return;
        }
        
        throw new Error(`Recovery failed for ${operationType}`);
    }

    private initializePerformanceBaselines(): void {
        const defaultBaselines = ['create', 'read', 'update', 'delete'];
        defaultBaselines.forEach(type => {
            this.performanceBaselines.set(type, {
                operationType: type,
                avgDuration: 100,
                p95Duration: 200,
                p99Duration: 500,
                successRate: 0.95,
                throughput: 10,
                sampleSize: 0,
                lastUpdated: new Date()
            });
        });
    }

    /**
     * Public API for external access
     */
    getMetrics(): Partial<MixedOperationMetrics> {
        return this.metrics;
    }

    getPerformanceBaselines(): Map<string, PerformanceBaseline> {
        return new Map(this.performanceBaselines);
    }

    getResourceLocks(): Map<string, ResourceLock[]> {
        return new Map(this.resourceLocks);
    }

    resetMetrics(): void {
        this.metrics = {};
        this.resourceLocks.clear();
    }
}

// Export singleton instance
export const mixedOperationManager = new MixedOperationManager(
    {
        concurrentOperations: 20,
        operationMix: {
            creates: 30,
            reads: 40,
            updates: 20,
            deletes: 10
        },
        resourceContention: true,
        errorRecovery: true,
        timingConfig: {
            minDelay: 50,
            maxDelay: 200,
            contentionMultiplier: 1.5
        }
    },
    {
        maxRetries: 3,
        baseDelay: 100,
        maxDelay: 2000,
        backoffMultiplier: 2,
        retryableErrors: ['contention', 'timeout', 'connection'],
        circuitBreakerThreshold: 5,
        circuitBreakerTimeout: 30000
    }
);

export default mixedOperationManager;