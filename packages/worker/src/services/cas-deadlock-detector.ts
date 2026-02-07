import type { Task } from "@isomorphiq/dashboard";

export interface CASOperation {
    id: string;
    taskId: string;
    expectedVersion: number;
    updateFn: (task: Task) => Partial<Task>;
    timestamp: number;
    timeout: number;
    retryCount: number;
    maxRetries: number;
}

export interface ResourceLock {
    taskId: string;
    operationId: string;
    acquiredAt: number;
    timeout: number;
    resourceType: "status" | "priority" | "metadata";
}

export interface DeadlockDetectionResult {
    isDeadlock: boolean;
    cycle: string[];
    victimOperation?: string;
    resolutionStrategy: "timeout" | "victim_selection" | "wait_for_graph";
}

/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class DeadlockDetector {
    private activeLocks: Map<string, ResourceLock[]> = new Map();
    private waitGraph: Map<string, Set<string>> = new Map();
    private lockTimeouts: Map<string, NodeJS.Timeout> = new Map();
    private defaultTimeout: number;

    constructor(defaultTimeout: number = 5000) {
        this.defaultTimeout = defaultTimeout;
    }

    acquireLock(operation: CASOperation, resourceType: "status" | "priority" | "metadata"): Promise<boolean> {
        return new Promise((resolve) => {
            const lockId = `${operation.taskId}:${resourceType}`;
            const lock: ResourceLock = {
                taskId: operation.taskId,
                operationId: operation.id,
                acquiredAt: Date.now(),
                timeout: operation.timeout,
                resourceType
            };

            // Check for immediate deadlock
            if (this.wouldCauseDeadlock(operation.id, lockId)) {
                resolve(false);
                return;
            }

            // Try to acquire lock
            const existingLocks = this.activeLocks.get(lockId) || [];
            
            if (existingLocks.length === 0) {
                // No contention, acquire lock immediately
                this.activeLocks.set(lockId, [lock]);
                this.setupLockTimeout(lockId, operation.timeout);
                resolve(true);
                return;
            }

            // Contention detected - add to wait graph
            this.addToWaitGraph(operation.id, existingLocks[0].operationId);
            
            // Set up contention resolution
            const contentionResolver = setTimeout(() => {
                this.removeFromWaitGraph(operation.id);
                
                // Check if we can acquire lock now
                const currentLocks = this.activeLocks.get(lockId) || [];
                if (currentLocks.length === 0 || 
                    currentLocks.every(l => l.operationId === operation.id)) {
                    this.activeLocks.set(lockId, [lock]);
                    this.setupLockTimeout(lockId, operation.timeout);
                    resolve(true);
                } else {
                    resolve(false);
                }
            }, Math.min(1000, operation.timeout / 4));

            // Clean up on promise cancellation
            Promise.resolve().then(() => {
                clearTimeout(contentionResolver);
            });
        });
    }

    releaseLock(operationId: string, taskId: string, resourceType: "status" | "priority" | "metadata"): void {
        const lockId = `${taskId}:${resourceType}`;
        const locks = this.activeLocks.get(lockId) || [];
        
        const filteredLocks = locks.filter(lock => lock.operationId !== operationId);
        
        if (filteredLocks.length === 0) {
            this.activeLocks.delete(lockId);
            this.clearLockTimeout(lockId);
        } else {
            this.activeLocks.set(lockId, filteredLocks);
        }
        
        this.removeFromWaitGraph(operationId);
    }

    detectDeadlock(): DeadlockDetectionResult {
        const visited = new Set<string>();
        const recursionStack = new Set<string>();
        const cycle: string[] = [];

        const dfs = (node: string): boolean => {
            if (recursionStack.has(node)) {
                // Found cycle
                const cycleStart = cycle.indexOf(node);
                return cycleStart !== -1;
            }

            if (visited.has(node)) {
                return false;
            }

            visited.add(node);
            recursionStack.add(node);
            cycle.push(node);

            const neighbors = this.waitGraph.get(node) || new Set();
            for (const neighbor of neighbors) {
                if (dfs(neighbor)) {
                    return true;
                }
            }

            recursionStack.delete(node);
            cycle.pop();
            return false;
        };

        for (const node of this.waitGraph.keys()) {
            if (!visited.has(node) && dfs(node)) {
                // Deadlock detected - select victim
                const victimOperation = this.selectVictim(cycle);
                return {
                    isDeadlock: true,
                    cycle: [...cycle],
                    victimOperation,
                    resolutionStrategy: "victim_selection"
                };
            }
        }

        return {
            isDeadlock: false,
            cycle: [],
            resolutionStrategy: "wait_for_graph"
        };
    }

    resolveDeadlock(result: DeadlockDetectionResult): void {
        if (!result.isDeadlock || !result.victimOperation) {
            return;
        }

        // Abort the victim operation
        this.abortOperation(result.victimOperation);
        
        console.log(`[DEADLOCK] Resolved deadlock by aborting operation: ${result.victimOperation}`);
    }

    private wouldCauseDeadlock(operationId: string, lockId: string): boolean {
        const existingLocks = this.activeLocks.get(lockId) || [];
        if (existingLocks.length === 0) {
            return false;
        }

        // Simple check: if operation already holds locks that other operations are waiting for
        // and now wants a lock held by those operations, it could cause deadlock

        const conflictingOperations = existingLocks.map(lock => lock.operationId);
        
        for (const conflictOpId of conflictingOperations) {
            if (this.waitForConflictExists(operationId, conflictOpId)) {
                return true;
            }
        }

        return false;
    }

    private waitForConflictExists(operationId: string, conflictOpId: string): boolean {
        const conflictWaitsFor = this.waitGraph.get(conflictOpId) || new Set();
        return conflictWaitsFor.has(operationId);
    }

    private addToWaitGraph(waiter: string, holder: string): void {
        if (!this.waitGraph.has(waiter)) {
            this.waitGraph.set(waiter, new Set());
        }
        this.waitGraph.get(waiter)!.add(holder);
    }

    private removeFromWaitGraph(operationId: string): void {
        // Remove as waiter
        this.waitGraph.delete(operationId);
        
        // Remove from other operations' wait sets
        for (const [, waitSet] of this.waitGraph.entries()) {
            waitSet.delete(operationId);
        }
    }



    private selectVictim(cycle: string[]): string {
        // Select victim based on lowest priority (or latest timeout in real implementation)
        return cycle[cycle.length - 1];
    }

    protected abortOperation(operationId: string): void {
        // Remove all locks held by this operation
        const locksToRemove: string[] = [];
        for (const [lockId, locks] of this.activeLocks.entries()) {
            const filteredLocks = locks.filter(lock => lock.operationId !== operationId);
            if (filteredLocks.length !== locks.length) {
                this.activeLocks.set(lockId, filteredLocks);
                if (filteredLocks.length === 0) {
                    locksToRemove.push(lockId);
                }
            }
        }
        
        // Clean up empty lock entries
        for (const lockId of locksToRemove) {
            this.activeLocks.delete(lockId);
            this.clearLockTimeout(lockId);
        }
        
        this.removeFromWaitGraph(operationId);
    }

    private setupLockTimeout(lockId: string, timeout: number): void {
        this.clearLockTimeout(lockId);
        
        const timeoutHandle = setTimeout(() => {
            const locks = this.activeLocks.get(lockId) || [];
            if (locks.length > 0) {
                console.log(`[DEADLOCK] Lock timeout for ${lockId}, releasing expired locks`);
                this.activeLocks.delete(lockId);
            }
            this.lockTimeouts.delete(lockId);
        }, timeout);
        
        this.lockTimeouts.set(lockId, timeoutHandle);
    }

    private clearLockTimeout(lockId: string): void {
        const timeoutHandle = this.lockTimeouts.get(lockId);
        if (timeoutHandle) {
            clearTimeout(timeoutHandle);
            this.lockTimeouts.delete(lockId);
        }
    }

    getStats() {
        return {
            activeLocks: Array.from(this.activeLocks.values()).flat().length,
            waitGraphEdges: Array.from(this.waitGraph.values()).reduce((sum, set) => sum + set.size, 0),
            pendingOperations: this.waitGraph.size
        };
    }

    cleanup(): void {
        for (const timeoutHandle of this.lockTimeouts.values()) {
            clearTimeout(timeoutHandle);
        }
        this.activeLocks.clear();
        this.waitGraph.clear();
        this.lockTimeouts.clear();
    }
}
