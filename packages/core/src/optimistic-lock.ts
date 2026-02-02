import { z } from "zod";

/**
 * Optimistic Locking Utilities for Concurrent Operations
 * Prevents lost updates and ensures data consistency under concurrent access
 */

// Versioned entity schema
export const VersionedEntitySchema = z.object({
    id: z.string(),
    version: z.number().min(0),
    createdAt: z.string(),
    updatedAt: z.string(),
});

export type VersionedEntity = z.infer<typeof VersionedEntitySchema>;

// Version conflict error
/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class VersionConflictError extends Error {
    constructor(
        message: string,
        public readonly expectedVersion: number,
        public readonly actualVersion: number,
        public readonly entityId: string
    ) {
        super(message);
        this.name = "VersionConflictError";
    }
}

// Optimistic lock result types
export type OptimisticLockResult<T> = 
    | { success: true; data: T; version: number }
    | { success: false; error: VersionConflictError | Error; retry: boolean };

/**
 * Optimistic locking manager for concurrent operations
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class OptimisticLockManager {
    public static readonly DEFAULT_MAX_RETRIES = 3;
    public static readonly DEFAULT_BACKOFF_MS = 100;

    /**
     * Execute an operation with optimistic locking
     * @param entityId - ID of the entity being modified
     * @param currentVersion - Current version of the entity
     * @param operation - Function that performs the update
     * @param maxRetries - Maximum number of retry attempts
     * @param backoffMs - Base backoff time in milliseconds
     * @returns Result with updated data or conflict error
     */
    static async executeWithOptimisticLock<T extends VersionedEntity>(
        entityId: string,
        currentVersion: number,
        operation: () => Promise<T>,
        maxRetries: number = this.DEFAULT_MAX_RETRIES,
        backoffMs: number = this.DEFAULT_BACKOFF_MS
    ): Promise<OptimisticLockResult<T>> {
        let lastError: Error | VersionConflictError | null = null;
        let newVersion = currentVersion;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                // Execute the operation
                const result = await operation();
                
                // Validate version was incremented
                if (result.version <= currentVersion) {
                    throw new Error("Operation did not increment version");
                }

                newVersion = result.version;
                return { success: true, data: result, version: newVersion };

            } catch (error) {
                lastError = error instanceof VersionConflictError ? error : new Error(String(error));

                // If it's a version conflict and we have retries left, retry with exponential backoff
                if (lastError instanceof VersionConflictError && attempt < maxRetries) {
                    const backoffTime = backoffMs * Math.pow(2, attempt);
                    await new Promise(resolve => setTimeout(resolve, backoffTime));
                    continue;
                }

                // For other errors or no retries left, break
                break;
            }
        }

        return { 
            success: false, 
            error: lastError || new Error("Unknown error"),
            retry: lastError instanceof VersionConflictError
        };
    }

    /**
     * Compare versions and detect conflicts
     * @param expectedVersion - Version we expected
     * @param actualVersion - Version found in storage
     * @param entityId - Entity ID for error reporting
     * @throws VersionConflictError if versions don't match
     */
    static checkVersionConflict(
        expectedVersion: number,
        actualVersion: number,
        entityId: string
    ): void {
        if (expectedVersion !== actualVersion) {
            throw new VersionConflictError(
                `Version conflict for entity ${entityId}: expected ${expectedVersion}, found ${actualVersion}`,
                expectedVersion,
                actualVersion,
                entityId
            );
        }
    }

    /**
     * Increment version number for an entity
     * @param entity - Entity to version
     * @returns New version number
     */
    static incrementVersion(entity: VersionedEntity): number {
        return entity.version + 1;
    }

    /**
     * Create a new entity with initial version
     * @param entityData - Base entity data (without version)
     * @returns Entity with initial version
     */
    static createVersioned<T extends Omit<VersionedEntity, 'version'>>(entityData: T): T & { version: number } {
        return {
            ...entityData,
            version: 0,
            updatedAt: new Date().toISOString()
        };
    }

    /**
     * Update entity with new version
     * @param entity - Current entity
     * @param updates - Partial updates to apply
     * @returns Updated entity with new version
     */
    static updateVersioned<T extends VersionedEntity>(
        entity: T,
        updates: Partial<Omit<T, 'id' | 'version' | 'createdAt' | 'updatedAt'>>
    ): T {
        return {
            ...entity,
            ...updates,
            version: entity.version + 1,
            updatedAt: new Date().toISOString()
        };
    }
}

/**
 * Database adapter wrapper with optimistic locking support
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export abstract class OptimisticLockingAdapter<T extends VersionedEntity> {
    /**
     * Get entity by ID with version checking
     */
    abstract getWithVersion(id: string): Promise<T | null>;

    /**
     * Update entity with optimistic locking
     */
    async updateWithOptimisticLock(
        id: string,
        expectedVersion: number,
        updates: Partial<Omit<T, 'id' | 'version' | 'createdAt' | 'updatedAt'>>
    ): Promise<OptimisticLockResult<T>> {
        return OptimisticLockManager.executeWithOptimisticLock(
            id,
            expectedVersion,
            async () => {
                const current = await this.getWithVersion(id);
                if (!current) {
                    throw new Error(`Entity ${id} not found`);
                }

                // Check version conflict
                OptimisticLockManager.checkVersionConflict(expectedVersion, current.version, id);

                // Apply updates and increment version
                const updated = OptimisticLockManager.updateVersioned(current, updates);
                await this.save(updated);
                
                return updated;
            }
        );
    }

    /**
     * Save entity (abstract method to be implemented by concrete adapters)
     */
    abstract save(entity: T): Promise<void>;

    /**
     * Delete entity with version checking
     */
    async deleteWithOptimisticLock(
        id: string,
        expectedVersion: number
    ): Promise<OptimisticLockResult<boolean>> {
        return OptimisticLockManager.executeWithOptimisticLock(
            id,
            expectedVersion,
            async () => {
                const current = await this.getWithVersion(id);
                if (!current) {
                    throw new Error(`Entity ${id} not found`);
                }

                // Check version conflict
                OptimisticLockManager.checkVersionConflict(expectedVersion, current.version, id);

                // Delete the entity
                await this.delete(id);
                return { success: true, data: true, version: current.version + 1 } as any;
            }
        );
    }

    /**
     * Delete entity (abstract method to be implemented by concrete adapters)
     */
    abstract delete(id: string): Promise<void>;
}

/**
 * Performance metrics for optimistic locking operations
 */
export interface OptimisticLockMetrics {
    totalOperations: number;
    successfulOperations: number;
    conflictErrors: number;
    otherErrors: number;
    averageRetries: number;
    maxRetriesReached: number;
}

/**
 * Metrics collector for optimistic locking operations
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class OptimisticLockMetricsCollector {
    private metrics: OptimisticLockMetrics = {
        totalOperations: 0,
        successfulOperations: 0,
        conflictErrors: 0,
        otherErrors: 0,
        averageRetries: 0,
        maxRetriesReached: 0
    };

    private totalRetries: number = 0;

    recordOperation(result: OptimisticLockResult<any>, retries: number = 0): void {
        this.metrics.totalOperations++;
        this.totalRetries += retries;

        if (result.success) {
            this.metrics.successfulOperations++;
        } else {
            // result.error is only available in the failure case
            if ('error' in result && result.error instanceof VersionConflictError) {
                this.metrics.conflictErrors++;
            } else {
                this.metrics.otherErrors++;
            }

            if (retries >= OptimisticLockManager.DEFAULT_MAX_RETRIES) {
                this.metrics.maxRetriesReached++;
            }
        }

        this.metrics.averageRetries = this.totalRetries / this.metrics.totalOperations;
    }

    getMetrics(): OptimisticLockMetrics {
        return { ...this.metrics };
    }

    reset(): void {
        this.metrics = {
            totalOperations: 0,
            successfulOperations: 0,
            conflictErrors: 0,
            otherErrors: 0,
            averageRetries: 0,
            maxRetriesReached: 0
        };
        this.totalRetries = 0;
    }
}