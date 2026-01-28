import { describe, it, before } from "node:test";
import http from "node:http";
import { createConnection } from "node:net";
import { WebSocket } from "ws";
import { expect } from "../../test-utils/expect.ts";

type HttpResponse = {
    status: number;
    body: unknown;
};

const DASHBOARD_PORT = 3005;
const TCP_PORT = 3001;
const BASE_URL = `http://localhost:${DASHBOARD_PORT}`;
let serverAvailable = false;

const makeRequest = async (endpoint: string, options: http.RequestOptions & { body?: string } = {}): Promise<HttpResponse> => {
    return new Promise((resolve, reject) => {
        const url = new URL(endpoint, BASE_URL);
        const req = http.request(url, options, (res) => {
            let data = "";
            res.on("data", (chunk) => {
                data += chunk;
            });
            res.on("end", () => {
                let parsed: unknown = data;
                try {
                    parsed = JSON.parse(data);
                } catch {
                    parsed = data;
                }
                resolve({ status: res.statusCode ?? 0, body: parsed });
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

const testWebSocketConnection = async (): Promise<void> => {
    await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`ws://localhost:${DASHBOARD_PORT}/dashboard-ws`);
        let connected = false;
        let receivedMessage = false;

        const timeout = setTimeout(() => {
            ws.close();
            reject(new Error("WebSocket connection timeout"));
        }, 5000);

        ws.on("open", () => {
            connected = true;
            ws.send(JSON.stringify({ type: "refresh_metrics" }));
        });

        ws.on("message", (data) => {
            try {
                JSON.parse(data.toString());
                receivedMessage = true;
                ws.close();
            } catch {
                return;
            }
        });

        ws.on("close", () => {
            clearTimeout(timeout);
            if (connected && receivedMessage) {
                resolve();
            } else {
                reject(new Error("WebSocket test failed"));
            }
        });

        ws.on("error", (error) => {
            clearTimeout(timeout);
            reject(error);
        });
    });
};

const checkServers = async (): Promise<boolean> => {
    try {
        const dashboardResponse = await makeRequest("/");
        if (dashboardResponse.status !== 200) {
            return false;
        }
        await sendTcpCommand("ws_status", {});
        return true;
    } catch {
        return false;
    }
};

before(async () => {
    serverAvailable = await checkServers();
});

describe("Dashboard Integration Suite", () => {
    it("runs the full integration checklist", async (t) => {
        if (!serverAvailable) {
            t.skip();
            return;
        }

        const dashboardResponse = await makeRequest("/");
        expect(dashboardResponse.status).toBe(200);
        expect(String(dashboardResponse.body)).toContain("Task Manager Dashboard");

        const metricsResponse = await makeRequest("/api/metrics");
        expect(metricsResponse.status).toBe(200);
        const metrics = metricsResponse.body;
        expect(metrics).toHaveProperty("daemon");
        expect(metrics).toHaveProperty("tasks");
        expect(metrics).toHaveProperty("health");
        expect(metrics).toHaveProperty("system");
        const metricsTasks = metrics && typeof metrics === "object" ? Reflect.get(metrics, "tasks") : undefined;
        expect(metricsTasks).toHaveProperty("total");

        const tasksResponse = await makeRequest("/api/tasks");
        expect(tasksResponse.status).toBe(200);
        expect(Array.isArray(tasksResponse.body)).toBe(true);

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
        expect(createSuccess).toBe(true);
        expect(createData).toHaveProperty("id");

        const taskId = typeof createData === "object" && createData
            ? String(Reflect.get(createData, "id") ?? "")
            : "";
        const updateResponse = await makeRequest("/api/tasks/update", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: taskId, status: "in-progress" }),
        });
        const updateResult = updateResponse.body;
        const updateSuccess = updateResult && typeof updateResult === "object" ? Reflect.get(updateResult, "success") : undefined;
        const updateData = updateResult && typeof updateResult === "object" ? Reflect.get(updateResult, "data") : undefined;
        const updateStatus = updateData && typeof updateData === "object" ? Reflect.get(updateData, "status") : undefined;
        expect(updateSuccess).toBe(true);
        expect(updateStatus).toBe("in-progress");

        const queueResponse = await makeRequest("/api/queue/status");
        expect(queueResponse.status).toBe(200);
        const queue = queueResponse.body;
        const queueTotal = queue && typeof queue === "object" ? Reflect.get(queue, "total") : undefined;
        const queueByPriority = queue && typeof queue === "object" ? Reflect.get(queue, "queueByPriority") : undefined;
        expect(queueTotal).toBeDefined();
        expect(queueByPriority).toBeDefined();

        const healthResponse = await makeRequest("/api/health");
        expect(healthResponse.status).toBe(200);
        const health = healthResponse.body;
        const healthStatus = health && typeof health === "object" ? Reflect.get(health, "status") : undefined;
        const healthDaemon = health && typeof health === "object" ? Reflect.get(health, "daemon") : undefined;
        expect(healthStatus).toBeDefined();
        expect(healthDaemon).toBeDefined();

        await testWebSocketConnection();

        const tcpResult = await sendTcpCommand("list_tasks", {});
        const tcpPayload = tcpResult;
        const tcpSuccess = tcpPayload && typeof tcpPayload === "object" ? Reflect.get(tcpPayload, "success") : undefined;
        const tcpData = tcpPayload && typeof tcpPayload === "object" ? Reflect.get(tcpPayload, "data") : undefined;
        expect(tcpSuccess).toBe(true);
        expect(Array.isArray(tcpData)).toBe(true);
    });
});
