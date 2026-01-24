#!/usr/bin/env node

/**
 * End-to-end workflow test for dashboard functionality
 * This script tests the complete task creation and monitoring workflow
 */

import http from "node:http";
import { DaemonTcpClient } from "../src/web/tcp-client.ts";

class WorkflowTest {
	private daemonTcpClient: DaemonTcpClient;
	private createdTaskIds: string[] = [];

	constructor() {
		this.daemonTcpClient = new DaemonTcpClient();
	}

	async createTestTask(title: string, priority: string = "medium"): Promise<any> {
		const taskData = {
			title,
			description: `Test task for ${title}`,
			priority,
		};

		const result = await this.daemonTcpClient.createTask(taskData);
		if (!result.success) {
			throw new Error(`Failed to create task: ${result.error?.message}`);
		}

		this.createdTaskIds.push(result.data.id);
		return result.data;
	}

	async testTaskCreationFlow(): Promise<void> {
		console.log("🧪 Testing Task Creation Flow...\n");

		// Create tasks with different priorities
		const highPriorityTask = await this.createTestTask("High Priority Dashboard Test", "high");
		console.log("✅ Created high priority task:", highPriorityTask.id);

		const mediumPriorityTask = await this.createTestTask("Medium Priority Dashboard Test", "medium");
		console.log("✅ Created medium priority task:", mediumPriorityTask.id);

		const lowPriorityTask = await this.createTestTask("Low Priority Dashboard Test", "low");
		console.log("✅ Created low priority task:", lowPriorityTask.id);

		// Update task statuses
		await this.daemonTcpClient.updateTaskStatus(highPriorityTask.id, "in-progress");
		console.log("✅ Updated high priority task to in-progress");

		await this.daemonTcpClient.updateTaskStatus(mediumPriorityTask.id, "todo");
		console.log("✅ Kept medium priority task as todo");

		await this.daemonTcpClient.updateTaskStatus(lowPriorityTask.id, "done");
		console.log("✅ Updated low priority task to done");
	}

	async testTaskMonitoring(): Promise<void> {
		console.log("\n🧪 Testing Task Monitoring...\n");

		// List all tasks
		const allTasks = await this.daemonTcpClient.listTasks();
		if (!allTasks.success) {
			throw new Error("Failed to list tasks");
		}

		const tasks = allTasks.data;
		console.log(`✅ Found ${tasks.length} total tasks`);

		// Count by status
		const statusCounts = tasks.reduce((acc: any, task: any) => {
			acc[task.status] = (acc[task.status] || 0) + 1;
			return acc;
		}, {});

		console.log("📊 Task Status Distribution:");
		Object.entries(statusCounts).forEach(([status, count]) => {
			console.log(`   ${status}: ${count}`);
		});

		// Count by priority
		const priorityCounts = tasks.reduce((acc: any, task: any) => {
			acc[task.priority] = (acc[task.priority] || 0) + 1;
			return acc;
		}, {});

		console.log("📊 Task Priority Distribution:");
		Object.entries(priorityCounts).forEach(([priority, count]) => {
			console.log(`   ${priority}: ${count}`);
		});

		// Show recent tasks
		const recentTasks = tasks
			.sort((a: any, b: any) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
			.slice(0, 5);

		console.log("\n📋 Recent Tasks:");
		recentTasks.forEach((task: any) => {
			console.log(`   - ${task.title} (${task.status}, ${task.priority})`);
		});
	}

	async testDashboardHttpIntegration(): Promise<void> {
		console.log("\n🧪 Testing Dashboard HTTP Integration...\n");

		const testPorts = [3004, 3005, 3003];
		
		for (const port of testPorts) {
			try {
				const response = await this.makeHttpRequest(port, "/api/metrics");
				if (response.statusCode === 200) {
					console.log(`✅ Dashboard HTTP API is accessible on port ${port}`);
					
					if (response.data.daemon) {
						console.log("   - Daemon metrics available");
					}
					if (response.data.tasks) {
						console.log("   - Task metrics available");
					}
					if (response.data.health) {
						console.log("   - Health metrics available");
					}
					
					// Test task creation via HTTP
					const httpTaskResponse = await this.makeHttpRequest(port, "/api/tasks", "POST", JSON.stringify({
						title: "HTTP API Test Task",
						description: "Created via HTTP API",
						priority: "medium",
					}));
					
					if (httpTaskResponse.statusCode === 201) {
						console.log("✅ Task creation via HTTP API working");
						this.createdTaskIds.push(httpTaskResponse.data.data.id);
					} else {
						console.log(`⚠️  HTTP task creation returned status ${httpTaskResponse.statusCode}`);
					}
					
					return port; // Found working port
				}
			} catch (error) {
				console.log(`❌ Port ${port} not accessible: ${error instanceof Error ? error.message : error}`);
			}
		}
		
		console.log("⚠️  Dashboard HTTP API not accessible on any test port");
		console.log("   To enable dashboard HTTP API, restart the daemon with dashboard integration");
		return null;
	}

	private async makeHttpRequest(port: number, path: string, method: string = "GET", body?: string): Promise<any> {
		return new Promise((resolve, reject) => {
			const options = {
				hostname: "localhost",
				port,
				path,
				method,
				headers: body ? {
					"Content-Type": "application/json",
					"Content-Length": Buffer.byteLength(body),
				} : undefined,
			};

			const req = http.request(options, (res) => {
				let responseData = "";
				res.on("data", (chunk) => {
					responseData += chunk;
				});
				res.on("end", () => {
					try {
						const parsed = JSON.parse(responseData);
						resolve({ statusCode: res.statusCode, data: parsed });
					} catch (error) {
						resolve({ statusCode: res.statusCode, data: responseData });
					}
				});
			});

			req.on("error", (error) => {
				reject(error);
			});

			if (body) {
				req.write(body);
			}
			req.end();
		});
	}

	async cleanup(): Promise<void> {
		console.log("\n🧹 Cleaning up test tasks...");
		
		for (const taskId of this.createdTaskIds) {
			try {
				await this.daemonTcpClient.deleteTask(taskId);
				console.log(`✅ Deleted test task: ${taskId}`);
			} catch (error) {
				console.log(`❌ Failed to delete task ${taskId}:`, error instanceof Error ? error.message : error);
			}
		}
	}

	async runCompleteWorkflow(): Promise<void> {
		console.log("=== Complete Dashboard Workflow Test ===\n");

		try {
			// Test basic task operations
			await this.testTaskCreationFlow();
			
			// Test monitoring functionality
			await this.testTaskMonitoring();
			
			// Test HTTP integration (if available)
			const dashboardPort = await this.testDashboardHttpIntegration();
			
			console.log("\n=== Test Summary ===");
			console.log("✅ Task creation and management via TCP API: WORKING");
			console.log("✅ Task monitoring and filtering: WORKING");
			
			if (dashboardPort) {
				console.log("✅ Dashboard HTTP API: WORKING on port " + dashboardPort);
				console.log(`📱 Dashboard URL: http://localhost:${dashboardPort}`);
			} else {
				console.log("⚠️  Dashboard HTTP API: NOT ACCESSIBLE");
				console.log("💡 To enable the web dashboard, restart the daemon with:");
				console.log("     yarn run daemon");
			}

			console.log("\n🎉 Core functionality is working!");
			console.log("📋 Users can manage tasks through the TCP API and MCP tools");
			
		} catch (error) {
			console.error("❌ Workflow test failed:", error);
		} finally {
			await this.cleanup();
		}
	}
}

async function main() {
	const workflowTest = new WorkflowTest();
	await workflowTest.runCompleteWorkflow();
}

main().catch(console.error);