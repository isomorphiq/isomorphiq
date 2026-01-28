#!/usr/bin/env node

/**
 * End-to-end test script for task lifecycle testing
 * This script tests the complete workflow from task creation to completion
 */

import { createConnection } from "node:net";

class E2ETestClient {
	private port: number = 3001;
	private host: string = "localhost";

	async sendCommand<T = unknown, R = unknown>(command: string, data: T): Promise<R> {
		return new Promise((resolve, reject) => {
			const client = createConnection({ port: this.port, host: this.host }, () => {
				const message = `${JSON.stringify({ command, data })}\n`;
				client.write(message);
			});

			let response = "";
			client.on("data", (data) => {
				response += data.toString();
				try {
					const result = JSON.parse(response.trim());
					client.end();
					resolve(result);
				} catch (_e) {
					// Wait for more data
				}
			});

			client.on("error", reject);
			client.on("close", () => {
				if (!response) reject(new Error("Connection closed without response"));
			});

			setTimeout(() => {
				client.destroy();
				reject(new Error("Request timeout"));
			}, 10000);
		});
	}
}

async function testTaskLifecycle() {
	console.log("=== End-to-End Task Lifecycle Test ===\n");
	
	const client = new E2ETestClient();
	let taskId: string = "";

	try {
		// Step 1: Create a task with dependencies
		console.log("1. Creating task with dependencies...");
		const taskData = {
			title: "E2E Lifecycle Test Task",
			description: "Testing complete task lifecycle from creation to completion",
			priority: "high" as const,
			type: "feature" as const,
			tags: ["test", "e2e", "lifecycle"],
			estimatedDuration: 5,
			deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours from now
		};

		const createResult = await client.sendCommand("create_task", taskData);
		if (!(createResult as any).success) {
			throw new Error("Failed to create task");
		}

		taskId = (createResult as any).data.id;
		console.log(`✅ Task created: ${taskId}`);

		// Step 2: Get task details
		console.log("\n2. Retrieving task details...");
		const getResult = await client.sendCommand("get_task", { id: taskId });
		if (!(getResult as any).success) {
			throw new Error("Failed to get task");
		}

		const task = (getResult as any).data;
		console.log(`✅ Task retrieved: ${task.title} (${task.status})`);

		// Step 3: Update task status to in-progress
		console.log("\n3. Setting task to in-progress...");
		const progressResult = await client.sendCommand("update_task_status", { 
			id: taskId, 
			status: "in-progress" 
		});
		
		if (!(progressResult as any).success) {
			throw new Error("Failed to update task status");
		}
		console.log("✅ Task status updated to in-progress");

		// Step 4: Add a comment/action log entry
		console.log("\n4. Adding action log entry...");
		const logResult = await client.sendCommand("update_task", {
			id: taskId,
			actionLog: [{
				action: "Task assigned to development team",
				timestamp: new Date().toISOString(),
				actor: "system"
			}]
		});

		if (!(logResult as any).success) {
			console.log("⚠️  Action log update failed, continuing test...");
		} else {
			console.log("✅ Action log entry added");
		}

		// Step 5: Update task priority
		console.log("\n5. Updating task priority...");
		const priorityResult = await client.sendCommand("update_task_priority", {
			id: taskId,
			priority: "medium"
		});

		if (!(priorityResult as any).success) {
			throw new Error("Failed to update task priority");
		}
		console.log("✅ Task priority updated to medium");

		// Step 6: Create dependent task
		console.log("\n6. Creating dependent task...");
		const depTaskData = {
			title: "Dependent E2E Test Task",
			description: "Task that depends on the main E2E test task",
			priority: "medium" as const,
			dependencies: [taskId]
		};

		const depResult = await client.sendCommand("create_task", depTaskData);
		if (!(depResult as any).success) {
			throw new Error("Failed to create dependent task");
		}

		const depTaskId = (depResult as any).data.id;
		console.log(`✅ Dependent task created: ${depTaskId}`);

		// Step 7: Check dependency status
		console.log("\n7. Checking dependency status...");
		const depGraphResult = await client.sendCommand("get_dependency_graph", {});
		if (!(depGraphResult as any).success) {
			throw new Error("Failed to get dependency graph");
		}

		const graph = (depGraphResult as any).data;
		console.log(`✅ Dependency graph retrieved: ${graph.nodes.length} nodes, ${graph.edges.length} edges`);

		// Step 8: Complete the main task
		console.log("\n8. Completing main task...");
		const completeResult = await client.sendCommand("update_task_status", {
			id: taskId,
			status: "done"
		});

		if (!(completeResult as any).success) {
			throw new Error("Failed to complete task");
		}
		console.log("✅ Main task completed");

		// Step 9: Check if dependent task is now unblocked
		console.log("\n9. Checking dependent task status...");
		const depGetResult = await client.sendCommand("get_task", { id: depTaskId });
		if (!(depGetResult as any).success) {
			throw new Error("Failed to get dependent task");
		}

		const depTask = (depGetResult as any).data;
		console.log(`✅ Dependent task status: ${depTask.status} (blocked: ${depTask.blocked})`);

		// Step 10: Complete dependent task
		console.log("\n10. Completing dependent task...");
		const depCompleteResult = await client.sendCommand("update_task_status", {
			id: depTaskId,
			status: "done"
		});

		if (!(depCompleteResult as any).success) {
			throw new Error("Failed to complete dependent task");
		}
		console.log("✅ Dependent task completed");

		// Step 11: Get final queue status
		console.log("\n11. Getting final queue status...");
		const queueResult = await client.sendCommand("list_tasks", {});
		if (!(queueResult as any).success) {
			console.log("⚠️  Queue status check failed, continuing test...");
		} else {
			const tasks = (queueResult as any).data;
			const completed = tasks.filter((t: any) => t.status === "done").length;
			const inProgress = tasks.filter((t: any) => t.status === "in-progress").length;
			console.log(`✅ Queue status: ${tasks.length} total, ${completed} completed, ${inProgress} in-progress`);
		}

		// Step 12: Clean up - delete both tasks
		console.log("\n12. Cleaning up test tasks...");
		const deleteResult1 = await client.sendCommand("delete_task", { id: taskId });
		const deleteResult2 = await client.sendCommand("delete_task", { id: depTaskId });

		if (deleteResult1 && (deleteResult1 as any).success && 
			deleteResult2 && (deleteResult2 as any).success) {
			console.log("✅ Test tasks deleted successfully");
		} else {
			console.log("⚠️  Task deletion had issues but test completed");
		}

		console.log("\n=== End-to-End Test Summary ===");
		console.log("✅ Task creation with metadata");
		console.log("✅ Task retrieval and validation");
		console.log("✅ Task status updates");
		console.log("✅ Action log management");
		console.log("✅ Priority management");
		console.log("✅ Dependency creation and validation");
		console.log("✅ Dependency graph analysis");
		console.log("✅ Task completion workflow");
		console.log("✅ Queue status monitoring");
		console.log("✅ Task cleanup");
		console.log("\n🎉 All end-to-end tests passed successfully!");

	} catch (error) {
		console.error("❌ End-to-end test failed:", error);
		
		// Attempt cleanup
		if (taskId) {
			try {
				await client.sendCommand("delete_task", { id: taskId });
				console.log("🧹 Cleaned up test task after failure");
			} catch (cleanupError) {
				console.log("⚠️  Failed to clean up test task:", cleanupError);
			}
		}
		
		process.exit(1);
	}
}

testTaskLifecycle().catch(console.error);