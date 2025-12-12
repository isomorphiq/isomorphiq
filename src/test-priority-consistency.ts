import { ProductManager } from "./product-manager.ts";
import path from "node:path";

/**
 * Comprehensive priority update consistency testing
 * Tests that priority updates work correctly across the entire system
 */
export class PriorityConsistencyTester {
	private pm: ProductManager;

	constructor(pm: ProductManager) {
		this.pm = pm;
	}

	/**
	 * Test basic priority update functionality
	 */
	async testBasicPriorityUpdates(): Promise<void> {
		console.log("[PRIORITY TEST] Testing basic priority updates...");

		// Create a test task
		const task = await this.pm.createTask(
			"Priority Test Task",
			"Testing priority update consistency",
			"medium",
		);

		// Test updating to high
		let updatedTask = await this.pm.updateTaskPriority(task.id, "high");
		if (updatedTask.priority !== "high") {
			throw new Error(`Expected priority 'high', got '${updatedTask.priority}'`);
		}

		// Test updating to medium
		updatedTask = await this.pm.updateTaskPriority(task.id, "medium");
		if (updatedTask.priority !== "medium") {
			throw new Error(`Expected priority 'medium', got '${updatedTask.priority}'`);
		}

		// Test updating to low
		updatedTask = await this.pm.updateTaskPriority(task.id, "low");
		if (updatedTask.priority !== "low") {
			throw new Error(`Expected priority 'low', got '${updatedTask.priority}'`);
		}

		console.log("[PRIORITY TEST] ✅ Basic priority updates work correctly");
	}

	/**
	 * Test priority consistency across data sources
	 */
	async testPriorityConsistency(): Promise<void> {
		console.log("[PRIORITY TEST] Testing priority consistency across data sources...");

		// Create a test task
		const task = await this.pm.createTask(
			"Consistency Test Task",
			"Testing data consistency",
			"low",
		);

		// Update priority to high
		const updatedTask = await this.pm.updateTaskPriority(task.id, "high");

		// Verify by fetching task directly
		const fetchedTask = await this.pm.getTask(task.id);
		if (!fetchedTask || fetchedTask.priority !== updatedTask.priority) {
			throw new Error(
				`Priority inconsistency: fetched task has priority '${fetchedTask?.priority}', expected '${updatedTask.priority}'`,
			);
		}

		// Verify by checking in all tasks list
		const allTasks = await this.pm.getAllTasks();
		const taskInList = allTasks.find((t) => t.id === task.id);
		if (!taskInList || taskInList.priority !== updatedTask.priority) {
			throw new Error(
				`Priority inconsistency in all tasks list: task has priority '${taskInList?.priority}', expected '${updatedTask.priority}'`,
			);
		}

		// Verify by checking in prioritized queue
		const queue = await this.pm.getTasksSortedByDependencies();
		const taskInQueue = queue.find((t) => t.id === task.id);
		if (!taskInQueue || taskInQueue.priority !== updatedTask.priority) {
			throw new Error(
				`Priority inconsistency in queue: task has priority '${taskInQueue?.priority}', expected '${updatedTask.priority}'`,
			);
		}

		console.log("[PRIORITY TEST] ✅ Priority consistency verified across all data sources");
	}

	/**
	 * Test priority ordering in task queues
	 */
	async testPriorityOrdering(): Promise<void> {
		console.log("[PRIORITY TEST] Testing priority ordering in task queues...");

		// Create tasks with different priorities
		const lowTask = await this.pm.createTask("Low Priority Task", "Low priority test", "low");
		const highTask = await this.pm.createTask("High Priority Task", "High priority test", "high");
		const mediumTask = await this.pm.createTask("Medium Priority Task", "Medium priority test", "medium");

		// Get the prioritized queue
		const queue = await this.pm.getTasksSortedByDependencies();

		// Find our tasks in queue
		const highInQueue = queue.find((t) => t.id === highTask.id);
		const mediumInQueue = queue.find((t) => t.id === mediumTask.id);
		const lowInQueue = queue.find((t) => t.id === lowTask.id);

		if (!highInQueue || !mediumInQueue || !lowInQueue) {
			throw new Error("Not all test tasks found in queue");
		}

		// Check that high priority tasks come before medium and low
		const highIndex = queue.indexOf(highInQueue);
		const mediumIndex = queue.indexOf(mediumInQueue);
		const lowIndex = queue.indexOf(lowInQueue);

		if (highIndex > mediumIndex || highIndex > lowIndex) {
			throw new Error("High priority task should come before medium and low priority tasks");
		}

		if (mediumIndex > lowIndex) {
			throw new Error("Medium priority task should come before low priority tasks");
		}

		console.log("[PRIORITY TEST] ✅ Priority ordering is correct in task queues");
	}

	/**
	 * Test priority update edge cases
	 */
	async testPriorityEdgeCases(): Promise<void> {
		console.log("[PRIORITY TEST] Testing priority update edge cases...");

		const task = await this.pm.createTask("Edge Case Task", "Testing edge cases", "medium");

		// Test updating to same priority
		const samePriorityTask = await this.pm.updateTaskPriority(task.id, "medium");
		if (samePriorityTask.priority !== "medium") {
			throw new Error("Updating to same priority should maintain the priority");
		}

		// Test rapid priority changes
		await this.pm.updateTaskPriority(task.id, "high");
		await this.pm.updateTaskPriority(task.id, "low");
		const finalTask = await this.pm.updateTaskPriority(task.id, "medium");
		if (finalTask.priority !== "medium") {
			throw new Error("Rapid priority changes should work correctly");
		}

		// Test invalid priority values (should throw or handle gracefully)
		try {
			// @ts-expect-error - Testing invalid priority
			await this.pm.updateTaskPriority(task.id, "invalid");
			throw new Error("Should have thrown an error for invalid priority");
		} catch (error) {
			if (!(error instanceof Error) || !error.message.includes("invalid")) {
				throw new Error("Should have thrown a proper error for invalid priority");
			}
		}

		console.log("[PRIORITY TEST] ✅ Priority edge cases handled correctly");
	}

	/**
	 * Test priority update with dependencies
	 */
	async testPriorityWithDependencies(): Promise<void> {
		console.log("[PRIORITY TEST] Testing priority updates with dependencies...");

		// Create dependent tasks
		const task1 = await this.pm.createTask("Task 1", "First task", "low");
		const task2 = await this.pm.createTask("Task 2", "Second task", "medium");
		const task3 = await this.pm.createTask("Task 3", "Third task", "low");

		// Add dependencies to task3
		await this.pm.addDependency(task3.id, task1.id, "test-user");
		await this.pm.addDependency(task3.id, task2.id, "test-user");

		// Update priority of dependent task
		const updatedTask3 = await this.pm.updateTaskPriority(task3.id, "high");
		if (updatedTask3.priority !== "high") {
			throw new Error("Failed to update priority of task with dependencies");
		}

		// Verify dependencies are still intact
		console.log(`[DEBUG] Updated task dependencies: ${JSON.stringify(updatedTask3.dependencies)}`);
		console.log(`[DEBUG] Expected task1 ID: ${task1.id}, task2 ID: ${task2.id}`);
		if (!updatedTask3.dependencies.includes(task1.id) || !updatedTask3.dependencies.includes(task2.id)) {
			throw new Error("Dependencies should be preserved when updating priority");
		}

		console.log("[PRIORITY TEST] ✅ Priority updates work correctly with dependencies");
	}

	/**
	 * Run all priority consistency tests
	 */
	async runAllTests(): Promise<void> {
		console.log("[PRIORITY TEST] Starting comprehensive priority consistency tests...");

		try {
			await this.testBasicPriorityUpdates();
			await this.testPriorityConsistency();
			await this.testPriorityOrdering();
			await this.testPriorityEdgeCases();
			await this.testPriorityWithDependencies();

			console.log("[PRIORITY TEST] ✅ All priority consistency tests passed!");
		} catch (error) {
			console.error("[PRIORITY TEST] ❌ Priority consistency test failed:", error);
			throw error;
		}
	}
}

/**
 * Run priority consistency tests
 */
export async function runPriorityConsistencyTests(): Promise<void> {
	const testDbPath = path.join(process.cwd(), "test-priority-db");
	const pm = new ProductManager(testDbPath);
	await pm.initialize();
	
	const tester = new PriorityConsistencyTester(pm);
	await tester.runAllTests();
	
	await pm.cleanup();
}

// Run tests if this file is executed directly
if (import.meta.main) {
	await runPriorityConsistencyTests();
}