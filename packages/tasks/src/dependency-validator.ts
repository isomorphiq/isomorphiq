import { z } from "zod";
import type { TaskEntity } from "./task-domain.ts";

export const DependencyCycleSchema = z.object({
    tasks: z.array(z.string()),
    taskTitles: z.array(z.string()),
    length: z.number(),
});
export type DependencyCycle = z.output<typeof DependencyCycleSchema>;

export const DependencyIssueSchema = z.object({
    taskId: z.string(),
    dependencyId: z.string(),
    reason: z.string(),
});
export type DependencyIssue = z.output<typeof DependencyIssueSchema>;

export const DependencyValidationResultSchema = z.object({
    isValid: z.boolean(),
    error: z.string().optional(),
    cycles: z.array(DependencyCycleSchema).optional(),
    invalidDependencies: z.array(DependencyIssueSchema).optional(),
    warnings: z.array(z.string()).optional(),
});
export type DependencyValidationResult = z.output<typeof DependencyValidationResultSchema>;

export const DependencyAnalysisSchema = z.object({
    totalTasks: z.number(),
    tasksWithDependencies: z.number(),
    maxDependencyDepth: z.number(),
    independentTasks: z.array(z.string()),
    criticalPath: z.array(z.string()).optional(),
    cycles: z.array(DependencyCycleSchema),
});
export type DependencyAnalysis = z.output<typeof DependencyAnalysisSchema>;

export class DependencyValidator {
    private taskMap: Map<string, TaskEntity> = new Map();

    constructor(tasks: TaskEntity[]) {
        this.buildTaskMap(tasks);
    }

    private buildTaskMap(tasks: TaskEntity[]): void {
        this.taskMap.clear();
        for (const task of tasks) {
            this.taskMap.set(task.id, task);
        }
    }

    /**
     * Validates all dependencies in the task set
     */
    validateDependencies(): DependencyValidationResult {
        const cycles = this.detectCycles();
        const invalidDependencies = this.validateDependencyReferences();
        const warnings = this.generateWarnings();

        if (cycles.length > 0) {
            return {
                isValid: false,
                error: `Circular dependencies detected: ${cycles.length} cycle(s) found`,
                cycles,
                invalidDependencies,
                warnings,
            };
        }

        if (invalidDependencies.length > 0) {
            return {
                isValid: false,
                error: `Invalid dependencies found: ${invalidDependencies.length} reference(s) to non-existent tasks`,
                invalidDependencies,
                warnings,
            };
        }

        return {
            isValid: true,
            warnings,
        };
    }

    /**
     * Detects all circular dependency cycles using DFS
     */
    detectCycles(): DependencyCycle[] {
        const cycles: DependencyCycle[] = [];
        const visited = new Set<string>();
        const recursionStack = new Set<string>();
        const path: string[] = [];

        const dfs = (taskId: string): boolean => {
            if (recursionStack.has(taskId)) {
                const cycleStart = path.indexOf(taskId);
                const cycleTasks = path.slice(cycleStart);
                cycleTasks.push(taskId);

                const taskTitles = cycleTasks.map((id) => this.taskMap.get(id)?.title || id);

                cycles.push({
                    tasks: [...cycleTasks],
                    taskTitles,
                    length: cycleTasks.length,
                });
                return true;
            }

            if (visited.has(taskId)) {
                return false;
            }

            visited.add(taskId);
            recursionStack.add(taskId);
            path.push(taskId);

            const task = this.taskMap.get(taskId);
            if (task) {
                for (const depId of task.dependencies) {
                    dfs(depId);
                }
            }

            recursionStack.delete(taskId);
            path.pop();
            return false;
        };

        for (const taskId of this.taskMap.keys()) {
            if (!visited.has(taskId)) {
                dfs(taskId);
            }
        }

        return cycles;
    }

    /**
     * Validates that all dependency references point to existing tasks
     */
    private validateDependencyReferences(): DependencyIssue[] {
        const invalidDependencies: DependencyIssue[] = [];

        for (const [taskId, task] of this.taskMap) {
            for (const depId of task.dependencies) {
                if (!this.taskMap.has(depId)) {
                    invalidDependencies.push({
                        taskId,
                        dependencyId: depId,
                        reason: "Referenced task does not exist",
                    });
                }
            }
        }

        return invalidDependencies;
    }

    /**
     * Generates warnings about task dependencies
     */
    private generateWarnings(): string[] {
        const warnings: string[] = [];

        const independentTasks = Array.from(this.taskMap.values()).filter(
            (task) => task.dependencies.length === 0,
        );
        if (independentTasks.length === 0) {
            warnings.push("No independent tasks found");
        }

        const tasksWithManyDependencies = Array.from(this.taskMap.values()).filter(
            (task) => task.dependencies.length > 5,
        );
        if (tasksWithManyDependencies.length > 0) {
            warnings.push(`${tasksWithManyDependencies.length} task(s) have more than 5 dependencies`);
        }

        return warnings;
    }

    /**
     * Analyzes dependency structure and returns metrics
     */
    analyzeDependencies(): DependencyAnalysis {
        const cycles = this.detectCycles();
        const tasks = Array.from(this.taskMap.values());
        const tasksWithDependencies = tasks.filter((task) => task.dependencies.length > 0).length;
        const independentTasks = tasks.filter((task) => task.dependencies.length === 0).map(
            (task) => task.id,
        );
        const maxDependencyDepth = this.calculateMaxDependencyDepth(tasks);

        return {
            totalTasks: tasks.length,
            tasksWithDependencies,
            maxDependencyDepth,
            independentTasks,
            cycles,
        };
    }

    private calculateMaxDependencyDepth(tasks: TaskEntity[]): number {
        let maxDepth = 0;

        const calculateDepth = (taskId: string, visited: Set<string>): number => {
            if (visited.has(taskId)) {
                return 0;
            }

            const task = tasks.find((candidate) => candidate.id === taskId);
            if (!task || task.dependencies.length === 0) {
                return 0;
            }

            const nextVisited = new Set(visited);
            nextVisited.add(taskId);
            const depths = task.dependencies.map((depId) => calculateDepth(depId, nextVisited));
            return 1 + Math.max(0, ...depths);
        };

        for (const task of tasks) {
            const depth = calculateDepth(task.id, new Set<string>());
            maxDepth = Math.max(maxDepth, depth);
        }

        return maxDepth;
    }
}
