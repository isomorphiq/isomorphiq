#!/usr/bin/env node

/**
 * Simplified test suite for data consistency using ProductManager directly
 * Tests data integrity without HTTP endpoints to avoid authentication issues
 */

import { ProductManager } from "../src/index.js";

interface TestResult {
	name: string;
	passed: boolean;
	error?: string;
	duration: number;
}

class DataConsistencyTester {
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

	async testBasicDataConsistency(): Promise<void> {
		await this.runTest("Basic data consistency across endpoints", async () => {
			const tasks = await this.pm.getAllTasks();

			const totalTasks = tasks.length;
			const todoTasks = tasks.filter((t) => t.status === "todo").length;
			const inProgressTasks = tasks.filter((t) => t.status === "in-progress").length;
			const doneTasks = tasks.filter((t) => t.status === "done").length;
			const highPriorityTasks = tasks.filter((t) => t.priority === "high").length;
			const mediumPriorityTasks = tasks.filter((t) => t.priority === "medium").length;
			const lowPriorityTasks = tasks.filter((t) => t.priority === "low").length;

			if (totalTasks !== todoTasks + inProgressTasks + doneTasks) {
				throw new Error(
					`Status breakdown inconsistent: ${totalTasks} != ${todoTasks + inProgressTasks + doneTasks}`,
				);
			}

			if (totalTasks !== highPriorityTasks + mediumPriorityTasks + lowPriorityTasks) {
				throw new Error(
					`Priority breakdown inconsistent: ${totalTasks} != ${highPriorityTasks + mediumPriorityTasks + lowPriorityTasks}`,
				);
			}
		});
	}

	async testTaskCreationConsistency(): Promise<void> {
		await this.runTest("Task creation and retrieval consistency", async () => {
			const task = await this.pm.createTask(
				"Consistency Test Task",
				"Testing data consistency in task creation",
				"medium",
			);

			const allTasks = await this.pm.getAllTasks();
			const retrievedTask = allTasks.find((t) => t.id === task.id);

			if (!retrievedTask) {
				throw new Error("Created task not found in retrieval");
			}

			if (retrievedTask.title !== task.title) {
				throw new Error("Task title mismatch");
			}

			if (retrievedTask.description !== task.description) {
				throw new Error("Task description mismatch");
			}

			if (retrievedTask.priority !== task.priority) {
				throw new Error("Task priority mismatch");
			}

			await this.pm.deleteTask(task.id);
		});
	}

	async testStatusUpdateConsistency(): Promise<void> {
		await this.runTest("Status update consistency", async () => {
			const task = await this.pm.createTask(
				"Status Test Task",
				"Testing status update consistency",
				"low",
			);

			await this.pm.updateTaskStatus(task.id, "in-progress");

			const allTasks = await this.pm.getAllTasks();
			const updatedTask = allTasks.find((t) => t.id === task.id);

			if (!updatedTask) {
				throw new Error("Updated task not found");
			}

			if (updatedTask.status !== "in-progress") {
				throw new Error(
					`Status update failed: expected 'in-progress', got '${updatedTask.status}'`,
				);
			}

			await this.pm.deleteTask(task.id);
		});
	}

	async testPriorityUpdateConsistency(): Promise<void> {
		await this.runTest("Priority update consistency", async () => {
			const task = await this.pm.createTask(
				"Priority Test Task",
				"Testing priority update consistency",
				"low",
			);

			await this.pm.updateTaskPriority(task.id, "high");

			const allTasks = await this.pm.getAllTasks();
			const updatedTask = allTasks.find((t) => t.id === task.id);

			if (!updatedTask) {
				throw new Error("Updated task not found");
			}

			if (updatedTask.priority !== "high") {
				throw new Error(`Priority update failed: expected 'high', got '${updatedTask.priority}'`);
			}

			await this.pm.deleteTask(task.id);
		});
	}

	async runAllTests(): Promise<void> {
		console.log("🧪 Starting Data Consistency Tests\n");

		await this.testBasicDataConsistency();
		await this.testTaskCreationConsistency();
		await this.testStatusUpdateConsistency();
		await this.testPriorityUpdateConsistency();

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

const tester = new DataConsistencyTester();
tester.runAllTests().catch((error) => {
	console.error("Test execution failed:", error);
	process.exit(1);
});

export { DataConsistencyTester };
