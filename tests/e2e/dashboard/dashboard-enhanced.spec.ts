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

const createDashboardServer = (
    tasks: TaskRecord[],
    analyticsPayload: Record<string, unknown> = { ok: true },
): DashboardServer => {
    const taskManager = {
        getAllTasks: async () => ({ success: true, data: tasks }),
    };
    const webSocketManager = {
        getConnectionCount: () => 2,
    } as any;
    const analyticsService = {
        handleAnalyticsRequest: async (_req: unknown, res: any) => {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(analyticsPayload));
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

const invoke = async (
    server: DashboardServer,
    path: string,
): Promise<{ statusCode: number; headers: Record<string, string>; body: string }> => {
    const res = createMockResponse();
    await server.handleRequest(
        { url: path, method: "GET", headers: { host: "localhost:3005" } } as any,
        res as any,
    );
    return {
        statusCode: res.statusCode,
        headers: res.headers,
        body: res.body,
    };
};

describe("DashboardServer Enhanced API", () => {
    let dashboardServer: DashboardServer;

    beforeEach(() => {
        const now = new Date().toISOString();
        dashboardServer = createDashboardServer([
            {
                id: "task-1",
                title: "Important migration",
                description: "Update dashboard tests",
                status: "todo",
                priority: "high",
                createdAt: now,
                updatedAt: now,
            },
            {
                id: "task-2",
                title: "Routine cleanup",
                description: "Refactor helpers",
                status: "in-progress",
                priority: "medium",
                createdAt: now,
                updatedAt: now,
            },
            {
                id: "task-3",
                title: "Release",
                description: "Ship improvements",
                status: "done",
                priority: "low",
                createdAt: now,
                updatedAt: now,
            },
        ]);
    });

    it("returns detailed metrics with distributions", async () => {
        const response = await invoke(dashboardServer, "/api/metrics");
        expect(response.statusCode).toBe(200);
        const payload = JSON.parse(response.body);

        expect(payload.tasks.total).toBe(3);
        expect(payload.tasks.byPriority.high).toBe(1);
        expect(payload.tasks.byPriority.medium).toBe(1);
        expect(payload.tasks.byPriority.low).toBe(1);
        expect(payload.tasks.byStatus.todo).toBe(1);
        expect(payload.tasks.byStatus["in-progress"]).toBe(1);
        expect(payload.tasks.byStatus.done).toBe(1);
    });

    it("searches tasks by free-text query", async () => {
        const response = await invoke(dashboardServer, "/api/tasks?q=important");
        expect(response.statusCode).toBe(200);
        const payload = JSON.parse(response.body);

        expect(payload.length).toBe(1);
        expect(payload[0].id).toBe("task-1");
    });

    it("combines status and priority filters", async () => {
        const response = await invoke(
            dashboardServer,
            "/api/tasks?status=in-progress&priority=medium",
        );
        expect(response.statusCode).toBe(200);
        const payload = JSON.parse(response.body);

        expect(payload.length).toBe(1);
        expect(payload[0].id).toBe("task-2");
    });

    it("rejects oversized search queries", async () => {
        const longQuery = "x".repeat(2100);
        const response = await invoke(dashboardServer, `/api/tasks?q=${longQuery}`);

        expect(response.statusCode).toBe(414);
        const payload = JSON.parse(response.body);
        expect(payload.error).toContain("Search query too long");
    });

    it("delegates analytics endpoints to analytics service", async () => {
        const analyticsServer = createDashboardServer(
            [],
            { chart: "throughput", samples: 12 },
        );
        const response = await invoke(analyticsServer, "/api/analytics?window=7d");

        expect(response.statusCode).toBe(200);
        const payload = JSON.parse(response.body);
        expect(payload.chart).toBe("throughput");
        expect(payload.samples).toBe(12);
    });
});
