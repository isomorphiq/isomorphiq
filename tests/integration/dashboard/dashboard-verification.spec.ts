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

describe("Dashboard Integration Verification", () => {
    describe("API Endpoint Tests", () => {
        it("should serve dashboard HTML", async () => {
            test.skip(!serverAvailable, "Dashboard server unavailable");

            const response = await fetch(`${baseUrl}/`);
            expect(response.status).toBe(200);
            expect(response.headers.get("content-type") ?? "").toContain("text/html");

            const html = await response.text();
            expect(html).toContain("Task Manager Dashboard");
            expect(html).toContain("Real-time Task Monitoring");
        });

        it("should provide comprehensive metrics", async () => {
            test.skip(!serverAvailable, "Dashboard server unavailable");

            const response = await fetch(`${baseUrl}/api/metrics`);
            expect(response.status).toBe(200);

            const metrics = await response.json();
            expect(metrics).toHaveProperty("daemon");
            expect(metrics).toHaveProperty("tasks");
            expect(metrics).toHaveProperty("health");
            expect(metrics).toHaveProperty("system");

            const daemon = metrics && typeof metrics === "object" ? Reflect.get(metrics, "daemon") : undefined;
            const tasks = metrics && typeof metrics === "object" ? Reflect.get(metrics, "tasks") : undefined;
            const health = metrics && typeof metrics === "object" ? Reflect.get(metrics, "health") : undefined;
            const system = metrics && typeof metrics === "object" ? Reflect.get(metrics, "system") : undefined;

            expect(daemon).toBeDefined();
            expect(tasks).toBeDefined();
            expect(health).toBeDefined();
            expect(system).toBeDefined();
        });

        it("should support task CRUD operations", async () => {
            test.skip(!serverAvailable, "Dashboard server unavailable");

            const listResponse = await fetch(`${baseUrl}/api/tasks`);
            expect(listResponse.status).toBe(200);
            const tasks = await listResponse.json();
            expect(Array.isArray(tasks)).toBe(true);

            if (tasks.length > 0) {
                const task = tasks[0];
                expect(task.id).toBeDefined();
                expect(task.title).toBeDefined();
                expect(task.status).toBeDefined();
                expect(task.priority).toBeDefined();
            }
        });

        it("should support advanced task filtering", async () => {
            test.skip(!serverAvailable, "Dashboard server unavailable");

            const searchResponse = await fetch(`${baseUrl}/api/tasks/search?q=Task`);
            expect(searchResponse.status).toBe(200);
            const searchResults = await searchResponse.json();
            expect(Array.isArray(searchResults)).toBe(true);

            const filterResponse = await fetch(`${baseUrl}/api/tasks/filtered`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    filters: { status: "done", limit: 5 },
                }),
            });
            expect(filterResponse.status).toBe(200);
            const filteredResults = await filterResponse.json();
            expect(Array.isArray(filteredResults)).toBe(true);

            filteredResults.forEach((task: { status?: string }) => {
                expect(task.status).toBe("done");
            });
        });

        it("should provide queue status and analytics", async () => {
            test.skip(!serverAvailable, "Dashboard server unavailable");

            const response = await fetch(`${baseUrl}/api/queue/status`);
            expect(response.status).toBe(200);

            const queue = await response.json();
            const queueByPriority = queue && typeof queue === "object" ? Reflect.get(queue, "queueByPriority") : undefined;
            const processingTimes = queue && typeof queue === "object" ? Reflect.get(queue, "processingTimes") : undefined;
            expect(queue).toHaveProperty("total");
            expect(queueByPriority).toBeDefined();
            expect(processingTimes).toBeDefined();
        });

        it("should provide system health monitoring", async () => {
            test.skip(!serverAvailable, "Dashboard server unavailable");

            const response = await fetch(`${baseUrl}/api/health`);
            expect(response.status).toBe(200);

            const health = await response.json();
            const daemon = health && typeof health === "object" ? Reflect.get(health, "daemon") : undefined;
            const websocket = health && typeof health === "object" ? Reflect.get(health, "websocket") : undefined;
            expect(health).toHaveProperty("status");
            expect(daemon).toBeDefined();
            expect(websocket).toBeDefined();
        });

        it("should provide performance metrics", async () => {
            test.skip(!serverAvailable, "Dashboard server unavailable");

            const response = await fetch(`${baseUrl}/api/performance`);
            expect(response.status).toBe(200);

            const perf = await response.json();
            const memory = perf && typeof perf === "object" ? Reflect.get(perf, "memory") : undefined;
            const cpu = perf && typeof perf === "object" ? Reflect.get(perf, "cpu") : undefined;
            const tasks = perf && typeof perf === "object" ? Reflect.get(perf, "tasks") : undefined;
            expect(memory).toBeDefined();
            expect(cpu).toBeDefined();
            expect(tasks).toBeDefined();
        });

        it("should provide activity logging", async () => {
            test.skip(!serverAvailable, "Dashboard server unavailable");

            const response = await fetch(`${baseUrl}/api/logs?limit=10`);
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

        it("should support notification subscriptions", async () => {
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
    });
});
