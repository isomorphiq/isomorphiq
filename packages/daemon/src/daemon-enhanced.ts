import { ProcessManager } from "./services/process-manager.ts";

// Enhanced Daemon Process with improved lifecycle management
class EnhancedDaemon {
	private processManager: ProcessManager;
	private isShuttingDown = false;

	constructor() {
		this.processManager = new ProcessManager({
			daemonPort: Number(process.env.TCP_PORT) || 3001,
			healthCheckInterval: 30000,
			maxRestarts: 5,
			restartDelay: 5000,
		});

		this.setupSignalHandlers();
	}

	// Setup signal handlers for graceful shutdown
	private setupSignalHandlers(): void {
		const signals = ["SIGTERM", "SIGINT", "SIGUSR2"];

		signals.forEach((signal) => {
			process.on(signal, async () => {
				console.log(`[DAEMON] Received ${signal}, starting graceful shutdown...`);
				await this.shutdown();
				process.exit(0);
			});
		});

		process.on("uncaughtException", async (error) => {
			console.error("[DAEMON] Uncaught exception:", error);
			await this.shutdown();
			process.exit(1);
		});

		process.on("unhandledRejection", async (reason, promise) => {
			console.error("[DAEMON] Unhandled rejection at:", promise, "reason:", reason);
			await this.shutdown();
			process.exit(1);
		});
	}

	// Initialize and start the daemon
	async start(): Promise<void> {
		console.log("[DAEMON] Starting Enhanced Isomorphiq Task Manager Daemon");

		try {
			// Initialize process manager
			await this.processManager.initialize();

			// Register external processes if configured
			this.registerExternalProcesses();

			// Start monitoring
			this.startMonitoring();

			console.log("[DAEMON] Enhanced daemon started successfully");
			console.log("[DAEMON] Services running:");
			console.log("  - Process Manager (core)");
			console.log("  - HTTP API Server");
			console.log("  - WebSocket Server");
			console.log("  - Task Processing Loop");
			console.log("  - Command Server");
		} catch (error) {
			console.error("[DAEMON] Failed to start daemon:", error);
			await this.shutdown();
			process.exit(1);
		}
	}

	// Register external processes (if any)
	private registerExternalProcesses(): void {
		// Example: Register MCP server as external process
		this.processManager.registerProcess({
			name: "mcp-server",
			command: "node",
			args: ["packages/mcp/src/mcp-server.ts"],
			autoRestart: true,
			healthCheck: {
				port: 3000, // Assuming MCP server has health endpoint
				path: "/health",
				interval: 30000,
			},
		});

		// Example: Register web dashboard as external process
		this.processManager.registerProcess({
			name: "web-dashboard",
			command: "yarn",
			args: ["run", "web:dev"],
			autoRestart: true,
			healthCheck: {
				port: 3000, // Assuming web dashboard runs on port 3000
				path: "/",
				interval: 30000,
			},
			dependencies: ["daemon"], // Wait for daemon to start
		});
	}

	// Start monitoring and logging
	private startMonitoring(): void {
		// Log process status changes
		this.processManager.on("processStarting", (name) => {
			console.log(`[DAEMON] Process starting: ${name}`);
		});

		this.processManager.on("processStarted", (name, pid) => {
			console.log(`[DAEMON] Process started: ${name} (PID: ${pid})`);
		});

		this.processManager.on("processStopping", (name) => {
			console.log(`[DAEMON] Process stopping: ${name}`);
		});

		this.processManager.on("processStopped", (name, code, signal) => {
			console.log(`[DAEMON] Process stopped: ${name} (code: ${code}, signal: ${signal})`);
		});

		this.processManager.on("processError", (name, error) => {
			console.error(`[DAEMON] Process error: ${name} - ${error.message}`);
		});

		this.processManager.on("healthCheck", (name, health) => {
			if (health === "unhealthy") {
				console.warn(`[DAEMON] Health check failed: ${name}`);
			}
		});

		// Periodic status logging
		setInterval(() => {
			this.logSystemStatus();
		}, 60000); // Every minute
	}

	// Log overall system status
	private logSystemStatus(): void {
		const statuses = this.processManager.getAllStatuses();
		const running = Object.values(statuses).filter((s) => s.status === "running").length;
		const total = Object.keys(statuses).length;

		console.log(`[DAEMON] System Status: ${running}/${total} processes running`);

		// Log memory usage
		const memUsage = process.memoryUsage();
		console.log(
			`[DAEMON] Memory: RSS=${Math.round(memUsage.rss / 1024 / 1024)}MB, Heap=${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
		);
	}

	// Graceful shutdown
	async shutdown(): Promise<void> {
		if (this.isShuttingDown) {
			console.log("[DAEMON] Shutdown already in progress");
			return;
		}

		this.isShuttingDown = true;
		console.log("[DAEMON] Starting graceful shutdown...");

		try {
			await this.processManager.shutdown();
			console.log("[DAEMON] Graceful shutdown completed");
		} catch (error) {
			console.error("[DAEMON] Error during shutdown:", error);
		}
	}

	// Get system status for external queries
	getSystemStatus(): Record<string, unknown> {
		return {
			daemon: {
				pid: process.pid,
				uptime: process.uptime(),
				memory: process.memoryUsage(),
				isShuttingDown: this.isShuttingDown,
			},
			processes: this.processManager.getAllStatuses(),
		};
	}

	// Get detailed system health status
	getHealthStatus(): Record<string, unknown> {
		const memUsage = process.memoryUsage();
		const memoryUsagePercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
		
		let healthStatus = "healthy";
		if (memoryUsagePercent > 90) {
			healthStatus = "unhealthy";
		} else if (memoryUsagePercent > 70 || this.isShuttingDown) {
			healthStatus = "degraded";
		}

		return {
			status: healthStatus,
			timestamp: new Date().toISOString(),
			daemon: {
				pid: process.pid,
				uptime: process.uptime(),
				isShuttingDown: this.isShuttingDown,
				memory: {
					used: memUsage.heapUsed,
					total: memUsage.heapTotal,
					percentage: Math.round(memoryUsagePercent),
				},
			},
			system: {
				nodeVersion: process.version,
				platform: process.platform,
				arch: process.arch,
				totalmem: require("os").totalmem(),
				freemem: require("os").freemem(),
			},
		};
	}

	// Get task processing statistics
	getTaskStats(): Record<string, unknown> {
		// This would ideally get stats from the process manager's productManager
		// For now, return a placeholder that can be enhanced
		return {
			totalProcessed: 0,
			processingRate: 0,
			averageProcessingTime: 0,
			lastUpdated: new Date().toISOString(),
		};
	}

	// Get real-time metrics for dashboard
	getRealTimeMetrics(): Record<string, unknown> {
		const memUsage = process.memoryUsage();
		const cpuUsage = process.cpuUsage();
		
		return {
			daemon: {
				pid: process.pid,
				uptime: process.uptime(),
				memory: memUsage,
				cpu: cpuUsage,
			},
			processes: this.processManager.getAllStatuses(),
			health: this.getHealthStatus(),
			timestamp: new Date().toISOString(),
		};
	}
}

// Main function
async function main(): Promise<void> {
	const daemon = new EnhancedDaemon();
	await daemon.start();
}

// Handle command line arguments
const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
	console.log(`
Enhanced Isomorphiq Task Manager Daemon

Usage: node src/daemon.ts [options]

Options:
  --help, -h     Show this help message
  --version, -v  Show version information

Environment Variables:
  TCP_PORT       Command server port (default: 3001)
  HTTP_PORT      HTTP API server port (default: 3003)
  NODE_ENV       Environment (development/production)

Signals:
  SIGTERM, SIGINT  Graceful shutdown
  SIGUSR2          Restart daemon
`);
	process.exit(0);
}

if (args.includes("--version") || args.includes("-v")) {
	console.log("Enhanced Isomorphiq Task Manager Daemon v1.0.0");
	process.exit(0);
}

// Start the daemon
if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		console.error("[DAEMON] Fatal error:", error);
		process.exit(1);
	});
}

export { EnhancedDaemon };
