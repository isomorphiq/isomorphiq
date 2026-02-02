import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { DeviceInfo, PasswordPolicy, User, UserPreferences, UserProfile } from "./types.ts";

/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class AuthService {
	private jwtSecret: string;
	private jwtRefreshSecret: string;
	private passwordPolicy: PasswordPolicy;

	constructor() {
		this.jwtSecret = process.env.JWT_SECRET || crypto.randomBytes(64).toString("hex");
		this.jwtRefreshSecret =
			process.env.JWT_REFRESH_SECRET || crypto.randomBytes(64).toString("hex");

		this.passwordPolicy = {
			minLength: 8,
			requireUppercase: true,
			requireLowercase: true,
			requireNumbers: true,
			requireSpecialChars: true,
			preventReuse: 5,
			maxAge: 90, // days
		};
	}

	async hashPassword(password: string): Promise<string> {
		const saltRounds = 12;
		return bcrypt.hash(password, saltRounds);
	}

	async verifyPassword(password: string, hash: string): Promise<boolean> {
		return bcrypt.compare(password, hash);
	}

	validatePasswordStrength(password: string): {
		isValid: boolean;
		errors: string[];
	} {
		const errors: string[] = [];

		if (password.length < this.passwordPolicy.minLength) {
			errors.push(`Password must be at least ${this.passwordPolicy.minLength} characters long`);
		}

		if (this.passwordPolicy.requireUppercase && !/[A-Z]/.test(password)) {
			errors.push("Password must contain at least one uppercase letter");
		}

		if (this.passwordPolicy.requireLowercase && !/[a-z]/.test(password)) {
			errors.push("Password must contain at least one lowercase letter");
		}

		if (this.passwordPolicy.requireNumbers && !/\d/.test(password)) {
			errors.push("Password must contain at least one number");
		}

		if (
			this.passwordPolicy.requireSpecialChars &&
			!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password)
		) {
			errors.push("Password must contain at least one special character");
		}

		return {
			isValid: errors.length === 0,
			errors,
		};
	}

	generateTokens(userId: string): {
		token: string;
		refreshToken: string;
		expiresIn: number;
	} {
		const payload = { userId, type: "access" };
		const refreshPayload = { userId, type: "refresh" };

		const token = jwt.sign(payload, this.jwtSecret, {
			expiresIn: "15m",
			issuer: "opencode-task-manager",
			audience: "opencode-users",
		});

		const refreshToken = jwt.sign(refreshPayload, this.jwtRefreshSecret, {
			expiresIn: "7d",
			issuer: "opencode-task-manager",
			audience: "opencode-users",
		});

		return {
			token,
			refreshToken,
			expiresIn: 15 * 60, // 15 minutes in seconds
		};
	}

	verifyToken(token: string): {
		userId: string;
		valid: boolean;
		error?: string;
	} {
		try {
			const decoded = jwt.verify(token, this.jwtSecret, {
				issuer: "opencode-task-manager",
				audience: "opencode-users",
			}) as { type: string; userId: string; exp: number; iat: number };

			if (decoded.type !== "access") {
				return {
					userId: "",
					valid: false,
					error: "Invalid token type",
				};
			}

			return { userId: decoded.userId, valid: true };
		} catch {
			return { userId: "", valid: false, error: "Invalid token" };
		}
	}

	verifyRefreshToken(refreshToken: string): {
		userId: string;
		valid: boolean;
		error?: string;
	} {
		try {
			const decoded = jwt.verify(refreshToken, this.jwtRefreshSecret, {
				issuer: "opencode-task-manager",
				audience: "opencode-users",
			}) as { type: string; userId: string; exp: number; iat: number };

			if (decoded.type !== "refresh") {
				return {
					userId: "",
					valid: false,
					error: "Invalid refresh token type",
				};
			}

			return { userId: decoded.userId, valid: true };
		} catch {
			return { userId: "", valid: false, error: "Invalid refresh token" };
		}
	}

	extractDeviceInfo(userAgent?: string): DeviceInfo {
		if (!userAgent) {
			return { type: "unknown" };
		}

		const ua = userAgent.toLowerCase();

		// Detect device type
		let type: DeviceInfo["type"] = "desktop";
		if (/mobile|android|iphone|ipad|phone/i.test(ua)) {
			type = /tablet|ipad/i.test(ua) ? "tablet" : "mobile";
		}

		// Detect OS
		let os: string | undefined;
		if (/windows/i.test(ua)) os = "Windows";
		else if (/mac/i.test(ua)) os = "macOS";
		else if (/linux/i.test(ua)) os = "Linux";
		else if (/android/i.test(ua)) os = "Android";
		else if (/ios|iphone|ipad/i.test(ua)) os = "iOS";

		// Detect browser
		let browser: string | undefined;
		if (/chrome/i.test(ua)) browser = "Chrome";
		else if (/firefox/i.test(ua)) browser = "Firefox";
		else if (/safari/i.test(ua)) browser = "Safari";
		else if (/edge/i.test(ua)) browser = "Edge";

		const deviceInfo: DeviceInfo = {
			type,
		};

		if (os) deviceInfo.os = os;
		if (browser) deviceInfo.browser = browser;
		if (os && browser) deviceInfo.name = `${os} ${browser}`.trim();

		return deviceInfo;
	}

	generateSecureToken(): string {
		return crypto.randomBytes(32).toString("hex");
	}

	isAccountLocked(user: User): boolean {
		if (!user.lockedUntil) return false;
		return new Date() < new Date(user.lockedUntil);
	}

	async handleFailedLogin(user: User): Promise<{ isLocked: boolean; lockUntil?: Date }> {
		const maxAttempts = 5;
		const lockDuration = 30 * 60 * 1000; // 30 minutes

		const updatedAttempts = user.failedLoginAttempts + 1;
		let lockUntil: Date | undefined;

		if (updatedAttempts >= maxAttempts) {
			lockUntil = new Date(Date.now() + lockDuration);
		}

		const result: { isLocked: boolean; lockUntil?: Date } = {
			isLocked: !!lockUntil,
		};

		if (lockUntil) {
			result.lockUntil = lockUntil;
		}

		return result;
	}

	async resetFailedLoginAttempts(): Promise<void> {
		// This would be handled by the UserManager
	}

	getDefaultProfile(): UserProfile {
		return {
			timezone: "UTC",
			language: "en",
		};
	}

	getDefaultPreferences(): UserPreferences {
		return {
			theme: "auto",
			notifications: {
				email: true,
				push: true,
				taskAssigned: true,
				taskCompleted: false,
				taskOverdue: true,
			},
			dashboard: {
				defaultView: "list",
				itemsPerPage: 25,
				showCompleted: false,
			},
		};
	}

    sanitizeUserForResponse(user: User): Omit<User, "passwordHash"> {
        const { passwordHash, ...sanitizedUser } = user;
        void passwordHash;
        return sanitizedUser;
    }

	generatePasswordResetToken(): { token: string; expiresAt: Date } {
		const token = this.generateSecureToken();
		const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
		return { token, expiresAt };
	}

	generateEmailVerificationToken(): { token: string; expiresAt: Date } {
		const token = this.generateSecureToken();
		const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
		return { token, expiresAt };
	}

	validatePasswordResetToken(token: string, _storedTokenHash: string, expiresAt: Date): boolean {
		if (new Date() > expiresAt) {
			return false;
		}

		// Simple token validation (in production, you'd want more secure comparison)
		return token.length === 64 && /^[a-f0-9]+$/i.test(token);
	}

	validateEmailVerificationToken(
		token: string,
		_storedTokenHash: string,
		expiresAt: Date,
	): boolean {
		if (new Date() > expiresAt) {
			return false;
		}

		return token.length === 64 && /^[a-f0-9]+$/i.test(token);
	}
}

