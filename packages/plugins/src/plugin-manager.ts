import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import type { ACPProfile } from "@isomorphiq/user-profile";
import { FileSystemPluginLoader } from "./plugin-loader.ts";
import type {
    PluginManagerContract,
    PluginConfig,
    PluginHealth,
    PluginRegistryEntry,
    ProfilePlugin,
} from "./plugin-system.ts";

/**
 * Plugin manager implementation
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class PluginManager extends EventEmitter implements PluginManagerContract {
	private registry = new Map<string, PluginRegistryEntry>();
	private loader = new FileSystemPluginLoader();
	private configPath: string;
	private pluginsDirectory: string;

	constructor(
		pluginsDirectory: string = path.join(process.cwd(), "plugins"),
		configPath: string = path.join(process.cwd(), "config", "plugins.json"),
	) {
		super();
		this.pluginsDirectory = pluginsDirectory;
		this.configPath = configPath;
		this.ensureDirectories();
	}

	private async ensureDirectories(): Promise<void> {
		try {
			await fs.mkdir(this.pluginsDirectory, { recursive: true });
			await fs.mkdir(path.dirname(this.configPath), { recursive: true });
		} catch (error) {
			console.error("[PLUGIN-MANAGER] Failed to create directories:", error);
		}
	}

	async registerPlugin(plugin: ProfilePlugin, config?: PluginConfig): Promise<void> {
		try {
			// Load or merge configuration
			const finalConfig =
				config || (await this.loadPluginConfig(plugin.metadata.name)) || plugin.defaultConfig;

			// Initialize plugin if not already initialized
			if (plugin.state === "unloaded") {
				await plugin.initialize(finalConfig);
			}

			// Create registry entry
			const entry: PluginRegistryEntry = {
				plugin,
				config: finalConfig,
				loadedAt: new Date(),
				lastActivity: new Date(),
				health: plugin.getHealth(),
			};

			// Register plugin
			this.registry.set(plugin.metadata.name, entry);

			// Save configuration
			await this.savePluginConfig(plugin.metadata.name, finalConfig);

			// Emit events
			this.emit("pluginRegistered", plugin.metadata.name, plugin);
			this.emit("pluginStateChanged", plugin.metadata.name, plugin.state);

			console.log(
				`[PLUGIN-MANAGER] Registered plugin: ${plugin.metadata.name} v${plugin.metadata.version}`,
			);
		} catch (error) {
			console.error(`[PLUGIN-MANAGER] Failed to register plugin ${plugin.metadata.name}:`, error);
			throw error;
		}
	}

	async unregisterPlugin(pluginName: string): Promise<void> {
		const entry = this.registry.get(pluginName);
		if (!entry) {
			throw new Error(`Plugin ${pluginName} not found`);
		}

		try {
			// Cleanup plugin
			await entry.plugin.cleanup();

			// Remove from registry
			this.registry.delete(pluginName);

			// Emit events
			this.emit("pluginUnregistered", pluginName, entry.plugin);
			this.emit("pluginStateChanged", pluginName, entry.plugin.state);

			console.log(`[PLUGIN-MANAGER] Unregistered plugin: ${pluginName}`);
		} catch (error) {
			console.error(`[PLUGIN-MANAGER] Failed to unregister plugin ${pluginName}:`, error);
			throw error;
		}
	}

	getPlugin(name: string): ProfilePlugin | undefined {
		return this.registry.get(name)?.plugin;
	}

	getAllPlugins(): ProfilePlugin[] {
		return Array.from(this.registry.values()).map((entry) => entry.plugin);
	}

	getActivePlugins(): ProfilePlugin[] {
		return this.getAllPlugins().filter((plugin) => plugin.state === "active");
	}

	getPluginConfig(name: string): PluginConfig | undefined {
		return this.registry.get(name)?.config;
	}

	getPluginLoader(): FileSystemPluginLoader {
		return this.loader;
	}

	async setPluginEnabled(name: string, enabled: boolean): Promise<void> {
		const entry = this.registry.get(name);
		if (!entry) {
			throw new Error(`Plugin ${name} not found`);
		}

		const oldState = entry.plugin.state;

		try {
			// Update configuration
			entry.config.enabled = enabled;
			await this.savePluginConfig(name, entry.config);

			// Update plugin state
			if (enabled && entry.plugin.state === "loaded") {
				entry.plugin.state = "active";
			} else if (!enabled && entry.plugin.state === "active") {
				entry.plugin.state = "loaded";
			}

			// Update plugin's internal config
			entry.plugin.updateConfig?.(entry.config);

			// Emit state change event
			if (oldState !== entry.plugin.state) {
				this.emit("pluginStateChanged", name, entry.plugin.state);
			}

			console.log(`[PLUGIN-MANAGER] ${enabled ? "Enabled" : "Disabled"} plugin: ${name}`);
		} catch (error) {
			console.error(
				`[PLUGIN-MANAGER] Failed to ${enabled ? "enable" : "disable"} plugin ${name}:`,
				error,
			);
			throw error;
		}
	}

	getRegistry(): Map<string, PluginRegistryEntry> {
		return new Map(this.registry);
	}

	async loadPluginsFromDirectory(directory: string): Promise<void> {
		try {
			console.log(`[PLUGIN-MANAGER] Loading plugins from: ${directory}`);

			const pluginFiles = await this.loader.listAvailablePlugins();
			const loadedPlugins: string[] = [];
			const failedPlugins: Array<{ file: string; error: Error }> = [];

			for (const name of pluginFiles) {
				try {
					const loaded = await this.loader.loadPlugin(name);
					const plugin = loaded.plugin;
					await this.registerPlugin(plugin);
					loadedPlugins.push(loaded.metadata.name);
				} catch (error) {
					failedPlugins.push({ file: name, error: error as Error });
					console.error(`[PLUGIN-MANAGER] Failed to load plugin ${name}:`, error);
				}
			}

			console.log(
				`[PLUGIN-MANAGER] Loaded ${loadedPlugins.length} plugins, failed to load ${failedPlugins.length}`,
			);

			// Emit summary events
			this.emit("pluginsLoaded", loadedPlugins, failedPlugins);

			if (failedPlugins.length > 0) {
				this.emit("pluginLoadErrors", failedPlugins);
			}
		} catch (error) {
			console.error(`[PLUGIN-MANAGER] Failed to load plugins from directory ${directory}:`, error);
			throw error;
		}
	}

	async savePluginConfig(name: string, config: PluginConfig): Promise<void> {
		try {
			// Load existing config file
			let allConfigs: Record<string, PluginConfig> = {};
			try {
				const content = await fs.readFile(this.configPath, "utf-8");
				allConfigs = JSON.parse(content);
			} catch {
				// File doesn't exist or is invalid, start fresh
			}

			// Update config for this plugin
			allConfigs[name] = config;

			// Save back to file
			await fs.writeFile(this.configPath, JSON.stringify(allConfigs, null, 2));
		} catch (error) {
			console.error(`[PLUGIN-MANAGER] Failed to save config for plugin ${name}:`, error);
			throw error;
		}
	}

	async loadPluginConfig(name: string): Promise<PluginConfig | null> {
		try {
			const content = await fs.readFile(this.configPath, "utf-8");
			const allConfigs: Record<string, PluginConfig> = JSON.parse(content);
			return allConfigs[name] || null;
		} catch {
			return null;
		}
	}

	// Plugin lifecycle management
	async reloadPlugin(name: string): Promise<void> {
		const entry = this.registry.get(name);
		if (!entry) {
			throw new Error(`Plugin ${name} not found`);
		}

		try {
			// Get the file path from the loader
			const pluginPath = await this.getPluginPath(name);
			if (!pluginPath) {
				throw new Error(`Cannot find plugin file for ${name}`);
			}

			// Unregister current plugin
			await this.unregisterPlugin(name);

			// Reload plugin
			const reloaded = await this.loader.loadPlugin(pluginPath);
			await this.registerPlugin(reloaded.plugin, entry.config);

			console.log(`[PLUGIN-MANAGER] Reloaded plugin: ${name}`);
		} catch (error) {
			console.error(`[PLUGIN-MANAGER] Failed to reload plugin ${name}:`, error);
			throw error;
		}
	}

	// Plugin health monitoring
	async checkPluginHealth(name: string): Promise<PluginHealth> {
		const entry = this.registry.get(name);
		if (!entry) {
			throw new Error(`Plugin ${name} not found`);
		}

		try {
			const health = entry.plugin.getHealth();
			entry.health = health;
			entry.lastActivity = new Date();

			// Emit health update
			this.emit("pluginHealthUpdated", name, health);

			return health;
		} catch (error) {
			const errorHealth: PluginHealth = {
				status: "unhealthy",
				message: (error as Error).message,
				lastCheck: new Date(),
			};

			entry.health = errorHealth;
			this.emit("pluginHealthUpdated", name, errorHealth);

			return errorHealth;
		}
	}

	async checkAllPluginsHealth(): Promise<Map<string, PluginHealth>> {
		const healthMap = new Map<string, PluginHealth>();

		for (const [name] of this.registry) {
			try {
				const health = await this.checkPluginHealth(name);
				healthMap.set(name, health);
			} catch (error) {
				console.error(`[PLUGIN-MANAGER] Failed to check health for plugin ${name}:`, error);
			}
		}

		return healthMap;
	}

	// Plugin dependency management
	async resolveDependencies(pluginName: string): Promise<string[]> {
		const plugin = this.getPlugin(pluginName);
		if (!plugin) {
			throw new Error(`Plugin ${pluginName} not found`);
		}

		const dependencies = plugin.metadata.dependencies || [];
		const resolved: string[] = [];
		const missing: string[] = [];

		for (const dep of dependencies) {
			if (this.getPlugin(dep)) {
				resolved.push(dep);
			} else {
				missing.push(dep);
			}
		}

		if (missing.length > 0) {
			throw new Error(`Missing dependencies for ${pluginName}: ${missing.join(", ")}`);
		}

		return resolved;
	}

	// Plugin utilities
	getPluginProfiles(): ACPProfile[] {
		return this.getActivePlugins().map((plugin) => plugin.getProfile());
	}

	getPluginByName(name: string): ProfilePlugin | undefined {
		return this.getPlugin(name);
	}

	getPluginsByCapability(capability: string): ProfilePlugin[] {
		return this.getActivePlugins().filter((plugin) => {
			const profile = plugin.getProfile();
			return profile.capabilities?.includes(capability);
		});
	}

	// Private helper methods
	private async getPluginPath(name: string): Promise<string | null> {
		// This would need to be implemented in the loader to track file paths
		// For now, we'll try to find it in the plugins directory
		try {
			const files = await this.loader.listAvailablePlugins();
			for (const file of files) {
				const loaded = await this.loader.loadPlugin(file);
				if (loaded.metadata.name === name) {
					if (typeof loaded.plugin.cleanup === "function") {
						await loaded.plugin.cleanup();
					}
					return file;
				}
			}
		} catch {
			// Ignore errors during discovery
		}
		return null;
	}

	// Event handling for plugin lifecycle
	onPluginTaskStart(pluginName: string, task: Record<string, unknown>): void {
		const plugin = this.getPlugin(pluginName);
		if (plugin?.onTaskStart) {
			plugin.onTaskStart(task).catch((error) => {
				console.error(`[PLUGIN-MANAGER] Error in plugin ${pluginName} onTaskStart:`, error);
			});
		}
	}

	onPluginTaskComplete(pluginName: string, task: Record<string, unknown>, result: unknown): void {
		const plugin = this.getPlugin(pluginName);
		if (plugin?.onTaskComplete) {
			plugin.onTaskComplete(task, result).catch((error) => {
				console.error(`[PLUGIN-MANAGER] Error in plugin ${pluginName} onTaskComplete:`, error);
			});
		}
	}

	onPluginTaskError(pluginName: string, task: Record<string, unknown>, error: Error): void {
		const plugin = this.getPlugin(pluginName);
		if (plugin?.onTaskError) {
			plugin.onTaskError(task, error).catch((err) => {
				console.error(`[PLUGIN-MANAGER] Error in plugin ${pluginName} onTaskError:`, err);
			});
		}
	}

	// Cleanup
	async shutdown(): Promise<void> {
		console.log("[PLUGIN-MANAGER] Shutting down plugin manager...");

		const shutdownPromises = Array.from(this.registry.entries()).map(async ([name, entry]) => {
			try {
				await entry.plugin.cleanup();
				console.log(`[PLUGIN-MANAGER] Cleaned up plugin: ${name}`);
			} catch (error) {
				console.error(`[PLUGIN-MANAGER] Failed to cleanup plugin ${name}:`, error);
			}
		});

		await Promise.allSettled(shutdownPromises);
		this.registry.clear();

		console.log("[PLUGIN-MANAGER] Plugin manager shutdown complete");
	}
}

