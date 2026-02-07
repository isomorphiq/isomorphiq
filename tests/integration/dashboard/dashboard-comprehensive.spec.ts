import { test, expect } from "@playwright/test";

import http from "node:http";
import { createConnection } from "node:net";
import { WebSocket } from "ws";

const describe = test.describe;
const it = test;
const before = test.beforeAll;
const after = test.afterAll;
const beforeEach = test.beforeEach;
const afterEach = test.afterEach;

const DASHBOARD_PORT = 3005;
const TCP_PORT = Number(process.env.TCP_PORT ?? process.env.DAEMON_PORT ?? 3001);
const WS_URL = `ws://localhost:${DASHBOARD_PORT}/dashboard-ws`;

let serverAvailable = false;

type HttpResponse = {
    status: number;
    data: unknown;
};

const makeHttpRequest = async (path: string, method: string = "GET", data: unknown = null): Promise<HttpResponse> => {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: "localhost",
            port: DASHBOARD_PORT,
            path,
            method,
            headers: data ? { "Content-Type": "application/json" } : {},
        };

        const req = http.request(options, (res) => {
            let body = "";
            res.on("data", (chunk) => {
                body += chunk;
            });
            res.on("end", () => {
                try {
                    resolve({ status: res.statusCode ?? 0, data: JSON.parse(body) });
                } catch {
                    resolve({ status: res.statusCode ?? 0, data: body });
                }
            });
        });

        req.on("error", reject);
        if (data) {
            req.write(JSON.stringify(data));
        }
        req.end();
    });
};

const makeTcpRequest = async (command: string, data: unknown): Promise<unknown> => {
    return new Promise((resolve, reject) => {
        const client = createConnection({ port: TCP_PORT, host: "localhost" }, () => {
            client.write(`${JSON.stringify({ command, data })}\n`);
        });

        let response = "";
        client.on("data", (buffer) => {
            response += buffer.toString();
            try {
                const result = JSON.parse(response.trim());
                client.end();
                resolve(result);
            } catch {
                return;
            }
        });

        client.on("error", reject);
        client.on("close", () => {
            if (!response) {
                reject(new Error("Connection closed without response"));
            }
        });

        setTimeout(() => {
            client.destroy();
            reject(new Error("Request timeout"));
        }, 10000);
    });
};

const checkServer = async (): Promise<boolean> => {
    try {
        const response = await makeHttpRequest("/");
        return response.status === 200;
    } catch {
        return false;
    }
};

before(async () => {
    serverAvailable = await checkServer();
});

const testBasicConnectivity = async (): Promise<void> => {
    const response = await makeHttpRequest("/");
    if (response.status !== 200 || !String(response.data).includes("<!DOCTYPE html>")) {
        throw new Error("Dashboard main page not accessible");
    }
};

const testApiEndpoints = async (): Promise<void> => {
    const endpoints = [
        { path: "/api/metrics", name: "Metrics" },
        { path: "/api/tasks", name: "Tasks List" },
        { path: "/api/queue/status", name: "Queue Status" },
        { path: "/api/health", name: "Health Check" },
        { path: "/api/status", name: "System Status" },
    ];

    for (const endpoint of endpoints) {
        const response = await makeHttpRequest(endpoint.path);
        if (response.status !== 200 || typeof response.data !== "object") {
            throw new Error(`${endpoint.name} endpoint failed`);
        }
    }
};

const testTaskCrud = async (): Promise<void> => {
    const createResponse = await makeHttpRequest("/api/tasks", "POST", {
        title: "Comprehensive Test Task",
        description: "Created during comprehensive test",
        priority: "medium",
        createdBy: "comprehensive-test",
    });

    const createData = createResponse.data;
    const createSuccess = createData && typeof createData === "object" ? Reflect.get(createData, "success") : undefined;
    const createdTask = createData && typeof createData === "object" ? Reflect.get(createData, "data") : undefined;
    const taskId = createdTask && typeof createdTask === "object" ? String(Reflect.get(createdTask, "id") ?? "") : "";

    if (!createSuccess || !taskId) {
        throw new Error("Task creation failed");
    }

    const updateResponse = await makeHttpRequest("/api/tasks/update", "PUT", {
        id: taskId,
        status: "done",
    });

    const updateData = updateResponse.data;
    const updateSuccess = updateData && typeof updateData === "object" ? Reflect.get(updateData, "success") : undefined;
    if (!updateSuccess) {
        throw new Error("Task update failed");
    }

    const listResponse = await makeHttpRequest("/api/tasks");
    if (!Array.isArray(listResponse.data)) {
        throw new Error("Task list response invalid");
    }
};

const testWebSocketConnection = async (): Promise<void> => {
    await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(WS_URL);
        const timeout = setTimeout(() => {
            ws.close();
            reject(new Error("WebSocket connection timeout"));
        }, 5000);

        ws.on("open", () => {
            ws.send(JSON.stringify({ type: "refresh_metrics" }));
        });

        ws.on("message", (data) => {
            try {
                const payload = JSON.parse(data.toString());
                if (payload?.type) {
                    clearTimeout(timeout);
                    ws.close();
                    resolve();
                }
            } catch {
                return;
            }
        });

        ws.on("error", (error) => {
            clearTimeout(timeout);
            reject(error);
        });
    });
};

const testTcpIntegration = async (): Promise<void> => {
    const result = await makeTcpRequest("list_tasks", {});
    const success = result && typeof result === "object" ? Reflect.get(result, "success") : undefined;
    const data = result && typeof result === "object" ? Reflect.get(result, "data") : undefined;
    if (!success || !Array.isArray(data)) {
        throw new Error("TCP API integration failed");
    }
};

describe("Dashboard Comprehensive Integration", () => {
    it("runs the full comprehensive suite", async () => {
        test.skip(!serverAvailable, "Dashboard server unavailable");

        await testBasicConnectivity();
        await testApiEndpoints();
        await testTaskCrud();
        await testWebSocketConnection();
        await testTcpIntegration();

        expect(true).toBe(true);
    });
});
