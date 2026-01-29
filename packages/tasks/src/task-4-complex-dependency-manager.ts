import { z } from "zod";
import type { Task, TaskPriority, TaskStatus } from "./types.ts";
import { 
    complexDependencyDeadlockDetector, 
    type ComplexDependency, 
    type ComplexDeadlockDetectionResult,
    type ResourceConstraint
} from "./complex-dependency-deadlock-detector.ts";

export const TaskExecutionRequestSchema = z.object({
    taskId: z.string(),
    operation: z.enum(["create", "update", "delete", "execute"]),
    priority: z.enum(["low", "medium", "high"]).optional(),
    timeoutMs: z.number().optional(),
    retryAttempts: z.number().optional(),
    dependencies: z.array(z.string()).optional(),
});

export type TaskExecutionRequest = z.output<typeof TaskExecutionRequestSchema>;

export const TaskExecutionResultSchema = z.object({
    taskId: z.string(),
    success: z.boolean(),
    operation: z.string(),
    executionTime: z.number(),
    deadlockDetected: z.boolean(),
    deadlockResolution: z.string().optional(),
    priorityRebalanced: z.boolean(),
    finalPriority: z.enum(["low", "medium", "high"]).optional(),
    error: z.string().optional(),
});

export type TaskExecutionResult = z.output<typeof TaskExecutionResultSchema>;

export const ResourcePressureMetricsSchema = z.object({
    totalTasks: z.number(),
    activeOperations: z.number(),
    resourceUtilization: z.number(),
    pressureLevel: z.enum(["low", "medium", "high", "critical"]),
    rebalancingActive: z.boolean(),
    averageExecutionTime: z.number(),
});

export type ResourcePressureMetrics = z.output<typeof ResourcePressureMetricsSchema>;

export class Task4ComplexDependencyManager {
    private executionQueue: TaskExecutionRequest[] = [];
    private activeOperations: Map<string, TaskExecutionRequest> = new Map();
    private completedOperations: TaskExecutionResult[] = [];
    private resourceMetrics: ResourcePressureMetrics;
    private rebalancingCooldown: Map<string, number> = new Map();
    private deadlockResolutionCache: Map<string, string> = new Map();

    constructor() {
        this.resourceMetrics = this.initializeResourceMetrics();
        this.setupResourceMonitoring();
        this.setupRebalancingScheduler();
    }

    /**
     * Execute a task with complex dependency handling and dynamic rebalancing
     * Enhanced with advanced multi-level deadlock prevention for Task 4
     */
    public async executeTaskWithComplexDependencies(
        request: TaskExecutionRequest,
        currentTasks: Map<string, Task>
    ): Promise<TaskExecutionResult> {
        const startTime = Date.now();
        console.log(`[TASK-4-ENHANCED] Executing task ${request.taskId} with operation ${request.operation}`);

        try {
            // Step 1: Enhanced dependency analysis and setup
            if (request.dependencies && request.dependencies.length > 0) {
                this.addComplexDependencyForTask(request, currentTasks);
                await this.performDependencyGraphOptimization(request.taskId, currentTasks);
            }

            // Step 2: Advanced deadlock detection with predictive analysis
            const operations = new Map<string, { operation: string; timestamp: number }>();
            for (const [taskId, req] of this.activeOperations) {
                operations.set(taskId, {
                    operation: req.operation,
                    timestamp: Date.now(),
                });
            }
            operations.set(request.taskId, {
                operation: request.operation,
                timestamp: Date.now(),
            });

            const deadlockResult = complexDependencyDeadlockDetector.detectComplexDeadlocks(
                operations,
                currentTasks
            );

            // Enhanced Step 3: Proactive deadlock prevention
            const proactiveResult = await this.performProactiveDeadlockPrevention(
                request,
                deadlockResult,
                currentTasks
            );

            if (!proactiveResult.success) {
                return this.createExecutionResult(request, startTime, false, 
                    `Proactive deadlock prevention failed: ${proactiveResult.error}`);
            }

            // Step 4: Handle detected deadlocks with advanced resolution
            if (deadlockResult.hasDeadlock) {
                console.log(`[TASK-4-ENHANCED] Advanced deadlock detected for task ${request.taskId}: ${deadlockResult.deadlockType}`);
                
                const resolutionResult = await this.handleAdvancedDeadlockResolution(
                    request,
                    deadlockResult,
                    currentTasks
                );

                if (!resolutionResult.success) {
                    return this.createExecutionResult(request, startTime, false, 
                        `Advanced deadlock resolution failed: ${resolutionResult.error}`);
                }
            }

            // Step 5: Intelligent dynamic rebalancing with resource awareness
            const rebalancingNeeded = this.shouldPerformIntelligentRebalancing(request, currentTasks);
            let priorityRebalanced = false;
            let finalPriority = request.priority;

            if (rebalancingNeeded) {
                const rebalancingResult = this.performIntelligentPriorityRebalancing(
                    [request.taskId],
                    currentTasks,
                    deadlockResult
                );

                if (rebalancingResult.length > 0) {
                    priorityRebalanced = true;
                    const taskRebalancing = rebalancingResult.find(r => r.taskId === request.taskId);
                    if (taskRebalancing) {
                        finalPriority = taskRebalancing.newPriority;
                        console.log(`[TASK-4-ENHANCED] Intelligently rebalanced priority for task ${request.taskId}: ${taskRebalancing.oldPriority} -> ${finalPriority}`);
                    }
                }
            }

            // Step 6: Enhanced task operation execution with monitoring
            this.activeOperations.set(request.taskId, request);
            
            const executionSuccess = await this.executeEnhancedTaskOperation(
                request,
                currentTasks,
                deadlockResult
            );

            this.activeOperations.delete(request.taskId);

            // Step 7: Advanced resource metrics and learning
            this.updateAdvancedResourceMetrics(executionSuccess, Date.now() - startTime, deadlockResult);

            const result = this.createExecutionResult(request, startTime, executionSuccess);
            result.deadlockDetected = deadlockResult.hasDeadlock;
            result.priorityRebalanced = priorityRebalanced;
            result.finalPriority = finalPriority;

            this.completedOperations.push(result);
            return result;

        } catch (error) {
            console.error(`[TASK-4-ENHANCED] Enhanced task execution failed for ${request.taskId}:`, error);
            this.activeOperations.delete(request.taskId);
            
            return this.createExecutionResult(request, startTime, false, 
                error instanceof Error ? error.message : "Unknown error");
        }
    }

    /**
     * Add complex dependency for a task
     */
    private addComplexDependencyForTask(
        request: TaskExecutionRequest,
        currentTasks: Map<string, Task>
    ): void {
        if (!request.dependencies || request.dependencies.length === 0) return;

        const task = currentTasks.get(request.taskId);
        if (!task) return;

        const complexDependency: ComplexDependency = {
            taskId: request.taskId,
            level: this.calculateTaskLevel(request.taskId, currentTasks),
            node: this.generateTaskNode(request.taskId),
            dependencies: request.dependencies.map(depId => {
                const depTask = currentTasks.get(depId);
                const depLevel = depTask ? this.calculateTaskLevel(depId, currentTasks) : 0;
                
                return {
                    taskId: depId,
                    level: depLevel,
                    type: this.determineDependencyType(request.taskId, depId, currentTasks),
                    strength: this.calculateDependencyStrength(request.taskId, depId, currentTasks),
                };
            }),
            resourceConstraints: {
                maxConcurrent: this.getMaxConcurrentForTask(request.taskId),
                timeoutMs: request.timeoutMs || 10000,
                retryAttempts: request.retryAttempts || 3,
            },
        };

        complexDependencyDeadlockDetector.addComplexDependency(complexDependency);
    }

    /**
     * Handle deadlock resolution
     */
    private async handleDeadlockResolution(
        request: TaskExecutionRequest,
        deadlockResult: ComplexDeadlockDetectionResult,
        currentTasks: Map<string, Task>
    ): Promise<{ success: boolean; error?: string }> {
        console.log(`[TASK-4] Resolving deadlock for task ${request.taskId}`);

        try {
            // Extract deadlocked task IDs
            const deadlockedTaskIds = deadlockResult.detectedCycles.flat().map(c => c.taskId);
            
            // Attempt cross-level dependency resolution
            const resolutionResults = await complexDependencyDeadlockDetector.resolveCrossLevelDependencies(
                deadlockedTaskIds,
                currentTasks
            );

            const successfulResolutions = resolutionResults.filter(r => r.success);
            const failedResolutions = resolutionResults.filter(r => !r.success);

            console.log(`[TASK-4] Cross-level resolution: ${successfulResolutions.length} successful, ${failedResolutions.length} failed`);

            // If some resolutions failed, try alternative strategies
            if (failedResolutions.length > 0) {
                await this.applyAlternativeDeadlockStrategies(
                    failedResolutions.map(r => r.taskId),
                    deadlockResult,
                    currentTasks
                );
            }

            // Cache the resolution for future reference
            this.deadlockResolutionCache.set(request.taskId, deadlockResult.deadlockType);

            return { success: true };

        } catch (error) {
            console.error(`[TASK-4] Deadlock resolution failed:`, error);
            return { 
                success: false, 
                error: error instanceof Error ? error.message : "Unknown resolution error" 
            };
        }
    }

    /**
     * Apply alternative deadlock resolution strategies
     */
    private async applyAlternativeDeadlockStrategies(
        taskIds: string[],
        deadlockResult: ComplexDeadlockDetectionResult,
        currentTasks: Map<string, Task>
    ): Promise<void> {
        console.log(`[TASK-4] Applying alternative deadlock strategies for ${taskIds.length} tasks`);

        for (const strategy of deadlockResult.resolutionStrategies) {
            switch (strategy) {
                case "victim-selection":
                    await this.selectVictimAndRollback(taskIds, currentTasks);
                    break;
                case "priority-inheritance":
                    await this.applyPriorityInheritance(taskIds, currentTasks);
                    break;
                case "resource-reallocation":
                    await this.reallocateResources(taskIds);
                    break;
                case "graceful-degradation":
                    await this.applyGracefulDegradation(taskIds);
                    break;
            }

            // Add delay between strategies
            await new Promise(resolve => setTimeout(resolve, 200));
        }
    }

    /**
     * Select victim task and rollback
     */
    private async selectVictimAndRollback(
        taskIds: string[],
        currentTasks: Map<string, Task>
    ): Promise<void> {
        // Select the task with lowest priority as victim
        let victimTaskId: string | null = null;
        let lowestPriority = 3; // high=1, medium=2, low=3

        for (const taskId of taskIds) {
            const task = currentTasks.get(taskId);
            if (task) {
                const priorityValue = task.priority === "low" ? 3 : task.priority === "medium" ? 2 : 1;
                if (priorityValue > lowestPriority) {
                    lowestPriority = priorityValue;
                    victimTaskId = taskId;
                }
            }
        }

        if (victimTaskId) {
            console.log(`[TASK-4] Selected victim task: ${victimTaskId}`);
            // Remove from active operations to break the deadlock
            this.activeOperations.delete(victimTaskId);
            
            // Add cooldown to prevent immediate re-execution
            this.rebalancingCooldown.set(victimTaskId, Date.now() + 5000);
        }
    }

    /**
     * Apply priority inheritance
     */
    private async applyPriorityInheritance(
        taskIds: string[],
        currentTasks: Map<string, Task>
    ): Promise<void> {
        for (const taskId of taskIds) {
            const task = currentTasks.get(taskId);
            if (task && task.priority === "low") {
                // Temporarily boost priority to break deadlock
                task.priority = "high";
                console.log(`[TASK-4] Applied priority inheritance for task ${taskId}`);
                
                // Schedule priority restoration after deadlock resolution
                setTimeout(() => {
                    task.priority = "low";
                    console.log(`[TASK-4] Restored priority for task ${taskId}`);
                }, 10000);
            }
        }
    }

    /**
     * Reallocate resources to relieve pressure
     */
    private async reallocateResources(taskIds: string[]): Promise<void> {
        console.log(`[TASK-4] Reallocating resources for ${taskIds.length} tasks`);
        
        // Simulate resource reallocation by temporarily reducing constraints
        for (const taskId of taskIds) {
            // This would interact with the actual resource management system
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }

    /**
     * Apply graceful degradation
     */
    private async applyGracefulDegradation(taskIds: string[]): Promise<void> {
        console.log(`[TASK-4] Applying graceful degradation for ${taskIds.length} tasks`);
        
        // Reduce resource requirements temporarily
        for (const taskId of taskIds) {
            // This would modify task requirements to be less resource-intensive
            await new Promise(resolve => setTimeout(resolve, 50));
        }
    }

    /**
     * Check if dynamic rebalancing should be performed
     */
    private shouldPerformRebalancing(
        request: TaskExecutionRequest,
        currentTasks: Map<string, Task>
    ): boolean {
        // Check if task is in cooldown
        const cooldownEnd = this.rebalancingCooldown.get(request.taskId);
        if (cooldownEnd && Date.now() < cooldownEnd) {
            return false;
        }

        // Check resource pressure
        if (this.resourceMetrics.pressureLevel === "high" || 
            this.resourceMetrics.pressureLevel === "critical") {
            return true;
        }

        // Check if task has many dependencies
        const task = currentTasks.get(request.taskId);
        if (task && task.dependencies && task.dependencies.length > 3) {
            return true;
        }

        return false;
    }

    /**
     * Perform dynamic priority rebalancing
     */
    private performDynamicPriorityRebalancing(
        taskIds: string[],
        currentTasks: Map<string, Task>
    ): Array<{ taskId: string; oldPriority: TaskPriority; newPriority: TaskPriority; reason: string }> {
        console.log(`[TASK-4] Performing dynamic priority rebalancing for ${taskIds.length} tasks`);

        const rebalancingActions = complexDependencyDeadlockDetector.performDynamicRebalancing(
            taskIds,
            currentTasks
        );

        // Add cooldown for rebalanced tasks
        for (const action of rebalancingActions) {
            this.rebalancingCooldown.set(action.taskId, Date.now() + 2000);
        }

        return rebalancingActions;
    }

    /**
     * Execute the actual task operation
     */
    private async executeTaskOperation(
        request: TaskExecutionRequest,
        currentTasks: Map<string, Task>,
        deadlockResult: ComplexDeadlockDetectionResult
    ): Promise<boolean> {
        console.log(`[TASK-4] Executing operation ${request.operation} for task ${request.taskId}`);

        try {
            switch (request.operation) {
                case "create":
                    return await this.executeCreateOperation(request, currentTasks);
                case "update":
                    return await this.executeUpdateOperation(request, currentTasks);
                case "delete":
                    return await this.executeDeleteOperation(request, currentTasks);
                case "execute":
                    return await this.executeExecuteOperation(request, currentTasks, deadlockResult);
                default:
                    return false;
            }
        } catch (error) {
            console.error(`[TASK-4] Operation execution failed:`, error);
            return false;
        }
    }

    /**
     * Execute create operation
     */
    private async executeCreateOperation(
        request: TaskExecutionRequest,
        currentTasks: Map<string, Task>
    ): Promise<boolean> {
        // Simulate task creation
        await new Promise(resolve => setTimeout(resolve, 100));
        return true;
    }

    /**
     * Execute update operation
     */
    private async executeUpdateOperation(
        request: TaskExecutionRequest,
        currentTasks: Map<string, Task>
    ): Promise<boolean> {
        // Simulate task update
        await new Promise(resolve => setTimeout(resolve, 150));
        return true;
    }

    /**
     * Execute delete operation
     */
    private async executeDeleteOperation(
        request: TaskExecutionRequest,
        currentTasks: Map<string, Task>
    ): Promise<boolean> {
        // Simulate task deletion
        await new Promise(resolve => setTimeout(resolve, 50));
        return true;
    }

    /**
     * Execute execute operation with complex dependency handling
     */
    private async executeExecuteOperation(
        request: TaskExecutionRequest,
        currentTasks: Map<string, Task>,
        deadlockResult: ComplexDeadlockDetectionResult
    ): Promise<boolean> {
        // Simulate complex task execution with dependency resolution
        const executionTime = Math.random() * 500 + 200; // 200-700ms
        await new Promise(resolve => setTimeout(resolve, executionTime));

        // Simulate potential failure based on deadlock severity
        if (deadlockResult.hasDeadlock && 
            (deadlockResult.deadlockType === "circular-dependency" || 
             deadlockResult.deadlockType === "resource-exhaustion")) {
            return Math.random() > 0.3; // 70% failure rate for critical deadlocks
        }

        return Math.random() > 0.1; // 90% success rate normally
    }

    /**
     * Create execution result
     */
    private createExecutionResult(
        request: TaskExecutionRequest,
        startTime: number,
        success: boolean,
        error?: string
    ): TaskExecutionResult {
        return {
            taskId: request.taskId,
            success,
            operation: request.operation,
            executionTime: Date.now() - startTime,
            deadlockDetected: false,
            priorityRebalanced: false,
            error,
        };
    }

    /**
     * Calculate task level based on dependencies
     */
    private calculateTaskLevel(taskId: string, currentTasks: Map<string, Task>): number {
        const task = currentTasks.get(taskId);
        if (!task || !task.dependencies) return 0;

        let maxDepLevel = 0;
        for (const depId of task.dependencies) {
            const depLevel = this.calculateTaskLevel(depId, currentTasks);
            maxDepLevel = Math.max(maxDepLevel, depLevel);
        }

        return maxDepLevel + 1;
    }

    /**
     * Generate task node identifier
     */
    private generateTaskNode(taskId: string): string {
        return `node-${taskId.slice(-8)}`;
    }

    /**
     * Determine dependency type between tasks
     */
    private determineDependencyType(
        taskId1: string,
        taskId2: string,
        currentTasks: Map<string, Task>
    ): "same-level" | "higher-level" | "lower-level" | "cross-level" {
        const level1 = this.calculateTaskLevel(taskId1, currentTasks);
        const level2 = this.calculateTaskLevel(taskId2, currentTasks);

        if (level1 === level2) return "same-level";
        if (level2 > level1) return "higher-level";
        if (level2 < level1) return "lower-level";
        return "cross-level";
    }

    /**
     * Calculate dependency strength
     */
    private calculateDependencyStrength(
        taskId1: string,
        taskId2: string,
        currentTasks: Map<string, Task>
    ): number {
        // Simple heuristic based on task priority and dependency depth
        const task1 = currentTasks.get(taskId1);
        const task2 = currentTasks.get(taskId2);

        if (!task1 || !task2) return 0.5;

        const priority1 = task1.priority === "high" ? 1.0 : task1.priority === "medium" ? 0.7 : 0.3;
        const priority2 = task2.priority === "high" ? 1.0 : task2.priority === "medium" ? 0.7 : 0.3;

        return (priority1 + priority2) / 2;
    }

    /**
     * Get maximum concurrent operations for a task
     */
    private getMaxConcurrentForTask(taskId: string): number {
        // Base on task complexity and system load
        const baseLimit = 5;
        const loadFactor = this.resourceMetrics.resourceUtilization;
        
        return Math.max(1, Math.floor(baseLimit * (1 - loadFactor)));
    }

    /**
     * Initialize resource metrics
     */
    private initializeResourceMetrics(): ResourcePressureMetrics {
        return {
            totalTasks: 0,
            activeOperations: 0,
            resourceUtilization: 0.0,
            pressureLevel: "low",
            rebalancingActive: false,
            averageExecutionTime: 0.0,
        };
    }

    /**
     * Setup resource monitoring
     */
    private setupResourceMonitoring(): void {
        setInterval(() => {
            this.updateResourceMetricsFromSystem();
        }, 2000); // Update every 2 seconds
    }

    /**
     * Setup rebalancing scheduler
     */
    private setupRebalancingScheduler(): void {
        setInterval(() => {
            if (this.resourceMetrics.pressureLevel === "high" || 
                this.resourceMetrics.pressureLevel === "critical") {
                this.performScheduledRebalancing();
            }
        }, 5000); // Check every 5 seconds
    }

    /**
     * Update resource metrics from system state
     */
    private updateResourceMetricsFromSystem(): void {
        this.resourceMetrics.totalTasks = this.completedOperations.length + this.activeOperations.size;
        this.resourceMetrics.activeOperations = this.activeOperations.size;

        // Calculate resource utilization based on active operations and system capacity
        const systemCapacity = 50; // Maximum concurrent operations
        this.resourceMetrics.resourceUtilization = this.resourceMetrics.activeOperations / systemCapacity;

        // Update pressure level
        if (this.resourceMetrics.resourceUtilization >= 0.9) {
            this.resourceMetrics.pressureLevel = "critical";
        } else if (this.resourceMetrics.resourceUtilization >= 0.7) {
            this.resourceMetrics.pressureLevel = "high";
        } else if (this.resourceMetrics.resourceUtilization >= 0.4) {
            this.resourceMetrics.pressureLevel = "medium";
        } else {
            this.resourceMetrics.pressureLevel = "low";
        }

        // Calculate average execution time
        if (this.completedOperations.length > 0) {
            const totalTime = this.completedOperations.reduce((sum, op) => sum + op.executionTime, 0);
            this.resourceMetrics.averageExecutionTime = totalTime / this.completedOperations.length;
        }
    }

    /**
     * Update resource metrics after operation completion
     */
    private updateResourceMetrics(success: boolean, executionTime: number): void {
        // Metrics will be updated in the next monitoring cycle
        // This method can be used for immediate updates if needed
    }

    /**
     * Perform scheduled rebalancing
     */
    private performScheduledRebalancing(): void {
        if (this.resourceMetrics.rebalancingActive) {
            return; // Already rebalancing
        }

        console.log(`[TASK-4] Performing scheduled rebalancing due to ${this.resourceMetrics.pressureLevel} pressure`);
        this.resourceMetrics.rebalancingActive = true;

        // Get tasks that need rebalancing
        const tasksToRebalance: string[] = [];
        for (const [taskId] of this.activeOperations) {
            if (!this.rebalancingCooldown.has(taskId)) {
                tasksToRebalance.push(taskId);
            }
        }

        if (tasksToRebalance.length > 0) {
            // This would need access to current tasks - for now, just log
            console.log(`[TASK-4] Would rebalance ${tasksToRebalance.length} tasks`);
        }

        setTimeout(() => {
            this.resourceMetrics.rebalancingActive = false;
        }, 2000);
    }

    /**
     * Get current resource metrics
     */
    public getResourceMetrics(): ResourcePressureMetrics {
        this.updateResourceMetricsFromSystem();
        return { ...this.resourceMetrics };
    }

    /**
     * Get execution statistics
     */
    public getExecutionStatistics(): {
        totalExecutions: number;
        successfulExecutions: number;
        averageExecutionTime: number;
        deadlockDetections: number;
        priorityRebalancings: number;
    } {
        const totalExecutions = this.completedOperations.length;
        const successfulExecutions = this.completedOperations.filter(op => op.success).length;
        const deadlockDetections = this.completedOperations.filter(op => op.deadlockDetected).length;
        const priorityRebalancings = this.completedOperations.filter(op => op.priorityRebalanced).length;

        const averageExecutionTime = totalExecutions > 0 
            ? this.completedOperations.reduce((sum, op) => sum + op.executionTime, 0) / totalExecutions 
            : 0;

        return {
            totalExecutions,
            successfulExecutions,
            averageExecutionTime,
            deadlockDetections,
            priorityRebalancings,
        };
    }

    /**
     * Clear all state (for testing)
     */
    public clear(): void {
        this.executionQueue = [];
        this.activeOperations.clear();
        this.completedOperations = [];
        this.rebalancingCooldown.clear();
        this.deadlockResolutionCache.clear();
        this.resourceMetrics = this.initializeResourceMetrics();
        complexDependencyDeadlockDetector.clear();
    }
}

export const task4ComplexDependencyManager = new Task4ComplexDependencyManager();