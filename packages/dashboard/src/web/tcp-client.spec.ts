import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert";
import { DaemonTcpClient, type Task } from "./tcp-client.ts";

describe("DaemonTcpClient", () => {
    let tcpClient: DaemonTcpClient;

    beforeEach(() => {
        tcpClient = new DaemonTcpClient(3001, "localhost");
    });

    describe("Constructor", () => {
        it("should create client with default parameters", () => {
            const client = new DaemonTcpClient();
            assert.strictEqual(client["port"], 3001);
            assert.strictEqual(client["host"], "localhost");
        });

        it("should create client with custom parameters", () => {
            const client = new DaemonTcpClient(3002, "example.com");
            assert.strictEqual(client["port"], 3002);
            assert.strictEqual(client["host"], "example.com");
        });
    });

    describe("Task Management Methods", () => {
        it("should have all required task management methods", () => {
            const requiredMethods = [
                "createTask",
                "listTasks",
                "getTask",
                "getTaskStatus",
                "listTasksFiltered",
                "updateTaskStatus",
                "updateTaskPriority",
                "deleteTask",
                "subscribeToTaskNotifications",
                "createMonitoringSession",
                "getFilteredTasks",
                "subscribeToTaskUpdates",
            ];

            requiredMethods.forEach(method => {
                assert.ok(typeof tcpClient[method] === "function", `Missing method: ${method}`);
            });
        });
    });

    describe("Task Creation", () => {
        it("should create task with valid data", async () => {
            const taskData = {
                title: "Test Task",
                description: "Test task description",
                priority: "high",
                createdBy: "test-user",
                assignedTo: "developer",
            };

            // Mock the sendCommand method
            const mockResult = {
                success: true,
                data: {
                    id: "task-123",
                    title: taskData.title,
                    description: taskData.description,
                    status: "todo",
                    priority: taskData.priority,
                    createdAt: "2024-01-01T00:00:00.000Z",
                    updatedAt: "2024-01-01T00:00:00.000Z",
                } as Task,
            };

            const mockSendCommand = mock.fn(() => Promise.resolve(mockResult));
            tcpClient["sendCommand"] = mockSendCommand;

            const result = await tcpClient.createTask(taskData);

            assert.ok(mockSendCommand.mock.calls.length > 0);
            assert.strictEqual(mockSendCommand.mock.calls[0].arguments[0], "create_task");
            assert.deepEqual(mockSendCommand.mock.calls[0].arguments[1], taskData);
            assert.ok(result.success);
            assert.strictEqual(result.data.title, taskData.title);
            assert.strictEqual(result.data.priority, taskData.priority);
        });

        it("should handle task creation errors", async () => {
            const taskData = {
                title: "Test Task",
                description: "Test task description",
            };

            const mockResult = {
                success: false,
                error: new Error("Failed to create task"),
            };

            const mockSendCommand = mock.fn(() => Promise.resolve(mockResult));
            tcpClient["sendCommand"] = mockSendCommand;

            const result = await tcpClient.createTask(taskData);

            assert.ok(result.success === false);
            assert.ok(result.error);
        });
    });

    describe("Task Listing", () => {
        it("should list all tasks", async () => {
            const mockTasks: Task[] = [
                {
                    id: "task-1",
                    title: "Task 1",
                    description: "Description 1",
                    status: "todo",
                    priority: "high",
                    createdAt: "2024-01-01T00:00:00.000Z",
                    updatedAt: "2024-01-01T00:00:00.000Z",
                },
                {
                    id: "task-2",
                    title: "Task 2",
                    description: "Description 2",
                    status: "done",
                    priority: "medium",
                    createdAt: "2024-01-01T00:00:00.000Z",
                    updatedAt: "2024-01-01T00:00:00.000Z",
                },
            ];

            const mockResult = {
                success: true,
                data: mockTasks,
            };

            const mockSendCommand = mock.fn(() => Promise.resolve(mockResult));
            tcpClient["sendCommand"] = mockSendCommand;

            const result = await tcpClient.listTasks();

            assert.ok(mockSendCommand.mock.calls.length > 0);
            assert.strictEqual(mockSendCommand.mock.calls[0].arguments[0], "list_tasks");
            assert.ok(result.success);
            assert.strictEqual(result.data.length, 2);
        });

        it("should list tasks with filters", async () => {
            const filters = {
                status: "todo",
                priority: "high",
                limit: 10,
            };

            const mockResult = {
                success: true,
                data: [] as Task[],
            };

            const mockSendCommand = mock.fn(() => Promise.resolve(mockResult));
            tcpClient["sendCommand"] = mockSendCommand;

            const result = await tcpClient.listTasksFiltered(filters);

            assert.ok(mockSendCommand.mock.calls.length > 0);
            assert.strictEqual(mockSendCommand.mock.calls[0].arguments[0], "list_tasks_filtered");
            assert.deepEqual(mockSendCommand.mock.calls[0].arguments[1], { filters });
            assert.ok(result.success);
        });
    });

    describe("Task Updates", () => {
        it("should update task status", async () => {
            const taskId = "task-123";
            const newStatus = "in-progress";

            const updatedTask: Task = {
                id: taskId,
                title: "Test Task",
                description: "Test description",
                status: newStatus,
                priority: "high",
                createdAt: "2024-01-01T00:00:00.000Z",
                updatedAt: "2024-01-01T00:00:00.000Z",
            };

            const mockResult = {
                success: true,
                data: updatedTask,
            };

            const mockSendCommand = mock.fn(() => Promise.resolve(mockResult));
            tcpClient["sendCommand"] = mockSendCommand;

            const result = await tcpClient.updateTaskStatus(taskId, newStatus);

            assert.ok(mockSendCommand.mock.calls.length > 0);
            assert.strictEqual(mockSendCommand.mock.calls[0].arguments[0], "update_task_status");
            assert.deepEqual(mockSendCommand.mock.calls[0].arguments[1], { id: taskId, status: newStatus });
            assert.ok(result.success);
            assert.strictEqual(result.data.status, newStatus);
        });

        it("should update task priority", async () => {
            const taskId = "task-123";
            const newPriority = "low";

            const updatedTask: Task = {
                id: taskId,
                title: "Test Task",
                description: "Test description",
                status: "todo",
                priority: newPriority,
                createdAt: "2024-01-01T00:00:00.000Z",
                updatedAt: "2024-01-01T00:00:00.000Z",
            };

            const mockResult = {
                success: true,
                data: updatedTask,
            };

            const mockSendCommand = mock.fn(() => Promise.resolve(mockResult));
            tcpClient["sendCommand"] = mockSendCommand;

            const result = await tcpClient.updateTaskPriority(taskId, newPriority);

            assert.ok(mockSendCommand.mock.calls.length > 0);
            assert.strictEqual(mockSendCommand.mock.calls[0].arguments[0], "update_task_priority");
            assert.deepEqual(mockSendCommand.mock.calls[0].arguments[1], { id: taskId, priority: newPriority });
            assert.ok(result.success);
            assert.strictEqual(result.data.priority, newPriority);
        });
    });

    describe("Task Deletion", () => {
        it("should delete task", async () => {
            const taskId = "task-123";

            const mockResult = {
                success: true,
                data: true,
            };

            const mockSendCommand = mock.fn(() => Promise.resolve(mockResult));
            tcpClient["sendCommand"] = mockSendCommand;

            const result = await tcpClient.deleteTask(taskId);

            assert.ok(mockSendCommand.mock.calls.length > 0);
            assert.strictEqual(mockSendCommand.mock.calls[0].arguments[0], "delete_task");
            assert.deepEqual(mockSendCommand.mock.calls[0].arguments[1], { id: taskId });
            assert.ok(result.success);
            assert.strictEqual(result.data, true);
        });
    });

    describe("Task Monitoring", () => {
        it("should create monitoring session", async () => {
            const filters = {
                status: "todo",
                priority: "high",
            };

            const mockSession = {
                id: "session-123",
                filters: filters,
                createdAt: "2024-01-01T00:00:00.000Z",
                lastActivity: "2024-01-01T00:00:00.000Z",
                active: true,
            };

            const mockResult = {
                success: true,
                data: mockSession,
            };

            const mockSendCommand = mock.fn(() => Promise.resolve(mockResult));
            tcpClient["sendCommand"] = mockSendCommand;

            const result = await tcpClient.createMonitoringSession(filters);

            assert.ok(mockSendCommand.mock.calls.length > 0);
            assert.strictEqual(mockSendCommand.mock.calls[0].arguments[0], "create_monitoring_session");
            assert.deepEqual(mockSendCommand.mock.calls[0].arguments[1], { filters });
            assert.ok(result.success);
            assert.strictEqual(result.data.id, mockSession.id);
        });

        it("should subscribe to task updates", async () => {
            const sessionId = "session-123";
            const taskIds = ["task-1", "task-2"];

            const mockResult = {
                success: true,
                data: true,
            };

            const mockSendCommand = mock.fn(() => Promise.resolve(mockResult));
            tcpClient["sendCommand"] = mockSendCommand;

            const result = await tcpClient.subscribeToTaskUpdates(sessionId, taskIds);

            assert.ok(mockSendCommand.mock.calls.length > 0);
            assert.strictEqual(mockSendCommand.mock.calls[0].arguments[0], "subscribe_to_task_updates");
            assert.deepEqual(mockSendCommand.mock.calls[0].arguments[1], { sessionId, taskIds });
            assert.ok(result.success);
        });
    });

    describe("Connection Management", () => {
        it("should check connection status", async () => {
            // Mock successful connection
            const mockCreateConnection = mock.fn((options, callback) => {
                // Simulate successful connection
                const mockSocket = {
                    end: mock.fn(),
                    on: mock.fn(),
                    destroy: mock.fn(),
                };
                queueMicrotask(() => callback());
                return mockSocket;
            });

            const originalConnect = tcpClient["connect"];
            tcpClient["connect"] = mockCreateConnection;

            try {
                const isConnected = await tcpClient.checkConnection();
                assert.ok(isConnected);
            } finally {
                tcpClient["connect"] = originalConnect;
            }
        });

        it("should handle connection errors", async () => {
            // Mock failed connection
            const mockCreateConnection = mock.fn((options, callback) => {
                const mockSocket = {
                    end: mock.fn(),
                    on: mock.fn((event, handler) => {
                        if (event === "error") {
                            handler(new Error("Connection refused"));
                        }
                    }),
                    destroy: mock.fn(),
                };
                return mockSocket;
            });

            const originalConnect = tcpClient["connect"];
            tcpClient["connect"] = mockCreateConnection;

            try {
                const isConnected = await tcpClient.checkConnection();
                assert.strictEqual(isConnected, false);
            } finally {
                tcpClient["connect"] = originalConnect;
            }
        });
    });

    describe("WebSocket Integration", () => {
        it("should manage WebSocket connection state", () => {
            assert.strictEqual(tcpClient.isWebSocketConnected(), false);
            assert.strictEqual(tcpClient.getWebSocketConnection(), null);
        });

        it("should disconnect WebSocket properly", () => {
            const mockWs = {
                readyState: 1, // OPEN
                close: mock.fn(),
            };

            tcpClient["wsConnection"] = mockWs;
            assert.strictEqual(tcpClient.isWebSocketConnected(), true);

            tcpClient.disconnectWebSocket();
            assert.ok(mockWs.close.mock.calls.length > 0);
            assert.strictEqual(tcpClient.isWebSocketConnected(), false);
        });
    });

    describe("Error Handling", () => {
        it("should handle malformed responses", async () => {
            const mockCreateConnection = mock.fn((options, callback) => {
                const mockSocket = {
                    write: mock.fn(),
                    end: mock.fn(),
                    on: mock.fn((event, handler) => {
                        if (event === "data") {
                            handler("invalid json response");
                        }
                    }),
                    destroy: mock.fn(),
                };
                queueMicrotask(() => callback());
                return mockSocket;
            });

            const originalConnect = tcpClient["connect"];
            tcpClient["connect"] = mockCreateConnection;

            try {
                await tcpClient.listTasks();
                assert.fail("Should have thrown an error");
            } catch (error) {
                assert.ok(error instanceof Error);
            } finally {
                tcpClient["connect"] = originalConnect;
            }
        });
    });
});
