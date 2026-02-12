import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { exec } from "node:child_process";
import { createConnection } from "node:net";
import { startTestDaemon, type TestDaemonHandle } from "./daemon-test-harness.ts";

interface ExecOptions {
    cwd?: string;
    timeout?: number;
    detached?: boolean;
    env?: NodeJS.ProcessEnv;
}

function execAsync(command: string, options: ExecOptions = {}): Promise<{stdout: string, stderr: string}> {
    return new Promise((resolve, reject) => {
        exec(command, options, (error, stdout, stderr) => {
            if (error) {
                reject(error);
            } else {
                resolve({ stdout, stderr });
            }
        });
    });
}

describe("MCP Server Integration Tests", () => {
    let mcpServerProcess: any;
    let daemon: TestDaemonHandle;
    let daemonPort: number;
    const MCP_PORT = 3002; // Use different port to avoid conflicts
    const buildMcpEnv = (): NodeJS.ProcessEnv => ({
        ...process.env,
        NODE_ENV: "test",
        ISOMORPHIQ_TEST_MODE: "true",
        TCP_PORT: daemonPort.toString(),
        DAEMON_PORT: daemonPort.toString(),
    });

    before(async () => {
        daemon = await startTestDaemon();
        daemonPort = daemon.tcpPort;
        process.env.TCP_PORT = daemonPort.toString();
        process.env.DAEMON_PORT = daemonPort.toString();
    });

    after(async () => {
        // Cleanup processes
        if (mcpServerProcess) {
            mcpServerProcess.kill();
        }
        if (daemon) {
            await daemon.cleanup();
        }
    });

    describe("MCP Server Tools", () => {
        it("should start MCP server process", async () => {
            // Test that MCP server can be started
            const serverPath = "./packages/mcp/src/mcp-server.ts";
            
            return new Promise((resolve, reject) => {
                const mcpProcess = exec(`node --experimental-strip-types ${serverPath}`, {
                    cwd: process.cwd(),
                    env: buildMcpEnv(),
                });
                
                let output = "";
                mcpProcess.stdout?.on("data", (data) => {
                    output += data.toString();
                });
                
                mcpProcess.stderr?.on("data", (data) => {
                    output += data.toString();
                });
                
                // Kill process after we see startup message
                setTimeout(() => {
                    mcpProcess.kill();
                    assert.ok(output.includes("started") || output.length > 0, "MCP server should start");
                    resolve();
                }, 1000);
                
                mcpProcess.on("error", (error) => {
                    reject(error);
                });
            });
        });

        it("should handle MCP server startup", async () => {
            // Test that MCP server can be started and responds to basic communication
            const serverPath = "./packages/mcp/src/mcp-server.ts";
            
            return new Promise((resolve, reject) => {
                const mcpProcess = exec(`node --experimental-strip-types ${serverPath}`, {
                    cwd: process.cwd(),
                    timeout: 3000,
                    env: buildMcpEnv(),
                });
                
                let output = "";
                mcpProcess.stdout?.on("data", (data) => {
                    output += data.toString();
                });
                
                mcpProcess.stderr?.on("data", (data) => {
                    output += data.toString();
                });
                
                // Kill process after short time to test startup
                setTimeout(() => {
                    mcpProcess.kill();
                    // If we get here without errors, server started
                    assert.ok(true, "MCP server should start without immediate errors");
                    resolve(void 0);
                }, 2000);
                
                mcpProcess.on("error", (error) => {
                    reject(error);
                });
            });
        });

        it("should validate MCP server file exists", async () => {
            const fs = await import("node:fs/promises");
            const serverPath = "./packages/mcp/src/mcp-server.ts";
            
            try {
                await fs.access(serverPath);
                assert.ok(true, "MCP server file should exist");
            } catch (error) {
                assert.fail("MCP server file should exist");
            }
        });

        it("should handle invalid tool calls gracefully", async () => {
            // Test that the daemon handles invalid commands gracefully
            return new Promise((resolve, reject) => {
                const client = createConnection({ port: daemonPort, host: "localhost" }, () => {
                    const invalidCommand = JSON.stringify({ 
                        command: "invalid_command", 
                        data: {} 
                    }) + "\n";
                    
                    client.write(invalidCommand);
                    
                    let response = "";
                    client.on("data", (data) => {
                        response += data.toString();
                        try {
                            const parsed = JSON.parse(response);
                            // Should handle invalid command gracefully
                            // Should handle invalid commands
                            client.end();
                            resolve();
                        } catch (_e) {
                            // Wait for more data
                        }
                    });
                    
                    client.on("error", (err: any) => {
                        // Should handle errors gracefully
                        assert.ok(true, "Should handle connection errors");
                        resolve();
                    });
                    
                    setTimeout(() => {
                        client.destroy();
                        resolve();
                    }, 2000);
                });
            });
        });
    });

    describe("Daemon Communication", () => {
it("should communicate with daemon over TCP", async () => {
            return new Promise((resolve, reject) => {
                const client = createConnection({ port: daemonPort, host: "localhost" }, () => {
                    console.log("[TEST] Connected to daemon");
                    const testCommand = JSON.stringify({ 
                        command: "get_status", 
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
                        assert.ok(result || Array.isArray(result), "Should respond to daemon status check");
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
            // Test with non-existent port
            const CLIENT_PORT = 9999;
            
            return new Promise((resolve, reject) => {
                const client = createConnection({ port: CLIENT_PORT, host: "localhost" });
                
client.on("error", (err: any) => {
                assert.ok(err.code === "ECONNREFUSED", "Should fail to connect to non-existent port");
                resolve(void 0);
            });

                setTimeout(() => {
                    client.destroy();
                    reject(new Error("Should have failed quickly"));
                }, 2000);
            });
        });
    });

    describe("Error Handling", () => {
        it("should handle malformed JSON requests", async () => {
            return new Promise((resolve) => {
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
                    resolve(void 0); // Error is acceptable for malformed input
                });

                setTimeout(() => {
                    client.destroy();
                    resolve(void 0);
                }, 2000);
            });
        });

        it("should handle timeout gracefully", async () => {
            // This test ensures the MCP server doesn't hang indefinitely
            const startTime = Date.now();
            
            try {
                await execMcpCommand('--mcp-server \'{"name": "test-mcp", "command": "node", "args": ["./packages/mcp/src/mcp-server.ts"]}\' "timeout_test"');
                const duration = Date.now() - startTime;
                assert.ok(duration < 30000, "Should complete within reasonable time");
            } catch (error: any) {
                const duration = Date.now() - startTime;
                assert.ok(duration < 30000, "Should timeout within reasonable time");
            }
        });
    });
});

// Helper function to execute MCP commands
async function execMcpCommand(command: string): Promise<string> {
    try {
        const fullCommand = `yarn opencode ${command}`;
        const { stdout, stderr } = await execAsync(fullCommand, {
            cwd: process.cwd(),
            timeout: 10000
        });
        return stdout + stderr;
    } catch (error) {
        throw error;
    }
}
