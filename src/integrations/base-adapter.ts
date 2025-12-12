import type { Task } from "../types.ts";
import type {
	ExternalTask,
	IntegrationAdapter,
	IntegrationConfig,
	IntegrationHealth,
	IntegrationType,
	SyncResult,
} from "./types.ts";

/**
 * Base implementation for integration adapters
 */
export abstract class BaseIntegrationAdapter implements IntegrationAdapter {
	protected config: IntegrationConfig | null = null;
	protected isInitialized = false;

	public readonly type: IntegrationType;
	public readonly name: string;

	constructor(type: IntegrationType, name: string) {
		this.type = type;
		this.name = name;
	}

	/**
	 * Initialize the adapter with configuration
	 */
	async initialize(config: IntegrationConfig): Promise<void> {
		console.log(`[INTEGRATION-${this.type.toUpperCase()}] Initializing ${this.name} adapter...`);

		try {
			await this.validateConfig(config);
			this.config = config;
			await this.onInitialize();
			this.isInitialized = true;

			console.log(
				`[INTEGRATION-${this.type.toUpperCase()}] ${this.name} adapter initialized successfully`,
			);
		} catch (error) {
			console.error(
				`[INTEGRATION-${this.type.toUpperCase()}] Failed to initialize ${this.name} adapter:`,
				error,
			);
			throw error;
		}
	}

	/**
	 * Test connection to external service
	 */
	async testConnection(): Promise<boolean> {
		if (!this.isInitialized || !this.config) {
			throw new Error(`${this.name} adapter not initialized`);
		}

		try {
			const result = await this.onTestConnection();
			console.log(
				`[INTEGRATION-${this.type.toUpperCase()}] Connection test ${result ? "passed" : "failed"}`,
			);
			return result;
		} catch (error) {
			console.error(`[INTEGRATION-${this.type.toUpperCase()}] Connection test failed:`, error);
			return false;
		}
	}

	/**
	 * Perform health check
	 */
	async healthCheck(): Promise<IntegrationHealth> {
		if (!this.isInitialized || !this.config) {
			return {
				integrationId: this.config?.id || "unknown",
				status: "error",
				lastCheck: new Date(),
				lastError: "Adapter not initialized",
			};
		}

		const startTime = Date.now();

		try {
			const isHealthy = await this.onHealthCheck();
			const responseTime = Date.now() - startTime;

			return {
				integrationId: this.config.id,
				status: isHealthy ? "connected" : "error",
				lastCheck: new Date(),
				responseTime,
				metrics: await this.getMetrics(),
			};
		} catch (error) {
			const responseTime = Date.now() - startTime;

			return {
				integrationId: this.config.id,
				status: "error",
				lastCheck: new Date(),
				responseTime,
				lastError: (error as Error).message,
				metrics: await this.getMetrics(),
			};
		}
	}

	/**
	 * Sync tasks from external service (inbound)
	 */
	async syncInbound(lastSyncAt?: Date): Promise<ExternalTask[]> {
		if (!this.isInitialized || !this.config) {
			throw new Error(`${this.name} adapter not initialized`);
		}

		if (this.config.syncDirection === "outbound") {
			console.log(`[INTEGRATION-${this.type.toUpperCase()}] Inbound sync disabled, skipping`);
			return [];
		}

		console.log(
			`[INTEGRATION-${this.type.toUpperCase()}] Starting inbound sync${lastSyncAt ? ` since ${lastSyncAt.toISOString()}` : " (full sync)"}`,
		);

		try {
			const tasks = await this.onSyncInbound(lastSyncAt);
			console.log(
				`[INTEGRATION-${this.type.toUpperCase()}] Inbound sync completed: ${tasks.length} tasks fetched`,
			);
			return tasks;
		} catch (error) {
			console.error(`[INTEGRATION-${this.type.toUpperCase()}] Inbound sync failed:`, error);
			throw error;
		}
	}

	/**
	 * Sync tasks to external service (outbound)
	 */
	async syncOutbound(tasks: Task[]): Promise<SyncResult> {
		if (!this.isInitialized || !this.config) {
			throw new Error(`${this.name} adapter not initialized`);
		}

		if (this.config.syncDirection === "inbound") {
			console.log(`[INTEGRATION-${this.type.toUpperCase()}] Outbound sync disabled, skipping`);
			return {
				success: true,
				integrationId: this.config.id,
				syncType: "incremental",
				direction: "outbound",
				processed: 0,
				created: 0,
				updated: 0,
				deleted: 0,
				errors: [],
				duration: 0,
				syncedAt: new Date(),
			};
		}

		console.log(
			`[INTEGRATION-${this.type.toUpperCase()}] Starting outbound sync for ${tasks.length} tasks`,
		);

		const startTime = Date.now();
		const result: SyncResult = {
			success: true,
			integrationId: this.config.id,
			syncType: "incremental",
			direction: "outbound",
			processed: 0,
			created: 0,
			updated: 0,
			deleted: 0,
			errors: [],
			duration: 0,
			syncedAt: new Date(),
		};

		try {
			for (const task of tasks) {
				try {
					const syncResult = await this.onSyncSingleTask(task);
					result.processed++;

					if (syncResult.created) {
						result.created++;
					} else if (syncResult.updated) {
						result.updated++;
					}
				} catch (error) {
					const errorMsg = `Failed to sync task ${task.id}: ${(error as Error).message}`;
					result.errors.push(errorMsg);
					console.error(`[INTEGRATION-${this.type.toUpperCase()}] ${errorMsg}`);
				}
			}

			result.duration = Date.now() - startTime;
			result.success = result.errors.length === 0;

			console.log(
				`[INTEGRATION-${this.type.toUpperCase()}] Outbound sync completed: ${result.processed} processed, ${result.created} created, ${result.updated} updated, ${result.errors.length} errors`,
			);

			return result;
		} catch (error) {
			result.duration = Date.now() - startTime;
			result.success = false;
			result.errors.push(`Sync failed: ${(error as Error).message}`);

			console.error(`[INTEGRATION-${this.type.toUpperCase()}] Outbound sync failed:`, error);
			return result;
		}
	}

	/**
	 * Create external task from local task
	 */
	async createExternalTask(task: Task): Promise<ExternalTask> {
		if (!this.isInitialized || !this.config) {
			throw new Error(`${this.name} adapter not initialized`);
		}

		console.log(
			`[INTEGRATION-${this.type.toUpperCase()}] Creating external task from local task: ${task.id}`,
		);

		try {
			const externalTask = await this.onCreateExternalTask(task);
			console.log(
				`[INTEGRATION-${this.type.toUpperCase()}] Created external task: ${externalTask.id}`,
			);
			return externalTask;
		} catch (error) {
			console.error(
				`[INTEGRATION-${this.type.toUpperCase()}] Failed to create external task:`,
				error,
			);
			throw error;
		}
	}

	/**
	 * Update external task from local task
	 */
	async updateExternalTask(task: Task, externalId: string): Promise<ExternalTask> {
		if (!this.isInitialized || !this.config) {
			throw new Error(`${this.name} adapter not initialized`);
		}

		console.log(
			`[INTEGRATION-${this.type.toUpperCase()}] Updating external task ${externalId} from local task: ${task.id}`,
		);

		try {
			const externalTask = await this.onUpdateExternalTask(task, externalId);
			console.log(
				`[INTEGRATION-${this.type.toUpperCase()}] Updated external task: ${externalTask.id}`,
			);
			return externalTask;
		} catch (error) {
			console.error(
				`[INTEGRATION-${this.type.toUpperCase()}] Failed to update external task:`,
				error,
			);
			throw error;
		}
	}

	/**
	 * Delete external task
	 */
	async deleteExternalTask(externalId: string): Promise<void> {
		if (!this.isInitialized || !this.config) {
			throw new Error(`${this.name} adapter not initialized`);
		}

		console.log(`[INTEGRATION-${this.type.toUpperCase()}] Deleting external task: ${externalId}`);

		try {
			await this.onDeleteExternalTask(externalId);
			console.log(`[INTEGRATION-${this.type.toUpperCase()}] Deleted external task: ${externalId}`);
		} catch (error) {
			console.error(
				`[INTEGRATION-${this.type.toUpperCase()}] Failed to delete external task:`,
				error,
			);
			throw error;
		}
	}

	/**
	 * Handle webhook from external service
	 */
	async handleWebhook(payload: Record<string, unknown>, signature?: string): Promise<void> {
		if (!this.isInitialized || !this.config) {
			throw new Error(`${this.name} adapter not initialized`);
		}

		console.log(`[INTEGRATION-${this.type.toUpperCase()}] Processing webhook payload`);

		try {
			await this.validateWebhook(payload, signature);
			await this.onHandleWebhook(payload);
			console.log(`[INTEGRATION-${this.type.toUpperCase()}] Webhook processed successfully`);
		} catch (error) {
			console.error(`[INTEGRATION-${this.type.toUpperCase()}] Webhook processing failed:`, error);
			throw error;
		}
	}

	/**
	 * Cleanup resources
	 */
	async cleanup(): Promise<void> {
		console.log(`[INTEGRATION-${this.type.toUpperCase()}] Cleaning up ${this.name} adapter...`);

		try {
			await this.onCleanup();
			this.isInitialized = false;
			this.config = null;

			console.log(
				`[INTEGRATION-${this.type.toUpperCase()}] ${this.name} adapter cleaned up successfully`,
			);
		} catch (error) {
			console.error(`[INTEGRATION-${this.type.toUpperCase()}] Cleanup failed:`, error);
			throw error;
		}
	}

	// Abstract methods that must be implemented by concrete adapters
	/* eslint-disable no-unused-vars */
	protected abstract onInitialize(): Promise<void>;
	protected abstract onTestConnection(): Promise<boolean>;
	protected abstract onHealthCheck(): Promise<boolean>;
	protected abstract onSyncInbound(lastSyncAt?: Date): Promise<ExternalTask[]>;
	protected abstract onSyncSingleTask(task: Task): Promise<{ created: boolean; updated: boolean }>;
	protected abstract onCreateExternalTask(task: Task): Promise<ExternalTask>;
	protected abstract onUpdateExternalTask(task: Task, externalId: string): Promise<ExternalTask>;
	protected abstract onDeleteExternalTask(externalId: string): Promise<void>;
	protected abstract onHandleWebhook(payload: Record<string, unknown>): Promise<void>;
	protected abstract onCleanup(): Promise<void>;
	/* eslint-enable no-unused-vars */

	// Optional methods with default implementations
	protected async validateConfig(config: IntegrationConfig): Promise<void> {
		// Basic validation - can be overridden by subclasses
		if (!config.credentials) {
			throw new Error("Credentials are required");
		}
	}

	protected async validateWebhook(
		_payload: Record<string, unknown>,
		_signature?: string,
	): Promise<void> {
		void _payload;
		void _signature;
		// Default implementation - can be overridden by subclasses
		// In a real implementation, this would verify webhook signatures
	}

	protected async getMetrics(): Promise<IntegrationHealth["metrics"]> {
		// Default implementation - can be overridden by subclasses
		return {
			syncsCompleted: 0,
			syncsFailed: 0,
			averageSyncTime: 0,
			lastSyncDuration: 0,
		};
	}

	// Helper methods
	protected mapTaskStatus(status: string): string {
		// Default status mapping - can be overridden by subclasses
		const statusMap: Record<string, string> = {
			todo: "open",
			"in-progress": "in_progress",
			done: "closed",
		};

		return statusMap[status] || status;
	}

	protected mapTaskPriority(priority: string): string {
		// Default priority mapping - can be overridden by subclasses
		const priorityMap: Record<string, string> = {
			low: "low",
			medium: "medium",
			high: "high",
		};

		return priorityMap[priority] || priority;
	}

	protected createExternalTaskFromTask(task: Task, externalId: string, url?: string): ExternalTask {
		return {
			id: `external-${this.type}-${externalId}`,
			source: this.type,
			sourceId: externalId,
			title: task.title,
			description: task.description,
			status: this.mapTaskStatus(task.status),
			priority: this.mapTaskPriority(task.priority),
			assignee: task.assignedTo || undefined,
			createdAt: task.createdAt,
			updatedAt: task.updatedAt,
			url,
		};
	}

	protected async sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	protected async retryWithBackoff<T>(
		operation: () => Promise<T>,
		maxRetries: number = 3,
		baseDelay: number = 1000,
	): Promise<T> {
		let lastError: Error;

		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			try {
				return await operation();
			} catch (error) {
				lastError = error as Error;

				if (attempt === maxRetries) {
					break;
				}

				const delay = baseDelay * 2 ** attempt;
				console.log(
					`[INTEGRATION-${this.type.toUpperCase()}] Retry ${attempt + 1}/${maxRetries} after ${delay}ms`,
				);
				await this.sleep(delay);
			}
		}

		throw lastError ?? new Error("Unknown adapter error");
	}
}
