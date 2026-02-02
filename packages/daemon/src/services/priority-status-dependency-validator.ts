import type { Task } from "@isomorphiq/dashboard";
import type { PriorityStatusDependency } from "./priority-status-deadlock-detector.ts";

export interface ValidationResult {
    isValid: boolean;
    warnings: string[];
    errors: string[];
    suggestedFixes: string[];
}

export interface DependencyAnalysis {
    dependencyCount: number;
    maxDepth: number;
    circularDependencies: string[][];
    criticalPaths: string[][];
    bottlenecks: string[];
}

/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class PriorityStatusDependencyValidator {
    private dependencies: Map<string, PriorityStatusDependency[]> = new Map();
    private taskCache: Map<string, Task> = new Map();

    constructor() {
        this.dependencies = new Map();
        this.taskCache = new Map();
    }

    addDependency(dependency: PriorityStatusDependency): void {
        if (!this.dependencies.has(dependency.taskId)) {
            this.dependencies.set(dependency.taskId, []);
        }
        this.dependencies.get(dependency.taskId)!.push(dependency);
    }

    updateTask(task: Task): void {
        this.taskCache.set(task.id, task);
    }

    validateDependency(dependency: PriorityStatusDependency): ValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];
        const suggestedFixes: string[] = [];

        // Check if tasks exist
        const task = this.taskCache.get(dependency.taskId);
        const dependentTask = this.taskCache.get(dependency.dependsOnTaskId);

        if (!task) {
            errors.push(`Task ${dependency.taskId} not found`);
        }

        if (!dependentTask) {
            errors.push(`Dependent task ${dependency.dependsOnTaskId} not found`);
        }

        // Validate condition function
        if (task && dependentTask) {
            try {
                const conditionMet = dependency.condition(task, dependentTask);
                if (!conditionMet && dependency.level === 0) {
                    warnings.push(`Level-0 dependency condition not met for ${dependency.taskId}`);
                    suggestedFixes.push(`Consider adjusting the condition or raising the dependency level`);
                }
            } catch (error) {
                errors.push(`Condition function failed for dependency ${dependency.taskId} -> ${dependency.dependsOnTaskId}: ${error}`);
            }
        }

        // Check for potential circular dependencies
        const circularCheck = this.checkForCircularDependency(dependency);
        if (circularCheck.isCircular) {
            errors.push(`Circular dependency detected: ${circularCheck.cycle.join(" -> ")}`);
            suggestedFixes.push(`Break the cycle by removing one dependency or using a different approach`);
        }

        // Validate dependency level
        if (dependency.level < 0) {
            errors.push("Dependency level cannot be negative");
        } else if (dependency.level > 5) {
            warnings.push(`High dependency level (${dependency.level}) may cause performance issues`);
            suggestedFixes.push("Consider restructuring dependencies to reduce depth");
        }

        return {
            isValid: errors.length === 0,
            warnings,
            errors,
            suggestedFixes
        };
    }

    validateAllDependencies(): ValidationResult {
        const allErrors: string[] = [];
        const allWarnings: string[] = [];
        const allFixes: string[] = [];

        for (const [taskId, deps] of this.dependencies.entries()) {
            for (const dep of deps) {
                const result = this.validateDependency(dep);
                allErrors.push(...result.errors);
                allWarnings.push(...result.warnings);
                allFixes.push(...result.suggestedFixes);
            }
        }

        return {
            isValid: allErrors.length === 0,
            warnings: allWarnings,
            errors: allErrors,
            suggestedFixes: allFixes
        };
    }

    analyzeDependencies(): DependencyAnalysis {
        const visited = new Set<string>();
        const depths: Map<string, number> = new Map();
        const circularDependencies: string[][] = [];
        const criticalPaths: string[][] = [];
        const bottlenecks: string[] = [];

        let maxDepth = 0;
        let totalDependencies = 0;

        // Calculate depths and detect circular dependencies
        for (const id of this.dependencies.keys()) {
            if (!visited.has(id)) {
                const depth = this.calculateDepth(id, visited, depths, new Set<string>(), []);
                maxDepth = Math.max(maxDepth, depth);
            }
        }

        // Count total dependencies
        for (const deps of this.dependencies.values()) {
            totalDependencies += deps.length;
        }

        // Identify bottlenecks (tasks that many others depend on)
        const dependencyCount: Map<string, number> = new Map();
        for (const deps of this.dependencies.values()) {
            for (const dep of deps) {
                dependencyCount.set(dep.dependsOnTaskId, (dependencyCount.get(dep.dependsOnTaskId) || 0) + 1);
            }
        }

        // Find top bottlenecks (more than 3 dependencies)
        for (const [taskId, count] of dependencyCount.entries()) {
            if (count > 3) {
                bottlenecks.push(`${taskId} (${count} dependents)`);
            }
        }

        return {
            dependencyCount: totalDependencies,
            maxDepth,
            circularDependencies,
            criticalPaths,
            bottlenecks
        };
    }

    private calculateDepth(
        taskId: string, 
        visited: Set<string>, 
        depths: Map<string, number>,
        currentPath: Set<string>,
        path: string[]
    ): number {
        if (currentPath.has(taskId)) {
            // Circular dependency detected
            const cycleStart = path.indexOf(taskId);
            const cycle = path.slice(cycleStart).concat([taskId]);
            console.warn(`Circular dependency detected: ${cycle.join(" -> ")}`);
            return 0;
        }

        if (visited.has(taskId)) {
            return depths.get(taskId) || 0;
        }

        visited.add(taskId);
        currentPath.add(taskId);
        path.push(taskId);

        const dependencies = this.dependencies.get(taskId) || [];
        let maxChildDepth = 0;

        for (const dep of dependencies) {
            const childDepth = this.calculateDepth(dep.dependsOnTaskId, visited, depths, currentPath, path);
            maxChildDepth = Math.max(maxChildDepth, childDepth + 1);
        }

        depths.set(taskId, maxChildDepth);
        currentPath.delete(taskId);
        path.pop();

        return maxChildDepth;
    }

    private checkForCircularDependency(newDependency: PriorityStatusDependency): { isCircular: boolean; cycle: string[] } {
        const visited = new Set<string>();
        const path: string[] = [];

        const dfs = (taskId: string): boolean => {
            if (path.includes(taskId)) {
                return true;
            }

            if (visited.has(taskId)) {
                return false;
            }

            visited.add(taskId);
            path.push(taskId);

            const dependencies = this.dependencies.get(taskId) || [];
            for (const dep of dependencies) {
                if (dfs(dep.dependsOnTaskId)) {
                    return true;
                }
            }

            path.pop();
            return false;
        };

        // Check if adding this dependency creates a cycle
        // First check existing dependencies from the target
        const tempVisited = new Set<string>();
        const tempPath: string[] = [newDependency.taskId];

        const checkFromTarget = (taskId: string): boolean => {
            if (taskId === newDependency.taskId) {
                return true; // Found a cycle back to source
            }

            if (tempVisited.has(taskId)) {
                return false;
            }

            tempVisited.add(taskId);
            tempPath.push(taskId);

            const dependencies = this.dependencies.get(taskId) || [];
            for (const dep of dependencies) {
                if (checkFromTarget(dep.dependsOnTaskId)) {
                    return true;
                }
            }

            tempPath.pop();
            return false;
        };

        const isCircular = checkFromTarget(newDependency.dependsOnTaskId);
        return {
            isCircular,
            cycle: isCircular ? tempPath : []
        };
    }

    getDependencyGraph(): Map<string, PriorityStatusDependency[]> {
        return new Map(this.dependencies);
    }

    clearCache(): void {
        this.taskCache.clear();
    }

    clearDependencies(): void {
        this.dependencies.clear();
    }

    getStats() {
        return {
            taskCount: this.taskCache.size,
            dependencyCount: Array.from(this.dependencies.values()).flat().length,
            averageDependenciesPerTask: this.dependencies.size > 0 
                ? Array.from(this.dependencies.values()).flat().length / this.dependencies.size 
                : 0
        };
    }
}
