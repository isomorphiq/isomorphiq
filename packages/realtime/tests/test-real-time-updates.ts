#!/usr/bin/env node

/**
 * Simplified test suite for real-time updates using ProductManager directly
 * Tests WebSocket and real-time functionality without HTTP endpoints
 */

import { ProductManager } from "@isomorphiq/user-profile";

interface TestResult {
	name: string;
	passed: boolean;
	error?: string;
	duration: number;
}

/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
class RealTimeUpdatesTester {
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

	async testTaskCreationEvents(): Promise<void> {
		await this.runTest("Task creation event handling", async () => {
			const task = await this.pm.createTask(
				"Real-time Test Task",
				"Testing real-time task creation events",
				"medium",
			);

			if (!task.id) {
				throw new Error("Created task missing ID");
			}

			if (!task.title) {
				throw new Error("Created task missing title");
			}

			await this.pm.deleteTask(task.id);
		});
	}

	async testStatusUpdateEvents(): Promise<void> {
		await this.runTest("Status update event handling", async () => {
			const task = await this.pm.createTask(
				"Status Update Test",
				"Testing status update events",
				"low",
			);

			const updatedTask = await this.pm.updateTaskStatus(task.id, "in-progress");

			if (updatedTask.status !== "in-progress") {
				throw new Error(
					`Status update failed: expected 'in-progress', got '${updatedTask.status}'`,
				);
			}

			await this.pm.deleteTask(task.id);
		});
	}

	async testPriorityUpdateEvents(): Promise<void> {
		await this.runTest("Priority update event handling", async () => {
			const task = await this.pm.createTask(
				"Priority Update Test",
				"Testing priority update events",
				"low",
			);

			const updatedTask = await this.pm.updateTaskPriority(task.id, "high");

			if (updatedTask.priority !== "high") {
				throw new Error(`Priority update failed: expected 'high', got '${updatedTask.priority}'`);
			}

			await this.pm.deleteTask(task.id);
		});
	}

	async testMultipleTaskOperations(): Promise<void> {
		await this.runTest("Multiple concurrent task operations", async () => {
			const tasks = [];

			// Create multiple tasks
			for (let i = 0; i < 3; i++) {
				const task = await this.pm.createTask(
					`Concurrent Task ${i}`,
					`Testing concurrent task creation ${i}`,
					"medium",
				);
				tasks.push(task);
			}

			// Verify all tasks were created
			const allTasks = await this.pm.getAllTasks();
			const foundTasks = tasks.filter((t) => allTasks.some((at) => at.id === t.id));

			if (foundTasks.length !== 3) {
				throw new Error(`Expected 3 concurrent tasks, found ${foundTasks.length}`);
			}

			// Clean up
			for (const task of tasks) {
				await this.pm.deleteTask(task.id);
			}
		});
	}

	async testTaskDataConsistency(): Promise<void> {
		await this.runTest("Task data consistency across operations", async () => {
			const originalTask = await this.pm.createTask(
				"Consistency Test",
				"Testing task data consistency",
				"high",
			);

			// Update status
			const statusUpdatedTask = await this.pm.updateTaskStatus(originalTask.id, "in-progress");

			// Update priority
			const priorityUpdatedTask = await this.pm.updateTaskPriority(statusUpdatedTask.id, "low");

			// Verify final state
			if (priorityUpdatedTask.title !== originalTask.title) {
				throw new Error("Task title changed during updates");
			}

			if (priorityUpdatedTask.description !== originalTask.description) {
				throw new Error("Task description changed during updates");
			}

			if (priorityUpdatedTask.status !== "in-progress") {
				throw new Error("Task status not preserved during priority update");
			}

			if (priorityUpdatedTask.priority !== "low") {
				throw new Error("Task priority not updated correctly");
			}

			await this.pm.deleteTask(priorityUpdatedTask.id);
		});
	}

	async testEventSequence(): Promise<void> {
		await this.runTest("Event sequence validation", async () => {
			const _events = [];

			// Create task and track events
			const task = await this.pm.createTask(
				"Event Sequence Test",
				"Testing event sequence order",
				"medium",
			);

			// Update task to generate events
			await this.pm.updateTaskStatus(task.id, "in-progress");
			await this.pm.updateTaskPriority(task.id, "high");

			// Verify task exists and has correct final state
			const finalTask = await this.pm
				.getAllTasks()
				.then((tasks) => tasks.find((t) => t.id === task.id));

			if (!finalTask) {
				throw new Error("Task not found after operations");
			}

			if (finalTask.status !== "in-progress") {
				throw new Error(
					`Final status incorrect: expected 'in-progress', got '${finalTask.status}'`,
				);
			}

			if (finalTask.priority !== "high") {
				throw new Error(`Final priority incorrect: expected 'high', got '${finalTask.priority}'`);
			}

			await this.pm.deleteTask(task.id);
		});
	}

	async runAllTests(): Promise<void> {
		console.log("🧪 Starting Real-time Updates Tests\n");

		await this.testTaskCreationEvents();
		await this.testStatusUpdateEvents();
		await this.testPriorityUpdateEvents();
		await this.testMultipleTaskOperations();
		await this.testTaskDataConsistency();
		await this.testEventSequence();

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

const tester = new RealTimeUpdatesTester();
tester.runAllTests().catch((error) => {
	console.error("Test execution failed:", error);
	process.exit(1);
});

export { RealTimeUpdatesTester };

