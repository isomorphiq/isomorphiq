import { DependencyGraphService } from "./src/services/dependency-graph.ts";

// Simple test runner for dependency management features
class DependencyManagementTester {
	private dependencyGraphService: DependencyGraphService;

	constructor() {
		this.dependencyGraphService = new DependencyGraphService();
	}

	// Test data for dependency management features
	private getTestTasks() {
		return [
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
				type: "task" as any
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
				type: "task" as any
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
				type: "task" as any
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
				type: "task" as any
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
				type: "task" as any
			}
		];
	}

	// Simple assertion function
	private assert(condition: boolean, message: string): void {
		if (!condition) {
			throw new Error(`Assertion failed: ${message}`);
		}
		console.log(`✓ ${message}`);
	}

	testDependencyGraphGeneration(): void {
		console.log("\n=== Testing Dependency Graph Generation ===");
		
		const testTasks = this.getTestTasks();
		
		// Test 1: Basic graph generation
		const graph = this.dependencyGraphService.generateDependencyGraph(testTasks);
		this.assert(graph.nodes.length === testTasks.length, "Generated correct number of nodes");
		this.assert(graph.edges.length > 0, "Generated edges");
		this.assert(graph.criticalPath.length > 0, "Identified critical path");
		this.assert(graph.bottlenecks.length >= 0, "Identified bottlenecks");
		this.assert(graph.levels.length > 0, "Calculated levels");
		
		// Test 2: Critical path identification
		this.assert(graph.criticalPath.includes("task-1"), "Critical path includes task-1");
		this.assert(graph.criticalPath.includes("task-2"), "Critical path includes task-2");
		this.assert(graph.criticalPath.includes("task-3"), "Critical path includes task-3");
		this.assert(graph.criticalPath.includes("task-5"), "Critical path includes task-5");
		
		// Test 3: Bottleneck identification
		this.assert(graph.bottlenecks.includes("task-2"), "Identified task-2 as bottleneck");
		this.assert(graph.bottlenecks.includes("task-3"), "Identified task-3 as bottleneck");
		
		console.log("Dependency graph generation tests passed!");
	}

	testDependencyValidation(): void {
		console.log("\n=== Testing Dependency Validation ===");
		
		const testTasks = this.getTestTasks();
		
		// Test 1: Valid dependencies
		const validation = this.dependencyGraphService.validateDependencies(testTasks);
		this.assert(validation.isValid, "Valid dependencies detected");
		this.assert(validation.errors.length === 0, "No validation errors for valid dependencies");
		
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
				dependencies: ["task-5"],
				type: "task" as any
			}
		];
		
		// Create a cycle by adding task-5 dependency to task-1
		tasksWithCycle[0].dependencies.push("task-6");
		
		const cycleValidation = this.dependencyGraphService.validateDependencies(tasksWithCycle);
		this.assert(!cycleValidation.isValid, "Detected circular dependency");
		this.assert(cycleValidation.errors.some((e: any) => e.type === "circular"), "Correct error type for circular dependency");
		
		console.log("Dependency validation tests passed!");
	}

	testImpactAnalysis(): void {
		console.log("\n=== Testing Impact Analysis ===");
		
		const testTasks = this.getTestTasks();
		
		// Test 1: Task completion impact
		const impact = this.dependencyGraphService.getImpactAnalysis("task-1");
		this.assert(impact.directImpact.includes("task-2"), "Correct direct impact identified");
		this.assert(impact.totalImpact.includes("task-2"), "Correct total impact includes task-2");
		this.assert(impact.totalImpact.includes("task-3"), "Correct total impact includes task-3");
		this.assert(impact.totalImpact.includes("task-4"), "Correct total impact includes task-4");
		this.assert(impact.totalImpact.includes("task-5"), "Correct total impact includes task-5");
		
		console.log("Impact analysis tests passed!");
	}

	testVisualizationFormatting(): void {
		console.log("\n=== Testing Visualization Formatting ===");
		
		const testTasks = this.getTestTasks();
		
		// Test 1: D3.js visualization format
		const vizData = this.dependencyGraphService.formatGraphForVisualization(testTasks);
		this.assert(vizData.nodes != null, "Visualization nodes generated");
		this.assert(vizData.links != null, "Visualization links generated");
		this.assert(vizData.layout != null, "Visualization layout generated");
		this.assert(vizData.metadata != null, "Visualization metadata generated");
		this.assert(vizData.nodes.length === testTasks.length, "Correct number of visualization nodes");
		
		console.log("Visualization formatting tests passed!");
	}

	testRealTimeChangeDetection(): void {
		console.log("\n=== Testing Real-time Change Detection ===");
		
		const testTasks = this.getTestTasks();
		
		// Test: Detect dependency changes
		const originalGraph = this.dependencyGraphService.generateDependencyGraph(testTasks);
		
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
			dependencies: ["task-1"],
			type: "task" as any
		});
		
		// Generate new graph
		const newGraph = this.dependencyGraphService.generateDependencyGraph(modifiedTasks);
		
		this.assert(newGraph.nodes.length === originalGraph.nodes.length + 1, "New graph has one more node");
		this.assert(newGraph.edges.length > originalGraph.edges.length, "New graph has more edges");
		
		console.log("Real-time change detection tests passed!");
	}

	runAllTests(): void {
		console.log("Running Dependency Management Tests...");
		
		try {
			this.testDependencyGraphGeneration();
			this.testDependencyValidation();
			this.testImpactAnalysis();
			this.testVisualizationFormatting();
			this.testRealTimeChangeDetection();
			
			console.log("\n🎉 All dependency management tests completed successfully!");
		} catch (error) {
			console.error("❌ Test suite failed:", error);
			process.exit(1);
		}
	}
}

// Export test runner
export function runDependencyTests() {
	const tester = new DependencyManagementTester();
	tester.runAllTests();
}

// Run tests if this file is executed directly
if (require.main === module) {
	runDependencyTests();
}