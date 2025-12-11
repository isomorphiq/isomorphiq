import type { ACPProfile } from "./acp-profiles.ts";
import { ProfileManager } from "./acp-profiles.ts";
import { PluginManager } from "./plugin-manager.ts";
import { PluginSecurityManager } from "./plugin-sandbox.ts";
import type { PluginConfig, PluginHealth, ProfilePlugin } from "./plugin-system.ts";
import type { Task } from "./types.ts";

type RoutedTask = Record<string, unknown> & {
	type?: Task["type"];
	capabilities?: string[];
};

/**
 * Enhanced profile manager that integrates with the plugin system
 */
export class EnhancedProfileManager extends ProfileManager {
	private pluginManager: PluginManager;
	private securityManager: PluginSecurityManager;
	private pluginProfiles = new Map<string, PluginProfile>();
	private pluginsDirectory: string;

	constructor(
		pluginsDirectory: string = "./plugins",
		configPath: string = "./config/plugins.json",
	) {
		super();
		this.pluginsDirectory = pluginsDirectory;
		this.pluginManager = new PluginManager(pluginsDirectory, configPath);
		this.securityManager = new PluginSecurityManager();
		this.initializePluginIntegration();
	}

	private async initializePluginIntegration(): Promise<void> {
		try {
			// Load plugins from directory
			await this.pluginManager.loadPluginsFromDirectory(this.pluginsDirectory);

			// Set up event listeners
			this.setupPluginEventListeners();

			// Integrate plugin profiles
			this.integratePluginProfiles();

			console.log("[ENHANCED-PROFILE-MANAGER] Plugin integration initialized");
		} catch (error) {
			console.error("[ENHANCED-PROFILE-MANAGER] Failed to initialize plugin integration:", error);
		}
	}

	private setupPluginEventListeners(): void {
		// Listen for plugin registration
		this.pluginManager.on("pluginRegistered", (pluginName: string, plugin: ProfilePlugin) => {
			console.log(`[ENHANCED-PROFILE-MANAGER] Plugin registered: ${pluginName}`);
			this.integratePluginProfile(plugin);
		});

		// Listen for plugin unregistration
		this.pluginManager.on("pluginUnregistered", (pluginName: string) => {
			console.log(`[ENHANCED-PROFILE-MANAGER] Plugin unregistered: ${pluginName}`);
			this.removePluginProfile(pluginName);
		});

		// Listen for plugin state changes
		this.pluginManager.on("pluginStateChanged", (pluginName: string, state: string) => {
			console.log(`[ENHANCED-PROFILE-MANAGER] Plugin ${pluginName} state changed to: ${state}`);
			this.updatePluginProfileState(pluginName, state);
		});

		// Listen for plugin health updates
		this.pluginManager.on("pluginHealthUpdated", (pluginName: string, health: PluginHealth) => {
			console.log(`[ENHANCED-PROFILE-MANAGER] Plugin ${pluginName} health: ${health.status}`);
			this.updatePluginProfileHealth(pluginName, health);
		});
	}

	private integratePluginProfiles(): void {
		const activePlugins = this.pluginManager.getActivePlugins();

		for (const plugin of activePlugins) {
			this.integratePluginProfile(plugin);
		}
	}

	private integratePluginProfile(plugin: ProfilePlugin): void {
		try {
			const profile = plugin.getProfile();

			// Create sandbox for security
			const sandbox = this.securityManager.createSandbox(plugin);

			// Store the profile with sandbox reference
			this.pluginProfiles.set(plugin.metadata.name, {
				...profile,
				plugin,
				sandbox,
			});

			// Register with base profile manager
			this.registerProfile({
				name: profile.name,
				role: profile.role,
				capabilities: profile.capabilities,
				maxConcurrentTasks: profile.maxConcurrentTasks,
				priority: profile.priority,
				color: profile.color,
				icon: profile.icon,
				systemPrompt: profile.systemPrompt,
				getTaskPrompt: profile.getTaskPrompt,
			});

			console.log(`[ENHANCED-PROFILE-MANAGER] Integrated plugin profile: ${profile.name}`);
		} catch (error) {
			console.error(
				`[ENHANCED-PROFILE-MANAGER] Failed to integrate plugin ${plugin.metadata.name}:`,
				error,
			);
		}
	}

	private removePluginProfile(pluginName: string): void {
		this.pluginProfiles.delete(pluginName);

		// Remove from base profile manager
		const existingProfile = this.getProfile(pluginName);
		if (existingProfile) {
			// Note: ProfileManager doesn't have unregisterProfile, so we'd need to extend it
			console.log(`[ENHANCED-PROFILE-MANAGER] Removed plugin profile: ${pluginName}`);
		}
	}

	private updatePluginProfileState(pluginName: string, state: string): void {
		const profile = this.pluginProfiles.get(pluginName);
		if (profile) {
			// Update profile state based on plugin state
			const isActive = state === "active";
			this.updateProfileState(pluginName, { isActive });
		}
	}

	private updatePluginProfileHealth(pluginName: string, health: PluginHealth): void {
		const profile = this.pluginProfiles.get(pluginName);
		if (profile) {
			// Could update profile metrics based on health
			console.log(`[ENHANCED-PROFILE-MANAGER] Updated health for ${pluginName}: ${health.status}`);
		}
	}

	// Enhanced methods that leverage plugins
	getPluginProfiles(): Array<ACPProfile & { plugin: ProfilePlugin }> {
		return Array.from(this.pluginProfiles.values()).map((profile) => ({
			name: profile.name,
			role: profile.role,
			capabilities: profile.capabilities,
			maxConcurrentTasks: profile.maxConcurrentTasks,
			priority: profile.priority,
			color: profile.color,
			icon: profile.icon,
			systemPrompt: profile.systemPrompt,
			getTaskPrompt: profile.getTaskPrompt,
			plugin: profile.plugin,
		}));
	}

	getPluginProfile(pluginName: string): (ACPProfile & { plugin: ProfilePlugin }) | undefined {
		const profile = this.pluginProfiles.get(pluginName);
		return profile
			? {
					name: profile.name,
					role: profile.role,
					capabilities: profile.capabilities,
					maxConcurrentTasks: profile.maxConcurrentTasks,
					priority: profile.priority,
					color: profile.color,
					icon: profile.icon,
					systemPrompt: profile.systemPrompt,
					getTaskPrompt: profile.getTaskPrompt,
					plugin: profile.plugin,
				}
			: undefined;
	}

	// Plugin management methods
	async installPlugin(pluginPath: string, config?: PluginConfig): Promise<void> {
		try {
			const plugin = await this.pluginManager.getPluginLoader().loadPlugin(pluginPath, config);
			await this.pluginManager.registerPlugin(plugin, config);
			console.log(`[ENHANCED-PROFILE-MANAGER] Installed plugin from: ${pluginPath}`);
		} catch (error) {
			console.error(
				`[ENHANCED-PROFILE-MANAGER] Failed to install plugin from ${pluginPath}:`,
				error,
			);
			throw error;
		}
	}

	async uninstallPlugin(pluginName: string): Promise<void> {
		try {
			await this.pluginManager.unregisterPlugin(pluginName);
			console.log(`[ENHANCED-PROFILE-MANAGER] Uninstalled plugin: ${pluginName}`);
		} catch (error) {
			console.error(`[ENHANCED-PROFILE-MANAGER] Failed to uninstall plugin ${pluginName}:`, error);
			throw error;
		}
	}

	async enablePlugin(pluginName: string): Promise<void> {
		await this.pluginManager.setPluginEnabled(pluginName, true);
	}

	async disablePlugin(pluginName: string): Promise<void> {
		await this.pluginManager.setPluginEnabled(pluginName, false);
	}

	async reloadPlugin(pluginName: string): Promise<void> {
		await this.pluginManager.reloadPlugin(pluginName);
	}

	// Enhanced task routing with plugin capabilities
	getBestProfileForTask(task: RoutedTask): ACPProfile | undefined {
		// First try plugin profiles
		const pluginProfiles = this.getPluginProfiles();
		const availablePluginProfiles = pluginProfiles.filter((profile) => {
			const state = profile.plugin.state;
			return (
				state === "active" &&
				profile.plugin.getConfig().enabled &&
				this.isProfileAvailable(profile.name)
			);
		});

		if (availablePluginProfiles.length > 0) {
			// Sort by priority and capabilities match
			availablePluginProfiles.sort((a, b) => {
				// Primary sort by priority
				if ((a.priority || 0) !== (b.priority || 0)) {
					return (b.priority || 0) - (a.priority || 0);
				}

				// Secondary sort by capability match
				const aCapabilities = a.capabilities || [];
				const bCapabilities = b.capabilities || [];

				// Simple capability matching - could be enhanced
				const aMatch = this.calculateCapabilityMatch(aCapabilities, task);
				const bMatch = this.calculateCapabilityMatch(bCapabilities, task);

				return bMatch - aMatch;
			});

			return availablePluginProfiles[0];
		}

		// Fallback to built-in profiles
		return super.getBestProfileForTask(task);
	}

	private calculateCapabilityMatch(capabilities: string[], task: RoutedTask): number {
		// Simple scoring based on task type and capabilities
		let score = 0;

		if (task.type && capabilities.includes(task.type)) {
			score += 10;
		}

		if (task.capabilities) {
			for (const cap of task.capabilities) {
				if (capabilities.includes(cap)) {
					score += 5;
				}
			}
		}

		return score;
	}

	// Plugin information and status
	getPluginManager(): PluginManager {
		return this.pluginManager;
	}

	getSecurityManager(): PluginSecurityManager {
		return this.securityManager;
	}

	async getPluginSystemStatus(): Promise<PluginSystemStatus> {
		const allPlugins = this.pluginManager.getAllPlugins();
		const activePlugins = this.pluginManager.getActivePlugins();
		const healthMap = await this.pluginManager.checkAllPluginsHealth();

		return {
			totalPlugins: allPlugins.length,
			activePlugins: activePlugins.length,
			pluginProfiles: this.pluginProfiles.size,
			healthyPlugins: Array.from(healthMap.values()).filter((h) => h.status === "healthy").length,
			lastUpdate: new Date(),
			plugins: allPlugins.map((plugin) => ({
				name: plugin.metadata.name,
				version: plugin.metadata.version,
				state: plugin.state,
				enabled: plugin.getConfig().enabled,
				health: healthMap.get(plugin.metadata.name),
				hasProfile: this.pluginProfiles.has(plugin.metadata.name),
			})),
		};
	}

	// Cleanup
	async shutdown(): Promise<void> {
		console.log("[ENHANCED-PROFILE-MANAGER] Shutting down...");

		try {
			await this.pluginManager.shutdown();
			this.pluginProfiles.clear();
			console.log("[ENHANCED-PROFILE-MANAGER] Shutdown complete");
		} catch (error) {
			console.error("[ENHANCED-PROFILE-MANAGER] Error during shutdown:", error);
		}
	}
}

// Type definitions
interface PluginProfile extends ACPProfile {
	plugin: ProfilePlugin;
	sandbox: unknown;
}

interface PluginSystemStatus {
	totalPlugins: number;
	activePlugins: number;
	pluginProfiles: number;
	healthyPlugins: number;
	lastUpdate: Date;
	plugins: Array<{
		name: string;
		version: string;
		state: string;
		enabled: boolean;
		health?: PluginHealth;
		hasProfile: boolean;
	}>;
}

// Export for use in other modules
export { EnhancedProfileManager as default };
