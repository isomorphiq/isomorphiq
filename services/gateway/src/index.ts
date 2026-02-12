import http from "node:http";
import net from "node:net";
import { createAuthClient, isAdminUser, loadAdminSettings, saveAdminSettings, type User } from "@isomorphiq/auth";
import { createContextClient } from "@isomorphiq/context";
import { ConfigManager, resolveEnvironmentFromHeaders } from "@isomorphiq/core";
import { createTaskClient } from "@isomorphiq/tasks";


const readNumber = (value: string | undefined, fallback: number): number => {
    if (!value) {
        return fallback;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const getGatewayPort = (): number => readNumber(process.env.GATEWAY_PORT, 3003);
const getDaemonPort = (): number => readNumber(process.env.DAEMON_HTTP_PORT, 3004);
const getDaemonHost = (): string => process.env.DAEMON_HTTP_HOST || "127.0.0.1";
const getTasksPort = (): number => readNumber(process.env.TASKS_HTTP_PORT ?? process.env.TASKS_PORT, 3006);
const getTasksHost = (): string => process.env.TASKS_HOST || "127.0.0.1";
const getSearchPort = (): number => readNumber(process.env.SEARCH_HTTP_PORT ?? process.env.SEARCH_PORT, 3007);
const getSearchHost = (): string => process.env.SEARCH_HOST || "127.0.0.1";
const getContextPort = (): number => readNumber(process.env.CONTEXT_HTTP_PORT ?? process.env.CONTEXT_PORT, 3008);
const getContextHost = (): string => process.env.CONTEXT_HOST || "127.0.0.1";
const getAuthPort = (): number => readNumber(process.env.AUTH_HTTP_PORT ?? process.env.AUTH_PORT, 3009);
const getAuthHost = (): string => process.env.AUTH_HOST || "127.0.0.1";
const getNotificationsPort = (): number =>
    readNumber(process.env.NOTIFICATIONS_HTTP_PORT ?? process.env.NOTIFICATIONS_PORT, 3011);
const getNotificationsHost = (): string => process.env.NOTIFICATIONS_HOST || "127.0.0.1";
const getUserProfilePort = (): number =>
    readNumber(process.env.USER_PROFILE_HTTP_PORT ?? process.env.USER_PROFILE_PORT, 3010);
const getUserProfileHost = (): string => process.env.USER_PROFILE_HOST || "127.0.0.1";
const getDashboardPort = (): number => readNumber(process.env.DASHBOARD_PORT, 3005);
const getDashboardHost = (): string => process.env.DASHBOARD_HOST || "127.0.0.1";

const authClient = createAuthClient();

type PermissionRequirement = {
    resource: string;
    action: string;
};

const readBearerToken = (req: http.IncomingMessage): string | null => {
    const raw = req.headers.authorization;
    if (!raw) {
        return null;
    }
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (!value) {
        return null;
    }
    const [scheme, token] = value.split(" ");
    if (scheme?.toLowerCase() !== "bearer" || !token) {
        return null;
    }
    return token;
};

const isPublicApiPath = (pathname: string): boolean => {
    const publicPaths = new Set([
        "/api/auth/login",
        "/api/auth/register",
        "/api/auth/refresh",
        "/api/auth/registration-status",
        "/api/health",
        "/api/queue",
    ]);
    return publicPaths.has(pathname)
        || pathname === "/api/dashboard"
        || pathname.startsWith("/api/dashboard/");
};

const isKnownServiceTrpcPath = (pathname: string): boolean =>
    pathname === "/trpc/profile-service"
    || pathname.startsWith("/trpc/profile-service/")
    || pathname === "/trpc/auth-service"
    || pathname.startsWith("/trpc/auth-service/")
    || pathname === "/trpc/search"
    || pathname.startsWith("/trpc/search/")
    || pathname === "/trpc/context-service"
    || pathname.startsWith("/trpc/context-service/")
    || pathname === "/trpc/notifications-service"
    || pathname.startsWith("/trpc/notifications-service/")
    || pathname === "/trpc/tasks-service"
    || pathname.startsWith("/trpc/tasks-service/");

const resolvePermissionRequirement = (
    pathname: string,
    method: string,
): PermissionRequirement | null => {
    if (pathname === "/api/contexts" || pathname.startsWith("/api/contexts/")) {
        return { resource: "tasks", action: "read" };
    }
    if (pathname === "/api/users/me") {
        if (method === "GET") return { resource: "profile", action: "read" };
        return { resource: "profile", action: "update" };
    }
    if (pathname === "/api/users/me/profile") {
        return { resource: "profile", action: "update" };
    }
    if (pathname.startsWith("/api/tasks")) {
        if (method === "GET") return { resource: "tasks", action: "read" };
        if (method === "POST") return { resource: "tasks", action: "create" };
        if (method === "PUT" || method === "PATCH") return { resource: "tasks", action: "update" };
        if (method === "DELETE") return { resource: "tasks", action: "delete" };
    }
    if (pathname.startsWith("/api/search") || pathname.startsWith("/api/saved-searches")) {
        if (method === "GET") return { resource: "tasks", action: "read" };
        return { resource: "tasks", action: "update" };
    }
    if (pathname.startsWith("/api/users") || pathname.startsWith("/api/admin")) {
        if (method === "GET") return { resource: "users", action: "read" };
        if (method === "POST") return { resource: "users", action: "create" };
        if (method === "PUT" || method === "PATCH") return { resource: "users", action: "update" };
        if (method === "DELETE") return { resource: "users", action: "delete" };
    }
    if (pathname.startsWith("/api/security")) {
        if (method === "GET") return { resource: "system", action: "view_logs" };
        return { resource: "system", action: "manage" };
    }
    return null;
};

const isPublicReadOnlyGuestRequest = (pathname: string, method: string): boolean =>
    method === "GET" && (
        pathname === "/api/tasks"
        || pathname.startsWith("/api/tasks/")
        || pathname === "/api/queue"
        || pathname.startsWith("/api/queue/")
        || pathname === "/api/contexts"
        || pathname.startsWith("/api/contexts/")
    );

const authorizeApiRequest = async (
    req: http.IncomingMessage,
    res: http.ServerResponse,
): Promise<{ allowed: boolean; user: User | null }> => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const method = (req.method ?? "GET").toUpperCase();
    if (
        !url.pathname.startsWith("/api/")
        || isPublicApiPath(url.pathname)
        || isPublicReadOnlyGuestRequest(url.pathname, method)
    ) {
        return { allowed: true, user: null };
    }

    const token = readBearerToken(req);
    if (!token) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Access token required" }));
        return { allowed: false, user: null };
    }

    const user = await authClient.validateSession(token);
    if (!user) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid or expired token" }));
        return { allowed: false, user: null };
    }

    const requirement = resolvePermissionRequirement(url.pathname, method);
    if (!requirement) {
        return { allowed: true, user };
    }

    const hasPermission = await authClient.hasPermission(
        user,
        requirement.resource,
        requirement.action,
    );
    if (!hasPermission) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Insufficient permissions" }));
        return { allowed: false, user: null };
    }

    return { allowed: true, user };
};

const resolveTarget = (req: http.IncomingMessage): { host: string; port: number; path: string } => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (url.pathname === "/ws/dashboard-ws") {
        return { host: getDashboardHost(), port: getDashboardPort(), path: `/dashboard-ws${url.search}` };
    }
    if (url.pathname.startsWith("/trpc/profile-service")) {
        const suffix = url.pathname.slice("/trpc/profile-service".length);
        const path = `/trpc${suffix}${url.search}`;
        return { host: getUserProfileHost(), port: getUserProfilePort(), path };
    }
    if (url.pathname.startsWith("/trpc/auth-service")) {
        const suffix = url.pathname.slice("/trpc/auth-service".length);
        const path = `/trpc${suffix}${url.search}`;
        return { host: getAuthHost(), port: getAuthPort(), path };
    }
    if (url.pathname.startsWith("/trpc/search")) {
        const suffix = url.pathname.slice("/trpc/search".length);
        const path = `/trpc${suffix}${url.search}`;
        return { host: getSearchHost(), port: getSearchPort(), path };
    }
    if (url.pathname.startsWith("/trpc/context-service")) {
        const suffix = url.pathname.slice("/trpc/context-service".length);
        const path = `/trpc${suffix}${url.search}`;
        return { host: getContextHost(), port: getContextPort(), path };
    }
    if (url.pathname.startsWith("/trpc/notifications-service")) {
        const suffix = url.pathname.slice("/trpc/notifications-service".length);
        const path = `/trpc${suffix}${url.search}`;
        return { host: getNotificationsHost(), port: getNotificationsPort(), path };
    }
    if (url.pathname.startsWith("/trpc/tasks-service")) {
        const suffix = url.pathname.slice("/trpc/tasks-service".length);
        const path = `/trpc${suffix}${url.search}`;
        return { host: getTasksHost(), port: getTasksPort(), path };
    }
    if (url.pathname.startsWith("/trpc")) {
        return { host: getDaemonHost(), port: getDaemonPort(), path: req.url ?? "/" };
    }
    return { host: getDaemonHost(), port: getDaemonPort(), path: req.url ?? "/" };
};

const isDaemonTarget = (target: { host: string; port: number }): boolean =>
    target.host === getDaemonHost() && target.port === getDaemonPort();

const formatUpgradeHeaders = (headers: http.IncomingHttpHeaders): string[] => {
    const lines: string[] = [];
    for (const [key, value] of Object.entries(headers)) {
        if (typeof value === "undefined") {
            continue;
        }
        if (Array.isArray(value)) {
            for (const entry of value) {
                lines.push(`${key}: ${entry}`);
            }
        } else {
            lines.push(`${key}: ${value}`);
        }
    }
    return lines;
};

const isContextDetailPath = (pathname: string): boolean =>
    /^\/api\/contexts\/[^/]+$/.test(pathname);

const getContextIdFromPath = (pathname: string): string | null => {
    const match = /^\/api\/contexts\/([^/]+)$/.exec(pathname);
    if (!match) {
        return null;
    }
    try {
        return decodeURIComponent(match[1]);
    } catch {
        return null;
    }
};

type SafeAuthUser = Omit<User, "passwordHash">;

const sanitizeUser = (user: User): SafeAuthUser => {
    const { passwordHash: _passwordHash, ...safeUser } = user;
    return safeUser;
};

const readTokenFromAuthorizationHeader = (req: http.IncomingMessage): string | null =>
    readBearerToken(req);

const validateSessionFromRequest = async (
    req: http.IncomingMessage,
): Promise<SafeAuthUser | null> => {
    const token = readTokenFromAuthorizationHeader(req);
    if (!token) {
        return null;
    }
    const user = await authClient.validateSession(token);
    return user ? sanitizeUser(user) : null;
};

const readRequestBody = async (req: http.IncomingMessage): Promise<string> =>
    await new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on("data", (chunk) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        req.on("end", () => {
            resolve(Buffer.concat(chunks).toString("utf8"));
        });
        req.on("error", reject);
    });

const parseJsonBody = (raw: string): { success: true; data: unknown } | { success: false; error: string } => {
    const trimmed = raw.trim();
    if (!trimmed) {
        return { success: true, data: {} };
    }
    try {
        return { success: true, data: JSON.parse(trimmed) as unknown };
    } catch {
        return { success: false, error: "Invalid JSON body" };
    }
};

const decodePathSegment = (value: string): string | null => {
    try {
        return decodeURIComponent(value);
    } catch {
        return null;
    }
};

const isProfilesApiPath = (pathname: string): boolean =>
    pathname === "/api/profiles" || pathname.startsWith("/api/profiles/");

const handleProfilesApiRequest = async (
    req: http.IncomingMessage,
    res: http.ServerResponse,
): Promise<boolean> => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const pathname = url.pathname;
    if (!isProfilesApiPath(pathname)) {
        return false;
    }

    await new Promise<void>((resolve) => {
        let settled = false;
        const resolveOnce = () => {
            if (settled) {
                return;
            }
            settled = true;
            resolve();
        };

        const proxy = http.request(
            {
                host: getUserProfileHost(),
                port: getUserProfilePort(),
                method: req.method,
                path: req.url ?? "/",
                headers: req.headers,
            },
            (proxyRes) => {
                res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
                proxyRes.pipe(res);
                proxyRes.on("end", resolveOnce);
                proxyRes.on("error", resolveOnce);
                res.on("close", resolveOnce);
            },
        );

        proxy.on("error", (error) => {
            console.error("[GATEWAY] Profiles API request failed:", error);
            if (!res.headersSent) {
                res.writeHead(502, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Profiles service unavailable" }));
            } else {
                res.end();
            }
            resolveOnce();
        });

        req.on("aborted", () => {
            proxy.destroy();
            resolveOnce();
        });

        req.pipe(proxy);
    });
    return true;
};

const getTaskActorFromRequest = (req: http.IncomingMessage): string | undefined => {
    const userIdHeader = req.headers["x-authenticated-user-id"];
    if (Array.isArray(userIdHeader)) {
        return userIdHeader[0];
    }
    return typeof userIdHeader === "string" && userIdHeader.length > 0
        ? userIdHeader
        : undefined;
};

const toValidDate = (value: unknown): Date | null => {
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }
    if (typeof value === "string" || typeof value === "number") {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
};

const toDateKey = (value: unknown): string | null => {
    const date = toValidDate(value);
    if (!date) {
        return null;
    }
    return date.toISOString().slice(0, 10);
};

const countByDateKey = (
    tasks: Array<{ createdAt?: unknown; updatedAt?: unknown; status?: string }>,
    selector: "createdAt" | "updatedAt",
    requireDone: boolean,
): Record<string, number> =>
    tasks.reduce<Record<string, number>>((acc, task) => {
        if (requireDone && task.status !== "done") {
            return acc;
        }
        const key = toDateKey(task[selector]);
        if (!key) {
            return acc;
        }
        return {
            ...acc,
            [key]: (acc[key] ?? 0) + 1,
        };
    }, {});

const formatDurationFromMs = (value: number): string => {
    if (!Number.isFinite(value) || value <= 0) {
        return "N/A";
    }
    const totalHours = Math.round(value / (1000 * 60 * 60));
    if (totalHours < 24) {
        return `${totalHours}h`;
    }
    const days = Math.floor(totalHours / 24);
    const hours = totalHours % 24;
    return `${days}d ${hours}h`;
};

const buildAnalyticsPayload = (
    tasks: Array<{
        id: string;
        title: string;
        description: string;
        status: string;
        priority: string;
        createdAt: unknown;
        updatedAt: unknown;
    }>,
): Record<string, unknown> => {
    const totalTasks = tasks.length;
    const completedTasks = tasks.filter((task) => task.status === "done").length;
    const inProgressTasks = tasks.filter((task) => task.status === "in-progress").length;
    const todoTasks = tasks.filter((task) => task.status === "todo").length;
    const completionRate = totalTasks > 0
        ? Math.round((completedTasks / totalTasks) * 100)
        : 0;

    const todayKey = new Date().toISOString().slice(0, 10);
    const createdByDay = countByDateKey(tasks, "createdAt", false);
    const completedByDay = countByDateKey(tasks, "updatedAt", true);

    const days = 30;
    const startDate = new Date();
    startDate.setUTCHours(0, 0, 0, 0);
    startDate.setUTCDate(startDate.getUTCDate() - (days - 1));
    const timeline = Array.from({ length: days }, (_, index) => {
        const date = new Date(startDate);
        date.setUTCDate(startDate.getUTCDate() + index);
        const key = date.toISOString().slice(0, 10);
        return {
            date: key,
            created: createdByDay[key] ?? 0,
            completed: completedByDay[key] ?? 0,
        };
    });

    const completedDurationsMs = tasks
        .filter((task) => task.status === "done")
        .map((task) => {
            const createdAt = toValidDate(task.createdAt);
            const updatedAt = toValidDate(task.updatedAt);
            if (!createdAt || !updatedAt) {
                return null;
            }
            const diff = updatedAt.getTime() - createdAt.getTime();
            return diff > 0 ? diff : null;
        })
        .filter((value): value is number => value !== null);
    const avgCompletionMs = completedDurationsMs.length > 0
        ? completedDurationsMs.reduce((sum, value) => sum + value, 0) / completedDurationsMs.length
        : 0;

    const productivityScore = Math.max(
        0,
        Math.min(
            100,
            Math.round(
                completionRate * 0.75
                + (inProgressTasks > 0 ? 10 : 0)
                + Math.min(15, Math.round(completedTasks / 2)),
            ),
        ),
    );

    const recentActivity = [...tasks]
        .sort((left, right) => {
            const leftTime = toValidDate(left.updatedAt)?.getTime() ?? 0;
            const rightTime = toValidDate(right.updatedAt)?.getTime() ?? 0;
            return rightTime - leftTime;
        })
        .slice(0, 10)
        .map((task) => ({
            id: task.id,
            title: task.title,
            status: task.status,
            priority: task.priority,
            updatedAt: toValidDate(task.updatedAt)?.toISOString() ?? String(task.updatedAt ?? ""),
            createdAt: toValidDate(task.createdAt)?.toISOString() ?? String(task.createdAt ?? ""),
        }));

    return {
        analytics: {
            overview: {
                totalTasks,
                completedTasks,
                inProgressTasks,
                todoTasks,
                completionRate,
            },
            today: {
                created: createdByDay[todayKey] ?? 0,
                completed: completedByDay[todayKey] ?? 0,
            },
            priority: {
                high: tasks.filter((task) => task.priority === "high").length,
                medium: tasks.filter((task) => task.priority === "medium").length,
                low: tasks.filter((task) => task.priority === "low").length,
            },
            timeline,
            recentActivity,
            performance: {
                avgCompletionTime: formatDurationFromMs(avgCompletionMs),
                productivityScore: String(productivityScore),
                totalActiveTasks: todoTasks + inProgressTasks,
            },
            generatedAt: new Date().toISOString(),
        },
    };
};

const handleAnalyticsApiRequest = async (
    req: http.IncomingMessage,
    res: http.ServerResponse,
): Promise<boolean> => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const pathname = url.pathname;
    const method = (req.method ?? "GET").toUpperCase();
    if (pathname !== "/api/analytics" || method !== "GET") {
        return false;
    }

    const environment = resolveEnvironmentFromHeaders(
        req.headers,
        ConfigManager.getInstance().getEnvironmentConfig(),
    );
    const taskClient = createTaskClient({
        environment,
        enableSubscriptions: false,
        url: `http://${getTasksHost()}:${getTasksPort()}/trpc`,
    });

    try {
        const tasks = await taskClient.listTasks();
        const payload = buildAnalyticsPayload(tasks as Array<{
            id: string;
            title: string;
            description: string;
            status: string;
            priority: string;
            createdAt: unknown;
            updatedAt: unknown;
        }>);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
        return true;
    } catch (error) {
        console.error("[GATEWAY] Analytics API request failed:", error);
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Analytics service unavailable" }));
        return true;
    } finally {
        await taskClient.close().catch(() => undefined);
    }
};

const handleAuthApiRequest = async (
    req: http.IncomingMessage,
    res: http.ServerResponse,
): Promise<boolean> => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const pathname = url.pathname;
    const method = (req.method ?? "GET").toUpperCase();
    const isAuthPath = pathname.startsWith("/api/auth/")
        || pathname === "/api/users/me"
        || pathname === "/api/users/me/profile";
    if (!isAuthPath) {
        return false;
    }

    const disabledRegistration = process.env.DISABLE_REGISTRATION === "true";

    try {
        if (pathname === "/api/auth/registration-status" && method === "GET") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
                JSON.stringify({
                    disabled: disabledRegistration,
                    message: disabledRegistration
                        ? "Registration is currently disabled."
                        : "Registration is open.",
                }),
            );
            return true;
        }

        if (pathname === "/api/auth/login" && method === "POST") {
            const parsed = parseJsonBody(await readRequestBody(req));
            if (parsed.success === false) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: parsed.error }));
                return true;
            }
            const body = parsed.data as Record<string, unknown>;
            const username = typeof body.username === "string" ? body.username : "";
            const password = typeof body.password === "string" ? body.password : "";
            if (!username || !password) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Username and password are required" }));
                return true;
            }
            const result = await authClient.authenticateUser({ username, password });
            if (!result.success || !result.token || !result.user) {
                res.writeHead(401, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: result.error ?? "Login failed" }));
                return true;
            }
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
                JSON.stringify({
                    user: result.user,
                    token: result.token,
                    message: "Login successful",
                }),
            );
            return true;
        }

        if (pathname === "/api/auth/register" && method === "POST") {
            if (disabledRegistration) {
                res.writeHead(403, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Registration is currently disabled by the administrator." }));
                return true;
            }
            const parsed = parseJsonBody(await readRequestBody(req));
            if (parsed.success === false) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: parsed.error }));
                return true;
            }
            const body = parsed.data as Record<string, unknown>;
            const username = typeof body.username === "string" ? body.username : "";
            const email = typeof body.email === "string" ? body.email : "";
            const password = typeof body.password === "string" ? body.password : "";
            const role = typeof body.role === "string" ? body.role : "developer";
            if (!username || !email || !password) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Username, email, and password are required" }));
                return true;
            }
            const createdUser = await authClient.createUser({ username, email, password, role: role as any });
            const auth = await authClient.authenticateUser({ username, password });
            if (!auth.success || !auth.token) {
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Authentication failed after registration" }));
                return true;
            }
            res.writeHead(201, { "Content-Type": "application/json" });
            res.end(
                JSON.stringify({
                    user: sanitizeUser(createdUser as User),
                    token: auth.token,
                    message: "Registration successful",
                }),
            );
            return true;
        }

        if (pathname === "/api/auth/logout" && method === "POST") {
            const token = readTokenFromAuthorizationHeader(req);
            if (!token) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Token required" }));
                return true;
            }
            const success = await authClient.logoutUser(token);
            if (!success) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Invalid token" }));
                return true;
            }
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ message: "Logout successful" }));
            return true;
        }

        if ((pathname === "/api/auth/me" || pathname === "/api/users/me") && method === "GET") {
            const user = await validateSessionFromRequest(req);
            if (!user) {
                res.writeHead(401, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Invalid or expired token" }));
                return true;
            }
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ user }));
            return true;
        }

        if (pathname === "/api/auth/refresh" && method === "POST") {
            const parsed = parseJsonBody(await readRequestBody(req));
            if (parsed.success === false) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: parsed.error }));
                return true;
            }
            const body = parsed.data as Record<string, unknown>;
            const refreshToken = typeof body.refreshToken === "string" ? body.refreshToken : "";
            if (!refreshToken) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Refresh token is required" }));
                return true;
            }
            const result = await authClient.refreshToken(refreshToken);
            if (!result.success) {
                res.writeHead(401, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: result.error ?? "Token refresh failed" }));
                return true;
            }
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(result));
            return true;
        }

        if (pathname === "/api/auth/password" && method === "PUT") {
            const user = await validateSessionFromRequest(req);
            if (!user) {
                res.writeHead(401, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Invalid or expired token" }));
                return true;
            }
            const parsed = parseJsonBody(await readRequestBody(req));
            if (parsed.success === false) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: parsed.error }));
                return true;
            }
            const body = parsed.data as Record<string, unknown>;
            const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
            const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
            if (!currentPassword || !newPassword) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Current password and new password are required" }));
                return true;
            }
            await authClient.changePassword({
                userId: user.id,
                currentPassword,
                newPassword,
            });
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ message: "Password changed successfully" }));
            return true;
        }

        if (pathname === "/api/auth/sessions" && method === "GET") {
            const user = await validateSessionFromRequest(req);
            if (!user) {
                res.writeHead(401, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Invalid or expired token" }));
                return true;
            }
            const sessions = await authClient.getUserSessions(user.id);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ sessions }));
            return true;
        }

        if (pathname === "/api/auth/sessions" && method === "DELETE") {
            const user = await validateSessionFromRequest(req);
            if (!user) {
                res.writeHead(401, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Invalid or expired token" }));
                return true;
            }
            await authClient.invalidateAllUserSessions(user.id);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ message: "All sessions invalidated successfully" }));
            return true;
        }

        if (pathname === "/api/auth/permissions" && method === "GET") {
            const user = await validateSessionFromRequest(req);
            if (!user) {
                res.writeHead(401, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Invalid or expired token" }));
                return true;
            }
            const fullUser = await authClient.getUserById(user.id);
            if (!fullUser) {
                res.writeHead(404, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "User not found" }));
                return true;
            }
            const userPermissions = await authClient.getUserPermissions(fullUser);
            const permissionMatrix = await authClient.getPermissionMatrix();
            const availableResources = await authClient.getAvailableResources();
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
                JSON.stringify({
                    userPermissions,
                    permissionMatrix,
                    availableResources,
                }),
            );
            return true;
        }

        return false;
    } catch (error) {
        console.error("[GATEWAY] Auth API request failed:", error);
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Authentication service unavailable" }));
        return true;
    }
};

const handleTasksApiRequest = async (
    req: http.IncomingMessage,
    res: http.ServerResponse,
): Promise<boolean> => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const pathname = url.pathname;
    const method = (req.method ?? "GET").toUpperCase();
    const isTasksPath =
        pathname === "/api/tasks"
        || pathname.startsWith("/api/tasks/")
        || pathname === "/api/queue"
        || pathname.startsWith("/api/queue/");
    if (!isTasksPath) {
        return false;
    }

    const environment = resolveEnvironmentFromHeaders(
        req.headers,
        ConfigManager.getInstance().getEnvironmentConfig(),
    );
    const taskClient = createTaskClient({
        environment,
        enableSubscriptions: false,
        url: `http://${getTasksHost()}:${getTasksPort()}/trpc`,
    });

    try {
        if (pathname === "/api/tasks" && method === "GET") {
            const searchQuery = url.searchParams.get("q")?.trim().toLowerCase();
            const statusFilter = url.searchParams.get("status");
            const priorityFilter = url.searchParams.get("priority");
            const tasks = await taskClient.listTasks();
            const filtered = tasks.filter((task) => {
                if (statusFilter && statusFilter !== "all" && task.status !== statusFilter) {
                    return false;
                }
                if (priorityFilter && priorityFilter !== "all" && task.priority !== priorityFilter) {
                    return false;
                }
                if (!searchQuery) {
                    return true;
                }
                const haystack = `${task.title ?? ""} ${task.description ?? ""} ${task.id ?? ""}`.toLowerCase();
                return haystack.includes(searchQuery);
            });
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(filtered));
            return true;
        }

        if (pathname === "/api/queue" && method === "GET") {
            const queue = await taskClient.getTasksSortedByDependencies();
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ queue }));
            return true;
        }

        if (pathname === "/api/tasks" && method === "POST") {
            const rawBody = await readRequestBody(req);
            const parsed = parseJsonBody(rawBody);
            if (parsed.success === false) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: parsed.error }));
                return true;
            }
            const bodyRecord = parsed.data as Record<string, unknown>;
            const actor = getTaskActorFromRequest(req) ?? "system";
            const createdBy = typeof bodyRecord.createdBy === "string" ? bodyRecord.createdBy : actor;
            const created = await taskClient.createTask(bodyRecord as any, createdBy);
            res.writeHead(201, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: true, data: created }));
            return true;
        }

        const statusMatch = /^\/api\/tasks\/([^/]+)\/status$/.exec(pathname);
        if (statusMatch && method === "PUT") {
            const taskId = decodePathSegment(statusMatch[1]);
            if (!taskId) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Invalid task id" }));
                return true;
            }
            const rawBody = await readRequestBody(req);
            const parsed = parseJsonBody(rawBody);
            if (parsed.success === false) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: parsed.error }));
                return true;
            }
            const bodyRecord = parsed.data as Record<string, unknown>;
            const status = bodyRecord.status;
            if (typeof status !== "string") {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "status is required" }));
                return true;
            }
            const actor = getTaskActorFromRequest(req);
            const updated = await taskClient.updateTaskStatus(taskId, status as any, actor);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: true, data: updated }));
            return true;
        }

        const priorityMatch = /^\/api\/tasks\/([^/]+)\/priority$/.exec(pathname);
        if (priorityMatch && method === "PUT") {
            const taskId = decodePathSegment(priorityMatch[1]);
            if (!taskId) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Invalid task id" }));
                return true;
            }
            const rawBody = await readRequestBody(req);
            const parsed = parseJsonBody(rawBody);
            if (parsed.success === false) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: parsed.error }));
                return true;
            }
            const bodyRecord = parsed.data as Record<string, unknown>;
            const priority = bodyRecord.priority;
            if (typeof priority !== "string") {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "priority is required" }));
                return true;
            }
            const actor = getTaskActorFromRequest(req);
            const updated = await taskClient.updateTaskPriority(taskId, priority as any, actor);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: true, data: updated }));
            return true;
        }

        const assignMatch = /^\/api\/tasks\/([^/]+)\/assign$/.exec(pathname);
        if (assignMatch && (method === "PUT" || method === "PATCH")) {
            const taskId = decodePathSegment(assignMatch[1]);
            if (!taskId) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Invalid task id" }));
                return true;
            }
            const rawBody = await readRequestBody(req);
            const parsed = parseJsonBody(rawBody);
            if (parsed.success === false) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: parsed.error }));
                return true;
            }
            const bodyRecord = parsed.data as Record<string, unknown>;
            const assignedTo = bodyRecord.assignedTo;
            if (typeof assignedTo !== "string" || assignedTo.length === 0) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "assignedTo is required" }));
                return true;
            }
            const actor = getTaskActorFromRequest(req);
            const updated = await taskClient.assignTask(taskId, assignedTo, actor);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: true, data: updated }));
            return true;
        }

        const taskIdMatch = /^\/api\/tasks\/([^/]+)$/.exec(pathname);
        if (taskIdMatch && method === "GET") {
            const taskId = decodePathSegment(taskIdMatch[1]);
            if (!taskId) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Invalid task id" }));
                return true;
            }
            const task = await taskClient.getTask(taskId);
            if (!task) {
                res.writeHead(404, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Task not found" }));
                return true;
            }
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(task));
            return true;
        }

        if (taskIdMatch && method === "PUT") {
            const taskId = decodePathSegment(taskIdMatch[1]);
            if (!taskId) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Invalid task id" }));
                return true;
            }
            const rawBody = await readRequestBody(req);
            const parsed = parseJsonBody(rawBody);
            if (parsed.success === false) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: parsed.error }));
                return true;
            }
            const actor = getTaskActorFromRequest(req);
            const updated = await taskClient.updateTask(taskId, parsed.data as any, actor);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: true, data: updated }));
            return true;
        }

        if (taskIdMatch && method === "DELETE") {
            const taskId = decodePathSegment(taskIdMatch[1]);
            if (!taskId) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Invalid task id" }));
                return true;
            }
            const actor = getTaskActorFromRequest(req);
            await taskClient.deleteTask(taskId, actor);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: true }));
            return true;
        }

        res.writeHead(405, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Method not allowed" }));
        return true;
    } catch (error) {
        console.error("[GATEWAY] Tasks API request failed:", error);
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Tasks service unavailable" }));
        return true;
    } finally {
        await taskClient.close().catch(() => undefined);
    }
};

const handleAdminApiRequest = async (
    req: http.IncomingMessage,
    res: http.ServerResponse,
): Promise<boolean> => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const pathname = url.pathname;
    const method = (req.method ?? "GET").toUpperCase();

    if (pathname !== "/api/admin/settings") {
        return false;
    }

    try {
        const user = await validateSessionFromRequest(req);
        if (!user) {
            res.writeHead(401, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Invalid or expired token" }));
            return true;
        }
        if (!isAdminUser(user.username)) {
            res.writeHead(403, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Admin access required" }));
            return true;
        }

        if (method === "GET") {
            const settings = await loadAdminSettings();
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ settings }));
            return true;
        }

        if (method === "PUT") {
            const parsed = parseJsonBody(await readRequestBody(req));
            if (parsed.success === false) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: parsed.error }));
                return true;
            }
            const incoming = parsed.data as Record<string, unknown>;
            const updates: { registrationEnabled?: boolean; allowNonAdminWrites?: boolean } = {};
            if (typeof incoming.registrationEnabled === "boolean") {
                updates.registrationEnabled = incoming.registrationEnabled;
            }
            if (typeof incoming.allowNonAdminWrites === "boolean") {
                updates.allowNonAdminWrites = incoming.allowNonAdminWrites;
            }
            const settings = await saveAdminSettings(updates);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ settings }));
            return true;
        }

        res.writeHead(405, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Method not allowed" }));
        return true;
    } catch (error) {
        console.error("[GATEWAY] Admin API request failed:", error);
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Admin settings service unavailable" }));
        return true;
    }
};

const handleContextApiRequest = async (
    req: http.IncomingMessage,
    res: http.ServerResponse,
): Promise<boolean> => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const pathname = url.pathname;
    const method = (req.method ?? "GET").toUpperCase();
    const isContextPath = pathname === "/api/contexts" || isContextDetailPath(pathname);

    if (!isContextPath) {
        return false;
    }

    if (method !== "GET") {
        res.writeHead(405, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Method not allowed" }));
        return true;
    }

    const environment = resolveEnvironmentFromHeaders(
        req.headers,
        ConfigManager.getInstance().getEnvironmentConfig(),
    );
    const contextClient = createContextClient({
        environment,
        url: `http://${getContextHost()}:${getContextPort()}/trpc`,
    });

    try {
        if (pathname === "/api/contexts") {
            const contexts = await contextClient.listContexts();
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
                JSON.stringify({
                    contexts,
                }),
            );
            return true;
        }

        const contextId = getContextIdFromPath(pathname);
        if (!contextId) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Invalid context id" }));
            return true;
        }

        const context = await contextClient.getContext(contextId);
        if (!context) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Context not found" }));
            return true;
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
            JSON.stringify({
                context,
            }),
        );
        return true;
    } catch (error) {
        console.error("[GATEWAY] Context API request failed:", error);
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Context service unavailable" }));
        return true;
    }
};

const handleGatewayApiRequest = async (
    req: http.IncomingMessage,
    res: http.ServerResponse,
): Promise<boolean> => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const pathname = url.pathname;
    const method = (req.method ?? "GET").toUpperCase();

    if (pathname === "/api/health" && method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
            JSON.stringify({
                status: "ok",
                service: "gateway",
                timestamp: new Date().toISOString(),
            }),
        );
        return true;
    }

    if (pathname === "/api/environments" && method === "GET") {
        const config = ConfigManager.getInstance().getEnvironmentConfig();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
            JSON.stringify({
                available: config.available,
                default: config.default,
                headerName: config.headerName,
            }),
        );
        return true;
    }

    return false;
};

const isDashboardGatewayPath = (pathname: string): boolean =>
    pathname === "/api/dashboard" || pathname.startsWith("/api/dashboard/");

const toDashboardProxyPath = (url: URL): string => {
    if (url.pathname === "/api/dashboard") {
        return `/${url.search}`;
    }
    const suffix = url.pathname.slice("/api/dashboard".length);
    const normalized = suffix.startsWith("/") ? suffix : `/${suffix}`;
    return `${normalized}${url.search}`;
};

const handleDashboardProxyApiRequest = async (
    req: http.IncomingMessage,
    res: http.ServerResponse,
): Promise<boolean> => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (!isDashboardGatewayPath(url.pathname)) {
        return false;
    }

    await new Promise<void>((resolve) => {
        let settled = false;
        const resolveOnce = () => {
            if (settled) {
                return;
            }
            settled = true;
            resolve();
        };

        const proxy = http.request(
            {
                host: getDashboardHost(),
                port: getDashboardPort(),
                method: req.method,
                path: toDashboardProxyPath(url),
                headers: req.headers,
            },
            (proxyRes) => {
                res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
                proxyRes.pipe(res);
                proxyRes.on("end", resolveOnce);
                proxyRes.on("error", resolveOnce);
                res.on("close", resolveOnce);
            },
        );

        proxy.on("error", (error) => {
            console.error("[GATEWAY] Dashboard proxy request failed:", error);
            if (!res.headersSent) {
                res.writeHead(502, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Dashboard service unavailable" }));
            } else {
                res.end();
            }
            resolveOnce();
        });

        req.on("aborted", () => {
            proxy.destroy();
            resolveOnce();
        });

        req.pipe(proxy);
    });

    return true;
};

const isDashboardLogsPath = (pathname: string): boolean => pathname === "/api/logs";

const handleDashboardLogsRequest = async (
    req: http.IncomingMessage,
    res: http.ServerResponse,
): Promise<boolean> => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (!isDashboardLogsPath(url.pathname)) {
        return false;
    }

    await new Promise<void>((resolve) => {
        let settled = false;
        const resolveOnce = () => {
            if (settled) {
                return;
            }
            settled = true;
            resolve();
        };

        const proxy = http.request(
            {
                host: getDashboardHost(),
                port: getDashboardPort(),
                method: req.method,
                path: `${url.pathname}${url.search}`,
                headers: req.headers,
            },
            (proxyRes) => {
                res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
                proxyRes.pipe(res);
                proxyRes.on("end", resolveOnce);
                proxyRes.on("error", resolveOnce);
                res.on("close", resolveOnce);
            },
        );

        proxy.on("error", (error) => {
            console.error("[GATEWAY] Dashboard logs request failed:", error);
            if (!res.headersSent) {
                res.writeHead(502, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Activity log service unavailable" }));
            } else {
                res.end();
            }
            resolveOnce();
        });

        req.on("aborted", () => {
            proxy.destroy();
            resolveOnce();
        });

        req.pipe(proxy);
    });

    return true;
};

const proxyHttpRequest = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    try {
        const authorization = await authorizeApiRequest(req, res);
        if (!authorization.allowed) {
            return;
        }
        if (authorization.user) {
            req.headers["x-authenticated-user-id"] = authorization.user.id;
            req.headers["x-authenticated-user-role"] = authorization.user.role;
        }
    } catch (error) {
        console.error("[GATEWAY] Authentication/authorization check failed:", error);
        if (!res.headersSent) {
            res.writeHead(502, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Authentication service unavailable" }));
        }
        return;
    }

    const authApiHandled = await handleAuthApiRequest(req, res);
    if (authApiHandled) {
        return;
    }

    const adminApiHandled = await handleAdminApiRequest(req, res);
    if (adminApiHandled) {
        return;
    }

    const analyticsApiHandled = await handleAnalyticsApiRequest(req, res);
    if (analyticsApiHandled) {
        return;
    }

    const tasksApiHandled = await handleTasksApiRequest(req, res);
    if (tasksApiHandled) {
        return;
    }

    const contextApiHandled = await handleContextApiRequest(req, res);
    if (contextApiHandled) {
        return;
    }

    const profilesApiHandled = await handleProfilesApiRequest(req, res);
    if (profilesApiHandled) {
        return;
    }

    const gatewayApiHandled = await handleGatewayApiRequest(req, res);
    if (gatewayApiHandled) {
        return;
    }

    const dashboardProxyHandled = await handleDashboardProxyApiRequest(req, res);
    if (dashboardProxyHandled) {
        return;
    }

    const dashboardLogsHandled = await handleDashboardLogsRequest(req, res);
    if (dashboardLogsHandled) {
        return;
    }

    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const pathname = url.pathname;
    const method = (req.method ?? "GET").toUpperCase();

    if (pathname === "/trpc" && method !== "OPTIONS") {
        res.writeHead(426, { "Content-Type": "application/json" });
        res.end(
            JSON.stringify({
                error: "Bare /trpc is unavailable in microservice mode. Use /trpc/<service>.",
            }),
        );
        return;
    }

    if (pathname.startsWith("/trpc") && !isKnownServiceTrpcPath(pathname)) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(
            JSON.stringify({
                error: `Unknown TRPC service route: ${pathname}`,
            }),
        );
        return;
    }

    if (pathname.startsWith("/api/")) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(
            JSON.stringify({
                error: `Endpoint not available via gateway: ${pathname}`,
            }),
        );
        return;
    }

    const target = resolveTarget(req);
    const targetPath = target.path;

    const proxy = http.request(
        {
            host: target.host,
            port: target.port,
            method: req.method,
            path: targetPath,
            headers: req.headers,
        },
        (proxyRes) => {
            res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
            proxyRes.pipe(res);
        },
    );

    proxy.on("error", (error) => {
        console.error(
            `[GATEWAY] Proxy request failed (${req.method ?? "GET"} ${req.url ?? "/"}) -> ${target.host}:${target.port}${targetPath}:`,
            error,
        );
        if (!res.headersSent) {
            res.writeHead(502);
        }
        res.end("Bad gateway");
    });

    req.pipe(proxy);
};

const proxyUpgradeRequest = (
    req: http.IncomingMessage,
    clientSocket: net.Socket,
    head: Buffer,
): void => {
    const target = resolveTarget(req);
    const requestPath = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`).pathname;

    // In microservice mode, bare /trpc websocket upgrades have no backend.
    if (requestPath === "/trpc" && isDaemonTarget(target)) {
        clientSocket.write(
            "HTTP/1.1 426 Upgrade Required\r\n"
            + "Connection: close\r\n"
            + "Content-Type: text/plain\r\n"
            + "\r\n"
            + "WebSocket subscriptions are not enabled on /trpc.\r\n",
        );
        clientSocket.destroy();
        return;
    }

    const targetSocket = net.connect(target.port, target.host, () => {
        const requestLine = `${req.method || "GET"} ${target.path} HTTP/1.1`;
        const headerLines = formatUpgradeHeaders(req.headers);
        const headersBlock = [requestLine, ...headerLines, "", ""].join("\r\n");
        targetSocket.write(headersBlock);
        if (head.length > 0) {
            targetSocket.write(head);
        }
        clientSocket.pipe(targetSocket).pipe(clientSocket);
    });

    targetSocket.on("error", (error) => {
        console.error("[GATEWAY] Proxy upgrade failed:", error);
        clientSocket.destroy();
    });

    clientSocket.on("error", () => {
        targetSocket.destroy();
    });
};

const handleGatewaySummary = async (
    req: http.IncomingMessage,
    res: http.ServerResponse,
): Promise<void> => {
    try {
        const authorization = await authorizeApiRequest(req, res);
        if (!authorization.allowed || !authorization.user) {
            return;
        }
        const canReadTasks = await authClient.hasPermission(authorization.user, "tasks", "read");
        if (!canReadTasks) {
            res.writeHead(403, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Insufficient permissions" }));
            return;
        }
    } catch (error) {
        console.error("[GATEWAY] Gateway summary authorization check failed:", error);
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Authentication service unavailable" }));
        return;
    }

    const environment = resolveEnvironmentFromHeaders(
        req.headers,
        ConfigManager.getInstance().getEnvironmentConfig(),
    );
    const client = createTaskClient({
        environment,
        enableSubscriptions: false,
    });

    try {
        const tasks = await client.listTasks();
        const daemonHealthResponse = await fetch(
            `http://${getDaemonHost()}:${getDaemonPort()}/api/health`,
        ).catch(() => null);
        const daemonHealth = daemonHealthResponse
            ? await daemonHealthResponse.json().catch(() => null)
            : null;

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
            JSON.stringify({
                gateway: "ok",
                environment,
                tasks: {
                    total: tasks.length,
                },
                daemon: daemonHealth,
                timestamp: new Date().toISOString(),
            }),
        );
    } catch (error) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
            JSON.stringify({
                error: error instanceof Error ? error.message : "Unknown error",
            }),
        );
    } finally {
        await client.close();
    }
};

export async function startGateway(port: number = getGatewayPort()): Promise<void> {
    const server = http.createServer((req, res) => {
        const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
        if (url.pathname === "/health") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
                JSON.stringify({
                    status: "ok",
                    service: "gateway",
                }),
            );
            return;
        }
        if (url.pathname === "/api/gateway/summary") {
            void handleGatewaySummary(req, res);
            return;
        }
        void proxyHttpRequest(req, res);
    });
    server.on("upgrade", proxyUpgradeRequest);

    return await new Promise((resolve, reject) => {
        server.listen(port, () => {
            console.log(
                `[GATEWAY] Gateway listening on ${port} (tasks: ${getTasksHost()}:${getTasksPort()}, search: ${getSearchHost()}:${getSearchPort()}, context: ${getContextHost()}:${getContextPort()}, auth: ${getAuthHost()}:${getAuthPort()}, user-profile: ${getUserProfileHost()}:${getUserProfilePort()}, daemon: ${getDaemonHost()}:${getDaemonPort()})`,
            );
            resolve();
        });
        server.on("error", (error) => {
            console.error("[GATEWAY] Failed to start gateway:", error);
            reject(error);
        });
    });
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
    startGateway().catch((err) => {
        console.error("[GATEWAY] Failed to start:", err);
        process.exit(1);
    });
}
