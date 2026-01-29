import { ProductManager } from "./index.ts";
import type { TaskType } from "./types.ts";

const getErrorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

// Test assertions
function assert(condition: boolean, message: string): void {
	if (!condition) {
		throw new Error(`Assertion failed: ${message}`);
	}
}

function assertEqual<T>(actual: T, expected: T, message?: string): void {
	if (actual !== expected) {
		throw new Error(`Assertion failed: ${message || `Expected ${expected}, got ${actual}`}`);
	}
}

async function assertThrowsAsync(
	fn: () => Promise<unknown>,
	expectedMessage?: string,
): Promise<void> {
	try {
		await fn();
		throw new Error("Expected function to throw, but it resolved successfully");
	} catch (error) {
		const message = getErrorMessage(error);
		if (expectedMessage && !message.includes(expectedMessage)) {
			throw new Error(
				`Expected error message to contain "${expectedMessage}", got "${message}"`,
			);
		}
	}
}

// Test suite
class TestSuite {
	private pm: ProductManager;
	testResults: { name: string; passed: boolean; error?: string; duration: number }[] = [];

	constructor() {
		this.pm = new ProductManager();
	}

	private async runTest(name: string, testFn: () => Promise<void>): Promise<void> {
		const startTime = Date.now();
		try {
			console.log(`[TEST] Running: ${name}`);
			await testFn();
			const duration = Date.now() - startTime;
			this.testResults.push({ name, passed: true, duration });
			console.log(`[TEST] ✅ ${name} (${duration}ms)`);
		} catch (error) {
			const duration = Date.now() - startTime;
			const errorMessage = getErrorMessage(error);
			this.testResults.push({ name, passed: false, error: errorMessage, duration });
			console.log(`[TEST] ❌ ${name} (${duration}ms): ${errorMessage}`);
		}
	}

	// Test 1: Basic task creation
	async testCreateTask(): Promise<void> {
		const task = await this.pm.createTask(
			"Test Task Creation",
			"Testing the createTask functionality",
			"high",
		);

		assert(task.id !== undefined, "Task should have an ID");
		assertEqual(task.title, "Test Task Creation", "Title should match");
		assertEqual(task.description, "Testing createTask functionality", "Description should match");
		assertEqual(task.priority, "high", "Priority should be high");
		assertEqual(task.status, "todo", "Status should be todo");
		assertEqual(task.type, "task", "Type should be task");
		assertEqual(task.createdBy, "system", "Created by should be system");
		assert(task.createdAt instanceof Date, "createdAt should be a Date");
		assert(task.updatedAt instanceof Date, "updatedAt should be a Date");
	}

	// Test 2: Task creation with dependencies
	async testCreateTaskWithDependencies(): Promise<void> {
		// Create a parent task first
		const parentTask = await this.pm.createTask(
			"Parent Task",
			"A parent task for dependency testing",
			"medium",
		);

		// Create a child task with dependency
		const childTask = await this.pm.createTask(
			"Child Task",
			"A child task that depends on the parent",
			"medium",
			[parentTask.id],
		);

		assertEqual(childTask.dependencies.length, 1, "Should have 1 dependency");
		assertEqual(childTask.dependencies[0], parentTask.id, "Dependency should match parent task ID");
	}

	// Test 3: Task creation with invalid dependencies should fail
	async testCreateTaskWithInvalidDependencies(): Promise<void> {
		await assertThrowsAsync(
			() =>
				this.pm.createTask("Invalid Task", "Task with non-existent dependency", "medium", [
					"non-existent-task-id",
				]),
			"Dependency not found",
		);
	}

	// Test 4: Self-dependency should fail
	async testSelfDependency(): Promise<void> {
		await assertThrowsAsync(
			() =>
				this.pm.createTask(
					"Self Dependent Task",
					"Task that depends on itself",
					"medium",
					["self-dependent-task-id"], // This won't be the actual ID, but we need to test the logic
				),
			"Task cannot depend on itself",
		);
	}

	// Test 5: Circular dependency detection
	async testCircularDependency(): Promise<void> {
		// Create task A
		const taskA = await this.pm.createTask("Task A", "First task in circular dependency", "medium");

		// Create task B
		const taskB = await this.pm.createTask(
			"Task B",
			"Second task in circular dependency",
			"medium",
		);

		// Try to make A depend on B and B depend on A
		await this.pm.updateTaskDependencies(taskA.id, [taskB.id]);

		await assertThrowsAsync(() => this.pm.updateTaskDependencies(taskB.id, [taskA.id]), "cycle");
	}

	// Test 6: Get all tasks
	async testGetAllTasks(): Promise<void> {
		// Clear any existing tasks by creating a fresh manager
		const freshPm = new ProductManager();

		const initialTasks = await freshPm.getAllTasks();
		const initialCount = initialTasks.length;

		// Create some test tasks
		await freshPm.createTask("Task 1", "First test task", "high");
		await freshPm.createTask("Task 2", "Second test task", "medium");
		await freshPm.createTask("Task 3", "Third test task", "low");

		const allTasks = await freshPm.getAllTasks();
		assertEqual(allTasks.length, initialCount + 3);

		// Verify tasks are properly typed
		allTasks.forEach((task) => {
			assert(task.id !== undefined, "Task should have ID");
			assert(task.title !== undefined, "Task should have title");
			assert(task.description !== undefined, "Task should have description");
			assert(
				["todo", "in-progress", "done"].includes(task.status),
				"Task should have valid status",
			);
			assert(["low", "medium", "high"].includes(task.priority), "Task should have valid priority");
			assert(
				[
					"feature",
					"story",
					"task",
					"implementation",
					"integration",
					"testing",
					"research",
				].includes(task.type),
				"Task should have valid type",
			);
			assert(Array.isArray(task.dependencies), "Dependencies should be an array");
		});
	}

	// Test 7: Update task status
	async testUpdateTaskStatus(): Promise<void> {
		const task = await this.pm.createTask("Status Test Task", "Task for status testing", "medium");

		// Update to in-progress
		let updatedTask = await this.pm.updateTaskStatus(task.id, "in-progress");
		assertEqual(updatedTask.status, "in-progress");

		// Update to done
		updatedTask = await this.pm.updateTaskStatus(task.id, "done");
		assertEqual(updatedTask.status, "done");

		// Update back to todo
		updatedTask = await this.pm.updateTaskStatus(task.id, "todo");
		assertEqual(updatedTask.status, "todo");
	}

	// Test 8: Update task priority
	async testUpdateTaskPriority(): Promise<void> {
		const task = await this.pm.createTask("Priority Test Task", "Task for priority testing", "low");

		// Update to high
		let updatedTask = await this.pm.updateTaskPriority(task.id, "high");
		assertEqual(updatedTask.priority, "high");

		// Update to medium
		updatedTask = await this.pm.updateTaskPriority(task.id, "medium");
		assertEqual(updatedTask.priority, "medium");

		// Update to low
		updatedTask = await this.pm.updateTaskPriority(task.id, "low");
		assertEqual(updatedTask.priority, "low");
	}

	// Test 9: Update task dependencies
	async testUpdateTaskDependencies(): Promise<void> {
		const task1 = await this.pm.createTask("Task 1", "First task", "medium");
		const task2 = await this.pm.createTask("Task 2", "Second task", "medium");
		const task3 = await this.pm.createTask("Task 3", "Third task", "medium");

		// Add dependencies to task3
		const updatedTask = await this.pm.updateTaskDependencies(task3.id, [task1.id, task2.id]);
		assertEqual(updatedTask.dependencies.length, 2, "Should have 2 dependencies");
		assert(updatedTask.dependencies.includes(task1.id), "Should include task1 dependency");
		assert(updatedTask.dependencies.includes(task2.id), "Should include task2 dependency");

		// Remove all dependencies
		const noDepsTask = await this.pm.updateTaskDependencies(task3.id, []);
		assertEqual(noDepsTask.dependencies.length, 0, "Should have no dependencies");
	}

	// Test 10: Delete task
	async testDeleteTask(): Promise<void> {
		const task = await this.pm.createTask("Delete Test Task", "Task to be deleted", "medium");

		// Verify task exists
		const tasksBefore = await this.pm.getAllTasks();
		const taskExistsBefore = tasksBefore.some((t) => t.id === task.id);
		assert(taskExistsBefore, "Task should exist before deletion");

		// Delete task
		await this.pm.deleteTask(task.id);

		// Verify task is gone
		const tasksAfter = await this.pm.getAllTasks();
		const taskExistsAfter = tasksAfter.some((t) => t.id === task.id);
		assert(!taskExistsAfter, "Task should not exist after deletion");
	}

	// Test 11: Assign task to user
	async testAssignTask(): Promise<void> {
		const task = await this.pm.createTask(
			"Assignment Test Task",
			"Task for assignment testing",
			"medium",
		);

		const assignedTask = await this.pm.assignTask(task.id, "user123", "admin");
		assertEqual(assignedTask.assignedTo, "user123", "Should be assigned to user123");
	}

	// Test 12: Update task collaborators
	async testUpdateTaskCollaborators(): Promise<void> {
		const task = await this.pm.createTask(
			"Collaboration Test Task",
			"Task for collaboration testing",
			"medium",
		);

		const collaborators = ["user1", "user2", "user3"];
		const updatedTask = await this.pm.updateTaskCollaborators(task.id, collaborators);
		assertEqual(updatedTask.collaborators?.length, 3, "Should have 3 collaborators");
		assert(updatedTask.collaborators?.includes("user1") === true, "Should include user1");
		assert(updatedTask.collaborators?.includes("user2") === true, "Should include user2");
		assert(updatedTask.collaborators?.includes("user3") === true, "Should include user3");
	}

	// Test 13: Update task watchers
	async testUpdateTaskWatchers(): Promise<void> {
		const task = await this.pm.createTask(
			"Watchers Test Task",
			"Task for watchers testing",
			"medium",
		);

		const watchers = ["watcher1", "watcher2"];
		const updatedTask = await this.pm.updateTaskWatchers(task.id, watchers);
		assertEqual(updatedTask.watchers?.length, 2, "Should have 2 watchers");
		assert(updatedTask.watchers?.includes("watcher1") === true, "Should include watcher1");
		assert(updatedTask.watchers?.includes("watcher2") === true, "Should include watcher2");
	}

	// Test 14: Get tasks for user
	async testGetTasksForUser(): Promise<void> {
		const userId = "test-user-123";

		// Create tasks with different relationships to the user
		const createdTask = await this.pm.createTask(
			"Created Task",
			"Task created by user",
			"medium",
			[],
			userId,
		);
		const assignedTask = await this.pm.createTask(
			"Assigned Task",
			"Task assigned to user",
			"medium",
		);
		await this.pm.assignTask(assignedTask.id, userId);

		const collabTask = await this.pm.createTask(
			"Collaboration Task",
			"Task with user as collaborator",
			"medium",
		);
		await this.pm.updateTaskCollaborators(collabTask.id, [userId]);

		const watcherTask = await this.pm.createTask(
			"Watcher Task",
			"Task with user as watcher",
			"medium",
		);
		await this.pm.updateTaskWatchers(watcherTask.id, [userId]);

		// Test getting all types of tasks for user
		const allUserTasks = await this.pm.getTasksForUser(userId);
		assert(allUserTasks.length >= 4, "User should have at least 4 tasks");

		// Test getting only created tasks
		const createdTasks = await this.pm.getTasksForUser(userId, ["created"]);
		assert(
			createdTasks.some((t) => t.id === createdTask.id),
			"Should include created task",
		);

		// Test getting only assigned tasks
		const assignedTasks = await this.pm.getTasksForUser(userId, ["assigned"]);
		assert(
			assignedTasks.some((t) => t.id === assignedTask.id),
			"Should include assigned task",
		);

		// Test getting only collaborating tasks
		const collabTasks = await this.pm.getTasksForUser(userId, ["collaborating"]);
		assert(
			collabTasks.some((t) => t.id === collabTask.id),
			"Should include collaboration task",
		);

		// Test getting only watching tasks
		const watchingTasks = await this.pm.getTasksForUser(userId, ["watching"]);
		assert(
			watchingTasks.some((t) => t.id === watcherTask.id),
			"Should include watcher task",
		);
	}

	// Test 15: Task access control
	async testTaskAccess(): Promise<void> {
		const creatorId = "creator-user";
		const assigneeId = "assignee-user";
		const collaboratorId = "collaborator-user";
		const watcherId = "watcher-user";
		const outsiderId = "outsider-user";

		const task = await this.pm.createTask(
			"Access Control Task",
			"Task for testing access control",
			"medium",
			[],
			creatorId,
			assigneeId,
			[collaboratorId],
			[watcherId],
		);

		// Creator should have full access
		assert(
			await this.pm.hasTaskAccess(creatorId, task.id, "read"),
			"Creator should have read access",
		);
		assert(
			await this.pm.hasTaskAccess(creatorId, task.id, "write"),
			"Creator should have write access",
		);
		assert(
			await this.pm.hasTaskAccess(creatorId, task.id, "delete"),
			"Creator should have delete access",
		);

		// Assignee should have read/write access
		assert(
			await this.pm.hasTaskAccess(assigneeId, task.id, "read"),
			"Assignee should have read access",
		);
		assert(
			await this.pm.hasTaskAccess(assigneeId, task.id, "write"),
			"Assignee should have write access",
		);
		assert(
			!(await this.pm.hasTaskAccess(assigneeId, task.id, "delete")),
			"Assignee should not have delete access",
		);

		// Collaborator should have read access only
		assert(
			await this.pm.hasTaskAccess(collaboratorId, task.id, "read"),
			"Collaborator should have read access",
		);
		assert(
			!(await this.pm.hasTaskAccess(collaboratorId, task.id, "write")),
			"Collaborator should not have write access",
		);
		assert(
			!(await this.pm.hasTaskAccess(collaboratorId, task.id, "delete")),
			"Collaborator should not have delete access",
		);

		// Watcher should have read access only
		assert(
			await this.pm.hasTaskAccess(watcherId, task.id, "read"),
			"Watcher should have read access",
		);
		assert(
			!(await this.pm.hasTaskAccess(watcherId, task.id, "write")),
			"Watcher should not have write access",
		);
		assert(
			!(await this.pm.hasTaskAccess(watcherId, task.id, "delete")),
			"Watcher should not have delete access",
		);

		// Outsider should have no access
		assert(
			!(await this.pm.hasTaskAccess(outsiderId, task.id, "read")),
			"Outsider should not have read access",
		);
		assert(
			!(await this.pm.hasTaskAccess(outsiderId, task.id, "write")),
			"Outsider should not have write access",
		);
		assert(
			!(await this.pm.hasTaskAccess(outsiderId, task.id, "delete")),
			"Outsider should not have delete access",
		);
	}

	// Test 16: Dependency validation
	async testDependencyValidation(): Promise<void> {
		const task1 = await this.pm.createTask("Task 1", "First task", "medium");
		const task2 = await this.pm.createTask("Task 2", "Second task", "medium");
		const task3 = await this.pm.createTask("Task 3", "Third task", "medium");

		// Create a valid dependency chain: task3 -> task2 -> task1
		await this.pm.updateTaskDependencies(task2.id, [task1.id]);
		await this.pm.updateTaskDependencies(task3.id, [task2.id]);

		const allTasks = await this.pm.getAllTasks();
		const validation = this.pm.validateDependencies(allTasks);

		assert(validation.isValid, "Valid dependency chain should pass validation");
		assertEqual(validation.errors.length, 0, "Should have no validation errors");
	}

	// Test 17: Topological sort
	async testTopologicalSort(): Promise<void> {
		// Create tasks with dependencies
		const task1 = await this.pm.createTask("Task 1", "Independent task", "high");
		const task2 = await this.pm.createTask("Task 2", "Depends on task 1", "medium");
		const task3 = await this.pm.createTask("Task 3", "Depends on task 2", "low");

		await this.pm.updateTaskDependencies(task2.id, [task1.id]);
		await this.pm.updateTaskDependencies(task3.id, [task2.id]);

		const sortedTasks = await this.pm.getTasksSortedByDependencies();

		// task1 should come before task2, which should come before task3
		const task1Index = sortedTasks.findIndex((t) => t.id === task1.id);
		const task2Index = sortedTasks.findIndex((t) => t.id === task2.id);
		const task3Index = sortedTasks.findIndex((t) => t.id === task3.id);

		assert(task1Index < task2Index, "Task 1 should come before Task 2");
		assert(task2Index < task3Index, "Task 2 should come before Task 3");
	}

	// Test 18: Task creation with all optional parameters
	async testCreateTaskWithAllParameters(): Promise<void> {
		const collaborators = ["collab1", "collab2"];
		const watchers = ["watcher1"];
		const dependencies: string[] = [];

		const task = await this.pm.createTask(
			"Full Task",
			"Task with all parameters",
			"high",
			dependencies,
			"creator-user",
			"assigned-user",
			collaborators,
			watchers,
			"feature",
		);

		assertEqual(task.title, "Full Task");
		assertEqual(task.description, "Task with all parameters");
		assertEqual(task.priority, "high");
		assertEqual(task.type, "feature");
		assertEqual(task.createdBy, "creator-user");
		assertEqual(task.assignedTo, "assigned-user");
		assertEqual(task.collaborators?.length, 2);
		assertEqual(task.watchers?.length, 1);
	}

	// Test 19: Error handling for non-existent task operations
	async testNonExistentTaskOperations(): Promise<void> {
		const nonExistentId = "non-existent-task-id";

		await assertThrowsAsync(
			() => this.pm.updateTaskStatus(nonExistentId, "in-progress"),
			"Key not found",
		);

		await assertThrowsAsync(
			() => this.pm.updateTaskPriority(nonExistentId, "high"),
			"Key not found",
		);

		await assertThrowsAsync(
			() => this.pm.updateTaskDependencies(nonExistentId, []),
			"Key not found",
		);

		await assertThrowsAsync(() => this.pm.assignTask(nonExistentId, "user123"), "Key not found");

		await assertThrowsAsync(
			() => this.pm.updateTaskCollaborators(nonExistentId, []),
			"Key not found",
		);

		await assertThrowsAsync(() => this.pm.updateTaskWatchers(nonExistentId, []), "Key not found");

		await assertThrowsAsync(() => this.pm.deleteTask(nonExistentId), "Key not found");
	}

	// Test 20: Task type inference and validation
	async testTaskTypes(): Promise<void> {
		const types: TaskType[] = [
			"feature",
			"story",
			"task",
			"implementation",
			"integration",
			"testing",
			"research",
		];

		for (const type of types) {
			const task = await this.pm.createTask(
				`${type} Task`,
				`A task of type ${type}`,
				"medium",
				[],
				"system",
				undefined,
				undefined,
				undefined,
				type,
			);

			assertEqual(task.type, type, `Task should have type ${type}`);
		}
	}

	// Run all tests
	async runAllTests(): Promise<void> {
		console.log("[TEST] Starting comprehensive test suite...");

		const tests = [
			() => this.testCreateTask(),
			() => this.testCreateTaskWithDependencies(),
			() => this.testCreateTaskWithInvalidDependencies(),
			() => this.testSelfDependency(),
			() => this.testCircularDependency(),
			() => this.testGetAllTasks(),
			() => this.testUpdateTaskStatus(),
			() => this.testUpdateTaskPriority(),
			() => this.testUpdateTaskDependencies(),
			() => this.testDeleteTask(),
			() => this.testAssignTask(),
			() => this.testUpdateTaskCollaborators(),
			() => this.testUpdateTaskWatchers(),
			() => this.testGetTasksForUser(),
			() => this.testTaskAccess(),
			() => this.testDependencyValidation(),
			() => this.testTopologicalSort(),
			() => this.testCreateTaskWithAllParameters(),
			() => this.testNonExistentTaskOperations(),
			() => this.testTaskTypes(),
		];

		for (let i = 0; i < tests.length; i++) {
			const testFn = tests[i];
			if (testFn) {
				await this.runTest(`Test ${i + 1}: ${testFn.name}`, testFn);
			}
		}

		this.printResults();
	}

	private printResults(): void {
		const passed = this.testResults.filter((r) => r.passed).length;
		const failed = this.testResults.filter((r) => !r.passed).length;
		const totalDuration = this.testResults.reduce((sum, r) => sum + r.duration, 0);

		console.log(`\n${"=".repeat(60)}`);
		console.log("[TEST] TEST RESULTS");
		console.log("=".repeat(60));
		console.log(`Total Tests: ${this.testResults.length}`);
		console.log(`Passed: ${passed} ✅`);
		console.log(`Failed: ${failed} ❌`);
		console.log(`Total Duration: ${totalDuration}ms`);
		console.log("=".repeat(60));

		if (failed > 0) {
			console.log("\n[TEST] FAILED TESTS:");
			this.testResults
				.filter((r) => !r.passed)
				.forEach((r) => {
					console.log(`  ❌ ${r.name}: ${r.error}`);
				});
		}

		console.log("\n[TEST] DETAILED RESULTS:");
		this.testResults.forEach((r) => {
			const status = r.passed ? "✅" : "❌";
			console.log(`  ${status} ${r.name} (${r.duration}ms)`);
			if (!r.passed && r.error) {
				console.log(`     Error: ${r.error}`);
			}
		});
	}
}

// Run the test suite
async function main(): Promise<void> {
	const testSuite = new TestSuite();
	try {
		await testSuite.runAllTests();

		const failed = testSuite.testResults.filter((r: { passed: boolean }) => !r.passed).length;
		if (failed > 0) {
			console.log(`\n[TEST] 💥 ${failed} tests failed!`);
			process.exit(1);
		} else {
			console.log("\n[TEST] 🎉 All tests passed!");
			process.exit(0);
		}
	} catch (error) {
		console.error("[TEST] 💥 Test suite crashed:", error);
		process.exit(1);
	}
}

// Run if this file is executed directly
main().catch(console.error);
