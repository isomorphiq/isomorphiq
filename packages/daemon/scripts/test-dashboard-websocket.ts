#!/usr/bin/env node

/**
 * Test script to validate dashboard WebSocket connectivity and real-time updates
 * This script tests the WebSocket functionality of the dashboard running on port 3005
 */

import WebSocket from "ws";

class DashboardWebSocketTest {
	private ws: WebSocket | null = null;
	private port: number = 3005;
	private host: string = "localhost";
	protected receivedMessages: any[] = [];

	async connect(): Promise<boolean> {
		return new Promise((resolve) => {
			const wsUrl = `ws://${this.host}:${this.port}/dashboard-ws`;
			console.log(`[TEST] Connecting to WebSocket: ${wsUrl}`);
			
			this.ws = new WebSocket(wsUrl);

			this.ws.on("open", () => {
				console.log("✅ WebSocket connection established");
				resolve(true);
			});

			this.ws.on("message", (data) => {
				try {
					const message = JSON.parse(data.toString());
					this.receivedMessages.push(message);
					console.log(`📨 Received: ${message.type}`, message.data ? JSON.stringify(message.data).substring(0, 100) + "..." : "");
				} catch (error) {
					console.log(`📨 Received (raw): ${data.toString().substring(0, 100)}...`);
				}
			});

			this.ws.on("error", (error) => {
				console.error("❌ WebSocket error:", error.message);
				resolve(false);
			});

			this.ws.on("close", () => {
				console.log("🔌 WebSocket connection closed");
			});

			setTimeout(() => {
				if (!this.ws || this.ws.readyState === WebSocket.CONNECTING) {
					console.log("❌ WebSocket connection timeout");
					resolve(false);
				}
			}, 5000);
		});
	}

	async sendTestMessage(): Promise<void> {
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
			console.log("❌ WebSocket not connected");
			return;
		}

		const testMessage = {
			type: "ping",
			data: { timestamp: Date.now() }
		};

		console.log("📤 Sending test message:", testMessage);
		this.ws.send(JSON.stringify(testMessage));
	}

	async waitForMessages(count: number, timeoutMs: number = 10000): Promise<any[]> {
		return new Promise((resolve) => {
			const startTime = Date.now();
			const checkInterval = setInterval(() => {
				if (this.receivedMessages.length >= count || Date.now() - startTime > timeoutMs) {
					clearInterval(checkInterval);
					resolve([...this.receivedMessages]);
				}
			}, 100);
		});
	}

	clearMessages(): void {
		this.receivedMessages = [];
	}

	getMessageCount(): number {
		return this.receivedMessages.length;
	}

	disconnect(): void {
		if (this.ws) {
			this.ws.close();
			this.ws = null;
		}
	}
}

async function runWebSocketTests() {
	console.log("=== Dashboard WebSocket Test ===\n");
	
	const wsTest = new DashboardWebSocketTest();

	// Test 1: Connect to WebSocket
	console.log("1. Testing WebSocket connection...");
	const connected = await wsTest.connect();
	if (!connected) {
		console.log("❌ Failed to connect to WebSocket dashboard");
		return;
	}

	// Test 2: Send test message and wait for responses
	console.log("\n2. Testing message exchange...");
	try {
		await wsTest.sendTestMessage();
		
		// Wait for any messages
		const messages = await wsTest.waitForMessages(1, 5000);
		console.log(`📊 Received ${messages.length} messages`);
		
		if (messages.length > 0) {
			console.log("✅ WebSocket message exchange working");
		} else {
			console.log("⚠️  No messages received (may be normal if no task activity)");
		}
	} catch (error) {
		console.log("❌ WebSocket message test error:", error);
	}

	// Test 3: Check real-time updates by creating a test task
	console.log("\n3. Testing real-time task updates...");
	
	// First clear received messages
	wsTest.clearMessages();
	
	// Create a task via TCP API to trigger WebSocket events
	const { createConnection } = await import("node:net");
	
	const sendTcpCommand = <T = any, R = any>(command: string, data: T): Promise<R> => {
		return new Promise((resolve, reject) => {
			const client = createConnection({ port: 3001, host: "localhost" }, () => {
				const message = `${JSON.stringify({ command, data })}\n`;
				client.write(message);
			});

			let response = "";
			client.on("data", (data) => {
				response += data.toString();
				try {
					const result = JSON.parse(response.trim());
					client.end();
					resolve(result);
				} catch (_e) {
					// Wait for more data
				}
			});

			client.on("error", reject);
			client.on("close", () => {
				if (!response) reject(new Error("Connection closed without response"));
			});

			setTimeout(() => {
				client.destroy();
				reject(new Error("Request timeout"));
			}, 5000);
		});
	};

	try {
		// Create a test task to trigger WebSocket events
		const taskResult = await sendTcpCommand("create_task", {
			title: "WebSocket Test Task",
			description: "Task to test WebSocket real-time updates",
			priority: "medium"
		});

		if (taskResult && (taskResult as any).success) {
			const taskId = (taskResult as any).data.id;
			console.log(`📝 Created test task: ${taskId}`);

			// Wait for WebSocket events
			await new Promise(resolve => setTimeout(resolve, 1000));

			const realtimeMessages = await wsTest.waitForMessages(1, 3000);
			
			if (realtimeMessages.length > 0) {
				console.log("✅ Real-time WebSocket events received");
				realtimeMessages.forEach(msg => {
					console.log(`   Event: ${msg.type}`);
				});
			} else {
				console.log("⚠️  No real-time events received for task creation");
			}

			// Cleanup: Update and delete the task
			await sendTcpCommand("update_task_status", { id: taskId, status: "done" });
			await sendTcpCommand("delete_task", { id: taskId });
			console.log("🧹 Test task cleaned up");

		} else {
			console.log("❌ Failed to create test task for WebSocket testing");
		}
	} catch (error) {
		console.log("❌ Error during real-time test:", error);
	}

	// Cleanup
	wsTest.disconnect();

	console.log("\n=== WebSocket Test Summary ===");
	console.log("WebSocket connectivity test completed");
	console.log("If no real-time events were received, this may indicate:");
	console.log("- WebSocket events are not configured for task operations");
	console.log("- Events are sent to different channels or endpoints");
	console.log("- Dashboard WebSocket integration needs to be verified");
}

runWebSocketTests().catch(console.error);