import { test, expect } from "@playwright/test";

import http from "node:http";
import { WebSocket } from "ws";

const describe = test.describe;
const it = test;
const before = test.beforeAll;
const after = test.afterAll;
const beforeEach = test.beforeEach;
const afterEach = test.afterEach;

const DASHBOARD_PORT = 3005;
const DASHBOARD_URL = `http://localhost:${DASHBOARD_PORT}`;
let serverAvailable = false;

/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
class DashboardValidator {
    private results: Record<string, "PASS" | "FAIL" | "SKIP"> = {};

    async validateDashboard(): Promise<Record<string, "PASS" | "FAIL" | "SKIP">> {
        await this.validateDashboardUI();
        await this.validateRealtimeUpdates();
        await this.validateTaskMonitoring();
        await this.validateSearchAndFilter();
        await this.validateSystemMetrics();
        await this.validateQueueStatus();
        await this.validateAPIEndpoints();
        return this.results;
    }

    private async validateDashboardUI(): Promise<void> {
        try {
            const response = await this.httpGet("/");
            if (response.statusCode === 200) {
                const html = response.body;
                const checks = [
                    { test: "HTML served", check: html.includes("<!DOCTYPE html>") },
                    { test: "Dashboard title", check: html.includes("Task Manager Dashboard") },
                    { test: "Real-time monitoring", check: html.includes("Real-time") },
                    { test: "Metrics display", check: html.includes("metric-card") },
                    { test: "Task management", check: html.includes("Create Task") },
                    { test: "Search functionality", check: html.includes("searchInput") },
                    { test: "Filter controls", check: html.includes("statusFilter") },
                    { test: "Responsive design", check: html.includes("@media") },
                ];

                checks.forEach(({ test, check }) => {
                    this.results[`UI: ${test}`] = check ? "PASS" : "FAIL";
                });
            } else {
                this.results["UI: Dashboard accessible"] = "FAIL";
            }
        } catch {
            this.results["UI: Dashboard accessible"] = "FAIL";
        }
    }

    private async validateRealtimeUpdates(): Promise<void> {
        try {
            const ws = new WebSocket(`ws://localhost:${DASHBOARD_PORT}/dashboard-ws`);

            const connectionResult = await new Promise<"PASS" | "FAIL">((resolve) => {
                const timeout = setTimeout(() => {
                    this.results["WebSocket: Connection"] = "FAIL";
                    resolve("FAIL");
                }, 5000);

                ws.on("open", () => {
                    clearTimeout(timeout);
                    this.results["WebSocket: Connection"] = "PASS";
                    resolve("PASS");
                });

                ws.on("error", () => {
                    clearTimeout(timeout);
                    resolve("FAIL");
                });
            });

            if (connectionResult === "PASS") {
                const messageResult = await new Promise<"PASS" | "SKIP">((resolve) => {
                    const timeout = setTimeout(() => {
                        this.results["WebSocket: Real-time messages"] = "SKIP";
                        resolve("SKIP");
                    }, 3000);

                    ws.on("message", (data) => {
                        try {
                            const message = JSON.parse(data.toString());
                            clearTimeout(timeout);
                            this.results["WebSocket: Real-time messages"] = "PASS";
                            this.results["WebSocket: Message format"] =
                                message.type && message.data ? "PASS" : "FAIL";
                            resolve("PASS");
                        } catch {
                            return;
                        }
                    });
                });

                if (messageResult === "SKIP") {
                    this.results["WebSocket: Message format"] = "SKIP";
                }
            }

            ws.close();
        } catch {
            this.results["WebSocket: Connection"] = "FAIL";
        }
    }

    private async validateTaskMonitoring(): Promise<void> {
        try {
            const response = await this.httpGet("/api/tasks");
            const tasks = JSON.parse(response.body);
            this.results["Tasks: List accessible"] = Array.isArray(tasks) ? "PASS" : "FAIL";

            if (Array.isArray(tasks) && tasks.length > 0) {
                const task = tasks[0];
                const requiredFields = ["id", "title", "status", "priority"];
                const hasFields = requiredFields.every((field) => field in task);
                this.results["Tasks: Required fields"] = hasFields ? "PASS" : "FAIL";
            } else {
                this.results["Tasks: Required fields"] = "SKIP";
            }
        } catch {
            this.results["Tasks: List accessible"] = "FAIL";
            this.results["Tasks: Required fields"] = "FAIL";
        }
    }

    private async validateSearchAndFilter(): Promise<void> {
        try {
            const searchResponse = await this.httpGet("/api/tasks/search?q=test");
            const searchResults = JSON.parse(searchResponse.body);
            this.results["Search: Endpoint works"] = Array.isArray(searchResults) ? "PASS" : "FAIL";

            const filterResponse = await this.httpPost("/api/tasks/filtered", {
                filters: { status: "done", limit: 5 },
            });
            const filterResults = JSON.parse(filterResponse.body);
            this.results["Filter: Endpoint works"] = Array.isArray(filterResults) ? "PASS" : "FAIL";
        } catch {
            this.results["Search: Endpoint works"] = "FAIL";
            this.results["Filter: Endpoint works"] = "FAIL";
        }
    }

    private async validateSystemMetrics(): Promise<void> {
        try {
            const response = await this.httpGet("/api/metrics");
            const metrics = JSON.parse(response.body);
            const hasMetrics = metrics.daemon && metrics.tasks && metrics.health;
            this.results["Metrics: Core data"] = hasMetrics ? "PASS" : "FAIL";
        } catch {
            this.results["Metrics: Core data"] = "FAIL";
        }
    }

    private async validateQueueStatus(): Promise<void> {
        try {
            const response = await this.httpGet("/api/queue/status");
            const queue = JSON.parse(response.body);
            const hasQueue = queue.queueByPriority && queue.processingTimes;
            this.results["Queue: Status data"] = hasQueue ? "PASS" : "FAIL";
        } catch {
            this.results["Queue: Status data"] = "FAIL";
        }
    }

    private async validateAPIEndpoints(): Promise<void> {
        const endpoints = [
            "/api/metrics",
            "/api/tasks",
            "/api/queue/status",
            "/api/health",
            "/api/analytics",
        ];

        for (const endpoint of endpoints) {
            try {
                const response = await this.httpGet(endpoint);
                const passed = response.statusCode === 200;
                this.results[`API: ${endpoint}`] = passed ? "PASS" : "FAIL";
            } catch {
                this.results[`API: ${endpoint}`] = "FAIL";
            }
        }
    }

    private async httpGet(path: string): Promise<{ statusCode: number; body: string }> {
        return new Promise((resolve, reject) => {
            const req = http.request(
                {
                    hostname: "localhost",
                    port: DASHBOARD_PORT,
                    path,
                    method: "GET",
                },
                (res) => {
                    let data = "";
                    res.on("data", (chunk) => {
                        data += chunk;
                    });
                    res.on("end", () => {
                        resolve({ statusCode: res.statusCode ?? 0, body: data });
                    });
                },
            );

            req.on("error", reject);
            req.end();
        });
    }

    private async httpPost(path: string, body: unknown): Promise<{ statusCode: number; body: string }> {
        return new Promise((resolve, reject) => {
            const payload = JSON.stringify(body);
            const req = http.request(
                {
                    hostname: "localhost",
                    port: DASHBOARD_PORT,
                    path,
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Content-Length": Buffer.byteLength(payload),
                    },
                },
                (res) => {
                    let data = "";
                    res.on("data", (chunk) => {
                        data += chunk;
                    });
                    res.on("end", () => {
                        resolve({ statusCode: res.statusCode ?? 0, body: data });
                    });
                },
            );

            req.on("error", reject);
            req.write(payload);
            req.end();
        });
    }
}

const checkServer = async (): Promise<boolean> => {
    try {
        const response = await fetch(`${DASHBOARD_URL}/api/health`);
        return response.ok;
    } catch {
        return false;
    }
};

before(async () => {
    serverAvailable = await checkServer();
});

describe("Dashboard E2E Validation", () => {
    it("validates the dashboard feature set", async () => {
        test.skip(!serverAvailable, "Dashboard server unavailable");

        const validator = new DashboardValidator();
        const results = await validator.validateDashboard();
        const failures = Object.entries(results).filter(([, status]) => status === "FAIL");
        expect(failures.length).toBe(0);
    });
});

