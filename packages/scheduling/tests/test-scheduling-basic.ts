import { SchedulingService } from "@isomorphiq/scheduling";
import { InMemoryTaskRepository } from "@isomorphiq/tasks";
import { TaskService } from "@isomorphiq/tasks";

async function testSchedulingBasics() {
	console.log("=== Testing Scheduling System Basics ===\n");

	// Initialize services
	const taskRepository = new InMemoryTaskRepository();
	const taskService = new TaskService(taskRepository);
	const schedulingService = new SchedulingService(taskService);

	// Test 1: Create sample tasks
	console.log("1. Creating sample tasks...");
	try {
		const task1 = await taskService.createTask(
			{
				title: "High priority feature",
				description: "Implement user authentication system",
				priority: "high",
				dependencies: [],
			},
			"system",
		);

		const task2 = await taskService.createTask(
			{
				title: "Medium priority bug fix",
				description: "Fix login page responsiveness issue",
				priority: "medium",
				dependencies: [],
			},
			"system",
		);

		const task3 = await taskService.createTask(
			{
				title: "Low priority documentation",
				description: "Update API documentation",
				priority: "low",
				dependencies: [],
			},
			"system",
		);

		if (task1.success && task2.success && task3.success) {
			console.log("✓ Tasks created successfully");
			console.log(`  - Task 1: ${task1.data.id} (${task1.data.priority})`);
			console.log(`  - Task 2: ${task2.data.id} (${task2.data.priority})`);
			console.log(`  - Task 3: ${task3.data.id} (${task3.data.priority})`);
		} else {
			console.log("✗ Failed to create tasks");
			return;
		}
	} catch (error) {
		console.log("✗ Error creating tasks:", error);
		return;
	}

	// Test 2: Get all tasks
	console.log("\n2. Retrieving all tasks...");
	try {
		const allTasksResult = await taskService.getAllTasks();
		if (allTasksResult.success) {
			console.log(`✓ Retrieved ${allTasksResult.data.length} tasks`);
			allTasksResult.data.forEach((task) => {
				console.log(`  - ${task.title}: ${task.priority} priority`);
			});
		} else {
			console.log("✗ Failed to retrieve tasks");
		}
	} catch (error) {
		console.log("✗ Error retrieving tasks:", error);
	}

	// Test 3: Test auto-assignment
	console.log("\n3. Testing auto-assignment...");
	try {
		const autoAssignResult = await schedulingService.autoAssign({});

		if (autoAssignResult.success) {
			console.log("✓ Auto-assignment completed");
			console.log(`  - Tasks processed: ${autoAssignResult.metrics.tasksProcessed}`);
			console.log(`  - Tasks assigned: ${autoAssignResult.metrics.tasksAssigned}`);
			console.log(
				`  - Average confidence: ${autoAssignResult.metrics.averageConfidence.toFixed(1)}%`,
			);
			console.log(`  - Conflicts detected: ${autoAssignResult.metrics.conflictsDetected}`);

			if (autoAssignResult.assignedTasks.length > 0) {
				console.log("  - Assignments:");
				autoAssignResult.assignedTasks.forEach((assignment) => {
					console.log(
						`    * Task ${assignment.taskId} -> User ${assignment.userId} (${assignment.confidence}% confidence)`,
					);
				});
			}
		} else {
			console.log("✗ Auto-assignment failed");
			console.log("  Errors:", autoAssignResult.errors);
		}
	} catch (error) {
		console.log("✗ Auto-assignment error:", error);
	}

	// Test 4: Test conflict detection
	console.log("\n4. Testing conflict detection...");
	try {
		const conflicts = await schedulingService.detectConflicts();
		console.log(`✓ Conflict detection completed - found ${conflicts.length} conflicts`);

		if (conflicts.length > 0) {
			conflicts.forEach((conflict) => {
				console.log(`  - ${conflict.type}: ${conflict.description} (${conflict.severity})`);
			});
		}
	} catch (error) {
		console.log("✗ Conflict detection error:", error);
	}

	// Test 5: Test workload analysis
	console.log("\n5. Testing workload analysis...");
	try {
		const workloads = await schedulingService.getWorkloads();
		console.log(`✓ Workload analysis completed for ${workloads.length} users`);

		workloads.forEach((workload) => {
			console.log(`  - User ${workload.userId}:`);
			console.log(`    * Current tasks: ${workload.currentTasks}`);
			console.log(`    * Utilization: ${workload.utilizationRate.toFixed(1)}%`);
			console.log(`    * Status: ${workload.overloaded ? "Overloaded" : "Available"}`);
		});
	} catch (error) {
		console.log("✗ Workload analysis error:", error);
	}

	// Test 6: Test configuration management
	console.log("\n6. Testing configuration management...");
	try {
		const originalConfig = schedulingService.getConfig();
		console.log("✓ Current configuration retrieved");
		console.log(`  - Algorithm: ${originalConfig.algorithm}`);
		console.log(`  - Conflict resolution: ${originalConfig.conflictResolution}`);

		// Update configuration
		await schedulingService.updateConfig({
			algorithm: "priority_first",
			conflictResolution: "auto",
		});

		const updatedConfig = schedulingService.getConfig();
		console.log("✓ Configuration updated");
		console.log(`  - Algorithm: ${updatedConfig.algorithm}`);
		console.log(`  - Conflict resolution: ${updatedConfig.conflictResolution}`);

		// Reset configuration
		await schedulingService.resetConfig();
		const resetConfig = schedulingService.getConfig();
		console.log("✓ Configuration reset");
		console.log(`  - Algorithm: ${resetConfig.algorithm}`);
		console.log(`  - Conflict resolution: ${resetConfig.conflictResolution}`);
	} catch (error) {
		console.log("✗ Configuration management error:", error);
	}

	// Test 7: Test resource metrics
	console.log("\n7. Testing resource metrics...");
	try {
		const metrics = await schedulingService.getResourceMetrics();
		console.log("✓ Resource metrics generated");
		console.log(`  - Total tasks: ${metrics.totalTasks}`);
		console.log(`  - Assigned tasks: ${metrics.assignedTasks}`);
		console.log(`  - Unassigned tasks: ${metrics.unassignedTasks}`);
		console.log(`  - Average utilization: ${metrics.averageUtilization.toFixed(1)}%`);
		console.log(`  - Conflict rate: ${metrics.conflictRate.toFixed(1)}%`);
		console.log(`  - Completion rate: ${metrics.completionRate.toFixed(1)}%`);
	} catch (error) {
		console.log("✗ Resource metrics error:", error);
	}

	// Test 8: Test schedule optimization
	console.log("\n8. Testing schedule optimization...");
	try {
		const optimization = await schedulingService.optimizeSchedule();

		if (optimization.optimized) {
			console.log("✓ Schedule optimized successfully");
			console.log(`  - Improvements: ${optimization.improvements.join(", ")}`);
			console.log(`  - Conflicts resolved: ${optimization.conflictsResolved}`);
			console.log(`  - Total utilization: ${optimization.metrics.totalUtilization.toFixed(1)}%`);
		} else {
			console.log("✓ No optimization needed");
		}
	} catch (error) {
		console.log("✗ Schedule optimization error:", error);
	}

	console.log("\n=== Scheduling System Test Complete ===");
}

// Run the test
testSchedulingBasics().catch(console.error);
