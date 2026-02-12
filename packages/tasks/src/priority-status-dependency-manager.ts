import { z } from "zod";
import type { Task, TaskPriority, TaskStatus } from "./types.ts";

export const PriorityStatusDependencySchema = z.object({
    taskId: z.string(),
    dependsOnTaskId: z.string(),
    dependencyType: z.enum(["priority-on-status", "status-on-priority"]),
    requiredCondition: z.union([
        z.object({ priority: z.enum(["low", "medium", "high"]) }),
        z.object({ status: z.enum(["todo", "in-progress", "done"]) }),
    ]),
});
export type PriorityStatusDependency = z.output<typeof PriorityStatusDependencySchema>;

export const DeadlockDetectionResultSchema = z.object({
    hasDeadlock: z.boolean(),
    detectedCycles: z.array(z.array(z.string())),
    conflictingOperations: z.array(z.object({
        taskId: z.string(),
        operation: z.string(),
        conflicts: z.array(z.string()),
    })),
    preventionActions: z.array(z.string()),
});
export type DeadlockDetectionResult = z.output<typeof DeadlockDetectionResultSchema>;

export const OperationLockRequestSchema = z.object({
    taskId: z.string(),
    operation: z.enum(["update-priority", "update-status"]),
    newValue: z.union([z.enum(["low", "medium", "high"]), z.enum(["todo", "in-progress", "done"])]),
    timestamp: z.number(),
    requestedBy: z.string(),
});
export type OperationLockRequest = z.output<typeof OperationLockRequestSchema>;

/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class PriorityStatusDependencyManager {
    private dependencies: Map<string, PriorityStatusDependency[]> = new Map();
    private operationLocks: Map<string, OperationLockRequest> = new Map();
    private lockTimeoutMs: number = 5000; // 5 second lock timeout

    constructor() {
        this.setupCleanupTimer();
    }

    /**
     * Add a priority-status dependency between tasks
     */
    public addDependency(dependency: PriorityStatusDependency): void {
        const existing = this.dependencies.get(dependency.taskId) || [];
        existing.push(dependency);
        this.dependencies.set(dependency.taskId, existing);
        
        console.log(`[PRIORITY-STATUS DEP] Added dependency: ${dependency.taskId} depends on ${dependency.dependsOnTaskId} (${dependency.dependencyType})`);
    }

    /**
     * Remove a priority-status dependency
     */
    public removeDependency(taskId: string, dependsOnTaskId: string): void {
        const existing = this.dependencies.get(taskId) || [];
        const filtered = existing.filter(dep => dep.dependsOnTaskId !== dependsOnTaskId);
        this.dependencies.set(taskId, filtered);
        
        console.log(`[PRIORITY-STATUS DEP] Removed dependency: ${taskId} -> ${dependsOnTaskId}`);
    }

    /**
     * Detect potential deadlocks before executing an operation
     */
    public detectDeadlocks(
        operation: OperationLockRequest,
        currentTasks: Map<string, Task>
    ): DeadlockDetectionResult {
        console.log(`[DEADLOCK DETECTION] Analyzing operation: ${operation.operation} on ${operation.taskId}`);
        
        // Create a temporary lock for this operation to test
        const testLocks = new Map(this.operationLocks);
        testLocks.set(operation.taskId, operation);
        
        // Detect cycles in the operation graph
        const cycles = this.detectOperationCycles(testLocks);
        
        // Check for conflicting operations based on dependencies
        const conflicts = this.detectConflictingOperations(operation, currentTasks, testLocks);
        
        const hasDeadlock = cycles.length > 0 || conflicts.length > 0;
        
        if (hasDeadlock) {
            console.log(`[DEADLOCK DETECTION] Deadlock detected! Cycles: ${cycles.length}, Conflicts: ${conflicts.length}`);
        }
        
        return {
            hasDeadlock,
            detectedCycles: cycles,
            conflictingOperations: conflicts,
            preventionActions: this.generatePreventionActions(cycles, conflicts),
        };
    }

    /**
     * Try to acquire a lock for an operation
     */
    public async tryAcquireLock(
        operation: OperationLockRequest,
        currentTasks: Map<string, Task>
    ): Promise<boolean> {
        // First check for deadlocks
        const deadlockResult = this.detectDeadlocks(operation, currentTasks);
        
        if (deadlockResult.hasDeadlock) {
            console.log(`[LOCK] Cannot acquire lock for ${operation.taskId}: deadlock detected`);
            return false;
        }

        // Check if task is already locked by another operation
        const existingLock = this.operationLocks.get(operation.taskId);
        if (existingLock && existingLock.requestedBy !== operation.requestedBy) {
            console.log(`[LOCK] Task ${operation.taskId} is locked by ${existingLock.requestedBy}`);
            return false;
        }

        // Acquire the lock
        this.operationLocks.set(operation.taskId, operation);
        console.log(`[LOCK] Acquired lock for ${operation.taskId} by ${operation.requestedBy}`);
        
        return true;
    }

    /**
     * Release a lock for a task
     */
    public releaseLock(taskId: string, requestedBy: string): void {
        const lock = this.operationLocks.get(taskId);
        if (lock && lock.requestedBy === requestedBy) {
            this.operationLocks.delete(taskId);
            console.log(`[LOCK] Released lock for ${taskId} by ${requestedBy}`);
        }
    }

    /**
     * Validate that a task's dependencies are satisfied for an operation
     */
    public validateDependencies(
        taskId: string,
        operation: "update-priority" | "update-status",
        newValue: TaskPriority | TaskStatus,
        currentTasks: Map<string, Task>
    ): { isValid: boolean; errors: string[] } {
        const errors: string[] = [];
        const task = currentTasks.get(taskId);
        if (!task) {
            errors.push(`Task ${taskId} not found`);
            return { isValid: false, errors };
        }

        const dependencies = this.dependencies.get(taskId) || [];
        
        for (const dep of dependencies) {
            const depTask = currentTasks.get(dep.dependsOnTaskId);
            if (!depTask) {
                errors.push(`Dependency task ${dep.dependsOnTaskId} not found`);
                continue;
            }

            // Check if the dependency condition is satisfied
            const conditionSatisfied = this.checkDependencyCondition(depTask, dep);
            
            if (!conditionSatisfied) {
                errors.push(
                    `Dependency not satisfied: ${taskId} requires ${dep.dependsOnTaskId} to have ${JSON.stringify(dep.requiredCondition)}`
                );
            }
        }

        return {
            isValid: errors.length === 0,
            errors,
        };
    }

    /**
     * Detect cycles in the operation lock graph
     */
    private detectOperationCycles(locks: Map<string, OperationLockRequest>): string[][] {
        const cycles: string[][] = [];
        const visited = new Set<string>();
        const recursionStack = new Set<string>();
        const path: string[] = [];

        const dfs = (taskId: string): boolean => {
            if (recursionStack.has(taskId)) {
                const cycleStart = path.indexOf(taskId);
                const cycle = path.slice(cycleStart);
                cycles.push([...cycle]);
                return true;
            }

            if (visited.has(taskId)) {
                return false;
            }

            visited.add(taskId);
            recursionStack.add(taskId);
            path.push(taskId);

            // Find dependent tasks through priority-status dependencies
            const dependencies = this.dependencies.get(taskId) || [];
            for (const dep of dependencies) {
                if (locks.has(dep.dependsOnTaskId)) {
                    dfs(dep.dependsOnTaskId);
                }
            }

            recursionStack.delete(taskId);
            path.pop();
            return false;
        };

        for (const taskId of locks.keys()) {
            if (!visited.has(taskId)) {
                dfs(taskId);
            }
        }

        return cycles;
    }

/**
 * Detect conflicting operations based on priority-status dependencies
 */
private detectConflictingOperations(
    operation: OperationLockRequest,
    _currentTasks: Map<string, Task>,
    locks: Map<string, OperationLockRequest>
): Array<{ taskId: string; operation: string; conflicts: string[] }> {
        const conflicts: Array<{ taskId: string; operation: string; conflicts: string[] }> = [];
        
        for (const [lockedTaskId, lockedOperation] of locks) {
            if (lockedTaskId === operation.taskId) continue;

            // Check if operations are on dependent tasks
            const hasDependency = this.tasksAreDependent(operation.taskId, lockedTaskId);
            
            if (hasDependency) {
                const conflictType = this.analyzeConflictType(operation, lockedOperation);
                if (conflictType) {
                    conflicts.push({
                        taskId: lockedTaskId,
                        operation: lockedOperation.operation,
                        conflicts: [conflictType],
                    });
                }
            }
        }

        return conflicts;
    }

    /**
     * Check if two tasks have a dependency relationship
     */
    private tasksAreDependent(taskId1: string, taskId2: string): boolean {
        const deps1 = this.dependencies.get(taskId1) || [];
        const deps2 = this.dependencies.get(taskId2) || [];
        
        // Direct dependency
        if (deps1.some(dep => dep.dependsOnTaskId === taskId2) || 
            deps2.some(dep => dep.dependsOnTaskId === taskId1)) {
            return true;
        }
        
        // Indirect dependency through transitive closure
        return this.checkTransitiveDependency(taskId1, taskId2) || 
               this.checkTransitiveDependency(taskId2, taskId1);
    }

    /**
     * Check transitive dependency between tasks
     */
    private checkTransitiveDependency(from: string, to: string, visited: Set<string> = new Set()): boolean {
        if (visited.has(from)) return false;
        visited.add(from);
        
        const deps = this.dependencies.get(from) || [];
        for (const dep of deps) {
            if (dep.dependsOnTaskId === to) return true;
            if (this.checkTransitiveDependency(dep.dependsOnTaskId, to, visited)) return true;
        }
        
        return false;
    }

/**
 * Analyze the type of conflict between two operations
 */
private analyzeConflictType(
    op1: OperationLockRequest,
    op2: OperationLockRequest
): string | null {
    // Priority-status circular dependency
    if (op1.operation === "update-priority" && op2.operation === "update-status") {
        return "priority-status-circular-dependency";
    }
    if (op1.operation === "update-status" && op2.operation === "update-priority") {
        return "status-priority-circular-dependency";
    }
    
    // Same operation type on dependent tasks
    if (op1.operation === op2.operation) {
        return `${op1.operation}-conflict`;
    }
    
    return null;
}

    /**
     * Generate prevention actions for detected deadlocks
     */
    private generatePreventionActions(
        cycles: string[][],
        conflicts: Array<{ taskId: string; operation: string; conflicts: string[] }>
    ): string[] {
        const actions: string[] = [];
        
        if (cycles.length > 0) {
            actions.push("wait-for-lock-timeout", "operation-reordering", "resource-backoff");
        }
        
        if (conflicts.length > 0) {
            actions.push("conflict-resolution", "priority-based-preemption", "transaction-rollback");
        }
        
        return actions;
    }

    /**
     * Check if a dependency condition is satisfied
     */
    private checkDependencyCondition(task: Task, dependency: PriorityStatusDependency): boolean {
        if ("priority" in dependency.requiredCondition) {
            return task.priority === dependency.requiredCondition.priority;
        }
        if ("status" in dependency.requiredCondition) {
            return task.status === dependency.requiredCondition.status;
        }
        return false;
    }

    /**
     * Setup cleanup timer for expired locks
     */
    private setupCleanupTimer(): void {
        setInterval(() => {
            const now = Date.now();
            const expiredLocks: string[] = [];
            
            for (const [taskId, lock] of this.operationLocks) {
                if (now - lock.timestamp > this.lockTimeoutMs) {
                    expiredLocks.push(taskId);
                }
            }
            
            for (const taskId of expiredLocks) {
                const lock = this.operationLocks.get(taskId);
                this.operationLocks.delete(taskId);
                console.log(`[LOCK] Auto-released expired lock for ${taskId} (held by ${lock?.requestedBy})`);
            }
        }, 1000); // Check every second
    }

    /**
     * Get current lock status for debugging
     */
    public getLockStatus(): { activeLocks: number; lockedTasks: string[] } {
        return {
            activeLocks: this.operationLocks.size,
            lockedTasks: Array.from(this.operationLocks.keys()),
        };
    }

    /**
     * Get all dependencies for a task
     */
    public getTaskDependencies(taskId: string): PriorityStatusDependency[] {
        return this.dependencies.get(taskId) || [];
    }

    /**
     * Clear all dependencies and locks (for testing)
     */
    public clear(): void {
        this.dependencies.clear();
        this.operationLocks.clear();
    }
}

export const priorityStatusDependencyManager = new PriorityStatusDependencyManager();