import { test, expect } from "@playwright/test";

import { canUseLocalSockets, NETWORK_SKIP_REASON } from "../../e2e/dashboard/test-environment.ts";

import { DashboardServer } from "@isomorphiq/dashboard";
import { WebSocketManager } from "@isomorphiq/realtime";
import { ProductManager } from "@isomorphiq/profiles";
import { createServer, type Server } from "node:http";

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

describe("Dashboard Edge Cases and Error Handling", () => {
	let dashboardServer: DashboardServer;
	let wsManager: WebSocketManager;
	let productManager: ProductManager;
	let httpServer: Server;
	let dashboardPort: number;

	beforeEach(async () => {
		// Mock ProductManager with edge case scenarios
		productManager = {
			getAllTasks: async () => [
				{
					id: "edge-1",
					title: "", // Empty title
					description: "Task with empty title",
					status: "todo",
					priority: "high",
					createdAt: new Date().toISOString(),
					updatedAt: new Date().toISOString(),
					createdBy: "test-user"
				},
				{
					id: "edge-2",
					title: "Task with very long title that exceeds normal length limits and might cause display issues in the dashboard UI components",
					description: "",
					status: "in-progress",
					priority: "medium",
					createdAt: new Date().toISOString(),
					updatedAt: new Date().toISOString()
				},
				{
					id: "edge-3",
					title: "Special Characters Test!@#$%^&*()_+-={}[]|\\:;\"'<>?,./",
					description: "Testing special characters in task content",
					status: "done",
					priority: "low",
					createdAt: new Date().toISOString(),
					updatedAt: new Date().toISOString()
				},
				{
					id: "edge-4",
					title: "Unicode Test 🚀 ñáéíóú 中文",
					description: "Testing unicode and emoji support in dashboard",
					status: "todo",
					priority: "high",
					createdAt: new Date().toISOString(),
					updatedAt: new Date().toISOString()
				}
			],
			createTask: async () => ({} as any),
			updateTaskStatus: async () => ({} as any),
			updateTaskPriority: async () => ({} as any),
			deleteTask: async () => {}
		} as ProductManager;

		wsManager = {
			broadcastTaskCreated: () => {},
			broadcastTaskStatusChanged: () => {},
			broadcastTaskPriorityChanged: () => {},
			broadcastTaskDeleted: () => {},
			getConnectionCount: () => 0,
			start: async () => {},
			stop: async () => {}
		} as WebSocketManager;

		dashboardServer = new DashboardServer(productManager, wsManager);
		httpServer = createServer((req, res) => {
			dashboardServer.handleRequest(req, res).catch(() => {});
		});

		// Find available port
		dashboardPort = 3005 + Math.floor(Math.random() * 1000);
		
		await new Promise<void>((resolve) => {
			httpServer.listen(dashboardPort, () => resolve());
		});
	});

	afterEach(async () => {
		if (httpServer) {
			await new Promise<void>((resolve) => {
				httpServer.close(() => resolve());
			});
		}
	});

	describe("Edge Case Handling", () => {
		it("should handle tasks with empty titles gracefully", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/api/tasks`);
			expect(response.status).toBe(200);
			
			const tasks = await response.json();
			const emptyTitleTask = tasks.find(t => t.id === "edge-1");
			expect(emptyTitleTask).toBeDefined();
			expect(emptyTitleTask.title).toBe("");
		});

		it("should handle tasks with very long titles", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/api/tasks`);
			expect(response.status).toBe(200);
			
			const tasks = await response.json();
			const longTitleTask = tasks.find(t => t.id === "edge-2");
			expect(longTitleTask).toBeDefined();
			expect(longTitleTask.title.length).toBeGreaterThan(100);
		});

		it("should handle special characters in task content", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/api/tasks`);
			expect(response.status).toBe(200);
			
			const tasks = await response.json();
			const specialCharTask = tasks.find(t => t.id === "edge-3");
			expect(specialCharTask).toBeDefined();
			expect(specialCharTask.title).toContain("!@#$%^&*()");
		});

		it("should handle unicode and emoji characters", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/api/tasks`);
			expect(response.status).toBe(200);
			
			const tasks = await response.json();
			const unicodeTask = tasks.find(t => t.id === "edge-4");
			expect(unicodeTask).toBeDefined();
			expect(unicodeTask.title).toContain("🚀");
			expect(unicodeTask.title).toContain("中文");
		});

		it("should handle extremely large task lists", async () => {
			// Mock large task list
			productManager.getAllTasks = async () => {
				const tasks = [];
				for (let i = 0; i < 1000; i++) {
					tasks.push({
						id: `bulk-${i}`,
						title: `Bulk Task ${i}`,
						description: `Description for bulk task ${i}`,
						status: "todo",
						priority: "medium",
						createdAt: new Date().toISOString(),
						updatedAt: new Date().toISOString()
					});
				}
				return tasks;
			};

			const response = await fetch(`http://localhost:${dashboardPort}/api/tasks`);
			expect(response.status).toBe(200);
			
			const tasks = await response.json();
			expect(tasks).toHaveLength(1000);
		});
	});

	describe("Input Validation and Sanitization", () => {
		it("should handle malformed query parameters gracefully", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/api/tasks?status=invalid&priority=unknown&search=malformed%20query`);
			expect(response.status).toBe(200);
			
			// Should not crash, return empty or filtered results
			const tasks = await response.json();
			expect(Array.isArray(tasks)).toBe(true);
		});

		it("should handle extremely long search queries", async () => {
			const longQuery = "a".repeat(10000);
			const response = await fetch(`http://localhost:${dashboardPort}/api/tasks/search?q=${encodeURIComponent(longQuery)}`);
			expect(response.status).toBe(200);
			
			const tasks = await response.json();
			expect(Array.isArray(tasks)).toBe(true);
		});

		it("should handle invalid JSON in POST requests", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/api/tasks/filtered`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: "invalid json { malformed"
			});

			expect([400, 500]).toContain(response.status);
		});

		it("should handle missing required fields in task creation", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/api/tasks`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({}) // Empty object missing title
			});

			expect([400, 422]).toContain(response.status);
		});

		it("should handle null and undefined values", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/api/tasks/filtered`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					filters: {
						status: null,
						priority: undefined,
						search: ""
					}
				})
			});

			expect(response.status).toBe(200);
			const tasks = await response.json();
			expect(Array.isArray(tasks)).toBe(true);
		});
	});

	describe("Concurrent Request Handling", () => {
		it("should handle multiple simultaneous requests", async () => {
			const requests = Array.from({ length: 50 }, (_, i) =>
				fetch(`http://localhost:${dashboardPort}/api/tasks?_=${i}`)
			);

			const responses = await Promise.allSettled(requests);
			
			// Most requests should succeed
			const successful = responses.filter(r => r.status === 'fulfilled').length;
			expect(successful).toBeGreaterThan(40); // At least 80% success rate

			// Verify responses are consistent
			const successfulResponses = responses
				.filter(r => r.status === 'fulfilled')
				.map(r => (r as PromiseFulfilledResult<Response>).value);
			
			const taskCounts = await Promise.all(
				successfulResponses.map(res => res.json())
			);
			
			// All should return the same task count
			const uniqueCounts = [...new Set(taskCounts.map(t => t.length))];
			expect(uniqueCounts).toHaveLength(1);
		});

		it("should handle concurrent task creation requests", async () => {
			const createRequests = Array.from({ length: 10 }, (_, i) =>
				fetch(`http://localhost:${dashboardPort}/api/tasks`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						title: `Concurrent Task ${i}`,
						description: `Created in batch test ${i}`,
						priority: "medium"
					})
				})
			);

			const responses = await Promise.allSettled(createRequests);
			
			// Most should succeed or fail gracefully
			const successful = responses.filter(r => 
				r.status === 'fulfilled' && 
				[200, 201, 400].includes((r as PromiseFulfilledResult<Response>).value.status)
			).length;
			
			expect(successful).toBeGreaterThan(5);
		});
	});

	describe("Memory and Performance Edge Cases", () => {
		it("should handle large description text", async () => {
			const largeDescription = "x".repeat(100000); // 100KB description
			
			const response = await fetch(`http://localhost:${dashboardPort}/api/tasks`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					title: "Large Description Test",
					description: largeDescription,
					priority: "low"
				})
			});

			// Should handle gracefully without memory issues
			expect([200, 201, 400, 413]).toContain(response.status);
		});

		it("should handle deep nested filter objects", async () => {
			const deepFilter = {
				filters: {
					status: "todo",
					nested: {
						level1: {
							level2: {
								level3: {
									level4: "deep value"
								}
							}
						}
					},
					array: new Array(1000).fill("item"),
					search: "test"
				}
			};

			const response = await fetch(`http://localhost:${dashboardPort}/api/tasks/filtered`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(deepFilter)
			});

			// Should not crash or timeout
			expect([200, 400]).toContain(response.status);
		});
	});

	describe("Network and Connection Edge Cases", () => {
		it("should handle slow connections gracefully", async () => {
			// Test with slow request (simulate by adding delay)
			const slowRequest = async () => {
				const controller = new AbortController();
				setTimeout(() => controller.abort(), 1000); // 1 second timeout

				try {
					const response = await fetch(`http://localhost:${dashboardPort}/api/tasks`, {
						signal: controller.signal
					});
					return response.status;
				} catch (error) {
					return 0; // Indicates timeout/abort
				}
			};

			const results = await Promise.all(Array.from({ length: 5 }, slowRequest));
			
			// Should handle timeouts gracefully
			results.forEach(status => {
				expect([0, 200, 408]).toContain(status);
			});
		});

		it("should handle invalid HTTP methods", async () => {
			const invalidMethods = ["PATCH", "TRACE", "CONNECT", "OPTIONS"];
			
			for (const method of invalidMethods) {
				const response = await fetch(`http://localhost:${dashboardPort}/api/tasks`, { 
					method: method as any 
				});
				expect([405, 400, 404]).toContain(response.status);
			}
		});

		it("should handle extremely long URLs", async () => {
			const longPath = "/api/tasks/" + "a".repeat(2000);
			const response = await fetch(`http://localhost:${dashboardPort}${longPath}`);
			expect([404, 414]).toContain(response.status);
		});
	});

	describe("Data Type Edge Cases", () => {
		it("should handle numeric strings as task IDs", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/api/tasks/status/12345`);
			expect([200, 400, 404]).toContain(response.status);
		});

		it("should handle boolean values in filters", async () => {
			const response = await fetch(`http://localhost:${dashboardPort}/api/tasks/filtered`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					filters: {
						status: true,
						priority: false,
						limit: "10"
					}
				})
			});

			expect([200, 400]).toContain(response.status);
		});

		it("should handle date edge cases", async () => {
			// Test with invalid dates
			productManager.getAllTasks = async () => [
				{
					id: "date-edge-1",
					title: "Invalid Date Task",
					description: "Task with invalid dates",
					status: "todo",
					priority: "medium",
					createdAt: "invalid-date",
					updatedAt: null as any
				}
			];

			const response = await fetch(`http://localhost:${dashboardPort}/api/tasks`);
			expect(response.status).toBe(200);
			
			const tasks = await response.json();
			expect(tasks).toHaveLength(1);
			expect(tasks[0].id).toBe("date-edge-1");
		});
	});

	describe("Security Edge Cases", () => {
		it("should handle XSS attempt in task content", async () => {
			const xssPayload = "<script>alert('xss')</script>";
			
			const response = await fetch(`http://localhost:${dashboardPort}/api/tasks`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					title: xssPayload,
					description: "XSS test",
					priority: "medium"
				})
			});

			// Should handle XSS attempts gracefully
			expect([200, 201, 400]).toContain(response.status);
		});

		it("should handle SQL injection attempts in search", async () => {
			const sqlInjection = "'; DROP TABLE tasks; --";
			
			const response = await fetch(`http://localhost:${dashboardPort}/api/tasks/search?q=${encodeURIComponent(sqlInjection)}`);
			expect(response.status).toBe(200);
			
			// Should not crash or return server errors
			const tasks = await response.json();
			expect(Array.isArray(tasks)).toBe(true);
		});

		it("should handle path traversal attempts", async () => {
			const traversalAttempts = [
				"../../../etc/passwd",
				"..\\..\\..\\windows\\system32",
				"%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd"
			];

			for (const attempt of traversalAttempts) {
				const response = await fetch(`http://localhost:${dashboardPort}/api/tasks/${attempt}`);
				expect([400, 404]).toContain(response.status);
			}
		});
	});
});
