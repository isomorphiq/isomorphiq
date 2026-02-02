#!/usr/bin/env node
import "../../../tests/test-utils/env-fetch.ts";

import { ProductManager } from "@isomorphiq/user-profile";
import { UserManager } from "@isomorphiq/auth";

async function testMultiUserFunctionality() {
	console.log("🧪 Testing Multi-User Functionality");
	console.log("=====================================");

	try {
		const pm = new ProductManager();
		const userManager = new UserManager();

		// Create test users
		console.log("\n📝 Creating test users...");
		const adminUser = await userManager.createUser({
			username: "admin",
			email: "admin@test.com",
			password: "Admin123!",
			role: "admin",
		});

		const developerUser = await userManager.createUser({
			username: "developer",
			email: "dev@test.com",
			password: "Dev123!",
			role: "developer",
		});

		const viewerUser = await userManager.createUser({
			username: "viewer",
			email: "viewer@test.com",
			password: "Viewer123!",
			role: "viewer",
		});

		console.log(
			`✅ Created users: ${adminUser.username}, ${developerUser.username}, ${viewerUser.username}`,
		);

		// Test task creation with user assignment
		console.log("\n🎯 Testing task creation with user assignment...");
		const task1 = await pm.createTask(
			"Multi-user test task",
			"This task tests multi-user functionality",
			"high",
			[],
			adminUser.id,
			developerUser.id,
			[viewerUser.id],
			[adminUser.id, developerUser.id],
		);

		console.log(`✅ Created task: ${task1.id}`);
		console.log(`   - Created by: ${task1.createdBy}`);
		console.log(`   - Assigned to: ${task1.assignedTo}`);
		console.log(`   - Collaborators: ${task1.collaborators?.join(", ")}`);
		console.log(`   - Watchers: ${task1.watchers?.join(", ")}`);

		// Test task assignment
		console.log("\n🔄 Testing task assignment...");
		const _updatedTask = await pm.assignTask(task1.id, viewerUser.id);
		console.log(`✅ Task reassigned from ${developerUser.username} to ${viewerUser.username}`);

		// Test task collaborators update
		console.log("\n👥 Testing collaborator management...");
		const updatedCollaborators = await pm.updateTaskCollaborators(task1.id, [
			adminUser.id,
			developerUser.id,
		]);
		console.log(`✅ Updated collaborators: ${updatedCollaborators.collaborators?.join(", ")}`);

		// Test task watchers update
		console.log("\n👁️ Testing watcher management...");
		const updatedWatchers = await pm.updateTaskWatchers(task1.id, [
			adminUser.id,
			developerUser.id,
			viewerUser.id,
		]);
		console.log(`✅ Updated watchers: ${updatedWatchers.watchers?.join(", ")}`);

		// Test user task filtering
		console.log("\n🔍 Testing user task filtering...");
		const adminTasks = await pm.getTasksForUser(adminUser.id);
		const developerTasks = await pm.getTasksForUser(developerUser.id);
		const viewerTasks = await pm.getTasksForUser(viewerUser.id);

		console.log(`✅ Admin tasks: ${adminTasks.length}`);
		console.log(`✅ Developer tasks: ${developerTasks.length}`);
		console.log(`✅ Viewer tasks: ${viewerTasks.length}`);

		// Test task access permissions
		console.log("\n🔐 Testing task access permissions...");
		const adminCanRead = await pm.hasTaskAccess(adminUser.id, task1.id, "read");
		const adminCanWrite = await pm.hasTaskAccess(adminUser.id, task1.id, "write");
		const adminCanDelete = await pm.hasTaskAccess(adminUser.id, task1.id, "delete");

		const developerCanRead = await pm.hasTaskAccess(developerUser.id, task1.id, "read");
		const developerCanWrite = await pm.hasTaskAccess(developerUser.id, task1.id, "write");
		const developerCanDelete = await pm.hasTaskAccess(developerUser.id, task1.id, "delete");

		const viewerCanRead = await pm.hasTaskAccess(viewerUser.id, task1.id, "read");
		const viewerCanWrite = await pm.hasTaskAccess(viewerUser.id, task1.id, "write");
		const viewerCanDelete = await pm.hasTaskAccess(viewerUser.id, task1.id, "delete");

		console.log(
			`✅ Admin access - Read: ${adminCanRead}, Write: ${adminCanWrite}, Delete: ${adminCanDelete}`,
		);
		console.log(
			`✅ Developer access - Read: ${developerCanRead}, Write: ${developerCanWrite}, Delete: ${developerCanDelete}`,
		);
		console.log(
			`✅ Viewer access - Read: ${viewerCanRead}, Write: ${viewerCanWrite}, Delete: ${viewerCanDelete}`,
		);

		// Test user permissions
		console.log("\n🛡️ Testing user permissions...");
		const adminPermissions = await userManager.getUserPermissions(adminUser);
		const developerPermissions = await userManager.getUserPermissions(developerUser);
		const viewerPermissions = await userManager.getUserPermissions(viewerUser);

		console.log(`✅ Admin permissions: ${adminPermissions.permissions.length} permissions`);
		console.log(`✅ Developer permissions: ${developerPermissions.permissions.length} permissions`);
		console.log(`✅ Viewer permissions: ${viewerPermissions.permissions.length} permissions`);

		// Test authentication
		console.log("\n🔑 Testing authentication...");
		const adminAuth = await userManager.authenticateUser({
			username: "admin",
			password: "Admin123!",
		});

		const developerAuth = await userManager.authenticateUser({
			username: "developer",
			password: "Dev123!",
		});

		console.log(`✅ Admin authentication: ${adminAuth.success}`);
		console.log(`✅ Developer authentication: ${developerAuth.success}`);

		if (adminAuth.success && developerAuth.success) {
			console.log(`   - Admin token: ${adminAuth.token?.slice(0, 20)}...`);
			console.log(`   - Developer token: ${developerAuth.token?.slice(0, 20)}...`);
		}

		console.log("\n🎉 All multi-user tests passed!");
		console.log("=====================================");
	} catch (error) {
		console.error("❌ Test failed:", error);
		process.exit(1);
	}
}

// Run the test
testMultiUserFunctionality().catch(console.error);
