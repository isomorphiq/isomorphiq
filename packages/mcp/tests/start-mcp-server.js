#!/usr/bin/env node

/**
 * MCP Server Launcher for OpenCode Integration
 *
 * This script starts the MCP server and provides configuration
 * for OpenCode to connect to it.
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");
const entryPoint = path.join(packageRoot, "src", "mcp-server.ts");

console.log("🚀 Starting Task Manager MCP Server for OpenCode...");

// Start the MCP server
const mcpProcess = spawn("node", ["--experimental-strip-types", entryPoint], {
    cwd: packageRoot,
    stdio: "inherit",
    env: {
        ...process.env,
        NODE_ENV: "development",
        LOG_LEVEL: "debug",
    },
});

console.log("📡 MCP Server started on stdio");
console.log("🔗 Configure OpenCode to use this MCP server:");
console.log("");
console.log("opencode config set mcp.servers.task-manager \\");
console.log(`  '{"command": "node", "args": ["${entryPoint}"], "env": {}}'`);
console.log("");
console.log("Or run OpenCode with MCP server inline:");
console.log(
    `opencode run --mcp-server '{"name": "task-manager", "command": "node", "args": ["${entryPoint}"]}' "Your prompt here"`,
);
console.log("");
console.log("Available MCP tools:");
console.log("- create_task: Create new tasks with priority");
console.log("- list_tasks: List all tasks");
console.log("- get_task: Get specific task by ID");
console.log("- update_task_status: Update task status");
console.log("- update_task_priority: Update task priority");
console.log("- delete_task: Delete tasks");
console.log("");
console.log("Press Ctrl+C to stop the MCP server");

// Handle process termination
process.on("SIGINT", () => {
	console.log("\n🛑 Stopping MCP Server...");
	mcpProcess.kill();
	process.exit(0);
});

process.on("SIGTERM", () => {
	console.log("\n🛑 Stopping MCP Server...");
	mcpProcess.kill();
	process.exit(0);
});

// Handle MCP server exit
mcpProcess.on("exit", (code) => {
	console.log(`\n📴 MCP Server exited with code ${code}`);
	process.exit(code || 0);
});
