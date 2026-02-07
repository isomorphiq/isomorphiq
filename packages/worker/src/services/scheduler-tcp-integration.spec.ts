import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import * as net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const canUseTcp = await canConnectTcp();
const formatTcpError = (response: any): string => {
	if (!response) {
		return "No response payload";
	}
	const error = response.error;
	if (!error) {
		return "Unknown error";
	}
	if (typeof error === "string") {
		return error;
	}
	if (typeof error.message === "string") {
		return error.message;
	}
	try {
		return JSON.stringify(error);
	} catch {
		return String(error);
	}
};

const assertSuccess = (response: any, message: string): void => {
	assert.strictEqual(response.success, true, `${message}. ${formatTcpError(response)}`);
};

describe("Scheduler TCP Integration Test", { skip: !canUseTcp }, () => {
	let daemonProcess: any;
	let tcpPort: number;
    let httpPort: number;
    let dashboardPort: number;
	let testDbRoot: string;
    let daemonExitError: Error | null = null;
    let daemonLogs: string[] = [];
	
    before(async () => {
        testDbRoot = await mkdtemp(path.join(tmpdir(), "isomorphiq-daemon-test-"));
        const dbPath = path.join(testDbRoot, "db");
        const savedSearchesPath = path.join(testDbRoot, "saved-searches-db");
        const auditPath = path.join(testDbRoot, "task-audit");

        await Promise.all([
            mkdir(dbPath, { recursive: true }),
            mkdir(savedSearchesPath, { recursive: true }),
            mkdir(auditPath, { recursive: true }),
        ]);

        const daemonEntry = fileURLToPath(new URL("../daemon.ts", import.meta.url));
        const daemonCwd = path.join(path.dirname(daemonEntry), "..");
        const shouldLogDaemonOutput = process.env.ISOMORPHIQ_TEST_VERBOSE === "true";
        const maxAttempts = 3;
        let lastError: Error | null = null;

        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            tcpPort = await findAvailablePort();
            httpPort = await findAvailablePort();
            dashboardPort = await findAvailablePort();
            process.env.TCP_PORT = tcpPort.toString();
            process.env.SKIP_TCP = "false"; // Ensure TCP server is enabled

            daemonExitError = null;
            daemonLogs = [];
            daemonProcess = spawn(process.execPath, ["--experimental-strip-types", daemonEntry], {
                cwd: daemonCwd,
                env: {
                    ...process.env,
                    NODE_ENV: "test",
                    ISOMORPHIQ_TEST_MODE: "true",
                    ISOMORPHIQ_STORAGE_MODE: "memory",
                    ISOMORPHIQ_MCP_TRANSPORT: "stdio",
                    TCP_PORT: tcpPort.toString(),
                    DAEMON_HTTP_PORT: httpPort.toString(),
                    DASHBOARD_PORT: dashboardPort.toString(),
                    DB_PATH: dbPath,
                    SAVED_SEARCHES_DB_PATH: savedSearchesPath,
                    TASK_AUDIT_DB_PATH: auditPath,
                    SKIP_TCP: "false",
                },
                stdio: "pipe",
                detached: false,
            });

            const recordLog = (label: string, data: Buffer) => {
                const text = data.toString();
                if (!text.trim()) {
                    return;
                }
                daemonLogs.push(`[${label}] ${text}`);
                if (daemonLogs.length > 200) {
                    daemonLogs.shift();
                }
            };

            if (daemonProcess.stdout) {
                daemonProcess.stdout.on("data", (data: Buffer) => recordLog("stdout", data));
            }
            if (daemonProcess.stderr) {
                daemonProcess.stderr.on("data", (data: Buffer) => recordLog("stderr", data));
            }

            if (shouldLogDaemonOutput && daemonProcess.stdout) {
                daemonProcess.stdout.on("data", (data: Buffer) => {
                    console.log("[DAEMON-OUTPUT]", data.toString());
                });
            }

            if (shouldLogDaemonOutput && daemonProcess.stderr) {
                daemonProcess.stderr.on("data", (data: Buffer) => {
                    console.error("[DAEMON-ERROR]", data.toString());
                });
            }

            const daemonExit = new Promise<never>((_resolve, reject) => {
                daemonProcess.once("exit", (code: number | null, signal: NodeJS.Signals | null) => {
                    const details = daemonLogs.length > 0 ? `\nDaemon logs:\n${daemonLogs.join("")}` : "";
                    const error = new Error(
                        `Daemon exited early with code ${code ?? "unknown"} (${signal ?? "no signal"})${details}`,
                    );
                    daemonExitError = error;
                    reject(error);
                });
            });

            const abortReason = (): string | null => {
                const joined = daemonLogs.join("");
                if (joined.includes(`TCP port ${tcpPort} in use`)) {
                    return `TCP port ${tcpPort} in use`;
                }
                if (joined.includes("TCP server disabled via SKIP_TCP=true")) {
                    return "TCP server disabled via SKIP_TCP=true";
                }
                return null;
            };

            try {
                await Promise.race([
                    waitForTcpServer(tcpPort, 30000, abortReason, daemonLogs),
                    daemonExit,
                ]);
                await waitForTcpReady();
                return;
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                if (daemonProcess) {
                    daemonProcess.kill("SIGTERM");
                    await delay(1000);
                }
                if (lastError.message.includes("in use") && attempt < maxAttempts) {
                    continue;
                }
                throw lastError;
            }
        }

        if (lastError) {
            throw lastError;
        }
    });
	
	after(async () => {
		if (daemonProcess) {
			daemonProcess.kill("SIGTERM");
			await delay(1000);
		}
		if (testDbRoot) {
			await rm(testDbRoot, { recursive: true, force: true });
		}
	});

	function sendTcpCommand(command: string, data: any = {}): Promise<any> {
		return new Promise((resolve, reject) => {
            if (daemonExitError) {
                reject(daemonExitError);
                return;
            }
			const socket = new net.Socket();
            let buffer = "";
            let settled = false;
            const timeout = setTimeout(() => {
                socket.destroy();
                if (!settled) {
                    settled = true;
                    reject(new Error(`TCP command timeout${formatDaemonLogTail()}`));
                }
            }, 10000);

            const finish = (error?: Error, response?: any) => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timeout);
                socket.destroy();
                if (error) {
                    reject(error);
                    return;
                }
                resolve(response);
            };
			
			socket.connect(tcpPort, "127.0.0.1", () => {
				const message = JSON.stringify({ command, data });
				socket.end(`${message}\n`);
			});
			
			socket.on("data", (data: Buffer) => {
                buffer += data.toString();
                if (!buffer.includes("\n")) {
                    return;
                }
				try {
					const response = JSON.parse(buffer.trim());
					finish(undefined, response);
				} catch (error) {
					finish(error instanceof Error ? error : new Error(String(error)));
				}
			});
			
			socket.on("error", (error: Error) => {
                const nextError = daemonExitError ?? error;
                finish(nextError);
			});

            socket.on("close", () => {
                if (!settled) {
                    const nextError = daemonExitError ?? new Error(`TCP socket closed${formatDaemonLogTail()}`);
                    finish(nextError);
                }
            });
		});
	}

    const formatDaemonLogTail = (): string => {
        if (daemonLogs.length === 0) {
            return "";
        }
        const tail = daemonLogs.slice(-20).join("");
        return `\nDaemon logs:\n${tail}`;
    };

    const waitForTcpReady = async (): Promise<void> => {
        const maxReadyAttempts = 5;
        let lastError: Error | null = null;
        for (let attempt = 1; attempt <= maxReadyAttempts; attempt += 1) {
            try {
                const response = await sendTcpCommand("get_scheduler_stats");
                if (response?.success) {
                    return;
                }
                lastError = new Error(
                    `TCP server responded with failure${formatDaemonLogTail()}`,
                );
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
            }
            await delay(250);
        }
        if (lastError) {
            throw lastError;
        }
    };

	it("should create a scheduled task via TCP", async () => {
		const taskData = {
			name: "TCP Test Task",
			description: "Task created via TCP",
			cronExpression: "0 0 * * *", // Daily at midnight
			isActive: true,
			taskTemplate: {
				title: "TCP Generated Task",
				description: "This task was created via TCP",
				priority: "medium",
				createdBy: "tcp-test-user"
			}
		};
		
		const response = await sendTcpCommand("create_scheduled_task", taskData);
		
		assert.strictEqual(response.success, true, "Should successfully create scheduled task");
		assert.ok(response.data.id, "Should return task ID");
		assert.strictEqual(response.data.name, taskData.name);
		assert.strictEqual(response.data.cronExpression, taskData.cronExpression);
		assert.strictEqual(response.data.isActive, taskData.isActive);
	});

	it("should list scheduled tasks via TCP", async () => {
		const response = await sendTcpCommand("list_scheduled_tasks");
		
		assert.strictEqual(response.success, true, "Should successfully list scheduled tasks");
		assert.ok(Array.isArray(response.data), "Should return array of tasks");
	});

	it("should validate cron expression via TCP", async () => {
		const validExpression = "0 9 * * 1-5"; // Weekdays at 9 AM
		const response = await sendTcpCommand("validate_cron_expression", { 
			expression: validExpression 
		});
		
		assert.strictEqual(response.success, true, "Should successfully validate cron expression");
		assert.strictEqual(response.data.isValid, true, "Expression should be valid");
		assert.ok(Array.isArray(response.data.nextRuns), "Should provide next run times");
	});

	it("should reject invalid cron expression via TCP", async () => {
		const invalidExpression = "invalid-cron-format";
		const response = await sendTcpCommand("validate_cron_expression", { 
			expression: invalidExpression 
		});
		
		assert.strictEqual(response.success, true, "Should return validation response");
		assert.strictEqual(response.data.isValid, false, "Expression should be invalid");
		assert.ok(response.data.errors.length > 0, "Should provide error messages");
	});

	it("should get scheduler stats via TCP", async () => {
		const response = await sendTcpCommand("get_scheduler_stats");
		
		assert.strictEqual(response.success, true, "Should successfully get scheduler stats");
		assert.ok(typeof response.data.totalSchedules === "number", "Should include total schedules");
		assert.ok(typeof response.data.activeSchedules === "number", "Should include active schedules");
		assert.ok(typeof response.data.successRate === "number", "Should include success rate");
	});

	it("should pause and resume scheduler via TCP", async () => {
		// Pause scheduler
		const pauseResponse = await sendTcpCommand("pause_scheduler");
		assert.strictEqual(pauseResponse.success, true, "Should successfully pause scheduler");
		
		// Resume scheduler
		const resumeResponse = await sendTcpCommand("resume_scheduler");
		assert.strictEqual(resumeResponse.success, true, "Should successfully resume scheduler");
	});

	it("should handle scheduler errors gracefully", async () => {
		const response = await sendTcpCommand("get_scheduled_task", { 
			id: "non-existent-id" 
		});
		
		assert.strictEqual(response.success, false, "Should fail for non-existent task");
		assert.ok(response.error, "Should provide error message");
		assert.ok(response.error.message.includes("not found"), "Error should mention task not found");
	});

	it("should create, update, and delete scheduled task via TCP", async () => {
		// Create
		const createData = {
			name: "Lifecycle Test Task",
			description: "Task for lifecycle testing",
			cronExpression: "0 1 * * *", // Daily at 1 AM
			isActive: true,
			taskTemplate: {
				title: "Lifecycle Test",
				description: "Testing full lifecycle",
				priority: "high",
				createdBy: "lifecycle-test-user"
			}
		};
		
		const createResponse = await sendTcpCommand("create_scheduled_task", createData);
		assert.strictEqual(createResponse.success, true, "Should create task");
		const taskId = createResponse.data.id;
		
		// Update
		const updateData = {
			id: taskId,
			updates: {
				name: "Updated Lifecycle Task",
				isActive: false,
				taskTemplate: {
					...createData.taskTemplate,
					priority: "low"
				}
			}
		};
		
		const updateResponse = await sendTcpCommand("update_scheduled_task", updateData);
		assert.strictEqual(updateResponse.success, true, "Should update task");
		assert.strictEqual(updateResponse.data.name, updateData.updates.name);
		assert.strictEqual(updateResponse.data.isActive, updateData.updates.isActive);
		
		// Delete
		const deleteResponse = await sendTcpCommand("delete_scheduled_task", { id: taskId });
		assert.strictEqual(deleteResponse.success, true, "Should delete task");
		assert.strictEqual(deleteResponse.data.deleted, true, "Should confirm deletion");
		
		// Verify deletion
		const getResponse = await sendTcpCommand("get_scheduled_task", { id: taskId });
		assert.strictEqual(getResponse.success, false, "Should not find deleted task");
	});

	it("should handle dependency validation via TCP", async () => {
		const taskData = {
			name: "Dependency Test Task",
			description: "Task with dependencies",
			cronExpression: "0 2 * * *",
			isActive: true,
			taskTemplate: {
				title: "Dependency Test",
				description: "Task with dependencies",
				priority: "medium",
				createdBy: "dependency-test-user",
				dependencies: ["non-existent-dependency"]
			}
		};
		
		// Create the task
		const createResponse = await sendTcpCommand("create_scheduled_task", taskData);
		assert.strictEqual(createResponse.success, true, "Should create task with dependencies");
		const taskId = createResponse.data.id;
		
		// Validate dependencies
		const validateResponse = await sendTcpCommand("validate_scheduled_task_dependencies", { id: taskId });
		assert.strictEqual(validateResponse.success, true, "Should validate dependencies");
		assert.strictEqual(validateResponse.data.isValid, false, "Should detect missing dependencies");
		assert.ok(validateResponse.data.missingDependencies.includes("non-existent-dependency"), "Should identify missing dependency");
	});

	it("should provide scheduling recommendations via TCP", async () => {
		const response = await sendTcpCommand("get_dependency_scheduling_recommendations");
		
		assert.strictEqual(response.success, true, "Should get recommendations");
		assert.ok(Array.isArray(response.data), "Should return array of recommendations");
		
		// If there are scheduled tasks, should have recommendations for each
		if (response.data.length > 0) {
			const recommendation = response.data[0];
			assert.ok(recommendation.taskId, "Should include task ID");
			assert.ok(recommendation.taskName, "Should include task name");
			assert.ok(["reschedule", "proceed", "skip", "fix_dependencies"].includes(recommendation.recommendation), "Should have valid recommendation type");
			assert.ok(recommendation.reason, "Should provide reason");
		}
	});
});

async function canConnectTcp(): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = new net.Socket();
		const timer = setTimeout(() => {
			socket.destroy();
			resolve(true);
		}, 250);

		socket.once("error", (error: NodeJS.ErrnoException) => {
			clearTimeout(timer);
			socket.destroy();
			resolve(error.code !== "EPERM");
		});

		socket.connect(9, "127.0.0.1", () => {
			clearTimeout(timer);
			socket.destroy();
			resolve(true);
		});
	});
}

async function findAvailablePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = net.createServer();
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			server.close(() => {
				if (address && typeof address === "object") {
					resolve(address.port);
					return;
				}
				reject(new Error("Failed to resolve available TCP port"));
			});
		});
	});
}

async function waitForTcpServer(
    port: number,
    timeoutMs: number,
    abortReason?: () => string | null,
    logs?: string[],
): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const reason = abortReason?.();
        if (reason) {
            const details = logs && logs.length > 0 ? `\nDaemon logs:\n${logs.join("")}` : "";
            throw new Error(`${reason}${details}`);
        }
        try {
            await new Promise<void>((resolve, reject) => {
                const socket = new net.Socket();
                socket.once("error", reject);
                socket.connect(port, "127.0.0.1", () => {
                    socket.end();
                    resolve();
                });
            });
            return;
        } catch {
            await delay(200);
        }
    }
    const details = logs && logs.length > 0 ? `\nDaemon logs:\n${logs.join("")}` : "";
    throw new Error(`Timed out waiting for TCP server on port ${port}${details}`);
}
