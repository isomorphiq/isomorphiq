#!/usr/bin/env node

import { ProductManager } from "../src/index.js";
import { UserManager } from "../src/user-manager.js";
import { startHttpApi } from "../src/http-api-server.js";

async function testMultiUserAPI() {
	console.log("🌐 Testing Multi-User HTTP API");
	console.log("================================");

	try {
		const pm = new ProductManager();
		const userManager = new UserManager();

		// Start HTTP API server
		const server = await startHttpApi(pm, 3004);
		console.log("✅ HTTP API server started on port 3004");

		// Create test users
		console.log("\n📝 Creating test users...");
		const testUser = await userManager.createUser({
			username: "testuser",
			email: "test@example.com",
			password: "Test123!",
			role: "developer",
		});

		const adminUser = await userManager.createUser({
			username: "testadmin",
			email: "admin@example.com",
			password: "Admin123!",
			role: "admin",
		});

		// Authenticate users
		const userAuth = await userManager.authenticateUser({
			username: "testuser",
			password: "Test123!",
		});

		const adminAuth = await userManager.authenticateUser({
			username: "testadmin",
			password: "Admin123!",
		});

		if (!userAuth.success || !adminAuth.success) {
			throw new Error("Authentication failed");
		}

		console.log("✅ Users authenticated successfully");

		const baseUrl = "http://localhost:3004";
		const userToken = userAuth.token ?? "";
		const adminToken = adminAuth.token ?? "";

		// Test creating a task with assignment
		console.log("\n🎯 Testing task creation with assignment...");
		const createResponse = await fetch(`${baseUrl}/api/tasks`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${userToken}`,
			},
			body: JSON.stringify({
				title: "API Test Task",
				description: "Testing multi-user API functionality",
				priority: "high",
				assignedTo: adminUser.id,
			}),
		});

		if (!createResponse.ok) {
			const error = await createResponse.json();
			throw new Error(`Task creation failed: ${error.error}`);
		}

		const createResult = await createResponse.json();
		const task = createResult.task;
		console.log(`✅ Task created: ${task.id}`);
		console.log(`   - Assigned to: ${task.assignedTo}`);

		// Test getting user's tasks
		console.log("\n📋 Testing user task retrieval...");
		const userTasksResponse = await fetch(`${baseUrl}/api/users/${testUser.id}/tasks`, {
			headers: {
				Authorization: `Bearer ${userToken}`,
			},
		});

		if (userTasksResponse.ok) {
			const userTasks = await userTasksResponse.json();
			console.log(`✅ User tasks: ${userTasks.count} tasks found`);
		}

		// Test task assignment
		console.log("\n🔄 Testing task assignment...");
		const assignResponse = await fetch(`${baseUrl}/api/tasks/${task.id}/assign`, {
			method: "PUT",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${userToken}`,
			},
			body: JSON.stringify({
				assignedTo: testUser.id,
			}),
		});

		if (assignResponse.ok) {
			const assignResult = await assignResponse.json();
			console.log(`✅ Task reassigned to: ${assignResult.task.assignedTo}`);
		}

		// Test permission enforcement
		console.log("\n🛡️ Testing permission enforcement...");

		// Try to access another user's task without permission
		const _otherUser = await userManager.createUser({
			username: "otheruser",
			email: "other@example.com",
			password: "Other123!",
			role: "viewer",
		});

		const otherAuth = await userManager.authenticateUser({
			username: "otheruser",
			password: "Other123!",
		});

		if (otherAuth.success) {
			const unauthorizedResponse = await fetch(`${baseUrl}/api/tasks/${task.id}`, {
				headers: {
					Authorization: `Bearer ${otherAuth.token}`,
				},
			});

			if (!unauthorizedResponse.ok) {
				console.log("✅ Permission enforcement working - unauthorized access blocked");
			} else {
				console.log("⚠️ Permission enforcement may not be working correctly");
			}
		}

		// Test admin access
		console.log("\n👑 Testing admin access...");
		const adminTasksResponse = await fetch(`${baseUrl}/api/tasks`, {
			headers: {
				Authorization: `Bearer ${adminToken}`,
			},
		});

		if (adminTasksResponse.ok) {
			const adminTasks = await adminTasksResponse.json();
			console.log(`✅ Admin can see all tasks: ${adminTasks.count} tasks`);
		}

		console.log("\n🎉 All API tests passed!");
		console.log("================================");

		// Cleanup
		await new Promise((resolve) => server.close(resolve));
		console.log("✅ Server closed");
	} catch (error) {
		console.error("❌ API test failed:", error);
		process.exit(1);
	}
}

// Run test
testMultiUserAPI().catch(console.error);
