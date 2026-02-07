import { test, expect } from "@playwright/test";

import { createConnection } from "node:net";

const describe = test.describe;
const it = test;
const before = test.beforeAll;
const after = test.afterAll;
const beforeEach = test.beforeEach;
const afterEach = test.afterEach;

const DASHBOARD_PORT = 3005;
const TCP_PORT = Number(process.env.TCP_PORT ?? process.env.DAEMON_PORT ?? 3001);
let serverAvailable = false;

const checkServer = async (): Promise<boolean> => {
    try {
        const response = await fetch(`http://localhost:${DASHBOARD_PORT}/api/health`);
        return response.ok;
    } catch {
        return false;
    }
};

before(async () => {
    serverAvailable = await checkServer();
});

const testTcpConnection = async (): Promise<boolean> => {
    return new Promise((resolve) => {
        const client = createConnection({ port: TCP_PORT, host: "localhost" }, () => {
            const testCommand = `${JSON.stringify({ command: "list_tasks", data: {} })}\n`;
            client.write(testCommand);

            let response = "";
            client.on("data", (data) => {
                response += data.toString();
                try {
                    const result = JSON.parse(response.trim());
                    const success = result && typeof result === "object" ? Reflect.get(result, "success") : undefined;
                    client.end();
                    resolve(Boolean(success));
                } catch {
                    return;
                }
            });
        });

        client.on("error", () => {
            resolve(false);
        });

        client.on("close", () => {
            if (!client.destroyed) {
                resolve(false);
            }
        });

        setTimeout(() => {
            client.destroy();
            resolve(false);
        }, 5000);
    });
};

const testDashboardHttp = async (): Promise<boolean> => {
    const endpoints = [
        { path: "/", expected: 200 },
        { path: "/api/metrics", expected: 200 },
        { path: "/api/tasks", expected: 200 },
        { path: "/api/health", expected: 200 },
        { path: "/api/status", expected: 200 },
    ];

    let successCount = 0;
    for (const endpoint of endpoints) {
        try {
            const response = await fetch(`http://localhost:${DASHBOARD_PORT}${endpoint.path}`);
            if (response.status === endpoint.expected) {
                successCount += 1;
            }
        } catch {
            return false;
        }
    }

    return successCount === endpoints.length;
};

const testTaskCreation = async (): Promise<string | null> => {
    const testTask = {
        title: "Dashboard Integration Test Task",
        description: "This task was created to test dashboard functionality",
        priority: "medium",
        type: "test",
    };

    try {
        const response = await fetch(`http://localhost:${DASHBOARD_PORT}/api/tasks`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(testTask),
        });

        if (response.status === 201) {
            const result = await response.json();
            const success = result && typeof result === "object" ? Reflect.get(result, "success") : undefined;
            const data = result && typeof result === "object" ? Reflect.get(result, "data") : undefined;
            const id = data && typeof data === "object" ? Reflect.get(data, "id") : undefined;
            if (success && typeof id === "string") {
                return id;
            }
        }

        return null;
    } catch {
        return null;
    }
};

const testTaskUpdate = async (taskId: string | null): Promise<boolean> => {
    if (!taskId) {
        return false;
    }

    try {
        const response = await fetch(`http://localhost:${DASHBOARD_PORT}/api/tasks/update`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: taskId, status: "done" }),
        });

        if (response.status === 200) {
            const result = await response.json();
            const success = result && typeof result === "object" ? Reflect.get(result, "success") : undefined;
            return Boolean(success);
        }
    } catch {
        return false;
    }

    return false;
};

const testRealTimeFeatures = async (): Promise<boolean> => {
    const { WebSocket } = await import("ws");

    return new Promise((resolve) => {
        const ws = new WebSocket(`ws://localhost:${DASHBOARD_PORT}/dashboard-ws`);
        const timeout = setTimeout(() => {
            ws.close();
            resolve(false);
        }, 5000);

        ws.on("open", () => {
            clearTimeout(timeout);
            ws.send(JSON.stringify({ type: "refresh_metrics" }));
            setTimeout(() => {
                ws.close();
                resolve(true);
            }, 1000);
        });

        ws.on("error", () => {
            clearTimeout(timeout);
            resolve(false);
        });
    });
};

const runFullTest = async (): Promise<boolean> => {
    const tcpOk = await testTcpConnection();
    const httpOk = await testDashboardHttp();
    const createdTaskId = await testTaskCreation();
    const updateOk = await testTaskUpdate(createdTaskId);
    const wsOk = await testRealTimeFeatures();

    return Boolean(tcpOk && httpOk && createdTaskId && updateOk && wsOk);
};

describe("Dashboard Integration Script", () => {
    it("runs the legacy integration suite", async () => {
        test.skip(!serverAvailable, "Dashboard server unavailable");

        const result = await runFullTest();
        expect(result).toBe(true);
    });
});
