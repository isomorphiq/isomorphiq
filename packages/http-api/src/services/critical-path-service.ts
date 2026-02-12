import type { Task } from "@isomorphiq/tasks";

export interface TaskNode {
	id: string;
	task: Task;
	x: number;
	y: number;
	level: number;
	dependencies: string[];
	dependents: string[];
	isCritical: boolean;
	earliestStart: number;
	earliestFinish: number;
	latestStart: number;
	latestFinish: number;
	slack: number;
}

export interface DependencyLink {
	source: string;
	target: string;
	isCritical: boolean;
}

export interface CriticalPathResult {
	nodes: TaskNode[];
	links: DependencyLink[];
	criticalPath: string[];
	projectDuration: number;
	levels: number;
}

export interface ImpactAnalysis {
	taskId: string;
	delayDays: number;
	affectedTasks: string[];
	criticalPathImpact: boolean;
	newProjectDuration: number;
	delayedTasks: Array<{
		taskId: string;
		delayDays: number;
		newStartDate: Date;
		newEndDate: Date;
	}>;
}

/**
 * Service functions for analyzing task dependencies and critical paths
 */
function calculateCriticalPath(tasks: Task[]): CriticalPathResult {
	// Create task map for quick lookup
	const dependencyMap = new Map<string, string[]>();
	const dependentMap = new Map<string, string[]>();

	// Initialize maps
	for (const task of tasks) {
		dependencyMap.set(task.id, task.dependencies || []);
		dependentMap.set(task.id, []);
	}

	// Build dependent relationships
	for (const task of tasks) {
		for (const depId of task.dependencies || []) {
			if (dependentMap.has(depId)) {
				dependentMap.get(depId)?.push(task.id);
			}
		}
	}

	// Calculate task levels (topological layers)
	const levels = calculateTaskLevels(dependencyMap);

	// Create nodes with positions
		const nodes: TaskNode[] = [];
		const maxLevel = Math.max(...Object.values(levels));

		for (const task of tasks) {
			const level = levels[task.id] || 0;
			const levelTasks = Object.entries(levels).filter((entry) => entry[1] === level);
		const indexInLevel = levelTasks.findIndex(([id]) => id === task.id);
		const tasksInLevel = levelTasks.length;

		// Position nodes in a grid layout
		const x = (indexInLevel + 1) * (800 / (tasksInLevel + 1));
		const y = level * 120 + 100;

		nodes.push({
			id: task.id,
			task,
			x,
			y,
			level,
			dependencies: dependencyMap.get(task.id) || [],
			dependents: dependentMap.get(task.id) || [],
			isCritical: false, // Will be determined later
			earliestStart: 0,
			earliestFinish: 0,
			latestStart: 0,
			latestFinish: 0,
			slack: 0,
		});
	}

	// Forward pass - calculate earliest start and finish times
	forwardPass(nodes);

	// Backward pass - calculate latest start and finish times
	backwardPass(nodes);

	// Calculate slack and identify critical path
	const projectDuration = Math.max(...nodes.map((n) => n.earliestFinish));
	calculateSlack(nodes);

	// Identify critical path
	const criticalPath = identifyCriticalPath(nodes);

	// Mark critical nodes and links
	const criticalPathSet = new Set(criticalPath);
	nodes.forEach((node) => {
		node.isCritical = criticalPathSet.has(node.id);
	});

	// Create links
	const links: DependencyLink[] = [];
	for (const node of nodes) {
		for (const depId of node.dependencies) {
			links.push({
				source: depId,
				target: node.id,
				isCritical: criticalPathSet.has(depId) && criticalPathSet.has(node.id),
			});
		}
	}

	return {
		nodes,
		links,
		criticalPath,
		projectDuration,
		levels: maxLevel + 1,
	};
}

function calculateTaskLevels(dependencyMap: Map<string, string[]>): Record<string, number> {
	const levels: Record<string, number> = {};
	const visited = new Set<string>();

	const calculateLevel = (taskId: string): number => {
		if (visited.has(taskId)) {
			return levels[taskId] || 0;
		}

		visited.add(taskId);
		const dependencies = dependencyMap.get(taskId) || [];

		if (dependencies.length === 0) {
			levels[taskId] = 0;
			return 0;
		}

		const maxDepLevel = Math.max(...dependencies.map((depId) => calculateLevel(depId)));
		levels[taskId] = maxDepLevel + 1;
		return levels[taskId] + 1;
	};

	for (const taskId of dependencyMap.keys()) {
		calculateLevel(taskId);
	}

	return levels;
}

function forwardPass(nodes: TaskNode[]): void {
	const nodeMap = new Map(nodes.map((n) => [n.id, n]));

	// Sort nodes by level (topological order)
	const sortedNodes = [...nodes].sort((a, b) => a.level - b.level);

	for (const node of sortedNodes) {
		if (node.dependencies.length === 0) {
			node.earliestStart = 0;
		} else {
			const maxFinishTime = Math.max(
				...node.dependencies.map((depId) => nodeMap.get(depId)?.earliestFinish || 0),
			);
			node.earliestStart = maxFinishTime;
		}

		// Estimate duration based on task priority and complexity
		const duration = estimateTaskDuration(node.task);
		node.earliestFinish = node.earliestStart + duration;
	}
}

function backwardPass(nodes: TaskNode[]): void {
	const nodeMap = new Map(nodes.map((n) => [n.id, n]));
	const projectDuration = Math.max(...nodes.map((n) => n.earliestFinish));

	// Sort nodes by level in reverse order
	const sortedNodes = [...nodes].sort((a, b) => b.level - a.level);

	for (const node of sortedNodes) {
		if (node.dependents.length === 0) {
			node.latestFinish = projectDuration;
		} else {
			const minStartTime = Math.min(
				...node.dependents.map((depId) => nodeMap.get(depId)?.latestStart || projectDuration),
			);
			node.latestFinish = minStartTime;
		}

		const duration = estimateTaskDuration(node.task);
		node.latestStart = node.latestFinish - duration;
	}
}

function calculateSlack(nodes: TaskNode[]): void {
	for (const node of nodes) {
		node.slack = node.latestStart - node.earliestStart;
	}
}

function identifyCriticalPath(nodes: TaskNode[]): string[] {
	// Find tasks with zero slack (critical tasks)
	const criticalTasks = nodes.filter((node) => node.slack <= 0.1); // Small tolerance for floating point

	if (criticalTasks.length === 0) {
		return [];
	}

	// Build the critical path by following dependencies
	const startTasks = criticalTasks.filter(
		(task) =>
			task.dependencies.length === 0 ||
			!task.dependencies.some((depId) => criticalTasks.some((ct) => ct.id === depId)),
	);

	const endTasks = criticalTasks.filter(
		(task) =>
			task.dependents.length === 0 ||
			!task.dependents.some((depId) => criticalTasks.some((ct) => ct.id === depId)),
	);

	if (startTasks.length === 0 || endTasks.length === 0) {
		return criticalTasks.map((task) => task.id);
	}

	// Find the longest path through critical tasks
	const nodeMap = new Map(criticalTasks.map((n) => [n.id, n]));
	let longestPath: string[] = [];
	let maxDuration = 0;

	const findPath = (taskId: string, currentPath: string[], currentDuration: number): void => {
		const currentPathNew = [...currentPath, taskId];
		const node = nodeMap.get(taskId);

		if (!node) return;

		const newDuration = currentDuration + estimateTaskDuration(node.task);

		// Check if this is an end task
		if (endTasks.some((et) => et.id === taskId)) {
			if (newDuration > maxDuration) {
				maxDuration = newDuration;
				longestPath = currentPathNew;
			}
			return;
		}

		// Continue through critical dependents
		for (const depId of node.dependents) {
			if (nodeMap.has(depId)) {
				findPath(depId, currentPathNew, newDuration);
			}
		}
	};

	for (const startTask of startTasks) {
		findPath(startTask.id, [], 0);
	}

	return longestPath;
}

function estimateTaskDuration(task: Task): number {
	// Base duration in days
	let baseDuration = 1;

	// Adjust based on task type
	switch (task.type) {
		case "theme":
			baseDuration = 6;
			break;
		case "initiative":
			baseDuration = 5;
			break;
		case "feature":
			baseDuration = 5;
			break;
		case "story":
			baseDuration = 3;
			break;
		case "implementation":
		case "task":
			baseDuration = 1;
			break;
		case "integration":
		case "testing":
			baseDuration = 2;
			break;
		case "research":
			baseDuration = 4;
			break;
		default:
			baseDuration = 1;
			break;
	}

	// Adjust based on priority
	switch (task.priority) {
		case "high":
			baseDuration *= 0.8; // High priority tasks are often faster
			break;
		case "low":
			baseDuration *= 1.5; // Low priority tasks take longer
			break;
		default:
			break;
	}

	// Adjust based on status
	if (task.status === "done") {
		baseDuration = 0.1; // Completed tasks have minimal remaining duration
	} else if (task.status === "in-progress") {
		baseDuration *= 0.5; // In-progress tasks are partially done
	}

	return Math.max(0.1, baseDuration);
}

function analyzeDelayImpact(tasks: Task[], taskId: string, delayDays: number): ImpactAnalysis {
	const criticalPathResult = calculateCriticalPath(tasks);
	const nodeMap = new Map(criticalPathResult.nodes.map((n) => [n.id, n]));
	const targetNode = nodeMap.get(taskId);

	if (!targetNode) {
		throw new Error(`Task ${taskId} not found`);
	}

	// Find all affected tasks (dependents transitively)
	const affectedTasks = new Set<string>();
	const findAffectedTasks = (currentTaskId: string): void => {
		const node = nodeMap.get(currentTaskId);
		if (!node) return;

		for (const dependentId of node.dependents) {
			if (!affectedTasks.has(dependentId)) {
				affectedTasks.add(dependentId);
				findAffectedTasks(dependentId);
			}
		}
	};

	findAffectedTasks(taskId);

	// Check if this affects the critical path
	const criticalPathImpact =
		targetNode.isCritical ||
		Array.from(affectedTasks).some((taskKey) => nodeMap.get(taskKey)?.isCritical);

	// Calculate new project duration
	let newProjectDuration = criticalPathResult.projectDuration;
	if (criticalPathImpact) {
		newProjectDuration += delayDays;
	}

	// Calculate delayed tasks with new dates
	const delayedTasks: Array<{
		taskId: string;
		delayDays: number;
		newStartDate: Date;
		newEndDate: Date;
	}> = [];

	const now = new Date();
	for (const affectedTaskId of affectedTasks) {
		const node = nodeMap.get(affectedTaskId);
		if (!node) continue;

		const taskDelay = criticalPathImpact ? delayDays : 0;
		const originalStart = new Date(now.getTime() + node.earliestStart * 24 * 60 * 60 * 1000);
		const originalEnd = new Date(now.getTime() + node.earliestFinish * 24 * 60 * 60 * 1000);

		delayedTasks.push({
			taskId: affectedTaskId,
			delayDays: taskDelay,
			newStartDate: new Date(originalStart.getTime() + taskDelay * 24 * 60 * 60 * 1000),
			newEndDate: new Date(originalEnd.getTime() + taskDelay * 24 * 60 * 60 * 1000),
		});
	}

	return {
		taskId,
		delayDays,
		affectedTasks: Array.from(affectedTasks),
		criticalPathImpact,
		newProjectDuration,
		delayedTasks,
	};
}

function getAvailableTasks(tasks: Task[]): Task[] {
	const taskMap = new Map(tasks.map((task) => [task.id, task]));

	return tasks.filter((task) => {
		// Skip completed tasks
		if (task.status === "done") return false;

		// Check if all dependencies are completed
		return (task.dependencies || []).every((depId) => {
			const depTask = taskMap.get(depId);
			return depTask !== undefined && depTask.status === "done";
		});
	});
}

function getBlockingTasks(tasks: Task[]): Task[] {
	const taskMap = new Map(tasks.map((task) => [task.id, task]));
	const blockingTasks = new Set<string>();

	for (const task of tasks) {
		if (task.status !== "done") {
			for (const depId of task.dependencies || []) {
				const depTask = taskMap.get(depId);
				if (depTask && depTask.status !== "done") {
					blockingTasks.add(depId);
				}
			}
		}
	}

	return Array.from(blockingTasks)
		.map((id) => taskMap.get(id))
		.filter((task): task is Task => Boolean(task));
}

export const CriticalPathService = {
	calculateCriticalPath,
	analyzeDelayImpact,
	getAvailableTasks,
	getBlockingTasks,
};
