import { z } from "zod";
import type { Task, TaskPriority, TaskStatus } from "./types.ts";

export const ComplexDependencySchema = z.object({
    taskId: z.string(),
    level: z.number(),
    node: z.string(),
    dependencies: z.array(z.object({
        taskId: z.string(),
        level: z.number(),
        type: z.enum(["same-level", "higher-level", "lower-level", "cross-level"]),
        strength: z.number().min(0).max(1),
    })),
    resourceConstraints: z.object({
        maxConcurrent: z.number(),
        timeoutMs: z.number(),
        retryAttempts: z.number(),
    }).optional(),
});

export type ComplexDependency = z.output<typeof ComplexDependencySchema>;

export const ResourceConstraintSchema = z.object({
    totalResources: z.number(),
    allocatedResources: z.number(),
    availableResources: z.number(),
    pressureLevel: z.enum(["low", "medium", "high", "critical"]),
    rebalancingNeeded: z.boolean(),
});

export type ResourceConstraint = z.output<typeof ResourceConstraintSchema>;

export const DynamicRebalancingStrategySchema = z.object({
    strategy: z.enum(["priority-based", "load-based", "deadline-based", "fairness-based"]),
    threshold: z.number(),
    cooldownMs: z.number(),
    maxRebalancePerCycle: z.number(),
});

export type DynamicRebalancingStrategy = z.output<typeof DynamicRebalancingStrategySchema>;

export const ComplexDeadlockDetectionResultSchema = z.object({
    hasDeadlock: z.boolean(),
    deadlockType: z.enum(["circular-dependency", "resource-exhaustion", "priority-inversion", "timeout"]),
    detectedCycles: z.array(z.array(z.object({
        taskId: z.string(),
        level: z.number(),
        node: z.string(),
    }))),
    conflictingOperations: z.array(z.object({
        taskId: z.string(),
        operation: z.string(),
        conflicts: z.array(z.string()),
        severity: z.enum(["low", "medium", "high", "critical"]),
    })),
    resourceConstraints: ResourceConstraintSchema,
    preventionActions: z.array(z.string()),
    resolutionStrategies: z.array(z.string()),
    estimatedResolutionTime: z.number(),
});

export type ComplexDeadlockDetectionResult = z.output<typeof ComplexDeadlockDetectionResultSchema>;

export const CrossLevelDependencySchema = z.object({
    fromTask: z.object({ taskId: z.string(), level: z.number() }),
    toTask: z.object({ taskId: z.string(), level: z.number() }),
    dependencyType: z.enum(["parent-child", "peer-peer", "hierarchical", "circular"]),
    strength: z.number().min(0).max(1),
    condition: z.union([
        z.object({ status: z.enum(["todo", "in-progress", "done"]) }),
        z.object({ priority: z.enum(["low", "medium", "high"]) }),
        z.object({ resource: z.string() }),
    ]),
});

export type CrossLevelDependency = z.output<typeof CrossLevelDependencySchema>;

export class ComplexDependencyDeadlockDetector {
    private dependencies: Map<string, ComplexDependency> = new Map();
    private crossLevelDependencies: Map<string, CrossLevelDependency[]> = new Map();
    private resourceConstraints: Map<string, ResourceConstraint> = new Map();
    private rebalancingStrategies: Map<string, DynamicRebalancingStrategy> = new Map();
    private operationTimeouts: Map<string, number> = new Map();
    private deadlockHistory: Array<{
        timestamp: number;
        type: string;
        resolution: string;
        duration: number;
    }> = [];

    constructor() {
        this.initializeDefaultStrategies();
        this.setupResourceMonitoring();
    }

    /**
     * Add a complex dependency with multi-level support
     */
    public addComplexDependency(dependency: ComplexDependency): void {
        this.dependencies.set(dependency.taskId, dependency);
        console.log(`[COMPLEX DEP] Added complex dependency for task ${dependency.taskId} at level ${dependency.level}`);
        
        // Update cross-level dependencies
        this.updateCrossLevelDependencies(dependency);
        
        // Initialize resource constraints if not present
        if (!this.resourceConstraints.has(dependency.taskId) && dependency.resourceConstraints) {
            this.resourceConstraints.set(dependency.taskId, {
                totalResources: dependency.resourceConstraints.maxConcurrent,
                allocatedResources: 0,
                availableResources: dependency.resourceConstraints.maxConcurrent,
                pressureLevel: "low",
                rebalancingNeeded: false,
            });
        }
    }

    /**
     * Detect complex deadlocks with multi-level analysis
     */
    public detectComplexDeadlocks(
        operations: Map<string, { operation: string; timestamp: number }>,
        currentTasks: Map<string, Task>
    ): ComplexDeadlockDetectionResult {
        console.log(`[COMPLEX DEADLOCK] Starting complex deadlock detection for ${operations.size} operations`);
        
        const startTime = Date.now();
        
        // Detect circular dependencies at multiple levels
        const circularCycles = this.detectMultiLevelCycles(operations, currentTasks);
        
        // Analyze resource constraints
        const resourceAnalysis = this.analyzeResourceConstraints(operations);
        
        // Check for priority inversion scenarios
        const priorityInversions = this.detectPriorityInversions(operations, currentTasks);
        
        // Detect timeout-based deadlocks
        const timeoutDeadlocks = this.detectTimeoutDeadlocks(operations);
        
        const hasDeadlock = circularCycles.length > 0 || 
                           resourceAnalysis.pressureLevel === "critical" || 
                           priorityInversions.length > 0 || 
                           timeoutDeadlocks.length > 0;
        
        const deadlockType = this.determineDeadlockType(
            circularCycles, 
            resourceAnalysis, 
            priorityInversions, 
            timeoutDeadlocks
        );
        
        const result: ComplexDeadlockDetectionResult = {
            hasDeadlock,
            deadlockType,
            detectedCycles: circularCycles,
            conflictingOperations: this.buildConflictMatrix(operations, currentTasks),
            resourceConstraints: resourceAnalysis,
            preventionActions: this.generatePreventionActions(hasDeadlock, deadlockType),
            resolutionStrategies: this.generateResolutionStrategies(deadlockType),
            estimatedResolutionTime: this.estimateResolutionTime(hasDeadlock, deadlockType),
        };
        
        const duration = Date.now() - startTime;
        console.log(`[COMPLEX DEADLOCK] Detection completed in ${duration}ms: ${hasDeadlock ? "DEADLOCK" : "CLEAR"}`);
        
        // Record in history
        if (hasDeadlock) {
            this.deadlockHistory.push({
                timestamp: Date.now(),
                type: deadlockType,
                resolution: "pending",
                duration,
            });
        }
        
        return result;
    }

    /**
     * Perform dynamic priority rebalancing under resource constraints
     */
    public performDynamicRebalancing(
        constrainedTasks: string[],
        currentTasks: Map<string, Task>
    ): Array<{ taskId: string; oldPriority: TaskPriority; newPriority: TaskPriority; reason: string }> {
        console.log(`[REBALANCING] Starting dynamic rebalancing for ${constrainedTasks.length} tasks`);
        
        const rebalancingActions: Array<{ taskId: string; oldPriority: TaskPriority; newPriority: TaskPriority; reason: string }> = [];
        
        // Analyze current resource pressure
        const resourcePressure = this.calculateResourcePressure(constrainedTasks);
        
        // Select appropriate rebalancing strategy
        const strategy = this.selectRebalancingStrategy(resourcePressure);
        
        // Perform rebalancing based on strategy
        for (const taskId of constrainedTasks) {
            const task = currentTasks.get(taskId);
            if (!task) continue;
            
            const oldPriority = task.priority;
            const newPriority = this.calculateNewPriority(task, strategy, resourcePressure);
            
            if (oldPriority !== newPriority) {
                rebalancingActions.push({
                    taskId,
                    oldPriority,
                    newPriority,
                    reason: this.generateRebalancingReason(strategy, resourcePressure),
                });
                
                // Update the task priority in our tracking
                task.priority = newPriority;
            }
        }
        
        console.log(`[REBALANCING] Completed ${rebalancingActions.length} rebalancing actions`);
        return rebalancingActions;
    }

    /**
     * Resolve cross-level dependencies with timeout-based recovery
     */
    public resolveCrossLevelDependencies(
        deadlockedTasks: string[],
        currentTasks: Map<string, Task>
    ): Promise<Array<{ taskId: string; resolution: string; success: boolean }>> {
        return new Promise((resolve) => {
            console.log(`[CROSS-LEVEL] Resolving cross-level dependencies for ${deadlockedTasks.length} tasks`);
            
            const resolutions: Array<{ taskId: string; resolution: string; success: boolean }> = [];
            const timeoutMs = 10000; // 10 second timeout
            const startTime = Date.now();
            
            const attemptResolution = async () => {
                for (const taskId of deadlockedTasks) {
                    try {
                        const resolution = await this.attemptCrossLevelResolution(taskId, currentTasks);
                        resolutions.push(resolution);
                        
                        // Add delay to prevent overwhelming the system
                        await new Promise(delay => setTimeout(delay, 100));
                    } catch (error) {
                        resolutions.push({
                            taskId,
                            resolution: `Failed: ${error instanceof Error ? error.message : "Unknown error"}`,
                            success: false,
                        });
                    }
                }
                
                resolve(resolutions);
            };
            
            // Set timeout for the entire resolution process
            setTimeout(() => {
                if (resolutions.length === 0) {
                    console.log(`[CROSS-LEVEL] Resolution timeout after ${timeoutMs}ms`);
                    resolve(deadlockedTasks.map(taskId => ({
                        taskId,
                        resolution: "Timeout - fallback recovery",
                        success: false,
                    })));
                }
            }, timeoutMs);
            
            attemptResolution();
        });
    }

    /**
     * Detect multi-level circular dependencies
     */
    private detectMultiLevelCycles(
        operations: Map<string, { operation: string; timestamp: number }>,
        currentTasks: Map<string, Task>
    ): Array<{ taskId: string; level: number; node: string }[]> {
        const cycles: Array<{ taskId: string; level: number; node: string }[]> = [];
        const visited = new Set<string>();
        const recursionStack = new Set<string>();
        const path: Array<{ taskId: string; level: number; node: string }> = [];

        const dfs = (taskId: string, level: number): boolean => {
            const dependency = this.dependencies.get(taskId);
            if (!dependency) return false;

            if (recursionStack.has(taskId)) {
                const cycleStart = path.findIndex(p => p.taskId === taskId);
                if (cycleStart !== -1) {
                    cycles.push(path.slice(cycleStart));
                }
                return true;
            }

            if (visited.has(taskId)) return false;

            visited.add(taskId);
            recursionStack.add(taskId);
            path.push({ taskId, level, node: dependency.node });

            // Check dependencies at same and different levels
            for (const dep of dependency.dependencies) {
                if (operations.has(dep.taskId)) {
                    dfs(dep.taskId, dep.level);
                }
            }

            recursionStack.delete(taskId);
            path.pop();
            return false;
        };

        for (const taskId of operations.keys()) {
            if (!visited.has(taskId)) {
                const dependency = this.dependencies.get(taskId);
                if (dependency) {
                    dfs(taskId, dependency.level);
                }
            }
        }

        return cycles;
    }

    /**
     * Analyze resource constraints and pressure
     */
    private analyzeResourceConstraints(
        operations: Map<string, { operation: string; timestamp: number }>
    ): ResourceConstraint {
        let totalResources = 0;
        let allocatedResources = 0;
        let criticalOperations = 0;

        for (const [taskId] of operations) {
            const constraint = this.resourceConstraints.get(taskId);
            if (constraint) {
                totalResources += constraint.totalResources;
                allocatedResources += constraint.allocatedResources;
                
                if (constraint.pressureLevel === "critical") {
                    criticalOperations++;
                }
            } else {
                // Default resource allocation
                totalResources += 10;
                allocatedResources += operations.has(taskId) ? 1 : 0;
            }
        }

        const availableResources = totalResources - allocatedResources;
        const pressureRatio = allocatedResources / totalResources;

        let pressureLevel: ResourceConstraint["pressureLevel"];
        let rebalancingNeeded: boolean;

        if (pressureRatio >= 0.9) {
            pressureLevel = "critical";
            rebalancingNeeded = true;
        } else if (pressureRatio >= 0.7) {
            pressureLevel = "high";
            rebalancingNeeded = true;
        } else if (pressureRatio >= 0.5) {
            pressureLevel = "medium";
            rebalancingNeeded = false;
        } else {
            pressureLevel = "low";
            rebalancingNeeded = false;
        }

        return {
            totalResources,
            allocatedResources,
            availableResources,
            pressureLevel,
            rebalancingNeeded,
        };
    }

    /**
     * Detect priority inversion scenarios
     */
    private detectPriorityInversions(
        operations: Map<string, { operation: string; timestamp: number }>,
        currentTasks: Map<string, Task>
    ): Array<{ taskId: string; operation: string; conflicts: string[] }> {
        const inversions: Array<{ taskId: string; operation: string; conflicts: string[] }> = [];

        for (const [taskId, operation] of operations) {
            const task = currentTasks.get(taskId);
            if (!task) continue;

            // Check if low priority task is blocking high priority tasks
            if (task.priority === "low") {
                const dependency = this.dependencies.get(taskId);
                if (dependency) {
                    for (const dep of dependency.dependencies) {
                        const depTask = currentTasks.get(dep.taskId);
                        if (depTask && depTask.priority === "high" && operations.has(dep.taskId)) {
                            inversions.push({
                                taskId,
                                operation: operation.operation,
                                conflicts: [`High priority task ${dep.taskId} waiting on low priority task ${taskId}`],
                            });
                        }
                    }
                }
            }
        }

        return inversions;
    }

    /**
     * Detect timeout-based deadlocks
     */
    private detectTimeoutDeadlocks(
        operations: Map<string, { operation: string; timestamp: number }>
    ): string[] {
        const deadlockedTasks: string[] = [];
        const now = Date.now();
        const defaultTimeout = 5000; // 5 seconds

        for (const [taskId, operation] of operations) {
            const timeout = this.operationTimeouts.get(taskId) || defaultTimeout;
            if (now - operation.timestamp > timeout) {
                deadlockedTasks.push(taskId);
            }
        }

        return deadlockedTasks;
    }

    /**
     * Determine the primary deadlock type
     */
    private determineDeadlockType(
        cycles: any[],
        resourceAnalysis: ResourceConstraint,
        priorityInversions: any[],
        timeoutDeadlocks: string[]
    ): ComplexDeadlockDetectionResult["deadlockType"] {
        if (cycles.length > 0) return "circular-dependency";
        if (resourceAnalysis.pressureLevel === "critical") return "resource-exhaustion";
        if (priorityInversions.length > 0) return "priority-inversion";
        if (timeoutDeadlocks.length > 0) return "timeout";
        return "circular-dependency"; // Default fallback
    }

    /**
     * Build conflict matrix for operations
     */
    private buildConflictMatrix(
        operations: Map<string, { operation: string; timestamp: number }>,
        currentTasks: Map<string, Task>
    ): ComplexDeadlockDetectionResult["conflictingOperations"] {
        const conflicts: ComplexDeadlockDetectionResult["conflictingOperations"] = [];

        for (const [taskId, operation] of operations) {
            const task = currentTasks.get(taskId);
            if (!task) continue;

            const dependency = this.dependencies.get(taskId);
            if (!dependency) continue;

            const taskConflicts: string[] = [];

            // Check for conflicts with dependencies
            for (const dep of dependency.dependencies) {
                if (operations.has(dep.taskId)) {
                    taskConflicts.push(`Dependency on ${dep.taskId} (${dep.type})`);
                }
            }

            if (taskConflicts.length > 0) {
                conflicts.push({
                    taskId,
                    operation: operation.operation,
                    conflicts: taskConflicts,
                    severity: this.determineConflictSeverity(task, taskConflicts),
                });
            }
        }

        return conflicts;
    }

    /**
     * Determine conflict severity based on task priority and number of conflicts
     */
    private determineConflictSeverity(
        task: Task,
        conflicts: string[]
    ): ComplexDeadlockDetectionResult["conflictingOperations"][0]["severity"] {
        if (task.priority === "high" && conflicts.length > 2) return "critical";
        if (task.priority === "high" && conflicts.length > 0) return "high";
        if (conflicts.length > 3) return "high";
        if (conflicts.length > 1) return "medium";
        return "low";
    }

    /**
     * Generate prevention actions for detected deadlocks
     */
    private generatePreventionActions(
        hasDeadlock: boolean,
        deadlockType: ComplexDeadlockDetectionResult["deadlockType"]
    ): string[] {
        const actions: string[] = [];

        if (!hasDeadlock) {
            actions.push("monitor-system-state", "maintain-resource-balance");
            return actions;
        }

        switch (deadlockType) {
            case "circular-dependency":
                actions.push("dependency-breaking", "topological-sorting", "resource-ordering");
                break;
            case "resource-exhaustion":
                actions.push("resource-scaling", "load-shedding", "priority-preemption");
                break;
            case "priority-inversion":
                actions.push("priority-inheritance", "priority-ceiling", "donation-protocol");
                break;
            case "timeout":
                actions.push("timeout-extension", "exponential-backoff", "circuit-breaker");
                break;
        }

        actions.push("deadlock-detection-monitoring", "recovery-protocol-activation");
        return actions;
    }

    /**
     * Generate resolution strategies
     */
    private generateResolutionStrategies(
        deadlockType: ComplexDeadlockDetectionResult["deadlockType"]
    ): string[] {
        const strategies: string[] = [];

        switch (deadlockType) {
            case "circular-dependency":
                strategies.push("victim-selection", "rollback-recovery", "checkpoint-restart");
                break;
            case "resource-exhaustion":
                strategies.push("dynamic-rebalancing", "resource-reallocation", "load-redistribution");
                break;
            case "priority-inversion":
                strategies.push("priority-inheritance", "priority-donation", "immediate-preemption");
                break;
            case "timeout":
                strategies.push("graceful-degradation", "fallback-mechanisms", "partial-completion");
                break;
        }

        return strategies;
    }

    /**
     * Estimate resolution time based on deadlock type and complexity
     */
    private estimateResolutionTime(
        hasDeadlock: boolean,
        deadlockType: ComplexDeadlockDetectionResult["deadlockType"]
    ): number {
        if (!hasDeadlock) return 0;

        const baseTimes = {
            "circular-dependency": 5000,
            "resource-exhaustion": 3000,
            "priority-inversion": 2000,
            "timeout": 1000,
        };

        // Add complexity factor based on history
        const recentDeadlocks = this.deadlockHistory.slice(-5);
        const complexityFactor = recentDeadlocks.length > 0 ? 1.5 : 1.0;

        return Math.floor(baseTimes[deadlockType] * complexityFactor);
    }

    /**
     * Update cross-level dependencies
     */
    private updateCrossLevelDependencies(dependency: ComplexDependency): void {
        const crossLevelDeps: CrossLevelDependency[] = [];

        for (const dep of dependency.dependencies) {
            const crossLevelDep: CrossLevelDependency = {
                fromTask: { taskId: dependency.taskId, level: dependency.level },
                toTask: { taskId: dep.taskId, level: dep.level },
                dependencyType: this.mapDependencyType(dep.type),
                strength: dep.strength,
                condition: { status: "in-progress" }, // Default condition
            };

            crossLevelDeps.push(crossLevelDep);
        }

        this.crossLevelDependencies.set(dependency.taskId, crossLevelDeps);
    }

    /**
     * Map dependency type string to enum
     */
    private mapDependencyType(
        type: string
    ): CrossLevelDependency["dependencyType"] {
        switch (type) {
            case "same-level": return "peer-peer";
            case "higher-level": return "parent-child";
            case "lower-level": return "hierarchical";
            case "cross-level": return "circular";
            default: return "peer-peer";
        }
    }

    /**
     * Initialize default rebalancing strategies
     */
    private initializeDefaultStrategies(): void {
        this.rebalancingStrategies.set("priority-based", {
            strategy: "priority-based",
            threshold: 0.7,
            cooldownMs: 2000,
            maxRebalancePerCycle: 5,
        });

        this.rebalancingStrategies.set("load-based", {
            strategy: "load-based",
            threshold: 0.8,
            cooldownMs: 1500,
            maxRebalancePerCycle: 8,
        });
    }

    /**
     * Setup resource monitoring
     */
    private setupResourceMonitoring(): void {
        setInterval(() => {
            this.updateResourceConstraints();
        }, 5000); // Monitor every 5 seconds
    }

    /**
     * Update resource constraints based on current state
     */
    private updateResourceConstraints(): void {
        for (const [taskId, constraint] of this.resourceConstraints) {
            // Simulate resource pressure changes
            const pressureChange = Math.random() * 0.2 - 0.1; // ±10% change
            const newAllocated = Math.max(0, Math.min(
                constraint.totalResources,
                constraint.allocatedResources + Math.floor(pressureChange * constraint.totalResources)
            ));

            constraint.allocatedResources = newAllocated;
            constraint.availableResources = constraint.totalResources - newAllocated;

            // Update pressure level
            const pressureRatio = newAllocated / constraint.totalResources;
            if (pressureRatio >= 0.9) {
                constraint.pressureLevel = "critical";
                constraint.rebalancingNeeded = true;
            } else if (pressureRatio >= 0.7) {
                constraint.pressureLevel = "high";
                constraint.rebalancingNeeded = pressureRatio >= 0.8;
            } else if (pressureRatio >= 0.5) {
                constraint.pressureLevel = "medium";
                constraint.rebalancingNeeded = false;
            } else {
                constraint.pressureLevel = "low";
                constraint.rebalancingNeeded = false;
            }
        }
    }

    /**
     * Calculate resource pressure for tasks
     */
    private calculateResourcePressure(constrainedTasks: string[]): ResourceConstraint["pressureLevel"] {
        let totalPressure = 0;
        let criticalCount = 0;

        for (const taskId of constrainedTasks) {
            const constraint = this.resourceConstraints.get(taskId);
            if (constraint) {
                totalPressure += this.getPressureNumeric(constraint.pressureLevel);
                if (constraint.pressureLevel === "critical") criticalCount++;
            }
        }

        const averagePressure = totalPressure / constrainedTasks.length;
        
        if (criticalCount > 0) return "critical";
        if (averagePressure >= 3) return "high";
        if (averagePressure >= 2) return "medium";
        return "low";
    }

    /**
     * Convert pressure level to numeric value
     */
    private getPressureNumeric(pressure: ResourceConstraint["pressureLevel"]): number {
        switch (pressure) {
            case "critical": return 4;
            case "high": return 3;
            case "medium": return 2;
            case "low": return 1;
        }
    }

    /**
     * Select appropriate rebalancing strategy
     */
    private selectRebalancingStrategy(
        pressure: ResourceConstraint["pressureLevel"]
    ): DynamicRebalancingStrategy {
        if (pressure === "critical" || pressure === "high") {
            return this.rebalancingStrategies.get("priority-based")!;
        }
        return this.rebalancingStrategies.get("load-based")!;
    }

    /**
     * Calculate new priority for a task based on strategy
     */
    private calculateNewPriority(
        task: Task,
        strategy: DynamicRebalancingStrategy,
        pressure: ResourceConstraint["pressureLevel"]
    ): TaskPriority {
        if (strategy.strategy === "priority-based") {
            // High pressure tasks get higher priority
            if (pressure === "critical" || pressure === "high") {
                return "high";
            } else if (pressure === "medium") {
                return task.priority === "low" ? "medium" : task.priority;
            }
        } else if (strategy.strategy === "load-based") {
            // Balance load by adjusting priorities
            const random = Math.random();
            if (random < 0.3) return "high";
            if (random < 0.6) return "medium";
            return "low";
        }

        return task.priority;
    }

    /**
     * Generate rebalancing reason
     */
    private generateRebalancingReason(
        strategy: DynamicRebalancingStrategy,
        pressure: ResourceConstraint["pressureLevel"]
    ): string {
        return `${strategy.strategy} rebalancing due to ${pressure} resource pressure`;
    }

    /**
     * Attempt cross-level dependency resolution
     */
    private async attemptCrossLevelResolution(
        taskId: string,
        currentTasks: Map<string, Task>
    ): Promise<{ taskId: string; resolution: string; success: boolean }> {
        const crossLevelDeps = this.crossLevelDependencies.get(taskId);
        if (!crossLevelDeps || crossLevelDeps.length === 0) {
            return {
                taskId,
                resolution: "No cross-level dependencies found",
                success: true,
            };
        }

        // Try to resolve dependencies in order of strength
        const sortedDeps = crossLevelDeps.sort((a, b) => b.strength - a.strength);
        
        for (const dep of sortedDeps) {
            const depTask = currentTasks.get(dep.toTask.taskId);
            if (!depTask) continue;

            // Check if dependency condition is satisfied
            if (this.isDependencyConditionSatisfied(depTask, dep)) {
                continue; // Already satisfied
            }

            // Try to satisfy the dependency
            try {
                await this.satisfyDependency(dep, depTask);
                return {
                    taskId,
                    resolution: `Resolved dependency on ${dep.toTask.taskId}`,
                    success: true,
                };
            } catch (error) {
                console.log(`Failed to resolve dependency for ${taskId}:`, error);
            }
        }

        return {
            taskId,
            resolution: "Could not resolve cross-level dependencies",
            success: false,
        };
    }

    /**
     * Check if dependency condition is satisfied
     */
    private isDependencyConditionSatisfied(
        task: Task,
        dependency: CrossLevelDependency
    ): boolean {
        if ("status" in dependency.condition) {
            return task.status === dependency.condition.status;
        }
        if ("priority" in dependency.condition) {
            return task.priority === dependency.condition.priority;
        }
        return false;
    }

    /**
     * Satisfy a dependency by updating the dependent task
     */
    private async satisfyDependency(
        dependency: CrossLevelDependency,
        task: Task
    ): Promise<void> {
        if ("status" in dependency.condition) {
            task.status = dependency.condition.status;
        }
        if ("priority" in dependency.condition) {
            task.priority = dependency.condition.priority;
        }

        // Simulate async operation
        await new Promise(resolve => setTimeout(resolve, 50));
    }

    /**
     * Get deadlock detection statistics
     */
    public getDeadlockStatistics(): {
        totalDeadlocks: number;
        averageResolutionTime: number;
        commonTypes: Record<string, number>;
        recentActivity: boolean;
    } {
        const totalDeadlocks = this.deadlockHistory.length;
        const averageResolutionTime = totalDeadlocks > 0 
            ? this.deadlockHistory.reduce((sum, d) => sum + d.duration, 0) / totalDeadlocks 
            : 0;

        const commonTypes: Record<string, number> = {};
        for (const deadlock of this.deadlockHistory) {
            commonTypes[deadlock.type] = (commonTypes[deadlock.type] || 0) + 1;
        }

        const recentActivity = this.deadlockHistory.length > 0 && 
            Date.now() - this.deadlockHistory[this.deadlockHistory.length - 1].timestamp < 60000;

        return {
            totalDeadlocks,
            averageResolutionTime,
            commonTypes,
            recentActivity,
        };
    }

    /**
     * Clear all dependencies and state (for testing)
     */
    public clear(): void {
        this.dependencies.clear();
        this.crossLevelDependencies.clear();
        this.resourceConstraints.clear();
        this.operationTimeouts.clear();
        this.deadlockHistory = [];
    }
}

export const complexDependencyDeadlockDetector = new ComplexDependencyDeadlockDetector();