import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { spawn } from "node:child_process";
import { setTimeout } from "node:timers/promises";

describe("Scheduler TCP Integration Test", () => {
	let daemonProcess: any;
	let tcpPort: number;
	
	before(async () => {
		// Use a different port for testing to avoid conflicts
		tcpPort = 3002;
		process.env.TCP_PORT = tcpPort.toString();
		process.env.SKIP_TCP = "false"; // Ensure TCP server is enabled
		
		// Start the daemon
		daemonProcess = spawn("yarn", ["run", "daemon"], {
			cwd: process.cwd(),
			env: { ...process.env, TCP_PORT: tcpPort.toString() },
			stdio: "pipe",
			detached: false,
			shell: true
		});
		
		// Wait for daemon to start
		await setTimeout(3000);
		
		// Handle daemon output
		if (daemonProcess.stdout) {
			daemonProcess.stdout.on("data", (data: Buffer) => {
				console.log("[DAEMON-OUTPUT]", data.toString());
			});
		}
		
		if (daemonProcess.stderr) {
			daemonProcess.stderr.on("data", (data: Buffer) => {
				console.error("[DAEMON-ERROR]", data.toString());
			});
		}
	});
	
	after(async () => {
		if (daemonProcess) {
			daemonProcess.kill("SIGTERM");
			await setTimeout(1000);
		}
	});

	function sendTcpCommand(command: string, data: any = {}): Promise<any> {
		return new Promise((resolve, reject) => {
			const net = require("net");
			const socket = new net.Socket();
			
			socket.connect(tcpPort, "localhost", () => {
				const message = JSON.stringify({ command, data });
				socket.write(message + "\\n");
			});
			
			socket.on("data", (data: Buffer) => {
				try {
					const response = JSON.parse(data.toString().trim());
					resolve(response);
				} catch (error) {
					reject(error);
				}
				socket.end();
			});
			
			socket.on("error", (error: Error) => {
				reject(error);
			});
			
			// Timeout after 5 seconds
			setTimeout(() => {
				socket.destroy();
				reject(new Error("TCP command timeout"));
			}, 5000);
		});
	}

	it("should create a scheduled task via TCP", async () => {
		const taskData = {
			name: "TCP Test Task",
			description: "Task created via TCP",
			cronExpression: "0 0 * * *", // Daily at midnight
			isActive: true,
			taskTemplate: {
				title: "TCP Generated Task",
				description: "This task was created via TCP",
				priority: "medium",
				createdBy: "tcp-test-user"
			}
		};
		
		const response = await sendTcpCommand("create_scheduled_task", taskData);
		
		assert.strictEqual(response.success, true, "Should successfully create scheduled task");
		assert.ok(response.data.id, "Should return task ID");
		assert.strictEqual(response.data.name, taskData.name);
		assert.strictEqual(response.data.cronExpression, taskData.cronExpression);
		assert.strictEqual(response.data.isActive, taskData.isActive);
	});

	it("should list scheduled tasks via TCP", async () => {
		const response = await sendTcpCommand("list_scheduled_tasks");
		
		assert.strictEqual(response.success, true, "Should successfully list scheduled tasks");
		assert.ok(Array.isArray(response.data), "Should return array of tasks");
	});

	it("should validate cron expression via TCP", async () => {
		const validExpression = "0 9 * * 1-5"; // Weekdays at 9 AM
		const response = await sendTcpCommand("validate_cron_expression", { 
			expression: validExpression 
		});
		
		assert.strictEqual(response.success, true, "Should successfully validate cron expression");
		assert.strictEqual(response.data.isValid, true, "Expression should be valid");
		assert.ok(Array.isArray(response.data.nextRuns), "Should provide next run times");
	});

	it("should reject invalid cron expression via TCP", async () => {
		const invalidExpression = "invalid-cron-format";
		const response = await sendTcpCommand("validate_cron_expression", { 
			expression: invalidExpression 
		});
		
		assert.strictEqual(response.success, true, "Should return validation response");
		assert.strictEqual(response.data.isValid, false, "Expression should be invalid");
		assert.ok(response.data.errors.length > 0, "Should provide error messages");
	});

	it("should get scheduler stats via TCP", async () => {
		const response = await sendTcpCommand("get_scheduler_stats");
		
		assert.strictEqual(response.success, true, "Should successfully get scheduler stats");
		assert.ok(typeof response.data.totalSchedules === "number", "Should include total schedules");
		assert.ok(typeof response.data.activeSchedules === "number", "Should include active schedules");
		assert.ok(typeof response.data.successRate === "number", "Should include success rate");
	});

	it("should pause and resume scheduler via TCP", async () => {
		// Pause scheduler
		const pauseResponse = await sendTcpCommand("pause_scheduler");
		assert.strictEqual(pauseResponse.success, true, "Should successfully pause scheduler");
		
		// Resume scheduler
		const resumeResponse = await sendTcpCommand("resume_scheduler");
		assert.strictEqual(resumeResponse.success, true, "Should successfully resume scheduler");
	});

	it("should handle scheduler errors gracefully", async () => {
		const response = await sendTcpCommand("get_scheduled_task", { 
			id: "non-existent-id" 
		});
		
		assert.strictEqual(response.success, false, "Should fail for non-existent task");
		assert.ok(response.error, "Should provide error message");
		assert.ok(response.error.message.includes("not found"), "Error should mention task not found");
	});

	it("should create, update, and delete scheduled task via TCP", async () => {
		// Create
		const createData = {
			name: "Lifecycle Test Task",
			description: "Task for lifecycle testing",
			cronExpression: "0 1 * * *", // Daily at 1 AM
			isActive: true,
			taskTemplate: {
				title: "Lifecycle Test",
				description: "Testing full lifecycle",
				priority: "high",
				createdBy: "lifecycle-test-user"
			}
		};
		
		const createResponse = await sendTcpCommand("create_scheduled_task", createData);
		assert.strictEqual(createResponse.success, true, "Should create task");
		const taskId = createResponse.data.id;
		
		// Update
		const updateData = {
			id: taskId,
			updates: {
				name: "Updated Lifecycle Task",
				isActive: false,
				taskTemplate: {
					...createData.taskTemplate,
					priority: "low"
				}
			}
		};
		
		const updateResponse = await sendTcpCommand("update_scheduled_task", updateData);
		assert.strictEqual(updateResponse.success, true, "Should update task");
		assert.strictEqual(updateResponse.data.name, updateData.updates.name);
		assert.strictEqual(updateResponse.data.isActive, updateData.updates.isActive);
		
		// Delete
		const deleteResponse = await sendTcpCommand("delete_scheduled_task", { id: taskId });
		assert.strictEqual(deleteResponse.success, true, "Should delete task");
		assert.strictEqual(deleteResponse.data.deleted, true, "Should confirm deletion");
		
		// Verify deletion
		const getResponse = await sendTcpCommand("get_scheduled_task", { id: taskId });
		assert.strictEqual(getResponse.success, false, "Should not find deleted task");
	});

	it("should handle dependency validation via TCP", async () => {
		const taskData = {
			name: "Dependency Test Task",
			description: "Task with dependencies",
			cronExpression: "0 2 * * *",
			isActive: true,
			taskTemplate: {
				title: "Dependency Test",
				description: "Task with dependencies",
				priority: "medium",
				createdBy: "dependency-test-user",
				dependencies: ["non-existent-dependency"]
			}
		};
		
		// Create the task
		const createResponse = await sendTcpCommand("create_scheduled_task", taskData);
		assert.strictEqual(createResponse.success, true, "Should create task with dependencies");
		const taskId = createResponse.data.id;
		
		// Validate dependencies
		const validateResponse = await sendTcpCommand("validate_scheduled_task_dependencies", { id: taskId });
		assert.strictEqual(validateResponse.success, true, "Should validate dependencies");
		assert.strictEqual(validateResponse.data.isValid, false, "Should detect missing dependencies");
		assert.ok(validateResponse.data.missingDependencies.includes("non-existent-dependency"), "Should identify missing dependency");
	});

	it("should provide scheduling recommendations via TCP", async () => {
		const response = await sendTcpCommand("get_dependency_scheduling_recommendations");
		
		assert.strictEqual(response.success, true, "Should get recommendations");
		assert.ok(Array.isArray(response.data), "Should return array of recommendations");
		
		// If there are scheduled tasks, should have recommendations for each
		if (response.data.length > 0) {
			const recommendation = response.data[0];
			assert.ok(recommendation.taskId, "Should include task ID");
			assert.ok(recommendation.taskName, "Should include task name");
			assert.ok(["reschedule", "proceed", "skip", "fix_dependencies"].includes(recommendation.recommendation), "Should have valid recommendation type");
			assert.ok(recommendation.reason, "Should provide reason");
		}
	});
});