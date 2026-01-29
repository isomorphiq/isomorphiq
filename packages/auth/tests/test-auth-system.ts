import "../../../tests/test-utils/env-fetch.ts";
import { UserManager, AuthService, PermissionService } from "@isomorphiq/auth";
import type { CreateUserInput, UserRole } from "@isomorphiq/auth";

async function runAuthTests() {
	console.log("🧪 Running Authentication and Authorization Tests...\n");

	const userManager = new UserManager();
	const authService = new AuthService();
	const permissionService = new PermissionService();

	try {
		// Test 1: User Creation with Enhanced Schema
		console.log("Test 1: User Creation with Enhanced Schema");
		const testUser: CreateUserInput = {
			username: `testuser_${Date.now()}`,
			email: `test${Date.now()}@example.com`,
			password: "SecurePass123!",
			role: "developer",
			profile: {
				firstName: "Test",
				lastName: "User",
				timezone: "UTC",
				language: "en",
			},
			preferences: {
				theme: "dark",
				notifications: {
					email: true,
					push: false,
					taskAssigned: true,
					taskCompleted: false,
					taskOverdue: true,
				},
				dashboard: {
					defaultView: "kanban",
					itemsPerPage: 50,
					showCompleted: true,
				},
			},
		};

		const user = await userManager.createUser(testUser);
		console.log("✅ User created successfully:", user.username);
		console.log("   Profile:", user.profile);
		console.log("   Preferences theme:", user.preferences.theme);
		console.log("   Email verified:", user.isEmailVerified);
		console.log("   Failed attempts:", user.failedLoginAttempts);
		console.log();

		// Test 2: Password Strength Validation
		console.log("Test 2: Password Strength Validation");
		const weakPasswords = ["123", "password", "Password", "Password123", "Pass123!"];

		weakPasswords.forEach((password) => {
			const validation = authService.validatePasswordStrength(password);
			console.log(`   Password "${password}": ${validation.isValid ? "✅ Valid" : "❌ Invalid"}`);
			if (!validation.isValid) {
				console.log(`     Errors: ${validation.errors.join(", ")}`);
			}
		});

		const strongPassword = "SecurePass123!@#";
		const strongValidation = authService.validatePasswordStrength(strongPassword);
		console.log(
			`   Password "${strongPassword}": ${strongValidation.isValid ? "✅ Valid" : "❌ Invalid"}`,
		);
		console.log();

		// Test 3: Authentication with JWT
		console.log("Test 3: Authentication with JWT");
		const authResult = await userManager.authenticateUser({
			username: "testuser",
			password: "SecurePass123!",
		});

		if (authResult.success) {
			console.log("✅ Authentication successful");
			console.log("   Token received:", !!authResult.token);
			console.log("   Refresh token received:", !!authResult.refreshToken);
			console.log("   Expires in:", authResult.expiresIn, "seconds");
			console.log("   User role:", authResult.user?.role);

			if (authResult.token) {
				// Test 4: Token Validation
				console.log("\nTest 4: Token Validation");
				const tokenValidation = authService.verifyToken(authResult.token);
				console.log("   Token valid:", tokenValidation.valid);
				console.log("   User ID from token:", tokenValidation.userId);

				// Test 5: Session Validation
				console.log("\nTest 5: Session Validation");
				const sessionUser = await userManager.validateSession(authResult.token);
				console.log("   Session valid:", !!sessionUser);
				console.log("   Session user:", sessionUser?.username);

				// Test 6: Token Refresh
				console.log("\nTest 6: Token Refresh");
				if (authResult.refreshToken) {
					const refreshResult = await userManager.refreshToken(authResult.refreshToken);
					console.log("   Refresh successful:", refreshResult.success);
					if (refreshResult.success) {
						console.log("   New token received:", !!refreshResult.token);
						console.log("   New refresh token received:", !!refreshResult.refreshToken);
					}
				}
			}
		} else {
			console.log("❌ Authentication failed:", authResult.error);
		}
		console.log();

		// Test 7: Role-Based Permissions
		console.log("Test 7: Role-Based Permissions");
		const roles: UserRole[] = ["admin", "manager", "developer", "viewer"];

		roles.forEach((role) => {
			const permissions = permissionService.getRolePermissions(role);
			console.log(`\n   ${role.toUpperCase()} Role Permissions:`);

			const resourceGroups: Record<string, string[]> = {};
			permissions.forEach((p) => {
				if (!resourceGroups[p.resource]) {
					resourceGroups[p.resource] = [];
				}
				const resourceActions = resourceGroups[p.resource];
				if (resourceActions) {
					resourceActions.push(p.action);
				}
			});

			Object.entries(resourceGroups).forEach(([resource, actions]) => {
				console.log(`     ${resource}: ${actions.join(", ")}`);
			});
		});

		// Test 8: Permission Evaluation
		console.log("\nTest 8: Permission Evaluation");
		const userPermissions = await userManager.getUserPermissions(user);

		const testCases = [
			{ resource: "tasks", action: "create", context: { userId: user.id } },
			{ resource: "tasks", action: "delete", context: { userId: user.id, taskCreatedBy: user.id } },
			{ resource: "users", action: "read", context: { userId: user.id } },
			{ resource: "users", action: "delete", context: { userId: user.id } },
			{ resource: "system", action: "manage", context: { userId: user.id } },
		];

		for (const testCase of testCases) {
			const hasPermission = await permissionService.hasPermission(
				userPermissions,
				testCase.resource,
				testCase.action,
				testCase.context,
			);
			console.log(
				`   ${testCase.resource}:${testCase.action} - ${hasPermission ? "✅ Granted" : "❌ Denied"}`,
			);
		}

		// Test 9: Profile Management
		console.log("\nTest 9: Profile Management");
		const profileUpdate = {
			profile: {
				firstName: "Updated",
				lastName: "Name",
				bio: "Updated bio",
			},
			preferences: {
				theme: "light" as const,
				dashboard: {
					defaultView: "list" as const,
					itemsPerPage: 25,
					showCompleted: false,
				},
			},
		};

		const updateData = { userId: user.id, ...profileUpdate };
		const updatedUser = await userManager.updateProfile(updateData);

		console.log("✅ Profile updated successfully");
		console.log("   New first name:", updatedUser.profile.firstName);
		console.log("   New theme:", updatedUser.preferences.theme);
		console.log("   New dashboard view:", updatedUser.preferences.dashboard.defaultView);

		// Test 10: Session Management
		console.log("\nTest 10: Session Management");

		// Create multiple sessions
		const _auth1 = await userManager.authenticateUser({
			username: "testuser",
			password: "SecurePass123!",
		});
		const _auth2 = await userManager.authenticateUser({
			username: "testuser",
			password: "SecurePass123!",
		});

		const userSessions = await userManager.getUserSessions(user.id);
		console.log(`   Active sessions: ${userSessions.length}`);

		// Invalidate all sessions
		await userManager.invalidateAllUserSessions(user.id);
		const sessionsAfterInvalidation = await userManager.getUserSessions(user.id);
		console.log(`   Sessions after invalidation: ${sessionsAfterInvalidation.length}`);
		console.log("✅ Session management working correctly");

		// Test 11: Password Change
		console.log("\nTest 11: Password Change");
		await userManager.changePassword({
			userId: user.id,
			currentPassword: "SecurePass123!",
			newPassword: "NewSecurePass456!@#",
		});
		console.log("✅ Password changed successfully");

		// Test 12: Device Info Extraction
		console.log("\nTest 12: Device Info Extraction");
		const userAgents = [
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
			"Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.1 Mobile/15E148 Safari/604.1",
			"Mozilla/5.0 (iPad; CPU OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.1 Mobile/15E148 Safari/604.1",
		];

		userAgents.forEach((ua, index) => {
			const deviceInfo = authService.extractDeviceInfo(ua);
			console.log(
				`   Device ${index + 1}: ${deviceInfo.type} - ${deviceInfo.os} ${deviceInfo.browser}`,
			);
		});

		console.log("\n🎉 All authentication and authorization tests completed successfully!");
	} catch (error) {
		console.error("❌ Test failed:", error);
		process.exit(1);
	}
}

// Run the tests
runAuthTests().catch(console.error);
