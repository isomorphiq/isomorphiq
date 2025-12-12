import type { Result } from "../core/result.ts";
import type { Task } from "../types.ts";
import { ValidationError } from "../core/result.ts";
import { CalendarIntegration } from "./calendar-adapter.ts";
import { GitHubIntegration } from "./github-adapter.ts";
import { IntegrationManager } from "./integration-manager.ts";
import { LevelDbIntegrationRepository } from "./integration-repository.ts";
import { SlackIntegration } from "./slack-adapter.ts";
import type {
	IntegrationConfig,
	IntegrationConfigInput,
	IntegrationHealth,
	IntegrationStats,
	IntegrationType,
	SyncResult,
} from "./types.ts";

/**
 * Main integration service that provides high-level integration functionality
 */
export class IntegrationService {
	private integrationManager: IntegrationManager;

	constructor(db: unknown) {
		const baseDb = db as {
			open: () => Promise<void>;
			put: (key: string, value: unknown) => Promise<void>;
			get: (key: string) => Promise<unknown>;
			del: (key: string) => Promise<void>;
			iterator: (opts?: Record<string, unknown>) => AsyncIterableIterator<[string, unknown]>;
		};

		// Adapt iterator to expose close() for typing consistency
		const repository = new LevelDbIntegrationRepository({
			open: () => baseDb.open(),
			put: (...args) => baseDb.put(...args),
			get: (...args) => baseDb.get(...args),
			del: (...args) => baseDb.del(...args),
			iterator: (opts?: Record<string, unknown>) => {
				const it = baseDb.iterator(opts);
				const closer =
					typeof (it as unknown as { close?: () => Promise<void> }).close === "function"
						? (it as unknown as { close: () => Promise<void> }).close
						: async () => {
								if (typeof (it as AsyncIterableIterator<[string, unknown]>).return === "function") {
									await (it as AsyncIterableIterator<[string, unknown]>).return?.();
								}
							};
				return Object.assign(it, {
					close: closer,
				}) as AsyncIterableIterator<[string, unknown]> & { close: () => Promise<void> };
			},
		});
		this.integrationManager = new IntegrationManager(repository);

		// Register built-in adapters
		this.registerBuiltInAdapters();
	}

	/**
	 * Initialize the integration service
	 */
	async initialize(): Promise<void> {
		console.log("[INTEGRATION-SERVICE] Initializing integration service...");

		try {
			// Load existing integrations and initialize adapters
			const integrationsResult = await this.integrationManager.getAllIntegrations();
			if (integrationsResult.success) {
				const enabledIntegrations = integrationsResult.data.filter((i) => i.enabled);

				for (const integration of enabledIntegrations) {
					try {
						const adapter = this.integrationManager.getAdapter(integration.type);
						if (adapter) {
							await adapter.initialize(integration);
							console.log(
								`[INTEGRATION-SERVICE] Initialized ${integration.type} adapter for ${integration.name}`,
							);
						}
					} catch (error) {
						console.error(
							`[INTEGRATION-SERVICE] Failed to initialize ${integration.type} adapter:`,
							error,
						);
					}
				}
			}

			console.log("[INTEGRATION-SERVICE] Integration service initialized successfully");
		} catch (error) {
			console.error("[INTEGRATION-SERVICE] Failed to initialize integration service:", error);
			throw error;
		}
	}

	/**
	 * Create a new integration
	 */
	async createIntegration(
		config: IntegrationConfigInput,
	): Promise<Result<IntegrationConfig>> {
		// Validate integration configuration
		const validationResult = this.validateIntegrationConfig(config);
		if (!validationResult.success) {
			return { success: false, error: validationResult.error };
		}

		// Create integration through manager
		return await this.integrationManager.createIntegration(config);
	}

	/**
	 * Update an existing integration
	 */
	async updateIntegration(
		id: string,
		updates: Partial<IntegrationConfig>,
	): Promise<Result<IntegrationConfig>> {
		return await this.integrationManager.updateIntegration(id, updates);
	}

	/**
	 * Delete an integration
	 */
	async deleteIntegration(id: string): Promise<Result<void>> {
		return await this.integrationManager.deleteIntegration(id);
	}

	/**
	 * Get integration by ID
	 */
	async getIntegration(id: string): Promise<Result<IntegrationConfig>> {
		return await this.integrationManager.getIntegration(id);
	}

	/**
	 * Get all integrations
	 */
	async getAllIntegrations(): Promise<Result<IntegrationConfig[]>> {
		return await this.integrationManager.getAllIntegrations();
	}

	/**
	 * Get integrations by type
	 */
	async getIntegrationsByType(type: string): Promise<Result<IntegrationConfig[]>> {
		return await this.integrationManager.getIntegrationsByType(type as IntegrationType);
	}

	/**
	 * Enable an integration
	 */
	async enableIntegration(id: string): Promise<Result<void>> {
		return await this.integrationManager.enableIntegration(id);
	}

	/**
	 * Disable an integration
	 */
	async disableIntegration(id: string): Promise<Result<void>> {
		return await this.integrationManager.disableIntegration(id);
	}

	/**
	 * Test connection for an integration
	 */
	async testConnection(id: string): Promise<Result<boolean>> {
		return await this.integrationManager.testConnection(id);
	}

	/**
	 * Sync a specific integration
	 */
	async syncIntegration(
		id: string,
		syncType?: "full" | "incremental",
	): Promise<Result<SyncResult>> {
		return await this.integrationManager.syncIntegration(id, syncType);
	}

	/**
	 * Sync all enabled integrations
	 */
	async syncAllIntegrations(): Promise<Result<SyncResult[]>> {
		return await this.integrationManager.syncAllIntegrations();
	}

	/**
	 * Check health of a specific integration
	 */
	async checkIntegrationHealth(id: string): Promise<Result<IntegrationHealth>> {
		return await this.integrationManager.checkIntegrationHealth(id);
	}

	/**
	 * Check health of all integrations
	 */
	async checkAllIntegrationsHealth(): Promise<Result<IntegrationHealth[]>> {
		return await this.integrationManager.checkAllIntegrationsHealth();
	}

	/**
	 * Handle webhook from external service
	 */
	async handleWebhook(
		type: string,
		payload: Record<string, unknown>,
		signature?: string,
	): Promise<Result<void>> {
		return await this.integrationManager.handleWebhook(type as IntegrationType, payload, signature);
	}

	/**
	 * Get integration statistics
	 */
	async getIntegrationStats(): Promise<Result<IntegrationStats>> {
			try {
				const allIntegrationsResult = await this.getAllIntegrations();
				if (!allIntegrationsResult.success) {
					return { success: false, error: allIntegrationsResult.error };
				}

			const integrations = allIntegrationsResult.data;
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
			console.error("[INTEGRATION-SERVICE] Failed to get integration stats:", error);
			return {
				success: false,
				error: error as Error,
			};
		}
	}

	/**
	 * Sync task with all relevant integrations
	 */
	async syncTaskWithIntegrations(task: Task): Promise<Result<void>> {
			try {
				const allIntegrationsResult = await this.getAllIntegrations();
				if (!allIntegrationsResult.success) {
					return { success: false, error: allIntegrationsResult.error };
				}

			const enabledIntegrations = allIntegrationsResult.data.filter(
				(i) =>
					i.enabled &&
					i.status === "connected" &&
					(i.syncDirection === "outbound" || i.syncDirection === "bidirectional"),
			);

			const syncPromises = enabledIntegrations.map(async (integration) => {
				try {
					const adapter = this.integrationManager.getAdapter(integration.type);
					if (!adapter) {
						console.warn(`[INTEGRATION-SERVICE] No adapter found for ${integration.type}`);
						return;
					}

					// Check if task should be synced to this integration
					if (await this.shouldSyncTask(task, integration)) {
						await adapter.syncOutbound([task]);
						console.log(`[INTEGRATION-SERVICE] Synced task ${task.id} to ${integration.name}`);
					}
				} catch (error) {
					console.error(
						`[INTEGRATION-SERVICE] Failed to sync task ${task.id} to ${integration.type}:`,
						error,
					);
				}
			});

			await Promise.allSettled(syncPromises);
			console.log(
				`[INTEGRATION-SERVICE] Synced task ${task.id} with ${enabledIntegrations.length} integrations`,
			);

			return { success: true, data: undefined };
		} catch (error) {
			console.error("[INTEGRATION-SERVICE] Failed to sync task with integrations:", error);
			return {
				success: false,
				error: error as Error,
			};
		}
	}

	/**
	 * Get integration configuration templates
	 */
	getIntegrationTemplates(): Record<string, Record<string, unknown>> {
		return {
			github: {
				type: "github",
				name: "GitHub Integration",
				description: "Sync tasks with GitHub issues and pull requests",
				enabled: false,
				syncDirection: "bidirectional",
				syncInterval: 15, // 15 minutes
				autoSync: true,
				settings: {
					github: {
						repository: "",
						syncIssues: true,
						syncPullRequests: true,
						createIssuesForTasks: true,
						updateIssuesFromTasks: true,
						labelMapping: {
							todo: "status: todo",
							"in-progress": "status: in-progress",
							done: "status: done",
						},
						assigneeMapping: {},
					},
				},
				credentials: {
					accessToken: "",
					webhookSecret: "",
				},
			},
			slack: {
				type: "slack",
				name: "Slack Integration",
				description: "Send task notifications and handle commands in Slack",
				enabled: false,
				syncDirection: "outbound",
				syncInterval: 5, // 5 minutes
				autoSync: true,
				settings: {
					slack: {
						workspace: "",
						notifyChannel: "#tasks",
						notifyOnTaskCreated: true,
						notifyOnTaskCompleted: true,
						notifyOnTaskAssigned: true,
						allowCommands: true,
						commandPrefix: "!",
						userMapping: {},
					},
				},
				credentials: {
					accessToken: "",
				},
			},
			calendar: {
				type: "calendar",
				name: "Google Calendar Integration",
				description: "Create calendar events from tasks and deadlines",
				enabled: false,
				syncDirection: "outbound",
				syncInterval: 30, // 30 minutes
				autoSync: true,
				settings: {
					calendar: {
						calendarId: "primary",
						createEventsForTasks: true,
						createEventsForDeadlines: true,
						defaultDuration: 60, // 1 hour
						reminders: [15, 60], // 15 minutes and 1 hour before
						timezone: "UTC",
					},
				},
				credentials: {
					accessToken: "",
				},
			},
		};
	}

	/**
	 * Validate integration configuration
	 */
	private validateIntegrationConfig(config: Partial<IntegrationConfig>): Result<void> {
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

		const validTypes = ["github", "slack", "calendar", "jira"];
		if (!validTypes.includes(config.type)) {
			return {
				success: false,
				error: new ValidationError(`Invalid integration type: ${config.type}`),
			};
		}

		if (!config.credentials) {
			return {
				success: false,
				error: new ValidationError("Integration credentials are required"),
			};
		}

		return { success: true, data: undefined };
	}

	/**
	 * Check if task should be synced to integration
	 */
	private async shouldSyncTask(_task: Task, integration: IntegrationConfig): Promise<boolean> {
		// Basic filtering logic - can be extended based on integration settings
		switch (integration.type) {
			case "github": {
				const githubSettings = integration.settings.github;
				return githubSettings?.createIssuesForTasks || false;
			}

			case "slack": {
				const slackSettings = integration.settings.slack;
				return slackSettings?.notifyOnTaskCreated || false;
			}

			case "calendar": {
				const calendarSettings = integration.settings.calendar;
				return calendarSettings?.createEventsForTasks || false;
			}

			default:
				return false;
		}
	}

	/**
	 * Register built-in adapters
	 */
	private registerBuiltInAdapters(): void {
		this.integrationManager.registerAdapter(new GitHubIntegration());
		this.integrationManager.registerAdapter(new SlackIntegration());
		this.integrationManager.registerAdapter(new CalendarIntegration());

		console.log("[INTEGRATION-SERVICE] Registered built-in adapters: github, slack, calendar");
	}

	/**
	 * Cleanup integration service
	 */
	async shutdown(): Promise<void> {
		console.log("[INTEGRATION-SERVICE] Shutting down integration service...");

		try {
			await this.integrationManager.shutdown();
			console.log("[INTEGRATION-SERVICE] Integration service shutdown complete");
		} catch (error) {
			console.error("[INTEGRATION-SERVICE] Error during shutdown:", error);
			throw error;
		}
	}
}
