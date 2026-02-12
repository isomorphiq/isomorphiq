import { test, expect } from "@playwright/test";

const describe = test.describe;
const it = test;
const before = test.beforeAll;
const after = test.afterAll;
const beforeEach = test.beforeEach;
const afterEach = test.afterEach;


const DASHBOARD_PORT = 3005;
const BASE_URL = `http://localhost:${DASHBOARD_PORT}`;
let serverAvailable = false;

const checkServer = async (): Promise<boolean> => {
    try {
        const response = await fetch(`${BASE_URL}/api/health`);
        return response.ok;
    } catch {
        return false;
    }
};

before(async () => {
    serverAvailable = await checkServer();
});

const runDashboardChecks = async (): Promise<void> => {
    const htmlResponse = await fetch(`${BASE_URL}/`);
    expect(htmlResponse.status).toBe(200);
    const html = await htmlResponse.text();
    expect(html).toContain("Task Manager Dashboard");

    const metricsResponse = await fetch(`${BASE_URL}/api/metrics`);
    expect(metricsResponse.status).toBe(200);
    const metrics = await metricsResponse.json();
    expect(metrics).toHaveProperty("tasks");
    expect(metrics).toHaveProperty("daemon");
    expect(metrics).toHaveProperty("health");
    expect(metrics).toHaveProperty("system");

    const tasksResponse = await fetch(`${BASE_URL}/api/tasks`);
    expect(tasksResponse.status).toBe(200);
    const tasks = await tasksResponse.json();
    expect(Array.isArray(tasks)).toBe(true);

    const filterResponse = await fetch(`${BASE_URL}/api/tasks?status=done`);
    expect(filterResponse.status).toBe(200);
    const filteredTasks = await filterResponse.json();
    expect(Array.isArray(filteredTasks)).toBe(true);

    const searchResponse = await fetch(`${BASE_URL}/api/tasks/search?q=Dashboard`);
    expect(searchResponse.status).toBe(200);
    const searchResults = await searchResponse.json();
    expect(Array.isArray(searchResults)).toBe(true);

    const queueResponse = await fetch(`${BASE_URL}/api/queue/status`);
    expect(queueResponse.status).toBe(200);
    const queueStatus = await queueResponse.json();
    expect(queueStatus).toHaveProperty("total");
};

describe("Dashboard Node Integration", () => {
    it("runs the dashboard integration checks", async () => {
        test.skip(!serverAvailable, "Dashboard server unavailable");

        await runDashboardChecks();
    });
});
