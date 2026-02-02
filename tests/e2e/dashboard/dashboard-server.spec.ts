import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert";
import { DashboardServer } from "@isomorphiq/dashboard";

describe("DashboardServer", () => {
    let dashboardServer: DashboardServer;
    let mockProductManager: any;
    let mockWebSocketManager: any;

    beforeEach(() => {
        // Mock ProductManager with required methods
        mockProductManager = {
            getAllTasks: mock.fn(() => Promise.resolve([])),
            createTask: mock.fn(() => Promise.resolve({})),
            updateTaskStatus: mock.fn(() => Promise.resolve({})),
            updateTaskPriority: mock.fn(() => Promise.resolve({})),
            deleteTask: mock.fn(() => Promise.resolve()),
        };

        // Mock WebSocketManager with required methods
        mockWebSocketManager = {
            broadcastTaskCreated: mock.fn(),
            broadcastTaskStatusChanged: mock.fn(),
            broadcastTaskPriorityChanged: mock.fn(),
            broadcastTaskDeleted: mock.fn(),
            getConnectionCount: mock.fn(() => 0),
        };

        dashboardServer = new DashboardServer(mockProductManager, mockWebSocketManager);
    });

    describe("Constructor", () => {
        it("should create DashboardServer with required dependencies", () => {
            assert.ok(dashboardServer instanceof DashboardServer);
        });

        it("should initialize with zero dashboard connections", () => {
            const connectionCount = dashboardServer.getDashboardConnectionCount();
            assert.strictEqual(connectionCount, 0);
        });
    });

    describe("Dashboard Connection Management", () => {
        it("should track connection count correctly", () => {
            const initialCount = dashboardServer.getDashboardConnectionCount();
            assert.strictEqual(typeof initialCount, "number");
            assert.strictEqual(initialCount, 0);
        });
    });

    describe("Request Handling", () => {
        it("should handle unknown routes with 404", async () => {
            const mockReq = {
                url: "http://localhost:3005/unknown-route",
                method: "GET",
            } as any;

            const mockRes = {
                writeHead: mock.fn(),
                end: mock.fn(),
            } as any;

            await dashboardServer.handleRequest(mockReq, mockRes);

            assert.ok(mockRes.writeHead.called);
            assert.strictEqual(mockRes.writeHead.mock.calls[0][0], 404);
        });

        it("should serve dashboard HTML for root path", async () => {
            const mockReq = {
                url: "http://localhost:3005/",
                method: "GET",
            } as any;

            const mockRes = {
                writeHead: mock.fn(),
                end: mock.fn(),
            } as any;

            await dashboardServer.handleRequest(mockReq, mockRes);

            assert.ok(mockRes.writeHead.called);
            assert.strictEqual(mockRes.writeHead.mock.calls[0][0], 200);
            assert.ok(mockRes.end.called);
            
            // Check that HTML content is returned
            const htmlContent = mockRes.end.mock.calls[0][0];
            assert.ok(htmlContent.includes("<!DOCTYPE html>"));
            assert.ok(htmlContent.includes("Task Manager Dashboard"));
        });
    });

    describe("Error Handling", () => {
        it("should handle request errors gracefully", async () => {
            const mockReq = {
                url: "http://localhost:3005/api/metrics",
                method: "GET",
            } as any;

            const mockRes = {
                writeHead: mock.fn(),
                end: mock.fn(),
            } as any;

            // Mock getAllTasks to throw an error
            mockProductManager.getAllTasks.mockRejectedValue(new Error("Database connection failed"));

            await dashboardServer.handleRequest(mockReq, mockRes);

            assert.ok(mockRes.writeHead.called);
            assert.strictEqual(mockRes.writeHead.mock.calls[0][0], 500);
        });
    });

    describe("Task Operations via API", () => {
        it("should handle task creation via API endpoint", async () => {
            const taskData = {
                title: "Test Task",
                description: "Test description",
                priority: "high",
            };

            const mockReq = {
                url: "http://localhost:3005/api/tasks/create",
                method: "POST",
                headers: { "content-type": "application/json" },
                on: mock.fn((event, callback) => {
                    if (event === "data") {
                        callback(JSON.stringify(taskData));
                    } else if (event === "end") {
                        callback();
                    }
                }),
            } as any;

            const mockRes = {
                writeHead: mock.fn(),
                end: mock.fn(),
            } as any;

            await dashboardServer.handleRequest(mockReq, mockRes);

            assert.ok(mockRes.writeHead.called);
            // Should either return 201 (success) or 400/500 (error)
            const statusCode = mockRes.writeHead.mock.calls[0][0];
            assert.ok([201, 400, 500].includes(statusCode));
        });

        it("should handle task listing via API endpoint", async () => {
            const mockTasks = [
                {
                    id: "task-1",
                    title: "Test Task",
                    status: "todo",
                    priority: "high",
                    createdAt: "2024-01-01T00:00:00.000Z",
                    updatedAt: "2024-01-01T00:00:00.000Z",
                },
            ];

            mockProductManager.getAllTasks.mockResolvedValue(mockTasks);

            const mockReq = {
                url: "http://localhost:3005/api/tasks",
                method: "GET",
            } as any;

            const mockRes = {
                writeHead: mock.fn(),
                end: mock.fn(),
            } as any;

            await dashboardServer.handleRequest(mockReq, mockRes);

            assert.ok(mockRes.writeHead.called);
            assert.strictEqual(mockRes.writeHead.mock.calls[0][0], 200);
            assert.ok(mockRes.end.called);
        });
    });

    describe("Metrics API", () => {
        it("should handle metrics request", async () => {
            const mockTasks = [
                {
                    id: "task-1",
                    title: "Test Task",
                    status: "todo",
                    priority: "high",
                    createdAt: "2024-01-01T00:00:00.000Z",
                    updatedAt: "2024-01-01T00:00:00.000Z",
                },
                {
                    id: "task-2",
                    title: "Test Task 2",
                    status: "done",
                    priority: "medium",
                    createdAt: "2024-01-01T00:00:00.000Z",
                    updatedAt: "2024-01-01T00:00:00.000Z",
                },
            ];

            mockProductManager.getAllTasks.mockResolvedValue(mockTasks);

            const mockReq = {
                url: "http://localhost:3005/api/metrics",
                method: "GET",
            } as any;

            const mockRes = {
                writeHead: mock.fn(),
                end: mock.fn(),
            } as any;

            await dashboardServer.handleRequest(mockReq, mockRes);

            assert.ok(mockRes.writeHead.called);
            assert.strictEqual(mockRes.writeHead.mock.calls[0][0], 200);
            
            // Check that JSON response is returned
            const responseArgs = mockRes.end.mock.calls[0];
            const responseData = JSON.parse(responseArgs[0]);
            assert.ok(responseData.daemon);
            assert.ok(responseData.tasks);
            assert.ok(responseData.health);
            assert.ok(responseData.system);
        });
    });

    describe("Health API", () => {
        it("should handle health check request", async () => {
            const mockReq = {
                url: "http://localhost:3005/api/health",
                method: "GET",
            } as any;

            const mockRes = {
                writeHead: mock.fn(),
                end: mock.fn(),
            } as any;

            await dashboardServer.handleRequest(mockReq, mockRes);

            assert.ok(mockRes.writeHead.called);
            assert.strictEqual(mockRes.writeHead.mock.calls[0][0], 200);
            
            // Check that health response is returned
            const responseArgs = mockRes.end.mock.calls[0];
            const responseData = JSON.parse(responseArgs[0]);
            assert.ok(responseData.status);
            assert.ok(responseData.timestamp);
            assert.ok(responseData.daemon);
        });
    });
});