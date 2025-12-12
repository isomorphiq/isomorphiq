import type { Task } from "./types.ts";

export interface DependencyCycle {
	tasks: string[];
	taskTitles: string[];
	length: number;
}

export interface DependencyValidationResult {
	isValid: boolean;
	error?: string;
	cycles?: DependencyCycle[];
	invalidDependencies?: Array<{
		taskId: string;
		dependencyId: string;
		reason: string;
	}>;
	warnings?: string[];
}

export interface DependencyAnalysis {
	totalTasks: number;
	tasksWithDependencies: number;
	maxDependencyDepth: number;
	independentTasks: string[];
	criticalPath?: string[];
	cycles: DependencyCycle[];
}

export class DependencyValidator {
	private taskMap: Map<string, Task> = new Map();

	constructor(tasks: Task[]) {
		this.buildTaskMap(tasks);
	}

	private buildTaskMap(tasks: Task[]): void {
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
				// Found a cycle - extract the cycle path
				const cycleStart = path.indexOf(taskId);
				const cycleTasks = path.slice(cycleStart);
				cycleTasks.push(taskId); // Complete the cycle

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
	private validateDependencyReferences(): Array<{
		taskId: string;
		dependencyId: string;
		reason: string;
	}> {
		const invalidDependencies: Array<{
			taskId: string;
			dependencyId: string;
			reason: string;
		}> = [];

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
	 * Generates warnings for potential dependency issues
	 */
	private generateWarnings(): string[] {
		const warnings: string[] = [];

		// Check for tasks with too many dependencies
		for (const task of this.taskMap.values()) {
			if (task.dependencies.length > 5) {
				warnings.push(
					`Task "${task.title}" has ${task.dependencies.length} dependencies - consider breaking it down`,
				);
			}
		}

		// Check for deep dependency chains
		const maxDepth = this.getMaxDependencyDepth();
		if (maxDepth > 10) {
			warnings.push(
				`Maximum dependency depth is ${maxDepth} - consider flattening the dependency structure`,
			);
		}

		return warnings;
	}

	/**
	 * Calculates the maximum dependency depth in the task graph
	 */
	getMaxDependencyDepth(): number {
		let maxDepth = 0;

		const calculateDepth = (taskId: string, visited: Set<string>): number => {
			if (visited.has(taskId)) {
				return 0; // Circular reference, but we've already reported it
			}

			visited.add(taskId);
			const task = this.taskMap.get(taskId);

			if (!task || task.dependencies.length === 0) {
				return 1;
			}

			let maxChildDepth = 0;
			for (const depId of task.dependencies) {
				const childDepth = calculateDepth(depId, new Set(visited));
				maxChildDepth = Math.max(maxChildDepth, childDepth);
			}

			return 1 + maxChildDepth;
		};

		for (const taskId of this.taskMap.keys()) {
			const depth = calculateDepth(taskId, new Set());
			maxDepth = Math.max(maxDepth, depth);
		}

		return maxDepth;
	}

	/**
	 * Performs comprehensive dependency analysis
	 */
	analyzeDependencies(): DependencyAnalysis {
		const cycles = this.detectCycles();
		const independentTasks = Array.from(this.taskMap.keys()).filter((taskId) => {
			const task = this.taskMap.get(taskId);
			return task && task.dependencies.length === 0;
		});

		const tasksWithDependencies = Array.from(this.taskMap.values()).filter(
			(task) => task.dependencies.length > 0,
		).length;

		const maxDepth = this.getMaxDependencyDepth();

		return {
			totalTasks: this.taskMap.size,
			tasksWithDependencies,
			maxDependencyDepth: maxDepth,
			independentTasks,
			cycles,
		};
	}

	/**
	 * Gets the critical path (longest dependency chain) in the task graph
	 */
	getCriticalPath(): string[] {
		let criticalPath: string[] = [];
		let maxLength = 0;

		const findLongestPath = (taskId: string, currentPath: string[], visited: Set<string>): void => {
			if (visited.has(taskId)) {
				return; // Circular reference
			}

			const newPath = [...currentPath, taskId];

			const task = this.taskMap.get(taskId);
			if (!task || task.dependencies.length === 0) {
				if (newPath.length > maxLength) {
					maxLength = newPath.length;
					criticalPath = newPath;
				}
				return;
			}

			visited.add(taskId);
			for (const depId of task.dependencies) {
				findLongestPath(depId, newPath, new Set(visited));
			}
		};

		for (const taskId of this.taskMap.keys()) {
			findLongestPath(taskId, [], new Set());
		}

		return criticalPath;
	}

	/**
	 * Checks if adding a new dependency would create a cycle
	 */
	wouldCreateCycle(taskId: string, newDependencyId: string): boolean {
		if (taskId === newDependencyId) {
			return true; // Self-dependency
		}

		const visited = new Set<string>();

		const dfs = (currentId: string): boolean => {
			if (currentId === newDependencyId) {
				return true; // Found path from taskId to newDependencyId
			}

			if (visited.has(currentId)) {
				return false;
			}

			visited.add(currentId);
			const task = this.taskMap.get(currentId);

			if (task) {
				for (const depId of task.dependencies) {
					if (dfs(depId)) {
						return true;
					}
				}
			}

			return false;
		};

		return dfs(taskId);
	}

	/**
	 * Gets all tasks that depend on a given task (reverse dependencies)
	 */
	getDependents(taskId: string): string[] {
		const dependents: string[] = [];

		for (const [id, task] of this.taskMap) {
			if (task.dependencies.includes(taskId)) {
				dependents.push(id);
			}
		}

		return dependents;
	}

	/**
	 * Gets the full dependency chain for a task (transitive dependencies)
	 */
	getDependencyChain(taskId: string): string[] {
		const chain: string[] = [];
		const visited = new Set<string>();

		const collectDependencies = (id: string): void => {
			if (visited.has(id)) {
				return;
			}

			visited.add(id);
			const task = this.taskMap.get(id);

			if (task) {
				for (const depId of task.dependencies) {
					chain.push(depId);
					collectDependencies(depId);
				}
			}
		};

		collectDependencies(taskId);
		return [...new Set(chain)]; // Remove duplicates
	}
}
