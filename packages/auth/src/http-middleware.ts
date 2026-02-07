import type express from "express";
import type { User } from "./types.ts";
import { isAdminUser, loadAdminSettings } from "./admin-settings.ts";
import { getUserManager } from "./user-manager.ts";

export type AuthContextRequest = express.Request & {
    user?: User;
    authUser?: User;
    isAuthenticated?: boolean;
};

const canUserWrite = async (user?: User | null): Promise<boolean> => {
    const adminSettings = await loadAdminSettings();
    if (adminSettings.allowNonAdminWrites) return true;
    return isAdminUser(user?.username);
};

export const softAuthContext = async (
    req: AuthContextRequest,
    _res: express.Response,
    next: express.NextFunction,
) => {
    req.isAuthenticated = false;
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(" ")[1];
    if (!token) {
        return next();
    }
    try {
        const userManager = getUserManager();
        const user = await userManager.validateSession(token);
        if (user) {
            req.authUser = user;
            req.isAuthenticated = true;
        }
    } catch (error) {
        console.warn("[HTTP API] Soft auth context failed:", error);
    }
    return next();
};

export const authenticateToken = async (
    req: AuthContextRequest,
    res: express.Response,
    next: express.NextFunction,
) => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(" ")[1];

    if (!token) {
        return res.status(401).json({ error: "Access token required" });
    }

    try {
        const userManager = getUserManager();
        const user = await userManager.validateSession(token);

        if (!user) {
            return res.status(401).json({ error: "Invalid or expired token" });
        }

        req.user = user;
        req.authUser = user;
        req.isAuthenticated = true;
        next();
    } catch (error) {
        console.error("[HTTP API] Authentication error:", error);
        return res.status(500).json({ error: "Authentication failed" });
    }
};

export const enforceAdminWriteAccess = async (
    req: AuthContextRequest,
    res: express.Response,
    next: express.NextFunction,
) => {
    const user = req.user || req.authUser;
    const allowed = await canUserWrite(user);
    if (!allowed) {
        return res
            .status(403)
            .json({ error: "Write access is restricted to admin users (nyan/admin)" });
    }
    next();
};

export const requirePermission = (resource: string, action: string) => {
    return async (req: AuthContextRequest, res: express.Response, next: express.NextFunction) => {
        const user = req.user || req.authUser;

        if (!user) {
            return res.status(401).json({ error: "Authentication required" });
        }

        try {
            const adminSettings = await loadAdminSettings();

            if (!isAdminUser(user.username) && !adminSettings.allowNonAdminWrites && action !== "read") {
                return res.status(403).json({
                    error: "Write access is restricted to admin users (nyan/admin)",
                });
            }

            const userManager = getUserManager();
            const hasPermission = await userManager.hasPermission(user, resource, action);

            if (!hasPermission) {
                return res.status(403).json({ error: "Insufficient permissions" });
            }

            next();
        } catch (error) {
            console.error("[HTTP API] Authorization error:", error);
            return res.status(500).json({ error: "Authorization failed" });
        }
    };
};
