import { spawn } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import { createConnection } from "node:net";

async function testSchedulerIntegration() {
	console.log("Testing Task Scheduling and Cron-based Automation...");
	
	// Use a different port for testing
	const tcpPort = 3002;
	const testEnv = { ...process.env, TCP_PORT: tcpPort.toString(), SKIP_TCP: "false" };
	
	// Start daemon
	console.log("Starting daemon for scheduler test...");
	const daemonProcess = spawn("yarn", ["run", "worker"], {
		cwd: process.cwd(),
		env: testEnv,
		stdio: "pipe",
		detached: false,
		shell: true
	});
	
	// Wait for daemon to start
	await setTimeout(5000);
	
	// Helper function to send TCP commands
	async function sendTcpCommand(command: string, data: any = {}): Promise<any> {
		return new Promise((resolve, reject) => {
			const socket = createConnection(tcpPort, "localhost");
			
			socket.connect(tcpPort, "localhost", () => {
				const message = JSON.stringify({ command, data });
				socket.write(message + "\\n");
			});
			
			let responseData = "";
			socket.on("data", (data: Buffer) => {
				responseData += data.toString();
			});
			
			socket.on("end", () => {
				try {
					const response = JSON.parse(responseData.trim());
					resolve(response);
				} catch (error) {
					reject(error);
				}
			});
			
			socket.on("error", (error: Error) => {
				reject(error);
			});
			
			setTimeout(() => {
				socket.destroy();
				reject(new Error("TCP command timeout"));
			}, 5000);
		});
	}
	
	try {
		// Test 1: Create a scheduled task
		console.log("Test 1: Creating scheduled task...");
		const taskData = {
			name: "Test Scheduled Task",
			description: "Task created during integration test",
			cronExpression: "*/5 * * * *", // Every 5 minutes for testing
			isActive: true,
			taskTemplate: {
				title: "Integration Test Task",
				description: "This task was created during integration testing",
				priority: "medium",
				createdBy: "integration-test-user"
			}
		};
		
		const createResponse = await sendTcpCommand("create_scheduled_task", taskData);
		if (createResponse.success) {
			console.log("✅ Successfully created scheduled task:", createResponse.data.name);
			console.log("   Task ID:", createResponse.data.id);
			console.log("   Cron expression:", createResponse.data.cronExpression);
		} else {
			console.log("❌ Failed to create scheduled task:", createResponse.error?.message);
		}
		
		// Test 2: List scheduled tasks
		console.log("\\nTest 2: Listing scheduled tasks...");
		const listResponse = await sendTcpCommand("list_scheduled_tasks");
		if (listResponse.success) {
			console.log("✅ Successfully listed scheduled tasks");
			console.log("   Total tasks:", listResponse.data.length);
		} else {
			console.log("❌ Failed to list scheduled tasks:", listResponse.error?.message);
		}
		
		// Test 3: Validate cron expression
		console.log("\\nTest 3: Validating cron expressions...");
		const validCronTests = [
			"0 0 * * *", // Daily at midnight
			"*/15 * * * *", // Every 15 minutes
			"0 9 * * 1-5" // Weekdays at 9 AM
		];
		
		for (const cronExpr of validCronTests) {
			const validateResponse = await sendTcpCommand("validate_cron_expression", { 
				expression: cronExpr 
			});
			
			if (validateResponse.success) {
				console.log(`✅ Valid cron: ${cronExpr}`);
				console.log(`   Next runs: ${validateResponse.data.nextRuns?.slice(0, 2).join(", ") || "N/A"}`);
			} else {
				console.log(`❌ Invalid cron: ${cronExpr}`);
			}
		}
		
		// Test 4: Get scheduler statistics
		console.log("\\nTest 4: Getting scheduler statistics...");
		const statsResponse = await sendTcpCommand("get_scheduler_stats");
		if (statsResponse.success) {
			const stats = statsResponse.data;
			console.log("✅ Successfully retrieved scheduler stats:");
			console.log(`   Total schedules: ${stats.totalSchedules}`);
			console.log(`   Active schedules: ${stats.activeSchedules}`);
			console.log(`   Inactive schedules: ${stats.inactiveSchedules}`);
			console.log(`   Success rate: ${stats.successRate}%`);
		} else {
			console.log("❌ Failed to get scheduler stats:", statsResponse.error?.message);
		}
		
		// Test 5: Pause and resume scheduler
		console.log("\\nTest 5: Testing pause/resume functionality...");
		
		const pauseResponse = await sendTcpCommand("pause_scheduler");
		if (pauseResponse.success) {
			console.log("✅ Successfully paused scheduler");
		} else {
			console.log("❌ Failed to pause scheduler:", pauseResponse.error?.message);
		}
		
		await setTimeout(1000); // Wait a second
		
		const resumeResponse = await sendTcpCommand("resume_scheduler");
		if (resumeResponse.success) {
			console.log("✅ Successfully resumed scheduler");
		} else {
			console.log("❌ Failed to resume scheduler:", resumeResponse.error?.message);
		}
		
		// Test 6: Test invalid cron expression handling
		console.log("\\nTest 6: Testing invalid cron expression handling...");
		const invalidCronResponse = await sendTcpCommand("validate_cron_expression", { 
			expression: "invalid-cron-format" 
		});
		
		if (invalidCronResponse.success) {
			const validation = invalidCronResponse.data;
			if (!validation.isValid && validation.errors.length > 0) {
				console.log("✅ Correctly identified invalid cron expression");
				console.log(`   Errors: ${validation.errors.join(", ")}`);
			} else {
				console.log("❌ Failed to identify invalid cron expression");
			}
		} else {
			console.log("❌ Failed to validate invalid cron expression");
		}
		
		console.log("\\n🎉 All scheduler integration tests completed!");
		
	} catch (error) {
		console.error("❌ Integration test failed:", error);
	} finally {
		// Clean up: stop the daemon
		if (daemonProcess) {
			console.log("\\nStopping test daemon...");
			daemonProcess.kill("SIGTERM");
			await new Promise(resolve => setTimeout(resolve, 2000));
		}
	}
}

// Run the test
testSchedulerIntegration().catch(console.error);