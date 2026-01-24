import { ConflictError, NotFoundError, ValidationError, type Result } from "@isomorphiq/core";
import type {
	IntegrationConfig,
	IntegrationConfigInput,
	IntegrationStats,
	TaskMapping,
} from "./types.ts";

/**
 * Integration repository interface for data persistence
 */
/* eslint-disable no-unused-vars */
export interface IIntegrationRepository {
	// Integration CRUD
	create(config: IntegrationConfigInput): Promise<Result<IntegrationConfig>>;
	findById(id: string): Promise<Result<IntegrationConfig | null>>;
	findAll(): Promise<Result<IntegrationConfig[]>>;
	findByType(type: string): Promise<Result<IntegrationConfig[]>>;
	findByStatus(status: string): Promise<Result<IntegrationConfig[]>>;
	update(id: string, updates: Partial<IntegrationConfig>): Promise<Result<IntegrationConfig>>;
	delete(id: string): Promise<Result<void>>;

	// Task mapping CRUD
	createTaskMapping(mapping: TaskMapping): Promise<Result<TaskMapping>>;
	findTaskMapping(taskId: string, integrationId: string): Promise<Result<TaskMapping | null>>;
	findTaskMappingsByTask(taskId: string): Promise<Result<TaskMapping[]>>;
	findTaskMappingsByIntegration(integrationId: string): Promise<Result<TaskMapping[]>>;
	findTaskMappingByExternalId(
		externalId: string,
		integrationId: string,
	): Promise<Result<TaskMapping | null>>;
	updateTaskMapping(id: string, updates: Partial<TaskMapping>): Promise<Result<TaskMapping>>;
	deleteTaskMapping(id: string): Promise<Result<void>>;
	deleteTaskMappingsByTask(taskId: string): Promise<Result<void>>;
	deleteTaskMappingsByIntegration(integrationId: string): Promise<Result<void>>;

	// Statistics
	getIntegrationStats(): Promise<Result<IntegrationStats>>;
	getIntegrationUsage(
		integrationId: string,
	): Promise<Result<{ totalMappings: number; lastSyncAt: Date; syncFrequency: number }>>;
}
/* eslint-enable no-unused-vars */

/**
 * LevelDB implementation of integration repository
 */
export class LevelDbIntegrationRepository implements IIntegrationRepository {
	/* eslint-disable no-unused-vars */
	private db: {
		open: () => Promise<void>;
		put: (key: string, value: IntegrationConfig | TaskMapping | unknown) => Promise<void>;
		get: (key: string) => Promise<unknown>;
		del: (key: string) => Promise<void>;
		iterator: (
			opts?: Record<string, unknown>,
		) => (AsyncIterableIterator<[string, unknown]> & { close: () => Promise<void> });
	};
	/* eslint-enable no-unused-vars */
	private dbReady = false;

	/* eslint-disable no-unused-vars */
	constructor(db: {
		open: () => Promise<void>;
		put: (key: string, value: IntegrationConfig | TaskMapping | unknown) => Promise<void>;
		get: (key: string) => Promise<unknown>;
		del: (key: string) => Promise<void>;
		iterator: (
			opts?: Record<string, unknown>,
		) => (AsyncIterableIterator<[string, unknown]> & { close: () => Promise<void> });
	}) {
		this.db = db;
	}
	/* eslint-enable no-unused-vars */

	private async ensureDbOpen(): Promise<void> {
		if (this.dbReady) return;
		try {
			await this.db.open();
			this.dbReady = true;
		} catch (error) {
			console.error("[INTEGRATION-REPO] Failed to open database:", error);
			throw error;
		}
	}

	// Integration CRUD operations
	async create(config: IntegrationConfigInput): Promise<Result<IntegrationConfig>> {
		await this.ensureDbOpen();

		try {
			// Validate required fields
			if (!config.type || !config.name) {
				return {
					success: false,
					error: new ValidationError("Integration type and name are required"),
				};
			}

			// Check if integration with same name already exists
			const existingResult = await this.findByName(config.name);
			if (existingResult.success && existingResult.data) {
				return {
					success: false,
					error: new ConflictError("Integration with this name already exists"),
				};
			}

			const integration: IntegrationConfig = {
				...config,
				id: config.id || `integration-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
				createdAt: config.createdAt || new Date(),
				updatedAt: new Date(),
			};

			await this.db.put(`integration:${integration.id}`, integration);
			console.log(`[INTEGRATION-REPO] Created integration: ${integration.id}`);

			return { success: true, data: integration };
		} catch (error) {
			console.error("[INTEGRATION-REPO] Failed to create integration:", error);
			return {
				success: false,
				error: error as Error,
			};
		}
	}

	async findById(id: string): Promise<Result<IntegrationConfig | null>> {
		await this.ensureDbOpen();

		try {
			const integration = (await this.db.get(`integration:${id}`).catch(() => null)) as
				| IntegrationConfig
				| null;
			return { success: true, data: integration };
		} catch (error) {
			console.error("[INTEGRATION-REPO] Failed to find integration by ID:", error);
			return {
				success: false,
				error: error as Error,
			};
		}
	}

	async findAll(): Promise<Result<IntegrationConfig[]>> {
		await this.ensureDbOpen();

		try {
			const integrations: IntegrationConfig[] = [];
			const iterator = this.db.iterator({
				gte: "integration:",
				lte: "integration;\xff",
			});

			for await (const [, value] of iterator) {
				integrations.push(value as IntegrationConfig);
			}

			await iterator.close();
			return { success: true, data: integrations };
		} catch (error) {
			console.error("[INTEGRATION-REPO] Failed to find all integrations:", error);
			return {
				success: false,
				error: error as Error,
			};
		}
	}

	async findByType(type: string): Promise<Result<IntegrationConfig[]>> {
		await this.ensureDbOpen();

			try {
				const allResult = await this.findAll();
				if (!allResult.success) {
					return { success: false, error: allResult.error };
				}

			const filtered = allResult.data.filter((integration) => integration.type === type);
			return { success: true, data: filtered };
		} catch (error) {
			console.error("[INTEGRATION-REPO] Failed to find integrations by type:", error);
			return {
				success: false,
				error: error as Error,
			};
		}
	}

	async findByStatus(status: string): Promise<Result<IntegrationConfig[]>> {
		await this.ensureDbOpen();

			try {
				const allResult = await this.findAll();
				if (!allResult.success) {
					return { success: false, error: allResult.error };
				}

			const filtered = allResult.data.filter((integration) => integration.status === status);
			return { success: true, data: filtered };
		} catch (error) {
			console.error("[INTEGRATION-REPO] Failed to find integrations by status:", error);
			return {
				success: false,
				error: error as Error,
			};
		}
	}

	async update(
		id: string,
		updates: Partial<IntegrationConfig>,
	): Promise<Result<IntegrationConfig>> {
		await this.ensureDbOpen();

			try {
				const existingResult = await this.findById(id);
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

			const updated: IntegrationConfig = {
				...existing,
				...updates,
				id, // Ensure ID doesn't change
				updatedAt: new Date(),
			};

			await this.db.put(`integration:${id}`, updated);
			console.log(`[INTEGRATION-REPO] Updated integration: ${id}`);

			return { success: true, data: updated };
		} catch (error) {
			console.error("[INTEGRATION-REPO] Failed to update integration:", error);
			return {
				success: false,
				error: error as Error,
			};
		}
	}

	async delete(id: string): Promise<Result<void>> {
		await this.ensureDbOpen();

			try {
				const existingResult = await this.findById(id);
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

			// Delete related task mappings first
			const mappingsResult = await this.deleteTaskMappingsByIntegration(id);
			if (!mappingsResult.success) {
				console.warn("[INTEGRATION-REPO] Failed to delete task mappings for integration:", id);
			}

			await this.db.del(`integration:${id}`);
			console.log(`[INTEGRATION-REPO] Deleted integration: ${id}`);

			return { success: true, data: undefined };
		} catch (error) {
			console.error("[INTEGRATION-REPO] Failed to delete integration:", error);
			return {
				success: false,
				error: error as Error,
			};
		}
	}

	// Task mapping CRUD operations
	async createTaskMapping(mapping: TaskMapping): Promise<Result<TaskMapping>> {
		await this.ensureDbOpen();

		try {
			const taskMapping: TaskMapping = {
				...mapping,
				id: mapping.id || `mapping-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
				createdAt: mapping.createdAt || new Date(),
				updatedAt: new Date(),
			};

			await this.db.put(`mapping:${taskMapping.id}`, taskMapping);
			console.log(`[INTEGRATION-REPO] Created task mapping: ${taskMapping.id}`);

			return { success: true, data: taskMapping };
		} catch (error) {
			console.error("[INTEGRATION-REPO] Failed to create task mapping:", error);
			return {
				success: false,
				error: error as Error,
			};
		}
	}

	async findTaskMapping(
		taskId: string,
		integrationId: string,
	): Promise<Result<TaskMapping | null>> {
		await this.ensureDbOpen();

			try {
				const mappingsResult = await this.findTaskMappingsByTask(taskId);
				if (!mappingsResult.success) {
					return { success: false, error: mappingsResult.error };
				}

				const mapping = mappingsResult.data.find((m) => m.integrationId === integrationId);
				return { success: true, data: mapping || null };
		} catch (error) {
			console.error("[INTEGRATION-REPO] Failed to find task mapping:", error);
			return {
				success: false,
				error: error as Error,
			};
		}
	}

	async findTaskMappingsByTask(taskId: string): Promise<Result<TaskMapping[]>> {
		await this.ensureDbOpen();

		try {
			const mappings: TaskMapping[] = [];
			const iterator = this.db.iterator({
				gte: "mapping:",
				lte: "mapping;\xff",
			});

			for await (const [, value] of iterator) {
				const mapping = value as TaskMapping;
				if (mapping.taskId === taskId) {
					mappings.push(mapping);
				}
			}

			await iterator.close();
			return { success: true, data: mappings };
		} catch (error) {
			console.error("[INTEGRATION-REPO] Failed to find task mappings by task:", error);
			return {
				success: false,
				error: error as Error,
			};
		}
	}

	async findTaskMappingsByIntegration(integrationId: string): Promise<Result<TaskMapping[]>> {
		await this.ensureDbOpen();

		try {
			const mappings: TaskMapping[] = [];
			const iterator = this.db.iterator({
				gte: "mapping:",
				lte: "mapping;\xff",
			});

			for await (const [, value] of iterator) {
				const mapping = value as TaskMapping;
				if (mapping.integrationId === integrationId) {
					mappings.push(mapping);
				}
			}

			await iterator.close();
			return { success: true, data: mappings };
		} catch (error) {
			console.error("[INTEGRATION-REPO] Failed to find task mappings by integration:", error);
			return {
				success: false,
				error: error as Error,
			};
		}
	}

	async findTaskMappingByExternalId(
		externalId: string,
		integrationId: string,
	): Promise<Result<TaskMapping | null>> {
		await this.ensureDbOpen();

			try {
				const mappingsResult = await this.findTaskMappingsByIntegration(integrationId);
				if (!mappingsResult.success) {
					return { success: false, error: mappingsResult.error };
				}

			const mapping = mappingsResult.data.find((m) => m.externalId === externalId);
			return { success: true, data: mapping || null };
		} catch (error) {
			console.error("[INTEGRATION-REPO] Failed to find task mapping by external ID:", error);
			return {
				success: false,
				error: error as Error,
			};
		}
	}

	async updateTaskMapping(id: string, updates: Partial<TaskMapping>): Promise<Result<TaskMapping>> {
		await this.ensureDbOpen();

		try {
			const existing = (await this.db.get(`mapping:${id}`).catch(() => null)) as
				| TaskMapping
				| null;
			if (!existing) {
				return {
					success: false,
					error: new NotFoundError("TaskMapping", id),
				};
			}

			const updated: TaskMapping = {
				...existing,
				...updates,
				id, // Ensure ID doesn't change
				updatedAt: new Date(),
			};

			await this.db.put(`mapping:${id}`, updated);
			console.log(`[INTEGRATION-REPO] Updated task mapping: ${id}`);

			return { success: true, data: updated };
		} catch (error) {
			console.error("[INTEGRATION-REPO] Failed to update task mapping:", error);
			return {
				success: false,
				error: error as Error,
			};
		}
	}

	async deleteTaskMapping(id: string): Promise<Result<void>> {
		await this.ensureDbOpen();

		try {
			await this.db.del(`mapping:${id}`);
			console.log(`[INTEGRATION-REPO] Deleted task mapping: ${id}`);

			return { success: true, data: undefined };
		} catch (error) {
			console.error("[INTEGRATION-REPO] Failed to delete task mapping:", error);
			return {
				success: false,
				error: error as Error,
			};
		}
	}

	async deleteTaskMappingsByTask(taskId: string): Promise<Result<void>> {
		await this.ensureDbOpen();

			try {
				const mappingsResult = await this.findTaskMappingsByTask(taskId);
				if (!mappingsResult.success) {
					return { success: false, error: mappingsResult.error };
				}

			const deletePromises = mappingsResult.data.map((mapping) =>
				this.deleteTaskMapping(mapping.id),
			);
			await Promise.allSettled(deletePromises);

			console.log(
				`[INTEGRATION-REPO] Deleted ${mappingsResult.data.length} task mappings for task: ${taskId}`,
			);
			return { success: true, data: undefined };
		} catch (error) {
			console.error("[INTEGRATION-REPO] Failed to delete task mappings by task:", error);
			return {
				success: false,
				error: error as Error,
			};
		}
	}

	async deleteTaskMappingsByIntegration(integrationId: string): Promise<Result<void>> {
		await this.ensureDbOpen();

			try {
				const mappingsResult = await this.findTaskMappingsByIntegration(integrationId);
				if (!mappingsResult.success) {
					return { success: false, error: mappingsResult.error };
				}

			const deletePromises = mappingsResult.data.map((mapping) =>
				this.deleteTaskMapping(mapping.id),
			);
			await Promise.allSettled(deletePromises);

			console.log(
				`[INTEGRATION-REPO] Deleted ${mappingsResult.data.length} task mappings for integration: ${integrationId}`,
			);
			return { success: true, data: undefined };
		} catch (error) {
			console.error("[INTEGRATION-REPO] Failed to delete task mappings by integration:", error);
			return {
				success: false,
				error: error as Error,
			};
		}
	}

	// Statistics
	async getIntegrationStats(): Promise<Result<IntegrationStats>> {
		await this.ensureDbOpen();

			try {
				const allResult = await this.findAll();
				if (!allResult.success) {
					return { success: false, error: allResult.error };
				}

			const integrations = allResult.data;
			const stats: IntegrationStats = {
				totalIntegrations: integrations.length,
				activeIntegrations: integrations.filter((i) => i.enabled && i.status === "connected")
					.length,
				integrationsByType: {
					github: integrations.filter((i) => i.type === "github").length,
					slack: integrations.filter((i) => i.type === "slack").length,
					calendar: integrations.filter((i) => i.type === "calendar").length,
					jira: integrations.filter((i) => i.type === "jira").length,
				},
				totalSyncs: 0, // Would need to track sync history
				successfulSyncs: 0,
				failedSyncs: 0,
				averageSyncTime: 0,
			};

			// Get last sync time from integrations
			const lastSyncs = integrations
				.filter((i): i is IntegrationConfig & { lastSyncAt: Date } => Boolean(i.lastSyncAt))
				.map((i) => i.lastSyncAt)
				.sort((a, b) => b.getTime() - a.getTime());

			if (lastSyncs.length > 0) {
				stats.lastSyncAt = lastSyncs[0];
			}

			return { success: true, data: stats };
		} catch (error) {
			console.error("[INTEGRATION-REPO] Failed to get integration stats:", error);
			return {
				success: false,
				error: error as Error,
			};
		}
	}

	async getIntegrationUsage(
		integrationId: string,
	): Promise<Result<{ totalMappings: number; lastSyncAt: Date; syncFrequency: number }>> {
		await this.ensureDbOpen();

			try {
				const mappingsResult = await this.findTaskMappingsByIntegration(integrationId);
				if (!mappingsResult.success) {
					return { success: false, error: mappingsResult.error };
				}

			const usage = {
				totalMappings: mappingsResult.data.length,
				lastSyncAt: new Date(), // Would need to track actual sync times
				syncFrequency: 0, // Would need to calculate from sync history
			};

			return { success: true, data: usage };
		} catch (error) {
			console.error("[INTEGRATION-REPO] Failed to get integration usage:", error);
			return {
				success: false,
				error: error as Error,
			};
		}
	}

	// Helper method to find integration by name
	private async findByName(name: string): Promise<Result<IntegrationConfig | null>> {
		await this.ensureDbOpen();

			try {
				const allResult = await this.findAll();
				if (!allResult.success) {
					return { success: false, error: allResult.error };
				}

			const integration = allResult.data.find((i) => i.name === name);
			return { success: true, data: integration || null };
		} catch (error) {
			console.error("[INTEGRATION-REPO] Failed to find integration by name:", error);
			return {
				success: false,
				error: error as Error,
			};
		}
	}
}
