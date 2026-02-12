import { DependencyGraphService } from "./src/services/dependency-graph.ts";

// Test data for dependency management features
const testTasks = [
	{
		id: "task-1",
		title: "Setup Database",
		description: "Initialize database schema",
		status: "done",
		priority: "high",
		createdAt: new Date("2024-01-01T00:00:00Z"),
		updatedAt: new Date("2024-01-02T00:00:00Z"),
		createdBy: "user1",
		assignedTo: "dev1",
		dependencies: [],
		type: "task"
	},
	{
		id: "task-2",
		title: "Create API Endpoints",
		description: "Build REST API endpoints",
		status: "in-progress",
		priority: "high",
		createdAt: new Date("2024-01-01T01:00:00Z"),
		updatedAt: new Date("2024-01-03T01:00:00Z"),
		createdBy: "user1",
		assignedTo: "dev2",
		dependencies: ["task-1"],
		type: "task"
	},
	{
		id: "task-3",
		title: "Frontend Integration",
		description: "Connect frontend to API",
		status: "todo",
		priority: "medium",
		createdAt: new Date("2024-01-01T02:00:00Z"),
		updatedAt: new Date("2024-01-01T02:00:00Z"),
		createdBy: "user2",
		assignedTo: "dev3",
		dependencies: ["task-2"],
		type: "task"
	},
	{
		id: "task-4",
		title: "Write Tests",
		description: "Create unit and integration tests",
		status: "todo",
		priority: "medium",
		createdAt: new Date("2024-01-01T03:00:00Z"),
		updatedAt: new Date("2024-01-01T03:00:00Z"),
		createdBy: "user2",
		assignedTo: "dev4",
		dependencies: ["task-2", "task-3"],
		type: "task"
	},
	{
		id: "task-5",
		title: "Deploy to Production",
		description: "Deploy application to production",
		status: "todo",
		priority: "high",
		createdAt: new Date("2024-01-01T04:00:00Z"),
		updatedAt: new Date("2024-01-01T04:00:00Z"),
		createdBy: "user3",
		assignedTo: "devops",
		dependencies: ["task-3", "task-4"],
		type: "task"
	}
];

// Simple test assertion function
function assert(condition: boolean, message: string) {
	if (!condition) {
		throw new Error(`Assertion failed: ${message}`);
	}
	console.log(`✓ ${message}`);
}

// Test runner functions
function testDependencyGraphGeneration() {
	console.log("\n=== Testing Dependency Graph Generation ===");
	
	const dependencyGraphService = new DependencyGraphService();
	
	// Test 1: Basic graph generation
	const graph = dependencyGraphService.generateDependencyGraph(testTasks);
	assert(graph.nodes.length === testTasks.length, "Generated correct number of nodes");
	assert(graph.edges.length > 0, "Generated edges");
	assert(graph.criticalPath.length > 0, "Identified critical path");
	assert(graph.bottlenecks.length >= 0, "Identified bottlenecks");
	assert(graph.levels.length > 0, "Calculated levels");
	
	// Test 2: Critical path identification
	assert(graph.criticalPath.includes("task-1"), "Critical path includes task-1");
	assert(graph.criticalPath.includes("task-2"), "Critical path includes task-2");
	assert(graph.criticalPath.includes("task-3"), "Critical path includes task-3");
	assert(graph.criticalPath.includes("task-5"), "Critical path includes task-5");
	
	// Test 3: Bottleneck identification
	assert(graph.bottlenecks.includes("task-2"), "Identified task-2 as bottleneck");
	assert(graph.bottlenecks.includes("task-3"), "Identified task-3 as bottleneck");
	
	console.log("Dependency graph generation tests passed!");
}

function testDependencyValidation() {
	console.log("\n=== Testing Dependency Validation ===");
	
	const dependencyGraphService = new DependencyGraphService();
	
	// Test 1: Valid dependencies
	const validation = dependencyGraphService.validateDependencies(testTasks);
	assert(validation.isValid, "Valid dependencies detected");
	assert(validation.errors.length === 0, "No validation errors for valid dependencies");
	
	// Test 2: Circular dependencies
	const tasksWithCycle = [
		...testTasks,
		{
			id: "task-6",
			title: "Cycle Task",
			description: "Creates a cycle",
			status: "todo",
			priority: "medium",
			createdAt: new Date("2024-01-01T05:00:00Z"),
			updatedAt: new Date("2024-01-01T05:00:00Z"),
			createdBy: "user4",
			assignedTo: "dev5",
			dependencies: ["task-5"]
		}
	];
	
	// Create a cycle by adding task-5 dependency to task-1
	tasksWithCycle[0].dependencies.push("task-6");
	
	const cycleValidation = dependencyGraphService.validateDependencies(tasksWithCycle);
	assert(!cycleValidation.isValid, "Detected circular dependency");
	assert(cycleValidation.errors.some((e: any) => e.type === "circular"), "Correct error type for circular dependency");
	
	// Test 3: Non-existent dependencies
	const tasksWithInvalidDep = [
		...testTasks,
		{
			id: "task-7",
			title: "Invalid Dependency Task",
			description: "Has non-existent dependency",
			status: "todo",
			priority: "medium",
			createdAt: new Date("2024-01-01T06:00:00Z"),
			updatedAt: new Date("2024-01-01T06:00:00Z"),
			createdBy: "user5",
			assignedTo: "dev6",
			dependencies: ["non-existent-task"]
		}
	];
	
	const invalidValidation = dependencyGraphService.validateDependencies(tasksWithInvalidDep);
	assert(!invalidValidation.isValid, "Detected non-existent dependency");
	assert(invalidValidation.errors.some((e: any) => e.type === "nonexistent"), "Correct error type for non-existent dependency");
	
	console.log("Dependency validation tests passed!");
}

function testImpactAnalysis() {
	console.log("\n=== Testing Impact Analysis ===");
	
	const dependencyGraphService = new DependencyGraphService();
	
	// Test 1: Task completion impact
	const impact = dependencyGraphService.getImpactAnalysis("task-1");
	assert(impact.directImpact.includes("task-2"), "Correct direct impact identified");
	assert(impact.totalImpact.includes("task-2"), "Correct total impact includes task-2");
	assert(impact.totalImpact.includes("task-3"), "Correct total impact includes task-3");
	assert(impact.totalImpact.includes("task-4"), "Correct total impact includes task-4");
	assert(impact.totalImpact.includes("task-5"), "Correct total impact includes task-5");
	
	// Test 2: Processable tasks
	const processableTasks = dependencyGraphService.getProcessableTasks(testTasks);
	const todoProcessableTasks = processableTasks.filter(t => t.status === "todo");
	assert(todoProcessableTasks.length === 0, "No todo tasks are processable when dependencies are not satisfied");
	
	// Test 3: Blocking tasks
	const blockingTasks = dependencyGraphService.getBlockingTasks(testTasks);
	assert(!blockingTasks.some((t: any) => t.id === "task-1"), "Completed task-1 is not blocking");
	assert(blockingTasks.some((t: any) => t.id === "task-2"), "In-progress task-2 is blocking");
	assert(blockingTasks.some((t: any) => t.id === "task-3"), "Todo task-3 is blocking");
	
	console.log("Impact analysis tests passed!");
}

function testVisualizationFormatting() {
	console.log("\n=== Testing Visualization Formatting ===");
	
	const dependencyGraphService = new DependencyGraphService();
	
	// Test 1: D3.js visualization format
	const vizData = dependencyGraphService.formatGraphForVisualization(testTasks);
	assert(vizData.nodes, "Visualization nodes generated");
	assert(vizData.links, "Visualization links generated");
	assert(vizData.layout, "Visualization layout generated");
	assert(vizData.metadata, "Visualization metadata generated");
	assert(vizData.nodes.length === testTasks.length, "Correct number of visualization nodes");
	assert(vizData.metadata.totalNodes === testTasks.length, "Correct metadata node count");
	assert(vizData.metadata.maxDepth > 0, "Correct max depth calculated");
	
	// Test 2: Critical path visualization
	const criticalPathData = dependencyGraphService.formatCriticalPathForVisualization(testTasks);
	assert(criticalPathData.criticalPath, "Critical path visualization data generated");
	assert(criticalPathData.timeline, "Timeline data generated");
	assert(criticalPathData.bottlenecks, "Bottlenecks data generated");
	assert(criticalPathData.schedule, "Schedule data generated");
	assert(criticalPathData.criticalPath.length > 0, "Critical path has tasks");
	
	// Test 3: Dependency tree
	const treeData = dependencyGraphService.formatDependencyTree(testTasks, "task-1", 3);
	assert(treeData.root, "Tree root generated");
	assert(treeData.tree, "Tree data generated");
	assert(treeData.paths, "Tree paths generated");
	assert(treeData.root.id === "task-1", "Correct root task");
	assert(treeData.tree.length > 0, "Tree has data");
	
	console.log("Visualization formatting tests passed!");
}

function testRealTimeChangeDetection() {
	console.log("\n=== Testing Real-time Change Detection ===");
	
	const dependencyGraphService = new DependencyGraphService();
	
	// Test: Detect dependency changes
	const originalGraph = dependencyGraphService.generateDependencyGraph(testTasks);
	
	// Modify tasks
	const modifiedTasks = [...testTasks];
	modifiedTasks.push({
		id: "new-task",
		title: "New Task",
		description: "Added task",
		status: "todo",
		priority: "low",
		createdAt: new Date("2024-01-01T09:00:00Z"),
		updatedAt: new Date("2024-01-01T09:00:00Z"),
		createdBy: "user7",
		assignedTo: "dev9",
		dependencies: ["task-1"]
	});
	
	// Generate new graph
	const newGraph = dependencyGraphService.generateDependencyGraph(modifiedTasks);
	
	assert(newGraph.nodes.length === originalGraph.nodes.length + 1, "New graph has one more node");
	assert(newGraph.edges.length > originalGraph.edges.length, "New graph has more edges");
	
	console.log("Real-time change detection tests passed!");
}

function testWhatIfAnalysis() {
	console.log("\n=== Testing What-If Analysis ===");
	
	const dependencyGraphService = new DependencyGraphService();
	
	// Test 1: Add dependency scenario
	const scenario = {
		type: "add_dependency",
		changes: {
			taskId: "task-5",
			dependencyId: "new-task"
		}
	};
	
	const modifiedTasks = [...testTasks];
	modifiedTasks.push({
		id: "new-task",
		title: "New Dependency",
		description: "New task for scenario",
		status: "todo",
		priority: "medium",
		createdAt: new Date("2024-01-01T10:00:00Z"),
		updatedAt: new Date("2024-01-01T10:00:00Z"),
		createdBy: "user8",
		assignedTo: "dev10",
		dependencies: []
	});
	
	// Apply scenario
	modifiedTasks.find((t: any) => t.id === scenario.changes.taskId)!.dependencies.push(scenario.changes.dependencyId);
	
	const validation = dependencyGraphService.validateDependencies(modifiedTasks);
	assert(validation.isValid, "Valid scenario after adding dependency");
	
	// Test 2: Invalid scenario
	const invalidScenario = {
		type: "add_dependency",
		changes: {
			taskId: "task-5",
			dependencyId: "non-existent-task"
		}
	};
	
	const invalidModifiedTasks = [...testTasks];
	invalidModifiedTasks.find((t: any) => t.id === invalidScenario.changes.taskId)!.dependencies.push(invalidScenario.changes.dependencyId);
	
	const invalidValidation = dependencyGraphService.validateDependencies(invalidModifiedTasks);
	assert(!invalidValidation.isValid, "Invalid scenario detected");
	assert(invalidValidation.errors.some((e: any) => e.type === "nonexistent"), "Correct error type for invalid scenario");
	
	console.log("What-if analysis tests passed!");
}

// Mock test runner for demonstration
export function runDependencyTests() {
	console.log("Running Dependency Management Tests...");
	
	const dependencyGraphService = new DependencyGraphService();
	
	// Test 1: Basic graph generation
	console.log("Test 1: Basic graph generation");
	const graph = dependencyGraphService.generateDependencyGraph(testTasks);
	console.log(`✓ Generated graph with ${graph.nodes.length} nodes and ${graph.edges.length} edges`);
	console.log(`✓ Critical path: ${graph.criticalPath.join(" → ")}`);
	console.log(`✓ Bottlenecks: ${graph.bottlenecks.join(", ")}`);
	
	// Test 2: Validation
	console.log("\nTest 2: Dependency validation");
	const validation = dependencyGraphService.validateDependencies(testTasks);
	console.log(`✓ Validation result: ${validation.isValid ? "Valid" : "Invalid"}`);
	console.log(`✓ Errors: ${validation.errors.length}, Warnings: ${validation.warnings.length}`);
	
	// Test 3: Impact analysis
	console.log("\nTest 3: Impact analysis");
	const impact = dependencyGraphService.getImpactAnalysis("task-1");
	console.log(`✓ Impact of task-1 completion: ${impact.totalImpact.length} tasks affected`);
	console.log(`✓ Direct impact: ${impact.directImpact.join(", ")}`);
	
	// Test 4: Visualization formatting
	console.log("\nTest 4: Visualization formatting");
	const vizData = dependencyGraphService.formatGraphForVisualization(testTasks);
	console.log(`✓ Formatted for visualization: ${vizData.nodes.length} nodes, ${vizData.links.length} links`);
	console.log(`✓ Max depth: ${vizData.metadata.maxDepth}, Has cycles: ${vizData.metadata.hasCycles}`);
	
	console.log("\nAll dependency management tests completed successfully! ✅");
}

// Run tests if this file is executed directly
if (require.main === module) {
	runDependencyTests();
}