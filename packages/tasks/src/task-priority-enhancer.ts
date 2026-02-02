// High Priority Task Implementation: Task Priority Enhancement System
// This implementation adds enhanced priority-based task processing

import type { Task } from "./types.ts";

type PriorityMetrics = {
    totalTasks: number;
    highPriorityCount: number;
    mediumPriorityCount: number;
    lowPriorityCount: number;
    averageCompletionTime: Record<string, number>;
};

/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
class TaskPriorityEnhancer {
    private metrics: PriorityMetrics;

    constructor() {
        this.metrics = {
            totalTasks: 0,
            highPriorityCount: 0,
            mediumPriorityCount: 0,
            lowPriorityCount: 0,
            averageCompletionTime: {
                high: 0,
                medium: 0,
                low: 0,
            },
        };
    }

    validateAndEnhancePriority(task: Task): Task {
        const now = new Date();
        const taskAge = now.getTime() - new Date(task.createdAt).getTime();
        const daysOld = taskAge / (1000 * 60 * 60 * 24);

        if (daysOld > 14 && task.priority === "medium") {
            console.log(
                `Escalated task ${task.id} from medium to high priority (age: ${daysOld.toFixed(1)} days)`,
            );
            return { ...task, priority: "high" };
        }

        if (daysOld > 7 && task.priority === "low") {
            console.log(
                `Escalated task ${task.id} from low to medium priority (age: ${daysOld.toFixed(1)} days)`,
            );
            return { ...task, priority: "medium" };
        }

        return task;
    }

    calculatePriorityScore(task: Task): number {
        const priorityWeights = {
            high: 100,
            medium: 50,
            low: 10,
        };

        let score = priorityWeights[task.priority] || 10;

        const now = new Date();
        const taskAge = now.getTime() - new Date(task.createdAt).getTime();
        const daysOld = taskAge / (1000 * 60 * 60 * 24);
        score += Math.min(daysOld * 2, 50);

        if (task.dependencies && task.dependencies.length > 0) {
            score += task.dependencies.length * 5;
        }

        return score;
    }

    sortTasksByPriority(tasks: Task[]): Task[] {
        return tasks
            .slice()
            .sort((left, right) => this.calculatePriorityScore(right) - this.calculatePriorityScore(left));
    }

    updateMetrics(tasks: Task[]): void {
        this.metrics = {
            ...this.metrics,
            totalTasks: tasks.length,
            highPriorityCount: tasks.filter((task) => task.priority === "high").length,
            mediumPriorityCount: tasks.filter((task) => task.priority === "medium").length,
            lowPriorityCount: tasks.filter((task) => task.priority === "low").length,
        };
    }

    generatePriorityReport(): string {
        const { totalTasks, highPriorityCount, mediumPriorityCount, lowPriorityCount } = this.metrics;
        const safeTotal = totalTasks === 0 ? 1 : totalTasks;

        return `
Priority Enhancement Report:
============================
Total Tasks: ${totalTasks}
High Priority: ${highPriorityCount} (${((highPriorityCount / safeTotal) * 100).toFixed(1)}%)
Medium Priority: ${mediumPriorityCount} (${((mediumPriorityCount / safeTotal) * 100).toFixed(1)}%)
Low Priority: ${lowPriorityCount} (${((lowPriorityCount / safeTotal) * 100).toFixed(1)}%)

Recommendations:
- Focus on high priority tasks first for optimal productivity
- Consider escalating aged tasks to prevent bottlenecks
- Monitor task completion rates by priority level
        `;
    }
}

// Export the enhanced priority management system
export { TaskPriorityEnhancer };
export type { PriorityMetrics };

