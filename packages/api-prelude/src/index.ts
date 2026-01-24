import type { NextFunction, Request, Response } from "express";
import type { User } from "@isomorphiq/auth";
import type { UserManager } from "@isomorphiq/auth";

export type AuthenticatedRequest = Request & { user?: User };
export type Middleware = (req: Request, res: Response, next: NextFunction) => void | Promise<void>;
export type RouteHandler = (
    req: Request,
    res: Response,
    next: NextFunction,
) => Promise<void> | void;

export function createAuthMiddleware(userManager: UserManager): Middleware {
    return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
        const authHeader = req.headers.authorization;
        const token = authHeader?.split(" ")[1];

        if (!token) {
            res.status(401).json({ error: "Access token required" });
            return;
        }

        try {
            const user = await userManager.validateSession(token);
            if (!user) {
                res.status(401).json({ error: "Invalid or expired token" });
                return;
            }

            req.user = user;
            next();
        } catch (error) {
            console.error("[API] Authentication error:", error);
            res.status(500).json({ error: "Authentication failed" });
        }
    };
}

export function createAuthorizationMiddleware(
    userManager: UserManager,
    resource: string,
    action: string,
): Middleware {
    return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
        const user = req.user;
        if (!user) {
            res.status(401).json({ error: "Authentication required" });
            return;
        }

        try {
            const hasPermission = await userManager.hasPermission(user, resource, action);
            if (!hasPermission) {
                res.status(403).json({ error: "Insufficient permissions" });
                return;
            }
            next();
        } catch (error) {
            console.error("[API] Authorization error:", error);
            res.status(500).json({ error: "Authorization failed" });
        }
    };
}

export function createValidationMiddleware(validator: (body: unknown) => void): Middleware {
    return (req: Request, res: Response, next: NextFunction) => {
        try {
            validator(req.body);
            next();
        } catch (error) {
            res.status(400).json({ error: (error as Error).message });
        }
    };
}

export function createRateLimitMiddleware(options: { windowMs: number; max: number }): Middleware {
    const requests = new Map<string, { count: number; resetTime: number }>();

    return (req: Request, res: Response, next: NextFunction): void => {
        const key = req.ip || "unknown";
        const now = Date.now();
        const windowMs = options.windowMs;

        let requestData = requests.get(key);
        if (!requestData || now > requestData.resetTime) {
            requestData = { count: 0, resetTime: now + windowMs };
            requests.set(key, requestData);
        }

        requestData.count++;
        if (requestData.count > options.max) {
            res.status(429).json({
                error: "Too many requests",
                retryAfter: Math.ceil((requestData.resetTime - now) / 1000),
            });
            return;
        }

        next();
    };
}

export function requestLogger(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
    const start = Date.now();

    res.on("finish", () => {
        const duration = Date.now() - start;
        const user = req.user;
        const userId = user ? user.id : "anonymous";
        console.log(`[HTTP] ${req.method} ${req.path} - ${res.statusCode} - ${duration}ms - User: ${userId}`);
    });

    next();
}

export function errorHandler(
    err: unknown,
    _req: Request,
    res: Response,
    _next: NextFunction,
): void {
    void _next;
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("[HTTP] Error:", err);
    res.status(500).json({ error: message });
}
