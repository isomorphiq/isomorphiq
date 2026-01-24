import express from "express";
import type { CreateUserInput, UpdateUserInput, User } from "./types.ts";
import { getUserManager } from "./user-manager.ts";
import { authenticateToken, requirePermission, type AuthContextRequest } from "./http-middleware.ts";

export function registerUserRoutes(app: express.Application) {
    const router = express.Router();

    router.get(
        "/",
        authenticateToken,
        requirePermission("users", "read"),
        async (_req, res, next) => {
            try {
                console.log("[HTTP API] GET /api/users - Listing all users");
                const userManager = getUserManager();
                const users = await userManager.getAllUsers();
                const usersWithoutPasswords = users.map((user: User) => ({
                    ...user,
                    passwordHash: undefined,
                }));
                res.json({
                    users: usersWithoutPasswords,
                    count: usersWithoutPasswords.length,
                });
            } catch (error) {
                next(error);
            }
        },
    );

    router.post(
        "/",
        authenticateToken,
        requirePermission("users", "create"),
        async (req, res, next) => {
            try {
                const { username, email, password, role } = req.body as CreateUserInput;
                console.log(`[HTTP API] POST /api/users - Creating user: ${username}`);

                const userManager = getUserManager();
                const user = await userManager.createUser({
                    username,
                    email,
                    password,
                    ...(role && { role }),
                });
                res.status(201).json({
                    user: { ...user, passwordHash: undefined },
                });
            } catch (error) {
                next(error);
            }
        },
    );

    router.put(
        "/:id",
        authenticateToken,
        requirePermission("users", "update"),
        async (req, res, next) => {
            try {
                const { id } = req.params;
                if (!id) {
                    return res.status(400).json({ error: "User ID is required" });
                }
                const { username, email, role, isActive } = req.body as UpdateUserInput;
                console.log(`[HTTP API] PUT /api/users/${id} - Updating user`);

                const userManager = getUserManager();
                const user = await userManager.updateUser({
                    id,
                    ...(username && { username }),
                    ...(email && { email }),
                    ...(role && { role }),
                    ...(isActive !== undefined && { isActive }),
                });
                res.json({ user: { ...user, passwordHash: undefined } });
            } catch (error) {
                next(error);
            }
        },
    );

    router.delete(
        "/:id",
        authenticateToken,
        requirePermission("users", "delete"),
        async (req, res, next) => {
            try {
                const { id } = req.params;
                if (!id) {
                    return res.status(400).json({ error: "User ID is required" });
                }
                console.log(`[HTTP API] DELETE /api/users/${id} - Deleting user`);

                const userManager = getUserManager();
                await userManager.deleteUser(id);
                res.json({
                    success: true,
                    message: "User deleted successfully",
                });
            } catch (error) {
                next(error);
            }
        },
    );

    router.post(
        "/:id/unlock",
        authenticateToken,
        requirePermission("users", "update"),
        async (req: AuthContextRequest, res, next) => {
            try {
                const { id } = req.params;
                if (!id) {
                    return res.status(400).json({ error: "User ID is required" });
                }
                console.log(`[HTTP API] POST /api/users/${id}/unlock - Unlocking user account`);

                const userManager = getUserManager();
                const user = await userManager.getUserById(id);
                if (!user) {
                    return res.status(404).json({ error: "User not found" });
                }

                const updatedUser = {
                    ...user,
                    failedLoginAttempts: 0,
                    updatedAt: new Date(),
                };

                delete (updatedUser as Partial<User>).lockedUntil;

                try {
                    const updatedUserResult = await userManager.updateUser(updatedUser);
                    res.json({
                        success: true,
                        message: "User account unlocked successfully",
                        user: { ...updatedUserResult, passwordHash: undefined },
                    });
                } catch (error) {
                    res.status(400).json({
                        error: error instanceof Error ? error.message : "Failed to unlock user",
                    });
                }
            } catch (error) {
                next(error);
            }
        },
    );

    router.post(
        "/admin/unlock-all",
        authenticateToken,
        requirePermission("users", "update"),
        async (_req, res, next) => {
            try {
                console.log("[HTTP API] POST /api/admin/unlock-all - Unlocking all user accounts");

                const userManager = getUserManager();
                const users = await userManager.getAllUsers();

                let unlockedCount = 0;
                const errors: string[] = [];

                for (const user of users) {
                    if (user.lockedUntil || user.failedLoginAttempts > 0) {
                        try {
                            const updatedUser = {
                                ...user,
                                failedLoginAttempts: 0,
                                updatedAt: new Date(),
                            };

                            delete (updatedUser as Partial<User>).lockedUntil;

                            try {
                                await userManager.updateUser(updatedUser);
                                unlockedCount++;
                            } catch (error) {
                                errors.push(
                                    `Failed to unlock ${user.username}: ${error instanceof Error ? error.message : String(error)}`,
                                );
                            }
                        } catch (error) {
                            errors.push(
                                `Error unlocking ${user.username}: ${error instanceof Error ? error.message : String(error)}`,
                            );
                        }
                    }
                }

                res.json({
                    success: true,
                    message: `Unlocked ${unlockedCount} user accounts`,
                    unlockedCount,
                    totalUsers: users.length,
                    errors: errors.length > 0 ? errors : undefined,
                });
            } catch (error) {
                next(error);
            }
        },
    );

    app.use("/api/users", router);
}
