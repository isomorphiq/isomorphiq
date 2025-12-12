import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type {
	PluginConfig,
	PluginConfigSchema,
	PluginLoader,
	PluginMetadata,
	ProfilePlugin,
} from "./plugin-system.ts";

/**
 * File system based plugin loader
 */
export class FileSystemPluginLoader implements PluginLoader {
	private loadedModules = new Map<string, { moduleExport: unknown; path: string }>();

	async loadPlugin(filePath: string, config?: PluginConfig): Promise<ProfilePlugin> {
		try {
			// Resolve absolute path
			const absolutePath = path.resolve(filePath);

			// Check if file exists
			await fs.access(absolutePath);

			// Clear require cache for hot reloading
			const requireFunc = createRequire(__filename);
			delete requireFunc.cache[absolutePath];

			// Load module
				let moduleExport: unknown;

				try {
					moduleExport = requireFunc(absolutePath);
				} catch (_error) {
					void _error;
					// Try dynamic import if require fails
					const moduleUrl = `file://${absolutePath}`;
					const module = await import(moduleUrl);
					moduleExport = module.default || module;
				}

			// Validate plugin
			if (!this.isValidPluginExport(moduleExport)) {
				throw new Error(`Invalid plugin export in ${filePath}`);
			}

			// Create plugin instance
			const PluginClass = (moduleExport as { default?: unknown }).default || moduleExport;
			if (typeof PluginClass !== "function") {
				throw new Error(`Plugin at ${filePath} does not export a constructable class`);
			}
			const plugin = new (PluginClass as new () => ProfilePlugin)();

			// Initialize plugin
			await plugin.initialize(config);

			// Cache the module for potential unloading
			this.loadedModules.set(plugin.metadata.name, { moduleExport, path: absolutePath });

			console.log(
				`[PLUGIN-LOADER] Loaded plugin: ${plugin.metadata.name} v${plugin.metadata.version}`,
			);
			return plugin;
		} catch (error) {
			console.error(`[PLUGIN-LOADER] Failed to load plugin from ${filePath}:`, error);
			throw error;
		}
	}

	async unloadPlugin(pluginName: string): Promise<void> {
		const moduleInfo = this.loadedModules.get(pluginName);
		if (!moduleInfo) {
			throw new Error(`Plugin ${pluginName} not found in loaded modules`);
		}

		try {
			// Clear from require cache
			delete require.cache[moduleInfo.path];

			// Remove from loaded modules
			this.loadedModules.delete(pluginName);

			console.log(`[PLUGIN-LOADER] Unloaded plugin: ${pluginName}`);
		} catch (error) {
			console.error(`[PLUGIN-LOADER] Failed to unload plugin ${pluginName}:`, error);
			throw error;
		}
	}

	async reloadPlugin(pluginName: string): Promise<ProfilePlugin> {
		const moduleInfo = this.loadedModules.get(pluginName);
		if (!moduleInfo) {
			throw new Error(`Plugin ${pluginName} not found in loaded modules`);
		}

		await this.unloadPlugin(pluginName);
		return await this.loadPlugin(moduleInfo.path);
	}

	async discoverPlugins(directory: string): Promise<string[]> {
		try {
			const entries = await fs.readdir(directory, { withFileTypes: true });
			const pluginFiles: string[] = [];

			for (const entry of entries) {
				if (entry.isFile()) {
					const filePath = path.join(directory, entry.name);
					const ext = path.extname(entry.name);

					// Look for .js, .ts, .mjs files
					if ([".js", ".ts", ".mjs"].includes(ext)) {
						// Validate that it's a plugin
						if (await this.validatePlugin(filePath)) {
							pluginFiles.push(filePath);
						}
					}
				} else if (entry.isDirectory()) {
					// Look for index files in subdirectories
					const indexFiles = ["index.js", "index.ts", "index.mjs"];
					for (const indexFile of indexFiles) {
						const indexPath = path.join(directory, entry.name, indexFile);
						try {
							await fs.access(indexPath);
							if (await this.validatePlugin(indexPath)) {
								pluginFiles.push(indexPath);
								break;
							}
						} catch {
							// File doesn't exist, continue
						}
					}
				}
			}

			console.log(`[PLUGIN-LOADER] Discovered ${pluginFiles.length} plugins in ${directory}`);
			return pluginFiles;
		} catch (error) {
			console.error(`[PLUGIN-LOADER] Failed to discover plugins in ${directory}:`, error);
			return [];
		}
	}

	async validatePlugin(filePath: string): Promise<boolean> {
		try {
			const absolutePath = path.resolve(filePath);

			// Try to load module without caching
			const requireFunc = createRequire(__filename);
			let moduleExport: unknown;

				try {
					moduleExport = requireFunc(absolutePath);
				} catch (_error) {
					void _error;
					// Try dynamic import
					const moduleUrl = pathToFileURL(absolutePath).href;
					const module = await import(moduleUrl);
					moduleExport = module.default || module;
				}

				return this.isValidPluginExport(moduleExport);
			} catch (_error) {
				void _error;
				return false;
			}
		}

	private isValidPluginExport(moduleExport: unknown): boolean {
		// Check if it's a class or constructor function
		if (typeof moduleExport === "function") {
			// Try to create an instance to check if it implements ProfilePlugin
			try {
				const Ctor = moduleExport as new () => unknown;
				const instance = new Ctor();
				return this.isProfilePlugin(instance);
			} catch {
				return false;
			}
		}

		// Check if it's an object with a default export
		if (typeof (moduleExport as { default?: unknown }).default === "function") {
			try {
				const DefaultCtor = (moduleExport as { default: new () => unknown }).default;
				const instance = new DefaultCtor();
				return this.isProfilePlugin(instance);
			} catch {
				return false;
			}
		}

		return false;
	}

	private isProfilePlugin(instance: unknown): boolean {
		return (
			typeof instance === "object" &&
			instance !== null &&
			typeof (instance as ProfilePlugin).getProfile === "function" &&
			typeof (instance as ProfilePlugin).initialize === "function" &&
			typeof (instance as ProfilePlugin).cleanup === "function" &&
			typeof (instance as ProfilePlugin).metadata?.name === "string" &&
			typeof (instance as ProfilePlugin).metadata?.version === "string"
		);
	}
}

/**
 * Plugin configuration validator
 */
const _PluginConfigValidator = {
	validateConfig(
		config: Record<string, unknown>,
		schema: PluginConfigSchema,
	): { valid: boolean; errors: string[] } {
		const errors: string[] = [];

		if (!schema) {
			return { valid: true, errors: [] };
		}

		// Basic validation - in a real implementation, use a JSON schema validator like ajv
		if (typeof config !== "object" || config === null) {
			errors.push("Config must be an object");
			return { valid: false, errors };
		}

		// Validate required properties
		if (schema.required) {
			for (const requiredProp of schema.required) {
				if (!(requiredProp in config)) {
					errors.push(`Missing required property: ${requiredProp}`);
				}
			}
		}

		// Validate properties
		if (schema.properties) {
			for (const [propName, propSchema] of Object.entries(schema.properties)) {
				if (propName in config) {
					const value = config[propName];
					const schemaDef = propSchema;

					if (!_PluginConfigValidator.validateProperty(value, schemaDef)) {
						errors.push(`Invalid value for property ${propName}: expected ${schemaDef.type}`);
					}
				}
			}
		}

		return { valid: errors.length === 0, errors };
	},

	validateProperty(value: unknown, schema: PluginConfigSchema["properties"][string]): boolean {
		switch (schema.type) {
			case "string":
				return typeof value === "string";
			case "number":
				return typeof value === "number";
			case "boolean":
				return typeof value === "boolean";
			case "array":
				return Array.isArray(value);
			case "object":
				return typeof value === "object" && value !== null && !Array.isArray(value);
			default:
				return true;
		}
	},
};

/**
 * Plugin metadata extractor
 */
export const PluginMetadataExtractor = {
	async extractMetadata(filePath: string): Promise<PluginMetadata | null> {
		try {
			const content = await fs.readFile(filePath, "utf-8");

			// Try to extract metadata from package.json if it exists
			const packageJsonPath = path.join(path.dirname(filePath), "package.json");
			try {
				const packageJsonContent = await fs.readFile(packageJsonPath, "utf-8");
				const packageJson = JSON.parse(packageJsonContent);

				return {
					name: packageJson.name || path.basename(filePath, path.extname(filePath)),
					version: packageJson.version || "1.0.0",
					description: packageJson.description || "",
					author: packageJson.author || "Unknown",
					homepage: packageJson.homepage,
					repository: packageJson.repository?.url,
					license: packageJson.license || "MIT",
					keywords: packageJson.keywords || [],
					dependencies: Object.keys(packageJson.dependencies || {}),
					peerDependencies: Object.keys(packageJson.peerDependencies || {}),
					engines: packageJson.engines,
				};
			} catch {
				// No package.json found, try to extract from file content
				return PluginMetadataExtractor.extractFromContent(content, filePath);
			}
		} catch (error) {
			console.error(`[PLUGIN-METADATA] Failed to extract metadata from ${filePath}:`, error);
			return null;
		}
	},

	extractFromContent(content: string, filePath: string): PluginMetadata | null {
		// Basic extraction from comments or class annotations
		const name = path.basename(filePath, path.extname(filePath));

		// Try to find metadata in comments
		const metadataMatch = content.match(
			/\/\*\*\s*\n\s*\*\s*@name\s+(.+?)\s*\n\s*\*\s*@version\s+(.+?)\s*\n\s*\*\s*@description\s+(.+?)\s*\n\s*\*\s*@author\s+(.+?)\s*\n/s,
		);

		if (metadataMatch) {
			return {
				name: metadataMatch[1]?.trim() || "",
				version: metadataMatch[2]?.trim() || "",
				description: metadataMatch[3]?.trim() || "",
				author: metadataMatch[4]?.trim() || "",
				license: "MIT",
				keywords: [],
			};
		}

		// Fallback to basic metadata
		return {
			name,
			version: "1.0.0",
			description: `Plugin: ${name}`,
			author: "Unknown",
			license: "MIT",
			keywords: [],
		};
	},
};
