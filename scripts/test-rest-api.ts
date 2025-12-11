#!/usr/bin/env node

// Test script for REST API endpoints
import http from "node:http";

const API_BASE = "http://localhost:3002/api";

interface ApiResponse<T = unknown> {
	status: number | undefined;
	data: T;
}

interface TaskResponse {
	task?: {
		id: string;
	};
}

interface TasksResponse {
	count: number;
	tasks: unknown[];
}

interface TaskUpdateResponse {
	success: boolean;
	task: unknown;
}

// Helper function to make HTTP requests
function makeRequest<T = unknown>(
	method: string,
	path: string,
	data?: Record<string, unknown>,
): Promise<ApiResponse<T>> {
	return new Promise((resolve, reject) => {
		const url = new URL(path, API_BASE);
		const options = {
			hostname: url.hostname,
			port: url.port,
			path: url.pathname + url.search,
			method: method,
			headers: {
				"Content-Type": "application/json",
			},
		};

		const req = http.request(options, (res) => {
			let body = "";
			res.on("data", (chunk) => {
				body += chunk;
			});
			res.on("end", () => {
				try {
					const result = JSON.parse(body) as T;
					resolve({ status: res.statusCode, data: result });
				} catch (_error) {
					resolve({ status: res.statusCode, data: body as T });
				}
			});
		});

		req.on("error", (error) => {
			reject(error);
		});

		if (data) {
			req.write(JSON.stringify(data));
		}

		req.end();
	});
}

// Test functions
async function testHealthCheck() {
	console.log("\n🔍 Testing health check...");
	try {
		const response = await makeRequest("GET", "/health");
		console.log(`✅ Health check: ${response.status}`);
		console.log(`   Response:`, response.data);
	} catch (error) {
		console.error(
			`❌ Health check failed:`,
			error instanceof Error ? error instanceof Error ? error.message : String(error) : String(error),
		);
	}
}

async function testCreateTask() {
	console.log("\n🔍 Testing task creation...");
	try {
		const taskData = {
			title: "Test REST API Task",
			description: "This is a test task created via REST API",
			priority: "high",
		};
		const response = await makeRequest<TaskResponse>("POST", "/tasks", taskData);
		console.log(`✅ Create task: ${response.status}`);
		console.log(`   Response:`, response.data);
		return response.data.task?.id;
	} catch (error) {
		console.error(`❌ Create task failed:`, error instanceof Error ? error instanceof Error ? error.message : String(error) : String(error));
		return null;
	}
}

async function testListTasks() {
	console.log("\n🔍 Testing task listing...");
	try {
		const response = await makeRequest<TasksResponse>("GET", "/tasks");
		console.log(`✅ List tasks: ${response.status}`);
		console.log(`   Found ${response.data.count} tasks`);
		return response.data.tasks;
	} catch (error) {
		console.error(`❌ List tasks failed:`, error instanceof Error ? error.message : String(error));
		return [];
	}
}

async function testGetTask(taskId: string) {
	console.log(`\n🔍 Testing get task ${taskId}...`);
	try {
		const response = await makeRequest<TaskUpdateResponse>("GET", `/tasks/${taskId}`);
		console.log(`✅ Get task: ${response.status}`);
		console.log(`   Response:`, response.data);
	} catch (error) {
		console.error(`❌ Get task failed:`, error instanceof Error ? error.message : String(error));
	}
}

async function testUpdateTaskStatus(taskId: string) {
	console.log(`\n🔍 Testing update task status ${taskId}...`);
	try {
		const response = await makeRequest<TaskUpdateResponse>("PUT", `/tasks/${taskId}/status`, {
			status: "in-progress",
		});
		console.log(`✅ Update task status: ${response.status}`);
		console.log(`   Response:`, response.data);
	} catch (error) {
		console.error(`❌ Update task status failed:`, error instanceof Error ? error.message : String(error));
	}
}

async function testUpdateTaskPriority(taskId: string) {
	console.log(`\n🔍 Testing update task priority ${taskId}...`);
	try {
		const response = await makeRequest<TaskUpdateResponse>("PUT", `/tasks/${taskId}/priority`, {
			priority: "medium",
		});
		console.log(`✅ Update task priority: ${response.status}`);
		console.log(`   Response:`, response.data);
	} catch (error) {
		console.error(`❌ Update task priority failed:`, error instanceof Error ? error.message : String(error));
	}
}

async function testGetTasksByStatus() {
	console.log("\n🔍 Testing get tasks by status...");
	try {
		const response = await makeRequest<TasksResponse>("GET", "/tasks/status/todo");
		console.log(`✅ Get tasks by status: ${response.status}`);
		console.log(`   Found ${response.data.count} todo tasks`);
	} catch (error) {
		console.error(`❌ Get tasks by status failed:`, error instanceof Error ? error.message : String(error));
	}
}

async function testGetTasksByPriority() {
	console.log("\n🔍 Testing get tasks by priority...");
	try {
		const response = await makeRequest<TasksResponse>("GET", "/tasks/priority/high");
		console.log(`✅ Get tasks by priority: ${response.status}`);
		console.log(`   Found ${response.data.count} high priority tasks`);
	} catch (error) {
		console.error(`❌ Get tasks by priority failed:`, error instanceof Error ? error.message : String(error));
	}
}

async function testGetStats() {
	console.log("\n🔍 Testing get task statistics...");
	try {
		const response = await makeRequest("GET", "/stats");
		console.log(`✅ Get stats: ${response.status}`);
		console.log(`   Response:`, response.data);
	} catch (error) {
		console.error(`❌ Get stats failed:`, error instanceof Error ? error.message : String(error));
	}
}

async function testDeleteTask(taskId: string) {
	console.log(`\n🔍 Testing delete task ${taskId}...`);
	try {
		const response = await makeRequest<TaskUpdateResponse>("DELETE", `/tasks/${taskId}`);
		console.log(`✅ Delete task: ${response.status}`);
		console.log(`   Response:`, response.data);
	} catch (error) {
		console.error(`❌ Delete task failed:`, error instanceof Error ? error.message : String(error));
	}
}

async function testErrorHandling() {
	console.log("\n🔍 Testing error handling...");
	try {
		// Test invalid endpoint
		const response = await makeRequest("GET", "/invalid-endpoint");
		console.log(`✅ Invalid endpoint: ${response.status}`);
	} catch (error) {
		console.error(`❌ Error handling test failed:`, error instanceof Error ? error.message : String(error));
	}

	try {
		// Test invalid task data
		const response = await makeRequest("POST", "/tasks", { title: "" });
		console.log(`✅ Invalid task data: ${response.status}`);
	} catch (error) {
		console.error(`❌ Invalid task data test failed:`, error instanceof Error ? error.message : String(error));
	}
}

// Main test runner
async function runTests() {
	console.log("🚀 Starting REST API Tests...");
	console.log("=====================================");

	// Test basic functionality
	await testHealthCheck();
	await testListTasks();
	await testGetStats();
	await testGetTasksByStatus();
	await testGetTasksByPriority();

	// Test CRUD operations
	const taskId = await testCreateTask();
	if (taskId) {
		await testGetTask(taskId);
		await testUpdateTaskStatus(taskId);
		await testUpdateTaskPriority(taskId);
		await testDeleteTask(taskId);
	}

	// Test error handling
	await testErrorHandling();

	console.log("\n=====================================");
	console.log("✅ REST API Tests Completed!");
}

// Check if server is running, then run tests
async function checkServerAndRunTests() {
	try {
		await makeRequest("GET", "/health");
		await runTests();
	} catch (_error) {
		console.error("❌ Cannot connect to REST API server on port 3002");
		console.error("Please start the server with: npm run http-api");
		process.exit(1);
	}
}

// Run tests
checkServerAndRunTests().catch(console.error);
