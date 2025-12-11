#!/usr/bin/env node

// Simple test script for REST API endpoints (database-independent)
import http from "node:http";

const API_BASE = "http://localhost:3003";

// Helper function to make HTTP requests
function makeRequest(
	method: string,
	path: string,
	data?: Record<string, unknown>,
): Promise<{ status?: number; data: unknown }> {
	return new Promise((resolve, reject) => {
		const url = new URL(path, API_BASE);
		console.log(`Making ${method} request to: ${url.toString()}`);
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
					const result = JSON.parse(body);
					resolve({ status: res.statusCode as number, data: result });
				} catch (_error) {
					resolve({ status: res.statusCode as number, data: body });
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
		const response = await makeRequest("GET", "/api/health");
		console.log(`✅ Health check: ${response.status}`);
		console.log(`   Response:`, response.data);
		return true;
	} catch (error) {
		console.error(`❌ Health check failed:`, (error as Error).message);
		return false;
	}
}

async function testListTasks() {
	console.log("\n🔍 Testing task listing...");
	try {
		const response = await makeRequest("GET", "/api/tasks");
		console.log(`✅ List tasks: ${response.status}`);
		console.log(`   Response:`, response.data);
		return true;
	} catch (error) {
		console.error(`❌ List tasks failed:`, (error as Error).message);
		return false;
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
		const response = await makeRequest("POST", "/api/tasks", taskData);
		console.log(`✅ Create task: ${response.status}`);
		console.log(`   Response:`, response.data);
		return response.status === 201;
	} catch (error) {
		console.error(`❌ Create task failed:`, (error as Error).message);
		return false;
	}
}

async function testGetTask() {
	console.log("\n🔍 Testing get task with invalid ID...");
	try {
		const response = await makeRequest("GET", "/api/tasks/invalid-id");
		console.log(`✅ Get task (invalid): ${response.status}`);
		console.log(`   Response:`, response.data);
		return response.status === 404;
	} catch (error) {
		console.error(`❌ Get task failed:`, (error as Error).message);
		return false;
	}
}

async function testInvalidEndpoint() {
	console.log("\n🔍 Testing invalid endpoint...");
	try {
		const response = await makeRequest("GET", "/api/invalid-endpoint");
		console.log(`✅ Invalid endpoint: ${response.status}`);
		console.log(`   Response:`, response.data);
		return response.status === 404;
	} catch (error) {
		console.error(`❌ Invalid endpoint test failed:`, (error as Error).message);
		return false;
	}
}

async function testInvalidTaskData() {
	console.log("\n🔍 Testing invalid task data...");
	try {
		const response = await makeRequest("POST", "/tasks", { title: "" });
		console.log(`✅ Invalid task data: ${response.status}`);
		console.log(`   Response:`, response.data);
		return response.status === 500 || response.status === 400;
	} catch (error) {
		console.error(`❌ Invalid task data test failed:`, (error as Error).message);
		return false;
	}
}

// Main test runner
async function runTests() {
	console.log("🚀 Starting REST API Tests...");
	console.log("=====================================");

	const results = [];

	// Test basic functionality
	results.push(await testHealthCheck());
	results.push(await testListTasks());
	results.push(await testGetTask());
	results.push(await testCreateTask());

	// Test error handling
	results.push(await testInvalidEndpoint());
	results.push(await testInvalidTaskData());

	const passed = results.filter((r) => r).length;
	const total = results.length;

	console.log("\n=====================================");
	console.log(`✅ REST API Tests Completed!`);
	console.log(`📊 Results: ${passed}/${total} tests passed`);

	if (passed === total) {
		console.log("🎉 All tests passed!");
	} else {
		console.log("⚠️  Some tests failed");
	}
}

// Check if server is running, then run tests
async function checkServerAndRunTests() {
	try {
		const healthResponse = await makeRequest("GET", "/health");
		console.log("Debug - Health response:", healthResponse);
		if (healthResponse.status === 200) {
			await runTests();
		} else {
			console.error("❌ Server responded but health check failed");
			console.error("Status:", healthResponse.status);
			console.error("Response:", healthResponse.data);
			process.exit(1);
		}
	} catch (_error) {
		console.error("❌ Cannot connect to REST API server on port 3002");
		console.error("Please start the server with: npm run http-api");
		process.exit(1);
	}
}

// Run tests
checkServerAndRunTests().catch(console.error);
