// TODO: This file is too complex (972 lines) and should be refactored into several modules.
// Current concerns mixed: User CRUD operations, session management, password reset,
// email verification, authentication, profile updates, database management.
// 
// Proposed structure:
// - auth/user-manager/index.ts - Main user manager composition
// - auth/user-manager/user-service.ts - User CRUD operations
// - auth/user-manager/session-service.ts - Session lifecycle management
// - auth/user-manager/password-service.ts - Password reset and verification
// - auth/user-manager/email-service.ts - Email verification handling
// - auth/user-manager/profile-service.ts - User profile management
// - auth/user-manager/repositories/ - Database access layer
// - auth/user-manager/types.ts - User management types

import crypto from "node:crypto";
import path from "node:path";
import { Level } from "level";
import { AuthService } from "./auth-service.ts";
import { PermissionService } from "./permission-service.ts";
import type {
    AuthCredentials,
    AuthResult,
    ChangePasswordInput,
    CreateUserInput,
    EmailVerificationInput,
    EmailVerificationToken,
    PasswordResetInput,
    PasswordResetRequest,
    PasswordResetToken,
    RefreshTokenResult,
    Session,
    UpdateProfileInput,
    UpdateUserInput,
    User,
} from "./types.ts";
import type { UserPermissions } from "./security-types.ts";

/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class UserManager {
	private userDb!: Level<string, User>;
	private sessionDb!: Level<string, Session>;
	private passwordResetDb!: Level<string, PasswordResetToken>;
	private emailVerificationDb!: Level<string, EmailVerificationToken>;
	private dbReady = false;
	private authService: AuthService;
	private permissionService: PermissionService;

	constructor() {
		// Initialize databases
		const userDbPath = path.join(process.cwd(), "db", "users");
		const sessionDbPath = path.join(process.cwd(), "db", "sessions");
		const passwordResetDbPath = path.join(process.cwd(), "db", "password-resets");
		const emailVerificationDbPath = path.join(process.cwd(), "db", "email-verifications");
		this.userDb = new Level(userDbPath, { valueEncoding: "json" });
		this.sessionDb = new Level(sessionDbPath, { valueEncoding: "json" });
		this.passwordResetDb = new Level(passwordResetDbPath, {
			valueEncoding: "json",
		});
		this.emailVerificationDb = new Level(emailVerificationDbPath, {
			valueEncoding: "json",
		});
		this.authService = new AuthService();
		this.permissionService = new PermissionService();
	}

	private async ensureDatabasesOpen(): Promise<void> {
		if (!this.dbReady) {
			try {
				await this.userDb.open();
				await this.sessionDb.open();
				await this.passwordResetDb.open();
				await this.emailVerificationDb.open();
				this.dbReady = true;
				console.log("[USER-MANAGER] User databases opened successfully");
			} catch (error) {
				console.error("[USER-MANAGER] Failed to open databases:", error);
				throw error;
			}
		}
	}

	private validateEmail(email: string): boolean {
		const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
		return emailRegex.test(email);
	}

	private validateUsername(username: string): boolean {
		return username.length >= 3 && username.length <= 50 && /^[a-zA-Z0-9_-]+$/.test(username);
	}

	async createUser(input: CreateUserInput): Promise<User> {
		await this.ensureDatabasesOpen();

		// Validate input
		if (!this.validateUsername(input.username)) {
			throw new Error(
				"Username must be 3-50 characters and contain only letters, numbers, underscores, and hyphens",
			);
		}

		if (!this.validateEmail(input.email)) {
			throw new Error("Invalid email format");
		}

		if (!input.password || input.password.length < 6) {
			throw new Error("Password must be at least 6 characters long");
		}

		// Check if username already exists
		const existingUsers = await this.getAllUsers();
		if (existingUsers.some((user) => user.username === input.username)) {
			throw new Error("Username already exists");
		}

		if (existingUsers.some((user) => user.email === input.email)) {
			throw new Error("Email already exists");
		}

		const id = `user-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
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

		try {
			await this.userDb.put(id, user);
			console.log(`[USER-MANAGER] Created user: ${input.username}`);
			return user;
		} catch (error) {
			console.error("[USER-MANAGER] Failed to create user:", error);
			throw error;
		}
	}

	async authenticateUser(credentials: AuthCredentials): Promise<AuthResult> {
		await this.ensureDatabasesOpen();

		try {
			const users = await this.getAllUsers();
			const user = users.find((u) => u.username === credentials.username);

			if (!user) {
				return {
					success: false,
					error: "Invalid username or password",
				};
			}

			if (!user.isActive) {
				return { success: false, error: "Account is deactivated" };
			}

			// Check if account is locked and reset if lock period has expired
			if (user.lockedUntil && new Date() >= new Date(user.lockedUntil)) {
				// Lock has expired, reset failed attempts
				user.failedLoginAttempts = 0;
				delete user.lockedUntil;
				await this.userDb.put(user.id, user);
			} else if (this.authService.isAccountLocked(user)) {
				return {
					success: false,
					error: "Account is temporarily locked due to too many failed login attempts",
				};
			}

			const isPasswordValid = await this.authService.verifyPassword(
				credentials.password,
				user.passwordHash,
			);
			if (!isPasswordValid) {
				// Handle failed login
				const failedLoginResult = await this.authService.handleFailedLogin(user);
				if (failedLoginResult.isLocked && failedLoginResult.lockUntil) {
					user.lockedUntil = failedLoginResult.lockUntil;
					await this.userDb.put(user.id, user);
					return {
						success: false,
						error: "Account locked due to too many failed login attempts",
					};
				}

				user.failedLoginAttempts += 1;
				await this.userDb.put(user.id, user);
				return {
					success: false,
					error: "Invalid username or password",
				};
			}

			// Create session
			const { token, refreshToken } = this.authService.generateTokens(user.id);
			const sessionId = `session-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
			const now = new Date();
			const expiresAt = new Date(now.getTime() + 15 * 60 * 1000); // 15 minutes
			const refreshExpiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days

			const session: Session = {
				id: sessionId,
				userId: user.id,
				token,
				refreshToken,
				deviceInfo: this.authService.extractDeviceInfo(""), // Will be populated from request headers
				createdAt: now,
				expiresAt,
				refreshExpiresAt,
				isActive: true,
				lastAccessAt: now,
			};

			await this.sessionDb.put(sessionId, session);

			// Reset failed login attempts on successful login
			user.failedLoginAttempts = 0;
			user.lastLoginAt = now;
			user.updatedAt = now;
			await this.userDb.put(user.id, user);

			console.log(`[USER-MANAGER] User authenticated: ${user.username}`);

				const { passwordHash: _omittedPassword, ...safeUser } = user;
				return {
					success: true,
					user: safeUser,
					token,
				};
		} catch (error) {
			console.error("[USER-MANAGER] Authentication error:", error);
			return { success: false, error: "Authentication failed" };
		}
	}

	async logoutUser(token: string): Promise<boolean> {
		await this.ensureDatabasesOpen();

		try {
			const sessions: Array<Session & { key: string }> = [];
			const iterator = this.sessionDb.iterator();

			for await (const [key, value] of iterator) {
				sessions.push({ ...value, key });
			}
			await iterator.close();

			const session = sessions.find((s) => s.token === token);
			if (session) {
				const updatedSession = { ...session, isActive: false };
				await this.sessionDb.put(session.key, updatedSession);
				console.log(`[USER-MANAGER] User logged out: ${session.userId}`);
				return true;
			}

			return false;
		} catch (error) {
			console.error("[USER-MANAGER] Logout error:", error);
			return false;
		}
	}

	async getAllUsers(): Promise<User[]> {
		await this.ensureDatabasesOpen();

		const users: User[] = [];
		const iterator = this.userDb.iterator();

		try {
			for await (const [, value] of iterator) {
				users.push(value);
			}
		} catch (error) {
			console.error("[USER-MANAGER] Error reading users:", error);
			return [];
		} finally {
			try {
				await iterator.close();
			} catch (closeError) {
				console.error("[USER-MANAGER] Error closing iterator:", closeError);
			}
		}

		return users;
	}

	async getUserById(id: string): Promise<User | null> {
		await this.ensureDatabasesOpen();

		try {
			return await this.userDb.get(id);
		} catch (_error) {
			return null;
		}
	}

	async updateUser(input: UpdateUserInput): Promise<User> {
		await this.ensureDatabasesOpen();

		const user = await this.userDb.get(input.id);
		if (!user) {
			throw new Error("User not found");
		}

		// Validate input if provided
		if (input.username && !this.validateUsername(input.username)) {
			throw new Error(
				"Username must be 3-50 characters and contain only letters, numbers, underscores, and hyphens",
			);
		}

		if (input.email && !this.validateEmail(input.email)) {
			throw new Error("Invalid email format");
		}

		// Check for duplicates
		if (input.username || input.email) {
			const existingUsers = await this.getAllUsers();
			if (
				input.username &&
				existingUsers.some((u) => u.username === input.username && u.id !== input.id)
			) {
				throw new Error("Username already exists");
			}
			if (input.email && existingUsers.some((u) => u.email === input.email && u.id !== input.id)) {
				throw new Error("Email already exists");
			}
		}

		const updatedUser: User = {
			...user,
			updatedAt: new Date(),
		};

		// Apply updates
		if (input.username) updatedUser.username = input.username;
		if (input.email) updatedUser.email = input.email;
		if (input.role) updatedUser.role = input.role;
		if (input.isActive !== undefined) updatedUser.isActive = input.isActive;

		// Handle preferences merge correctly
		if (input.preferences) {
			updatedUser.preferences = {
				...user.preferences,
				...input.preferences,
			};
		}

		// Handle profile merge correctly
		if (input.profile) {
			updatedUser.profile = {
				...user.profile,
				...input.profile,
			};
		}

		await this.userDb.put(input.id, updatedUser);
		console.log(`[USER-MANAGER] Updated user: ${updatedUser.username}`);
		return updatedUser;
	}

	async deleteUser(id: string): Promise<void> {
		await this.ensureDatabasesOpen();

		const user = await this.userDb.get(id);
		if (!user) {
			throw new Error("User not found");
		}

		await this.userDb.del(id);
		console.log(`[USER-MANAGER] Deleted user: ${user.username}`);
	}

	async hasPermission(
		user: User,
		resource: string,
		action: string,
		context?: Record<string, unknown>,
	): Promise<boolean> {
		const userPermissions = this.permissionService.getUserPermissions(user.id, user.role);
		return this.permissionService.hasPermission(userPermissions, resource, action, context);
	}

	async getUserPermissions(user: User): Promise<UserPermissions> {
		return this.permissionService.getUserPermissions(user.id, user.role);
	}

	getPermissionMatrix() {
		return this.permissionService.getPermissionMatrix();
	}

	getAvailableResources(): string[] {
		return this.permissionService.getAvailableResources();
	}

	getAvailableActions(resource: string): string[] {
		return this.permissionService.getAvailableActions(resource);
	}

	async cleanupExpiredSessions(): Promise<void> {
		await this.ensureDatabasesOpen();

		try {
			const now = new Date();
			const sessions: Array<Session & { key: string }> = [];
			const iterator = this.sessionDb.iterator();

			for await (const [key, value] of iterator) {
				if (value.expiresAt <= now || !value.isActive) {
					sessions.push({ ...value, key });
				}
			}
			await iterator.close();

			for (const session of sessions) {
				await this.sessionDb.del(session.key);
			}

			if (sessions.length > 0) {
				console.log(`[USER-MANAGER] Cleaned up ${sessions.length} expired sessions`);
			}
		} catch (error) {
			console.error("[USER-MANAGER] Session cleanup error:", error);
		}
	}

	async refreshToken(refreshToken: string): Promise<RefreshTokenResult> {
		await this.ensureDatabasesOpen();

		try {
			const verification = this.authService.verifyRefreshToken(refreshToken);
			if (!verification.valid) {
				return {
					success: false,
					error: verification.error || "Invalid refresh token",
				};
			}

			// Find the session with this refresh token
			const sessions: Array<Session & { key: string }> = [];
			const iterator = this.sessionDb.iterator();

			for await (const [key, value] of iterator) {
				if (
					value.refreshToken === refreshToken &&
					value.isActive &&
					value.refreshExpiresAt > new Date()
				) {
					sessions.push({ ...value, key });
				}
			}
			await iterator.close();

			if (sessions.length === 0) {
				return {
					success: false,
					error: "Refresh token not found or expired",
				};
			}

			const session = sessions[0];
			if (!session) {
				return { success: false, error: "Session not found" };
			}

			const user = await this.userDb.get(session.userId);

			if (!user || !user.isActive) {
				return { success: false, error: "User not found or inactive" };
			}

			// Generate new tokens
			const {
				token: newToken,
				refreshToken: newRefreshToken,
				expiresIn,
			} = this.authService.generateTokens(user.id);

			// Update session
			const updatedSession: Session = {
				...session,
				token: newToken,
				refreshToken: newRefreshToken,
				lastAccessAt: new Date(),
			};

			await this.sessionDb.put(session.key, updatedSession);

			return {
				success: true,
				token: newToken,
				refreshToken: newRefreshToken,
				expiresIn,
			};
		} catch (error) {
			console.error("[USER-MANAGER] Token refresh error:", error);
			return { success: false, error: "Token refresh failed" };
		}
	}

	async updateProfile(input: UpdateProfileInput): Promise<User> {
		await this.ensureDatabasesOpen();

		const user = await this.userDb.get(input.userId);
		if (!user) {
			throw new Error("User not found");
		}

		const updatedUser: User = {
			...user,
			updatedAt: new Date(),
		};

		// Handle preferences merge correctly
		if (input.preferences) {
			updatedUser.preferences = {
				...user.preferences,
				...input.preferences,
			};
		}

		// Handle profile merge correctly
		if (input.profile) {
			updatedUser.profile = {
				...user.profile,
				...input.profile,
			};
		}

		await this.userDb.put(input.userId, updatedUser);
		console.log(`[USER-MANAGER] Updated profile for user: ${updatedUser.username}`);
		return updatedUser;
	}

	async changePassword(input: ChangePasswordInput): Promise<void> {
		await this.ensureDatabasesOpen();

		const user = await this.userDb.get(input.userId);
		if (!user) {
			throw new Error("User not found");
		}

		// Verify current password
		const isCurrentPasswordValid = await this.authService.verifyPassword(
			input.currentPassword,
			user.passwordHash,
		);
		if (!isCurrentPasswordValid) {
			throw new Error("Current password is incorrect");
		}

		// Validate new password
		const passwordValidation = this.authService.validatePasswordStrength(input.newPassword);
		if (!passwordValidation.isValid) {
			throw new Error(passwordValidation.errors.join(", "));
		}

		// Hash new password
		const newPasswordHash = await this.authService.hashPassword(input.newPassword);

		// Update user
		const updatedUser: User = {
			...user,
			passwordHash: newPasswordHash,
			passwordChangedAt: new Date(),
			updatedAt: new Date(),
			failedLoginAttempts: 0,
		};

		// Remove lockedUntil if it exists
		if (updatedUser.lockedUntil) {
			delete updatedUser.lockedUntil;
		}

		await this.userDb.put(input.userId, updatedUser);

		// Invalidate all existing sessions for this user
		await this.invalidateAllUserSessions(input.userId);

		console.log(`[USER-MANAGER] Password changed for user: ${updatedUser.username}`);
	}

	async invalidateAllUserSessions(userId: string): Promise<void> {
		await this.ensureDatabasesOpen();

		try {
			const sessions: Array<Session & { key: string }> = [];
			const iterator = this.sessionDb.iterator();

			for await (const [key, value] of iterator) {
				if (value.userId === userId && value.isActive) {
					sessions.push({ ...value, key });
				}
			}
			await iterator.close();

			for (const session of sessions) {
				const updatedSession = { ...session, isActive: false };
				await this.sessionDb.put(session.key, updatedSession);
			}

			if (sessions.length > 0) {
				console.log(`[USER-MANAGER] Invalidated ${sessions.length} sessions for user: ${userId}`);
			}
		} catch (error) {
			console.error("[USER-MANAGER] Session invalidation error:", error);
		}
	}

	async getUserSessions(userId: string): Promise<Session[]> {
		await this.ensureDatabasesOpen();

		try {
			const sessions: Session[] = [];
			const iterator = this.sessionDb.iterator();

			for await (const [_key, value] of iterator) {
				if (value.userId === userId && value.isActive) {
					sessions.push(value);
				}
			}
			await iterator.close();

			return sessions.sort(
				(a, b) => new Date(b.lastAccessAt).getTime() - new Date(a.lastAccessAt).getTime(),
			);
		} catch (error) {
			console.error("[USER-MANAGER] Error getting user sessions:", error);
			return [];
		}
	}

	async validateSession(token: string): Promise<User | null> {
		await this.ensureDatabasesOpen();

		try {
			const verification = this.authService.verifyToken(token);
			if (!verification.valid) {
				return null;
			}

			const sessions: Array<Session & { key: string }> = [];
			const iterator = this.sessionDb.iterator();

			for await (const [key, value] of iterator) {
				if (value.token === token && value.isActive && value.expiresAt > new Date()) {
					sessions.push({ ...value, key });
				}
			}
			await iterator.close();

			if (sessions.length === 0) {
				return null;
			}

			const session = sessions[0];
			if (!session) {
				return null;
			}

			const user = await this.userDb.get(session.userId);

			if (!user || !user.isActive) {
				return null;
			}

			// Update last access time
			const updatedSession: Session = {
				...session,
				lastAccessAt: new Date(),
			};
			await this.sessionDb.put(session.key, updatedSession);

			return user;
		} catch (error) {
			console.error("[USER-MANAGER] Session validation error:", error);
			return null;
		}
	}

	async requestPasswordReset(
		request: PasswordResetRequest,
	): Promise<{ success: boolean; message: string }> {
		await this.ensureDatabasesOpen();

		try {
			const users = await this.getAllUsers();
			const user = users.find((u) => u.email === request.email);

			if (!user) {
				// Don't reveal if email exists or not for security
				return {
					success: true,
					message: "If the email exists, a password reset link has been sent",
				};
			}

			// Generate password reset token
			const { token, expiresAt } = this.authService.generatePasswordResetToken();
			const tokenId = `reset-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;

			const passwordResetToken: PasswordResetToken = {
				id: tokenId,
				userId: user.id,
				token,
				email: request.email,
				expiresAt,
				createdAt: new Date(),
				isUsed: false,
			};

			await this.passwordResetDb.put(tokenId, passwordResetToken);

			console.log(`[USER-MANAGER] Password reset requested for: ${request.email}`);
			console.log(`[USER-MANAGER] Reset token: ${token} (in production, this would be emailed)`);

			return {
				success: true,
				message: "Password reset link sent successfully",
			};
		} catch (error) {
			console.error("[USER-MANAGER] Password reset request error:", error);
			return {
				success: false,
				message: "Failed to process password reset request",
			};
		}
	}

	async resetPassword(input: PasswordResetInput): Promise<{ success: boolean; message: string }> {
		await this.ensureDatabasesOpen();

		try {
			// Find the reset token
			const tokens: Array<PasswordResetToken & { key: string }> = [];
			const iterator = this.passwordResetDb.iterator();

			for await (const [key, value] of iterator) {
				if (value.token === input.token && !value.isUsed && value.expiresAt > new Date()) {
					tokens.push({ ...value, key });
				}
			}
			await iterator.close();

			if (tokens.length === 0) {
				return {
					success: false,
					message: "Invalid or expired reset token",
				};
			}

			const resetToken = tokens[0];
			if (!resetToken) {
				return { success: false, message: "Invalid reset token" };
			}
			const user = await this.userDb.get(resetToken.userId);

			if (!user) {
				return { success: false, message: "User not found" };
			}

			// Validate new password
			const passwordValidation = this.authService.validatePasswordStrength(input.newPassword);
			if (!passwordValidation.isValid) {
				return {
					success: false,
					message: passwordValidation.errors.join(", "),
				};
			}

			// Hash new password
			const newPasswordHash = await this.authService.hashPassword(input.newPassword);

			// Update user password
			const updatedUser: User = {
				...user,
				passwordHash: newPasswordHash,
				passwordChangedAt: new Date(),
				updatedAt: new Date(),
				failedLoginAttempts: 0,
			};

			// Remove lockedUntil if it exists
			if (updatedUser.lockedUntil) {
				delete updatedUser.lockedUntil;
			}

			await this.userDb.put(user.id, updatedUser);

			// Mark token as used
			const usedToken: PasswordResetToken = {
				...resetToken,
				isUsed: true,
			};
			await this.passwordResetDb.put(resetToken.key, usedToken);

			// Invalidate all existing sessions for this user
			await this.invalidateAllUserSessions(user.id);

			console.log(`[USER-MANAGER] Password reset completed for user: ${user.username}`);

			return { success: true, message: "Password reset successfully" };
		} catch (error) {
			console.error("[USER-MANAGER] Password reset error:", error);
			return { success: false, message: "Failed to reset password" };
		}
	}

	async generateEmailVerification(
		userId: string,
	): Promise<{ success: boolean; token?: string; message: string }> {
		await this.ensureDatabasesOpen();

		try {
			const user = await this.userDb.get(userId);
			if (!user) {
				return { success: false, message: "User not found" };
			}

			if (user.isEmailVerified) {
				return { success: false, message: "Email is already verified" };
			}

			// Generate email verification token
			const { token, expiresAt } = this.authService.generateEmailVerificationToken();
			const tokenId = `verify-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;

			const emailVerificationToken: EmailVerificationToken = {
				id: tokenId,
				userId: user.id,
				token,
				email: user.email,
				expiresAt,
				createdAt: new Date(),
				isUsed: false,
			};

			await this.emailVerificationDb.put(tokenId, emailVerificationToken);

			console.log(`[USER-MANAGER] Email verification generated for: ${user.email}`);
			console.log(
				`[USER-MANAGER] Verification token: ${token} (in production, this would be emailed)`,
			);

			return {
				success: true,
				token,
				message: "Email verification link sent successfully",
			};
		} catch (error) {
			console.error("[USER-MANAGER] Email verification generation error:", error);
			return {
				success: false,
				message: "Failed to generate email verification",
			};
		}
	}

	async verifyEmail(input: EmailVerificationInput): Promise<{ success: boolean; message: string }> {
		await this.ensureDatabasesOpen();

		try {
			// Find the verification token
			const tokens: Array<EmailVerificationToken & { key: string }> = [];
			const iterator = this.emailVerificationDb.iterator();

			for await (const [key, value] of iterator) {
				if (value.token === input.token && !value.isUsed && value.expiresAt > new Date()) {
					tokens.push({ ...value, key });
				}
			}
			await iterator.close();

			if (tokens.length === 0) {
				return {
					success: false,
					message: "Invalid or expired verification token",
				};
			}

			const verificationToken = tokens[0];
			if (!verificationToken) {
				return {
					success: false,
					message: "Invalid verification token",
				};
			}
			const user = await this.userDb.get(verificationToken.userId);

			if (!user) {
				return { success: false, message: "User not found" };
			}

			// Mark user email as verified
			const updatedUser: User = {
				...user,
				isEmailVerified: true,
				updatedAt: new Date(),
			};

			await this.userDb.put(user.id, updatedUser);

			// Mark token as used
			const usedToken: EmailVerificationToken = {
				...verificationToken,
				isUsed: true,
			};
			await this.emailVerificationDb.put(verificationToken.key, usedToken);

			console.log(`[USER-MANAGER] Email verified for user: ${user.username}`);

			return { success: true, message: "Email verified successfully" };
		} catch (error) {
			console.error("[USER-MANAGER] Email verification error:", error);
			return { success: false, message: "Failed to verify email" };
		}
	}

	async cleanupExpiredTokens(): Promise<void> {
		await this.ensureDatabasesOpen();

		try {
			const now = new Date();

			// Clean up expired password reset tokens
			const expiredResetTokens: Array<PasswordResetToken & { key: string }> = [];
			const resetIterator = this.passwordResetDb.iterator();

			for await (const [key, value] of resetIterator) {
				if (value.expiresAt <= now || value.isUsed) {
					expiredResetTokens.push({ ...value, key });
				}
			}
			await resetIterator.close();

			for (const token of expiredResetTokens) {
				await this.passwordResetDb.del(token.key);
			}

			// Clean up expired email verification tokens
			const expiredVerificationTokens: Array<EmailVerificationToken & { key: string }> = [];
			const verificationIterator = this.emailVerificationDb.iterator();

			for await (const [key, value] of verificationIterator) {
				if (value.expiresAt <= now || value.isUsed) {
					expiredVerificationTokens.push({ ...value, key });
				}
			}
			await verificationIterator.close();

			for (const token of expiredVerificationTokens) {
				await this.emailVerificationDb.del(token.key);
			}

			if (expiredResetTokens.length > 0 || expiredVerificationTokens.length > 0) {
				console.log(
					`[USER-MANAGER] Cleaned up ${expiredResetTokens.length} expired reset tokens and ${expiredVerificationTokens.length} expired verification tokens`,
				);
			}
		} catch (error) {
			console.error("[USER-MANAGER] Token cleanup error:", error);
		}
	}
}

// Singleton accessor to avoid LevelDB lock contention across routes/process helpers.
let sharedUserManager: UserManager | null = null;
export function getUserManager(): UserManager {
	if (!sharedUserManager) {
		sharedUserManager = new UserManager();
	}
	return sharedUserManager;
}

