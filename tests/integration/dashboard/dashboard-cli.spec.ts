import { test, expect } from "@playwright/test";

const describe = test.describe;
const it = test;
const before = test.beforeAll;
const after = test.afterAll;
const beforeEach = test.beforeEach;
const afterEach = test.afterEach;


const baseUrl = "http://localhost:3005";
let serverAvailable = false;

const checkServer = async (): Promise<boolean> => {
    try {
        const response = await fetch(`${baseUrl}/api/health`);
        return response.ok;
    } catch {
        return false;
    }
};

before(async () => {
    serverAvailable = await checkServer();
});

describe("Dashboard CLI Integration", () => {
    it("serves dashboard HTML correctly", async () => {
        test.skip(!serverAvailable, "Dashboard server unavailable");

        const response = await fetch(`${baseUrl}/`);
        expect(response.status).toBe(200);
        expect(response.headers.get("content-type") ?? "").toContain("text/html");

        const html = await response.text();
        expect(html).toContain("Task Manager Dashboard");
        expect(html).toContain("Real-time Task Monitoring");
    });

    it("provides metrics API data", async () => {
        test.skip(!serverAvailable, "Dashboard server unavailable");

        const response = await fetch(`${baseUrl}/api/metrics`);
        expect(response.status).toBe(200);

        const metrics = await response.json();
        expect(metrics).toHaveProperty("daemon");
        expect(metrics).toHaveProperty("tasks");
        expect(metrics).toHaveProperty("health");
        expect(metrics).toHaveProperty("system");
        expect(typeof metrics.daemon.uptime).toBe("number");
        expect(typeof metrics.tasks.total).toBe("number");
        expect(metrics.health.status).toBeDefined();
        expect(metrics.system.nodeVersion).toBeDefined();
    });

    it("provides task data", async () => {
        test.skip(!serverAvailable, "Dashboard server unavailable");

        const response = await fetch(`${baseUrl}/api/tasks`);
        expect(response.status).toBe(200);

        const tasks = await response.json();
        expect(Array.isArray(tasks)).toBe(true);

        if (tasks.length > 0) {
            const task = tasks[0];
            expect(task.id).toBeDefined();
            expect(task.title).toBeDefined();
            expect(task.status).toBeDefined();
            expect(task.priority).toBeDefined();
        }
    });

    it("supports task search", async () => {
        test.skip(!serverAvailable, "Dashboard server unavailable");

        const response = await fetch(`${baseUrl}/api/tasks/search?q=Task`);
        expect(response.status).toBe(200);

        const results = await response.json();
        expect(Array.isArray(results)).toBe(true);
    });

    it("supports advanced task filtering", async () => {
        test.skip(!serverAvailable, "Dashboard server unavailable");

        const response = await fetch(`${baseUrl}/api/tasks/filtered`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                filters: { status: "done", limit: 5 },
            }),
        });
        expect(response.status).toBe(200);

        const results = await response.json();
        expect(Array.isArray(results)).toBe(true);
    });

    it("returns queue status and analytics", async () => {
        test.skip(!serverAvailable, "Dashboard server unavailable");

        const response = await fetch(`${baseUrl}/api/queue/status`);
        expect(response.status).toBe(200);

        const queue = await response.json();
        expect(typeof queue.total).toBe("number");
        expect(queue.queueByPriority).toBeDefined();
        expect(queue.processingTimes).toBeDefined();
        expect(Array.isArray(queue.queueByPriority.high)).toBe(true);
        expect(Array.isArray(queue.queueByPriority.medium)).toBe(true);
        expect(Array.isArray(queue.queueByPriority.low)).toBe(true);
    });

    it("exposes system health monitoring", async () => {
        test.skip(!serverAvailable, "Dashboard server unavailable");

        const response = await fetch(`${baseUrl}/api/health`);
        expect(response.status).toBe(200);

        const health = await response.json();
        expect(health.status).toBeDefined();
        expect(health.daemon).toBeDefined();
        expect(health.websocket).toBeDefined();
        expect(typeof health.daemon.pid).toBe("number");
        expect(typeof health.daemon.uptime).toBe("number");
        expect(health.daemon.memory).toBeDefined();
    });

    it("returns performance metrics", async () => {
        test.skip(!serverAvailable, "Dashboard server unavailable");

        const response = await fetch(`${baseUrl}/api/performance`);
        expect(response.status).toBe(200);

        const perf = await response.json();
        expect(perf.memory).toBeDefined();
        expect(perf.cpu).toBeDefined();
        expect(perf.tasks).toBeDefined();
        expect(perf.memory.heap).toBeDefined();
        expect(typeof perf.memory.heap.percentage).toBe("number");
        expect(perf.tasks.throughput).toBeDefined();
        expect(typeof perf.tasks.throughput.completed).toBe("number");
    });

    it("returns activity logs", async () => {
        test.skip(!serverAvailable, "Dashboard server unavailable");

        const response = await fetch(`${baseUrl}/api/logs?limit=5`);
        expect(response.status).toBe(200);

        const logs = await response.json();
        expect(Array.isArray(logs)).toBe(true);

        if (logs.length > 0) {
            const log = logs[0];
            expect(log.id).toBeDefined();
            expect(log.type).toBeDefined();
            expect(log.message).toBeDefined();
            expect(log.timestamp).toBeDefined();
            expect(log.level).toBeDefined();
            expect(log.data).toBeDefined();
        }
    });

    it("handles notification subscriptions", async () => {
        test.skip(!serverAvailable, "Dashboard server unavailable");

        const response = await fetch(`${baseUrl}/api/notifications/subscribe`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                sessionId: "test-session-123",
                taskIds: ["task-1", "task-2"],
            }),
        });
        expect(response.status).toBe(200);

        const subscription = await response.json();
        expect(subscription.success).toBe(true);
        expect(subscription.sessionId).toBe("test-session-123");
        expect(Array.isArray(subscription.subscribedTasks)).toBe(true);
    });

    it("handles error responses", async () => {
        test.skip(!serverAvailable, "Dashboard server unavailable");

        const notFoundResponse = await fetch(`${baseUrl}/nonexistent`);
        expect(notFoundResponse.status).toBe(404);

        const invalidJsonResponse = await fetch(`${baseUrl}/api/tasks/filtered`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "invalid json{",
        });
        expect([400, 500].includes(invalidJsonResponse.status)).toBe(true);
    });

    it("handles WebSocket upgrade endpoint", async () => {
        test.skip(!serverAvailable, "Dashboard server unavailable");

        const response = await fetch(`${baseUrl}/dashboard-ws`, {
            headers: {
                "Upgrade": "websocket",
                "Connection": "Upgrade",
            },
        });
        expect([101, 400, 500].includes(response.status)).toBe(true);
    });

    it("renders expected UI components", async () => {
        test.skip(!serverAvailable, "Dashboard server unavailable");

        const response = await fetch(`${baseUrl}/`);
        expect(response.status).toBe(200);

        const html = await response.text();
        expect(html).toContain("Overview");
        expect(html).toContain("Queue Status");
        expect(html).toContain("Tasks");
        expect(html).toContain("Create Task");
        expect(html).toContain("Health");
        expect(html).toContain("Activity Log");
        expect(html).toContain("connectWebSocket");
        expect(html).toContain("loadMetrics");
        expect(html).toContain("loadTasks");
        expect(html).toContain("createTask");
        expect(html).toContain("loadQueueStatus");
        expect(html).toContain("@media");
        expect(html).toContain("mobile");
    });
});
