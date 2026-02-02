import "../../../../tests/test-utils/env-fetch.ts";
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DashboardServer } from "./dashboard.ts";
import { WebSocketManager } from "@isomorphiq/realtime";
import type { TaskServiceApi } from "@isomorphiq/tasks";
import { DashboardAnalyticsService } from "../services/dashboard-analytics-service.ts";
import { createServer, type Server } from "node:http";
import { WebSocket } from "ws";

const canListen = await canListenOnPort();

const expect = (actual: any) => ({
	toBe: (expected: any) => {
		assert.strictEqual(actual, expected);
	},
	toContain: (expected: any) => {
		assert.ok(actual.includes(expected));
	},
	toHaveProperty: (property: string) => {
		assert.ok(Object.prototype.hasOwnProperty.call(actual, property));
	},
	toHaveLength: (length: number) => {
		assert.strictEqual(actual.length, length);
	},
	toEqual: (expected: any) => {
		assert.deepStrictEqual(actual, expected);
	},
	toBeLessThan: (expected: number) => {
		assert.ok(actual < expected);
	},
	toBeGreaterThan: (expected: number) => {
		assert.ok(actual > expected);
	},
	toBeInstanceOf: (ctor: new (...args: any[]) => any) => {
		assert.ok(actual instanceof ctor);
	},
	not: {
		toContain: (expected: any) => {
			assert.ok(!actual.includes(expected));
		},
	},
});

describe("Dashboard Server Tests", { skip: !canListen }, () => {
	let dashboardServer: DashboardServer;
	let taskManager: Pick<TaskServiceApi, "getAllTasks">;
	let webSocketManager: WebSocketManager;
	let analyticsService: DashboardAnalyticsService;
	let httpServer: Server;
	let serverPort: number;

	beforeEach(async () => {
		// Initialize mock dependencies
		taskManager = {
			getAllTasks: async () => ({ success: true, data: [] }),
		};
		webSocketManager = {} as WebSocketManager;
		analyticsService = new DashboardAnalyticsService(taskManager);
		
		// Create dashboard server
		const environment = "test";
		const environmentServices = new Map([
			[
				environment,
				{
					environment,
					taskManager,
					webSocketManager,
					analyticsService,
				},
			],
		]);
		dashboardServer = new DashboardServer(environmentServices, () => environment, environment);
		
		// Find available port for testing
		serverPort = 0;
		httpServer = createServer((req, res) => {
			dashboardServer.handleRequest(req, res).catch(() => {
				res.writeHead(500);
				res.end("Internal Server Error");
			});
		});
		
		// Initialize WebSocket server
		await dashboardServer.initializeWebSocketServer(httpServer);

		await new Promise<void>((resolve, reject) => {
			httpServer.once("error", reject);
			httpServer.listen(serverPort, "127.0.0.1", () => {
				const address = httpServer.address();
				if (address && typeof address === "object") {
					serverPort = address.port;
				}
				resolve();
			});
		});
	});

	afterEach(async () => {
		// Clean up
		if (dashboardServer && dashboardServer["wsServer"]) {
			await new Promise<void>((resolve) => {
				dashboardServer["wsServer"].close(() => resolve());
			});
		}
		if (httpServer) {
			await new Promise<void>((resolve) => {
				httpServer.close(() => resolve());
			});
		}
	});

	describe("HTTP API Endpoints", () => {
		it("should serve main dashboard page", async () => {
			const response = await fetch(`http://localhost:${serverPort}/`);
			expect(response.status).toBe(200);
			expect(response.headers.get("content-type")).toContain("text/html");
			const html = await response.text();
			expect(html).toContain("Task Manager Dashboard");
		});

		it("should serve metrics API", async () => {
			// Mock task manager
			taskManager.getAllTasks = async () => ({
				success: true,
				data: [
					{
						id: "test-1",
						title: "Test Task",
						status: "todo",
						priority: "medium",
						createdAt: new Date().toISOString(),
						updatedAt: new Date().toISOString()
					}
				]
			});

			const response = await fetch(`http://localhost:${serverPort}/api/metrics`);
			expect(response.status).toBe(200);
			expect(response.headers.get("content-type")).toBe("application/json");
			
			const metrics = await response.json();
			expect(metrics).toHaveProperty("tasks");
			expect(metrics).toHaveProperty("daemon");
			expect(metrics).toHaveProperty("health");
			expect(metrics).toHaveProperty("system");
		});

		it("should serve tasks API with filtering", async () => {
			// Mock task manager
			taskManager.getAllTasks = async () => ({
				success: true,
				data: [
					{
						id: "test-1",
						title: "High Priority Task",
						status: "todo",
						priority: "high",
						createdAt: new Date().toISOString(),
						updatedAt: new Date().toISOString()
					},
					{
						id: "test-2", 
						title: "Low Priority Task",
						status: "done",
						priority: "low",
						createdAt: new Date().toISOString(),
						updatedAt: new Date().toISOString()
					}
				]
			});

			// Test status filter
			const response = await fetch(`http://localhost:${serverPort}/api/tasks?status=todo`);
			expect(response.status).toBe(200);
			
			const tasks = await response.json();
			expect(tasks).toHaveLength(1);
			expect(tasks[0].status).toBe("todo");
		});

		it("should serve queue status API", async () => {
			// Mock TCP client
			dashboardServer["tcpClient"] = {
				checkConnection: async () => true,
				sendCommand: async (command: string) => {
					if (command === "list_tasks") {
						return {
							success: true,
							data: [
								{ id: "1", status: "todo", priority: "high" },
								{ id: "2", status: "in-progress", priority: "medium" },
								{ id: "3", status: "failed", priority: "low" }
							]
						};
					}
					return { success: false, error: "Unknown command" };
				}
			};

			const response = await fetch(`http://localhost:${serverPort}/api/queue/status`);
			expect(response.status).toBe(200);
			
			const queueStatus = await response.json();
			expect(queueStatus).toHaveProperty("total");
			expect(queueStatus).toHaveProperty("highPriority");
			expect(queueStatus).toHaveProperty("failed");
			expect(queueStatus).toHaveProperty("processingTimes");
		});

		it("should serve activity logs API", async () => {
			// Mock TCP client
			dashboardServer["tcpClient"] = {
				sendCommand: async () => ({
					success: true,
					data: [
						{ id: "1", title: "Task 1", status: "done", updatedAt: new Date().toISOString() },
						{ id: "2", title: "Task 2", status: "failed", updatedAt: new Date().toISOString() }
					]
				})
			};

			const response = await fetch(`http://localhost:${serverPort}/api/logs?limit=10`);
			expect(response.status).toBe(200);
			
			const logs = await response.json();
			expect(Array.isArray(logs)).toBe(true);
			expect(logs).toHaveLength(2);
		});
	});

	describe("Widget Drag-and-Drop Layout", () => {
		it("should include draggable widget containers and IDs", async () => {
            const response = await fetch(`http://localhost:${serverPort}/`);
            expect(response.status).toBe(200);
            const html = await response.text();

            expect(html).toContain("data-widget-container=\"overview-metrics\"");
            expect(html).toContain("data-widget-container=\"queue-metrics\"");
            expect(html).toContain("data-widget-container=\"health-grid\"");
            expect(html).toContain("data-widget-id=\"overview-total\"");
            expect(html).toContain("data-widget-id=\"health-system\"");
        });

        it("should expose drag-and-drop visuals and persistence hooks", async () => {
            const response = await fetch(`http://localhost:${serverPort}/`);
            expect(response.status).toBe(200);
            const html = await response.text();

            expect(html).toContain(".widget-card.dragging");
            expect(html).toContain(".widget-drop-indicator");
            expect(html).toContain(".widget-ghost");
            expect(html).toContain("WIDGET_LAYOUT_STORAGE_KEY");
            expect(html).toContain("localStorage.setItem");
            expect(html).toContain("localStorage.getItem");
        });
    });

    describe("Widget Library", () => {
        it("should include widget library UI and visibility persistence hooks", async () => {
            const response = await fetch(`http://localhost:${serverPort}/`);
            expect(response.status).toBe(200);
            const html = await response.text();

            expect(html).toContain("Widget Library");
            expect(html).toContain("widget-library-list");
            expect(html).toContain("WIDGET_VISIBILITY_STORAGE_KEY");
        });

        it("should include widget library add-to-dashboard controls", async () => {
            const response = await fetch(`http://localhost:${serverPort}/`);
            expect(response.status).toBe(200);
            const html = await response.text();

            expect(html).toContain("addSelectedWidgetsBtn");
            expect(html).toContain("addSelectedWidgetsLabel");
            expect(html).toContain("widget-library-select");
        });

        it("should include widget placement persistence for add-selected widgets", async () => {
            const response = await fetch(`http://localhost:${serverPort}/`);
            expect(response.status).toBe(200);
            const html = await response.text();

            expect(html).toContain("buildWidgetLayoutUpdatesForAddedWidgets");
            expect(html).toContain("sendWidgetLayoutBatch");
            expect(html).toContain("saveWidgetLayoutState");
        });

        it("should include widget layout merge helpers to preserve placement updates", async () => {
            const response = await fetch(`http://localhost:${serverPort}/`);
            expect(response.status).toBe(200);
            const html = await response.text();

            expect(html).toContain("mergeWidgetLayoutUpdates");
            expect(html).toContain("dedupeWidgetLayoutEntries");
        });

        it("should gate add-selected widgets until layout sync is known", async () => {
            const response = await fetch(`http://localhost:${serverPort}/`);
            expect(response.status).toBe(200);
            const html = await response.text();

            expect(html).toContain("widgetLayoutSyncState");
            expect(html).toContain("isWidgetLayoutReady");
            expect(html).toContain("Syncing layout...");
        });

        it("should persist widget library selection and pending add state", async () => {
            const response = await fetch(`http://localhost:${serverPort}/`);
            expect(response.status).toBe(200);
            const html = await response.text();

            expect(html).toContain("WIDGET_LIBRARY_SELECTION_KEY");
            expect(html).toContain("WIDGET_LIBRARY_PENDING_ADD_KEY");
            expect(html).toContain("saveSelectedWidgetIds");
            expect(html).toContain("loadSelectedWidgetIds");
            expect(html).toContain("savePendingAddSelectedWidgets");
            expect(html).toContain("loadPendingAddSelectedWidgets");
        });
    });

    describe("Widget Persistence API", () => {
        it("should persist widget layout updates via HTTP", async () => {
            const response = await fetch(`http://localhost:${serverPort}/api/widgets/layout`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    updates: {
                        "overview-metrics": ["overview-total", "overview-pending"],
                    },
                }),
            });
            expect(response.status).toBe(200);
            const payload = await response.json();
            expect(payload.widgetLayout).toHaveProperty("overview-metrics");
            expect(payload.widgetLayout["overview-metrics"]).toEqual(["overview-total", "overview-pending"]);
        });

        it("should persist widget visibility updates via HTTP", async () => {
            const response = await fetch(`http://localhost:${serverPort}/api/widgets/visibility`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ hiddenWidgetIds: ["overview-total"] }),
            });
            expect(response.status).toBe(200);
            const payload = await response.json();
            expect(payload.hiddenWidgetIds).toEqual(["overview-total"]);
        });
    });

	describe("WebSocket Integration", () => {
		it("should establish WebSocket connection", async () => {
			await new Promise<void>((resolve, reject) => {
				const ws = new WebSocket(`ws://localhost:${serverPort}/dashboard-ws`);
				const timeout = setTimeout(() => {
					ws.terminate();
					reject(new Error("WebSocket connection timeout"));
				}, 2000);
				
				ws.on("open", () => {
					clearTimeout(timeout);
					expect(ws.readyState).toBe(WebSocket.OPEN);
					ws.close();
					resolve();
				});

				ws.on("error", (error) => {
					clearTimeout(timeout);
					ws.terminate();
					reject(error);
				});
			});
		});

        it("should normalize and broadcast widget size updates", async () => {
            await new Promise<void>((resolve, reject) => {
                const ws = new WebSocket(`ws://localhost:${serverPort}/dashboard-ws`);
                const timeout = setTimeout(() => {
                    ws.terminate();
                    reject(new Error("WebSocket message timeout"));
                }, 2000);
                let updateHandled = false;

                ws.on("open", () => {
                    ws.send(JSON.stringify({
                        type: "widget_size_update",
                        data: { widgetId: "overview-total", size: "giant" }
                    }));
                });

                ws.on("message", (data) => {
                    const message = JSON.parse(data.toString());
                    if (message.type === "widget_size_update" && !updateHandled) {
                        updateHandled = true;
                        expect(message.data.updates).toEqual({ "overview-total": "medium" });
                        expect(message.data.widgetSizes).toEqual({ "overview-total": "medium" });
                        clearTimeout(timeout);
                        ws.close();
                        resolve();
                    }
                });

                ws.on("error", (error) => {
                    clearTimeout(timeout);
                    ws.terminate();
                    reject(error);
                });
            });
        });

        it("should return persisted widget sizes on request", async () => {
            await new Promise<void>((resolve, reject) => {
                const ws = new WebSocket(`ws://localhost:${serverPort}/dashboard-ws`);
                const timeout = setTimeout(() => {
                    ws.terminate();
                    reject(new Error("WebSocket message timeout"));
                }, 2000);
                let updateSent = false;

                ws.on("open", () => {
                    ws.send(JSON.stringify({
                        type: "widget_size_update",
                        data: { widgetId: "overview-total", size: "large" }
                    }));
                    updateSent = true;
                });

                ws.on("message", (data) => {
                    const message = JSON.parse(data.toString());
                    if (message.type === "widget_size_update" && updateSent) {
                        ws.send(JSON.stringify({ type: "get_widget_sizes" }));
                        return;
                    }
                    if (message.type === "widget_size_state") {
                        expect(message.data.widgetSizes).toEqual({ "overview-total": "large" });
                        clearTimeout(timeout);
                        ws.close();
                        resolve();
                    }
                });

                ws.on("error", (error) => {
                    clearTimeout(timeout);
                    ws.terminate();
                    reject(error);
                });
            });
        });

        it("should persist widget layout updates", async () => {
            await new Promise<void>((resolve, reject) => {
                const ws = new WebSocket(`ws://localhost:${serverPort}/dashboard-ws`);
                const timeout = setTimeout(() => {
                    ws.terminate();
                    reject(new Error("WebSocket message timeout"));
                }, 2000);
                let updateSent = false;

                ws.on("open", () => {
                    ws.send(JSON.stringify({
                        type: "widget_layout_update",
                        data: {
                            containerId: "overview-metrics",
                            widgetIds: ["overview-total", "overview-pending"],
                        },
                    }));
                    updateSent = true;
                });

                ws.on("message", (data) => {
                    const message = JSON.parse(data.toString());
                    if (message.type === "widget_layout_update" && updateSent) {
                        ws.send(JSON.stringify({ type: "get_widget_layout" }));
                        return;
                    }
                    if (message.type === "widget_layout_state") {
                        const layout = message.data?.widgetLayout;
                        expect(layout).toHaveProperty("overview-metrics");
                        expect(layout["overview-metrics"]).toEqual(["overview-total", "overview-pending"]);
                        clearTimeout(timeout);
                        ws.close();
                        resolve();
                    }
                });

                ws.on("error", (error) => {
                    clearTimeout(timeout);
                    ws.terminate();
                    reject(error);
                });
            });
        });

        it("should persist widget layout updates sent as updates payloads", async () => {
            await new Promise<void>((resolve, reject) => {
                const ws = new WebSocket(`ws://localhost:${serverPort}/dashboard-ws`);
                const timeout = setTimeout(() => {
                    ws.terminate();
                    reject(new Error("WebSocket message timeout"));
                }, 2000);
                let updateSent = false;

                ws.on("open", () => {
                    ws.send(JSON.stringify({
                        type: "widget_layout_update",
                        data: {
                            updates: {
                                "overview-metrics": ["overview-total", "overview-pending"],
                            },
                        },
                    }));
                    updateSent = true;
                });

                ws.on("message", (data) => {
                    const message = JSON.parse(data.toString());
                    if (message.type === "widget_layout_update" && updateSent) {
                        ws.send(JSON.stringify({ type: "get_widget_layout" }));
                        return;
                    }
                    if (message.type === "widget_layout_state") {
                        const layout = message.data?.widgetLayout;
                        expect(layout).toHaveProperty("overview-metrics");
                        expect(layout["overview-metrics"]).toEqual(["overview-total", "overview-pending"]);
                        clearTimeout(timeout);
                        ws.close();
                        resolve();
                    }
                });

                ws.on("error", (error) => {
                    clearTimeout(timeout);
                    ws.terminate();
                    reject(error);
                });
            });
        });

        it("should persist widget layout updates sent as widgetLayout payloads", async () => {
            await new Promise<void>((resolve, reject) => {
                const ws = new WebSocket(`ws://localhost:${serverPort}/dashboard-ws`);
                const timeout = setTimeout(() => {
                    ws.terminate();
                    reject(new Error("WebSocket message timeout"));
                }, 2000);
                let updateSent = false;

                ws.on("open", () => {
                    ws.send(JSON.stringify({
                        type: "widget_layout_update",
                        data: {
                            widgetLayout: {
                                "overview-metrics": ["overview-total", "overview-pending"],
                            },
                        },
                    }));
                    updateSent = true;
                });

                ws.on("message", (data) => {
                    const message = JSON.parse(data.toString());
                    if (message.type === "widget_layout_update" && updateSent) {
                        ws.send(JSON.stringify({ type: "get_widget_layout" }));
                        return;
                    }
                    if (message.type === "widget_layout_state") {
                        const layout = message.data?.widgetLayout;
                        expect(layout).toHaveProperty("overview-metrics");
                        expect(layout["overview-metrics"]).toEqual(["overview-total", "overview-pending"]);
                        clearTimeout(timeout);
                        ws.close();
                        resolve();
                    }
                });

                ws.on("error", (error) => {
                    clearTimeout(timeout);
                    ws.terminate();
                    reject(error);
                });
            });
        });

        it("should apply widget layout updates before responding with layout state", async () => {
            await new Promise<void>((resolve, reject) => {
                const ws = new WebSocket(`ws://localhost:${serverPort}/dashboard-ws`);
                const timeout = setTimeout(() => {
                    ws.terminate();
                    reject(new Error("WebSocket message timeout"));
                }, 2000);

                ws.on("open", () => {
                    ws.send(JSON.stringify({
                        type: "widget_layout_update",
                        data: {
                            containerId: "overview-metrics",
                            widgetIds: ["overview-total", "overview-pending"],
                        },
                    }));
                    ws.send(JSON.stringify({ type: "get_widget_layout" }));
                });

                ws.on("message", (data) => {
                    const message = JSON.parse(data.toString());
                    if (message.type === "widget_layout_state") {
                        const layout = message.data?.widgetLayout;
                        expect(layout).toHaveProperty("overview-metrics");
                        expect(layout["overview-metrics"]).toEqual(["overview-total", "overview-pending"]);
                        clearTimeout(timeout);
                        ws.close();
                        resolve();
                    }
                });

                ws.on("error", (error) => {
                    clearTimeout(timeout);
                    ws.terminate();
                    reject(error);
                });
            });
        });

        it("should de-duplicate widget layout updates", async () => {
            await new Promise<void>((resolve, reject) => {
                const ws = new WebSocket(`ws://localhost:${serverPort}/dashboard-ws`);
                const timeout = setTimeout(() => {
                    ws.terminate();
                    reject(new Error("WebSocket message timeout"));
                }, 2000);
                let updateSent = false;

                ws.on("open", () => {
                    ws.send(JSON.stringify({
                        type: "widget_layout_update",
                        data: {
                            containerId: "overview-metrics",
                            widgetIds: ["overview-total", "overview-total", "overview-pending"],
                        },
                    }));
                    updateSent = true;
                });

                ws.on("message", (data) => {
                    const message = JSON.parse(data.toString());
                    if (message.type === "widget_layout_update" && updateSent) {
                        ws.send(JSON.stringify({ type: "get_widget_layout" }));
                        return;
                    }
                    if (message.type === "widget_layout_state") {
                        const layout = message.data?.widgetLayout;
                        expect(layout).toHaveProperty("overview-metrics");
                        expect(layout["overview-metrics"]).toEqual(["overview-total", "overview-pending"]);
                        clearTimeout(timeout);
                        ws.close();
                        resolve();
                    }
                });

                ws.on("error", (error) => {
                    clearTimeout(timeout);
                    ws.terminate();
                    reject(error);
                });
            });
        });

        it("should move widgets between containers on layout updates", async () => {
            await new Promise<void>((resolve, reject) => {
                const ws = new WebSocket(`ws://localhost:${serverPort}/dashboard-ws`);
                const timeout = setTimeout(() => {
                    ws.terminate();
                    reject(new Error("WebSocket message timeout"));
                }, 2000);
                let updateStage = 0;

                ws.on("open", () => {
                    ws.send(JSON.stringify({
                        type: "widget_layout_update",
                        data: {
                            containerId: "overview-metrics",
                            widgetIds: ["overview-total"],
                        },
                    }));
                });

                ws.on("message", (data) => {
                    const message = JSON.parse(data.toString());
                    if (message.type === "widget_layout_update" && updateStage === 0) {
                        updateStage = 1;
                        ws.send(JSON.stringify({
                            type: "widget_layout_update",
                            data: {
                                containerId: "queue-metrics",
                                widgetIds: ["overview-total"],
                            },
                        }));
                        return;
                    }
                    if (message.type === "widget_layout_update" && updateStage === 1) {
                        updateStage = 2;
                        ws.send(JSON.stringify({ type: "get_widget_layout" }));
                        return;
                    }
                    if (message.type === "widget_layout_state" && updateStage === 2) {
                        const layout = message.data?.widgetLayout;
                        expect(layout).toHaveProperty("queue-metrics");
                        expect(layout["queue-metrics"]).toEqual(["overview-total"]);
                        const overviewLayout = Array.isArray(layout?.["overview-metrics"])
                            ? layout["overview-metrics"]
                            : [];
                        expect(overviewLayout).not.toContain("overview-total");
                        clearTimeout(timeout);
                        ws.close();
                        resolve();
                    }
                });

                ws.on("error", (error) => {
                    clearTimeout(timeout);
                    ws.terminate();
                    reject(error);
                });
            });
        });

        it("should persist widget visibility updates", async () => {
            await new Promise<void>((resolve, reject) => {
                const ws = new WebSocket(`ws://localhost:${serverPort}/dashboard-ws`);
                const timeout = setTimeout(() => {
                    ws.terminate();
                    reject(new Error("WebSocket message timeout"));
                }, 2000);
                let updateSent = false;

                ws.on("open", () => {
                    ws.send(JSON.stringify({
                        type: "widget_visibility_update",
                        data: { hiddenWidgetIds: ["overview-total"] },
                    }));
                    updateSent = true;
                });

                ws.on("message", (data) => {
                    const message = JSON.parse(data.toString());
                    if (message.type === "widget_visibility_update" && updateSent) {
                        ws.send(JSON.stringify({ type: "get_widget_visibility" }));
                        return;
                    }
                    if (message.type === "widget_visibility_state") {
                        expect(message.data.hiddenWidgetIds).toEqual(["overview-total"]);
                        clearTimeout(timeout);
                        ws.close();
                        resolve();
                    }
                });

                ws.on("error", (error) => {
                    clearTimeout(timeout);
                    ws.terminate();
                    reject(error);
                });
            });
        });

		it("should send initial state on connection", async () => {
			// Mock task manager
			taskManager.getAllTasks = async () => ({
				success: true,
				data: [
					{
						id: "test-1",
						title: "Test Task",
						status: "todo",
						priority: "medium",
						createdAt: new Date().toISOString(),
						updatedAt: new Date().toISOString()
					}
				]
			});

			await new Promise<void>((resolve, reject) => {
				const ws = new WebSocket(`ws://localhost:${serverPort}/dashboard-ws`);
				const timeout = setTimeout(() => {
					ws.terminate();
					reject(new Error("WebSocket message timeout"));
				}, 2000);

				ws.on("message", (data) => {
					const message = JSON.parse(data.toString());
					expect(message.type).toBe("initial_state");
					expect(message.data).toHaveProperty("metrics");
					expect(message.data).toHaveProperty("tasks");
					clearTimeout(timeout);
					ws.close();
					resolve();
				});

				ws.on("error", (error) => {
					clearTimeout(timeout);
					ws.terminate();
					reject(error);
				});
			});
		});

		it("should handle real-time task updates", async () => {
			await new Promise<void>((resolve, reject) => {
				const ws = new WebSocket(`ws://localhost:${serverPort}/dashboard-ws`);
				const timeout = setTimeout(() => {
					ws.terminate();
					reject(new Error("WebSocket update timeout"));
				}, 2000);
				let initialReceived = false;
				
				ws.on("message", (data) => {
					const message = JSON.parse(data.toString());
					
					if (message.type === "initial_state" && !initialReceived) {
						initialReceived = true;
						dashboardServer["broadcastToDashboard"]({
							type: "metrics_update",
							data: { tasks: [], daemon: {}, health: {}, system: {} }
						}, "test");
						return;
					}
					
					if (message.type === "metrics_update" && initialReceived) {
						clearTimeout(timeout);
						ws.close();
						resolve();
					}
				});

				ws.on("error", (error) => {
					clearTimeout(timeout);
					ws.terminate();
					reject(error);
				});
			});
		});
	});

	describe("Task Management", () => {
		it("should handle task creation via API", async () => {
			const taskData = {
				title: "New Test Task",
				description: "Test description",
				priority: "high",
				createdBy: "test-user"
			};

			// Mock TCP client
			dashboardServer["tcpClient"] = {
				sendCommand: async (command: string, data: any) => {
					if (command === "create_task") {
						return {
							success: true,
							data: {
								id: "new-task-id",
								...data,
								status: "todo",
								createdAt: new Date().toISOString(),
								updatedAt: new Date().toISOString()
							}
						};
					}
					return { success: false, error: "Unknown command" };
				}
			};

			const response = await fetch(`http://localhost:${serverPort}/api/tasks`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(taskData)
			});

			expect(response.status).toBe(201);
			const result = await response.json();
			expect(result.success).toBe(true);
			expect(result.data.title).toBe(taskData.title);
		});

		it("should handle task status updates", async () => {
			// Mock TCP client
			dashboardServer["tcpClient"] = {
				sendCommand: async (command: string, data: any) => {
					if (command === "update_task_status") {
						return {
							success: true,
							data: {
								id: data.id,
								status: data.status,
								updatedAt: new Date().toISOString()
							}
						};
					}
					return { success: false, error: "Unknown command" };
				}
			};

			const response = await fetch(`http://localhost:${serverPort}/api/tasks/test-task-id`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ status: "in-progress" })
			});

			expect(response.status).toBe(200);
			const result = await response.json();
			expect(result.success).toBe(true);
			expect(result.data.status).toBe("in-progress");
		});

		it("should handle task deletion", async () => {
			// Mock TCP client
			dashboardServer["tcpClient"] = {
				sendCommand: async (command: string, data: any) => {
					if (command === "delete_task") {
						return { success: true, data: true };
					}
					return { success: false, error: "Unknown command" };
				}
			};

			const response = await fetch(`http://localhost:${serverPort}/api/tasks/test-task-id`, {
				method: "DELETE"
			});

			expect(response.status).toBe(200);
			const result = await response.json();
			expect(result.success).toBe(true);
		});
	});

	describe("Analytics Integration", () => {
		it("should serve analytics endpoints", async () => {
			// Mock analytics service
			analyticsService.handleAnalyticsRequest = async (req, res) => {
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify({
					success: true,
					data: {
						totalTasks: 100,
						completionRate: 85,
						averageProcessingTime: 45
					},
					timestamp: new Date().toISOString()
				}));
			};

			const response = await fetch(`http://localhost:${serverPort}/api/analytics/dashboard-summary`);
			expect(response.status).toBe(200);
			
			const analytics = await response.json();
			expect(analytics.success).toBe(true);
			expect(analytics.data).toHaveProperty("totalTasks");
			expect(analytics.data).toHaveProperty("completionRate");
		});

		it("should handle progress tracking requests", async () => {
			// Mock progress service
			const mockProgressData = [
				{
					taskId: "task-1",
					title: "Test Task",
					progressPercentage: 75,
					performanceScore: 85,
					isOverdue: false
				}
			];

			analyticsService.handleAnalyticsRequest = async (req, res) => {
				const url = new URL(req.url || "", `http://localhost`);
				if (url.pathname.includes("task-progress")) {
					res.writeHead(200, { "Content-Type": "application/json" });
					res.end(JSON.stringify({
						success: true,
						data: mockProgressData,
						timestamp: new Date().toISOString()
					}));
				}
			};

			const response = await fetch(`http://localhost:${serverPort}/api/analytics/task-progress`);
			expect(response.status).toBe(200);
			
			const progress = await response.json();
			expect(progress.success).toBe(true);
			expect(progress.data).toHaveLength(1);
			expect(progress.data[0].progressPercentage).toBe(75);
		});
	});

	describe("Error Handling", () => {
		it("should handle invalid API endpoints", async () => {
			const response = await fetch(`http://localhost:${serverPort}/api/invalid`);
			expect(response.status).toBe(404);
		});

		it("should handle malformed JSON requests", async () => {
			const response = await fetch(`http://localhost:${serverPort}/api/tasks`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: "invalid json"
			});

			expect(response.status).toBe(400);
		});

		it("should handle task manager errors gracefully", async () => {
			taskManager.getAllTasks = async () => ({
				success: false,
				error: new Error("Connection failed"),
			});

			const response = await fetch(`http://localhost:${serverPort}/api/tasks`);
			expect(response.status).toBe(500);
			
			const error = await response.json();
			expect(error.error).toContain("Failed to search tasks");
		});
	});

	describe("Security", () => {
		it("should sanitize HTML output", async () => {
			const response = await fetch(`http://localhost:${serverPort}/`);
			const html = await response.text();
			
			// Check for potential XSS vectors
			expect(html).not.toContain("<script>");
			expect(html).not.toContain("javascript:");
		});

		it("should handle large requests gracefully", async () => {
			// Create a very large search query
			const largeQuery = "a".repeat(10000);
			const response = await fetch(`http://localhost:${serverPort}/api/tasks?q=${largeQuery}`);
			
			// Should either handle gracefully or return appropriate error
			expect(response.status).toBeLessThan(500);
		});
	});
});

async function canListenOnPort(): Promise<boolean> {
	return new Promise((resolve) => {
		const testServer = createServer();
		testServer.once("error", () => {
			testServer.close(() => resolve(false));
		});
		testServer.listen(0, "127.0.0.1", () => {
			testServer.close(() => resolve(true));
		});
	});
}

describe("Dashboard Analytics Service Tests", () => {
	let analyticsService: DashboardAnalyticsService;
	let taskManager: Pick<TaskServiceApi, "getAllTasks">;

	beforeEach(() => {
		taskManager = {
			getAllTasks: async () => ({ success: true, data: [] }),
		};
		analyticsService = new DashboardAnalyticsService(taskManager);
	});

	describe("Progress Analytics", () => {
		it("should calculate task progress metrics", async () => {
			// Mock product manager with test tasks
			taskManager.getAllTasks = async () => ({
				success: true,
				data: [
					{
						id: "task-1",
						title: "Completed Task",
						status: "done",
						priority: "high",
						createdAt: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
						updatedAt: new Date(Date.now() - 1800000).toISOString()  // 30 min ago
					},
					{
						id: "task-2",
						title: "In Progress Task",
						status: "in-progress",
						priority: "medium",
						createdAt: new Date(Date.now() - 7200000).toISOString(), // 2 hours ago
						updatedAt: new Date(Date.now() - 600000).toISOString()   // 10 min ago
					}
				]
			});

			const progressData = await analyticsService.getTasksProgress({
				status: ["done", "in-progress"]
			});

			expect(progressData).toHaveLength(2);
			expect(progressData[0].progressPercentage).toBeGreaterThan(0);
			expect(progressData[0].performanceScore).toBeGreaterThan(0);
		});

		it("should generate productivity trends", async () => {
			// Mock tasks with different creation dates
			const now = new Date();
			const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
			
			taskManager.getAllTasks = async () => ({
				success: true,
				data: [
					{
						id: "task-1",
						title: "Today's Task",
						status: "done",
						priority: "medium",
						createdAt: now.toISOString(),
						updatedAt: now.toISOString()
					},
					{
						id: "task-2",
						title: "Yesterday's Task",
						status: "done",
						priority: "low",
						createdAt: yesterday.toISOString(),
						updatedAt: yesterday.toISOString()
					}
				]
			});

			const trends = await analyticsService.getProductivityTrends({
				from: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
				to: now
			});

			expect(trends).toHaveProperty("trends");
			expect(trends).toHaveProperty("completionRate");
			expect(trends.completionRate).toBeGreaterThan(0);
		});
	});

	describe("Performance Metrics", () => {
		it("should identify bottlenecks", async () => {
			// Mock tasks with various completion times
			taskManager.getAllTasks = async () => ({
				success: true,
				data: [
					{
						id: "task-1",
						title: "Fast Task",
						status: "done",
						priority: "low",
						createdAt: new Date(Date.now() - 60000).toISOString(), // 1 min ago
						updatedAt: new Date(Date.now() - 30000).toISOString()  // 30 sec ago
					},
					{
						id: "task-2",
						title: "Slow Task",
						status: "done",
						priority: "high",
						createdAt: new Date(Date.now() - 7200000).toISOString(), // 2 hours ago
						updatedAt: new Date(Date.now() - 3600000).toISOString()  // 1 hour ago
					}
				]
			});

			const metrics = await analyticsService.getPerformanceMetrics();

			expect(metrics).toHaveProperty("bottlenecks");
			expect(metrics).toHaveProperty("overallMetrics");
			expect(metrics.overallMetrics.totalTasks).toBe(2);
		});

		it("should calculate performance distribution", async () => {
			// Mock tasks with different performance characteristics
			taskManager.getAllTasks = async () => ({
				success: true,
				data: [
					{ id: "task-1", status: "done", priority: "high" },
					{ id: "task-2", status: "done", priority: "medium" },
					{ id: "task-3", status: "done", priority: "low" },
					{ id: "task-4", status: "in-progress", priority: "high" },
					{ id: "task-5", status: "failed", priority: "medium" }
				]
			});

			const metrics = await analyticsService.getPerformanceMetrics();

			expect(metrics.performanceDistribution).toHaveProperty("excellent");
			expect(metrics.performanceDistribution).toHaveProperty("good");
			expect(metrics.performanceDistribution).toHaveProperty("fair");
			expect(metrics.performanceDistribution).toHaveProperty("poor");
		});
	});

	describe("Retention Management", () => {
		it("should calculate retention statistics", async () => {
			// Mock service with retention data
			const mockStats = await analyticsService.getRetentionStatistics();

			expect(mockStats).toHaveProperty("retention");
			expect(mockStats).toHaveProperty("recommendations");
			expect(mockStats.recommendations).toBeInstanceOf(Array);
		});

		it("should apply retention policy", async () => {
			const policy = {
				olderThanDays: 30,
				keepHighPriorityTasks: true,
				keepFailedTasks: false,
				keepTasksWithDependencies: true,
				minEventsPerTask: 5,
				maxEventsPerTask: 100,
				dryRun: true
			};

			const result = await analyticsService.applyRetentionPolicy(policy);

			expect(result).toHaveProperty("policyApplied");
			expect(result).toHaveProperty("result");
			expect(result.result).toHaveProperty("deletedEvents");
			expect(result.result).toHaveProperty("keptEvents");
		});
	});
});
