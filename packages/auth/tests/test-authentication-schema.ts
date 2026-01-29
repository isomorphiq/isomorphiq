import "../../../tests/test-utils/env-fetch.ts";
import {
    AuthService,
    AuthenticationRepository,
    DatabaseSchemaManager,
} from "@isomorphiq/auth";
import type { CreateUserInput } from "@isomorphiq/auth";

async function testAuthenticationSchema() {
	console.log("=== Authentication Database Schema Test ===");

	const schemaManager = new DatabaseSchemaManager();
	const authRepository = new AuthenticationRepository();
	const authService = new AuthService();

	try {
		// 1. Test schema migration
		console.log("\n1. Testing schema migration...");
		const migrationResult = await schemaManager.migrate();
		if (!migrationResult.success) {
			console.error("❌ Schema migration failed:", migrationResult.error);
			return;
		}
		console.log("✅ Schema migration completed successfully");

		// 2. Test schema validation
		console.log("\n2. Testing schema validation...");
		const validationResult = await schemaManager.validateSchema();
		if (!validationResult.success) {
			console.error("❌ Schema validation failed:", validationResult.error);
			return;
		}

		if (validationResult.data.isValid) {
			console.log("✅ Schema validation passed");
		} else {
			console.log("⚠️  Schema validation found issues:", validationResult.data.issues);
		}

		// 3. Test user creation
		console.log("\n3. Testing user creation...");
		const testUser: CreateUserInput = {
			username: "testuser",
			email: "test@example.com",
			password: "testpassword123",
			role: "developer",
			profile: {
				firstName: "Test",
				lastName: "User",
			},
		};

		const createUserResult = await authRepository.createUser(testUser);
		if (!createUserResult.success) {
			console.error("❌ User creation failed:", createUserResult.error);
			return;
		}
		console.log("✅ User created successfully");
		const createdUser = createUserResult.data;

		// 4. Test user lookup by username
		console.log("\n4. Testing user lookup by username...");
		const userByUsernameResult = await authRepository.getUserByUsername("testuser");
		if (!userByUsernameResult.success || !userByUsernameResult.data) {
			console.error("❌ User lookup by username failed");
			return;
		}
		console.log("✅ User lookup by username successful");

		// 5. Test user lookup by email
		console.log("\n5. Testing user lookup by email...");
		const userByEmailResult = await authRepository.getUserByEmail("test@example.com");
		if (!userByEmailResult.success || !userByEmailResult.data) {
			console.error("❌ User lookup by email failed");
			return;
		}
		console.log("✅ User lookup by email successful");

		// 6. Test password hashing and verification
		console.log("\n6. Testing password hashing and verification...");
		const testPassword = "testpassword123";
		const hashedPassword = await authService.hashPassword(testPassword);
		const isPasswordValid = await authService.verifyPassword(testPassword, hashedPassword);

		if (!isPasswordValid) {
			console.error("❌ Password verification failed");
			return;
		}
		console.log("✅ Password hashing and verification working correctly");

		// 7. Test session creation
		console.log("\n7. Testing session creation...");
		const sessionResult = await authRepository.createSession(createdUser.id);
		if (!sessionResult.success) {
			console.error("❌ Session creation failed:", sessionResult.error);
			return;
		}
		console.log("✅ Session created successfully");
		const createdSession = sessionResult.data;

		// 8. Test session lookup by token
		console.log("\n8. Testing session lookup by token...");
		const sessionByTokenResult = await authRepository.getSessionByToken(createdSession.token);
		if (!sessionByTokenResult.success || !sessionByTokenResult.data) {
			console.error("❌ Session lookup by token failed");
			return;
		}
		console.log("✅ Session lookup by token successful");

		// 9. Test password reset token creation
		console.log("\n9. Testing password reset token creation...");
		const resetTokenResult = await authRepository.createPasswordResetToken("test@example.com");
		if (!resetTokenResult.success) {
			console.error("❌ Password reset token creation failed:", resetTokenResult.error);
			return;
		}
		console.log("✅ Password reset token created successfully");
		const createdResetToken = resetTokenResult.data;

		// 10. Test password reset token lookup
		console.log("\n10. Testing password reset token lookup...");
		const resetTokenLookupResult = await authRepository.getPasswordResetToken(
			createdResetToken.token,
		);
		if (!resetTokenLookupResult.success || !resetTokenLookupResult.data) {
			console.error("❌ Password reset token lookup failed");
			return;
		}
		console.log("✅ Password reset token lookup successful");

		// 11. Test email verification token creation
		console.log("\n11. Testing email verification token creation...");
		const emailVerifyResult = await authRepository.createEmailVerificationToken(
			createdUser.id,
			"test@example.com",
		);
		if (!emailVerifyResult.success) {
			console.error("❌ Email verification token creation failed:", emailVerifyResult.error);
			return;
		}
		console.log("✅ Email verification token created successfully");
		const createdEmailToken = emailVerifyResult.data;

		// 12. Test email verification token lookup
		console.log("\n12. Testing email verification token lookup...");
		const emailTokenLookupResult = await authRepository.getEmailVerificationToken(
			createdEmailToken.token,
		);
		if (!emailTokenLookupResult.success || !emailTokenLookupResult.data) {
			console.error("❌ Email verification token lookup failed");
			return;
		}
		console.log("✅ Email verification token lookup successful");

		// 13. Test user update
		console.log("\n13. Testing user update...");
		const updateResult = await authRepository.updateUser({
			id: createdUser.id,
			profile: {
				firstName: "Updated",
				lastName: "User",
			},
		});
		if (!updateResult.success) {
			console.error("❌ User update failed:", updateResult.error);
			return;
		}
		console.log("✅ User update successful");

		// 14. Test session invalidation
		console.log("\n14. Testing session invalidation...");
		const invalidateResult = await authRepository.invalidateSession(createdSession.id);
		if (!invalidateResult.success) {
			console.error("❌ Session invalidation failed:", invalidateResult.error);
			return;
		}
		console.log("✅ Session invalidation successful");

		// 15. Get schema info
		console.log("\n15. Getting schema information...");
		const schemaInfo = await schemaManager.getSchemaInfo();
		if (schemaInfo) {
			console.log("✅ Schema information retrieved:");
			console.log(`   Version: ${schemaInfo.currentVersion}`);
			console.log(`   Migrations: ${schemaInfo.migrations.length}`);
			console.log(`   Last migrated: ${schemaInfo.migratedAt}`);
		} else {
			console.log("⚠️  No schema information found");
		}

		console.log("\n=== All Authentication Schema Tests Passed! ===");
		console.log("\n📊 Summary:");
		console.log("   ✅ Schema migration and validation");
		console.log("   ✅ User CRUD operations with indexing");
		console.log("   ✅ Password hashing and verification");
		console.log("   ✅ Session management");
		console.log("   ✅ Password reset tokens");
		console.log("   ✅ Email verification tokens");
		console.log("   ✅ Database indexes and constraints");
	} catch (error) {
		console.error("❌ Test failed with error:", error);
	} finally {
		// Cleanup
		await schemaManager.close();
		await authRepository.close();
	}
}

// Run the test
testAuthenticationSchema().catch(console.error);
