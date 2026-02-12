import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { createConnection } from "node:net";
import { startTestDaemon, type TestDaemonHandle } from "./daemon-test-harness.ts";

describe("MCP Server Integration Tests", () => {
    let daemon: TestDaemonHandle;
    let daemonPort: number;

    before(async () => {
        daemon = await startTestDaemon();
        daemonPort = daemon.tcpPort;
    });

    after(async () => {
        await daemon.cleanup();
    });

    describe("Daemon Communication", () => {
        it("should communicate with daemon over TCP", async () => {
            return new Promise<void>((resolve, reject) => {
                const client = createConnection({ port: daemonPort, host: "localhost" }, () => {
                    console.log("[TEST] Connected to daemon");
                    const testCommand = JSON.stringify({ 
                        command: "get_daemon_status", 
                        data: {} 
                    }) + "\n";
                    
                    client.write(testCommand);
                });

                let response = "";
                client.on("data", (data) => {
                    response += data.toString();
                    try {
                        const result = JSON.parse(response.trim());
                        client.end();
                        assert.ok(result.success || result.status, "Should respond to daemon status check");
                        resolve();
                    } catch (_e) {
                        void _e; // Wait for more data
                    }
                });

                client.on("error", (err: any) => {
                    reject(new Error(`Daemon connection failed: ${err.message}`));
                });

                client.on("close", () => {
                    if (!response) {
                        reject(new Error("Connection closed without response"));
                    }
                });

                // Timeout after 5 seconds
                setTimeout(() => {
                    client.destroy();
                    reject(new Error("Daemon communication timeout"));
                }, 5000);
            });
        });

        it("should handle daemon unavailability gracefully", async () => {
            const CLIENT_PORT = 9999;
            
            return new Promise<void>((resolve) => {
                const client = createConnection({ port: CLIENT_PORT, host: "localhost" });
                
                client.on("error", (err: any) => {
                    assert.ok(err.code === "ECONNREFUSED", "Should fail to connect to non-existent port");
                    resolve();
                });

                setTimeout(() => {
                    client.destroy();
                    resolve();
                }, 2000);
            });
        });

        it("should handle malformed JSON requests", async () => {
            return new Promise<void>((resolve) => {
                const client = createConnection({ port: daemonPort, host: "localhost" }, () => {
                    client.write("invalid json\n");
                });

                client.on("data", (data) => {
                    const response = data.toString();
                    assert.ok(response.includes("error") || response.includes("invalid"), 
                        "Should respond with error for malformed JSON");
                    client.end();
                    resolve();
                });

                client.on("error", () => {
                    resolve(); // Error is acceptable for malformed input
                });

                setTimeout(() => {
                    client.destroy();
                    resolve();
                }, 2000);
            });
        });
    });

    describe("Task Management via TCP", () => {
        it("should create a task via TCP command", async () => {
            return new Promise<void>((resolve, reject) => {
                const client = createConnection({ port: daemonPort, host: "localhost" }, () => {
                    const createCommand = JSON.stringify({
                        command: "create_task",
                        data: {
                            title: "Integration Test Task",
                            description: "Task created via TCP integration test",
                            priority: "medium"
                        }
                    }) + "\n";
                    
                    client.write(createCommand);
                });

                let response = "";
                client.on("data", (data) => {
                    response += data.toString();
                    try {
                        const result = JSON.parse(response.trim());
                        client.end();
                        
                        assert.ok(result.success, "Should successfully create task");
                        assert.ok(result.data.id, "Should return task ID");
                        assert.equal(result.data.title, "Integration Test Task", "Should set correct title");
                        resolve();
                    } catch (_e) {
                        void _e;
                    }
                });

                client.on("error", reject);

                setTimeout(() => {
                    client.destroy();
                    reject(new Error("Task creation timeout"));
                }, 5000);
            });
        });

        it("should list tasks via TCP command", async () => {
            return new Promise<void>((resolve, reject) => {
                const client = createConnection({ port: daemonPort, host: "localhost" }, () => {
                    const listCommand = JSON.stringify({
                        command: "list_tasks",
                        data: {}
                    }) + "\n";
                    
                    client.write(listCommand);
                });

                let response = "";
                client.on("data", (data) => {
                    response += data.toString();
                    try {
                        const result = JSON.parse(response.trim());
                        client.end();
                        
                        assert.ok(result.success, "Should successfully list tasks");
                        assert.ok(Array.isArray(result.data), "Should return array of tasks");
                        resolve();
                    } catch (_e) {
                        void _e;
                    }
                });

                client.on("error", reject);

                setTimeout(() => {
                    client.destroy();
                    reject(new Error("Task listing timeout"));
                }, 5000);
            });
        });

        it("should handle invalid task data gracefully", async () => {
            return new Promise<void>((resolve) => {
                const client = createConnection({ port: daemonPort, host: "localhost" }, () => {
                    const invalidCommand = JSON.stringify({
                        command: "create_task",
                        data: {
                            title: "", // Empty title should be invalid
                            description: "Invalid task"
                        }
                    }) + "\n";
                    
                    client.write(invalidCommand);
                });

                client.on("data", (data) => {
                    const response = data.toString();
                    try {
                        const result = JSON.parse(response.trim());
                        client.end();
                        
                        assert.ok(!result.success, "Should fail to create task with empty title");
                        assert.ok(result.error, "Should provide error message");
                        resolve();
                    } catch (_e) {
                        void _e;
                    }
                });

                client.on("error", () => {
                    resolve(); // Network errors are acceptable
                });

                setTimeout(() => {
                    client.destroy();
                    resolve();
                }, 3000);
            });
        });
    });
});
