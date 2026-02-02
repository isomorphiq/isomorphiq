import { DashboardServer } from "./dashboard.ts";
import type { TaskServiceApi } from "@isomorphiq/tasks";
import { WebSocketManager } from "@isomorphiq/realtime";
import { DashboardAnalyticsService } from "../services/dashboard-analytics-service.ts";

describe("Task Dashboard", () => {
    let dashboardServer: DashboardServer;
    let mockTaskManager: jest.Mocked<Pick<TaskServiceApi, "getAllTasks">>;
    let mockWebSocketManager: jest.Mocked<WebSocketManager>;
    let mockAnalyticsService: jest.Mocked<DashboardAnalyticsService>;
    let environmentServices: Map<string, { environment: string; taskManager: Pick<TaskServiceApi, "getAllTasks">; webSocketManager: WebSocketManager; analyticsService: DashboardAnalyticsService }>;
    const environment = "test";

    beforeEach(() => {
        mockTaskManager = {
            getAllTasks: jest.fn(),
        } as any;

        mockWebSocketManager = {
            start: jest.fn(),
            stop: jest.fn(),
            broadcastTaskCreated: jest.fn(),
            broadcastTaskStatusChanged: jest.fn(),
            broadcastTaskPriorityChanged: jest.fn(),
            broadcastTaskDeleted: jest.fn(),
            broadcastTasksList: jest.fn(),
        } as any;

        mockAnalyticsService = {
            initialize: jest.fn(),
            handleAnalyticsRequest: jest.fn(),
        } as any;

        environmentServices = new Map([
            [
                environment,
                {
                    environment,
                    taskManager: mockTaskManager,
                    webSocketManager: mockWebSocketManager,
                    analyticsService: mockAnalyticsService,
                },
            ],
        ]);

        dashboardServer = new DashboardServer(environmentServices, () => environment, environment);
    });

    describe("Dashboard Initialization", () => {
        it("should initialize with required dependencies", () => {
            expect(dashboardServer).toBeDefined();
            expect(dashboardServer["environmentServices"]).toBe(environmentServices);
        });

        it("should initialize WebSocket server", async () => {
            const mockHttpServer = {
                on: jest.fn(),
            } as any;

            await dashboardServer.initializeWebSocketServer(mockHttpServer);
            
            expect(mockHttpServer.on).toHaveBeenCalled();
        });
    });

    describe("Metrics API", () => {
        it("should return comprehensive dashboard metrics", async () => {
            const mockTasks = [
                {
                    id: "task-1",
                    title: "Test Task",
                    description: "Test Description",
                    status: "todo",
                    priority: "high",
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    createdBy: "user1",
                    assignedTo: "user2"
                }
            ];

            mockTaskManager.getAllTasks.mockResolvedValue({ success: true, data: mockTasks });

            const mockReq = {
                url: "/api/metrics",
                method: "GET"
            } as any;

            const mockRes = {
                writeHead: jest.fn(),
                end: jest.fn()
            } as any;

            await dashboardServer.handleRequest(mockReq, mockRes);

            expect(mockRes.writeHead).toHaveBeenCalledWith(200, {
                "Content-Type": "application/json"
            });

            const responseData = JSON.parse(mockRes.end.mock.calls[0][0]);
            expect(responseData).toHaveProperty("tasks");
            expect(responseData).toHaveProperty("daemon");
            expect(responseData).toHaveProperty("health");
            expect(responseData).toHaveProperty("system");
        });
    });

    describe("Daemon Control API", () => {
        it("should handle pause daemon command", async () => {
            const mockTcpClient = {
                sendCommand: jest.fn().mockResolvedValue({
                    success: true,
                    data: { message: "Daemon paused successfully" }
                })
            };

            dashboardServer["tcpClient"] = mockTcpClient;

            const mockReq = {
                url: "/api/daemon/pause",
                method: "POST"
            } as any;

            const mockRes = {
                writeHead: jest.fn(),
                end: jest.fn()
            } as any;

            await dashboardServer.handleRequest(mockReq, mockRes);

            expect(mockTcpClient.sendCommand).toHaveBeenCalledWith("pause_daemon", {});
            expect(mockRes.writeHead).toHaveBeenCalledWith(200, {
                "Content-Type": "application/json"
            });
        });

        it("should handle resume daemon command", async () => {
            const mockTcpClient = {
                sendCommand: jest.fn().mockResolvedValue({
                    success: true,
                    data: { message: "Daemon resumed successfully" }
                })
            };

            dashboardServer["tcpClient"] = mockTcpClient;

            const mockReq = {
                url: "/api/daemon/resume",
                method: "POST"
            } as any;

            const mockRes = {
                writeHead: jest.fn(),
                end: jest.fn()
            } as any;

            await dashboardServer.handleRequest(mockReq, mockRes);

            expect(mockTcpClient.sendCommand).toHaveBeenCalledWith("resume_daemon", {});
            expect(mockRes.writeHead).toHaveBeenCalledWith(200, {
                "Content-Type": "application/json"
            });
        });

        it("should handle restart daemon command", async () => {
            const mockTcpClient = {
                sendCommand: jest.fn().mockResolvedValue({
                    success: true,
                    data: { message: "Daemon restart initiated" }
                })
            };

            dashboardServer["tcpClient"] = mockTcpClient;

            const mockReq = {
                url: "/api/daemon/restart",
                method: "POST"
            } as any;

            const mockRes = {
                writeHead: jest.fn(),
                end: jest.fn()
            } as any;

            await dashboardServer.handleRequest(mockReq, mockRes);

            expect(mockTcpClient.sendCommand).toHaveBeenCalledWith("restart", {});
            expect(mockRes.writeHead).toHaveBeenCalledWith(200, {
                "Content-Type": "application/json"
            });
        });
    });

    describe("Task Management API", () => {
        it("should create new tasks", async () => {
            const mockTaskData = {
                title: "New Test Task",
                description: "Task Description",
                priority: "high",
                assignedTo: "user1"
            };

            const mockTcpClient = {
                sendCommand: jest.fn().mockResolvedValue({
                    success: true,
                    data: {
                        id: "new-task-id",
                        ...mockTaskData,
                        status: "todo",
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString()
                    }
                })
            };

            dashboardServer["tcpClient"] = mockTcpClient;

            const mockReq = {
                url: "/api/tasks",
                method: "POST"
            } as any;

            const mockRes = {
                writeHead: jest.fn(),
                end: jest.fn()
            } as any;

            await dashboardServer.handleRequest(mockReq, mockRes);

            expect(mockTcpClient.sendCommand).toHaveBeenCalledWith("create_task", mockTaskData);
            expect(mockRes.writeHead).toHaveBeenCalledWith(201, {
                "Content-Type": "application/json"
            });
        });

        it("should update task status", async () => {
            const mockTcpClient = {
                sendCommand: jest.fn().mockResolvedValue({
                    success: true,
                    data: {
                        id: "task-1",
                        status: "in-progress",
                        updatedAt: new Date().toISOString()
                    }
                })
            };

            dashboardServer["tcpClient"] = mockTcpClient;

            const mockReq = {
                url: "/api/tasks/update",
                method: "PUT"
            } as any;

            const mockRes = {
                writeHead: jest.fn(),
                end: jest.fn()
            } as any;

            await dashboardServer.handleRequest(mockReq, mockRes);

            expect(mockTcpClient.sendCommand).toHaveBeenCalledWith("update_task_status", {
                id: "task-1",
                status: "in-progress"
            });
            expect(mockRes.writeHead).toHaveBeenCalledWith(200, {
                "Content-Type": "application/json"
            });
        });
    });

    describe("Real-time Updates", () => {
        it("should broadcast task creation events", async () => {
            const mockTask = {
                id: "task-1",
                title: "Test Task",
                status: "todo",
                priority: "high"
            };

            const mockWebSocket = {
                readyState: 1, // WebSocket.OPEN
                send: jest.fn()
            };

            // Simulate WebSocket connection
            dashboardServer["activeConnections"] = new Set([mockWebSocket]);

            // Trigger task creation event
            await dashboardServer["setupTaskEventForwarding"]();

            // Simulate task creation event from WebSocket manager
            const eventCallback = mockWebSocketManager.broadcastTaskCreated.mock.calls[0]?.[0];
            if (eventCallback) {
                eventCallback(mockTask);
            }

            expect(mockWebSocket.send).toHaveBeenCalledWith(
                expect.stringContaining('"task_created"')
            );
        });

        it("should broadcast task status changes", async () => {
            const mockTask = {
                id: "task-1",
                title: "Test Task",
                status: "in-progress",
                priority: "high"
            };

            const mockWebSocket = {
                readyState: 1,
                send: jest.fn()
            };

            dashboardServer["activeConnections"] = new Set([mockWebSocket]);
            await dashboardServer["setupTaskEventForwarding"]();

            const eventCallback = mockWebSocketManager.broadcastTaskStatusChanged.mock.calls[0]?.[3];
            if (eventCallback) {
                eventCallback("task-1", "todo", "in-progress", mockTask);
            }

            expect(mockWebSocket.send).toHaveBeenCalledWith(
                expect.stringContaining('"task_status_changed"')
            );
        });
    });

    describe("Analytics Integration", () => {
        it("should provide analytics endpoints", async () => {
            const mockAnalyticsData = {
                success: true,
                data: {
                    overview: {
                        totalTasks: 100,
                        completedTasks: 80,
                        completionRate: 80
                    },
                    performance: {
                        averageProcessingTime: 45,
                        overdueTasks: 5
                    },
                    timestamp: new Date().toISOString()
                }
            };

            mockAnalyticsService.handleAnalyticsRequest.mockResolvedValue(mockAnalyticsData);

            const mockReq = {
                url: "/api/analytics/dashboard-summary",
                method: "GET"
            } as any;

            const mockRes = {
                writeHead: jest.fn(),
                end: jest.fn()
            } as any;

            await dashboardServer.handleRequest(mockReq, mockRes);

            expect(mockAnalyticsService.handleAnalyticsRequest).toHaveBeenCalledWith(mockReq, mockRes);
        });
    });
});
