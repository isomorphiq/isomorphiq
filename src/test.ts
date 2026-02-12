import { ProductManager } from "@isomorphiq/profiles";
import path from "node:path";

async function runTests() {
	console.log("[TEST] Starting test suite...");

	const testDbPath = path.join(process.cwd(), "test-db");
	const pm = new ProductManager(testDbPath);

	try {
		// Test 1: Create a task
		console.log("[TEST] Test 1: Creating task...");
		const task = await pm.createTask(
			"Test Task",
			"This is a test task created by the test suite",
			"medium",
		);
		console.log("[TEST] ✅ Task created:", task.id);

		// Test 2: Get all tasks
		console.log("[TEST] Test 2: Getting all tasks...");
		const tasks = await pm.getAllTasks();
		console.log("[TEST] ✅ Retrieved tasks:", tasks.length);

		// Test 3: Update task status
		console.log("[TEST] Test 3: Updating task status...");
		const updatedTask = await pm.updateTaskStatus(task.id, "in-progress");
		console.log("[TEST] ✅ Task status updated:", updatedTask.status);

		// Test 4: Update task priority
		console.log("[TEST] Test 4: Updating task priority...");
		const priorityUpdatedTask = await pm.updateTaskPriority(task.id, "high");
		console.log("[TEST] ✅ Task priority updated:", priorityUpdatedTask.priority);

		// Test 5: Get specific task
		console.log("[TEST] Test 5: Getting specific task...");
		const specificTask = tasks.find((t) => t.id === task.id);
		if (specificTask) {
			console.log("[TEST] ✅ Specific task retrieved:", specificTask.title);
		} else {
			throw new Error("Task not found");
		}

		// Test 6: Delete task
		console.log("[TEST] Test 6: Deleting task...");
		await pm.deleteTask(task.id);
		const finalTasks = await pm.getAllTasks();
		const taskExists = finalTasks.some((t) => t.id === task.id);
		if (!taskExists) {
			console.log("[TEST] ✅ Task deleted successfully");
		} else {
			throw new Error("Task deletion failed");
		}

		console.log("[TEST] 🎉 All tests passed!");
	} catch (error) {
		console.error("[TEST] ❌ Test failed:", error);
		process.exit(1);
	}
}

// Run tests
runTests().catch(console.error);
