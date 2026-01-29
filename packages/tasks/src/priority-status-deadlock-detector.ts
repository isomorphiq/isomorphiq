import { z } from "zod";
import type { Task, TaskPriority, TaskStatus } from "./types.ts";

export const PriorityStatusDependencySchema = z.object({
    taskId: z.string(),
    currentPriority: z.enum(["low", "medium", "high"]),
    currentStatus: z.enum(["todo", "in-progress", "done"]),
    requiredPriority: z.enum(["low", "medium", "high"]).optional(),
    requiredStatus: z.enum(["todo", "in-progress", "done"]).optional(),
    dependencyType: z.enum(["priority-based", "status-based", "combined"]),
    strength: z.number().min(0).max(1),
    timeoutMs: z.number().default(5000),
});

export type PriorityStatusDependency = z.output<typeof PriorityStatusDependencySchema>;

export const DeadlockCycleSchema = z.object({
    cycleId: z.string(),
    tasks: z.array(z.object({
        taskId: z.string(),
        priority: z.enum(["low", "medium", "high"]),
        status: z.enum(["todo", "in-progress", "done"]),
        waitingFor: z.array(z.string()),
    })),
    cycleType: z.enum(["priority-inversion", "status-wait", "mixed-dependency"]),
    severity: z.enum(["low", "medium", "high", "critical"]),
    estimatedResolutionTime: z.number(),
});

export type DeadlockCycle = z.output<typeof DeadlockCycleSchema>;

export const DeadlockDetectionResultSchema = z.object({
    hasDeadlock: z.boolean(),
    detectedCycles: z.array(DeadlockCycleSchema),
    conflictingTasks: z.array(z.string()),
    preventionActions: z.array(z.string()),
    resolutionStrategies: z.array(z.string()),
    totalResolutionTime: z.number(),
});

export type DeadlockDetectionResult = z.output<typeof DeadlockDetectionResultSchema>;

export class PriorityStatusDeadlockDetector {
    private dependencies: Map<string, PriorityStatusDependency[]> = new Map();
    private activeOperations: Map<string, { operation: string; timestamp: number }> = new Map();
    private deadlockHistory: Array<{
        timestamp: number;
        cycleType: string;
        resolutionTime: number;
        strategy: string;
    }> = [];
    private timeoutRegistry: Map<string, NodeJS.Timeout> = new Map();

    constructor() {
        this.setupPeriodicDeadlockCheck();
    }

    /**
     * Add a priority-status dependency for deadlock detection
     */
    public addPriorityStatusDependency(dependency: PriorityStatusDependency): void {
        const existingDeps = this.dependencies.get(dependency.taskId) || [];
        existingDeps.push(dependency);
        this.dependencies.set(dependency.taskId, existingDeps);

        console.log(`[PRIORITY-STATUS] Added dependency for task ${dependency.taskId}: ${dependency.dependencyType}`);
    }

    /**
     * Register an active operation for deadlock monitoring
     */
    public registerActiveOperation(taskId: string, operation: string): void {
        this.activeOperations.set(taskId, {
            operation,
            timestamp: Date.now(),
        });

        // Set timeout for operation
        const timeout = setTimeout(() => {
            this.handleOperationTimeout(taskId);
        }, 10000); // 10 second default timeout

        this.timeoutRegistry.set(taskId, timeout);
    }

    /**
     * Unregister an active operation
     */
    public unregisterActiveOperation(taskId: string): void {
        this.activeOperations.delete(taskId);
        
        const timeout = this.timeoutRegistry.get(taskId);
        if (timeout) {
            clearTimeout(timeout);
            this.timeoutRegistry.delete(taskId);
        }
    }

    /**
     * Detect priority-status deadlocks in the current system state
     */
    public detectDeadlocks(currentTasks: Map<string, Task>): DeadlockDetectionResult {
        console.log(`[PRIORITY-STATUS] Starting deadlock detection for ${currentTasks.size} tasks`);

        const detectedCycles: DeadlockCycle[] = [];
        const conflictingTasks = new Set<string>();

        // Build dependency graph for analysis
        const dependencyGraph = this.buildDependencyGraph(currentTasks);
        
        // Detect cycles using DFS
        const visited = new Set<string>();
        const recursionStack = new Set<string>();
        const currentPath: string[] = [];

        for (const taskId of dependencyGraph.keys()) {
            if (!visited.has(taskId)) {
                this.detectCyclesDFS(
                    taskId,
                    dependencyGraph,
                    visited,
                    recursionStack,
                    currentPath,
                    detectedCycles,
                    currentTasks
                );
            }
        }

        // Collect conflicting tasks
        for (const cycle of detectedCycles) {
            for (const task of cycle.tasks) {
                conflictingTasks.add(task.taskId);
            }
        }

        const result: DeadlockDetectionResult = {
            hasDeadlock: detectedCycles.length > 0,
            detectedCycles,
            conflictingTasks: Array.from(conflictingTasks),
            preventionActions: this.generatePreventionActions(detectedCycles),
            resolutionStrategies: this.generateResolutionStrategies(detectedCycles),
            totalResolutionTime: this.calculateTotalResolutionTime(detectedCycles),
        };

        // Log detection results
        if (result.hasDeadlock) {
            console.log(`[PRIORITY-STATUS] Deadlock detected: ${detectedCycles.length} cycles, ${conflictingTasks.size} conflicting tasks`);
        } else {
            console.log(`[PRIORITY-STATUS] No deadlocks detected`);
        }

        return result;
    }

    /**
     * Resolve detected deadlocks using appropriate strategies
     */
    public async resolveDeadlocks(
        detectionResult: DeadlockDetectionResult,
        taskManager: any
    ): Promise<boolean> {
        if (!detectionResult.hasDeadlock) {
            return true;
        }

        console.log(`[PRIORITY-STATUS] Resolving ${detectionResult.detectedCycles.length} deadlock cycles`);

        let resolutionSuccess = true;

        for (const cycle of detectionResult.detectedCycles) {
            const strategy = this.selectOptimalResolutionStrategy(cycle);
            
            try {
                const success = await this.applyResolutionStrategy(
                    cycle,
                    strategy,
                    taskManager
                );

                if (!success) {
                    resolutionSuccess = false;
                    console.log(`[PRIORITY-STATUS] Failed to resolve cycle ${cycle.cycleId} with strategy ${strategy}`);
                } else {
                    console.log(`[PRIORITY-STATUS] Successfully resolved cycle ${cycle.cycleId} with strategy ${strategy}`);
                    
                    // Record resolution in history
                    this.deadlockHistory.push({
                        timestamp: Date.now(),
                        cycleType: cycle.cycleType,
                        resolutionTime: cycle.estimatedResolutionTime,
                        strategy,
                    });
                }
            } catch (error) {
                resolutionSuccess = false;
                console.log(`[PRIORITY-STATUS] Error resolving cycle ${cycle.cycleId}:`, error);
            }
        }

        return resolutionSuccess;
    }

    /**
     * Build dependency graph from current tasks and dependencies
     */
    private buildDependencyGraph(currentTasks: Map<string, Task>): Map<string, string[]> {
        const graph = new Map<string, string[]>();

        for (const [taskId, task] of currentTasks) {
            const dependencies: string[] = [];
            
            // Get priority-status dependencies for this task
            const taskDeps = this.dependencies.get(taskId) || [];
            
            for (const dep of taskDeps) {
                // Find tasks that match dependency requirements
                for (const [candidateTaskId, candidateTask] of currentTasks) {
                    if (candidateTaskId === taskId) continue;

                    let matches = false;

                    // Check priority dependency
                    if (dep.requiredPriority && candidateTask.priority === dep.requiredPriority) {
                        matches = true;
                    }

                    // Check status dependency
                    if (dep.requiredStatus && candidateTask.status === dep.requiredStatus) {
                        matches = true;
                    }

                    // Check combined dependency
                    if (dep.dependencyType === "combined" && 
                        dep.requiredPriority && dep.requiredStatus &&
                        candidateTask.priority === dep.requiredPriority &&
                        candidateTask.status === dep.requiredStatus) {
                        matches = true;
                    }

                    if (matches) {
                        dependencies.push(candidateTaskId);
                    }
                }
            }

            graph.set(taskId, dependencies);
        }

        return graph;
    }

    /**
     * Detect cycles using depth-first search
     */
    private detectCyclesDFS(
        taskId: string,
        graph: Map<string, string[]>,
        visited: Set<string>,
        recursionStack: Set<string>,
        currentPath: string[],
        detectedCycles: DeadlockCycle[],
        currentTasks: Map<string, Task>
    ): void {
        visited.add(taskId);
        recursionStack.add(taskId);
        currentPath.push(taskId);

        const dependencies = graph.get(taskId) || [];

        for (const depTaskId of dependencies) {
            if (!visited.has(depTaskId)) {
                this.detectCyclesDFS(
                    depTaskId,
                    graph,
                    visited,
                    recursionStack,
                    currentPath,
                    detectedCycles,
                    currentTasks
                );
            } else if (recursionStack.has(depTaskId)) {
                // Cycle detected
                const cycleStartIndex = currentPath.indexOf(depTaskId);
                const cycleTaskIds = currentPath.slice(cycleStartIndex);
                
                const cycle: DeadlockCycle = {
                    cycleId: `cycle-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                    tasks: cycleTaskIds.map(id => {
                        const task = currentTasks.get(id);
                        return {
                            taskId: id,
                            priority: task?.priority || "medium",
                            status: task?.status === "invalid" ? "todo" : (task?.status || "todo"),
                            waitingFor: graph.get(id) || [],
                        };
                    }),
                    cycleType: this.determineCycleType(cycleTaskIds, currentTasks),
                    severity: this.determineCycleSeverity(cycleTaskIds, currentTasks),
                    estimatedResolutionTime: this.estimateResolutionTime(cycleTaskIds, currentTasks),
                };

                detectedCycles.push(cycle);
            }
        }

        recursionStack.delete(taskId);
        currentPath.pop();
    }

    /**
     * Determine the type of deadlock cycle
     */
    private determineCycleType(cycleTaskIds: string[], currentTasks: Map<string, Task>): DeadlockCycle["cycleType"] {
        let priorityCount = 0;
        let statusCount = 0;

        for (const taskId of cycleTaskIds) {
            const task = currentTasks.get(taskId);
            if (!task) continue;

            const deps = this.dependencies.get(taskId) || [];
            for (const dep of deps) {
                if (dep.requiredPriority) priorityCount++;
                if (dep.requiredStatus) statusCount++;
            }
        }

        if (priorityCount > statusCount * 2) return "priority-inversion";
        if (statusCount > priorityCount * 2) return "status-wait";
        return "mixed-dependency";
    }

    /**
     * Determine the severity of a deadlock cycle
     */
    private determineCycleSeverity(cycleTaskIds: string[], currentTasks: Map<string, Task>): DeadlockCycle["severity"] {
        let highPriorityCount = 0;
        let inProgressCount = 0;

        for (const taskId of cycleTaskIds) {
            const task = currentTasks.get(taskId);
            if (!task) continue;

            if (task.priority === "high") highPriorityCount++;
            if (task.status === "in-progress") inProgressCount++;
        }

        const totalTasks = cycleTaskIds.length;
        const highPriorityRatio = highPriorityCount / totalTasks;
        const inProgressRatio = inProgressCount / totalTasks;

        if (highPriorityRatio > 0.7 || inProgressRatio > 0.8) return "critical";
        if (highPriorityRatio > 0.4 || inProgressRatio > 0.5) return "high";
        if (highPriorityRatio > 0.2 || inProgressRatio > 0.3) return "medium";
        return "low";
    }

    /**
     * Estimate resolution time for a cycle
     */
    private estimateResolutionTime(cycleTaskIds: string[], currentTasks: Map<string, Task>): number {
        const baseTime = 1000; // 1 second base
        const cycleLength = cycleTaskIds.length;
        const complexityMultiplier = Math.pow(1.5, cycleLength - 1);

        // Add time based on task priorities
        let priorityFactor = 1;
        for (const taskId of cycleTaskIds) {
            const task = currentTasks.get(taskId);
            if (!task) continue;

            if (task.priority === "high") priorityFactor += 0.5;
            else if (task.priority === "medium") priorityFactor += 0.25;
        }

        return Math.floor(baseTime * complexityMultiplier * priorityFactor);
    }

    /**
     * Generate prevention actions for detected deadlocks
     */
    private generatePreventionActions(cycles: DeadlockCycle[]): string[] {
        const actions: string[] = [];

        if (cycles.length === 0) return actions;

        actions.push("enable-timeout-based-detection");
        actions.push("activate-priority-inversion-prevention");

        for (const cycle of cycles) {
            switch (cycle.cycleType) {
                case "priority-inversion":
                    actions.push("priority-inheritance-mechanism");
                    actions.push("priority-ceiling-protocol");
                    break;
                case "status-wait":
                    actions.push("status-timeout-handling");
                    actions.push("async-status-transitions");
                    break;
                case "mixed-dependency":
                    actions.push("dependency-ordering-enforcement");
                    actions.push("resource-hierarchy-protocol");
                    break;
            }

            if (cycle.severity === "critical") {
                actions.push("emergency-deadlock-resolution");
                actions.push("task-abort-protocol");
            }
        }

        return [...new Set(actions)]; // Remove duplicates
    }

    /**
     * Generate resolution strategies for detected deadlocks
     */
    private generateResolutionStrategies(cycles: DeadlockCycle[]): string[] {
        const strategies: string[] = [];

        if (cycles.length === 0) return strategies;

        strategies.push("timeout-based-recovery");
        strategies.push("priority-boost-resolution");

        for (const cycle of cycles) {
            switch (cycle.cycleType) {
                case "priority-inversion":
                    strategies.push("priority-inheritance");
                    strategies.push("priority-donation");
                    break;
                case "status-wait":
                    strategies.push("status-force-transition");
                    strategies.push("conditional-dependency-release");
                    break;
                case "mixed-dependency":
                    strategies.push("dependency-breaking");
                    strategies.push("circular-wait-elimination");
                    break;
            }

            if (cycle.severity === "high" || cycle.severity === "critical") {
                strategies.push("task-rollback");
                strategies.push("resource-preemption");
            }
        }

        return [...new Set(strategies)]; // Remove duplicates
    }

    /**
     * Calculate total resolution time for all detected cycles
     */
    private calculateTotalResolutionTime(cycles: DeadlockCycle[]): number {
        return cycles.reduce((total, cycle) => total + cycle.estimatedResolutionTime, 0);
    }

    /**
     * Select optimal resolution strategy for a cycle
     */
    private selectOptimalResolutionStrategy(cycle: DeadlockCycle): string {
        const strategies = this.generateResolutionStrategies([cycle]);

        // Prioritize strategies based on cycle type and severity
        if (cycle.severity === "critical") {
            return "task-rollback";
        }

        if (cycle.cycleType === "priority-inversion") {
            return "priority-inheritance";
        }

        if (cycle.cycleType === "status-wait") {
            return "status-force-transition";
        }

        return "timeout-based-recovery";
    }

    /**
     * Apply resolution strategy to a deadlock cycle
     */
    private async applyResolutionStrategy(
        cycle: DeadlockCycle,
        strategy: string,
        taskManager: any
    ): Promise<boolean> {
        console.log(`[PRIORITY-STATUS] Applying strategy '${strategy}' to cycle ${cycle.cycleId}`);

        try {
            switch (strategy) {
                case "priority-inheritance":
                    return await this.applyPriorityInheritance(cycle, taskManager);
                
                case "priority-donation":
                    return await this.applyPriorityDonation(cycle, taskManager);
                
                case "status-force-transition":
                    return await this.applyStatusForceTransition(cycle, taskManager);
                
                case "timeout-based-recovery":
                    return await this.applyTimeoutBasedRecovery(cycle, taskManager);
                
                case "task-rollback":
                    return await this.applyTaskRollback(cycle, taskManager);
                
                case "dependency-breaking":
                    return await this.applyDependencyBreaking(cycle, taskManager);
                
                default:
                    console.log(`[PRIORITY-STATUS] Unknown strategy: ${strategy}`);
                    return false;
            }
        } catch (error) {
            console.log(`[PRIORITY-STATUS] Error applying strategy ${strategy}:`, error);
            return false;
        }
    }

    /**
     * Apply priority inheritance resolution strategy
     */
    private async applyPriorityInheritance(cycle: DeadlockCycle, taskManager: any): Promise<boolean> {
        // Find the highest priority task in the cycle
        const highestPriorityTask = cycle.tasks.reduce((highest, task) => {
            const priorityOrder = { high: 3, medium: 2, low: 1 };
            const taskPriority = priorityOrder[task.priority];
            const highestPriority = priorityOrder[highest.priority];
            
            return taskPriority > highestPriority ? task : highest;
        });

        // Boost all tasks in the cycle to the highest priority
        for (const task of cycle.tasks) {
            if (task.priority !== highestPriorityTask.priority) {
                try {
                    await taskManager.updateTaskPriority(task.taskId, highestPriorityTask.priority);
                    console.log(`[PRIORITY-STATUS] Boosted task ${task.taskId} to priority ${highestPriorityTask.priority}`);
                } catch (error) {
                    console.log(`[PRIORITY-STATUS] Failed to boost priority for task ${task.taskId}:`, error);
                    return false;
                }
            }
        }

        return true;
    }

    /**
     * Apply priority donation resolution strategy
     */
    private async applyPriorityDonation(cycle: DeadlockCycle, taskManager: any): Promise<boolean> {
        // Find tasks that can donate priority (high priority tasks not in deadlock)
        const donationCandidates = cycle.tasks.filter(task => task.priority === "high");
        
        if (donationCandidates.length === 0) {
            // No high priority tasks to donate, use inheritance instead
            return await this.applyPriorityInheritance(cycle, taskManager);
        }

        // Donate priority from high priority tasks to lower priority ones
        for (const task of cycle.tasks) {
            if (task.priority !== "high") {
                try {
                    await taskManager.updateTaskPriority(task.taskId, "high");
                    console.log(`[PRIORITY-STATUS] Donated high priority to task ${task.taskId}`);
                } catch (error) {
                    console.log(`[PRIORITY-STATUS] Failed to donate priority to task ${task.taskId}:`, error);
                    return false;
                }
            }
        }

        return true;
    }

    /**
     * Apply status force transition resolution strategy
     */
    private async applyStatusForceTransition(cycle: DeadlockCycle, taskManager: any): Promise<boolean> {
        // Force status transitions to break the deadlock
        for (const task of cycle.tasks) {
            if (task.status === "in-progress") {
                try {
                    // Force completion to break the wait
                    await taskManager.updateTaskStatus(task.taskId, "done");
                    console.log(`[PRIORITY-STATUS] Forced task ${task.taskId} to done status`);
                } catch (error) {
                    console.log(`[PRIORITY-STATUS] Failed to force status for task ${task.taskId}:`, error);
                    return false;
                }
            }
        }

        return true;
    }

    /**
     * Apply timeout-based recovery resolution strategy
     */
    private async applyTimeoutBasedRecovery(cycle: DeadlockCycle, taskManager: any): Promise<boolean> {
        // Wait for timeout, then force resolution
        const timeoutMs = Math.min(cycle.estimatedResolutionTime, 5000); // Cap at 5 seconds
        
        await new Promise(resolve => setTimeout(resolve, timeoutMs));
        
        // After timeout, try to force status transitions
        return await this.applyStatusForceTransition(cycle, taskManager);
    }

    /**
     * Apply task rollback resolution strategy
     */
    private async applyTaskRollback(cycle: DeadlockCycle, taskManager: any): Promise<boolean> {
        // Rollback all tasks in the cycle to todo status
        for (const task of cycle.tasks) {
            try {
                await taskManager.updateTaskStatus(task.taskId, "todo");
                console.log(`[PRIORITY-STATUS] Rolled back task ${task.taskId} to todo status`);
            } catch (error) {
                console.log(`[PRIORITY-STATUS] Failed to rollback task ${task.taskId}:`, error);
                return false;
            }
        }

        return true;
    }

    /**
     * Apply dependency breaking resolution strategy
     */
    private async applyDependencyBreaking(cycle: DeadlockCycle, taskManager: any): Promise<boolean> {
        // Remove dependencies for tasks in the cycle
        for (const task of cycle.tasks) {
            this.dependencies.delete(task.taskId);
            console.log(`[PRIORITY-STATUS] Broke dependencies for task ${task.taskId}`);
        }

        return true;
    }

    /**
     * Handle operation timeout
     */
    private handleOperationTimeout(taskId: string): void {
        console.log(`[PRIORITY-STATUS] Operation timeout for task ${taskId}`);
        
        // Remove from active operations
        this.unregisterActiveOperation(taskId);
        
        // Trigger deadlock detection
        this.triggerDeadlockDetection();
    }

    /**
     * Setup periodic deadlock checking
     */
    private setupPeriodicDeadlockCheck(): void {
        setInterval(() => {
            if (this.activeOperations.size > 0) {
                this.triggerDeadlockDetection();
            }
        }, 5000); // Check every 5 seconds
    }

    /**
     * Trigger deadlock detection
     */
    private triggerDeadlockDetection(): void {
        // This would be called by the task manager to check for deadlocks
        console.log(`[PRIORITY-STATUS] Triggering deadlock detection check`);
    }

    /**
     * Get deadlock detection statistics
     */
    public getDeadlockStatistics(): {
        totalDetections: number;
        averageResolutionTime: number;
        mostCommonCycleType: string;
        activeOperations: number;
    } {
        const totalDetections = this.deadlockHistory.length;
        const averageResolutionTime = totalDetections > 0 
            ? this.deadlockHistory.reduce((sum, entry) => sum + entry.resolutionTime, 0) / totalDetections
            : 0;

        const cycleTypeCounts = new Map<string, number>();
        for (const entry of this.deadlockHistory) {
            const count = cycleTypeCounts.get(entry.cycleType) || 0;
            cycleTypeCounts.set(entry.cycleType, count + 1);
        }

        const mostCommonCycleType = cycleTypeCounts.size > 0
            ? Array.from(cycleTypeCounts.entries()).reduce((a, b) => a[1] > b[1] ? a : b)[0]
            : "none";

        return {
            totalDetections,
            averageResolutionTime,
            mostCommonCycleType,
            activeOperations: this.activeOperations.size,
        };
    }
}

// Export singleton instance
export const priorityStatusDeadlockDetector = new PriorityStatusDeadlockDetector();