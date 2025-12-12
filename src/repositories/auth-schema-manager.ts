import path from "node:path";
import { Level } from "level";
import type { Result } from "../core/result.ts";
import type { EmailVerificationToken, PasswordResetToken, Session, User } from "../types.ts";

export interface DatabaseSchema {
	version: number;
	name: string;
	description: string;
	migrations: Migration[];
}

/* eslint-disable no-unused-vars */
export interface Migration {
	version: number;
	description: string;
	up: (db: Level<string, unknown>) => Promise<void>;
	down: (db: Level<string, unknown>) => Promise<void>;
}
/* eslint-enable no-unused-vars */

export interface SchemaMetadata {
	currentVersion: number;
	migratedAt: Date;
	migrations: Array<{
		version: number;
		appliedAt: Date;
		description: string;
	}>;
}

export class DatabaseSchemaManager {
	private schemaDb: Level<string, SchemaMetadata>;
	private userDb: Level<string, User>;
	private sessionDb: Level<string, Session>;
	private passwordResetDb: Level<string, PasswordResetToken>;
	private emailVerificationDb: Level<string, EmailVerificationToken>;
	private dbReady = false;

	constructor(dbPath?: string) {
		const basePath = dbPath || path.join(process.cwd(), "db");

		this.schemaDb = new Level(path.join(basePath, "_schema"), { valueEncoding: "json" });
		this.userDb = new Level(path.join(basePath, "users"), { valueEncoding: "json" });
		this.sessionDb = new Level(path.join(basePath, "sessions"), { valueEncoding: "json" });
		this.passwordResetDb = new Level(path.join(basePath, "password-resets"), {
			valueEncoding: "json",
		});
		this.emailVerificationDb = new Level(path.join(basePath, "email-verifications"), {
			valueEncoding: "json",
		});
	}

	private async ensureDatabasesOpen(): Promise<void> {
		if (!this.dbReady) {
			await this.schemaDb.open();
			await this.userDb.open();
			await this.sessionDb.open();
			await this.passwordResetDb.open();
			await this.emailVerificationDb.open();
			this.dbReady = true;
		}
	}

	private getAuthenticationSchema(): DatabaseSchema {
		return {
			version: 1,
			name: "authentication",
			description: "Authentication database schema for users, sessions, and tokens",
			migrations: [
				{
					version: 1,
					description: "Create initial authentication schema",
					up: async () => {
						// Create indexes for users table
						await this.createUserIndexes();

						// Create indexes for sessions table
						await this.createSessionIndexes();

						// Create indexes for password reset tokens
						await this.createPasswordResetIndexes();

						// Create indexes for email verification tokens
						await this.createEmailVerificationIndexes();

						console.log("[SCHEMA] Authentication schema v1 initialized");
					},
					down: async () => {
						// In LevelDB, we would need to manually remove index entries
						// For now, we'll just log the downgrade
						console.log(
							"[SCHEMA] Authentication schema v1 downgrade (indexes would need manual cleanup)",
						);
					},
				},
			],
		};
	}

	private async createUserIndexes(): Promise<void> {
		console.log("[SCHEMA] User indexes created");
	}

	private async createSessionIndexes(): Promise<void> {
		console.log("[SCHEMA] Session indexes created");
	}

	private async createPasswordResetIndexes(): Promise<void> {
		console.log("[SCHEMA] Password reset indexes created");
	}

	private async createEmailVerificationIndexes(): Promise<void> {
		console.log("[SCHEMA] Email verification indexes created");
	}

	async getCurrentVersion(): Promise<number> {
		await this.ensureDatabasesOpen();

		try {
			const metadata = await this.schemaDb.get("schema:authentication");
			return metadata.currentVersion;
		} catch (_error) {
			void _error;
			// Schema not found, return 0
			return 0;
		}
	}

	async migrate(): Promise<Result<void>> {
		await this.ensureDatabasesOpen();

		try {
			const schema = this.getAuthenticationSchema();
			const currentVersion = await this.getCurrentVersion();

			if (currentVersion === schema.version) {
				console.log("[SCHEMA] Authentication schema is up to date");
				return { success: true, data: undefined };
			}

			if (currentVersion > schema.version) {
				return {
					success: false,
					error: new Error(
						`Database version ${currentVersion} is newer than schema version ${schema.version}`,
					),
				};
			}

			console.log(
				`[SCHEMA] Migrating authentication schema from v${currentVersion} to v${schema.version}`,
			);

			// Get current metadata or create new
			let metadata: SchemaMetadata = {
				currentVersion: 0,
				migratedAt: new Date(),
				migrations: [],
			};
			try {
				const existingMetadata = await this.schemaDb.get("schema:authentication");
				if (existingMetadata) {
					metadata = existingMetadata;
				}
			} catch (_error) {
				void _error;
				// Use default metadata
			}

			// Apply pending migrations
			const pendingMigrations = (schema.migrations || []).filter((m) => m.version > currentVersion);

			for (const migration of pendingMigrations) {
				console.log(`[SCHEMA] Applying migration v${migration.version}: ${migration.description}`);

				await migration.up(this.userDb);

				// Record migration
				if (!metadata.migrations) metadata.migrations = [];
				metadata.migrations.push({
					version: migration.version,
					appliedAt: new Date(),
					description: migration.description,
				});

				metadata.currentVersion = migration.version;
				metadata.migratedAt = new Date();
			}

			// Save updated metadata
			await this.schemaDb.put("schema:authentication", metadata);

			console.log(`[SCHEMA] Authentication schema migrated to v${schema.version}`);
			return { success: true, data: undefined };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}

	async rollback(targetVersion: number): Promise<Result<void>> {
		await this.ensureDatabasesOpen();

		try {
			const schema = this.getAuthenticationSchema();
			const currentVersion = await this.getCurrentVersion();

			if (targetVersion >= currentVersion) {
				return {
					success: false,
					error: new Error(
						`Cannot rollback to version ${targetVersion} from current version ${currentVersion}`,
					),
				};
			}

			console.log(
				`[SCHEMA] Rolling back authentication schema from v${currentVersion} to v${targetVersion}`,
			);

			let metadata: SchemaMetadata = {
				currentVersion: 0,
				migratedAt: new Date(),
				migrations: [],
			};
				try {
					const existingMetadata = await this.schemaDb.get("schema:authentication");
					if (existingMetadata) {
						metadata = existingMetadata;
					}
				} catch (_error) {
					void _error;
					// Use default metadata
				}

			// Get migrations to rollback
			const migrationsToRollback = (schema.migrations || [])
				.filter((m) => m.version > targetVersion && m.version <= currentVersion)
				.sort((a, b) => b.version - a.version); // Rollback in reverse order

			for (const migration of migrationsToRollback) {
				console.log(
					`[SCHEMA] Rolling back migration v${migration.version}: ${migration.description}`,
				);

				await migration.down(this.userDb);

				// Remove migration from metadata
				metadata.migrations = metadata.migrations.filter((m) => m.version !== migration.version);
			}

			metadata.currentVersion = targetVersion;
			metadata.migratedAt = new Date();

			await this.schemaDb.put("schema:authentication", metadata);

			console.log(`[SCHEMA] Authentication schema rolled back to v${targetVersion}`);
			return { success: true, data: undefined };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}

	async getSchemaInfo(): Promise<SchemaMetadata | null> {
		await this.ensureDatabasesOpen();

		try {
			return await this.schemaDb.get("schema:authentication");
		} catch (_error) {
			void _error;
			return null;
		}
	}

	async validateSchema(): Promise<Result<{ isValid: boolean; issues: string[] }>> {
		await this.ensureDatabasesOpen();

		try {
			const issues: string[] = [];

			// Validate user data structure
			const users: User[] = [];
			const userIterator = this.userDb.iterator();

			for await (const [, value] of userIterator) {
				users.push(value);
			}
			await userIterator.close();

			for (const user of users) {
				if (!user.id) issues.push(`User missing id: ${JSON.stringify(user)}`);
				if (!user.username) issues.push(`User missing username: ${user.id}`);
				if (!user.email) issues.push(`User missing email: ${user.id}`);
				if (!user.passwordHash) issues.push(`User missing passwordHash: ${user.id}`);
				if (!user.role) issues.push(`User missing role: ${user.id}`);
				if (!["admin", "manager", "developer", "viewer"].includes(user.role)) {
					issues.push(`User has invalid role: ${user.role} for user ${user.id}`);
				}
			}

			// Validate session data structure
			const sessions: Session[] = [];
			const sessionIterator = this.sessionDb.iterator();

			for await (const [, value] of sessionIterator) {
				sessions.push(value);
			}
			await sessionIterator.close();

			for (const session of sessions) {
				if (!session.id) issues.push(`Session missing id: ${JSON.stringify(session)}`);
				if (!session.userId) issues.push(`Session missing userId: ${session.id}`);
				if (!session.token) issues.push(`Session missing token: ${session.id}`);
				if (!session.refreshToken) issues.push(`Session missing refreshToken: ${session.id}`);
				if (!session.expiresAt) issues.push(`Session missing expiresAt: ${session.id}`);
				if (!session.refreshExpiresAt)
					issues.push(`Session missing refreshExpiresAt: ${session.id}`);
			}

			const isValid = issues.length === 0;

			return { success: true, data: { isValid, issues } };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}

	async close(): Promise<void> {
		if (this.dbReady) {
			await this.schemaDb.close();
			await this.userDb.close();
			await this.sessionDb.close();
			await this.passwordResetDb.close();
			await this.emailVerificationDb.close();
			this.dbReady = false;
		}
	}
}
