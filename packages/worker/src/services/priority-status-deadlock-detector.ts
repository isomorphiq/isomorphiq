import type { Task } from "@isomorphiq/dashboard";
import { DeadlockDetector } from "./cas-deadlock-detector.ts";

export interface PriorityStatusDependency {
    taskId: string;
    dependsOnTaskId: string;
    dependencyType: "priority_depends_on_status" | "status_depends_on_priority";
    level: number; // 0 for direct dependencies, higher for indirect
    condition: (task: Task, dependentTask: Task) => boolean;
}

export interface PriorityStatusDeadlockResult {
    isDeadlock: boolean;
    dependencyCycle: PriorityStatusDependency[];
    victimOperations: string[];
    resolutionStrategy: "priority_boost" | "status_override" | "operation_rollback" | "dependency_break";
    severity: "low" | "medium" | "high" | "critical";
}

export interface DependencyGraph {
    nodes: Map<string, Task>;
    edges: Map<string, PriorityStatusDependency[]>;
    levels: Map<string, number>;
}

/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class PriorityStatusDeadlockDetector extends DeadlockDetector {
    private dependencyGraph: DependencyGraph;
    private levelZeroDependencies: Map<string, PriorityStatusDependency[]> = new Map();
    private maxDependencyLevel: number = 3;

    constructor(defaultTimeout: number = 5000, maxDependencyLevel: number = 3) {
        super(defaultTimeout);
        this.maxDependencyLevel = maxDependencyLevel;
        this.dependencyGraph = {
            nodes: new Map(),
            edges: new Map(),
            levels: new Map()
        };
    }

    addPriorityStatusDependency(dependency: PriorityStatusDependency): void {
        // Only add if level is within bounds
        if (dependency.level > this.maxDependencyLevel) {
            return;
        }

        // Track level-0 dependencies specifically
        if (dependency.level === 0) {
            if (!this.levelZeroDependencies.has(dependency.taskId)) {
                this.levelZeroDependencies.set(dependency.taskId, []);
            }
            this.levelZeroDependencies.get(dependency.taskId)!.push(dependency);
        }

        // Add to dependency graph
        if (!this.dependencyGraph.edges.has(dependency.taskId)) {
            this.dependencyGraph.edges.set(dependency.taskId, []);
        }
        this.dependencyGraph.edges.get(dependency.taskId)!.push(dependency);

        // Update levels
        this.dependencyGraph.levels.set(dependency.taskId, dependency.level);
        this.dependencyGraph.levels.set(dependency.dependsOnTaskId, 0); // Base level
    }

    detectPriorityStatusDeadlock(): PriorityStatusDeadlockResult {
        // First check standard deadlock
        const standardDeadlock = super.detectDeadlock();
        if (standardDeadlock.isDeadlock) {
            return {
                isDeadlock: true,
                dependencyCycle: [],
                victimOperations: [standardDeadlock.victimOperation || ""],
                resolutionStrategy: "operation_rollback",
                severity: "high"
            };
        }

        // Check for priority-status dependency cycles
        const cycles = this.detectDependencyCycles();
        if (cycles.length > 0) {
            return {
                isDeadlock: true,
                dependencyCycle: cycles[0],
                victimOperations: this.selectVictimsForDependencyCycle(cycles[0]),
                resolutionStrategy: this.selectResolutionStrategy(cycles[0]),
                severity: this.calculateSeverity(cycles[0])
            };
        }

        // Check level-0 dependency conflicts specifically
        const levelZeroConflict = this.detectLevelZeroConflict();
        if (levelZeroConflict) {
            return levelZeroConflict;
        }

        // Check for complex dependency patterns
        const complexConflict = this.detectComplexDependencyPatterns();
        if (complexConflict) {
            return complexConflict;
        }

        return {
            isDeadlock: false,
            dependencyCycle: [],
            victimOperations: [],
            resolutionStrategy: "dependency_break",
            severity: "low"
        };
    }

    private detectDependencyCycles(): PriorityStatusDependency[][] {
        const visited = new Set<string>();
        const recursionStack = new Set<string>();
        const cycles: PriorityStatusDependency[][] = [];
        const path: PriorityStatusDependency[] = [];

        const dfs = (taskId: string, currentPath: PriorityStatusDependency[] = []): boolean => {
            if (recursionStack.has(taskId)) {
                // Found cycle - extract complete cycle from path
                const cycleStart = currentPath.findIndex(dep => dep.dependsOnTaskId === taskId);
                if (cycleStart !== -1) {
                    cycles.push(currentPath.slice(cycleStart));
                }
                return true;
            }

            if (visited.has(taskId)) {
                return false;
            }

            visited.add(taskId);
            recursionStack.add(taskId);

            const dependencies = this.dependencyGraph.edges.get(taskId) || [];
            for (const dep of dependencies) {
                const newPath = [...currentPath, dep];
                dfs(dep.dependsOnTaskId, newPath); // Don't return early, collect all cycles
            }

            recursionStack.delete(taskId);
            return false;
        };

        for (const taskId of this.dependencyGraph.edges.keys()) {
            if (!visited.has(taskId)) {
                dfs(taskId);
            }
        }

        return cycles;
    }

    private detectLevelZeroConflict(): PriorityStatusDeadlockResult | null {
        for (const [taskId, dependencies] of this.levelZeroDependencies.entries()) {
            // Check for conflicting level-0 dependencies
            const priorityDeps = dependencies.filter(d => d.dependencyType === "priority_depends_on_status");
            const statusDeps = dependencies.filter(d => d.dependencyType === "status_depends_on_priority");

            // If a task has both types of level-0 dependencies, it's a potential deadlock
            if (priorityDeps.length > 0 && statusDeps.length > 0) {
                const conflictCycle: PriorityStatusDependency[] = [...priorityDeps, ...statusDeps];
                
                return {
                    isDeadlock: true,
                    dependencyCycle: conflictCycle,
                    victimOperations: [taskId],
                    resolutionStrategy: "priority_boost", // Priority gets precedence in level-0 conflicts
                    severity: "critical"
                };
            }
        }

        return null;
    }

    private detectComplexDependencyPatterns(): PriorityStatusDeadlockResult | null {
        // Detect inverted priority-status dependencies
        for (const [taskId, dependencies] of this.dependencyGraph.edges.entries()) {
            const priorityDeps = dependencies.filter(d => d.dependencyType === "priority_depends_on_status");
            const statusDeps = dependencies.filter(d => d.dependencyType === "status_depends_on_priority");

            // Check for inverted dependencies (task A's priority depends on B's status, but B's status depends on A's priority)
            for (const priorityDep of priorityDeps) {
                const targetStatusDeps = this.dependencyGraph.edges.get(priorityDep.dependsOnTaskId) || [];
                const matchingStatusDep = targetStatusDeps.find(d => 
                    d.dependencyType === "status_depends_on_priority" && 
                    d.dependsOnTaskId === taskId
                );

                if (matchingStatusDep) {
                    const conflictCycle = [priorityDep, matchingStatusDep];
                    return {
                        isDeadlock: true,
                        dependencyCycle: conflictCycle,
                        victimOperations: [matchingStatusDep.taskId], // Target the status dependency
                        resolutionStrategy: "priority_boost",
                        severity: "critical"
                    };
                }
            }
        }

        // Check for cascading dependency chains
        const cascadingConflict = this.detectCascadingDependencies();
        if (cascadingConflict) {
            return cascadingConflict;
        }

        return null;
    }

    private detectCascadingDependencies(): PriorityStatusDeadlockResult | null {
        // Detect chains where priority depends on status depends on priority depends on status...
        for (const [taskId, dependencies] of this.dependencyGraph.edges.entries()) {
            const chain = this.traceDependencyChain(taskId, new Set<string>());
            if (chain.length >= 4 && this.isAlternatingChain(chain)) {
                return {
                    isDeadlock: true,
                    dependencyCycle: chain,
                    victimOperations: [chain[Math.floor(chain.length / 2)].taskId],
                    resolutionStrategy: "dependency_break",
                    severity: "high"
                };
            }
        }
        return null;
    }

    private traceDependencyChain(taskId: string, visited: Set<string>): PriorityStatusDependency[] {
        if (visited.has(taskId)) {
            return [];
        }

        visited.add(taskId);
        const dependencies = this.dependencyGraph.edges.get(taskId) || [];
        const chain: PriorityStatusDependency[] = [];

        for (const dep of dependencies) {
            chain.push(dep);
            const subChain = this.traceDependencyChain(dep.dependsOnTaskId, new Set(visited));
            chain.push(...subChain);
            if (chain.length >= 6) break; // Limit chain length for performance
        }

        return chain;
    }

    private isAlternatingChain(chain: PriorityStatusDependency[]): boolean {
        if (chain.length < 4) return false;
        
        for (let i = 1; i < chain.length; i++) {
            if (chain[i].dependencyType === chain[i-1].dependencyType) {
                return false;
            }
        }
        return true;
    }

    private selectVictimsForDependencyCycle(cycle: PriorityStatusDependency[]): string[] {
        // Select victims based on dependency level and type
        const victims: string[] = [];
        
        // Prioritize removing status_depends_on_priority dependencies
        const statusDeps = cycle.filter(d => d.dependencyType === "status_depends_on_priority");
        const priorityDeps = cycle.filter(d => d.dependencyType === "priority_depends_on_status");

        // Add status dependencies first (they're less critical)
        victims.push(...statusDeps.map(d => d.taskId));
        
        // Then add priority dependencies if needed
        if (victims.length === 0) {
            victims.push(...priorityDeps.slice(0, 1).map(d => d.taskId));
        }

        return [...new Set(victims)]; // Remove duplicates
    }

    private selectResolutionStrategy(cycle: PriorityStatusDependency[]): PriorityStatusDeadlockResult["resolutionStrategy"] {
        const hasPriorityDep = cycle.some(d => d.dependencyType === "priority_depends_on_status");
        const hasStatusDep = cycle.some(d => d.dependencyType === "status_depends_on_priority");
        const maxLevel = Math.max(...cycle.map(d => d.level));

        // Critical severity for level-0 cycles
        if (maxLevel === 0) {
            return hasPriorityDep ? "priority_boost" : "status_override";
        }

        // Medium severity for mixed dependency types
        if (hasPriorityDep && hasStatusDep) {
            return "dependency_break";
        }

        // Use operation rollback for higher-level cycles
        return "operation_rollback";
    }

    private calculateSeverity(cycle: PriorityStatusDependency[]): PriorityStatusDeadlockResult["severity"] {
        const maxLevel = Math.max(...cycle.map(d => d.level));
        const cycleLength = cycle.length;

        if (maxLevel === 0) return "critical";
        if (maxLevel === 1 && cycleLength <= 2) return "medium";
        if (cycleLength > 3) return "high";
        return "low";
    }

    async resolvePriorityStatusDeadlock(result: PriorityStatusDeadlockResult): Promise<void> {
        if (!result.isDeadlock) {
            return;
        }

        console.log(`[PRIORITY-STATUS] Resolving deadlock with strategy: ${result.resolutionStrategy}, cycle length: ${result.dependencyCycle.length}`);

        switch (result.resolutionStrategy) {
            case "priority_boost":
                await this.resolveWithPriorityBoost(result);
                break;
            case "status_override":
                await this.resolveWithStatusOverride(result);
                break;
            case "operation_rollback":
                await this.resolveWithOperationRollback(result);
                break;
            case "dependency_break":
                await this.resolveWithDependencyBreak(result);
                break;
        }

        console.log(`[PRIORITY-STATUS] Resolution completed. Remaining dependencies: ${Array.from(this.dependencyGraph.edges.values()).flat().length}`);
    }

    private async resolveWithPriorityBoost(result: PriorityStatusDeadlockResult): Promise<void> {
        // Boost priority of tasks to break dependency cycles
        for (const dependency of result.dependencyCycle) {
            // Remove status_depends_on_priority dependencies by automatically setting high priority
            if (dependency.dependencyType === "status_depends_on_priority") {
                this.removeDependency(dependency);
                console.log(`[PRIORITY-STATUS] Resolved deadlock by priority boost: ${dependency.taskId}`);
            } else {
                // Also remove priority_depends_on_status dependencies for completeness
                this.removeDependency(dependency);
                console.log(`[PRIORITY-STATUS] Removed dependency during priority boost: ${dependency.taskId} -> ${dependency.dependsOnTaskId}`);
            }
        }
        
        // Apply cascading priority adjustments for complex scenarios
        if (result.severity === "critical" && result.dependencyCycle.length > 2) {
            await this.applyCascadingPriorityAdjustment(result.dependencyCycle);
        }
    }

    private async resolveWithStatusOverride(result: PriorityStatusDeadlockResult): Promise<void> {
        // Override status requirements to break cycles
        for (const dependency of result.dependencyCycle) {
            // Remove both types of dependencies to break the cycle
            this.removeDependency(dependency);
            console.log(`[PRIORITY-STATUS] Resolved deadlock by status override: ${dependency.taskId} -> ${dependency.dependsOnTaskId}`);
        }
    }

    private async resolveWithOperationRollback(result: PriorityStatusDeadlockResult): Promise<void> {
        // Rollback operations for victim tasks by removing their dependencies
        for (const taskId of result.victimOperations) {
            this.removeAllDependenciesForTask(taskId);
            console.log(`[PRIORITY-STATUS] Resolved deadlock by operation rollback: ${taskId}`);
        }
    }

    private async resolveWithDependencyBreak(result: PriorityStatusDeadlockResult): Promise<void> {
        // Break the dependency cycle by removing the weakest link
        const cycle = result.dependencyCycle;
        const weakestLink = this.selectWeakestLink(cycle);
        if (weakestLink) {
            this.removeDependency(weakestLink);
            console.log(`[PRIORITY-STATUS] Resolved deadlock by breaking dependency: ${weakestLink.taskId} -> ${weakestLink.dependsOnTaskId}`);
        }
    }

    private selectWeakestLink(cycle: PriorityStatusDependency[]): PriorityStatusDependency | null {
        // Select the dependency with the highest level (weakest)
        return cycle.reduce((weakest, current) => 
            current.level > (weakest?.level || -1) ? current : weakest, 
            null as PriorityStatusDependency | null
        );
    }

    private async applyCascadingPriorityAdjustment(cycle: PriorityStatusDependency[]): Promise<void> {
        // Apply priority adjustments in reverse order of dependency strength
        const sortedDeps = cycle.sort((a, b) => b.level - a.level);
        
        for (const dep of sortedDeps) {
            if (dep.dependencyType === "status_depends_on_priority") {
                // Create a priority override dependency
                const overrideDep: PriorityStatusDependency = {
                    taskId: dep.taskId,
                    dependsOnTaskId: "system-high-priority",
                    dependencyType: "status_depends_on_priority",
                    level: 0,
                    condition: () => true // Always satisfied
                };
                
                // Remove the problematic dependency and add the override
                this.removeDependency(dep);
                this.addPriorityStatusDependency(overrideDep);
                
                console.log(`[PRIORITY-STATUS] Applied cascading priority adjustment for: ${dep.taskId}`);
            }
        }
    }

    private removeDependency(dependency: PriorityStatusDependency): void {
        // Remove from level-0 dependencies
        const levelZeroDeps = this.levelZeroDependencies.get(dependency.taskId);
        if (levelZeroDeps) {
            const filtered = levelZeroDeps.filter(d => 
                d.dependsOnTaskId !== dependency.dependsOnTaskId || 
                d.dependencyType !== dependency.dependencyType
            );
            if (filtered.length === 0) {
                this.levelZeroDependencies.delete(dependency.taskId);
            } else {
                this.levelZeroDependencies.set(dependency.taskId, filtered);
            }
        }

        // Remove from main dependency graph
        const edges = this.dependencyGraph.edges.get(dependency.taskId);
        if (edges) {
            const filtered = edges.filter(d => 
                d.dependsOnTaskId !== dependency.dependsOnTaskId || 
                d.dependencyType !== dependency.dependencyType
            );
            if (filtered.length === 0) {
                this.dependencyGraph.edges.delete(dependency.taskId);
            } else {
                this.dependencyGraph.edges.set(dependency.taskId, filtered);
            }
        }
    }

    private removeAllDependenciesForTask(taskId: string): void {
        console.log(`[PRIORITY-STATUS] Removing all dependencies for task: ${taskId}`);
        let removedCount = 0;
        
        // Remove all dependencies for this task
        const deps = this.dependencyGraph.edges.get(taskId);
        if (deps) {
            removedCount += deps.length;
        }
        this.levelZeroDependencies.delete(taskId);
        this.dependencyGraph.edges.delete(taskId);
        
        // Also remove any dependencies that point to this task
        for (const [sourceTaskId, deps] of this.dependencyGraph.edges.entries()) {
            const filtered = deps.filter(d => d.dependsOnTaskId !== taskId);
            if (filtered.length !== deps.length) {
                removedCount += (deps.length - filtered.length);
                console.log(`[PRIORITY-STATUS] Removing ${deps.length - filtered.length} dependencies from ${sourceTaskId} pointing to ${taskId}`);
                if (filtered.length === 0) {
                    this.dependencyGraph.edges.delete(sourceTaskId);
                } else {
                    this.dependencyGraph.edges.set(sourceTaskId, filtered);
                }
            }
        }
        
        console.log(`[PRIORITY-STATUS] Total dependencies removed for ${taskId}: ${removedCount}`);
    }

    getPriorityStatusStats() {
        return {
            ...super.getStats(),
            levelZeroDependencies: this.levelZeroDependencies.size,
            totalDependencies: Array.from(this.dependencyGraph.edges.values()).flat().length,
            maxDependencyLevel: this.maxDependencyLevel,
            dependencyGraphNodes: this.dependencyGraph.nodes.size
        };
    }

    cleanup(): void {
        super.cleanup();
        this.dependencyGraph.nodes.clear();
        this.dependencyGraph.edges.clear();
        this.dependencyGraph.levels.clear();
        this.levelZeroDependencies.clear();
    }
}
