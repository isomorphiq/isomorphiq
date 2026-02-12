import "../../../tests/test-utils/env-fetch.ts";
import { UserManager } from "@isomorphiq/auth";

const API_BASE = "http://localhost:3003";

async function testCompleteAuthFlow() {
	console.log("🔐 Testing Complete Authentication Flow");

	try {
		const userManager = new UserManager();

		// Step 1: Create a user directly via service (bypass auth for setup)
		console.log("\n📝 Step 1: Creating test user via service...");
		const testUser = {
			username: `flowtest_${Date.now()}`,
			email: `flowtest_${Date.now()}@example.com`,
			password: "TestPassword123!",
			role: "developer",
			profile: {
				firstName: "Flow",
				lastName: "Test",
			},
		};

		const user = await userManager.createUser(testUser);
		console.log("✅ User created:", user.username);

		// Step 2: Authenticate via API
		console.log("\n🔑 Step 2: Authenticating via API...");
		const loginResponse = await fetch(`${API_BASE}/api/auth/login`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				username: testUser.username,
				password: testUser.password,
			}),
		});

		if (loginResponse.ok) {
			const loginData = await loginResponse.json();
			console.log("✅ API login successful");
			const token = loginData.token;

			// Step 3: Test protected endpoint
			console.log("\n🛡️ Step 3: Testing protected endpoint...");
			const meResponse = await fetch(`${API_BASE}/api/auth/me`, {
				headers: { Authorization: `Bearer ${token}` },
			});

			if (meResponse.ok) {
				const meData = await meResponse.json();
				console.log("✅ Protected endpoint works");
				console.log("   User:", meData.user.username);
				console.log("   Role:", meData.user.role);
			} else {
				console.error("❌ Protected endpoint failed");
			}

			// Step 4: Test profile update via API
			console.log("\n👤 Step 4: Testing profile update via API...");
			const profileResponse = await fetch(`${API_BASE}/api/auth/profile`, {
				method: "PUT",
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					profile: {
						bio: "Updated via complete flow test",
					},
					preferences: {
						theme: "light",
					},
				}),
			});

			if (profileResponse.ok) {
				const profileData = await profileResponse.json();
				console.log("✅ Profile update via API works");
				console.log("   New bio:", profileData.user.profile.bio);
				console.log("   New theme:", profileData.user.preferences.theme);
			} else {
				console.error("❌ Profile update via API failed");
			}

			// Step 5: Test password change via API
			console.log("\n🔒 Step 5: Testing password change via API...");
			const passwordResponse = await fetch(`${API_BASE}/api/auth/password`, {
				method: "PUT",
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					currentPassword: testUser.password,
					newPassword: "NewTestPassword456!",
				}),
			});

			if (passwordResponse.ok) {
				console.log("✅ Password change via API works");
			} else {
				const errorData = await passwordResponse.json();
				console.error("❌ Password change via API failed:", errorData.error);
			}

			// Step 6: Test logout via API
			console.log("\n🚪 Step 6: Testing logout via API...");
			const logoutResponse = await fetch(`${API_BASE}/api/auth/logout`, {
				method: "POST",
				headers: { Authorization: `Bearer ${token}` },
			});

			if (logoutResponse.ok) {
				console.log("✅ Logout via API works");
			} else {
				console.error("❌ Logout via API failed");
			}

			// Step 7: Verify session is invalidated
			console.log("\n🚫 Step 7: Verifying session invalidation...");
			const meAfterLogoutResponse = await fetch(`${API_BASE}/api/auth/me`, {
				headers: { Authorization: `Bearer ${token}` },
			});

			if (!meAfterLogoutResponse.ok) {
				console.log("✅ Session properly invalidated after logout");
			} else {
				console.error("❌ Session still valid after logout");
			}
		} else {
			const error = await loginResponse.text();
			console.error("❌ API login failed:", error);
		}

		console.log("\n🎉 Complete authentication flow test finished!");
	} catch (error) {
		console.error("❌ Complete flow test failed:", error);
	}
}

// Run the test
testCompleteAuthFlow().catch(console.error);
