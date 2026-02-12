// TODO: This file is too complex (695 lines) and should be refactored into several modules.
// Current concerns mixed: Schedule management, cron parsing, task execution,
// dependency-aware scheduling, validation, statistics, timezone handling.
// 
// Proposed structure:
// - scheduling/scheduler/index.ts - Main scheduler orchestration
// - scheduling/scheduler/schedule-store.ts - Schedule persistence and CRUD
// - scheduling/scheduler/cron-parser.ts - Cron expression parsing and validation
// - scheduling/scheduler/executor.ts - Scheduled task execution
// - scheduling/scheduler/dependency-scheduler.ts - Dependency-aware scheduling
// - scheduling/scheduler/validator.ts - Schedule validation logic
// - scheduling/scheduler/statistics-service.ts - Schedule statistics and reporting
// - scheduling/scheduler/timezone-service.ts - Timezone handling
// - scheduling/scheduler/types.ts - Scheduler-specific types

import { EventEmitter } from "node:events";
import * as cron from "node-cron";
import type { ProductManager } from "@isomorphiq/profiles";
import { TaskTypeSchema, type Task, type TaskType } from "@isomorphiq/tasks";
import { DependencyGraphService } from "./dependency-graph.ts";

export interface ScheduledTask {
	id: string;
	name: string;
	description: string;
	cronExpression: string;
	timezone?: string;
	taskTemplate: {
		title: string;
		description: string;
		priority: "high" | "medium" | "low";
		type?: TaskType;
		createdBy?: string;
		assignedTo?: string;
		collaborators?: string[];
		watchers?: string[];
		dependencies?: string[];
		variables?: Record<string, string>;
	};
	isActive: boolean;
	createdAt: string;
	updatedAt: string;
	lastRun?: string;
	nextRun?: string;
	runCount: number;
	maxRuns?: number;
	failureCount: number;
	maxFailures?: number;
}

export interface ScheduleStats {
	totalSchedules: number;
	activeSchedules: number;
	inactiveSchedules: number;
	totalRuns: number;
	failedRuns: number;
	successRate: number;
	nextScheduledRun?: string;
}

export interface ScheduleValidationResult {
	isValid: boolean;
	errors: string[];
	warnings: string[];
	nextRuns?: string[];
}

/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class TaskScheduler extends EventEmitter {
	private productManager: ProductManager;
	private scheduledTasks: Map<string, ScheduledTask> = new Map();
	private cronJobs: Map<string, cron.ScheduledTask> = new Map();
	private isRunning: boolean = false;
	private taskFailureLog: Map<string, Array<{ timestamp: string; error: string }>> = new Map();
	private dependencyGraphService: DependencyGraphService;

	constructor(productManager: ProductManager) {
		super();
		this.productManager = productManager;
		this.dependencyGraphService = new DependencyGraphService();
	}

    private resolveTaskType(raw: unknown): TaskType {
        const parsed = TaskTypeSchema.safeParse(raw);
        return parsed.success ? parsed.data : "task";
    }

	// Initialize the scheduler
	async initialize(): Promise<void> {
		console.log("[SCHEDULER] Initializing task scheduler...");
		
		// Load existing scheduled tasks from storage if available
		await this.loadScheduledTasks();
		
		// Start all active scheduled tasks
		await this.startAllScheduledTasks();
		
		this.isRunning = true;
		console.log("[SCHEDULER] Task scheduler initialized successfully");
		this.emit("schedulerStarted");
	}

	// Create a new scheduled task
	async createScheduledTask(scheduleData: Omit<ScheduledTask, "id" | "createdAt" | "updatedAt" | "runCount" | "failureCount">): Promise<ScheduledTask> {
		const id = `schedule_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
		const now = new Date().toISOString();
		
		const scheduledTask: ScheduledTask = {
			...scheduleData,
			id,
			createdAt: now,
			updatedAt: now,
			runCount: 0,
			failureCount: 0,
		};

		// Validate cron expression
		const validation = this.validateCronExpression(scheduleData.cronExpression);
		if (!validation.isValid) {
			throw new Error(`Invalid cron expression: ${validation.errors.join(", ")}`);
		}

		// Store the scheduled task
		this.scheduledTasks.set(id, scheduledTask);
		
		// Start the cron job if active
		if (scheduledTask.isActive) {
			await this.startScheduledTask(id);
		}

		console.log(`[SCHEDULER] Created scheduled task: ${scheduledTask.name} (${id})`);
		this.emit("scheduledTaskCreated", scheduledTask);
		
		return scheduledTask;
	}

	// Update a scheduled task
	async updateScheduledTask(id: string, updates: Partial<ScheduledTask>): Promise<ScheduledTask> {
		const existingTask = this.scheduledTasks.get(id);
		if (!existingTask) {
			throw new Error(`Scheduled task not found: ${id}`);
		}

		// Validate new cron expression if provided
		if (updates.cronExpression && updates.cronExpression !== existingTask.cronExpression) {
			const validation = this.validateCronExpression(updates.cronExpression);
			if (!validation.isValid) {
				throw new Error(`Invalid cron expression: ${validation.errors.join(", ")}`);
			}
		}

		// Stop existing cron job if running
		await this.stopScheduledTask(id);

        const nextUpdatedAt = new Date().toISOString();
        const existingUpdatedAt = Date.parse(existingTask.updatedAt);
        const nextUpdatedAtMs = Date.parse(nextUpdatedAt);
        const updatedAt =
            Number.isNaN(existingUpdatedAt)
            || Number.isNaN(nextUpdatedAtMs)
            || nextUpdatedAtMs > existingUpdatedAt
                ? nextUpdatedAt
                : new Date(existingUpdatedAt + 1).toISOString();

		// Update the task
		const updatedTask: ScheduledTask = {
			...existingTask,
			...updates,
			updatedAt,
		};

		this.scheduledTasks.set(id, updatedTask);

		// Restart cron job if active
		if (updatedTask.isActive) {
			await this.startScheduledTask(id);
		}

		console.log(`[SCHEDULER] Updated scheduled task: ${updatedTask.name} (${id})`);
		this.emit("scheduledTaskUpdated", updatedTask);
		
		return updatedTask;
	}

	// Delete a scheduled task
	async deleteScheduledTask(id: string): Promise<boolean> {
		const task = this.scheduledTasks.get(id);
		if (!task) {
			return false;
		}

		// Stop the cron job
		await this.stopScheduledTask(id);

		// Remove from storage
		this.scheduledTasks.delete(id);
		this.taskFailureLog.delete(id);

		console.log(`[SCHEDULER] Deleted scheduled task: ${task.name} (${id})`);
		this.emit("scheduledTaskDeleted", task);
		
		return true;
	}

	// Get a scheduled task by ID
	getScheduledTask(id: string): ScheduledTask | null {
		return this.scheduledTasks.get(id) || null;
	}

	// Get all scheduled tasks
	getAllScheduledTasks(): ScheduledTask[] {
		return Array.from(this.scheduledTasks.values());
	}

	// Get active scheduled tasks
	getActiveScheduledTasks(): ScheduledTask[] {
		return this.getAllScheduledTasks().filter(task => task.isActive);
	}

	// Validate cron expression
	validateCronExpression(expression: string): ScheduleValidationResult {
		const errors: string[] = [];
		const warnings: string[] = [];

		// Basic format validation
		if (!expression || typeof expression !== "string") {
			errors.push("Cron expression is required and must be a string");
			return { isValid: false, errors, warnings };
		}

		// Check if it's a valid cron expression
		if (!cron.validate(expression)) {
			errors.push("Invalid cron expression format");
			return { isValid: false, errors, warnings };
		}

		// Try to parse and get next runs
		try {
			const task = cron.schedule(expression, () => {}, { scheduled: false });
			const nextRuns: string[] = [];
			
			// Get next 5 runs for validation
			const now = new Date();
			for (let i = 0; i < 5; i++) {
				const nextRun = this.getNextRun(expression, i);
				if (nextRun) {
					nextRuns.push(nextRun.toISOString());
				}
			}
			
			// Add warnings for common issues
			if (expression.includes("* * * * *")) {
				warnings.push("This schedule runs every minute - ensure this is intentional");
			}
			
			if (expression.startsWith("0 0 * * *")) {
				warnings.push("This schedule runs daily at midnight");
			}

			return { isValid: true, errors, warnings, nextRuns };
		} catch (error) {
			errors.push(`Failed to parse cron expression: ${(error as Error).message}`);
			return { isValid: false, errors, warnings };
		}
	}

	// Get next run time for a cron expression
	private getNextRun(expression: string, offset: number = 0): Date | null {
		try {
			// This is a simplified implementation
			// In a production environment, you might want to use a more robust cron parser
			const task = cron.schedule(expression, () => {}, { scheduled: false });
			
			// node-cron doesn't provide a direct way to get next run times
			// This is a basic implementation - consider using a library like 'cron-parser' for accurate next run times
			const now = new Date();
			const nextRun = new Date(now.getTime() + (offset + 1) * 60000); // Simplified - adds minutes
			return nextRun;
		} catch {
			return null;
		}
	}

	// Start a scheduled task
	private async startScheduledTask(id: string): Promise<void> {
		const task = this.scheduledTasks.get(id);
		if (!task) {
			throw new Error(`Scheduled task not found: ${id}`);
		}

		if (!cron.validate(task.cronExpression)) {
			throw new Error(`Invalid cron expression: ${task.cronExpression}`);
		}

		// Create and start the cron job
		const cronJob = cron.schedule(task.cronExpression, async () => {
			await this.executeScheduledTask(id);
		}, {
			scheduled: true,
			timezone: task.timezone || "UTC",
		});

		this.cronJobs.set(id, cronJob);
		
		// Calculate and set next run time
		const nextRun = this.getNextRun(task.cronExpression);
		if (nextRun) {
			task.nextRun = nextRun.toISOString();
		}

		console.log(`[SCHEDULER] Started scheduled task: ${task.name} (${task.cronExpression})`);
		this.emit("scheduledTaskStarted", task);
	}

	// Stop a scheduled task
	private async stopScheduledTask(id: string): Promise<void> {
		const cronJob = this.cronJobs.get(id);
		if (cronJob) {
			cronJob.stop();
			this.cronJobs.delete(id);
		}

		const task = this.scheduledTasks.get(id);
		if (task) {
			delete task.nextRun;
			console.log(`[SCHEDULER] Stopped scheduled task: ${task.name}`);
			this.emit("scheduledTaskStopped", task);
		}
	}

	// Start all active scheduled tasks
	private async startAllScheduledTasks(): Promise<void> {
		const activeTasks = this.getActiveScheduledTasks();
		console.log(`[SCHEDULER] Starting ${activeTasks.length} active scheduled tasks...`);
		
		for (const task of activeTasks) {
			try {
				await this.startScheduledTask(task.id);
			} catch (error) {
				console.error(`[SCHEDULER] Failed to start scheduled task ${task.name}:`, error);
			}
		}
	}

	// Execute a scheduled task
	private async executeScheduledTask(id: string): Promise<void> {
		const task = this.scheduledTasks.get(id);
		if (!task) {
			console.error(`[SCHEDULER] Scheduled task not found: ${id}`);
			return;
		}

		console.log(`[SCHEDULER] Executing scheduled task: ${task.name}`);
		
		try {
			// Check if we've reached max runs
			if (task.maxRuns && task.runCount >= task.maxRuns) {
				console.log(`[SCHEDULER] Task ${task.name} reached max runs (${task.maxRuns}), deactivating`);
				task.isActive = false;
				await this.stopScheduledTask(id);
				this.emit("scheduledTaskMaxRunsReached", task);
				return;
			}

			// Replace variables in task template
			const taskData = this.interpolateTaskVariables(task.taskTemplate);

			// Create the actual task
			const createdTask = await this.productManager.createTask(
				taskData.title,
				taskData.description,
				taskData.priority,
				taskData.dependencies || [],
				taskData.createdBy,
				taskData.assignedTo,
				taskData.collaborators,
				taskData.watchers,
				this.resolveTaskType(taskData.type),
			);

			// Update execution stats
			task.lastRun = new Date().toISOString();
			task.runCount++;
			
			// Calculate next run
			const nextRun = this.getNextRun(task.cronExpression);
			if (nextRun) {
				task.nextRun = nextRun.toISOString();
			}

			// Clear previous failures on success
			this.taskFailureLog.delete(id);
			task.failureCount = 0;

			console.log(`[SCHEDULER] Successfully created task from schedule: ${task.name} -> ${createdTask.title}`);
			this.emit("scheduledTaskExecuted", task, createdTask);

		} catch (error) {
			const errorMessage = (error as Error).message;
			console.error(`[SCHEDULER] Failed to execute scheduled task ${task.name}:`, errorMessage);
			
			// Track failures
			task.failureCount++;
			
			// Log failure details
			if (!this.taskFailureLog.has(id)) {
				this.taskFailureLog.set(id, []);
			}
			this.taskFailureLog.get(id)!.push({
				timestamp: new Date().toISOString(),
				error: errorMessage,
			});

			// Check if we've reached max failures
			if (task.maxFailures && task.failureCount >= task.maxFailures) {
				console.log(`[SCHEDULER] Task ${task.name} reached max failures (${task.maxFailures}), deactivating`);
				task.isActive = false;
				await this.stopScheduledTask(id);
				this.emit("scheduledTaskMaxFailuresReached", task);
			}

			this.emit("scheduledTaskExecutionFailed", task, error);
		}
	}

	// Interpolate variables in task template
	private interpolateTaskVariables(template: ScheduledTask["taskTemplate"]): ScheduledTask["taskTemplate"] {
		const variables = {
			...template.variables,
			DATE: new Date().toISOString().split("T")[0],
			DATETIME: new Date().toISOString(),
			TIMESTAMP: Date.now().toString(),
		};

		let interpolated = { ...template };

		// Replace variables in title and description
		interpolated.title = this.replaceVariables(interpolated.title, variables);
		interpolated.description = this.replaceVariables(interpolated.description, variables);

		return interpolated;
	}

	// Replace variables in a string
	private replaceVariables(text: string, variables: Record<string, string>): string {
		let result = text;
		for (const [key, value] of Object.entries(variables)) {
			result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
		}
		return result;
	}

	// Get scheduler statistics
	getStats(): ScheduleStats {
		const tasks = this.getAllScheduledTasks();
		const activeTasks = tasks.filter(t => t.isActive);
		const totalRuns = tasks.reduce((sum, task) => sum + task.runCount, 0);
		const failedRuns = tasks.reduce((sum, task) => sum + task.failureCount, 0);
		
		const nextRunTimes = activeTasks
			.filter(task => task.nextRun)
			.map(task => task.nextRun!)
			.sort();

		return {
			totalSchedules: tasks.length,
			activeSchedules: activeTasks.length,
			inactiveSchedules: tasks.length - activeTasks.length,
			totalRuns,
			failedRuns,
			successRate: totalRuns > 0 ? ((totalRuns - failedRuns) / totalRuns) * 100 : 100,
			nextScheduledRun: nextRunTimes[0],
		};
	}

	// Get failure log for a scheduled task
	getTaskFailureLog(id: string): Array<{ timestamp: string; error: string }> {
		return this.taskFailureLog.get(id) || [];
	}

	// Pause/resume scheduler
	pause(): void {
		console.log("[SCHEDULER] Pausing scheduler");
		this.isRunning = false;
		// Stop all cron jobs but keep them in memory
		for (const [id] of this.cronJobs) {
			this.stopScheduledTask(id);
		}
		this.emit("schedulerPaused");
	}

	resume(): void {
		console.log("[SCHEDULER] Resuming scheduler");
		this.isRunning = true;
		// Restart all active scheduled tasks
		this.startAllScheduledTasks();
		this.emit("schedulerResumed");
	}

	// Shutdown scheduler
	async shutdown(): Promise<void> {
		console.log("[SCHEDULER] Shutting down scheduler");
		this.isRunning = false;
		
		// Stop all cron jobs
		for (const [id] of this.cronJobs) {
			await this.stopScheduledTask(id);
		}
		
		// Clear data
		this.scheduledTasks.clear();
		this.cronJobs.clear();
		this.taskFailureLog.clear();
		
		this.emit("schedulerShutdown");
		console.log("[SCHEDULER] Scheduler shutdown complete");
	}

	// Load scheduled tasks from storage (placeholder implementation)
	private async loadScheduledTasks(): Promise<void> {
		// In a real implementation, this would load from a database
		// For now, we'll start with an empty set
		console.log("[SCHEDULER] No existing scheduled tasks to load");
	}

	// Save scheduled tasks to storage (placeholder implementation)
	private async saveScheduledTasks(): Promise<void> {
		// In a real implementation, this would save to a database
		console.log("[SCHEDULER] Scheduled tasks storage not implemented - using in-memory storage");
	}

	// Dependency-aware scheduling methods

	// Validate scheduled task dependencies before execution
	async validateScheduledTaskDependencies(taskId: string): Promise<{
		isValid: boolean;
		readyToExecute: boolean;
		missingDependencies: string[];
		circularDependencies: string[];
	}> {
		const task = this.scheduledTasks.get(taskId);
		if (!task) {
			throw new Error(`Scheduled task not found: ${taskId}`);
		}

		const allTasks = await this.productManager.getAllTasks();
		this.dependencyGraphService.updateTaskCache(allTasks);

		const deps = task.taskTemplate.dependencies || [];
		const missingDeps: string[] = [];
		const circularDeps: string[] = [];

		// Check for missing dependencies
		for (const depId of deps) {
			const depTask = allTasks.find(t => t.id === depId);
			if (!depTask) {
				missingDeps.push(depId);
			}
		}

		// Check for circular dependencies
		const circularCheck = this.dependencyGraphService.detectCircularDependencies(allTasks);
		if (circularCheck.hasCycle) {
			circularDeps.push(...circularCheck.affectedTasks.filter(id => deps.includes(id)));
		}

		// Check if dependencies are satisfied
		const readyToExecute = deps.every(depId => {
			const depTask = allTasks.find(t => t.id === depId);
			return depTask && depTask.status === "done";
		});

		return {
			isValid: missingDeps.length === 0 && circularDeps.length === 0,
			readyToExecute,
			missingDependencies: missingDeps,
			circularDependencies: circularDeps
		};
	}

	// Execute scheduled task with dependency awareness
	private async executeScheduledTaskWithDependencies(id: string): Promise<void> {
		const task = this.scheduledTasks.get(id);
		if (!task) {
			console.error(`[SCHEDULER] Scheduled task not found: ${id}`);
			return;
		}

		console.log(`[SCHEDULER] Executing scheduled task with dependency awareness: ${task.name}`);
		
		try {
			// Validate dependencies first
			const depValidation = await this.validateScheduledTaskDependencies(id);
			
			if (!depValidation.isValid) {
				console.error(`[SCHEDULER] Task ${task.name} has invalid dependencies:`, depValidation);
				task.failureCount++;
				this.emit("scheduledTaskDependencyError", task, depValidation);
				return;
			}

			if (!depValidation.readyToExecute) {
				console.log(`[SCHEDULER] Task ${task.name} dependencies not satisfied, skipping execution`);
				this.emit("scheduledTaskDependenciesNotSatisfied", task, depValidation);
				return;
			}

			// Execute the task (original logic)
			await this.executeScheduledTask(id);

		} catch (error) {
			console.error(`[SCHEDULER] Error executing scheduled task ${task.name}:`, error);
			task.failureCount++;
			this.emit("scheduledTaskExecutionError", task, error);
		}
	}

	// Get dependency-aware scheduling recommendations
	getDependencySchedulingRecommendations(): Array<{
		taskId: string;
		taskName: string;
		recommendation: "reschedule" | "proceed" | "skip" | "fix_dependencies";
		reason: string;
		estimatedDelay?: number;
	}> {
		const recommendations = [];
		const activeTasks = this.getActiveScheduledTasks();

		for (const task of activeTasks) {
			const deps = task.taskTemplate.dependencies || [];
			
			if (deps.length === 0) {
				// No dependencies, can proceed
				recommendations.push({
					taskId: task.id,
					taskName: task.name,
					recommendation: "proceed",
					reason: "No dependencies, ready to execute"
				});
			} else {
				// Has dependencies, need to check
				// This is a simplified check - in reality would validate against current tasks
				recommendations.push({
					taskId: task.id,
					taskName: task.name,
					recommendation: "skip",
					reason: "Has dependencies that need validation",
					estimatedDelay: deps.length * 60 // Estimate 1 minute per dependency
				});
			}
		}

		return recommendations;
	}

	// Optimize scheduled task execution order based on dependencies
	optimizeScheduledTaskOrder(): string[] {
		const activeTasks = this.getActiveScheduledTasks();
		
		// Sort by next run time first, then by dependency order
		const sortedTasks = activeTasks.sort((a, b) => {
			if (a.nextRun && b.nextRun) {
				return new Date(a.nextRun).getTime() - new Date(b.nextRun).getTime();
			}
			return 0;
		});

		// Simple dependency-aware ordering
		const orderedTasks: string[] = [];
		const processed = new Set<string>();

		for (const task of sortedTasks) {
			const deps = task.taskTemplate.dependencies || [];
			
			// If no unprocessed dependencies, can add to order
			if (deps.every(depId => processed.has(depId))) {
				orderedTasks.push(task.id);
				processed.add(task.id);
			}
		}

		// Add any remaining tasks
		for (const task of sortedTasks) {
			if (!processed.has(task.id)) {
				orderedTasks.push(task.id);
			}
		}

		return orderedTasks;
	}

	// Get dependency metrics for scheduled tasks
	getScheduledTaskDependencyMetrics(): {
		totalScheduledTasks: number;
		tasksWithDependencies: number;
		averageDependencyCount: number;
		complexDependencyChains: number;
		dependencySatisfactionRate: number;
	} {
		const activeTasks = this.getActiveScheduledTasks();
		const tasksWithDeps = activeTasks.filter(task => 
			task.taskTemplate.dependencies && task.taskTemplate.dependencies.length > 0
		);

		const totalDeps = tasksWithDeps.reduce((sum, task) => 
			sum + (task.taskTemplate.dependencies?.length || 0), 0
		);

		const avgDepCount = tasksWithDeps.length > 0 ? totalDeps / tasksWithDeps.length : 0;

		// Count complex chains (tasks with >3 dependencies)
		const complexChains = tasksWithDeps.filter(task => 
			(task.taskTemplate.dependencies?.length || 0) > 3
		).length;

		// Simplified satisfaction rate (placeholder)
		const satisfactionRate = 0.85; // Would calculate based on actual dependency status

		return {
			totalScheduledTasks: activeTasks.length,
			tasksWithDependencies: tasksWithDeps.length,
			averageDependencyCount: Math.round(avgDepCount * 10) / 10,
			complexDependencyChains: complexChains,
			dependencySatisfactionRate: satisfactionRate
		};
	}
}
