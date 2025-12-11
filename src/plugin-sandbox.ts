import { EventEmitter } from "node:events";
import type { ProfilePlugin } from "./plugin-system.ts";

/**
 * Plugin sandbox for security isolation
 */
export class PluginSandbox extends EventEmitter {
	private allowedModules: Set<string>;
	private allowedPaths: Set<string>;
	private resourceLimits: ResourceLimits;
	public plugin: ProfilePlugin;

	constructor(plugin: ProfilePlugin, options: SandboxOptions = {}) {
		super();
		this.plugin = plugin;
		this.allowedModules = new Set(options.allowedModules || DEFAULT_ALLOWED_MODULES);
		this.allowedPaths = new Set(options.allowedPaths || []);
		this.resourceLimits = {
			maxMemory: options.maxMemory || DEFAULT_MEMORY_LIMIT,
			maxCpuTime: options.maxCpuTime || DEFAULT_CPU_TIME_LIMIT,
			maxFileOperations: options.maxFileOperations || DEFAULT_FILE_OPERATIONS_LIMIT,
			maxNetworkRequests: options.maxNetworkRequests || DEFAULT_NETWORK_REQUESTS_LIMIT,
			...options.resourceLimits,
		};
	}

	/**
	 * Execute a plugin method within the sandbox
	 */
	async executeMethod<T = unknown>(
		methodName: keyof ProfilePlugin,
		...args: unknown[]
	): Promise<T> {
		const startTime = Date.now();
		const _memoryUsage = process.memoryUsage();

		try {
			// Check if method exists and is callable
			const method = this.plugin[methodName];
			if (typeof method !== "function") {
				throw new Error(`Method ${String(methodName)} not found or not callable`);
			}

			// Set up resource monitoring
			const monitoring = this.startResourceMonitoring();

			try {
				// Execute the method
				const result = await (method as (...innerArgs: unknown[]) => unknown).apply(
					this.plugin,
					args,
				);

				// Check resource usage
				const usage = monitoring.stop();
				this.validateResourceUsage(usage);

				// Emit success event
				this.emit("methodExecuted", {
					method: methodName,
					args,
					result,
					duration: Date.now() - startTime,
					resourceUsage: usage,
				});

				return result;
			} catch (error) {
				// Emit error event
				this.emit("methodError", {
					method: methodName,
					args,
					error,
					duration: Date.now() - startTime,
				});

				throw error;
			}
		} catch (error) {
			// Emit sandbox error
			this.emit("sandboxError", {
				plugin: this.plugin.metadata.name,
				method: methodName,
				error,
				timestamp: new Date(),
			});

			throw error;
		}
	}

	/**
	 * Validate plugin configuration against security policies
	 */
	validateConfig(config: Record<string, unknown>): SecurityValidationResult {
		const violations: SecurityViolation[] = [];

		// Check for dangerous settings
		if (config.settings) {
			this.checkDangerousSettings(config.settings, violations);
		}

		// Check file access patterns
		if (config.settings?.allowedPaths) {
			this.checkPathSecurity(config.settings.allowedPaths, violations);
		}

		// Check network permissions
		if (config.settings?.networkAccess) {
			this.checkNetworkSecurity(config.settings.networkAccess, violations);
		}

		return {
			valid: violations.length === 0,
			violations,
		};
	}

	/**
	 * Check if a module access is allowed
	 */
	isModuleAllowed(moduleName: string): boolean {
		return this.allowedModules.has(moduleName);
	}

	/**
	 * Check if a file path access is allowed
	 */
	isPathAllowed(filePath: string): boolean {
		const resolvedPath = require("node:path").resolve(filePath);

		// Check against allowed paths
		for (const allowedPath of this.allowedPaths) {
			const resolvedAllowed = require("node:path").resolve(allowedPath);
			if (resolvedPath.startsWith(resolvedAllowed)) {
				return true;
			}
		}

		// Check against default safe paths
		return this.isDefaultSafePath(resolvedPath);
	}

	/**
	 * Get current resource usage
	 */
	getResourceUsage(): ResourceUsage {
		const memUsage = process.memoryUsage();
		return {
			memory: {
				used: memUsage.heapUsed,
				total: memUsage.heapTotal,
				limit: this.resourceLimits.maxMemory,
			},
			cpuTime: {
				used: 0, // Would need more complex tracking
				limit: this.resourceLimits.maxCpuTime,
			},
			fileOperations: {
				used: 0, // Would need file operation tracking
				limit: this.resourceLimits.maxFileOperations,
			},
			networkRequests: {
				used: 0, // Would need network request tracking
				limit: this.resourceLimits.maxNetworkRequests,
			},
		};
	}

	private startResourceMonitoring(): ResourceMonitor {
		const startTime = Date.now();
		const startMemory = process.memoryUsage();
		const fileOps = 0;
		const networkReqs = 0;

		// In a real implementation, you'd hook into file and network operations
		// For now, we'll just track time and memory

		return {
			stop: () => ({
				duration: Date.now() - startTime,
				memoryUsed: process.memoryUsage().heapUsed - startMemory.heapUsed,
				fileOperations: fileOps,
				networkRequests: networkReqs,
			}),
		};
	}

	private validateResourceUsage(usage: {
		memoryUsed: number;
		cpuTime: number;
		fileOperations: number;
		networkRequests: number;
	}): void {
		if (usage.memoryUsed > this.resourceLimits.maxMemory) {
			throw new Error(
				`Memory limit exceeded: ${usage.memoryUsed} > ${this.resourceLimits.maxMemory}`,
			);
		}

		if (usage.duration > this.resourceLimits.maxCpuTime) {
			throw new Error(
				`CPU time limit exceeded: ${usage.duration} > ${this.resourceLimits.maxCpuTime}`,
			);
		}

		if (usage.fileOperations > this.resourceLimits.maxFileOperations) {
			throw new Error(
				`File operations limit exceeded: ${usage.fileOperations} > ${this.resourceLimits.maxFileOperations}`,
			);
		}

		if (usage.networkRequests > this.resourceLimits.maxNetworkRequests) {
			throw new Error(
				`Network requests limit exceeded: ${usage.networkRequests} > ${this.resourceLimits.maxNetworkRequests}`,
			);
		}
	}

	private checkDangerousSettings(
		settings: Record<string, unknown>,
		violations: SecurityViolation[],
	): void {
		const dangerousKeys = [
			"eval",
			"exec",
			"spawn",
			"child_process",
			"require.main",
			"module.parent",
			"process.env",
		];

		for (const key of dangerousKeys) {
			if (key in settings) {
				violations.push({
					type: "dangerous_setting",
					message: `Dangerous setting detected: ${key}`,
					severity: "high",
				});
			}
		}
	}

	private checkPathSecurity(paths: string[], violations: SecurityViolation[]): void {
		for (const path of paths) {
			const resolved = require("node:path").resolve(path);

			// Check for system paths
			if (
				resolved.includes("/etc/") ||
				resolved.includes("/sys/") ||
				resolved.includes("/proc/") ||
				resolved.includes("\\Windows\\")
			) {
				violations.push({
					type: "unsafe_path",
					message: `Unsafe system path access: ${path}`,
					severity: "high",
				});
			}

			// Check for path traversal
			if (path.includes("../") || path.includes("..\\\\")) {
				violations.push({
					type: "path_traversal",
					message: `Path traversal attempt: ${path}`,
					severity: "high",
				});
			}
		}
	}

	private checkNetworkSecurity(
		networkAccess: { allowInternal?: boolean; allowExternal?: boolean },
		violations: SecurityViolation[],
	): void {
		if (networkAccess.allowInternal !== false) {
			violations.push({
				type: "network_security",
				message: "Internal network access should be explicitly disabled",
				severity: "medium",
			});
		}

		if (networkAccess.allowedHosts) {
			for (const host of networkAccess.allowedHosts) {
				if (host === "localhost" || host === "127.0.0.1") {
					violations.push({
						type: "network_security",
						message: `Localhost access should be restricted: ${host}`,
						severity: "medium",
					});
				}
			}
		}
	}

	private isDefaultSafePath(filePath: string): boolean {
		const safePaths = [
			process.cwd(), // Current working directory
			require("node:os").tmpdir(), // Temp directory
			"/tmp", // Unix temp
			"C:\\\\temp", // Windows temp
		];

		return safePaths.some((safePath) => filePath.startsWith(safePath));
	}
}

// Interfaces and types
export interface SandboxOptions {
	allowedModules?: string[];
	allowedPaths?: string[];
	maxMemory?: number;
	maxCpuTime?: number;
	maxFileOperations?: number;
	maxNetworkRequests?: number;
	resourceLimits?: Partial<ResourceLimits>;
}

export interface ResourceLimits {
	maxMemory: number;
	maxCpuTime: number;
	maxFileOperations: number;
	maxNetworkRequests: number;
}

export interface ResourceUsage {
	memory: {
		used: number;
		total: number;
		limit: number;
	};
	cpuTime: {
		used: number;
		limit: number;
	};
	fileOperations: {
		used: number;
		limit: number;
	};
	networkRequests: {
		used: number;
		limit: number;
	};
}

export interface SecurityValidationResult {
	valid: boolean;
	violations: SecurityViolation[];
}

export interface SecurityViolation {
	type: string;
	message: string;
	severity: "low" | "medium" | "high" | "critical";
}

interface ResourceMonitor {
	stop(): {
		duration: number;
		memoryUsed: number;
		fileOperations: number;
		networkRequests: number;
	};
}

// Default security settings
const DEFAULT_ALLOWED_MODULES = [
	"fs",
	"path",
	"os",
	"crypto",
	"util",
	"events",
	"stream",
	"buffer",
	"string_decoder",
	"url",
	"querystring",
	"assert",
];

const DEFAULT_MEMORY_LIMIT = 100 * 1024 * 1024; // 100MB
const DEFAULT_CPU_TIME_LIMIT = 30000; // 30 seconds
const DEFAULT_FILE_OPERATIONS_LIMIT = 1000;
const DEFAULT_NETWORK_REQUESTS_LIMIT = 10;

/**
 * Plugin security manager
 */
export class PluginSecurityManager {
	private sandboxes = new Map<string, PluginSandbox>();

	createSandbox(plugin: ProfilePlugin, options?: SandboxOptions): PluginSandbox {
		const sandbox = new PluginSandbox(plugin, options);
		this.sandboxes.set(plugin.metadata.name, sandbox);

		// Set up event listeners
		sandbox.on("sandboxError", (event) => {
			console.error("[PLUGIN-SECURITY] Sandbox error:", event);
		});

		sandbox.on("methodExecuted", (event) => {
			console.debug("[PLUGIN-SECURITY] Method executed:", event.method, `${event.duration}ms`);
		});

		return sandbox;
	}

	getSandbox(pluginName: string): PluginSandbox | undefined {
		return this.sandboxes.get(pluginName);
	}

	removeSandbox(pluginName: string): void {
		const sandbox = this.sandboxes.get(pluginName);
		if (sandbox) {
			sandbox.removeAllListeners();
			this.sandboxes.delete(pluginName);
		}
	}

	validateAllPlugins(plugins: ProfilePlugin[]): Map<string, SecurityValidationResult> {
		const results = new Map<string, SecurityValidationResult>();

		for (const plugin of plugins) {
			const sandbox = this.sandboxes.get(plugin.metadata.name);
			if (sandbox && typeof plugin.getConfig === "function") {
				const config = plugin.getConfig();
				const validation = sandbox.validateConfig(config as Record<string, unknown>);
				results.set(plugin.metadata.name, validation);
			}
		}

		return results;
	}

	getSecurityReport(): SecurityReport {
		const sandboxes = Array.from(this.sandboxes.values());
		const totalPlugins = sandboxes.length;
		const activeSandboxes = sandboxes.filter((s) => s.plugin.state === "active").length;

		return {
			totalPlugins,
			activeSandboxes,
			securityViolations: 0, // Would need to track violations
			lastSecurityCheck: new Date(),
			resourceUsage: sandboxes.map((s) => ({
				plugin: s.plugin.metadata.name,
				usage: s.getResourceUsage(),
			})),
		};
	}
}

export interface SecurityReport {
	totalPlugins: number;
	activeSandboxes: number;
	securityViolations: number;
	lastSecurityCheck: Date;
	resourceUsage: Array<{
		plugin: string;
		usage: ResourceUsage;
	}>;
}
