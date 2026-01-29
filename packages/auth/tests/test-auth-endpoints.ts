import "../../../tests/test-utils/env-fetch.ts";

const API_BASE = "http://localhost:3003";

async function testAuthEndpoints() {
	console.log("🔐 Testing Authentication Endpoints");

	try {
		// Test 1: Health check
		console.log("\n🏥 Test 1: Health check");
		const healthResponse = await fetch(`${API_BASE}/api/health`);
		if (healthResponse.ok) {
			const health = await healthResponse.json();
			console.log("✅ API is healthy:", health.service);
		} else {
			console.error("❌ API health check failed");
			return;
		}

		// Test 2: Login with invalid credentials
		console.log("\n🚫 Test 2: Login with invalid credentials");
		const invalidLoginResponse = await fetch(`${API_BASE}/api/auth/login`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				username: "nonexistent",
				password: "wrongpassword",
			}),
		});

		if (invalidLoginResponse.ok) {
			console.error("❌ Invalid login should have failed");
		} else {
			const error = await invalidLoginResponse.json();
			console.log("✅ Invalid login correctly rejected:", error.error);
		}

		// Test 3: Access protected endpoint without token
		console.log("\n🛡️ Test 3: Access protected endpoint without token");
		const protectedResponse = await fetch(`${API_BASE}/api/auth/me`);
		if (protectedResponse.status === 401) {
			console.log("✅ Protected endpoint correctly requires authentication");
		} else {
			console.error("❌ Protected endpoint should require authentication");
		}

		// Test 4: Access user management without token
		console.log("\n👥 Test 4: Access user management without token");
		const usersResponse = await fetch(`${API_BASE}/api/users`);
		if (usersResponse.status === 401) {
			console.log("✅ User management correctly requires authentication");
		} else {
			console.error("❌ User management should require authentication");
		}

		// Test 5: Invalid token
		console.log("\n🔑 Test 5: Access with invalid token");
		const invalidTokenResponse = await fetch(`${API_BASE}/api/auth/me`, {
			headers: { Authorization: "Bearer invalid_token_here" },
		});
		if (invalidTokenResponse.status === 401) {
			console.log("✅ Invalid token correctly rejected");
		} else {
			console.error("❌ Invalid token should be rejected");
		}

		// Test 6: Malformed token
		console.log("\n🔧 Test 6: Access with malformed token");
		const malformedTokenResponse = await fetch(`${API_BASE}/api/auth/me`, {
			headers: { Authorization: "Bearer malformed.token.with.dots" },
		});
		if (malformedTokenResponse.status === 401) {
			console.log("✅ Malformed token correctly rejected");
		} else {
			console.error("❌ Malformed token should be rejected");
		}

		// Test 7: Password validation requirements
		console.log("\n💪 Test 7: Password validation");
		const weakPasswords = ["123", "password", "Password", "Password123", "Pass123!"];

		for (const password of weakPasswords) {
			const registerResponse = await fetch(`${API_BASE}/api/users`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer fake_admin_token", // This will fail but we want to see validation
				},
				body: JSON.stringify({
					username: `test_${Date.now()}`,
					email: `test_${Date.now()}@example.com`,
					password: password,
					role: "developer",
				}),
			});

			if (!registerResponse.ok) {
				const error = await registerResponse.json();
				if (error.error?.includes("Password")) {
					console.log(`✅ Weak password "${password}" rejected`);
				} else {
					console.log(`⚠️  Password "${password}" rejected for other reason`);
				}
			} else {
				console.log(`❌ Weak password "${password}" was accepted (should not happen)`);
			}
		}

		console.log("\n🎉 Authentication endpoint tests completed!");
	} catch (error) {
		console.error("❌ Authentication endpoint test failed:", error);
	}
}

// Run the tests
testAuthEndpoints().catch(console.error);
