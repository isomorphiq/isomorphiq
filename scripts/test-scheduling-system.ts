import { SchedulingService } from "../src/services/scheduling-service";
import { InMemoryTaskRepository } from "../src/repositories/task-repository";
import { TaskService } from "../src/services/task-service";
import { getUserManager } from "../src/user-manager";

async function testSchedulingSystem() {
	console.log("=== Testing Automated Task Scheduling and Resource Allocation System ===\n");

	// Initialize services
	const taskRepository = new InMemoryTaskRepository();
	const taskService = new TaskService(taskRepository);
	const schedulingService = new SchedulingService(taskService);

	// Test 1: Create sample users
	console.log("1. Creating sample users...");
	const userManager = getUserManager();

	try {
		const user1 = await userManager.createUser({
			username: "alice",
			email: "alice@example.com",
			password: "password123",
			role: "developer",
			profile: {
				timezone: "America/New_York",
			},
		});

		const user2 = await userManager.createUser({
			username: "bob",
			email: "bob@example.com",
			password: "password123",
			role: "developer",
			profile: {
				timezone: "America/Los_Angeles",
			},
		});

		const user3 = await userManager.createUser({
			username: "carol",
			email: "carol@example.com",
			password: "password123",
			role: "manager",
			profile: {
				timezone: "Europe/London",
			},
		});

		console.log("✓ Users created successfully");
		console.log(`  - Alice: ${user1.id}`);
		console.log(`  - Bob: ${user2.id}`);
		console.log(`  - Carol: ${user3.id}`);
	} catch (error) {
		console.log("✗ Failed to create users:", error);
	}

	// Test 2: Create sample tasks
	console.log("\n2. Creating sample tasks...");
	try {
		const task1 = await taskService.createTask(
			{
				title: "Implement user authentication",
				description: "Add login and registration functionality",
				priority: "high",
				dependencies: [],
			},
			"system",
		);

		const task2 = await taskService.createTask(
			{
				title: "Design database schema",
				description: "Create database schema for user data",
				priority: "medium",
				dependencies: [],
			},
			"system",
		);

		const task3 = await taskService.createTask(
			{
				title: "Write API documentation",
				description: "Document REST API endpoints",
				priority: "low",
				dependencies: [],
			},
			"system",
		);

		const task4 = await taskService.createTask(
			{
				title: "Setup CI/CD pipeline",
				description: "Configure continuous integration and deployment",
				priority: "high",
				dependencies: [],
			},
			"system",
		);

		console.log("✓ Tasks created successfully");
		console.log(`  - Task 1: ${task1.data?.id}`);
		console.log(`  - Task 2: ${task2.data?.id}`);
		console.log(`  - Task 3: ${task3.data?.id}`);
		console.log(`  - Task 4: ${task4.data?.id}`);
	} catch (error) {
		console.log("✗ Failed to create tasks:", error);
	}

	// Test 3: Test auto-assignment
	console.log("\n3. Testing automatic task assignment...");
	try {
		const autoAssignResult = await schedulingService.autoAssign({});

		if (autoAssignResult.success) {
			console.log("✓ Auto-assignment completed successfully");
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

	// Test 4: Test assignment recommendations
	console.log("\n4. Testing assignment recommendations...");
	try {
		const allTasksResult = await taskService.getAllTasks();
		if (allTasksResult.success && allTasksResult.data.length > 0) {
			const firstTask = allTasksResult.data[0];
			const recommendations = await schedulingService.getRecommendations(firstTask.id);

			console.log(
				`✓ Generated ${recommendations.length} recommendations for task: ${firstTask.title}`,
			);

			recommendations.slice(0, 3).forEach((rec, index) => {
				console.log(`  ${index + 1}. User ${rec.userId}: ${rec.confidence}% confidence`);
				rec.reasons.forEach((reason) => {
					console.log(`     - ${reason}`);
				});
			});
		}
	} catch (error) {
		console.log("✗ Recommendation generation error:", error);
	}

	// Test 5: Test conflict detection
	console.log("\n5. Testing conflict detection...");
	try {
		const conflicts = await schedulingService.detectConflicts();

		console.log(`✓ Detected ${conflicts.length} conflicts`);

		if (conflicts.length > 0) {
			conflicts.forEach((conflict) => {
				console.log(`  - ${conflict.type}: ${conflict.description} (${conflict.severity})`);
			});
		} else {
			console.log("  No conflicts detected");
		}
	} catch (error) {
		console.log("✗ Conflict detection error:", error);
	}

	// Test 6: Test schedule optimization
	console.log("\n6. Testing schedule optimization...");
	try {
		const optimization = await schedulingService.optimizeSchedule();

		if (optimization.optimized) {
			console.log("✓ Schedule optimized successfully");
			console.log(`  - Improvements: ${optimization.improvements.join(", ")}`);
			console.log(`  - Conflicts resolved: ${optimization.conflictsResolved}`);
			console.log(`  - New assignments: ${optimization.newAssignments.length}`);
			console.log(`  - Total utilization: ${optimization.metrics.totalUtilization.toFixed(1)}%`);
		} else {
			console.log("✓ No optimization needed");
		}
	} catch (error) {
		console.log("✗ Schedule optimization error:", error);
	}

	// Test 7: Test workload analysis
	console.log("\n7. Testing workload analysis...");
	try {
		const workloads = await schedulingService.getWorkloads();

		console.log(`✓ Analyzed workloads for ${workloads.length} users`);

		workloads.forEach((workload) => {
			console.log(`  - User ${workload.userId}:`);
			console.log(`    * Current tasks: ${workload.currentTasks}`);
			console.log(`    * Estimated hours: ${workload.estimatedHours}`);
			console.log(`    * Utilization: ${workload.utilizationRate.toFixed(1)}%`);
			console.log(`    * Status: ${workload.overloaded ? "Overloaded" : "Available"}`);
		});
	} catch (error) {
		console.log("✗ Workload analysis error:", error);
	}

	// Test 8: Test resource metrics
	console.log("\n8. Testing resource allocation metrics...");
	try {
		const metrics = await schedulingService.getResourceMetrics();

		console.log("✓ Resource allocation metrics generated:");
		console.log(`  - Total tasks: ${metrics.totalTasks}`);
		console.log(`  - Assigned tasks: ${metrics.assignedTasks}`);
		console.log(`  - Unassigned tasks: ${metrics.unassignedTasks}`);
		console.log(`  - Average utilization: ${metrics.averageUtilization.toFixed(1)}%`);
		console.log(`  - Conflict rate: ${metrics.conflictRate.toFixed(1)}%`);
		console.log(`  - Completion rate: ${metrics.completionRate.toFixed(1)}%`);
	} catch (error) {
		console.log("✗ Resource metrics error:", error);
	}

	// Test 9: Test configuration management
	console.log("\n9. Testing configuration management...");
	try {
		const originalConfig = schedulingService.getConfig();
		console.log("✓ Current configuration:");
		console.log(`  - Algorithm: ${originalConfig.algorithm}`);
		console.log(`  - Conflict resolution: ${originalConfig.conflictResolution}`);
		console.log(`  - Scheduling horizon: ${originalConfig.schedulingHorizon} days`);

		// Update configuration
		await schedulingService.updateConfig({
			algorithm: "priority_first",
			conflictResolution: "auto",
			schedulingHorizon: 14,
		});

		const updatedConfig = schedulingService.getConfig();
		console.log("✓ Configuration updated:");
		console.log(`  - Algorithm: ${updatedConfig.algorithm}`);
		console.log(`  - Conflict resolution: ${updatedConfig.conflictResolution}`);
		console.log(`  - Scheduling horizon: ${updatedConfig.schedulingHorizon} days`);

		// Reset configuration
		await schedulingService.resetConfig();
		const _resetConfig = schedulingService.getConfig();
		console.log("✓ Configuration reset to defaults");
	} catch (error) {
		console.log("✗ Configuration management error:", error);
	}

	// Test 10: Test bulk operations
	console.log("\n10. Testing bulk operations...");
	try {
		const allTasksResult = await taskService.getAllTasks();
		if (allTasksResult.success && allTasksResult.data.length >= 2) {
			const taskIds = allTasksResult.data.slice(0, 2).map((task) => task.id);
			const userIds = [taskIds[0], taskIds[1]]; // Assign to different users

			const bulkResult = await schedulingService.bulkAssign(taskIds, userIds);

			if (bulkResult.success) {
				console.log("✓ Bulk assignment completed successfully");
				console.log(`  - Tasks processed: ${bulkResult.metrics.tasksProcessed}`);
				console.log(`  - Tasks assigned: ${bulkResult.metrics.tasksAssigned}`);
			} else {
				console.log("✗ Bulk assignment failed");
				console.log("  Errors:", bulkResult.errors);
			}
		}
	} catch (error) {
		console.log("✗ Bulk operations error:", error);
	}

	// Test 11: Test assignment validation
	console.log("\n11. Testing assignment validation...");
	try {
		const validation = await schedulingService.validateAssignments();

		if (validation.valid) {
			console.log("✓ All assignments are valid");
		} else {
			console.log("✗ Assignment validation found issues:");
			validation.issues.forEach((issue) => {
				console.log(`  - ${issue.severity}: ${issue.issue} (Task: ${issue.taskId})`);
			});
		}
	} catch (error) {
		console.log("✗ Assignment validation error:", error);
	}

	// Test 12: Test analytics
	console.log("\n12. Testing scheduling analytics...");
	try {
		const analytics = await schedulingService.getSchedulingAnalytics("week");

		console.log("✓ Scheduling analytics generated:");
		console.log(`  - Efficiency: ${analytics.efficiency}%`);
		console.log(`  - Utilization: ${analytics.utilization}%`);
		console.log(`  - Conflict rate: ${analytics.conflictRate}%`);
		console.log(`  - Compliance: ${analytics.compliance}%`);
		console.log(`  - Trend data points: ${analytics.trends.length}`);
	} catch (error) {
		console.log("✗ Analytics generation error:", error);
	}

	console.log("\n=== Scheduling System Test Complete ===");
}

// Run the test
testSchedulingSystem().catch(console.error);
