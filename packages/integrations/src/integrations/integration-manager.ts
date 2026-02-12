// TODO: This file is too complex (668 lines) and should be refactored into several modules.
// Current concerns mixed: Integration lifecycle, adapter management, sync orchestration,
// health monitoring, task mapping, configuration validation.
// 
// Proposed structure:
// - integrations/manager/index.ts - Main integration manager
// - integrations/manager/lifecycle-service.ts - Integration CRUD operations
// - integrations/manager/adapter-registry.ts - Adapter registration and management
// - integrations/manager/sync-orchestrator.ts - Synchronization coordination
// - integrations/manager/health-monitor.ts - Integration health checking
// - integrations/manager/task-mapper.ts - Task mapping and transformation
// - integrations/manager/config-validator.ts - Configuration validation
// - integrations/manager/types.ts - Manager-specific types

import { NotFoundError, ValidationError, type Result } from "@isomorphiq/core";
import type { IIntegrationRepository } from "./integration-repository.ts";
import type {
	ExternalTask,
	IIntegrationManager,
	IntegrationAdapter,
	IntegrationConfig,
	IntegrationConfigInput,
	IntegrationHealth,
	IntegrationType,
	IntegrationTask,
	SyncResult,
	TaskMapping,
} from "./types.ts";

/**
 * Main integration manager that orchestrates all external integrations
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class IntegrationManager implements IIntegrationManager {
	private adapters = new Map<IntegrationType, IntegrationAdapter>();
	private syncIntervals = new Map<string, NodeJS.Timeout>();

	private repository: IIntegrationRepository;

	constructor(repository: IIntegrationRepository) {
		this.repository = repository;
	}

	// Integration lifecycle
	async createIntegration(
		config: IntegrationConfigInput,
	): Promise<Result<IntegrationConfig>> {
		try {
			// Validate configuration
			const validationResult = this.validateIntegrationConfig(config);
			if (!validationResult.success) {
				return { success: false, error: validationResult.error };
			}

			// Create integration
			const result = await this.repository.create(config);
			if (!result.success) {
				return result;
			}

			const integration = result.data;

			// Initialize adapter if enabled
			if (integration.enabled) {
				await this.initializeAdapter(integration);
			}

			// Start auto-sync if configured
			if (integration.enabled && integration.settings.autoSync) {
				this.startAutoSync(integration);
			}

			console.log(
				`[INTEGRATION-MANAGER] Created integration: ${integration.name} (${integration.type})`,
			);
			return { success: true, data: integration };
		} catch (error) {
			console.error("[INTEGRATION-MANAGER] Failed to create integration:", error);
			return {
				success: false,
				error: error as Error,
			};
		}
	}

	async updateIntegration(
		id: string,
		updates: Partial<IntegrationConfig>,
	): Promise<Result<IntegrationConfig>> {
			try {
				// Get existing integration
				const existingResult = await this.repository.findById(id);
				if (!existingResult.success) {
					return { success: false, error: existingResult.error };
				}

			const existing = existingResult.data;
			if (!existing) {
				return {
					success: false,
					error: new NotFoundError("Integration", id),
				};
			}

			// Stop auto-sync if running
			this.stopAutoSync(id);

			// Cleanup existing adapter
			const existingAdapter = this.adapters.get(existing.type);
			if (existingAdapter) {
				await existingAdapter.cleanup().catch(console.error);
			}

			// Update integration
			const result = await this.repository.update(id, updates);
			if (!result.success) {
				return result;
			}

			const updated = result.data;

			// Reinitialize adapter if enabled
			if (updated.enabled) {
				await this.initializeAdapter(updated);

				// Start auto-sync if configured
				if (updated.settings.autoSync) {
					this.startAutoSync(updated);
				}
			}

			console.log(`[INTEGRATION-MANAGER] Updated integration: ${updated.name}`);
			return { success: true, data: updated };
		} catch (error) {
			console.error("[INTEGRATION-MANAGER] Failed to update integration:", error);
			return {
				success: false,
				error: error as Error,
			};
		}
	}

	async deleteIntegration(id: string): Promise<Result<void>> {
		try {
			// Stop auto-sync
			this.stopAutoSync(id);

			// Get integration for cleanup
			const integrationResult = await this.repository.findById(id);
			if (integrationResult.success && integrationResult.data) {
				const integration = integrationResult.data;

				// Cleanup adapter
				const adapter = this.adapters.get(integration.type);
				if (adapter) {
					await adapter.cleanup().catch(console.error);
					this.adapters.delete(integration.type);
				}
			}

			// Delete from repository
			const result = await this.repository.delete(id);
			if (!result.success) {
				return result;
			}

			console.log(`[INTEGRATION-MANAGER] Deleted integration: ${id}`);
			return { success: true, data: undefined };
		} catch (error) {
			console.error("[INTEGRATION-MANAGER] Failed to delete integration:", error);
			return {
				success: false,
				error: error as Error,
			};
		}
	}

	async getIntegration(id: string): Promise<Result<IntegrationConfig>> {
		const result = await this.repository.findById(id);

		if (!result.success) {
			return result;
		}

		if (!result.data) {
			return {
				success: false,
				error: new NotFoundError("Integration", id),
			};
		}

		return { success: true, data: result.data };
	}

	async getAllIntegrations(): Promise<Result<IntegrationConfig[]>> {
		return await this.repository.findAll();
	}

	async getIntegrationsByType(type: IntegrationType): Promise<Result<IntegrationConfig[]>> {
		return await this.repository.findByType(type);
	}

	// Integration control
	async enableIntegration(id: string): Promise<Result<void>> {
		return await this.updateIntegration(id, { enabled: true }).then(() => ({
			success: true,
			data: undefined,
		}));
	}

	async disableIntegration(id: string): Promise<Result<void>> {
		return await this.updateIntegration(id, { enabled: false }).then(() => ({
			success: true,
			data: undefined,
		}));
	}

	async testConnection(id: string): Promise<Result<boolean>> {
		try {
			const integrationResult = await this.getIntegration(id);
			if (!integrationResult.success) {
				return { success: false, error: integrationResult.error };
			}

			const integration = integrationResult.data;
			const adapter = this.adapters.get(integration.type);

			if (!adapter) {
				// Initialize adapter temporarily for testing
				await this.initializeAdapter(integration);
				const tempAdapter = this.adapters.get(integration.type);
				if (!tempAdapter) {
					return {
						success: false,
						error: new Error("Failed to initialize adapter for testing"),
					};
				}

				const result = await tempAdapter.testConnection();
				await tempAdapter.cleanup();
				this.adapters.delete(integration.type);

				return { success: true, data: result };
			}

			const result = await adapter.testConnection();
			return { success: true, data: result };
		} catch (error) {
			console.error("[INTEGRATION-MANAGER] Connection test failed:", error);
			return {
				success: false,
				error: error as Error,
			};
		}
	}

	// Sync operations
	async syncIntegration(
		id: string,
		syncType: "full" | "incremental" = "incremental",
	): Promise<Result<SyncResult>> {
		try {
			const integrationResult = await this.getIntegration(id);
			if (!integrationResult.success) {
				return { success: false, error: integrationResult.error };
			}

			const integration = integrationResult.data;
			const adapter = this.adapters.get(integration.type);

			if (!adapter) {
				return {
					success: false,
					error: new Error("No adapter found for integration type"),
				};
			}

			console.log(`[INTEGRATION-MANAGER] Starting ${syncType} sync for ${integration.name}`);

			// Update integration status to syncing
			await this.repository.update(id, { status: "syncing" });

			try {
				let syncResult: SyncResult;

				if (
					integration.syncDirection === "inbound" ||
					integration.syncDirection === "bidirectional"
				) {
					// Perform inbound sync
					const lastSyncAt = syncType === "full" ? undefined : integration.lastSyncAt;
					const externalTasks = await adapter.syncInbound(lastSyncAt);

					// Process inbound tasks (create/update local tasks)
					await this.processInboundTasks(externalTasks, integration);
				}

				if (
					integration.syncDirection === "outbound" ||
					integration.syncDirection === "bidirectional"
				) {
					// Perform outbound sync
					// Get tasks that need syncing
					const tasksToSync = await this.getTasksToSync(integration);
					syncResult = await adapter.syncOutbound(tasksToSync);
				} else {
					// Create a basic sync result for inbound-only sync
					syncResult = {
						success: true,
						integrationId: id,
						syncType,
						direction: "inbound",
						processed: 0,
						created: 0,
						updated: 0,
						deleted: 0,
						errors: [],
						duration: 0,
						syncedAt: new Date(),
					};
				}

				// Update integration with sync results
				await this.repository.update(id, {
					status: syncResult.success ? "connected" : "error",
					lastSyncAt: syncResult.syncedAt,
					errorMessage: syncResult.success ? undefined : syncResult.errors.join("; "),
				});

				console.log(
					`[INTEGRATION-MANAGER] Sync completed for ${integration.name}: ${syncResult.processed} processed`,
				);
				return { success: true, data: syncResult };
			} catch (error) {
				// Update integration status to error
				await this.repository.update(id, {
					status: "error",
					errorMessage: (error as Error).message,
				});

				throw error;
			}
		} catch (error) {
			console.error("[INTEGRATION-MANAGER] Sync failed:", error);
			return {
				success: false,
				error: error as Error,
			};
		}
	}

	async syncAllIntegrations(): Promise<Result<SyncResult[]>> {
		try {
			const allIntegrationsResult = await this.getAllIntegrations();
			if (!allIntegrationsResult.success) {
				return { success: false, error: allIntegrationsResult.error };
			}

			const enabledIntegrations = allIntegrationsResult.data.filter((i) => i.enabled);
				const syncPromises = enabledIntegrations.map(async (integration) => {
					try {
						const res = await this.syncIntegration(integration.id);
						if (res.success && res.data) {
							return res.data;
						}
						return {
							success: false,
							integrationId: integration.id,
							syncType: "incremental" as const,
							direction: "bidirectional" as const,
							processed: 0,
							created: 0,
							updated: 0,
							deleted: 0,
							errors: [res.error ? String(res.error) : "Unknown sync error"],
							duration: 0,
							syncedAt: new Date(),
						} as SyncResult;
					} catch (error) {
						return {
							success: false,
							integrationId: integration.id,
							syncType: "incremental" as const,
							direction: "bidirectional" as const,
							processed: 0,
							created: 0,
							updated: 0,
							deleted: 0,
							errors: [(error as Error).message],
							duration: 0,
							syncedAt: new Date(),
						} as SyncResult;
					}
				});

				const syncResults = await Promise.all(syncPromises);

			return { success: true, data: syncResults };
		} catch (error) {
			console.error("[INTEGRATION-MANAGER] Failed to sync all integrations:", error);
			return {
				success: false,
				error: error as Error,
			};
		}
	}

		// Health monitoring
		async checkIntegrationHealth(id: string): Promise<Result<IntegrationHealth>> {
			try {
				const integrationResult = await this.getIntegration(id);
				if (!integrationResult.success) {
					return { success: false, error: integrationResult.error };
				}

			const integration = integrationResult.data;
			const adapter = this.adapters.get(integration.type);

			if (!adapter) {
				return {
					success: false,
					error: new Error("No adapter found for integration type"),
				};
			}

			const health = await adapter.healthCheck();
			return { success: true, data: health };
		} catch (error) {
			console.error("[INTEGRATION-MANAGER] Health check failed:", error);
			return {
				success: false,
				error: error as Error,
			};
		}
	}

		async checkAllIntegrationsHealth(): Promise<Result<IntegrationHealth[]>> {
			try {
				const allIntegrationsResult = await this.getAllIntegrations();
				if (!allIntegrationsResult.success) {
					return { success: false, error: allIntegrationsResult.error };
				}

			const enabledIntegrations = allIntegrationsResult.data.filter((i) => i.enabled);
				const healthPromises = enabledIntegrations.map(async (integration) => {
					try {
						const res = await this.checkIntegrationHealth(integration.id);
						if (res.success && res.data) {
							return res.data;
						}
						return {
							integrationId: integration.id,
							status: "error" as const,
							lastCheck: new Date(),
							lastError: res.error ? String(res.error) : "Unknown health error",
						} as IntegrationHealth;
					} catch (error) {
						return {
							integrationId: integration.id,
							status: "error" as const,
							lastCheck: new Date(),
							lastError: (error as Error).message,
						} as IntegrationHealth;
					}
				});

				const healthResults = await Promise.all(healthPromises);

			return { success: true, data: healthResults };
		} catch (error) {
			console.error("[INTEGRATION-MANAGER] Failed to check all integrations health:", error);
			return {
				success: false,
				error: error as Error,
			};
		}
	}

	// Event handling
	async handleWebhook(
		type: IntegrationType,
		payload: Record<string, unknown>,
		signature?: string,
	): Promise<Result<void>> {
		try {
			const adapter = this.adapters.get(type);
			if (!adapter) {
				return {
					success: false,
					error: new Error(`No adapter found for integration type: ${type}`),
				};
			}

			await adapter.handleWebhook(payload, signature);
			console.log(`[INTEGRATION-MANAGER] Processed webhook for ${type} integration`);
			return { success: true, data: undefined };
		} catch (error) {
			console.error("[INTEGRATION-MANAGER] Webhook handling failed:", error);
			return {
				success: false,
				error: error as Error,
			};
		}
	}

	// Adapter management
	registerAdapter(adapter: IntegrationAdapter): void {
		this.adapters.set(adapter.type, adapter);
		console.log(`[INTEGRATION-MANAGER] Registered adapter: ${adapter.name} (${adapter.type})`);
	}

	getAdapter(type: IntegrationType): IntegrationAdapter | undefined {
		return this.adapters.get(type);
	}

	// Private helper methods
	private validateIntegrationConfig(config: IntegrationConfigInput): Result<void> {
		if (!config.type) {
			return {
				success: false,
				error: new ValidationError("Integration type is required"),
			};
		}

		if (!config.name) {
			return {
				success: false,
				error: new ValidationError("Integration name is required"),
			};
		}

		if (!config.credentials) {
			return {
				success: false,
				error: new ValidationError("Integration credentials are required"),
			};
		}

		const validTypes: IntegrationType[] = ["github", "slack", "calendar", "jira"];
		if (!validTypes.includes(config.type)) {
			return {
				success: false,
				error: new ValidationError(`Invalid integration type: ${config.type}`),
			};
		}

		return { success: true, data: undefined };
	}

	private async initializeAdapter(integration: IntegrationConfig): Promise<void> {
		const adapter = this.adapters.get(integration.type);
		if (!adapter) {
			throw new Error(`No adapter registered for type: ${integration.type}`);
		}

		await adapter.initialize(integration);
		console.log(`[INTEGRATION-MANAGER] Initialized adapter for ${integration.name}`);
	}

	private startAutoSync(integration: IntegrationConfig): void {
		const intervalMs = integration.settings.syncInterval * 60 * 1000; // Convert minutes to milliseconds

		const interval = setInterval(async () => {
			try {
				console.log(`[INTEGRATION-MANAGER] Auto-syncing ${integration.name}`);
				await this.syncIntegration(integration.id);
			} catch (error) {
				console.error(`[INTEGRATION-MANAGER] Auto-sync failed for ${integration.name}:`, error);
			}
		}, intervalMs);

		this.syncIntervals.set(integration.id, interval);
		console.log(
			`[INTEGRATION-MANAGER] Started auto-sync for ${integration.name} (${integration.settings.syncInterval} minutes)`,
		);
	}

	private stopAutoSync(integrationId: string): void {
		const interval = this.syncIntervals.get(integrationId);
		if (interval) {
			clearInterval(interval);
			this.syncIntervals.delete(integrationId);
			console.log(`[INTEGRATION-MANAGER] Stopped auto-sync for integration: ${integrationId}`);
		}
	}

	private async processInboundTasks(
		externalTasks: ExternalTask[],
		integration: IntegrationConfig,
	): Promise<void> {
		for (const externalTask of externalTasks) {
			try {
				// Check if task mapping already exists
				const existingMappingResult = await this.repository.findTaskMappingByExternalId(
					externalTask.sourceId,
					integration.id,
				);

				if (existingMappingResult.success && existingMappingResult.data) {
					// Update existing task
					await this.updateTaskFromExternal(externalTask, existingMappingResult.data);
				} else {
					// Create new task
					await this.createTaskFromExternal(externalTask, integration);
				}
			} catch (error) {
				console.error(
					`[INTEGRATION-MANAGER] Failed to process external task ${externalTask.id}:`,
					error,
				);
			}
		}
	}

	private async createTaskFromExternal(
		externalTask: ExternalTask,
		integration: IntegrationConfig,
	): Promise<void> {
		// This would create a local task from the external task
		// Implementation would depend on having access to task service
		console.log(`[INTEGRATION-MANAGER] Creating task from external: ${externalTask.title}`);

		// Create task mapping
		const mapping: TaskMapping = {
			id: `mapping-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
			taskId: `task-${externalTask.sourceId}`, // This would be the actual created task ID
			integrationId: integration.id,
			externalId: externalTask.sourceId,
			externalUrl: externalTask.url,
			lastSyncAt: new Date(),
			syncDirection: "inbound",
			createdAt: new Date(),
			updatedAt: new Date(),
		};

		await this.repository.createTaskMapping(mapping);
	}

	private async updateTaskFromExternal(
		externalTask: ExternalTask,
		mapping: TaskMapping,
	): Promise<void> {
		// This would update the local task with data from external task
		console.log(`[INTEGRATION-MANAGER] Updating task from external: ${externalTask.title}`);

		// Update task mapping
		await this.repository.updateTaskMapping(mapping.id, {
			lastSyncAt: new Date(),
			updatedAt: new Date(),
		});
	}

	private async getTasksToSync(integration: IntegrationConfig): Promise<IntegrationTask[]> {
		// This would get tasks that need to be synced to the external service
		// For now, return empty array
		console.log(`[INTEGRATION-MANAGER] Getting tasks to sync for ${integration.name}`);
		return [];
	}

	// Cleanup
	async shutdown(): Promise<void> {
		console.log("[INTEGRATION-MANAGER] Shutting down integration manager...");

		// Stop all auto-sync intervals
		for (const [integrationId, interval] of this.syncIntervals) {
			clearInterval(interval);
			console.log(`[INTEGRATION-MANAGER] Stopped auto-sync for integration: ${integrationId}`);
		}
		this.syncIntervals.clear();

		// Cleanup all adapters
		const cleanupPromises = Array.from(this.adapters.values()).map((adapter) =>
			adapter
				.cleanup()
				.catch((error) => console.error("[INTEGRATION-MANAGER] Failed to cleanup adapter:", error)),
		);

		await Promise.allSettled(cleanupPromises);
		this.adapters.clear();

		console.log("[INTEGRATION-MANAGER] Integration manager shutdown complete");
	}
}
