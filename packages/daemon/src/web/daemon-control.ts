import type { IncomingMessage, ServerResponse } from "node:http";
import { DaemonTcpClient } from "./tcp-client.ts";

/**
 * Daemon Control API Extensions
 * Adds pause/resume/stop functionality to the dashboard
 */
export class DaemonControlExtensions {
	private tcpClient: DaemonTcpClient;

	constructor(tcpClient: DaemonTcpClient) {
		this.tcpClient = tcpClient;
	}

	/**
	 * Pause daemon task processing
	 */
	async pauseDaemon(_req: IncomingMessage, res: ServerResponse): Promise<void> {
		try {
			const result = await this.tcpClient.sendCommand("pause_daemon", {});
			
			if (result.success) {
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify({
					success: true,
					message: "Daemon paused successfully",
					data: result.data
				}));
			} else {
				res.writeHead(400, { "Content-Type": "application/json" });
				res.end(JSON.stringify({
					success: false,
					error: result.error?.message || "Failed to pause daemon"
				}));
			}
		} catch (error) {
			res.writeHead(500, { "Content-Type": "application/json" });
			res.end(JSON.stringify({
				success: false,
				error: error instanceof Error ? error.message : "Internal server error"
			}));
		}
	}

	/**
	 * Resume daemon task processing
	 */
	async resumeDaemon(_req: IncomingMessage, res: ServerResponse): Promise<void> {
		try {
			const result = await this.tcpClient.sendCommand("resume_daemon", {});
			
			if (result.success) {
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify({
					success: true,
					message: "Daemon resumed successfully",
					data: result.data
				}));
			} else {
				res.writeHead(400, { "Content-Type": "application/json" });
				res.end(JSON.stringify({
					success: false,
					error: result.error?.message || "Failed to resume daemon"
				}));
			}
		} catch (error) {
			res.writeHead(500, { "Content-Type": "application/json" });
			res.end(JSON.stringify({
				success: false,
				error: error instanceof Error ? error.message : "Internal server error"
			}));
		}
	}

	/**
	 * Get current daemon status
	 */
	async getDaemonStatus(_req: IncomingMessage, res: ServerResponse): Promise<void> {
		try {
			const result = await this.tcpClient.sendCommand("get_daemon_status", {});
			
			if (result.success) {
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify({
					success: true,
					data: result.data
				}));
			} else {
				res.writeHead(400, { "Content-Type": "application/json" });
				res.end(JSON.stringify({
					success: false,
					error: result.error?.message || "Failed to get daemon status"
				}));
			}
		} catch (error) {
			res.writeHead(500, { "Content-Type": "application/json" });
			res.end(JSON.stringify({
				success: false,
				error: error instanceof Error ? error.message : "Internal server error"
			}));
		}
	}

	/**
	 * Stop daemon gracefully
	 */
	async stopDaemon(_req: IncomingMessage, res: ServerResponse): Promise<void> {
		try {
			const result = await this.tcpClient.sendCommand("stop_daemon", {});
			
			if (result.success) {
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify({
					success: true,
					message: "Daemon stop initiated",
					data: result.data
				}));
			} else {
				res.writeHead(400, { "Content-Type": "application/json" });
				res.end(JSON.stringify({
					success: false,
					error: result.error?.message || "Failed to stop daemon"
				}));
			}
		} catch (error) {
			res.writeHead(500, { "Content-Type": "application/json" });
			res.end(JSON.stringify({
				success: false,
				error: error instanceof Error ? error.message : "Internal server error"
			}));
		}
	}

	/**
	 * Get enhanced daemon metrics with performance data
	 */
	async getEnhancedMetrics(_req: IncomingMessage, res: ServerResponse): Promise<void> {
		try {
			// Get basic daemon status
			const statusResult = await this.tcpClient.sendCommand("get_daemon_status", {});
			
			// Get tasks for performance metrics
			const tasksResult = await this.tcpClient.sendCommand("list_tasks", {});
			
		if (statusResult.success && tasksResult.success) {
			const tasks = (tasksResult.data as any[]) || [];
			const status = statusResult.data as any;
				
				// Calculate performance metrics
				const completedTasks = tasks.filter((t: any) => t.status === "done");
				const avgProcessingTime = this.calculateAverageProcessingTime(completedTasks);
				const throughput = this.calculateThroughput(completedTasks, status.uptime || 0);
				
				const enhancedMetrics = {
					...status,
					performance: {
						averageProcessingTime: avgProcessingTime,
						throughputPerHour: throughput,
						completionRate: tasks.length > 0 ? (completedTasks.length / tasks.length) * 100 : 0,
						totalProcessed: completedTasks.length
					},
					tasks: {
						total: tasks.length,
						pending: tasks.filter((t: any) => t.status === "todo").length,
						inProgress: tasks.filter((t: any) => t.status === "in-progress").length,
						completed: completedTasks.length,
						failed: tasks.filter((t: any) => t.status === "failed").length,
						cancelled: tasks.filter((t: any) => t.status === "cancelled").length,
						byPriority: {
							high: tasks.filter((t: any) => t.priority === "high").length,
							medium: tasks.filter((t: any) => t.priority === "medium").length,
							low: tasks.filter((t: any) => t.priority === "low").length,
						}
					},
					timestamp: new Date().toISOString()
				};

				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify({
					success: true,
					data: enhancedMetrics
				}));
			} else {
				res.writeHead(400, { "Content-Type": "application/json" });
				res.end(JSON.stringify({
					success: false,
					error: "Failed to get enhanced metrics"
				}));
			}
		} catch (error) {
			res.writeHead(500, { "Content-Type": "application/json" });
			res.end(JSON.stringify({
				success: false,
				error: error instanceof Error ? error.message : "Internal server error"
			}));
		}
	}

	/**
	 * Calculate average processing time for completed tasks
	 */
	private calculateAverageProcessingTime(completedTasks: any[]): number {
		if (completedTasks.length === 0) return 0;
		
		const totalTime = completedTasks.reduce((sum, task) => {
			const created = new Date(task.createdAt).getTime();
			const updated = new Date(task.updatedAt).getTime();
			return sum + (updated - created);
		}, 0);
		
		return Math.round(totalTime / completedTasks.length / 1000); // Return in seconds
	}

	/**
	 * Calculate task throughput per hour
	 */
	private calculateThroughput(completedTasks: any[], uptime: number): number {
		if (completedTasks.length === 0 || uptime === 0) return 0;
		
		const uptimeHours = uptime / 3600;
		return Math.round(completedTasks.length / uptimeHours);
	}
}