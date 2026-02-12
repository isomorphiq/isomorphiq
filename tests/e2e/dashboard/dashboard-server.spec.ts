import { test, expect } from "@playwright/test";
import { DashboardServer } from "@isomorphiq/dashboard";

const describe = test.describe;
const it = test;
const beforeEach = test.beforeEach;

type TaskRecord = {
    id: string;
    title: string;
    description: string;
    status: "todo" | "in-progress" | "done";
    priority: "high" | "medium" | "low";
    createdAt: string;
    updatedAt: string;
};

const createMockResponse = () => {
    let statusCode = 0;
    let headers: Record<string, string> = {};
    let body = "";

    return {
        writeHead: (code: number, nextHeaders?: Record<string, string>) => {
            statusCode = code;
            headers = nextHeaders ?? {};
        },
        end: (chunk?: unknown) => {
            if (chunk !== undefined) {
                body += String(chunk);
            }
        },
        get statusCode() {
            return statusCode;
        },
        get headers() {
            return headers;
        },
        get body() {
            return body;
        },
    };
};

const createDashboardServer = (tasks: TaskRecord[]): DashboardServer => {
    const taskManager = {
        getAllTasks: async () => ({ success: true, data: tasks }),
    };
    const webSocketManager = {
        getConnectionCount: () => 0,
    } as any;
    const analyticsService = {
        handleAnalyticsRequest: async (_req: unknown, res: any) => {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
        },
    };

    const services = new Map([
        [
            "default",
            {
                environment: "default",
                taskManager,
                webSocketManager,
                analyticsService,
            },
        ],
    ]);

    return new DashboardServer(services as any, () => "default", "default");
};

describe("DashboardServer", () => {
    let dashboardServer: DashboardServer;
    let tasks: TaskRecord[];

    beforeEach(() => {
        const now = new Date().toISOString();
        tasks = [
            {
                id: "task-1",
                title: "Important task",
                description: "Alpha",
                status: "todo",
                priority: "high",
                createdAt: now,
                updatedAt: now,
            },
            {
                id: "task-2",
                title: "Follow-up",
                description: "Beta",
                status: "in-progress",
                priority: "medium",
                createdAt: now,
                updatedAt: now,
            },
        ];
        dashboardServer = createDashboardServer(tasks);
    });

    it("serves dashboard HTML at root", async () => {
        const res = createMockResponse();
        await dashboardServer.handleRequest(
            { url: "/", method: "GET", headers: { host: "localhost:3005" } } as any,
            res as any,
        );

        expect(res.statusCode).toBe(200);
        expect(res.headers["Content-Type"]).toBe("text/html");
        expect(res.body).toContain("Task Manager Dashboard");
    });

    it("returns metrics payload", async () => {
        const res = createMockResponse();
        await dashboardServer.handleRequest(
            { url: "/api/metrics", method: "GET", headers: { host: "localhost:3005" } } as any,
            res as any,
        );

        expect(res.statusCode).toBe(200);
        const payload = JSON.parse(res.body);
        expect(payload.tasks.total).toBe(2);
        expect(payload.tasks.pending).toBe(1);
        expect(payload.tasks.inProgress).toBe(1);
        expect(payload.daemon).toBeTruthy();
        expect(payload.health).toBeTruthy();
    });

    it("filters tasks via query params", async () => {
        const res = createMockResponse();
        await dashboardServer.handleRequest(
            {
                url: "/api/tasks?status=todo&priority=high&q=important",
                method: "GET",
                headers: { host: "localhost:3005" },
            } as any,
            res as any,
        );

        expect(res.statusCode).toBe(200);
        const payload = JSON.parse(res.body);
        expect(Array.isArray(payload)).toBe(true);
        expect(payload.length).toBe(1);
        expect(payload[0].id).toBe("task-1");
    });

    it("returns 404 for unknown routes", async () => {
        const res = createMockResponse();
        await dashboardServer.handleRequest(
            {
                url: "/does-not-exist",
                method: "GET",
                headers: { host: "localhost:3005" },
            } as any,
            res as any,
        );

        expect(res.statusCode).toBe(404);
        expect(res.body).toContain("Not Found");
    });
});
