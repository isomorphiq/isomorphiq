/* eslint-disable no-unused-vars */
import type { ACPProfile } from "@isomorphiq/user-profile";

/**
 * Plugin metadata and information
 */
export interface PluginMetadata {
	name: string;
	version: string;
	description: string;
	author: string;
	homepage?: string;
	repository?: string;
	license: string;
	keywords: string[];
	dependencies?: string[];
	peerDependencies?: string[];
	engines?: {
		node?: string;
		opencode?: string;
	};
}

/**
 * Plugin configuration schema
 */
export interface PluginConfigSchema {
	type: "object";
	properties: Record<
		string,
		{
			type: "string" | "number" | "boolean" | "array" | "object";
			description: string;
			default?: unknown;
			required?: boolean;
			enum?: unknown[];
			minimum?: number;
			maximum?: number;
			pattern?: string;
		}
	>;
	required?: string[];
}

/**
 * Plugin configuration
 */
export interface PluginConfig {
	enabled: boolean;
	priority: number;
	settings: Record<string, unknown>;
}

/**
 * Plugin lifecycle states
 */
export type PluginState =
	| "unloaded"
	| "loading"
	| "loaded"
	| "active"
	| "inactive"
	| "error"
	| "unloading";

/**
 * Plugin interface that all profile plugins must implement
 */
export interface ProfilePlugin {
	/**
	 * Plugin metadata - must be implemented by plugin
	 */
	readonly metadata: PluginMetadata;

	/**
	 * Plugin configuration schema - optional but recommended
	 */
	readonly configSchema: PluginConfigSchema | undefined;

	/**
	 * Default configuration - used when no config is provided
	 */
	readonly defaultConfig: PluginConfig;

	/**
	 * Current plugin state
	 */
	state: PluginState;

	/**
	 * Error information if plugin is in error state
	 */
	error?: Error;

	/**
	 * Initialize the plugin - called when plugin is loaded
	 */
	initialize(config?: PluginConfig): Promise<void>;

	/**
	 * Get the ACP profile instance from this plugin
	 */
	getProfile(): ACPProfile;

	/**
	 * Cleanup plugin resources - called when plugin is unloaded
	 */
	cleanup(): Promise<void>;

	/**
	 * Validate plugin configuration
	 */
	validateConfig(config: PluginConfig): boolean;

	/**
	 * Get plugin health status
	 */
	getHealth(): PluginHealth;

	/**
	 * Handle plugin hot-reload (optional)
	 */
	reload?(): Promise<void>;

	/**
	 * Plugin-specific event handlers (optional)
	 */
	onTaskStart?(task: Record<string, unknown>): Promise<void>;
	onTaskComplete?(task: Record<string, unknown>, result: unknown): Promise<void>;
	onTaskError?(task: Record<string, unknown>, error: Error): Promise<void>;

	/**
	 * Update plugin configuration (optional)
	 */
	updateConfig?(config: Partial<PluginConfig>): void;
}

/**
 * Plugin health information
 */
export interface PluginHealth {
	status: "healthy" | "degraded" | "unhealthy";
	message?: string | undefined;
	metrics?: Record<string, unknown> | undefined;
	lastCheck: Date;
}

/**
 * Plugin registry entry
 */
export interface PluginRegistryEntry {
	plugin: ProfilePlugin;
	config: PluginConfig;
	loadedAt: Date;
	lastActivity: Date;
	health: PluginHealth;
}

/**
 * Plugin loader interface
 */
export interface PluginLoader {
	/**
	 * Load a plugin from a file path
	 */
	loadPlugin(filePath: string, config?: PluginConfig): Promise<ProfilePlugin>;

	/**
	 * Unload a plugin
	 */
	unloadPlugin(pluginName: string): Promise<void>;

	/**
	 * Reload a plugin
	 */
	reloadPlugin(pluginName: string): Promise<ProfilePlugin>;

	/**
	 * Discover plugins in a directory
	 */
	discoverPlugins(directory: string): Promise<string[]>;

	/**
	 * Validate plugin file
	 */
	validatePlugin(filePath: string): Promise<boolean>;
}

/**
 * Plugin manager interface
 */
export interface PluginManagerContract {
	/**
	 * Register a plugin
	 */
	registerPlugin(plugin: ProfilePlugin, config?: PluginConfig): Promise<void>;

	/**
	 * Unregister a plugin
	 */
	unregisterPlugin(pluginName: string): Promise<void>;

	/**
	 * Get a plugin by name
	 */
	getPlugin(name: string): ProfilePlugin | undefined;

	/**
	 * Get all registered plugins
	 */
	getAllPlugins(): ProfilePlugin[];

	/**
	 * Get active plugins
	 */
	getActivePlugins(): ProfilePlugin[];

	/**
	 * Enable/disable a plugin
	 */
	setPluginEnabled(name: string, enabled: boolean): Promise<void>;

	/**
	 * Get plugin registry
	 */
	getRegistry(): Map<string, PluginRegistryEntry>;

	/**
	 * Load plugins from directory
	 */
	loadPluginsFromDirectory(directory: string): Promise<void>;

	/**
	 * Save plugin configuration
	 */
	savePluginConfig(name: string, config: PluginConfig): Promise<void>;

	/**
	 * Load plugin configuration
	 */
	loadPluginConfig(name: string): Promise<PluginConfig | null>;
}

/**
 * Base class for profile plugins with common functionality
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export abstract class BaseProfilePlugin implements ProfilePlugin {
	public state: PluginState = "unloaded";
	public error?: Error;

	protected _config: PluginConfig;
	public readonly metadata: PluginMetadata;
	public readonly configSchema: PluginConfigSchema | undefined;

	constructor(
		metadata: PluginMetadata,
		configSchema: PluginConfigSchema | undefined = undefined,
		defaultConfig?: Partial<PluginConfig>,
	) {
		this.metadata = metadata;
		this.configSchema = configSchema;
		this._config = {
			enabled: true,
			priority: 50,
			settings: {},
			...defaultConfig,
		};
	}

	get defaultConfig(): PluginConfig {
		return this._config;
	}

	async initialize(config?: PluginConfig): Promise<void> {
		this.state = "loading";

		try {
			if (config) {
				if (!this.validateConfig(config)) {
					throw new Error("Invalid plugin configuration");
				}
				this._config = { ...this._config, ...config };
			}

			await this.onInitialize();
			this.state = this._config.enabled ? "active" : "loaded";
		} catch (error) {
			this.error = error as Error;
			this.state = "error";
			throw error;
		}
	}

	async cleanup(): Promise<void> {
		this.state = "unloading";
		try {
			await this.onCleanup();
			this.state = "unloaded";
		} catch (error) {
			this.error = error as Error;
			this.state = "error";
			throw error;
		}
	}

	validateConfig(config: PluginConfig): boolean {
		if (!this.configSchema) {
			return true; // No schema to validate against
		}

		// Basic validation - in a real implementation, use a JSON schema validator
		if (typeof config.enabled !== "boolean") return false;
		if (typeof config.priority !== "number") return false;
		if (typeof config.settings !== "object") return false;

		return true;
	}

	getHealth(): PluginHealth {
		return {
			status:
				this.state === "active" ? "healthy" : this.state === "error" ? "unhealthy" : "degraded",
			message: this.error?.message,
			lastCheck: new Date(),
		};
	}

	getConfig(): PluginConfig {
		return this._config;
	}

	updateConfig(config: Partial<PluginConfig>): void {
		this._config = { ...this._config, ...config };
	}

	// Abstract methods that must be implemented by subclasses
	abstract getProfile(): ACPProfile;

	// Optional lifecycle hooks that subclasses can override
	protected async onInitialize(): Promise<void> {
		// Default implementation - can be overridden
	}

	protected async onCleanup(): Promise<void> {
		// Default implementation - can be overridden
	}

	// Optional event handlers
	async onTaskStart?(task: Record<string, unknown>): Promise<void>;
	async onTaskComplete?(task: Record<string, unknown>, result: unknown): Promise<void>;
	async onTaskError?(task: Record<string, unknown>, error: Error): Promise<void>;
}

