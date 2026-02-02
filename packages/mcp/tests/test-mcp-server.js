#!/usr/bin/env node

/**
 * MCP Server Test Script
 *
 * Tests the MCP server functionality by making direct tool calls
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");
const entryPoint = path.join(packageRoot, "src", "mcp-server.ts");
const tasksEntryPoint = path.resolve(packageRoot, "..", "tasks", "src", "task-service-server.ts");
const tasksPort = process.env.MCP_TEST_TASKS_PORT || "3016";
const dbPath = process.env.MCP_TEST_DB_PATH || path.join(packageRoot, ".mcp-test-db");

console.log("🧪 Testing MCP Server functionality...\n");

// Start tasks microservice
const tasksProcess = spawn("node", ["--experimental-strip-types", tasksEntryPoint], {
    cwd: packageRoot,
    env: {
        ...process.env,
        TASKS_HTTP_PORT: tasksPort,
        TASKS_PORT: tasksPort,
        DB_PATH: dbPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
});

tasksProcess.stdout.on("data", (data) => {
    const output = data.toString();
    if (output.includes("Task service listening")) {
        console.log(output.trim());
    }
});

tasksProcess.stderr.on("data", (data) => {
    console.error("⚠️ Tasks service stderr:", data.toString());
});

// Start MCP server
const mcpProcess = spawn("node", ["--experimental-strip-types", entryPoint], {
    cwd: packageRoot,
    env: {
        ...process.env,
        TASKS_HTTP_PORT: tasksPort,
        TASKS_PORT: tasksPort,
    },
    stdio: ["pipe", "pipe", "pipe"],
});

let responseBuffer = "";
let errorBuffer = "";

const cleanup = (code = 0) => {
    if (!mcpProcess.killed) {
        mcpProcess.kill();
    }
    if (!tasksProcess.killed) {
        tasksProcess.kill();
    }
    process.exit(code);
};

mcpProcess.stdout.on("data", (data) => {
	responseBuffer += data.toString();
});

mcpProcess.stderr.on("data", (data) => {
	errorBuffer += data.toString();
});

// Wait for server to start
setTimeout(() => {
	console.log("📤 Sending test requests...\n");

	// Test 1: List tools
	const listToolsRequest = {
		jsonrpc: "2.0",
		id: 1,
		method: "tools/list",
		params: {},
	};

	mcpProcess.stdin.write(`${JSON.stringify(listToolsRequest)}\n`);

	// Wait for response and send more tests
	setTimeout(() => {
		console.log("📥 Response from list tools:");
		console.log(responseBuffer);
		console.log("\n");

		// Test 2: Create a task
		const createTaskRequest = {
			jsonrpc: "2.0",
			id: 2,
			method: "tools/call",
			params: {
				name: "create_task",
				arguments: {
					title: "Test Task",
					description: "This is a test task created by the test script",
					priority: "medium",
				},
			},
		};

		responseBuffer = ""; // Clear buffer
		mcpProcess.stdin.write(`${JSON.stringify(createTaskRequest)}\n`);

		// Wait for response and test listing tasks
		setTimeout(() => {
			console.log("📥 Response from create task:");
			console.log(responseBuffer);
			console.log("\n");

			// Test 3: List tasks
			const listTasksRequest = {
				jsonrpc: "2.0",
				id: 3,
				method: "tools/call",
				params: {
					name: "list_tasks",
					arguments: {},
				},
			};

			responseBuffer = ""; // Clear buffer
			mcpProcess.stdin.write(`${JSON.stringify(listTasksRequest)}\n`);

			// Final response
			setTimeout(() => {
				console.log("📥 Response from list tasks:");
				console.log(responseBuffer);
				console.log("\n✅ MCP Server test completed!");

				cleanup(0);
			}, 1000);
		}, 1000);
	}, 1000);
}, 2000);

// Handle errors
mcpProcess.on("error", (error) => {
	console.error("❌ MCP Server failed to start:", error.message);
	cleanup(1);
});

mcpProcess.on("exit", (code) => {
	if (code !== 0 && code !== null) {
		console.error(`❌ MCP Server exited with code ${code}`);
		console.error("Error output:", errorBuffer);
		cleanup(code);
	}
});

tasksProcess.on("error", (error) => {
    console.error("❌ Tasks service failed to start:", error.message);
    cleanup(1);
});

tasksProcess.on("exit", (code) => {
    if (code !== 0 && code !== null) {
        console.error(`❌ Tasks service exited with code ${code}`);
        cleanup(code);
    }
});

// Timeout
setTimeout(() => {
	console.error("⏰ Test timed out");
	cleanup(1);
}, 10000);
