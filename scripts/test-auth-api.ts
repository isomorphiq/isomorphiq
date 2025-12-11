import fetch from "node-fetch";

const API_BASE = "http://localhost:3003";

async function testAuthAPI() {
	console.log("🌐 Testing Authentication API Endpoints...\n");

	try {
		// Test 1: Create user via API
		console.log("Test 1: Create user via API");
		const createUserResponse = await fetch(`${API_BASE}/api/users`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				username: "apiuser",
				email: "apiuser@example.com",
				password: "SecurePass123!",
				role: "developer",
				profile: {
					firstName: "API",
					lastName: "User",
				},
			}),
		});

		if (createUserResponse.ok) {
			const userData = (await createUserResponse.json()) as { user: { username: string } };
			console.log("✅ User created via API:", userData.user.username);
		} else {
			const error = await createUserResponse.text();
			console.log("❌ User creation failed:", error);
		}

		// Test 2: Login
		console.log("\nTest 2: Login");
		const loginResponse = await fetch(`${API_BASE}/api/auth/login`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				username: "apiuser",
				password: "SecurePass123!",
			}),
		});

		if (loginResponse.ok) {
			const loginData = (await loginResponse.json()) as { token: string; refreshToken?: string };
			console.log("✅ Login successful");
			console.log("   Token received:", !!loginData.token);
			console.log("   Refresh token received:", !!loginData.refreshToken);

			const token = loginData.token;

			// Test 3: Get current user
			console.log("\nTest 3: Get current user");
			const meResponse = await fetch(`${API_BASE}/api/auth/me`, {
				headers: { Authorization: `Bearer ${token}` },
			});

			if (meResponse.ok) {
				const meData = (await meResponse.json()) as {
					user: {
						username: string;
						role: string;
						profile: { firstName: string; lastName: string };
					};
				};
				console.log("✅ Current user retrieved:", meData.user.username);
				console.log("   Role:", meData.user.role);
				console.log("   Profile:", meData.user.profile.firstName, meData.user.profile.lastName);
			} else {
				console.log("❌ Failed to get current user");
			}

			// Test 4: Update profile
			console.log("\nTest 4: Update profile");
			const profileResponse = await fetch(`${API_BASE}/api/auth/profile`, {
				method: "PUT",
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					profile: {
						bio: "Updated via API",
					},
					preferences: {
						theme: "dark",
					},
				}),
			});

			if (profileResponse.ok) {
				const profileData = (await profileResponse.json()) as {
					user: { profile: { bio: string }; preferences: { theme: string } };
				};
				console.log("✅ Profile updated via API");
				console.log("   New bio:", profileData.user.profile.bio);
				console.log("   New theme:", profileData.user.preferences.theme);
			} else {
				console.log("❌ Profile update failed");
			}

			// Test 5: Get permissions
			console.log("\nTest 5: Get permissions");
			const permissionsResponse = await fetch(`${API_BASE}/api/auth/permissions`, {
				headers: { Authorization: `Bearer ${token}` },
			});

			if (permissionsResponse.ok) {
				const permissionsData = (await permissionsResponse.json()) as {
					userPermissions: { role: string };
					availableResources: unknown[];
				};
				console.log("✅ Permissions retrieved");
				console.log("   User role:", permissionsData.userPermissions.role);
				console.log("   Available resources:", permissionsData.availableResources.length);
			} else {
				console.log("❌ Failed to get permissions");
			}

			// Test 6: Refresh token
			console.log("\nTest 6: Refresh token");
			if (loginData.refreshToken) {
				const refreshResponse = await fetch(`${API_BASE}/api/auth/refresh`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						refreshToken: loginData.refreshToken,
					}),
				});

				if (refreshResponse.ok) {
					const refreshData = (await refreshResponse.json()) as { token: string };
					console.log("✅ Token refreshed");
					console.log("   New token received:", !!refreshData.token);
				} else {
					console.log("❌ Token refresh failed");
				}
			}

			// Test 7: Logout
			console.log("\nTest 7: Logout");
			const logoutResponse = await fetch(`${API_BASE}/api/auth/logout`, {
				method: "POST",
				headers: { Authorization: `Bearer ${token}` },
			});

			if (logoutResponse.ok) {
				console.log("✅ Logout successful");
			} else {
				console.log("❌ Logout failed");
			}
		} else {
			const error = await loginResponse.text();
			console.log("❌ Login failed:", error);
		}

		console.log("\n🎉 Authentication API tests completed!");
	} catch (error: unknown) {
		console.error("❌ API test failed:", error instanceof Error ? error.message : String(error));
		console.log("   Make sure the HTTP API server is running on port 3003");
		console.log("   Start it with: npm run http-api");
	}
}

// Run API tests
testAuthAPI().catch(console.error);
