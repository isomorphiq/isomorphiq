import type express from "express";
import type {
    AuthCredentials,
    ChangePasswordInput,
    CreateUserInput,
    UpdateProfileInput,
    User,
} from "./types.ts";
import { createUserProfileClient } from "@isomorphiq/profiles";
import { loadAdminSettings } from "./admin-settings.ts";
import { getUserManager } from "./user-manager.ts";
import {
    authenticateToken,
    enforceAdminWriteAccess,
    type AuthContextRequest,
} from "./http-middleware.ts";

export function registerAuthRoutes(app: express.Application) {
    const userProfileClient = createUserProfileClient();
    const mergeProfileData = async <T extends {
        id?: string;
        profile?: Record<string, unknown>;
        preferences?: Record<string, unknown>;
    }>(
        user: T,
    ): Promise<T> => {
        if (!user.id) {
            return user;
        }
        try {
            const profileRecord = await userProfileClient.getOrCreateProfile(user.id, {
                profile: user.profile ?? {},
                preferences: user.preferences ?? {},
            });
            return {
                ...user,
                profile: profileRecord.profile,
                preferences: profileRecord.preferences,
            };
        } catch (error) {
            console.warn("[HTTP API] Failed to read user-profile service; using auth profile fallback:", error);
            return user;
        }
    };

    const sendCurrentUser = async (req: AuthContextRequest, res: express.Response): Promise<void> => {
        const requestUser = req.user as User;
        const userManager = getUserManager();
        const fresh = await userManager.getUserById(requestUser.id);
        if (!fresh) {
            res.status(404).json({ error: "User not found" });
            return;
        }
        const merged = await mergeProfileData(fresh);
        res.json({ user: { ...merged, passwordHash: undefined } });
    };

    // GET /api/auth/registration-status - Public status endpoint
    app.get("/api/auth/registration-status", (_req, res) => {
        const disabled = process.env.DISABLE_REGISTRATION === "true";
        loadAdminSettings()
            .then((settings) => {
                const adminDisabled = !settings.registrationEnabled;
                const isDisabled = disabled || adminDisabled;
                return res.json({
                    disabled: isDisabled,
                    message: isDisabled
                        ? "Registration is currently disabled."
                        : "Registration is open.",
                });
            })
            .catch(() =>
                res.json({
                    disabled: true,
                    message: "Registration is currently disabled.",
                }),
            );
    });

    // POST /api/auth/register - Public user registration
    app.post("/api/auth/register", async (req, res, next) => {
        try {
            const adminSettings = await loadAdminSettings();
            const registrationsDisabled =
                process.env.DISABLE_REGISTRATION === "true" || !adminSettings.registrationEnabled;

            if (registrationsDisabled) {
                return res
                    .status(403)
                    .json({ error: "Registration is currently disabled by the administrator." });
            }

            const { username, email, password, role } = req.body as Partial<CreateUserInput> & {
                role?: string;
            };

            if (!username || !email || !password) {
                return res.status(400).json({ error: "Username, email, and password are required" });
            }

            const userManager = getUserManager();
            const user = await userManager.createUser({
                username,
                email,
                password,
                role: role && typeof role === "string" ? role : "developer",
            });
            const mergedUser = await mergeProfileData(user);

            const auth = await userManager.authenticateUser({ username, password });
            if (!auth.success || !auth.token) {
                return res.status(500).json({ error: "Authentication failed after registration" });
            }

            return res.status(201).json({
                user: { ...mergedUser, passwordHash: undefined },
                token: auth.token,
                message: "Registration successful",
            });
        } catch (error) {
            if (error instanceof Error) {
                return res.status(400).json({ error: error.message });
            }
            next(error);
        }
    });

    // POST /api/auth/login - User login
    app.post("/api/auth/login", async (req, res, next) => {
        try {
            const { username, password } = req.body as AuthCredentials;
            console.log(`[HTTP API] POST /api/auth/login - Login attempt: ${username}`);

            if (!username || !password) {
                return res.status(400).json({ error: "Username and password are required" });
            }

            const userManager = getUserManager();
            const result = await userManager.authenticateUser({
                username,
                password,
            });

            if (result.success && result.user && result.token) {
                const merged = await mergeProfileData(result.user);
                res.json({
                    user: merged,
                    token: result.token,
                    message: "Login successful",
                });
            } else {
                res.status(401).json({ error: result.error || "Login failed" });
            }
        } catch (error) {
            next(error);
        }
    });

    // POST /api/auth/logout - User logout
    app.post("/api/auth/logout", async (req, res, next) => {
        try {
            const authHeader = req.headers.authorization;
            const token = authHeader?.split(" ")[1];

            if (!token) {
                return res.status(400).json({ error: "Token required" });
            }

            const userManager = getUserManager();
            const success = await userManager.logoutUser(token);

            if (success) {
                res.json({ message: "Logout successful" });
            } else {
                res.status(400).json({ error: "Invalid token" });
            }
        } catch (error) {
            next(error);
        }
    });

    // GET /api/auth/me - Get current user info (fresh from DB)
    app.get("/api/auth/me", authenticateToken, async (req: AuthContextRequest, res, next) => {
        try {
            await sendCurrentUser(req, res);
        } catch (error) {
            next(error);
        }
    });
    app.get("/api/users/me", authenticateToken, async (req: AuthContextRequest, res, next) => {
        try {
            await sendCurrentUser(req, res);
        } catch (error) {
            next(error);
        }
    });

    // POST /api/auth/refresh - Refresh access token
    app.post("/api/auth/refresh", async (req, res, next) => {
        try {
            const { refreshToken } = req.body;

            if (!refreshToken) {
                return res.status(400).json({ error: "Refresh token is required" });
            }

            const userManager = getUserManager();
            const result = await userManager.refreshToken(refreshToken);

            if (result.success) {
                res.json(result);
            } else {
                res.status(401).json({
                    error: result.error || "Token refresh failed",
                });
            }
        } catch (error) {
            next(error);
        }
    });

    // PUT /api/auth/profile - Update user profile
    app.put(
        "/api/auth/profile",
        authenticateToken,
        enforceAdminWriteAccess,
        async (req: AuthContextRequest, res, next) => {
            try {
                const user = req.user as User;
                const { profile, preferences } = req.body as UpdateProfileInput;

                const userManager = getUserManager();
                const updateData: UpdateProfileInput = { userId: user.id };
                if (profile) updateData.profile = profile;
                if (preferences) updateData.preferences = preferences;
                await userProfileClient.upsertProfile({
                    userId: user.id,
                    profile: updateData.profile,
                    preferences: updateData.preferences,
                });
                await sendCurrentUser(req, res);
            } catch (error) {
                next(error);
            }
        },
    );
    app.put(
        "/api/users/me/profile",
        authenticateToken,
        enforceAdminWriteAccess,
        async (req: AuthContextRequest, res, next) => {
            try {
                const user = req.user as User;
                const { profile, preferences } = req.body as UpdateProfileInput;
                await userProfileClient.upsertProfile({
                    userId: user.id,
                    profile,
                    preferences,
                });
                await sendCurrentUser(req, res);
            } catch (error) {
                next(error);
            }
        },
    );

    // PUT /api/auth/password - Change password
    app.put(
        "/api/auth/password",
        authenticateToken,
        enforceAdminWriteAccess,
        async (req: AuthContextRequest, res, next) => {
            try {
                const user = req.user as User;
                const { currentPassword, newPassword } = req.body as ChangePasswordInput;

                if (!currentPassword || !newPassword) {
                    return res.status(400).json({
                        error: "Current password and new password are required",
                    });
                }

                const userManager = getUserManager();
                await userManager.changePassword({
                    userId: user.id,
                    currentPassword,
                    newPassword,
                });

                res.json({ message: "Password changed successfully" });
            } catch (error) {
                next(error);
            }
        },
    );

    // GET /api/auth/sessions - Get user sessions
    app.get("/api/auth/sessions", authenticateToken, async (req: AuthContextRequest, res, next) => {
        try {
            const user = req.user as User;

            const userManager = getUserManager();
            const sessions = await userManager.getUserSessions(user.id);

            res.json({ sessions });
        } catch (error) {
            next(error);
        }
    });

    // DELETE /api/auth/sessions - Invalidate all user sessions
    app.delete(
        "/api/auth/sessions",
        authenticateToken,
        enforceAdminWriteAccess,
        async (req: AuthContextRequest, res, next) => {
            try {
                const user = req.user as User;

                const userManager = getUserManager();
                await userManager.invalidateAllUserSessions(user.id);

                res.json({ message: "All sessions invalidated successfully" });
            } catch (error) {
                next(error);
            }
        },
    );

    // GET /api/auth/permissions - Get permission matrix
    app.get(
        "/api/auth/permissions",
        authenticateToken,
        async (req: AuthContextRequest, res, next) => {
            try {
                const user = req.user as User;

                const userManager = getUserManager();
                const permissions = await userManager.getUserPermissions(user);
                const matrix = await userManager.getPermissionMatrix();
                const availableResources = await userManager.getAvailableResources();

                res.json({
                    userPermissions: permissions,
                    permissionMatrix: matrix,
                    availableResources,
                });
            } catch (error) {
                next(error);
            }
        },
    );
}
