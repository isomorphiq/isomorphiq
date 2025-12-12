import crypto from "node:crypto";
import path from "node:path";
import { Level } from "level";
import { AuthService } from "../auth-service.ts";
import type { Result } from "../core/result.ts";
import type {
	CreateUserInput,
	DeviceInfo,
	EmailVerificationToken,
	PasswordResetToken,
	Session,
	UpdateUserInput,
	User,
} from "../types.ts";

export class AuthenticationRepository {
	private userDb: Level<string, User>;
	private sessionDb: Level<string, Session>;
	private passwordResetDb: Level<string, PasswordResetToken>;
	private emailVerificationDb: Level<string, EmailVerificationToken>;
	private dbReady = false;
	private authService: AuthService;

	constructor(dbPath?: string) {
		const basePath = dbPath || path.join(process.cwd(), "db");

		this.userDb = new Level(path.join(basePath, "users"), { valueEncoding: "json" });
		this.sessionDb = new Level(path.join(basePath, "sessions"), { valueEncoding: "json" });
		this.passwordResetDb = new Level(path.join(basePath, "password-resets"), {
			valueEncoding: "json",
		});
		this.emailVerificationDb = new Level(path.join(basePath, "email-verifications"), {
			valueEncoding: "json",
		});
		this.authService = new AuthService();
	}

	private async ensureDatabasesOpen(): Promise<void> {
		if (!this.dbReady) {
			await this.userDb.open();
			await this.sessionDb.open();
			await this.passwordResetDb.open();
			await this.emailVerificationDb.open();
			this.dbReady = true;
		}
	}

	private generateId(prefix: string): string {
		return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
	}

	private async createIndex(
		db: Level<string, unknown>,
		indexKey: string,
		value: string,
		targetKey: string,
	): Promise<void> {
		await db.put(`${indexKey}${value}`, targetKey);
	}

	private async removeIndex(
		db: Level<string, unknown>,
		indexKey: string,
		value: string,
	): Promise<void> {
		try {
			await db.del(`${indexKey}${value}`);
		} catch (_error) {
			// Index might not exist, ignore
		}
	}

	private async findByIndex(
		db: Level<string, unknown>,
		indexKey: string,
		value: string,
	): Promise<string | null> {
		try {
			return (await db.get(`${indexKey}${value}`)) as string;
		} catch (_error) {
			return null;
		}
	}

	async createUser(input: CreateUserInput): Promise<Result<User>> {
		await this.ensureDatabasesOpen();

		try {
			// Validate input
			if (!input.username || input.username.length < 3) {
				return {
					success: false,
					error: new Error("Username must be at least 3 characters long"),
				};
			}

			if (!input.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) {
				return {
					success: false,
					error: new Error("Invalid email format"),
				};
			}

			if (!input.password || input.password.length < 6) {
				return {
					success: false,
					error: new Error("Password must be at least 6 characters long"),
				};
			}

			// Check for existing username
			const existingUsernameId = await this.findByIndex(
				this.userDb,
				"index:username:",
				input.username,
			);
			if (existingUsernameId) {
				return {
					success: false,
					error: new Error("Username already exists"),
				};
			}

			// Check for existing email
			const existingEmailId = await this.findByIndex(this.userDb, "index:email:", input.email);
			if (existingEmailId) {
				return {
					success: false,
					error: new Error("Email already exists"),
				};
			}

			const id = this.generateId("user");
			const now = new Date();

			const user: User = {
				id,
				username: input.username,
				email: input.email,
				passwordHash: await this.authService.hashPassword(input.password),
				role: input.role || "developer",
				isActive: true,
				isEmailVerified: false,
				profile: {
					...this.authService.getDefaultProfile(),
					...input.profile,
				},
				preferences: {
					...this.authService.getDefaultPreferences(),
					...input.preferences,
				},
				createdAt: now,
				updatedAt: now,
				failedLoginAttempts: 0,
			};

			// Store user
			await this.userDb.put(id, user);

			// Create indexes
			await this.createIndex(this.userDb, "index:username:", user.username, id);
			await this.createIndex(this.userDb, "index:email:", user.email, id);
			await this.createIndex(this.userDb, "index:role:", user.role, id);
			await this.createIndex(this.userDb, "index:active:", user.isActive.toString(), id);
			await this.createIndex(this.userDb, "index:verified:", user.isEmailVerified.toString(), id);

			return { success: true, data: user };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}

	async getUserByUsername(username: string): Promise<Result<User | null>> {
		await this.ensureDatabasesOpen();

		try {
			const userId = await this.findByIndex(this.userDb, "index:username:", username);
			if (!userId) {
				return { success: true, data: null };
			}

			const user = await this.userDb.get(userId);
			return { success: true, data: user };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}

	async getUserByEmail(email: string): Promise<Result<User | null>> {
		await this.ensureDatabasesOpen();

		try {
			const userId = await this.findByIndex(this.userDb, "index:email:", email);
			if (!userId) {
				return { success: true, data: null };
			}

			const user = await this.userDb.get(userId);
			return { success: true, data: user };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}

	async getUserById(id: string): Promise<Result<User | null>> {
		await this.ensureDatabasesOpen();

		try {
			const user = await this.userDb.get(id);
			return { success: true, data: user };
		} catch (_error) {
			return { success: true, data: null };
		}
	}

	async updateUser(input: UpdateUserInput): Promise<Result<User>> {
		await this.ensureDatabasesOpen();

		try {
			const existingUser = await this.userDb.get(input.id);
			if (!existingUser) {
				return {
					success: false,
					error: new Error("User not found"),
				};
			}

			const updatedUser: User = {
				...existingUser,
				updatedAt: new Date(),
			};

			// Track what changed for index updates
			const changes: { [key: string]: { old: string; new: string } } = {};

			if (input.username && input.username !== existingUser.username) {
				// Check for duplicate username
				const existingUsernameId = await this.findByIndex(
					this.userDb,
					"index:username:",
					input.username,
				);
				if (existingUsernameId && existingUsernameId !== input.id) {
					return {
						success: false,
						error: new Error("Username already exists"),
					};
				}
				changes.username = { old: existingUser.username, new: input.username };
				updatedUser.username = input.username;
			}

			if (input.email && input.email !== existingUser.email) {
				// Check for duplicate email
				const existingEmailId = await this.findByIndex(this.userDb, "index:email:", input.email);
				if (existingEmailId && existingEmailId !== input.id) {
					return {
						success: false,
						error: new Error("Email already exists"),
					};
				}
				changes.email = { old: existingUser.email, new: input.email };
				updatedUser.email = input.email;
			}

			if (input.role && input.role !== existingUser.role) {
				changes.role = { old: existingUser.role, new: input.role };
				updatedUser.role = input.role;
			}

			if (input.isActive !== undefined && input.isActive !== existingUser.isActive) {
				changes.active = { old: existingUser.isActive.toString(), new: input.isActive.toString() };
				updatedUser.isActive = input.isActive;
			}

			// Handle nested objects
			if (input.profile) {
				updatedUser.profile = {
					...existingUser.profile,
					...input.profile,
				};
			}

			if (input.preferences) {
				updatedUser.preferences = {
					...existingUser.preferences,
					...input.preferences,
				};
			}

			// Update user
			await this.userDb.put(input.id, updatedUser);

			// Update indexes
			for (const [field, change] of Object.entries(changes)) {
				const indexKey = `index:${field}:`;
				await this.removeIndex(this.userDb, indexKey, change.old);
				await this.createIndex(this.userDb, indexKey, change.new, input.id);
			}

			return { success: true, data: updatedUser };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}

	async createSession(
		userId: string,
		deviceInfo?: DeviceInfo,
		ipAddress?: string,
		userAgent?: string,
	): Promise<Result<Session>> {
		await this.ensureDatabasesOpen();

		try {
			const { token, refreshToken } = this.authService.generateTokens(userId);
			const sessionId = this.generateId("session");
			const now = new Date();
			const expiresAt = new Date(now.getTime() + 15 * 60 * 1000); // 15 minutes
			const refreshExpiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days

			const session: Session = {
				id: sessionId,
				userId,
				token,
				refreshToken,
				...(deviceInfo && { deviceInfo }),
				...(ipAddress && { ipAddress }),
				...(userAgent && { userAgent }),
				createdAt: now,
				expiresAt,
				refreshExpiresAt,
				isActive: true,
				lastAccessAt: now,
			};

			// Store session
			await this.sessionDb.put(sessionId, session);

			// Create indexes
			await this.createIndex(this.sessionDb, "index:userId:", userId, sessionId);
			await this.createIndex(this.sessionDb, "index:token:", token, sessionId);
			await this.createIndex(this.sessionDb, "index:active:", "true", sessionId);
			await this.createIndex(
				this.sessionDb,
				"index:expiresAt:",
				expiresAt.toISOString(),
				sessionId,
			);

			return { success: true, data: session };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}

	async getSessionByToken(token: string): Promise<Result<Session | null>> {
		await this.ensureDatabasesOpen();

		try {
			const sessionId = await this.findByIndex(this.sessionDb, "index:token:", token);
			if (!sessionId) {
				return { success: true, data: null };
			}

			const session = await this.sessionDb.get(sessionId);

			// Check if session is still valid
			if (!session.isActive || session.expiresAt <= new Date()) {
				return { success: true, data: null };
			}

			return { success: true, data: session };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}

	async updateSessionLastAccess(sessionId: string): Promise<Result<void>> {
		await this.ensureDatabasesOpen();

		try {
			const session = await this.sessionDb.get(sessionId);
			session.lastAccessAt = new Date();
			await this.sessionDb.put(sessionId, session);
			return { success: true, data: undefined };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}

	async invalidateSession(sessionId: string): Promise<Result<void>> {
		await this.ensureDatabasesOpen();

		try {
			const session = await this.sessionDb.get(sessionId);
			session.isActive = false;
			await this.sessionDb.put(sessionId, session);

			// Update active index
			await this.removeIndex(this.sessionDb, "index:active:", "true");
			await this.createIndex(this.sessionDb, "index:active:", "false", sessionId);

			return { success: true, data: undefined };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}

	async invalidateAllUserSessions(userId: string): Promise<Result<void>> {
		await this.ensureDatabasesOpen();

		try {
			const userSessions: Session[] = [];
			const iterator = this.sessionDb.iterator();

			for await (const [key, value] of iterator) {
				if (value.userId === userId && value.isActive) {
					userSessions.push({ ...value, id: key });
				}
			}
			await iterator.close();

			for (const session of userSessions) {
				session.isActive = false;
				await this.sessionDb.put(session.id, session);

				// Update active index
				await this.removeIndex(this.sessionDb, "index:active:", "true");
				await this.createIndex(this.sessionDb, "index:active:", "false", session.id);
			}

			return { success: true, data: undefined };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}

	async createPasswordResetToken(email: string): Promise<Result<PasswordResetToken>> {
		await this.ensureDatabasesOpen();

		try {
			const { token, expiresAt } = this.authService.generatePasswordResetToken();
			const tokenId = this.generateId("reset");

			const resetToken: PasswordResetToken = {
				id: tokenId,
				userId: "", // Will be filled when user is found
				token,
				email,
				expiresAt,
				createdAt: new Date(),
				isUsed: false,
			};

			// Find user by email
			const userResult = await this.getUserByEmail(email);
			if (userResult.success && userResult.data) {
				resetToken.userId = userResult.data.id;
			}

			// Store token
			await this.passwordResetDb.put(tokenId, resetToken);

			// Create indexes
			await this.createIndex(this.passwordResetDb, "index:email:", email, tokenId);
			await this.createIndex(this.passwordResetDb, "index:token:", token, tokenId);
			await this.createIndex(
				this.passwordResetDb,
				"index:expiresAt:",
				expiresAt.toISOString(),
				tokenId,
			);
			await this.createIndex(this.passwordResetDb, "index:used:", "false", tokenId);

			return { success: true, data: resetToken };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}

	async getPasswordResetToken(token: string): Promise<Result<PasswordResetToken | null>> {
		await this.ensureDatabasesOpen();

		try {
			const tokenId = await this.findByIndex(this.passwordResetDb, "index:token:", token);
			if (!tokenId) {
				return { success: true, data: null };
			}

			const resetToken = await this.passwordResetDb.get(tokenId);

			// Check if token is still valid
			if (resetToken.isUsed || resetToken.expiresAt <= new Date()) {
				return { success: true, data: null };
			}

			return { success: true, data: resetToken };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}

	async markPasswordResetTokenUsed(tokenId: string): Promise<Result<void>> {
		await this.ensureDatabasesOpen();

		try {
			const resetToken = await this.passwordResetDb.get(tokenId);
			resetToken.isUsed = true;
			await this.passwordResetDb.put(tokenId, resetToken);

			// Update used index
			await this.removeIndex(this.passwordResetDb, "index:used:", "false");
			await this.createIndex(this.passwordResetDb, "index:used:", "true", tokenId);

			return { success: true, data: undefined };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}

	async createEmailVerificationToken(
		userId: string,
		email: string,
	): Promise<Result<EmailVerificationToken>> {
		await this.ensureDatabasesOpen();

		try {
			const { token, expiresAt } = this.authService.generateEmailVerificationToken();
			const tokenId = this.generateId("verify");

			const verificationToken: EmailVerificationToken = {
				id: tokenId,
				userId,
				token,
				email,
				expiresAt,
				createdAt: new Date(),
				isUsed: false,
			};

			// Store token
			await this.emailVerificationDb.put(tokenId, verificationToken);

			// Create indexes
			await this.createIndex(this.emailVerificationDb, "index:userId:", userId, tokenId);
			await this.createIndex(this.emailVerificationDb, "index:email:", email, tokenId);
			await this.createIndex(this.emailVerificationDb, "index:token:", token, tokenId);
			await this.createIndex(
				this.emailVerificationDb,
				"index:expiresAt:",
				expiresAt.toISOString(),
				tokenId,
			);
			await this.createIndex(this.emailVerificationDb, "index:used:", "false", tokenId);

			return { success: true, data: verificationToken };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}

	async getEmailVerificationToken(token: string): Promise<Result<EmailVerificationToken | null>> {
		await this.ensureDatabasesOpen();

		try {
			const tokenId = await this.findByIndex(this.emailVerificationDb, "index:token:", token);
			if (!tokenId) {
				return { success: true, data: null };
			}

			const verificationToken = await this.emailVerificationDb.get(tokenId);

			// Check if token is still valid
			if (verificationToken.isUsed || verificationToken.expiresAt <= new Date()) {
				return { success: true, data: null };
			}

			return { success: true, data: verificationToken };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}

	async markEmailVerificationTokenUsed(tokenId: string): Promise<Result<void>> {
		await this.ensureDatabasesOpen();

		try {
			const verificationToken = await this.emailVerificationDb.get(tokenId);
			verificationToken.isUsed = true;
			await this.emailVerificationDb.put(tokenId, verificationToken);

			// Update used index
			await this.removeIndex(this.emailVerificationDb, "index:used:", "false");
			await this.createIndex(this.emailVerificationDb, "index:used:", "true", tokenId);

			return { success: true, data: undefined };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}

	async close(): Promise<void> {
		if (this.dbReady) {
			await this.userDb.close();
			await this.sessionDb.close();
			await this.passwordResetDb.close();
			await this.emailVerificationDb.close();
			this.dbReady = false;
		}
	}
}
