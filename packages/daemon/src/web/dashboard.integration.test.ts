import "../../../../tests/test-utils/env-fetch.ts";
import { describe, it, expect } from "node:test";
import { createServer, type Server } from "node:http";
import { WebSocket } from "ws";

describe("Dashboard Integration Tests", () => {
	let httpServer: Server;
	let dashboardServer: any; // Use any to avoid type issues
	let serverPort: number;

	beforeEach(async () => {
		// Find available port for testing
		serverPort = 3006 + Math.floor(Math.random() * 1000);
		
		// Mock dashboard server with basic functionality
		dashboardServer = {
			async handleRequest(req: any, res: any) {
				const url = new URL(req.url || "", `http://localhost:${serverPort}`);
				const pathname = url.pathname;

				if (pathname === "/") {
					res.writeHead(200, { "Content-Type": "text/html" });
					res.end("<!DOCTYPE html><html><body><h1>Test Dashboard</h1></body></html>");
					return;
				}

				if (pathname === "/api/metrics") {
					res.writeHead(200, { "Content-Type": "application/json" });
					res.end(JSON.stringify({
						tasks: {
							total: 10,
							pending: 3,
							inProgress: 2,
							completed: 5
						},
						daemon: {
							uptime: 3600,
							pid: 12345
						},
						health: {
							status: "healthy",
							memoryUsage: 45
						},
						system: {
							nodeVersion: "v18.0.0",
							platform: "linux"
						}
					}));
					return;
				}

				if (pathname === "/api/tasks") {
					res.writeHead(200, { "Content-Type": "application/json" });
					res.end(JSON.stringify([
						{
							id: "task-1",
							title: "Test Task 1",
							status: "todo",
							priority: "high",
							createdAt: new Date().toISOString(),
							updatedAt: new Date().toISOString()
						},
						{
							id: "task-2",
							title: "Test Task 2",
							status: "done",
							priority: "low",
							createdAt: new Date().toISOString(),
							updatedAt: new Date().toISOString()
						}
					]));
					return;
				}

				res.writeHead(404, { "Content-Type": "text/plain" });
				res.end("Not Found");
			},
			
			async initializeWebSocketServer(server: Server) {
				// Mock WebSocket server functionality
				const wsServer = new WebSocketServer({ server, path: "/dashboard-ws" });
				
				wsServer.on("connection", (ws: WebSocket) => {
					// Send initial state
					ws.send(JSON.stringify({
						type: "initial_state",
						data: {
							metrics: {
								tasks: { total: 10, pending: 3, inProgress: 2, completed: 5 },
								daemon: { uptime: 3600, pid: 12345 }
							},
							tasks: [
								{ id: "task-1", title: "Test Task", status: "todo", priority: "high" }
							]
						}
					}));
					
					// Handle client messages
					ws.on("message", (data) => {
						try {
							const message = JSON.parse(data.toString());
							
							switch (message.type) {
								case "refresh_metrics":
									ws.send(JSON.stringify({
										type: "metrics_update",
										data: {
											tasks: { total: 15, pending: 5, inProgress: 3, completed: 7 },
											daemon: { uptime: 3700, pid: 12345 }
										}
									}));
									break;
								case "refresh_tasks":
									ws.send(JSON.stringify({
										type: "tasks_update",
										data: [
											{ id: "task-2", title: "Updated Task", status: "in-progress", priority: "medium" }
										]
									}));
									break;
							}
						} catch (error) {
							console.error("WebSocket message error:", error);
						}
					});
					
					ws.on("close", () => {
						console.log("WebSocket client disconnected");
					});
					
					ws.on("error", (error) => {
						console.error("WebSocket error:", error);
					});
				});
				
				console.log("Mock WebSocket server initialized");
			}
		};

		// Create HTTP server
		httpServer = createServer((req, res) => {
			dashboardServer.handleRequest(req, res).catch(() => {
				res.writeHead(500);
				res.end("Internal Server Error");
			});
		});

		// Initialize WebSocket server
		await dashboardServer.initializeWebSocketServer(httpServer);
		
		// Start server
		await new Promise<void>((resolve) => {
			httpServer.listen(serverPort, () => {
				console.log(`Test server listening on port ${serverPort}`);
				resolve();
			});
		});
	});

	afterEach(async () => {
		// Clean up server
		if (httpServer) {
			await new Promise<void>((resolve) => {
				httpServer.close(() => resolve());
			});
		}
	});

	describe("HTTP API", () => {
		it("should serve main dashboard page", async () => {
			const response = await fetch(`http://localhost:${serverPort}/`);
			expect(response.status).toBe(200);
			expect(response.headers.get("content-type")).toContain("text/html");
			
			const html = await response.text();
			expect(html).toContain("Test Dashboard");
		});

		it("should serve metrics API", async () => {
			const response = await fetch(`http://localhost:${serverPort}/api/metrics`);
			expect(response.status).toBe(200);
			expect(response.headers.get("content-type")).toBe("application/json");
			
			const metrics = await response.json();
			expect(metrics).toHaveProperty("tasks");
			expect(metrics).toHaveProperty("daemon");
			expect(metrics).toHaveProperty("health");
			expect(metrics).toHaveProperty("system");
			
			expect(metrics.tasks.total).toBe(10);
			expect(metrics.tasks.pending).toBe(3);
			expect(metrics.daemon.uptime).toBe(3600);
			expect(metrics.health.status).toBe("healthy");
		});

		it("should serve tasks API", async () => {
			const response = await fetch(`http://localhost:${serverPort}/api/tasks`);
			expect(response.status).toBe(200);
			expect(response.headers.get("content-type")).toBe("application/json");
			
			const tasks = await response.json();
			expect(Array.isArray(tasks)).toBe(true);
			expect(tasks).toHaveLength(2);
			expect(tasks[0].id).toBe("task-1");
			expect(tasks[0].title).toBe("Test Task 1");
			expect(tasks[0].status).toBe("todo");
		});

		it("should handle 404 for invalid endpoints", async () => {
			const response = await fetch(`http://localhost:${serverPort}/api/invalid`);
			expect(response.status).toBe(404);
		});
	});

	describe("WebSocket Integration", () => {
		it("should establish WebSocket connection", (done) => {
			const ws = new WebSocket(`ws://localhost:${serverPort}/dashboard-ws`);
			
			ws.on("open", () => {
				expect(ws.readyState).toBe(WebSocket.OPEN);
				ws.close();
				done();
			});

			ws.on("error", (error) => {
				done(error);
			});
		});

		it("should receive initial state on connection", (done) => {
			const ws = new WebSocket(`ws://localhost:${serverPort}/dashboard-ws`);
			
			ws.on("message", (data) => {
				const message = JSON.parse(data.toString());
				expect(message.type).toBe("initial_state");
				expect(message.data).toHaveProperty("metrics");
				expect(message.data).toHaveProperty("tasks");
				expect(message.data.metrics.tasks.total).toBe(10);
				ws.close();
				done();
			});

			ws.on("error", (error) => {
				done(error);
			});
		});

		it("should handle real-time metrics updates", (done) => {
			const ws = new WebSocket(`ws://localhost:${serverPort}/dashboard-ws`);
			let messageCount = 0;
			
			ws.on("message", (data) => {
				const message = JSON.parse(data.toString());
				messageCount++;
				
				if (messageCount === 1) {
					// Initial state
					expect(message.type).toBe("initial_state");
					expect(message.data.metrics.tasks.total).toBe(10);
				} else if (messageCount === 2) {
					// Metrics update
					expect(message.type).toBe("metrics_update");
					expect(message.data.metrics.tasks.total).toBe(15);
					expect(message.data.metrics.tasks.pending).toBe(5);
					ws.close();
					done();
				}
			});

			// Wait for initial state, then send refresh request
			setTimeout(() => {
				ws.send(JSON.stringify({ type: "refresh_metrics" }));
			}, 100);

			ws.on("error", (error) => {
				done(error);
			});
		});

		it("should handle real-time task updates", (done) => {
			const ws = new WebSocket(`ws://localhost:${serverPort}/dashboard-ws`);
			let messageCount = 0;
			
			ws.on("message", (data) => {
				const message = JSON.parse(data.toString());
				messageCount++;
				
				if (messageCount === 1) {
					// Initial state
					expect(message.type).toBe("initial_state");
					expect(message.data.tasks).toHaveLength(1);
				} else if (messageCount === 2) {
					// Tasks update
					expect(message.type).toBe("tasks_update");
					expect(message.data.tasks).toHaveLength(1);
					expect(message.data.tasks[0].id).toBe("task-2");
					expect(message.data.tasks[0].status).toBe("in-progress");
					ws.close();
					done();
				}
			});

			// Wait for initial state, then send refresh request
			setTimeout(() => {
				ws.send(JSON.stringify({ type: "refresh_tasks" }));
			}, 100);

			ws.on("error", (error) => {
				done(error);
			});
		});

		it("should handle WebSocket errors gracefully", (done) => {
			// Connect to invalid port to simulate error
			const ws = new WebSocket(`ws://localhost:${serverPort + 999}/dashboard-ws`);
			
			ws.on("error", (error) => {
				expect(error).toBeDefined();
				done();
			});

			// Close connection if it somehow connects
			ws.on("open", () => {
				ws.close();
			});
		});
	});

	describe("Real-time Features", () => {
		it("should support concurrent WebSocket connections", (done) => {
			const connections = [];
			let readyCount = 0;
			
			const checkAllReady = () => {
				readyCount++;
				if (readyCount === 3) {
					// All connections are ready
					expect(connections).toHaveLength(3);
					connections.forEach(ws => ws.close());
					done();
				}
			};

			// Create 3 concurrent connections
			for (let i = 0; i < 3; i++) {
				const ws = new WebSocket(`ws://localhost:${serverPort}/dashboard-ws`);
				connections.push(ws);
				
				ws.on("open", () => {
					// Send a test message
					ws.send(JSON.stringify({ type: "test", data: `connection-${i}` }));
				});
				
				ws.on("message", (data) => {
					const message = JSON.parse(data.toString());
					if (message.type === "test") {
						checkAllReady();
					}
				});
				
				ws.on("error", (error) => {
					done(error);
				});
			}
		});

		it("should broadcast updates to all connected clients", (done) => {
			const ws1 = new WebSocket(`ws://localhost:${serverPort}/dashboard-ws`);
			const ws2 = new WebSocket(`ws://localhost:${serverPort}/dashboard-ws`);
			let messagesReceived = 0;
			
			const checkMessages = () => {
				messagesReceived++;
				if (messagesReceived === 2) {
					// Both clients received the update
					ws1.close();
					ws2.close();
					done();
				}
			};

			ws1.on("open", () => {
				ws1.send(JSON.stringify({ type: "broadcast_test" }));
			});

			ws2.on("open", () => {
				ws2.send(JSON.stringify({ type: "broadcast_test" }));
			});

			ws1.on("message", (data) => {
				const message = JSON.parse(data.toString());
				if (message.type === "broadcast_response") {
					checkMessages();
				}
			});

			ws2.on("message", (data) => {
				const message = JSON.parse(data.toString());
				if (message.type === "broadcast_response") {
					checkMessages();
				}
			});

			ws1.on("error", (error) => done(error));
			ws2.on("error", (error) => done(error));
		});
	});

	describe("Performance and Reliability", () => {
		it("should handle rapid successive requests", async () => {
			const promises = [];
			
			// Send 20 rapid requests
			for (let i = 0; i < 20; i++) {
				promises.push(fetch(`http://localhost:${serverPort}/api/metrics`));
			}
			
			const responses = await Promise.all(promises);
			
			// All requests should succeed
			responses.forEach(response => {
				expect(response.status).toBe(200);
			});
		});

		it("should handle large payloads", async () => {
			const ws = new WebSocket(`ws://localhost:${serverPort}/dashboard-ws`);
			
			ws.on("open", () => {
				// Send a large message
				const largeData = {
					type: "large_data_test",
					data: {
						tasks: Array(1000).fill(null).map((_, i) => ({
							id: `task-${i}`,
							title: `Large Task ${i}`,
							description: "A".repeat(1000), // Large description
							status: "todo",
							priority: "medium"
						}))
					}
				};
				
				ws.send(JSON.stringify(largeData));
			});

			ws.on("message", (data) => {
				const message = JSON.parse(data.toString());
				expect(message.type).toBe("large_data_response");
				ws.close();
			});

			ws.on("error", (error) => {
				// Should handle large messages without error
				expect(error).toBeUndefined();
			});
		});

		it("should maintain connection stability", (done) => {
			const ws = new WebSocket(`ws://localhost:${serverPort}/dashboard-ws`);
			let pingCount = 0;
			
			ws.on("open", () => {
				// Send periodic pings to test stability
				const interval = setInterval(() => {
					pingCount++;
					ws.send(JSON.stringify({ type: "ping", count: pingCount }));
					
					if (pingCount >= 10) {
						clearInterval(interval);
						ws.close();
						done();
					}
				}, 100);
			});

			ws.on("message", (data) => {
				const message = JSON.parse(data.toString());
				if (message.type === "pong") {
					// Connection is stable
					expect(message.count).toBe(pingCount);
				}
			});

			ws.on("error", (error) => {
				done(error);
			});
		});
	});
});
