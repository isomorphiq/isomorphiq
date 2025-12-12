import type express from "express";
import type { AdminSettings, User } from "../../types.ts";
import { isAdminUser, loadAdminSettings, saveAdminSettings } from "../../admin-settings.ts";
import { authenticateToken, type AuthContextRequest } from "../middleware.ts";

export function registerAdminRoutes(app: express.Application) {
    app.get(
        "/api/admin/settings",
        authenticateToken,
        async (req: AuthContextRequest, res, next) => {
            try {
                const user = req.user as User;
                if (!user || !isAdminUser(user.username)) {
                    return res.status(403).json({ error: "Admin access required" });
                }

                const settings = await loadAdminSettings();
                res.json({ settings });
            } catch (error) {
                next(error);
            }
        },
    );

    app.put(
        "/api/admin/settings",
        authenticateToken,
        async (req: AuthContextRequest, res, next) => {
            try {
                const user = req.user as User;
                if (!user || !isAdminUser(user.username)) {
                    return res.status(403).json({ error: "Admin access required" });
                }

                const incoming = req.body as Partial<AdminSettings>;
                const updates: Partial<AdminSettings> = {};

                if (typeof incoming.registrationEnabled === "boolean") {
                    updates.registrationEnabled = incoming.registrationEnabled;
                }
                if (typeof incoming.allowNonAdminWrites === "boolean") {
                    updates.allowNonAdminWrites = incoming.allowNonAdminWrites;
                }

                const settings = await saveAdminSettings(updates);
                res.json({ settings });
            } catch (error) {
                next(error);
            }
        },
    );
}
