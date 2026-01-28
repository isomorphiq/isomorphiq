import type { Task } from "@isomorphiq/tasks";

export interface DependencyNode {
	id: string;
	title: string;
	status: string;
	priority: string;
	dependencies: string[];
	dependents: string[];
	level: number;
	criticalPath: boolean;
	slack: number;
	earliestStart?: number;
	earliestFinish?: number;
	latestStart?: number;
	latestFinish?: number;
	duration?: number;
}

export interface DependencyEdge {
	from: string;
	to: string;
	critical: boolean;
}

export interface DependencyGraph {
	nodes: DependencyNode[];
	edges: DependencyEdge[];
	cycles: string[][];
	criticalPath: string[];
	bottlenecks: string[];
	levels: DependencyNode[][];
}

export interface CircularDependencyResult {
	hasCycle: boolean;
	cycles: Array<{
		path: string[];
		description: string;
	}>;
	affectedTasks: string[];
}

export interface CriticalPathAnalysis {
	criticalPath: string[];
	totalDuration: number;
	criticalTasks: string[];
	bottlenecks: string[];
	slackTimes: Record<string, number>;
	levels: Array<{
		level: number;
		tasks: string[];
		canStartInParallel: boolean;
	}>;
}

export interface DependencyValidationResult {
	isValid: boolean;
	errors: Array<{
		type: "circular" | "nonexistent" | "self" | "completed";
		message: string;
		taskIds: string[];
	}>;
	warnings: Array<{
		type: "deep_chain" | "many_dependencies";
		message: string;
		taskIds: string[];
	}>;
}

export class DependencyGraphService {
	private taskCache: Map<string, Task> = new Map();
	private adjacencyList: Map<string, Set<string>> = new Map();
	private reverseAdjacencyList: Map<string, Set<string>> = new Map();

	constructor() {
		this.taskCache.clear();
		this.adjacencyList.clear();
		this.reverseAdjacencyList.clear();
	}

	// Update internal cache with new tasks
	updateTaskCache(tasks: Task[]): void {
		this.taskCache.clear();
		this.adjacencyList.clear();
		this.reverseAdjacencyList.clear();

		for (const task of tasks) {
			this.taskCache.set(task.id, task);
			
			// Build adjacency lists
			const deps = new Set(task.dependencies || []);
			this.adjacencyList.set(task.id, deps);
			
			// Build reverse adjacency list (dependents)
			for (const depId of deps) {
				if (!this.reverseAdjacencyList.has(depId)) {
					this.reverseAdjacencyList.set(depId, new Set());
				}
				this.reverseAdjacencyList.get(depId)!.add(task.id);
			}
		}
	}

	// Generate complete dependency graph
	generateDependencyGraph(tasks: Task[]): DependencyGraph {
		this.updateTaskCache(tasks);

		const nodes: DependencyNode[] = [];
		const edges: DependencyEdge[] = [];
		const nodeMap = new Map<string, DependencyNode>();

		// Create nodes
		for (const task of tasks) {
			const node: DependencyNode = {
				id: task.id,
				title: task.title,
				status: task.status,
				priority: task.priority,
				dependencies: task.dependencies || [],
				dependents: this.getDependents(task.id),
				level: 0,
				criticalPath: false,
				slack: 0,
				duration: this.calculateTaskDuration(task)
			};
			nodes.push(node);
			nodeMap.set(task.id, node);
		}

		// Create edges and calculate levels
		for (const node of nodes) {
			for (const depId of node.dependencies) {
				edges.push({
					from: depId,
					to: node.id,
					critical: false
				});
			}
			node.level = this.calculateNodeLevel(node.id, new Set());
		}

		// Detect cycles
		const cycles = this.detectCycles();

		// Calculate critical path
		const criticalPathAnalysis = this.calculateCriticalPath(nodes, edges);
		const criticalPath = criticalPathAnalysis.criticalPath;

		// Mark critical path nodes and edges
		const criticalSet = new Set(criticalPath);
		for (const node of nodes) {
			node.criticalPath = criticalSet.has(node.id);
			node.slack = criticalPathAnalysis.slackTimes[node.id] || 0;
		}
		for (const edge of edges) {
			edge.critical = criticalSet.has(edge.from) && criticalSet.has(edge.to);
		}

		// Group by levels
		const levels = this.groupNodesByLevel(nodes);

		// Identify bottlenecks
		const bottlenecks = this.identifyBottlenecks(nodes);

		return {
			nodes,
			edges,
			cycles,
			criticalPath,
			bottlenecks,
			levels
		};
	}

	// Detect circular dependencies
	detectCircularDependencies(tasks: Task[]): CircularDependencyResult {
		this.updateTaskCache(tasks);
		const cycles = this.detectCycles();
		const affectedTasks = new Set<string>();

		for (const cycle of cycles) {
			for (const taskId of cycle) {
				affectedTasks.add(taskId);
			}
		}

		return {
			hasCycle: cycles.length > 0,
			cycles: cycles.map(cycle => ({
				path: cycle,
				description: this.formatCycleDescription(cycle)
			})),
			affectedTasks: Array.from(affectedTasks)
		};
	}

	// Validate dependencies
	validateDependencies(tasks: Task[]): DependencyValidationResult {
		this.updateTaskCache(tasks);
		const errors: DependencyValidationResult["errors"] = [];
		const warnings: DependencyValidationResult["warnings"] = [];
		const taskIds = new Set(tasks.map(t => t.id));

		// Check for circular dependencies
		const circularResult = this.detectCircularDependencies(tasks);
		if (circularResult.hasCycle) {
			for (const cycle of circularResult.cycles) {
				errors.push({
					type: "circular",
					message: `Circular dependency detected: ${cycle.description}`,
					taskIds: cycle.path
				});
			}
		}

		// Check each task's dependencies
		for (const task of tasks) {
			const deps = task.dependencies || [];

			// Check for self-dependencies
			if (deps.includes(task.id)) {
				errors.push({
					type: "self",
					message: `Task "${task.title}" cannot depend on itself`,
					taskIds: [task.id]
				});
			}

			// Check for non-existent dependencies
			for (const depId of deps) {
				if (!taskIds.has(depId)) {
					errors.push({
						type: "nonexistent",
						message: `Task "${task.title}" depends on non-existent task: ${depId}`,
						taskIds: [task.id, depId]
					});
				}
			}

		

			// Check for deep dependency chains
			const depth = this.calculateDependencyDepth(task.id);
			if (depth > 5) {
				warnings.push({
					type: "deep_chain",
					message: `Task "${task.title}" has a deep dependency chain (${depth} levels)`,
					taskIds: [task.id]
				});
			}

			// Check for too many dependencies
			if (deps.length > 10) {
				warnings.push({
					type: "many_dependencies",
					message: `Task "${task.title}" has many dependencies (${deps.length})`,
					taskIds: [task.id]
				});
			}
		}

		return {
			isValid: errors.length === 0,
			errors,
			warnings
		};
	}

	// Get tasks that can be processed (dependencies satisfied)
	getProcessableTasks(tasks: Task[]): Task[] {
		this.updateTaskCache(tasks);
		
		return tasks.filter(task => {
			if (task.status !== "todo") {
				return false;
			}

			const deps = task.dependencies || [];
			return deps.every(depId => {
				const depTask = this.taskCache.get(depId);
				return depTask && depTask.status === "done";
			});
		});
	}

	// Get tasks blocking other tasks
	getBlockingTasks(tasks: Task[]): Task[] {
		this.updateTaskCache(tasks);
		const blockingTaskIds = new Set<string>();

		for (const task of tasks) {
			if (task.status !== "done") {
				const dependents = this.getDependents(task.id);
				for (const dependentId of dependents) {
					const dependentTask = this.taskCache.get(dependentId);
					if (dependentTask && dependentTask.status === "todo") {
						blockingTaskIds.add(task.id);
						break;
					}
				}
			}
		}

		return Array.from(blockingTaskIds).map(id => this.taskCache.get(id)!).filter(Boolean);
	}

	// Get dependency tree for a specific task
	getDependencyTree(taskId: string, maxDepth: number = 5): any {
		const visited = new Set<string>();
		const buildTree = (id: string, depth: number): any => {
			if (depth > maxDepth || visited.has(id)) {
				return null;
			}
			
			visited.add(id);
			const task = this.taskCache.get(id);
			if (!task) {
				return null;
			}

			const node = {
				id: task.id,
				title: task.title,
				status: task.status,
				priority: task.priority,
				dependencies: []
			};

			for (const depId of task.dependencies || []) {
				const depTree = buildTree(depId, depth + 1);
				if (depTree) {
					node.dependencies.push(depTree);
				}
			}

			return node;
		};

		return buildTree(taskId, 0);
	}

	// Get impact analysis for completing a task
	getImpactAnalysis(taskId: string): {
		directImpact: string[];
		totalImpact: string[];
		criticalPathTasks: string[];
	} {
		this.updateTaskCache(Array.from(this.taskCache.values()));
		
		const directImpact = Array.from(this.getDependents(taskId));
		const totalImpact = new Set<string>();
		
		// Convert tasks to DependencyNode format for critical path analysis
		const tasks = Array.from(this.taskCache.values());
		const dependencyGraph = this.generateDependencyGraph(tasks);
		const criticalPathAnalysis = this.calculateCriticalPath(dependencyGraph.nodes, dependencyGraph.edges);

		// Calculate total impact (recursive)
		const calculateTotalImpact = (id: string) => {
			const dependents = this.getDependents(id);
			for (const dependentId of dependents) {
				totalImpact.add(dependentId);
				calculateTotalImpact(dependentId);
			}
		};

		calculateTotalImpact(taskId);

		return {
			directImpact,
			totalImpact: Array.from(totalImpact),
			criticalPathTasks: criticalPathAnalysis.criticalTasks
		};
	}

	// Bulk update dependencies
	bulkUpdateDependencies(updates: Array<{
		taskId: string;
		dependencies: string[];
	}>): DependencyValidationResult {
		const tempTasks = Array.from(this.taskCache.values()).map(task => {
			const update = updates.find(u => u.taskId === task.id);
			if (update) {
				return { ...task, dependencies: update.dependencies };
			}
			return task;
		});

		return this.validateDependencies(tempTasks);
	}

	// Private helper methods

	private getDependents(taskId: string): string[] {
		return Array.from(this.reverseAdjacencyList.get(taskId) || []);
	}

	private calculateNodeLevel(taskId: string, visited: Set<string>): number {
		if (visited.has(taskId)) {
			return 0; // Prevent infinite recursion in cycles
		}

		visited.add(taskId);
		const dependencies = Array.from(this.adjacencyList.get(taskId) || []);
		
		if (dependencies.length === 0) {
			return 0;
		}

		const maxDepLevel = Math.max(
			...dependencies.map(dep => this.calculateNodeLevel(dep, new Set(visited)))
		);
		
		return maxDepLevel + 1;
	}

	private detectCycles(): string[][] {
		const cycles: string[][] = [];
		const visited = new Set<string>();
		const recursionStack = new Set<string>();
		const path: string[] = [];

		const dfs = (taskId: string): boolean => {
			visited.add(taskId);
			recursionStack.add(taskId);
			path.push(taskId);

			const dependencies = Array.from(this.adjacencyList.get(taskId) || []);
			for (const depId of dependencies) {
				if (!visited.has(depId)) {
					if (dfs(depId)) {
						return true;
					}
				} else if (recursionStack.has(depId)) {
					// Found a cycle
					const cycleStart = path.indexOf(depId);
					const cycle = path.slice(cycleStart);
					cycles.push([...cycle, depId]);
				}
			}

			recursionStack.delete(taskId);
			path.pop();
			return false;
		};

		for (const taskId of this.taskCache.keys()) {
			if (!visited.has(taskId)) {
				dfs(taskId);
			}
		}

		return cycles;
	}

	private formatCycleDescription(cycle: string[]): string {
		const taskNames = cycle.map(id => {
			const task = this.taskCache.get(id);
			return task ? `"${task.title}"` : id;
		});
		return taskNames.join(" → ");
	}

	private calculateCriticalPath(nodes: DependencyNode[], edges: DependencyEdge[]): CriticalPathAnalysis {
		// Simple critical path calculation using longest path
		const durations = new Map<string, number>();
		const earliestStart = new Map<string, number>();
		const earliestFinish = new Map<string, number>();
		const latestStart = new Map<string, number>();
		const latestFinish = new Map<string, number>();

		// Initialize durations
		for (const node of nodes) {
			durations.set(node.id, node.duration || 1);
		}

		// Forward pass - calculate earliest times
		const sortedNodes = nodes.sort((a, b) => a.level - b.level);
		for (const node of sortedNodes) {
			const depDurations = node.dependencies.map(depId => 
				earliestFinish.get(depId) || 0
			);
			earliestStart.set(node.id, Math.max(0, ...depDurations));
			earliestFinish.set(node.id, (earliestStart.get(node.id) || 0) + (durations.get(node.id) || 0));
		}

		// Backward pass - calculate latest times
		const projectFinish = Math.max(...Array.from(earliestFinish.values()));
		for (const node of sortedNodes.reverse()) {
			const dependentFinishes = this.getDependents(node.id).map(depId =>
				latestStart.get(depId) || projectFinish
			);
			
			if (dependentFinishes.length > 0) {
				latestFinish.set(node.id, Math.min(...dependentFinishes));
			} else {
				latestFinish.set(node.id, projectFinish);
			}
			
			latestStart.set(node.id, (latestFinish.get(node.id) || 0) - (durations.get(node.id) || 0));
		}

		// Calculate slack times and identify critical path
		const slackTimes: Record<string, number> = {};
		const criticalTasks: string[] = [];

		for (const node of nodes) {
			const slack = (latestStart.get(node.id) || 0) - (earliestStart.get(node.id) || 0);
			slackTimes[node.id] = slack;
			
			if (Math.abs(slack) < 0.01) { // Floating point tolerance
				criticalTasks.push(node.id);
			}
		}

		// Build critical path
		const criticalPath = criticalTasks.sort((a, b) => {
			const levelA = nodes.find(n => n.id === a)?.level || 0;
			const levelB = nodes.find(n => n.id === b)?.level || 0;
			return levelA - levelB;
		});

		// Calculate levels for parallel execution
		const levels = this.calculateParallelLevels(nodes, earliestStart);

		// Identify bottlenecks (tasks with many dependents on critical path)
		const bottlenecks = criticalTasks.filter(taskId => 
			this.getDependents(taskId).length > 2
		);

		return {
			criticalPath,
			totalDuration: projectFinish,
			criticalTasks,
			bottlenecks,
			slackTimes,
			levels
		};
	}

	private calculateParallelLevels(nodes: DependencyNode[], earliestStart: Map<string, number>): CriticalPathAnalysis["levels"] {
		const startTimes = new Map<string, number>();
		for (const [taskId, startTime] of earliestStart) {
			startTimes.set(taskId, startTime);
		}

		const uniqueStartTimes = Array.from(new Set(startTimes.values())).sort((a, b) => a - b);
		
		return uniqueStartTimes.map((time, index) => ({
			level: index,
			tasks: nodes.filter(n => (earliestStart.get(n.id) || 0) === time).map(n => n.id),
			canStartInParallel: true
		}));
	}

	private groupNodesByLevel(nodes: DependencyNode[]): DependencyNode[][] {
		const levelMap = new Map<number, DependencyNode[]>();
		
		for (const node of nodes) {
			if (!levelMap.has(node.level)) {
				levelMap.set(node.level, []);
			}
			levelMap.get(node.level)!.push(node);
		}

		return Array.from(levelMap.entries())
			.sort(([a], [b]) => a - b)
			.map(([, nodes]) => nodes);
	}

	private identifyBottlenecks(nodes: DependencyNode[]): string[] {
		return nodes
			.filter(node => {
				const dependentCount = node.dependents.length;
				const isHighPriority = node.priority === "high";
				const isNotCompleted = node.status !== "done";
				
				return dependentCount > 2 || (dependentCount > 1 && isHighPriority && isNotCompleted);
			})
			.map(node => node.id);
	}

	private calculateDependencyDepth(taskId: string, visited: Set<string> = new Set()): number {
		if (visited.has(taskId)) {
			return 0;
		}

		visited.add(taskId);
		const task = this.taskCache.get(taskId);
		if (!task || !task.dependencies || task.dependencies.length === 0) {
			return 0;
		}

		const depths = task.dependencies.map(depId => 
			this.calculateDependencyDepth(depId, new Set(visited))
		);

		return Math.max(...depths) + 1;
	}

	private calculateTaskDuration(task: Task): number {
		// Simple duration calculation based on priority and complexity
		// In a real system, this could be based on historical data or estimates
		const priorityMultiplier = {
			high: 3,
			medium: 2,
			low: 1
		};

		const baseDuration = priorityMultiplier[task.priority as keyof typeof priorityMultiplier] || 1;
		
		// Add complexity based on description length (simple heuristic)
		const complexityBonus = Math.min(task.description.length / 500, 2);
		
		return baseDuration + complexityBonus;
	}

	// Visualization data formatting methods

	// Format graph data for D3.js or other visualization libraries
	formatGraphForVisualization(tasks: Task[]): {
		nodes: Array<{
			id: string;
			label: string;
			status: string;
			priority: string;
			level: number;
			x?: number;
			y?: number;
			color: string;
			size: number;
			criticalPath: boolean;
			bottleneck: boolean;
			slack: number;
			dependencies: string[];
			dependents: string[];
		}>;
		links: Array<{
			source: string;
			target: string;
			critical: boolean;
			type: "dependency" | "critical";
			strength: number;
		}>;
		layout: {
			type: "hierarchical" | "force";
			levels: Array<{
				level: number;
				nodes: string[];
				y: number;
			}>;
		};
		metadata: {
			totalNodes: number;
			totalEdges: number;
			maxDepth: number;
			criticalPathLength: number;
			hasCycles: boolean;
		};
	} {
		const graph = this.generateDependencyGraph(tasks);
		
		const nodes = graph.nodes.map((node: DependencyNode) => ({
			id: node.id,
			label: node.title,
			status: node.status,
			priority: node.priority,
			level: node.level,
			color: this.getNodeColor(node),
			size: this.getNodeSize(node),
			criticalPath: node.criticalPath,
			bottleneck: graph.bottlenecks.includes(node.id),
			slack: node.slack,
			dependencies: node.dependencies,
			dependents: node.dependents
		}));

		const links = graph.edges.map(edge => ({
			source: edge.from,
			target: edge.to,
			critical: edge.critical,
			type: edge.critical ? "critical" as const : "dependency" as const,
			strength: edge.critical ? 3 : 1
		}));

		const layout = {
			type: "hierarchical" as const,
			levels: graph.levels.map((level, index) => ({
				level: index,
				nodes: level.map(n => n.id),
				y: index * 150 // Vertical spacing
			}))
		};

		const maxDepth = Math.max(...nodes.map(n => n.level));
		const criticalPathLength = graph.criticalPath.length;

		const metadata = {
			totalNodes: nodes.length,
			totalEdges: links.length,
			maxDepth,
			criticalPathLength,
			hasCycles: graph.cycles.length > 0
		};

		return { nodes, links, layout, metadata };
	}

	// Format dependency tree for hierarchical display
	formatDependencyTree(tasks: Task[], rootTaskId: string, maxDepth: number = 5): {
		root: {
			id: string;
			title: string;
			status: string;
			priority: string;
			level: number;
		};
		tree: Array<{
			id: string;
			title: string;
			status: string;
			priority: string;
			level: number;
			parent: string;
			children: string[];
			expanded: boolean;
			hasChildren: boolean;
		}>;
		paths: Array<{
			from: string;
			to: string;
			type: "parent" | "child" | "sibling";
		}>;
	} {
		this.updateTaskCache(tasks);
		const tree = this.getDependencyTree(rootTaskId, maxDepth);
		const flatTree: any[] = [];
		const paths: any[] = [];

		const flattenTree = (node: any, parent: string = "", level: number = 0) => {
			if (!node) return;
			
			const hasChildren = node.dependencies && node.dependencies.length > 0;
			flatTree.push({
				id: node.id,
				title: node.title,
				status: node.status,
				priority: node.priority,
				level,
				parent,
				children: node.dependencies ? node.dependencies.map((d: any) => d.id) : [],
				expanded: level < 2, // Auto-expand first 2 levels
				hasChildren
			});

			if (parent) {
				paths.push({
					from: parent,
					to: node.id,
					type: "child"
				});
			}

			if (node.dependencies) {
				node.dependencies.forEach((child: any) => {
					flattenTree(child, node.id, level + 1);
				});
			}
		};

		flattenTree(tree);

		const rootTask = this.taskCache.get(rootTaskId);
		const root = rootTask ? {
			id: rootTask.id,
			title: rootTask.title,
			status: rootTask.status,
			priority: rootTask.priority,
			level: 0
		} : flatTree[0];

		return { root, tree: flatTree, paths };
	}

	// Format critical path analysis for visualization
	formatCriticalPathForVisualization(tasks: Task[]): {
		criticalPath: Array<{
			id: string;
			title: string;
			status: string;
			duration: number;
			startTime: number;
			endTime: number;
			slack: number;
		}>;
		timeline: Array<{
			taskId: string;
			start: number;
			end: number;
			level: number;
			critical: boolean;
			label: string;
		}>;
		bottlenecks: Array<{
			taskId: string;
			title: string;
			impact: number;
			dependentsCount: number;
		}>;
		schedule: Array<{
			level: number;
			tasks: string[];
			startTime: number;
			endTime: number;
			parallelCapacity: number;
		}>;
	} {
		const graph = this.generateDependencyGraph(tasks);
		
		const criticalPath = graph.criticalPath.map(taskId => {
			const node = graph.nodes.find(n => n.id === taskId);
			return {
				id: taskId,
				title: node?.title || taskId,
				status: node?.status || "unknown",
				duration: node?.duration || 1,
				startTime: node?.earliestStart || 0,
				endTime: node?.earliestFinish || 1,
				slack: node?.slack || 0
			};
		});

		const timeline = graph.nodes.map(node => ({
			taskId: node.id,
			start: node.earliestStart || 0,
			end: node.earliestFinish || 1,
			level: node.level,
			critical: node.criticalPath,
			label: node.title
		}));

		const bottlenecks = graph.bottlenecks.map(taskId => {
			const node = graph.nodes.find(n => n.id === taskId);
			const impact = node?.dependents.length || 0;
			return {
				taskId,
				title: node?.title || taskId,
				impact,
				dependentsCount: impact
			};
		});

		const schedule = graph.levels.map((level, index) => {
			const tasks = level.map(n => n.id);
			const startTimes = tasks.map(id => graph.nodes.find(n => n.id === id)?.earliestStart || 0);
			const endTimes = tasks.map(id => graph.nodes.find(n => n.id === id)?.earliestFinish || 1);
			
			return {
				level: index,
				tasks,
				startTime: Math.min(...startTimes),
				endTime: Math.max(...endTimes),
				parallelCapacity: tasks.length
			};
		});

		return { criticalPath, timeline, bottlenecks, schedule };
	}

	// Format circular dependencies for visualization
	formatCircularDependencies(tasks: Task[]): {
		cycles: Array<{
			id: string;
			description: string;
			tasks: Array<{
				id: string;
				title: string;
				status: string;
				priority: string;
			}>;
			paths: Array<{
				from: string;
				to: string;
			}>;
			severity: "critical" | "warning" | "info";
			suggestions: string[];
		}>;
		affectedNodes: Array<{
			id: string;
			title: string;
			inCycles: number;
			cycleIds: string[];
		}>;
		impact: {
			totalTasksAffected: number;
			criticalTasksBlocked: number;
			estimatedDelay: number;
		};
	} {
		const circularResult = this.detectCircularDependencies(tasks);
		const cycles: any[] = [];
		const affectedNodesMap = new Map<string, any>();

		circularResult.cycles.forEach((cycle, index) => {
			const cycleId = `cycle_${index}`;
			const cycleTasks = cycle.path.map(taskId => {
				const task = this.taskCache.get(taskId);
				return {
					id: taskId,
					title: task?.title || taskId,
					status: task?.status || "unknown",
					priority: task?.priority || "medium"
				};
			});

			const paths = cycle.path.slice(0, -1).map((taskId, i) => ({
				from: taskId,
				to: cycle.path[i + 1]
			}));

			const severity = this.calculateCycleSeverity(cycleTasks);
			const suggestions = this.generateCycleSuggestions(cycle);

			cycles.push({
				id: cycleId,
				description: cycle.description,
				tasks: cycleTasks,
				paths,
				severity,
				suggestions
			});

			// Track affected nodes
			cycle.path.forEach(taskId => {
				if (!affectedNodesMap.has(taskId)) {
					const task = this.taskCache.get(taskId);
					affectedNodesMap.set(taskId, {
						id: taskId,
						title: task?.title || taskId,
						inCycles: 0,
						cycleIds: []
					});
				}
				const node = affectedNodesMap.get(taskId);
				node.inCycles++;
				node.cycleIds.push(cycleId);
			});
		});

		const affectedNodes = Array.from(affectedNodesMap.values());
		const criticalTasksBlocked = affectedNodes.filter(n => n.priority === "high").length;

		const impact = {
			totalTasksAffected: affectedNodes.length,
			criticalTasksBlocked,
			estimatedDelay: circularResult.cycles.length * 24 // 24 hours per cycle
		};

		return { cycles, affectedNodes, impact };
	}

	// Private helper methods for visualization formatting

	private getNodeColor(node: DependencyNode): string {
		if (node.status === "done") return "#10b981"; // green
		if (node.status === "in-progress") return "#3b82f6"; // blue
		if (node.status === "failed") return "#ef4444"; // red
		if (node.status === "cancelled") return "#6b7280"; // gray
		
		// Color by priority for todo tasks
		if (node.priority === "high") return "#f59e0b"; // amber
		if (node.priority === "medium") return "#8b5cf6"; // purple
		return "#06b6d4"; // cyan for low priority
	}

	private getNodeSize(node: DependencyNode): number {
		let baseSize = 20;
		
		// Larger size for high priority
		if (node.priority === "high") baseSize += 10;
		else if (node.priority === "medium") baseSize += 5;
		
		// Larger size for critical path
		if (node.criticalPath) baseSize += 8;
		
		// Larger size for bottlenecks
		const dependentsCount = node.dependents.length;
		if (dependentsCount > 3) baseSize += Math.min(dependentsCount * 2, 15);
		
		return baseSize;
	}

	private calculateCycleSeverity(cycleTasks: any[]): "critical" | "warning" | "info" {
		const hasHighPriority = cycleTasks.some(t => t.priority === "high");
		const hasInProgress = cycleTasks.some(t => t.status === "in-progress");
		
		if (hasHighPriority || hasInProgress) return "critical";
		if (cycleTasks.some(t => t.status === "todo")) return "warning";
		return "info";
	}

	private generateCycleSuggestions(cycle: any): string[] {
		const suggestions: string[] = [];
		const taskCount = cycle.path.length;
		
		if (taskCount === 2) {
			suggestions.push("Remove the direct dependency between these two tasks");
		} else {
			suggestions.push("Break the cycle by removing one dependency in the chain");
		}
		
		suggestions.push("Consider creating a new parent task to consolidate circular logic");
		suggestions.push("Review if these tasks truly depend on each other or can be parallelized");
		
		return suggestions;
	}

	private clearCache(): void {
		this.taskCache.clear();
		this.adjacencyList.clear();
		this.reverseAdjacencyList.clear();
	}
}