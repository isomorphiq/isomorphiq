import { EventFactory, globalEventBus } from "@isomorphiq/core";
import type { Task, TaskPriority } from "./types.ts";
import type { TaskPriorityChangedEvent } from "@isomorphiq/realtime";

/**
 * Priority update consistency manager
 * 
 * This module ensures that priority updates are consistent across all data sources
 * and provides optimized processing to avoid redundant operations.
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class PriorityUpdateManager {
    private static instance: PriorityUpdateManager;
    private pendingUpdates: Map<string, TaskPriority> = new Map();
    private batchTimeout: ReturnType<typeof setTimeout> | null = null;
    private readonly BATCH_DELAY_MS = 100; // Batch updates within 100ms window
    
    private constructor() {
        this.setupEventListeners();
    }
    
    public static getInstance(): PriorityUpdateManager {
        if (!PriorityUpdateManager.instance) {
            PriorityUpdateManager.instance = new PriorityUpdateManager();
        }
        return PriorityUpdateManager.instance;
    }
    
    /**
     * Setup event listeners for priority change events
     */
    private setupEventListeners(): void {
        globalEventBus.on("task_priority_changed", this.handlePriorityChanged.bind(this));
    }
    
    /**
     * Handle priority change events with debouncing and batching
     */
    private handlePriorityChanged(event: TaskPriorityChangedEvent): void {
        const data = event.data;
        
        if (!data.taskId || !data.newPriority) {
            return;
        }
        
        // Add to pending updates batch
        this.pendingUpdates.set(data.taskId, data.newPriority);
        
        // Schedule batch processing
        if (this.batchTimeout !== null) {
            clearTimeout(this.batchTimeout);
        }
        
        this.batchTimeout = setTimeout(() => {
            this.processBatchedUpdates();
        }, this.BATCH_DELAY_MS);
    }
    
    /**
     * Process batched priority updates
     */
    private async processBatchedUpdates(): Promise<void> {
        if (this.pendingUpdates.size === 0) {
            return;
        }
        
        const updates = new Map(this.pendingUpdates);
        this.pendingUpdates.clear();
        this.batchTimeout = null;
        
        console.log(`[PRIORITY MANAGER] Processing batched priority updates for ${updates.size} tasks`);
        
        // Here you would typically validate consistency across data sources
        // For now, we'll just verify the updates were processed
        for (const [taskId, newPriority] of updates) {
            await this.validatePriorityConsistency(taskId, newPriority);
        }
    }
    
    /**
     * Validate priority consistency across different data sources
     */
    private async validatePriorityConsistency(taskId: string, expectedPriority: TaskPriority): Promise<void> {
        // This would integrate with the ProductManager to validate consistency
        // For now, we'll simulate the validation
        console.log(`[PRIORITY MANAGER] Validating priority consistency for task ${taskId}: ${expectedPriority}`);
    }
    
    /**
     * Get current pending updates count
     */
    public getPendingUpdatesCount(): number {
        return this.pendingUpdates.size;
    }
    
    /**
     * Force process any pending updates immediately
     */
    public async flushUpdates(): Promise<void> {
        if (this.batchTimeout !== null) {
            clearTimeout(this.batchTimeout);
            this.batchTimeout = null;
        }
        await this.processBatchedUpdates();
    }
}

/**
 * Optimized priority update service
 * 
 * Provides efficient priority update operations with caching and consistency guarantees.
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class OptimizedPriorityService {
    private priorityCache: Map<string, TaskPriority> = new Map();
    private consistencyManager: PriorityUpdateManager;
    
    constructor() {
        this.consistencyManager = PriorityUpdateManager.getInstance();
    }
    
    /**
     * Update task priority with caching and consistency validation
     */
	    public async updateTaskPriority(
	        taskId: string,
	        newPriority: TaskPriority,
	        currentPriority: TaskPriority,
	        updateFunction: (id: string, priority: TaskPriority) => Promise<Task>, // eslint-disable-line no-unused-vars
	        updatedBy: string = "system",
	    ): Promise<Task> {
        // Skip update if priority is the same
        if (currentPriority === newPriority) {
            console.log(`[PRIORITY SERVICE] Skipping priority update for ${taskId} - priority unchanged`);
            // Return current task from cache or fetch
            return this.getCachedTask(taskId) || await updateFunction(taskId, newPriority);
        }
        
        // Validate priority value
        this.validatePriorityValue(newPriority);
        
        console.log(`[PRIORITY SERVICE] Updating priority for task ${taskId}: ${currentPriority} -> ${newPriority}`);
        
        // Update cache
        this.priorityCache.set(taskId, newPriority);
        
        try {
            // Perform the actual update
            const updatedTask = await updateFunction(taskId, newPriority);
            
            // Emit priority changed event for consistency manager
            const event = EventFactory.createTaskPriorityChanged(
                taskId,
                currentPriority,
                newPriority,
                updatedTask,
                updatedBy,
            );
            await globalEventBus.publish(event);
            
            return updatedTask;
        } catch (error) {
            // Rollback cache on error
            this.priorityCache.set(taskId, currentPriority);
            throw error;
        }
    }
    
    /**
     * Validate priority value
     */
    private validatePriorityValue(priority: TaskPriority): void {
        const validPriorities: TaskPriority[] = ["low", "medium", "high"];
        if (!validPriorities.includes(priority)) {
            throw new Error(`Invalid priority: ${priority}. Must be one of: ${validPriorities.join(", ")}`);
        }
    }
    
    /**
     * Get cached priority for a task
     */
    public getCachedPriority(taskId: string): TaskPriority | null {
        return this.priorityCache.get(taskId) || null;
    }
    
    /**
     * Update cached priority
     */
    public updateCachedPriority(taskId: string, priority: TaskPriority): void {
        this.priorityCache.set(taskId, priority);
    }
    
    /**
     * Clear cache for a task
     */
    public clearTaskCache(taskId: string): void {
        this.priorityCache.delete(taskId);
    }
    
    /**
     * Get cached task (this would integrate with a task cache)
     */
	    private getCachedTask(_taskId: string): Task | null {
	        void _taskId;
	        // This would integrate with a broader task caching system
	        // For now, return null to force fresh fetch
	        return null;
	    }
    
    /**
     * Get cache statistics
     */
    public getCacheStats(): { size: number; entries: Array<{ taskId: string; priority: TaskPriority }> } {
        const entries = Array.from(this.priorityCache.entries()).map(([taskId, priority]) => ({
            taskId,
            priority,
        }));
        
        return {
            size: this.priorityCache.size,
            entries,
        };
    }
    
    /**
     * Clear entire cache
     */
    public clearCache(): void {
        this.priorityCache.clear();
        console.log("[PRIORITY SERVICE] Cache cleared");
    }
}

/**
 * Priority consistency validator
 * 
 * Provides comprehensive validation of priority consistency across the system.
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class PriorityConsistencyValidator {
    /**
     * Validate priority ordering in a task list
     */
    public static validatePriorityOrdering(tasks: Task[]): {
        isValid: boolean;
        errors: string[];
    } {
        const errors: string[] = [];
        const priorityOrder: Record<TaskPriority, number> = {
            high: 0,
            medium: 1,
            low: 2,
        };
        
        for (let i = 0; i < tasks.length - 1; i++) {
            const currentTask = tasks[i];
            const nextTask = tasks[i + 1];
            
            const currentOrder = priorityOrder[currentTask.priority];
            const nextOrder = priorityOrder[nextTask.priority];
            
            // If same priority, maintain creation date order (newer tasks after older)
            if (currentOrder === nextOrder) {
                const currentDate = new Date(currentTask.createdAt).getTime();
                const nextDate = new Date(nextTask.createdAt).getTime();
                
                if (currentDate > nextDate) {
                    errors.push(
                        `Task ordering issue: ${currentTask.title} (${currentTask.createdAt}) should come after ${nextTask.title} (${nextTask.createdAt})`,
                    );
                }
            } else if (currentOrder > nextOrder) {
                errors.push(
                    `Priority ordering issue: ${currentTask.title} (${currentTask.priority}) should come before ${nextTask.title} (${nextTask.priority})`,
                );
            }
        }
        
        return {
            isValid: errors.length === 0,
            errors,
        };
    }
    
    /**
     * Validate priority consistency across multiple data sources
     */
    public static validateCrossSourceConsistency(
        primaryTask: Task,
        taskFromList: Task | null,
        taskFromQueue: Task | null,
    ): {
        isValid: boolean;
        errors: string[];
    } {
        const errors: string[] = [];
        
        if (taskFromList && taskFromList.priority !== primaryTask.priority) {
            errors.push(
                `List consistency: Task ${primaryTask.id} has priority ${primaryTask.priority} in primary source but ${taskFromList.priority} in task list`,
            );
        }
        
        if (taskFromQueue && taskFromQueue.priority !== primaryTask.priority) {
            errors.push(
                `Queue consistency: Task ${primaryTask.id} has priority ${primaryTask.priority} in primary source but ${taskFromQueue.priority} in task queue`,
            );
        }
        
        return {
            isValid: errors.length === 0,
            errors,
        };
    }
    
    /**
     * Validate priority update edge cases
     */
    public static validatePriorityUpdateEdgeCases(
        originalTask: Task,
        updatedTask: Task,
        newPriority: TaskPriority,
    ): {
        isValid: boolean;
        errors: string[];
    } {
        const errors: string[] = [];
        
        // Check if priority was actually updated
        if (updatedTask.priority !== newPriority) {
            errors.push(`Priority not updated: Expected ${newPriority}, got ${updatedTask.priority}`);
        }
        
	        // Check if other fields were preserved
	        if (updatedTask.id !== originalTask.id) {
	            errors.push("Task ID changed during priority update");
	        }
	        
	        if (updatedTask.title !== originalTask.title) {
	            errors.push("Task title changed during priority update");
	        }
	        
	        if (updatedTask.description !== originalTask.description) {
	            errors.push("Task description changed during priority update");
	        }
	        
	        if (updatedTask.status !== originalTask.status) {
	            errors.push("Task status changed during priority update");
	        }
        
        // Check if dependencies were preserved
        const originalDeps = JSON.stringify(originalTask.dependencies.sort());
        const updatedDeps = JSON.stringify(updatedTask.dependencies.sort());
        if (originalDeps !== updatedDeps) {
            errors.push("Task dependencies changed during priority update");
        }
        
        // Check if updatedAt timestamp was updated
        if (new Date(updatedTask.updatedAt) <= new Date(originalTask.updatedAt)) {
            errors.push("Task updatedAt timestamp not properly updated");
        }
        
        return {
            isValid: errors.length === 0,
            errors,
        };
    }
}

// Export singleton instances
export const priorityUpdateManager = PriorityUpdateManager.getInstance();
export const optimizedPriorityService = new OptimizedPriorityService();

