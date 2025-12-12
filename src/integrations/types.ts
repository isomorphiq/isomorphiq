import type { Result } from "../core/result.ts";
import type { Task } from "../types.ts";

/**
 * Integration types supported by the system
 */
export type IntegrationType = "github" | "slack" | "calendar" | "jira";

/**
 * Integration status and health
 */
export type IntegrationStatus = "connected" | "disconnected" | "error" | "syncing" | "disabled";

/**
 * Sync direction for bi-directional integrations
 */
export type SyncDirection = "inbound" | "outbound" | "bidirectional";

/**
 * Base integration configuration
 */
export interface IntegrationConfig {
	id: string;
	type: IntegrationType;
	name: string;
	enabled: boolean;
	status: IntegrationStatus;
	syncDirection: SyncDirection;
	credentials: IntegrationCredentials;
	settings: IntegrationSettings;
	createdAt: Date;
	updatedAt: Date;
	lastSyncAt?: Date;
	errorMessage?: string;
}

export type IntegrationConfigInput = Omit<IntegrationConfig, "id" | "createdAt" | "updatedAt"> &
	Partial<Pick<IntegrationConfig, "id" | "createdAt" | "updatedAt">>;

/**
 * Integration credentials (encrypted in storage)
 */
export interface IntegrationCredentials {
	// OAuth2 credentials
	clientId?: string;
	clientSecret?: string;
	accessToken?: string;
	refreshToken?: string;
	tokenExpiresAt?: Date;

	// API tokens
	apiToken?: string;
	apiKey?: string;

	// Webhook secrets
	webhookSecret?: string;

	// Additional auth data
	additionalData?: Record<string, string>;
}

/**
 * Integration-specific settings
 */
export interface IntegrationSettings {
	// General settings
	syncInterval: number; // minutes
	autoSync: boolean;

	// GitHub settings
	github?: {
		repository: string;
		syncIssues: boolean;
		syncPullRequests: boolean;
		createIssuesForTasks: boolean;
		updateIssuesFromTasks: boolean;
		labelMapping?: Record<string, string>; // task status -> GitHub label
		assigneeMapping?: Record<string, string>; // user ID -> GitHub username
	};

	// Slack settings
	slack?: {
		workspace: string;
		notifyChannel?: string;
		notifyOnTaskCreated: boolean;
		notifyOnTaskCompleted: boolean;
		notifyOnTaskAssigned: boolean;
		allowCommands: boolean;
		commandPrefix: string;
		userMapping?: Record<string, string>; // user ID -> Slack user ID
	};

	// Calendar settings
	calendar?: {
		calendarId: string;
		createEventsForTasks: boolean;
		createEventsForDeadlines: boolean;
		defaultDuration: number; // minutes
		reminders: number[]; // minutes before event
		timezone: string;
	};

	// Jira settings
	jira?: {
		url: string;
		project: string;
		syncIssues: boolean;
		createIssuesForTasks: boolean;
		updateIssuesFromTasks: boolean;
		statusMapping?: Record<string, string>; // task status -> Jira status
		priorityMapping?: Record<string, string>; // task priority -> Jira priority
	};
}

/**
 * External task representation
 */
export interface ExternalTask {
	id: string;
	source: IntegrationType;
	sourceId: string;
	title: string;
	description?: string;
	status: string;
	priority?: string;
	assignee?: string | undefined;
	labels?: string[];
	url?: string;
	createdAt: Date;
	updatedAt: Date;
	additionalData?: Record<string, unknown>;
}

/**
 * Sync result for integration operations
 */
export interface SyncResult {
	success: boolean;
	integrationId: string;
	syncType: "full" | "incremental";
	direction: SyncDirection;
	processed: number;
	created: number;
	updated: number;
	deleted: number;
	errors: string[];
	duration: number; // milliseconds
	syncedAt: Date;
}

/**
 * Integration health check result
 */
export interface IntegrationHealth {
	integrationId: string;
	status: IntegrationStatus;
	lastCheck: Date;
	responseTime?: number; // milliseconds
	errorRate?: number; // percentage
	lastError?: string;
	metrics?: {
		syncsCompleted: number;
		syncsFailed: number;
		averageSyncTime: number;
		lastSyncDuration: number;
	};
}

/**
 * Integration event types
 */
export interface IntegrationEvent {
	id: string;
	type:
		| "integration_connected"
		| "integration_disconnected"
		| "integration_sync_started"
		| "integration_sync_completed"
		| "integration_sync_failed"
		| "integration_error"
		| "external_task_created"
		| "external_task_updated"
		| "external_task_deleted";
	timestamp: Date;
	data: Record<string, unknown>;
	metadata?: {
		source: string;
		version: string;
		correlationId?: string;
	};
}

/**
 * Integration adapter interface
 */
export interface IntegrationAdapter {
	readonly type: IntegrationType;
	readonly name: string;

	/**
	 * Initialize the adapter with configuration
	 */
	initialize(config: IntegrationConfig): Promise<void>;

	/**
	 * Test connection to the external service
	 */
	testConnection(): Promise<boolean>;

	/**
	 * Perform health check
	 */
	healthCheck(): Promise<IntegrationHealth>;

	/**
	 * Sync tasks from external service (inbound)
	 */
	syncInbound(lastSyncAt?: Date): Promise<ExternalTask[]>;

	/**
	 * Sync tasks to external service (outbound)
	 */
	syncOutbound(tasks: Task[]): Promise<SyncResult>;

	/**
	 * Create external task from local task
	 */
	createExternalTask(task: Task): Promise<ExternalTask>;

	/**
	 * Update external task from local task
	 */
	updateExternalTask(task: Task, externalId: string): Promise<ExternalTask>;

	/**
	 * Delete external task
	 */
	deleteExternalTask(externalId: string): Promise<void>;

	/**
	 * Handle webhook from external service
	 */
	handleWebhook(payload: Record<string, unknown>, signature?: string): Promise<void>;

	/**
	 * Cleanup resources
	 */
	cleanup(): Promise<void>;
}

/**
 * Integration manager interface
 */
export interface IIntegrationManager {
	// Integration lifecycle
	createIntegration(
		config: Omit<IntegrationConfig, "id" | "createdAt" | "updatedAt">,
	): Promise<Result<IntegrationConfig>>;
	updateIntegration(
		id: string,
		updates: Partial<IntegrationConfig>,
	): Promise<Result<IntegrationConfig>>;
	deleteIntegration(id: string): Promise<Result<void>>;
	getIntegration(id: string): Promise<Result<IntegrationConfig>>;
	getAllIntegrations(): Promise<Result<IntegrationConfig[]>>;
	getIntegrationsByType(type: IntegrationType): Promise<Result<IntegrationConfig[]>>;

	// Integration control
	enableIntegration(id: string): Promise<Result<void>>;
	disableIntegration(id: string): Promise<Result<void>>;
	testConnection(id: string): Promise<Result<boolean>>;

	// Sync operations
	syncIntegration(id: string, syncType?: "full" | "incremental"): Promise<Result<SyncResult>>;
	syncAllIntegrations(): Promise<Result<SyncResult[]>>;

	// Health monitoring
	checkIntegrationHealth(id: string): Promise<Result<IntegrationHealth>>;
	checkAllIntegrationsHealth(): Promise<Result<IntegrationHealth[]>>;

	// Event handling
	handleWebhook(
		type: IntegrationType,
		payload: Record<string, unknown>,
		signature?: string,
	): Promise<Result<void>>;

	// Adapter management
	registerAdapter(adapter: IntegrationAdapter): void;
	getAdapter(type: IntegrationType): IntegrationAdapter | undefined;
}

/**
 * Task mapping between local and external tasks
 */
export interface TaskMapping {
	id: string;
	taskId: string;
	integrationId: string;
	externalId: string;
	externalUrl?: string;
	lastSyncAt: Date;
	syncDirection: SyncDirection;
	createdAt: Date;
	updatedAt: Date;
}

/**
 * Integration statistics
 */
export interface IntegrationStats {
	totalIntegrations: number;
	activeIntegrations: number;
	integrationsByType: Record<IntegrationType, number>;
	totalSyncs: number;
	successfulSyncs: number;
	failedSyncs: number;
	averageSyncTime: number;
	lastSyncAt?: Date;
}
