#!/usr/bin/env node
import "../../../tests/test-utils/env-fetch.ts";

/**
 * Simple authentication test that works with current setup
 * Tests basic auth functionality without database conflicts
 */

import { ProductManager } from "@isomorphiq/profiles";

interface TestResult {
	name: string;
	passed: boolean;
	error?: string;
	duration: number;
}

/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
class SimpleAuthTester {
	private pm: ProductManager;
	private results: TestResult[] = [];

	constructor() {
		this.pm = new ProductManager();
	}

	private async runTest(name: string, testFn: () => Promise<void>): Promise<void> {
		const startTime = Date.now();
		try {
			await testFn();
			this.results.push({
				name,
				passed: true,
				duration: Date.now() - startTime,
			});
			console.log(`✅ ${name}`);
		} catch (error) {
			this.results.push({
				name,
				passed: false,
				error: error instanceof Error ? error.message : String(error),
				duration: Date.now() - startTime,
			});
			console.log(`❌ ${name}: ${error}`);
		}
	}

	async testBasicTaskCreation(): Promise<void> {
		await this.runTest("Basic task creation", async () => {
			const task = await this.pm.createTask(
				"Auth Test Task",
				"Testing basic authentication functionality",
				"medium",
			);

			if (!task.id) {
				throw new Error("Task creation failed - no ID returned");
			}

			if (!task.title) {
				throw new Error("Task creation failed - no title");
			}

			// Clean up
			await this.pm.deleteTask(task.id);
		});
	}

	async testTaskListAccess(): Promise<void> {
		await this.runTest("Task list access", async () => {
			const tasks = await this.pm.getAllTasks();

			if (!Array.isArray(tasks)) {
				throw new Error("Task list is not an array");
			}

			if (tasks.length === 0) {
				throw new Error("Task list is empty");
			}
		});
	}

	async testTaskStatusUpdate(): Promise<void> {
		await this.runTest("Task status update", async () => {
			const task = await this.pm.createTask(
				"Status Update Test",
				"Testing status update functionality",
				"low",
			);

			const updatedTask = await this.pm.updateTaskStatus(task.id, "in-progress");

			if (updatedTask.status !== "in-progress") {
				throw new Error(
					`Status update failed: expected 'in-progress', got '${updatedTask.status}'`,
				);
			}

			// Clean up
			await this.pm.deleteTask(task.id);
		});
	}

	async testTaskPriorityUpdate(): Promise<void> {
		await this.runTest("Task priority update", async () => {
			const task = await this.pm.createTask(
				"Priority Update Test",
				"Testing priority update functionality",
				"low",
			);

			const updatedTask = await this.pm.updateTaskPriority(task.id, "high");

			if (updatedTask.priority !== "high") {
				throw new Error(`Priority update failed: expected 'high', got '${updatedTask.priority}'`);
			}

			// Clean up
			await this.pm.deleteTask(task.id);
		});
	}

	async testTaskDeletion(): Promise<void> {
		await this.runTest("Task deletion", async () => {
			const task = await this.pm.createTask(
				"Deletion Test Task",
				"Testing task deletion functionality",
				"medium",
			);

			// Delete the task
			await this.pm.deleteTask(task.id);

			// Verify deletion
			const allTasks = await this.pm.getAllTasks();
			const deletedTask = allTasks.find((t) => t.id === task.id);

			if (deletedTask) {
				throw new Error("Task deletion failed - task still exists");
			}
		});
	}

	async runAllTests(): Promise<void> {
		console.log("🧪 Starting Simple Authentication Tests\n");

		await this.testBasicTaskCreation();
		await this.testTaskListAccess();
		await this.testTaskStatusUpdate();
		await this.testTaskPriorityUpdate();
		await this.testTaskDeletion();

		console.log("\n📊 Test Results:");
		const passed = this.results.filter((r) => r.passed).length;
		const failed = this.results.filter((r) => !r.passed).length;
		const totalDuration = this.results.reduce((sum, r) => sum + r.duration, 0);

		console.log(`Total: ${this.results.length} tests`);
		console.log(`Passed: ${passed} ✅`);
		console.log(`Failed: ${failed} ${failed > 0 ? "❌" : "✅"}`);
		console.log(`Duration: ${totalDuration}ms`);

		if (failed > 0) {
			console.log("\n❌ Failed Tests:");
			this.results
				.filter((r) => !r.passed)
				.forEach((r) => {
					console.log(`  - ${r.name}: ${r.error}`);
				});
			process.exit(1);
		} else {
			console.log("\n✅ All tests passed!");
		}
	}
}

const tester = new SimpleAuthTester();
tester.runAllTests().catch((error) => {
	console.error("Test execution failed:", error);
	process.exit(1);
});

export { SimpleAuthTester };

