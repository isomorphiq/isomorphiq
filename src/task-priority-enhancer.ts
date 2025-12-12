// High Priority Task Implementation: Task Priority Enhancement System
// This implementation adds enhanced priority-based task processing

import type { Task } from './types.ts';

interface PriorityMetrics {
    totalTasks: number;
    highPriorityCount: number;
    mediumPriorityCount: number;
    lowPriorityCount: number;
    averageCompletionTime: Record<string, number>;
}

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
                low: 0
            }
        };
    }
    
    validateAndEnhancePriority(task: Task): Task {
        // Auto-adjust priority based on task age and dependencies
        const now = new Date();
        const taskAge = now.getTime() - new Date(task.createdAt).getTime();
        const daysOld = taskAge / (1000 * 60 * 60 * 24);
        
        // Escalate priority for old tasks
        if (daysOld > 7 && task.priority === 'low') {
            task.priority = 'medium';
            console.log(`Escalated task ${task.id} from low to medium priority (age: ${daysOld.toFixed(1)} days)`);
        } else if (daysOld > 14 && task.priority === 'medium') {
            task.priority = 'high';
            console.log(`Escalated task ${task.id} from medium to high priority (age: ${daysOld.toFixed(1)} days)`);
        }
        
        return task;
    }
    
    calculatePriorityScore(task: Task): number {
        const priorityWeights = {
            high: 100,
            medium: 50,
            low: 10
        };
        
        let score = priorityWeights[task.priority] || 10;
        
        // Add urgency factor based on age
        const now = new Date();
        const taskAge = now.getTime() - new Date(task.createdAt).getTime();
        const daysOld = taskAge / (1000 * 60 * 60 * 24);
        score += Math.min(daysOld * 2, 50); // Max 50 points for age
        
        // Add dependency factor (tasks with more dependencies get higher priority)
        if (task.dependencies && task.dependencies.length > 0) {
            score += task.dependencies.length * 5;
        }
        
        return score;
    }
    
    sortTasksByPriority(tasks: Task[]): Task[] {
        return tasks
            .map(task => ({
                ...task,
                priorityScore: this.calculatePriorityScore(task)
            }))
            .sort((a, b) => (b.priorityScore || 0) - (a.priorityScore || 0));
    }
    
    updateMetrics(tasks: Task[]): void {
        this.metrics.totalTasks = tasks.length;
        this.metrics.highPriorityCount = tasks.filter(t => t.priority === 'high').length;
        this.metrics.mediumPriorityCount = tasks.filter(t => t.priority === 'medium').length;
        this.metrics.lowPriorityCount = tasks.filter(t => t.priority === 'low').length;
    }
    
    generatePriorityReport(): string {
        const { totalTasks, highPriorityCount, mediumPriorityCount, lowPriorityCount } = this.metrics;
        
        return `
Priority Enhancement Report:
============================
Total Tasks: ${totalTasks}
High Priority: ${highPriorityCount} (${((highPriorityCount/totalTasks) * 100).toFixed(1)}%)
Medium Priority: ${mediumPriorityCount} (${((mediumPriorityCount/totalTasks) * 100).toFixed(1)}%)
Low Priority: ${lowPriorityCount} (${((lowPriorityCount/totalTasks) * 100).toFixed(1)}%)

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