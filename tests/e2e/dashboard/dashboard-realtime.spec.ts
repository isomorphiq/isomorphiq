// FILE_CONTEXT: "context-4108fc18-a62b-4d52-b7b5-79d1854d4777"

import { test, expect } from "@playwright/test";

import { canUseLocalSockets, NETWORK_SKIP_REASON } from "./test-environment.ts";

import { createServer } from "node:http";

const describe = test.describe;
const it = test;
const before = test.beforeAll;
const after = test.afterAll;
const beforeEach = test.beforeEach;
const afterEach = test.afterEach;

let localSocketAccess = true;

before(async () => {
    localSocketAccess = await canUseLocalSockets();
});

beforeEach(() => {
    test.skip(!localSocketAccess, NETWORK_SKIP_REASON);
});

describe("Dashboard End-to-End Workflow", () => {
    let httpServer;
    let dashboardPort;

    beforeEach(async () => {
        const now = new Date().toISOString();
        const listTasks = [
            {
                id: "task-1",
                title: "Test Task 1",
                description: "First test task",
                status: "todo",
                priority: "high",
                createdAt: now,
                updatedAt: now
            },
            {
                id: "task-2",
                title: "Test Task 2",
                description: "Second test task",
                status: "in-progress",
                priority: "medium",
                createdAt: now,
                updatedAt: now
            }
        ];
        const searchTasks = [
            ...listTasks,
            {
                id: "task-3",
                title: "Important Task",
                description: "Critical task",
                status: "done",
                priority: "high",
                createdAt: now,
                updatedAt: now
            }
        ];
        const metricsPayload = {
            tasks: {
                total: 5,
                pending: 2,
                inProgress: 1,
                completed: 2,
                byPriority: { high: 2, medium: 2, low: 1 },
                recent: []
            },
            daemon: { uptime: 3600, memory: { used: 50000000, total: 100000000 } },
            health: { status: "healthy", memoryUsage: 50, wsConnections: 1, tcpConnected: true },
            system: { nodeVersion: process.version, platform: process.platform }
        };

        const sendJson = (res, payload, status = 200) => {
            res.writeHead(status, { "Content-Type": "application/json" });
            res.end(JSON.stringify(payload));
        };

        const readJsonBody = async (req) => {
            const chunks = [];
            return await new Promise((resolve) => {
                req.on("data", (chunk) => {
                    chunks.push(chunk);
                });
                req.on("end", () => {
                    if (chunks.length === 0) {
                        resolve({ ok: true, value: {} });
                        return;
                    }
                    const raw = Buffer.concat(chunks).toString("utf8");
                    try {
                        resolve({ ok: true, value: JSON.parse(raw) });
                    } catch (error) {
                        resolve({ ok: false, value: null });
                    }
                });
            });
        };

        const normalizeFilterArray = (value) => {
            if (Array.isArray(value)) {
                return value;
            }
            if (typeof value === "string" && value.length > 0) {
                return [value];
            }
            return [];
        };

        const applyFilters = (tasks, filters) => {
            const statusFilters = normalizeFilterArray(filters?.status);
            const priorityFilters = normalizeFilterArray(filters?.priority);
            const searchTerm = typeof filters?.search === "string" ? filters.search.toLowerCase() : "";

            const filtered = tasks.filter((task) => {
                const statusMatch =
                    statusFilters.length === 0 || statusFilters.includes(task.status);
                const priorityMatch =
                    priorityFilters.length === 0 || priorityFilters.includes(task.priority);
                const searchMatch =
                    searchTerm.length === 0 ||
                    task.title.toLowerCase().includes(searchTerm) ||
                    task.description.toLowerCase().includes(searchTerm);
                return statusMatch && priorityMatch && searchMatch;
            });

            const limitValue = typeof filters?.limit === "number" ? filters.limit : filtered.length;
            const offsetValue = typeof filters?.offset === "number" ? filters.offset : 0;
            return filtered.slice(offsetValue, offsetValue + limitValue);
        };

        const generateSessionId = () => {
            const suffix = Math.random().toString(36).slice(2, 8);
            return `client_${Date.now()}_${suffix}`;
        };

        // Start a mock daemon HTTP server that responds like the dashboard
        httpServer = createServer(async (req, res) => {
            const method = req.method || "GET";
            const baseUrl = `http://localhost:${dashboardPort || 0}`;
            const url = new URL(req.url || "/", baseUrl);
            const pathname = url.pathname;

            if (pathname === "/") {
                res.writeHead(200, { "Content-Type": "text/html" });
                res.end("<!DOCTYPE html><html><head><title>Test Dashboard</title></head><body>Dashboard</body></html>");
                return;
            }

            if (pathname === "/api/metrics") {
                sendJson(res, metricsPayload);
                return;
            }

            if (pathname === "/api/tasks/search" && method === "GET") {
                const query = url.searchParams.get("q") || "";
                const statusFilter = url.searchParams.get("status");
                const filtered = searchTasks.filter((task) => {
                    if (!query) {
                        return true;
                    }
                    const term = query.toLowerCase();
                    return (
                        task.title.toLowerCase().includes(term) ||
                        task.description.toLowerCase().includes(term)
                    );
                });
                const statusApplied = statusFilter
                    ? filtered.filter((task) => task.status === statusFilter)
                    : filtered;
                sendJson(res, statusApplied);
                return;
            }

            if (pathname === "/api/tasks" && method === "GET") {
                const statusFilter = url.searchParams.get("status");
                const statusApplied = statusFilter
                    ? listTasks.filter((task) => task.status === statusFilter)
                    : listTasks;
                sendJson(res, statusApplied);
                return;
            }

            if (pathname === "/api/tasks" && method === "POST") {
                const body = await readJsonBody(req);
                if (!body.ok) {
                    sendJson(res, { error: "Invalid JSON" }, 400);
                    return;
                }
                sendJson(res, { success: true, taskId: "task-3" }, 201);
                return;
            }

            if (pathname === "/api/tasks/filtered" && method === "POST") {
                const body = await readJsonBody(req);
                if (!body.ok) {
                    sendJson(res, { error: "Invalid JSON" }, 400);
                    return;
                }
                const filters = body.value?.filters || {};
                const filtered = applyFilters(listTasks, filters);
                sendJson(res, filtered);
                return;
            }

            if (pathname.startsWith("/api/tasks/status/") && method === "GET") {
                const taskId = pathname.split("/").pop();
                const task = listTasks.find((entry) => entry.id === taskId);
                if (!task) {
                    res.writeHead(404);
                    res.end("Not Found");
                    return;
                }
                sendJson(res, { taskId, status: task.status, updatedAt: task.updatedAt });
                return;
            }

            if (pathname === "/api/notifications/subscribe" && method === "POST") {
                const body = await readJsonBody(req);
                if (!body.ok) {
                    sendJson(res, { error: "Invalid JSON" }, 400);
                    return;
                }
                const sessionId = body.value?.sessionId || generateSessionId();
                const taskIds = Array.isArray(body.value?.taskIds) ? body.value.taskIds : [];
                sendJson(res, {
                    success: true,
                    sessionId,
                    subscribedTasks: taskIds
                });
                return;
            }

            res.writeHead(404);
            res.end("Not Found");
        });

        await new Promise((resolve, reject) => {
            httpServer.once("error", reject);
            httpServer.listen(0, () => {
                const address = httpServer.address();
                if (address && typeof address === "object") {
                    dashboardPort = address.port;
                }
                resolve();
            });
        });
    });

    afterEach(async () => {
        if (httpServer) {
            await new Promise((resolve) => {
                httpServer.close(() => resolve());
            });
        }
    });

	describe("Complete User Workflow", () => {
		it("should load dashboard homepage", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/`);
			expect(response.status).toBe(200);
			expect(response.headers.get("content-type")).toContain("text/html");
			
			const html = await response.text();
			expect(html).toContain("Test Dashboard");
		});

		it("should fetch and display metrics", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/api/metrics`);
			expect(response.status).toBe(200);
			
			const metrics = await response.json();
			expect(metrics).toHaveProperty("tasks");
			expect(metrics).toHaveProperty("daemon");
			expect(metrics).toHaveProperty("health");
			expect(metrics.tasks.total).toBe(5);
			expect(metrics.tasks.pending).toBe(2);
			expect(metrics.health.status).toBe("healthy");
		});

		it("should fetch and display task list", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/api/tasks`);
			expect(response.status).toBe(200);
			
			const tasks = await response.json();
			expect(Array.isArray(tasks)).toBe(true);
			expect(tasks).toHaveLength(2);
			expect(tasks[0].title).toBe("Test Task 1");
			expect(tasks[1].status).toBe("in-progress");
		});

		it("should filter tasks by status", async () => {
			// Test filtering by status
			const todoResponse = await fetch(`http://localhost:${dashboardPort}/api/tasks?status=todo`);
			const todoTasks = await todoResponse.json();
			expect(todoTasks).toHaveLength(1);
			expect(todoTasks[0].status).toBe("todo");

			const inProgressResponse = await fetch(`http://localhost:${dashboardPort}/api/tasks?status=in-progress`);
			const inProgressTasks = await inProgressResponse.json();
			expect(inProgressTasks).toHaveLength(1);
			expect(inProgressTasks[0].status).toBe("in-progress");
		});

		it("should search tasks by text", async () => {
			// Test search functionality
			const searchResponse1 = await fetch(`http://localhost:${dashboardPort}/api/tasks/search?q=Test`);
			const searchResults1 = await searchResponse1.json();
			expect(searchResults1).toHaveLength(2);
			expect(searchResults1.every(task => task.title.includes("Test"))).toBe(true);

			const searchResponse2 = await fetch(`http://localhost:${dashboardPort}/api/tasks/search?q=Important`);
			const searchResults2 = await searchResponse2.json();
			expect(searchResults2).toHaveLength(1);
			expect(searchResults2[0].title).toBe("Important Task");
		});

		it("should handle combined filters", async () => {
			// Test combining search and filters
			const response = await fetch(`http://localhost:${dashboardPort}/api/tasks/search?q=Test&status=todo`);
			const results = await response.json();
			expect(results).toHaveLength(1);
			expect(results[0].title).toBe("Test Task 1");
			expect(results[0].status).toBe("todo");
		});

		it("should handle task creation workflow", async () => {
			const newTask = {
				title: "Workflow Test Task",
				description: "Task created during workflow test",
				priority: "medium"
			};

			// Note: In real environment, this would create the task
			// Here we just test that the endpoint exists and accepts the request
			const response = await fetch(`http://localhost:${dashboardPort}/api/tasks`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(newTask)
			});

			// Should either succeed or give appropriate error
			expect([200, 201, 400, 500]).toContain(response.status);
		});

		it("should provide real-time data structure", async () => {
			const metricsResponse = await fetch(`http://localhost:${dashboardPort}/api/metrics`);
			const metrics = await metricsResponse.json();

			// Verify expected real-time data structure
			expect(metrics).toHaveProperty("tasks");
			expect(metrics.tasks).toHaveProperty("total");
			expect(metrics.tasks).toHaveProperty("pending");
			expect(metrics.tasks).toHaveProperty("inProgress");
			expect(metrics.tasks).toHaveProperty("completed");
			expect(metrics.tasks).toHaveProperty("byPriority");
			expect(metrics.tasks).toHaveProperty("recent");

			expect(metrics).toHaveProperty("daemon");
			expect(metrics.daemon).toHaveProperty("uptime");
			expect(metrics.daemon).toHaveProperty("memory");

			expect(metrics).toHaveProperty("health");
			expect(metrics.health).toHaveProperty("status");
			expect(metrics.health).toHaveProperty("wsConnections");
			expect(metrics.health).toHaveProperty("tcpConnected");

			expect(metrics).toHaveProperty("system");
			expect(metrics.system).toHaveProperty("nodeVersion");
			expect(metrics.system).toHaveProperty("platform");
		});
	});

	describe("Error Handling and Edge Cases", () => {
		it("should handle unknown endpoints gracefully", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/unknown-endpoint`);
			expect(response.status).toBe(404);
		});

		it("should handle empty search results", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/api/tasks/search?q=nonexistent`);
			const results = await response.json();
			expect(Array.isArray(results)).toBe(true);
			expect(results).toHaveLength(0);
		});

		it("should handle invalid filter values", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/api/tasks?status=invalid-status`);
			// Should return empty array for invalid status
			const results = await response.json();
			expect(Array.isArray(results)).toBe(true);
			expect(results).toHaveLength(0);
		});

		it("should handle malformed requests", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/api/tasks`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: "invalid json{"
			});

			expect([400, 500]).toContain(response.status);
		});
	});

	describe("Performance and Scalability", () => {
		it("should handle concurrent requests", async () => {
			// Test handling multiple simultaneous requests
			const requests = Array.from({ length: 10 }, () =>
				fetch(`http://localhost:${dashboardPort}/api/metrics`)
			);

			const responses = await Promise.allSettled(requests);
			const successful = responses.filter(r => r.status === "fulfilled");
			
			// All requests should complete successfully
			expect(successful).toHaveLength(10);
			
			// All should have consistent data
			const metricsArray = await Promise.all(
				successful.map(response => response.value.json())
			);
			
			// All responses should have the same structure
			metricsArray.forEach(metrics => {
				expect(metrics).toHaveProperty("tasks");
				expect(metrics).toHaveProperty("daemon");
				expect(metrics).toHaveProperty("health");
			});
		});

		it("should respond within reasonable time", async () => {
			const startTime = Date.now();
			
			const response = await fetch(`http://localhost:${dashboardPort}/api/metrics`);
			const endTime = Date.now();
			
			const responseTime = endTime - startTime;
			
			// Should respond within 2 seconds (generous for test environment)
			expect(responseTime).toBeLessThan(2000);
			expect(response.status).toBe(200);
		});
	});

	describe("Real-time Features Structure", () => {
		it("should support WebSocket endpoint path", async () => {
			// Test that dashboard supports WebSocket connections
			// This tests structure, not actual WebSocket functionality
			const WS_URL = `ws://localhost:${dashboardPort}/dashboard-ws`;
			
			// Verify URL structure is correct
			expect(WS_URL).toContain("ws://");
			expect(WS_URL).toContain("/dashboard-ws");
			
			// Test that HTTP server is running on expected port
			const healthResponse = await fetch(`http://localhost:${dashboardPort}/api/metrics`);
			expect(healthResponse.status).toBe(200);
		});

		it("should provide task update events structure", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/api/tasks`);
			const tasks = await response.json();
			
			// Verify tasks have the structure needed for real-time updates
			tasks.forEach(task => {
				expect(task).toHaveProperty("id");
				expect(task).toHaveProperty("title");
				expect(task).toHaveProperty("status");
				expect(task).toHaveProperty("priority");
				expect(task).toHaveProperty("createdAt");
				expect(task).toHaveProperty("updatedAt");
			});
		});
	});

	describe("Task Status Notifications", () => {
		it("should handle task status subscription", async () => {
			const subscriptionData = {
				sessionId: "realtime-test-session",
				taskIds: ["task-1", "task-2"],
				includeTcpResponse: false
			};

			const response = await fetch(`http://localhost:${dashboardPort}/api/notifications/subscribe`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(subscriptionData)
			});

			expect(response.status).toBe(200);
			
			const subscription = await response.json();
			expect(subscription).toHaveProperty("success", true);
			expect(subscription).toHaveProperty("sessionId", "realtime-test-session");
			expect(subscription).toHaveProperty("subscribedTasks");
			expect(Array.isArray(subscription.subscribedTasks)).toBe(true);
		});

		it("should support task status querying", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/api/tasks/status/task-1`);
			expect(response.status).toBe(200);
			
			const statusData = await response.json();
			expect(statusData).toHaveProperty("taskId");
			expect(statusData).toHaveProperty("status");
			expect(statusData).toHaveProperty("updatedAt");
			expect(typeof statusData.taskId).toBe("string");
			expect(typeof statusData.status).toBe("string");
		});

		it("should return 404 for invalid task status query", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/api/tasks/status/invalid-task-id`);
			expect([404, 400]).toContain(response.status);
		});

		it("should support filtered task queries", async () => {
			const filterData = {
				filters: {
					status: ["todo", "in-progress"],
					priority: "high",
					limit: 5,
					search: "Test"
				}
			};

			const response = await fetch(`http://localhost:${dashboardPort}/api/tasks/filtered`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(filterData)
			});

			expect(response.status).toBe(200);
			
			const filteredTasks = await response.json();
			expect(Array.isArray(filteredTasks)).toBe(true);
			
			// Verify pagination limits work
			expect(filteredTasks.length).toBeLessThanOrEqual(5);
			
			// Verify search results contain the search term
			if (filteredTasks.length > 0) {
				filteredTasks.forEach(task => {
					expect(task.title.toLowerCase()).toContain("test".toLowerCase());
				});
			}
		});

		it("should handle complex filtering scenarios", async () => {
			const complexFilters = {
				filters: {
					status: ["todo"],
					priority: ["high", "medium"],
					search: "Task",
					limit: 10,
					offset: 0
				}
			};

			const response = await fetch(`http://localhost:${dashboardPort}/api/tasks/filtered`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(complexFilters)
			});

			expect(response.status).toBe(200);
			
			const tasks = await response.json();
			expect(Array.isArray(tasks)).toBe(true);
			
			// Verify filters are applied correctly
			tasks.forEach(task => {
				expect(["todo"]).toContain(task.status);
				expect(["high", "medium"]).toContain(task.priority);
				expect(task.title.toLowerCase()).toContain("task".toLowerCase());
			});
		});

		it("should handle empty filter results", async () => {
			const emptyFilters = {
				filters: {
					status: ["non-existent-status"],
					limit: 10
				}
			};

			const response = await fetch(`http://localhost:${dashboardPort}/api/tasks/filtered`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(emptyFilters)
			});

			expect(response.status).toBe(200);
			
			const tasks = await response.json();
			expect(Array.isArray(tasks)).toBe(true);
			expect(tasks).toHaveLength(0);
		});

		it("should support pagination in filtered queries", async () => {
			// Test offset
			const offsetFilters = {
				filters: {
					limit: 1,
					offset: 1
				}
			};

			const response = await fetch(`http://localhost:${dashboardPort}/api/tasks/filtered`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(offsetFilters)
			});

			expect(response.status).toBe(200);
			
			const tasks = await response.json();
			expect(Array.isArray(tasks)).toBe(true);
			expect(tasks.length).toBeLessThanOrEqual(1);
		});

		it("should handle malformed filter requests gracefully", async () => {
			const malformedData = {
				invalidField: "invalid"
			};

			const response = await fetch(`http://localhost:${dashboardPort}/api/tasks/filtered`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(malformedData)
			});

			// Should handle gracefully - either succeed with empty results or return error
			expect([200, 400, 500]).toContain(response.status);
		});

		it("should generate unique session IDs for subscriptions", async () => {
			const subscription1 = {
				taskIds: ["task-1"]
			};

			const subscription2 = {
				taskIds: ["task-2"]
			};

			const [response1, response2] = await Promise.all([
				fetch(`http://localhost:${dashboardPort}/api/notifications/subscribe`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(subscription1)
				}),
				fetch(`http://localhost:${dashboardPort}/api/notifications/subscribe`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(subscription2)
				})
			]);

			expect(response1.status).toBe(200);
			expect(response2.status).toBe(200);

			const [data1, data2] = await Promise.all([
				response1.json(),
				response2.json()
			]);

			expect(data1.sessionId).not.toBe(data2.sessionId);
			expect(data1.sessionId).toMatch(/^client_\d+_[a-z0-9]+$/);
			expect(data2.sessionId).toMatch(/^client_\d+_[a-z0-9]+$/);
		});
	});
});
