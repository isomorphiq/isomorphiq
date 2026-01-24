import type { Task } from "./src/types.ts";
import { CriticalPathService } from "@isomorphiq/service-critical-path";

// Create sample tasks for testing
const sampleTasks: Task[] = [
	{
		id: "task-1",
		title: "Design Database Schema",
		description: "Create the initial database schema for the application",
		status: "done",
		priority: "high",
		type: "feature",
		dependencies: [],
		createdBy: "user-1",
		createdAt: new Date("2024-01-01"),
		updatedAt: new Date("2024-01-05"),
	},
	{
		id: "task-2",
		title: "Implement Authentication",
		description: "Add user authentication and authorization",
		status: "in-progress",
		priority: "high",
		type: "feature",
		dependencies: ["task-1"],
		createdBy: "user-1",
		createdAt: new Date("2024-01-02"),
		updatedAt: new Date("2024-01-06"),
	},
	{
		id: "task-3",
		title: "Create API Endpoints",
		description: "Build REST API endpoints for core functionality",
		status: "todo",
		priority: "medium",
		type: "feature",
		dependencies: ["task-1"],
		createdBy: "user-2",
		createdAt: new Date("2024-01-03"),
		updatedAt: new Date("2024-01-03"),
	},
	{
		id: "task-4",
		title: "Build Frontend UI",
		description: "Create the user interface components",
		status: "todo",
		priority: "medium",
		type: "feature",
		dependencies: ["task-2", "task-3"],
		createdBy: "user-2",
		createdAt: new Date("2024-01-04"),
		updatedAt: new Date("2024-01-04"),
	},
	{
		id: "task-5",
		title: "Write Tests",
		description: "Add unit and integration tests",
		status: "todo",
		priority: "low",
		type: "task",
		dependencies: ["task-4"],
		createdBy: "user-1",
		createdAt: new Date("2024-01-05"),
		updatedAt: new Date("2024-01-05"),
	},
];

console.log("🔍 Testing Critical Path Service");
console.log("=" .repeat(50));

// Test 1: Calculate critical path
console.log("\n1️⃣ Calculating Critical Path...");
try {
	const criticalPathResult = CriticalPathService.calculateCriticalPath(sampleTasks);
	console.log("✅ Critical path calculation successful!");
	console.log(`📊 Project Duration: ${criticalPathResult.projectDuration.toFixed(1)} days`);
	console.log(`🔗 Critical Path: ${criticalPathResult.criticalPath.join(" → ")}`);
	console.log(`📈 Total Tasks: ${criticalPathResult.nodes.length}`);
	console.log(`🎯 Critical Tasks: ${criticalPathResult.criticalPath.length}`);
} catch (error) {
	console.error("❌ Critical path calculation failed:", error);
}

// Test 2: Get available tasks
console.log("\n2️⃣ Getting Available Tasks...");
try {
	const availableTasks = CriticalPathService.getAvailableTasks(sampleTasks);
	console.log("✅ Available tasks calculation successful!");
	console.log(`📋 Available Tasks: ${availableTasks.length}`);
	availableTasks.forEach((task) => {
		console.log(`   - ${task.title} (${task.status})`);
	});
} catch (error) {
	console.error("❌ Available tasks calculation failed:", error);
}

// Test 3: Get blocking tasks
console.log("\n3️⃣ Getting Blocking Tasks...");
try {
	const blockingTasks = CriticalPathService.getBlockingTasks(sampleTasks);
	console.log("✅ Blocking tasks calculation successful!");
	console.log(`🚧 Blocking Tasks: ${blockingTasks.length}`);
	blockingTasks.forEach((task) => {
		console.log(`   - ${task.title} (${task.status})`);
	});
} catch (error) {
	console.error("❌ Blocking tasks calculation failed:", error);
}

// Test 4: Analyze delay impact
console.log("\n4️⃣ Analyzing Delay Impact...");
try {
	const impact = CriticalPathService.analyzeDelayImpact(sampleTasks, "task-2", 2);
	console.log("✅ Impact analysis successful!");
	console.log(`⏰ Delay: ${impact.delayDays} days`);
	console.log(`🎯 Critical Path Impact: ${impact.criticalPathImpact ? "YES" : "NO"}`);
	console.log(`📊 Affected Tasks: ${impact.affectedTasks.length}`);
	console.log(`📈 New Project Duration: ${impact.newProjectDuration.toFixed(1)} days`);
	
	if (impact.delayedTasks.length > 0) {
		console.log("📋 Delayed Tasks:");
		impact.delayedTasks.forEach((delayedTask) => {
			console.log(`   - ${delayedTask.taskId}: +${delayedTask.delayDays} days`);
		});
	}
} catch (error) {
	console.error("❌ Impact analysis failed:", error);
}

console.log("\n🎉 All tests completed!");
console.log("=" .repeat(50));
