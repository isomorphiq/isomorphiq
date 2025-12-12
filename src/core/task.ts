import type { CreateTaskInput, TaskStatus, TaskType, UpdateTaskInput } from "../types.ts";

// Extended UpdateTaskInput with additional fields
export interface ExtendedUpdateTaskInput extends UpdateTaskInput {
	priority?: TaskPriority;
	dependencies?: string[];
}

// Re-export UpdateTaskInput for use in other modules
export type { UpdateTaskInput };

import type { BaseEntity, Result } from "./result.ts";
import { ValidationError } from "./result.ts";

// Define TaskPriority locally since it's not exported from types.ts
export type TaskPriority = "low" | "medium" | "high";

// Extended CreateTaskInput with priority
export interface CreateTaskInputWithPriority extends CreateTaskInput {
	priority?: TaskPriority;
}

/**
 * Domain entity for Task
 */
export interface TaskEntity extends BaseEntity {
	title: string;
	description: string;
	status: TaskStatus;
	priority: TaskPriority;
	type: TaskType;
	dependencies: string[];
	createdBy: string;
	assignedTo?: string;
	collaborators?: string[];
	watchers?: string[];
	[key: string]: unknown;
}

/**
 * Task value objects
 */
export interface TaskDependency {
	taskId: string;
	dependsOn: string;
}

export interface TaskAssignment {
	taskId: string;
	assignedTo: string;
	assignedBy: string;
	assignedAt: Date;
}

/**
 * Task domain rules and validation
 */
export const TaskDomainRules = {
	validateTitle(title: string): Result<void> {
		if (!title || title.trim().length === 0) {
			return {
				success: false,
				error: new ValidationError("Title is required", "title"),
			};
		}
		if (title.length > 200) {
			return {
				success: false,
				error: new ValidationError("Title must be less than 200 characters", "title"),
			};
		}
		return { success: true, data: undefined };
	},

	validateDescription(description: string): Result<void> {
		if (!description || description.trim().length === 0) {
			return {
				success: false,
				error: new ValidationError("Description is required", "description"),
			};
		}
		if (description.length > 2000) {
			return {
				success: false,
				error: new ValidationError("Description must be less than 2000 characters", "description"),
			};
		}
		return { success: true, data: undefined };
	},

	validatePriority(priority: TaskPriority): Result<void> {
		const validPriorities: TaskPriority[] = ["low", "medium", "high"];
		if (!validPriorities.includes(priority)) {
			return {
				success: false,
				error: new ValidationError("Invalid priority", "priority"),
			};
		}
		return { success: true, data: undefined };
	},

	validateStatus(status: TaskStatus): Result<void> {
		const validStatuses: TaskStatus[] = ["todo", "in-progress", "done"];
		if (!validStatuses.includes(status)) {
			return {
				success: false,
				error: new ValidationError("Invalid status", "status"),
			};
		}
		return { success: true, data: undefined };
	},

	validateDependencies(dependencies: string[]): Result<void> {
		if (dependencies.some((dep) => !dep || dep.trim().length === 0)) {
			return {
				success: false,
				error: new ValidationError("Dependencies cannot be empty strings", "dependencies"),
			};
		}
		return { success: true, data: undefined };
	},

	validateCreateInput(input: CreateTaskInputWithPriority & { type?: TaskType }): Result<void> {
		const titleResult = TaskDomainRules.validateTitle(input.title);
		if (!titleResult.success) return titleResult;

		const descriptionResult = TaskDomainRules.validateDescription(input.description);
		if (!descriptionResult.success) return descriptionResult;

		const priorityResult = TaskDomainRules.validatePriority(input.priority || "medium");
		if (!priorityResult.success) return priorityResult;

		const dependenciesResult = TaskDomainRules.validateDependencies(input.dependencies || []);
		if (!dependenciesResult.success) return dependenciesResult;

		return { success: true, data: undefined };
	},

	validateUpdateInput(input: UpdateTaskInput): Result<void> {
		if (input.title !== undefined) {
			const titleResult = TaskDomainRules.validateTitle(input.title);
			if (!titleResult.success) return titleResult;
		}

		if (input.description !== undefined) {
			const descriptionResult = TaskDomainRules.validateDescription(input.description);
			if (!descriptionResult.success) return descriptionResult;
		}

		if (input.status !== undefined) {
			const statusResult = TaskDomainRules.validateStatus(input.status);
			if (!statusResult.success) return statusResult;
		}

		return { success: true, data: undefined };
	},

	canTransitionStatus(from: TaskStatus, to: TaskStatus): boolean {
		const validTransitions: Record<TaskStatus, TaskStatus[]> = {
			todo: ["in-progress", "done"],
			"in-progress": ["done", "todo"],
			done: ["todo", "in-progress"],
		};
		return validTransitions[from].includes(to);
	},

	hasCircularDependency(_taskId: string, dependencies: string[], allTasks: TaskEntity[]): boolean {
		const visited = new Set<string>();
		const recursionStack = new Set<string>();

		const hasCycle = (currentId: string): boolean => {
			if (recursionStack.has(currentId)) {
				return true; // Cycle detected
			}
			if (visited.has(currentId)) {
				return false; // Already processed
			}

			visited.add(currentId);
			recursionStack.add(currentId);

			const currentTask = allTasks.find((t) => t.id === currentId);
			if (currentTask) {
				for (const depId of currentTask.dependencies) {
					if (hasCycle(depId)) {
						return true;
					}
				}
			}

			recursionStack.delete(currentId);
			return false;
		};

		// Check if adding these dependencies creates a cycle
		for (const depId of dependencies) {
			if (hasCycle(depId)) {
				return true;
			}
		}

		return false;
	},

	getPriorityWeight(priority: TaskPriority): number {
		const weights: Record<TaskPriority, number> = {
			low: 1,
			medium: 2,
			high: 3,
		};
		return weights[priority];
	},

	sortTasksByPriorityAndDependencies(tasks: TaskEntity[]): TaskEntity[] {
		// First, sort by priority (high to low)
		const sortedByPriority = [...tasks].sort(
			(a, b) =>
				TaskDomainRules.getPriorityWeight(b.priority) -
				TaskDomainRules.getPriorityWeight(a.priority),
		);

		// Then apply topological sort for dependencies
		return TaskDomainRules.topologicalSort(sortedByPriority);
	},

	topologicalSort(tasks: TaskEntity[]): TaskEntity[] {
		const taskMap = new Map(tasks.map((t) => [t.id, t]));
		const inDegree = new Map<string, number>();
		const adjList = new Map<string, string[]>();

		// Initialize data structures
		for (const task of tasks) {
			inDegree.set(task.id, 0);
			adjList.set(task.id, []);
		}

		// Build adjacency list and calculate in-degrees
		for (const task of tasks) {
			for (const depId of task.dependencies) {
				if (taskMap.has(depId)) {
					adjList.get(depId)?.push(task.id);
					inDegree.set(task.id, (inDegree.get(task.id) || 0) + 1);
				}
			}
		}

		// Queue for tasks with no dependencies
		const queue: string[] = [];
		for (const [taskId, degree] of inDegree) {
			if (degree === 0) {
				queue.push(taskId);
			}
		}

		const result: TaskEntity[] = [];
		while (queue.length > 0) {
			const currentId = queue.shift();
			if (!currentId) {
				continue;
			}
			const currentTask = taskMap.get(currentId);
			if (!currentTask) {
				continue;
			}
			result.push(currentTask);

			// Process neighbors
			for (const neighborId of adjList.get(currentId) || []) {
				const newDegree = (inDegree.get(neighborId) || 0) - 1;
				inDegree.set(neighborId, newDegree);
				if (newDegree === 0) {
					queue.push(neighborId);
				}
			}
		}

		// Check for circular dependencies
		if (result.length !== tasks.length) {
			throw new Error("Circular dependency detected in tasks");
		}

		return result;
	},
};

/**
 * Task factory for creating task entities
 */
export const TaskFactory = {
	create(input: CreateTaskInputWithPriority, createdBy: string): Result<TaskEntity> {
		const validation = TaskDomainRules.validateCreateInput(input);
		if (!validation.success) {
			return { success: false, error: validation.error };
		}

		const now = new Date();
		const task: TaskEntity = {
			id: `task-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
			title: input.title.trim(),
			description: input.description.trim(),
			status: "todo",
			priority: input.priority || "medium",
			type: (input as { type?: TaskType }).type || "task",
			dependencies: input.dependencies || [],
			createdBy,
			...(input.assignedTo && { assignedTo: input.assignedTo }),
			...(input.collaborators && { collaborators: input.collaborators }),
			...(input.watchers && { watchers: input.watchers }),
			createdAt: now,
			updatedAt: now,
		};

		return { success: true, data: task };
	},

	update(task: TaskEntity, input: UpdateTaskInput): Result<TaskEntity> {
		const validation = TaskDomainRules.validateUpdateInput(input);
		if (!validation.success) {
			return { success: false, error: validation.error };
		}

		const updatedTask: TaskEntity = {
			...task,
			updatedAt: new Date(),
		};

		if (input.title !== undefined) {
			updatedTask.title = input.title.trim();
		}
		if (input.description !== undefined) {
			updatedTask.description = input.description.trim();
		}
		if (input.status !== undefined) {
			// Validate status transition
			if (!TaskDomainRules.canTransitionStatus(task.status, input.status)) {
				return {
					success: false,
					error: new ValidationError(
						`Cannot transition from ${task.status} to ${input.status}`,
						"status",
					),
				};
			}
			updatedTask.status = input.status;
		}
		if (input.assignedTo !== undefined) {
			updatedTask.assignedTo = input.assignedTo;
		}
		if (input.collaborators !== undefined) {
			updatedTask.collaborators = input.collaborators;
		}
		if (input.watchers !== undefined) {
			updatedTask.watchers = input.watchers;
		}

		return { success: true, data: updatedTask };
	},
};
