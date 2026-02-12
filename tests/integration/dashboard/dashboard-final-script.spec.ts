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
const BASE_URL = `http://localhost:${DASHBOARD_PORT}`;
let serverAvailable = false;

type HttpResponse = {
    status: number;
    body: unknown;
};

const makeRequest = async (endpoint: string, options: http.RequestOptions & { body?: string } = {}): Promise<HttpResponse> => {
    return new Promise((resolve, reject) => {
        const url = new URL(endpoint, BASE_URL);
        const req = http.request(url, options, (res) => {
            let data = "";
            res.on("data", (chunk) => {
                data += chunk;
            });
            res.on("end", () => {
                try {
                    resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) });
                } catch {
                    resolve({ status: res.statusCode ?? 0, body: data });
                }
            });
        });

        req.on("error", reject);
        if (options.body) {
            req.write(options.body);
        }
        req.end();
    });
};

const sendTcpCommand = async (command: string, data: unknown): Promise<unknown> => {
    return new Promise((resolve, reject) => {
        const client = createConnection({ port: TCP_PORT, host: "localhost" }, () => {
            const message = `${JSON.stringify({ command, data })}\n`;
            client.write(message);
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
        }, 5000);
    });
};

const testWebSocketConnection = async (): Promise<boolean> => {
    return new Promise((resolve) => {
        const ws = new WebSocket(`ws://localhost:${DASHBOARD_PORT}/dashboard-ws`);
        const timeout = setTimeout(() => {
            ws.close();
            resolve(false);
        }, 5000);

        ws.on("open", () => {
            ws.send(JSON.stringify({ type: "refresh_metrics" }));
        });

        ws.on("message", () => {
            clearTimeout(timeout);
            ws.close();
            resolve(true);
        });

        ws.on("error", () => {
            clearTimeout(timeout);
            resolve(false);
        });
    });
};

const checkServer = async (): Promise<boolean> => {
    try {
        const response = await makeRequest("/");
        if (response.status !== 200) {
            return false;
        }
        await sendTcpCommand("ws_status", {});
        return true;
    } catch {
        return false;
    }
};

before(async () => {
    serverAvailable = await checkServer();
});

const runTests = async (): Promise<boolean> => {
    const response = await makeRequest("/");
    if (typeof response.body !== "string" || !response.body.includes("Task Manager Dashboard")) {
        return false;
    }

    const metrics = await makeRequest("/api/metrics");
    if (!metrics.body || typeof metrics.body !== "object") {
        return false;
    }

    const tasks = await makeRequest("/api/tasks");
    if (!Array.isArray(tasks.body)) {
        return false;
    }

    const taskData = {
        title: "Test Dashboard Integration Task",
        description: "Created during integration testing",
        priority: "high",
        createdBy: "test-suite",
    };

    const createResponse = await makeRequest("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(taskData),
    });

    const createResult = createResponse.body;
    const createSuccess = createResult && typeof createResult === "object" ? Reflect.get(createResult, "success") : undefined;
    const createData = createResult && typeof createResult === "object" ? Reflect.get(createResult, "data") : undefined;
    const taskId = createData && typeof createData === "object" ? String(Reflect.get(createData, "id") ?? "") : "";
    if (!createSuccess || !taskId) {
        return false;
    }

    const updateResponse = await makeRequest("/api/tasks/update", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: taskId, status: "in-progress" }),
    });

    const updateResult = updateResponse.body;
    const updateSuccess = updateResult && typeof updateResult === "object" ? Reflect.get(updateResult, "success") : undefined;
    if (!updateSuccess) {
        return false;
    }

    const queueResponse = await makeRequest("/api/queue/status");
    if (!queueResponse.body || typeof queueResponse.body !== "object") {
        return false;
    }

    const healthResponse = await makeRequest("/api/health");
    if (!healthResponse.body || typeof healthResponse.body !== "object") {
        return false;
    }

    const wsOk = await testWebSocketConnection();
    if (!wsOk) {
        return false;
    }

    const tcpResult = await sendTcpCommand("list_tasks", {});
    const tcpSuccess = tcpResult && typeof tcpResult === "object" ? Reflect.get(tcpResult, "success") : undefined;
    const tcpData = tcpResult && typeof tcpResult === "object" ? Reflect.get(tcpResult, "data") : undefined;
    return Boolean(tcpSuccess && Array.isArray(tcpData));
};

describe("Dashboard Final Script", () => {
    it("runs the final integration suite", async () => {
        test.skip(!serverAvailable, "Dashboard server unavailable");

        const result = await runTests();
        expect(result).toBe(true);
    });
});
