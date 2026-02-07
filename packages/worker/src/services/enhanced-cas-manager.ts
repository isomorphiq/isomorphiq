import type { Task } from "@isomorphiq/dashboard";
import type { Result } from "@isomorphiq/core";
import { DeadlockDetector, type CASOperation } from "./cas-deadlock-detector.ts";

/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class EnhancedCASManager {
    private deadlockDetector: DeadlockDetector;
    private pendingOperations: Map<string, CASOperation> = new Map();
    private operationSequence: number = 0;
    private defaultTimeout: number;

    constructor(defaultTimeout: number = 8000) {
        this.defaultTimeout = defaultTimeout;
        this.deadlockDetector = new DeadlockDetector(defaultTimeout);
    }

    async executeCASOperation(
        taskId: string,
        expectedVersion: number,
        updateFn: (task: Task) => Partial<Task>,
        maxRetries: number = 3
    ): Promise<Result<{ task: Task; operationId: string }>> {
        const operationId = this.generateOperationId();
        const operation: CASOperation = {
            id: operationId,
            taskId,
            expectedVersion,
            updateFn,
            timestamp: Date.now(),
            timeout: this.defaultTimeout,
            retryCount: 0,
            maxRetries
        };

        this.pendingOperations.set(operationId, operation);

        try {
            const result = await this.executeWithRetry(operation);
            return result;
        } finally {
            this.pendingOperations.delete(operationId);
        }
    }

    async executeMultiResourceCAS(
        taskId: string,
        resources: Array<{
            type: "status" | "priority" | "metadata";
            updateFn: (task: Task) => Partial<Task>;
        }>,
        expectedVersion: number = -1,
        maxRetries: number = 3
    ): Promise<Result<{ task: Task; operationId: string }>> {
        const operationId = this.generateOperationId();
        const combinedUpdateFn = (task: Task) => {
            let updatedTask = { ...task };
            for (const resource of resources) {
                const updates = resource.updateFn(updatedTask);
                updatedTask = { ...updatedTask, ...updates };
            }
            return updatedTask;
        };

        const operation: CASOperation = {
            id: operationId,
            taskId,
            expectedVersion,
            updateFn: combinedUpdateFn,
            timestamp: Date.now(),
            timeout: this.defaultTimeout * resources.length,
            retryCount: 0,
            maxRetries
        };

        this.pendingOperations.set(operationId, operation);

        try {
            const result = await this.executeMultiResourceWithLocks(operation, resources);
            return result;
        } finally {
            this.pendingOperations.delete(operationId);
        }
    }

    private async executeWithRetry(operation: CASOperation): Promise<Result<{ task: Task; operationId: string }>> {
        while (operation.retryCount <= operation.maxRetries) {
            try {
                const deadlockResult = this.deadlockDetector.detectDeadlock();
                if (deadlockResult.isDeadlock) {
                    this.deadlockDetector.resolveDeadlock(deadlockResult);
                    
                    if (deadlockResult.victimOperation === operation.id) {
                        operation.retryCount++;
                        await this.exponentialBackoff(operation.retryCount);
                        continue;
                    }
                }

                const result = await this.performCASOperation(operation);
                if (result.success) {
                    return {
                        success: true,
                        data: {
                            task: result.data!.task,
                            operationId: operation.id
                        }
                    };
                }

                if (!result.success && result.error) {
                    const errorMessage = result.error.message?.toLowerCase() || '';
                    
                    if (errorMessage.includes('conflict') || 
                        errorMessage.includes('timeout') || 
                        errorMessage.includes('temporary') ||
                        errorMessage.includes('deadlock')) {
                        operation.retryCount++;
                        await this.exponentialBackoff(operation.retryCount);
                        continue;
                    }
                }

                return {
                    success: false,
                    error: result.error
                };

            } catch (error) {
                operation.retryCount++;
                if (operation.retryCount > operation.maxRetries) {
                    return {
                        success: false,
                        error: new Error(`CAS operation failed after ${operation.maxRetries} retries: ${error}`)
                    };
                }
                
                await this.exponentialBackoff(operation.retryCount);
            }
        }

        return {
            success: false,
            error: new Error(`CAS operation failed after ${operation.maxRetries} retries`)
        };
    }

    private async executeMultiResourceWithLocks(
        operation: CASOperation,
        resources: Array<{ type: "status" | "priority" | "metadata" }>
    ): Promise<Result<{ task: Task; operationId: string }>> {
        const acquiredLocks: string[] = [];
        const lockOrder = [...resources].sort((a, b) => a.type.localeCompare(b.type));

        try {
            for (const resource of lockOrder) {
                const lockAcquired = await this.deadlockDetector.acquireLock(operation, resource.type as "status" | "priority" | "metadata");
                if (!lockAcquired) {
                    throw new Error(`Failed to acquire lock for resource ${resource.type}`);
                }
                acquiredLocks.push(resource.type);
            }

            const result = await this.performCASOperation(operation);
            
            if (result.success) {
                return {
                    success: true,
                    data: {
                        task: result.data!.task,
                        operationId: operation.id
                    }
                };
            }

            return {
                success: false,
                error: result.error
            };

        } finally {
            for (const resourceType of acquiredLocks) {
                this.deadlockDetector.releaseLock(operation.id, operation.taskId, resourceType as "status" | "priority" | "metadata");
            }
        }
    }

    private async performCASOperation(operation: CASOperation): Promise<Result<{ task: Task }>> {
        try {
            const mockCurrentTask: Task = {
                id: operation.taskId,
                title: "Mock Task",
                description: "Mock task for CAS operation",
                status: "todo",
                priority: "medium",
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            const updates = operation.updateFn(mockCurrentTask);
            const updatedTask = { ...mockCurrentTask, ...updates, updatedAt: new Date().toISOString() };

            return {
                success: true,
                data: { task: updatedTask }
            };

        } catch (error) {
            return {
                success: false,
                error: new Error(`CAS operation failed: ${error}`)
            };
        }
    }

    private async exponentialBackoff(retryCount: number): Promise<void> {
        const baseDelay = 100;
        const maxDelay = 2000;
        const delay = Math.min(baseDelay * Math.pow(2, retryCount), maxDelay);
        
        const jitter = Math.random() * delay * 0.1;
        const totalDelay = delay + jitter;
        
        await new Promise(resolve => setTimeout(resolve, totalDelay));
    }

    private generateOperationId(): string {
        return `cas-${this.operationSequence++}-${Date.now()}`;
    }

    getDeadlockStats() {
        return this.deadlockDetector.getStats();
    }

    getPendingOperations() {
        return Array.from(this.pendingOperations.values());
    }

    cleanup(): void {
        this.deadlockDetector.cleanup();
        this.pendingOperations.clear();
    }
}
