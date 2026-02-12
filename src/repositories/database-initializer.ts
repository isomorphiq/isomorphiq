import { DatabaseSchemaManager, AuthenticationRepository } from "@isomorphiq/auth";
import type { CreateUserInput, User } from "@isomorphiq/auth";

/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class DatabaseInitializer {
	private schemaManager: DatabaseSchemaManager;
	private authRepository: AuthenticationRepository;

	constructor(dbPath?: string) {
		this.schemaManager = new DatabaseSchemaManager(dbPath);
		this.authRepository = new AuthenticationRepository(dbPath);
	}

	async initialize(): Promise<{ success: boolean; message: string; error?: string }> {
		try {
			console.log("[DB-INIT] Starting database initialization...");

			// 1. Run schema migrations
			const migrationResult = await this.schemaManager.migrate();
			if (!migrationResult.success) {
				return {
					success: false,
					message: "Schema migration failed",
					error: migrationResult.error?.message,
				};
			}

			console.log("[DB-INIT] Schema migrations completed successfully");

			// 2. Validate schema
			const validationResult = await this.schemaManager.validateSchema();
			if (!validationResult.success) {
				return {
					success: false,
					message: "Schema validation failed",
					error: validationResult.error?.message,
				};
			}

			if (!validationResult.data.isValid) {
				console.warn("[DB-INIT] Schema validation found issues:", validationResult.data.issues);
			} else {
				console.log("[DB-INIT] Schema validation passed");
			}

			// 3. Create default admin user if no users exist
			const adminUserResult = await this.createDefaultAdminUser();
			if (!adminUserResult.success) {
				console.warn("[DB-INIT] Failed to create default admin user:", adminUserResult.error);
			} else if (adminUserResult.data) {
				console.log("[DB-INIT] Default admin user created");
			} else {
				console.log("[DB-INIT] Admin user already exists, skipping creation");
			}

			console.log("[DB-INIT] Database initialization completed successfully");

			return { success: true, message: "Database initialized successfully" };
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			console.error("[DB-INIT] Database initialization failed:", errorMessage);

			return {
				success: false,
				message: "Database initialization failed",
				error: errorMessage,
			};
		} finally {
			await this.cleanup();
		}
	}

	private async createDefaultAdminUser(): Promise<{
		success: boolean;
		data?: boolean;
		error?: string;
	}> {
		try {
			// Check if any users exist
			const existingUsers = await this.getAllUsers();
			if (existingUsers.length > 0) {
				return { success: true, data: false }; // Users already exist
			}

			// Create default admin user
			const adminInput: CreateUserInput = {
				username: "admin",
				email: "admin@opencode.local",
				password: "admin123456", // Should be changed on first login
				role: "admin",
				profile: {
					firstName: "System",
					lastName: "Administrator",
				},
			};

			const createResult = await this.authRepository.createUser(adminInput);
			if (!createResult.success) {
				return {
					success: false,
					error: createResult.error?.message || "Failed to create admin user",
				};
			}

			console.log("[DB-INIT] Default admin user created with credentials:");
			console.log("[DB-INIT] Username: admin");
			console.log("[DB-INIT] Password: admin123456");
			console.log("[DB-INIT] IMPORTANT: Change this password immediately after first login!");

			return { success: true, data: true };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	private async getAllUsers(): Promise<User[]> {
		try {
			return await this.authRepository.listUsers();
		} catch (error) {
			console.error("[DB-INIT] Error getting users:", error);
			return [];
		}
	}

	async cleanup(): Promise<void> {
		try {
			await this.schemaManager.close();
			await this.authRepository.close();
		} catch (error) {
			console.error("[DB-INIT] Error during cleanup:", error);
		}
	}

	async status(): Promise<{
		success: boolean;
		schemaVersion?: number;
		userCount?: number;
		sessionCount?: number;
		issues?: string[];
		error?: string;
	}> {
		try {
			// Get schema info
			const schemaInfo = await this.schemaManager.getSchemaInfo();
			const schemaVersion = schemaInfo?.currentVersion || 0;

			// Get user count
			const users = await this.getAllUsers();
			const userCount = users.length;

			// Get session count (simplified)
			const sessionCount = await this.authRepository.countActiveSessions();

			// Validate schema
			const validationResult = await this.schemaManager.validateSchema();
			const issues = validationResult.success
				? validationResult.data.issues
				: ["Validation failed"];

			return {
				success: true,
				schemaVersion,
				userCount,
				sessionCount,
				issues,
			};
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			console.error("[DB-INIT] Error getting database status:", errorMessage);

			return {
				success: false,
				error: errorMessage,
			};
		} finally {
			await this.cleanup();
		}
	}
}

// CLI interface for running initializer
async function main() {
	const command = process.argv[2] || "init";
	const dbPath = process.argv[3];

	const initializer = new DatabaseInitializer(dbPath);

	switch (command) {
		case "init": {
			const initResult = await initializer.initialize();
			console.log(JSON.stringify(initResult, null, 2));
			break;
		}

		case "status": {
			const statusResult = await initializer.status();
			console.log(JSON.stringify(statusResult, null, 2));
			break;
		}

		default:
			console.log("Usage: node database-initializer.js [init|status] [dbPath]");
			break;
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch(console.error);
}

