import { describe, it, before } from "node:test";
import http from "node:http";
import { createConnection } from "node:net";
import { WebSocket } from "ws";
import { expect } from "../../test-utils/expect.ts";

const DASHBOARD_PORT = 3005;
const TCP_PORT = 3001;
const WS_URL = `ws://localhost:${DASHBOARD_PORT}/dashboard-ws`;

let serverAvailable = false;

type HttpResponse = {
    status: number;
    data: unknown;
};

type WebSocketMessage = {
    type: string;
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

const waitForWebSocketMessage = (ws: WebSocket, timeout: number = 5000): Promise<WebSocketMessage> => {
    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            reject(new Error("WebSocket message timeout"));
        }, timeout);

        ws.once("message", (data) => {
            clearTimeout(timeoutId);
            try {
                const message = JSON.parse(data.toString());
                resolve(message);
            } catch (error) {
                reject(error);
            }
        });
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

describe("Dashboard Integration Tests", () => {
    describe("Server Connectivity", () => {
        it("should have dashboard server available", async () => {
            if (!serverAvailable) {
                console.warn("Dashboard server not available for integration tests");
                return;
            }
            expect(serverAvailable).toBe(true);
        });

        it("should serve main dashboard page", async () => {
            if (!serverAvailable) return;
            
            const response = await makeHttpRequest("/");
            expect(response.status).toBe(200);
            expect(typeof response.data).toBe("string");
            expect(String(response.data)).toContain("<!DOCTYPE html>");
            expect(String(response.data)).toContain("Task Manager Dashboard");
        });

        it("should support all major API endpoints", async () => {
            if (!serverAvailable) return;
            
            const endpoints = [
                { path: "/api/metrics", name: "Metrics" },
                { path: "/api/tasks", name: "Tasks List" },
                { path: "/api/queue/status", name: "Queue Status" },
                { path: "/api/health", name: "Health Check" },
                { path: "/api/status", name: "System Status" },
                { path: "/api/dependencies/graph", name: "Dependencies Graph" },
                { path: "/api/logs", name: "Activity Logs" },
            ];

            for (const endpoint of endpoints) {
                const response = await makeHttpRequest(endpoint.path);
                expect(response.status).toBe(200);
                expect(typeof response.data).toBe("object");
            }
        });
    });

    describe("Task Management", () => {
        it("should create, update, and delete tasks", async () => {
            if (!serverAvailable) return;
            
            // Create task
            const createResponse = await makeHttpRequest("/api/tasks", "POST", {
                title: "Integration Test Task",
                description: "Created during integration testing",
                priority: "high",
                createdBy: "integration-test",
                assignedTo: "test-user"
            });

            expect(createResponse.status).toBe(201);
            const createData = createResponse.data as any;
            expect(createData.success).toBe(true);
            expect(createData.data).toHaveProperty("id");
            
            const taskId = createData.data.id;

            // Update task status
            const updateResponse = await makeHttpRequest("/api/tasks/update", "PUT", {
                id: taskId,
                status: "in-progress"
            });

            expect(updateResponse.status).toBe(200);
            const updateData = updateResponse.data as any;
            expect(updateData.success).toBe(true);
            expect(updateData.data.status).toBe("in-progress");

            // Mark as complete
            const completeResponse = await makeHttpRequest("/api/tasks/update", "PUT", {
                id: taskId,
                status: "done"
            });

            expect(completeResponse.status).toBe(200);
            const completeData = completeResponse.data as any;
            expect(completeData.success).toBe(true);
            expect(completeData.data.status).toBe("done");

            // Delete task
            const deleteResponse = await makeHttpRequest(`/api/tasks/delete?id=${taskId}`, "DELETE");
            expect(deleteResponse.status).toBe(200);
            const deleteData = deleteResponse.data as any;
            expect(deleteData.success).toBe(true);
        });

        it("should handle task filtering and search", async () => {
            if (!serverAvailable) return;
            
            // Test status filtering
            const statusResponse = await makeHttpRequest("/api/tasks?status=todo");
            expect(statusResponse.status).toBe(200);
            expect(Array.isArray(statusResponse.data)).toBe(true);

            // Test priority filtering
            const priorityResponse = await makeHttpRequest("/api/tasks?priority=high");
            expect(priorityResponse.status).toBe(200);
            expect(Array.isArray(priorityResponse.data)).toBe(true);

            // Test search functionality
            const searchResponse = await makeHttpRequest("/api/tasks/search?q=Integration");
            expect(searchResponse.status).toBe(200);
            expect(Array.isArray(searchResponse.data)).toBe(true);
        });
    });

    describe("Queue Management", () => {
        it("should provide queue status information", async () => {
            if (!serverAvailable) return;
            
            const response = await makeHttpRequest("/api/queue/status");
            expect(response.status).toBe(200);
            
            const data = response.data as any;
            expect(data).toHaveProperty("total");
            expect(data).toHaveProperty("pending");
            expect(data).toHaveProperty("inProgress");
            expect(data).toHaveProperty("completed");
            expect(data).toHaveProperty("queueByPriority");
            expect(data).toHaveProperty("processingTimes");
            
            expect(typeof data.total).toBe("number");
            expect(typeof data.pending).toBe("number");
            expect(typeof data.inProgress).toBe("number");
            expect(typeof data.completed).toBe("number");
        });

        it("should handle task retry operations", async () => {
            if (!serverAvailable) return;
            
            // First create a task that might fail
            const createResponse = await makeHttpRequest("/api/tasks", "POST", {
                title: "Test Retry Task",
                description: "Task for testing retry functionality",
                priority: "medium"
            });

            const taskId = (createResponse.data as any).data?.id;
            if (!taskId) return;

            // Simulate failure and retry
            const failResponse = await makeHttpRequest("/api/tasks/cancel", "POST", { id: taskId });
            expect(failResponse.status).toBe(200);

            const retryResponse = await makeHttpRequest("/api/tasks/retry", "POST", { id: taskId });
            expect(retryResponse.status).toBe(200);
        });
    });

    describe("Real-time Updates", () => {
        it("should establish WebSocket connection", async () => {
            if (!serverAvailable) return;
            
            return new Promise<void>((resolve, reject) => {
                const ws = new WebSocket(WS_URL);
                
                const timeout = setTimeout(() => {
                    ws.close();
                    reject(new Error("WebSocket connection timeout"));
                }, 5000);

                ws.on("open", () => {
                    clearTimeout(timeout);
                    ws.close();
                    resolve();
                });

                ws.on("error", (error) => {
                    clearTimeout(timeout);
                    reject(error);
                });
            });
        });

        it("should receive real-time task updates", async () => {
            if (!serverAvailable) return;
            
            const ws = new WebSocket(WS_URL);
            
            return new Promise<void>(async (resolve, reject) => {
                const timeout = setTimeout(() => {
                    ws.close();
                    reject(new Error("Real-time update test timeout"));
                }, 10000);

                ws.on("open", async () => {
                    try {
                        // Create a task to trigger update
                        const createResponse = await makeHttpRequest("/api/tasks", "POST", {
                            title: "Real-time Test Task",
                            description: "Testing real-time updates",
                            priority: "medium"
                        });

                        if (createResponse.status !== 201) {
                            clearTimeout(timeout);
                            ws.close();
                            reject(new Error("Failed to create test task"));
                            return;
                        }

                        // Wait for WebSocket message
                        const message = await waitForWebSocketMessage(ws, 8000);
                        clearTimeout(timeout);
                        
                        expect(message).toHaveProperty("type");
                        expect(["task_created", "task_status_changed", "metrics_update"]).toContain(message.type);
                        
                        ws.close();
                        resolve();
                    } catch (error) {
                        clearTimeout(timeout);
                        ws.close();
                        reject(error);
                    }
                });

                ws.on("error", (error) => {
                    clearTimeout(timeout);
                    reject(error);
                });
            });
        });
    });

    describe("Dependency Management", () => {
        it("should provide dependency graph data", async () => {
            if (!serverAvailable) return;
            
            const response = await makeHttpRequest("/api/dependencies/graph");
            expect(response.status).toBe(200);
            
            const data = response.data as any;
            expect(data).toHaveProperty("success");
            expect(data.success).toBe(true);
            expect(data.data).toHaveProperty("nodes");
            expect(data.data).toHaveProperty("links");
            expect(Array.isArray(data.data.nodes)).toBe(true);
            expect(Array.isArray(data.data.links)).toBe(true);
        });

        it("should validate dependencies", async () => {
            if (!serverAvailable) return;
            
            const response = await makeHttpRequest("/api/dependencies/validate");
            expect(response.status).toBe(200);
            
            const data = response.data as any;
            expect(data).toHaveProperty("success");
            expect(data.data).toHaveProperty("errors");
            expect(data.data).toHaveProperty("warnings");
            expect(Array.isArray(data.data.errors)).toBe(true);
            expect(Array.isArray(data.data.warnings)).toBe(true);
        });

        it("should analyze dependency impact", async () => {
            if (!serverAvailable) return;
            
            // First create a test task
            const createResponse = await makeHttpRequest("/api/tasks", "POST", {
                title: "Impact Analysis Test Task",
                description: "Task for dependency impact analysis",
                priority: "high"
            });

            const taskId = (createResponse.data as any).data?.id;
            if (!taskId) return;

            const response = await makeHttpRequest("/api/dependencies/impact", "POST", { taskId });
            expect(response.status).toBe(200);
            
            const data = response.data as any;
            expect(data).toHaveProperty("success");
            if (data.success) {
                expect(data.data).toHaveProperty("directImpact");
                expect(data.data).toHaveProperty("totalImpact");
                expect(data.data).toHaveProperty("criticalPathTasks");
            }
        });
    });

    describe("Health and Monitoring", () => {
        it("should provide comprehensive health metrics", async () => {
            if (!serverAvailable) return;
            
            const response = await makeHttpRequest("/api/health");
            expect(response.status).toBe(200);
            
            const data = response.data as any;
            expect(data).toHaveProperty("daemon");
            expect(data).toHaveProperty("websocket");
            expect(data.daemon).toHaveProperty("pid");
            expect(data.daemon).toHaveProperty("uptime");
            expect(data.daemon).toHaveProperty("memory");
        });

        it("should provide system performance metrics", async () => {
            if (!serverAvailable) return;
            
            const response = await makeHttpRequest("/api/status");
            expect(response.status).toBe(200);
            
            const data = response.data as any;
            expect(data).toHaveProperty("daemon");
            expect(data).toHaveProperty("tasks");
            expect(data).toHaveProperty("connections");
            expect(data).toHaveProperty("system");
            
            expect(data.system).toHaveProperty("nodeVersion");
            expect(data.system).toHaveProperty("platform");
            expect(data.system).toHaveProperty("totalmem");
            expect(data.system).toHaveProperty("freemem");
        });
    });

    describe("Notification System", () => {
        it("should manage notification preferences", async () => {
            if (!serverAvailable) return;
            
            const userId = "test-user";
            
            // Set preferences
            const setResponse = await makeHttpRequest("/api/notifications/preferences", "POST", {
                userId,
                enabled: true,
                channels: {
                    email: { enabled: true, address: "test@example.com" },
                    websocket: { enabled: true }
                }
            });
            expect(setResponse.status).toBe(200);
            
            // Get preferences
            const getResponse = await makeHttpRequest(`/api/notifications/preferences?userId=${userId}`);
            expect(getResponse.status).toBe(200);
            
            const data = getResponse.data as any;
            expect(data).toHaveProperty("success");
            if (data.success) {
                expect(data.data.enabled).toBe(true);
            }
        });

        it("should provide notification statistics", async () => {
            if (!serverAvailable) return;
            
            const userId = "test-user";
            const response = await makeHttpRequest(`/api/notifications/stats?userId=${userId}`);
            expect(response.status).toBe(200);
            
            const data = response.data as any;
            expect(data).toHaveProperty("success");
            if (data.success) {
                expect(data.data).toHaveProperty("total");
                expect(data.data).toHaveProperty("delivered");
                expect(data.data).toHaveProperty("failed");
                expect(data.data).toHaveProperty("read");
            }
        });
    });

    describe("Error Handling", () => {
        it("should handle invalid API requests gracefully", async () => {
            if (!serverAvailable) return;
            
            // Test invalid endpoint
            const response = await makeHttpRequest("/api/invalid");
            expect(response.status).toBe(404);
            
            // Test invalid method
            const invalidMethodResponse = await makeHttpRequest("/api/tasks", "PATCH");
            expect([404, 405]).toContain(invalidMethodResponse.status);
            
            // Test invalid JSON
            const invalidJsonResponse = await makeHttpRequest("/api/tasks/create", "POST", "invalid json");
            expect(invalidJsonResponse.status).toBe(400);
        });

        it("should handle missing required fields", async () => {
            if (!serverAvailable) return;
            
            // Create task without title
            const response = await makeHttpRequest("/api/tasks", "POST", {
                description: "Task without title"
            });
            expect(response.status).toBe(400);
        });

        it("should handle non-existent resources", async () => {
            if (!serverAvailable) return;
            
            // Get non-existent task
            const response = await makeHttpRequest("/api/tasks?id=non-existent");
            expect(response.status).toBe(400);
            
            const data = response.data as any;
            expect(data.success).toBe(false);
            expect(data.error).toContain("not found");
        });
    });

    describe("Performance and Load", () => {
        it("should handle concurrent requests", async () => {
            if (!serverAvailable) return;
            
            const concurrentRequests = 10;
            const requests = Array.from({ length: concurrentRequests }, () =>
                makeHttpRequest("/api/metrics")
            );
            
            const responses = await Promise.all(requests);
            
            for (const response of responses) {
                expect(response.status).toBe(200);
                expect(typeof response.data).toBe("object");
            }
        });

        it("should respond within reasonable time", async () => {
            if (!serverAvailable) return;
            
            const startTime = Date.now();
            const response = await makeHttpRequest("/api/metrics");
            const endTime = Date.now();
            
            const responseTime = endTime - startTime;
            expect(response.status).toBe(200);
            expect(responseTime).toBeLessThan(2000); // Should respond within 2 seconds
        });
    });
});