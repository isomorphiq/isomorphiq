/**
 * Application configuration interface
 */
export interface AppConfig {
	server: {
		httpPort: number;
		tcpPort: number;
		wsPath: string;
		host: string;
	};
	database: {
		path: string;
		valueEncoding: "json" | "utf8" | "binary";
	};
	auth: {
		jwtSecret: string;
		jwtRefreshSecret: string;
		tokenExpiry: {
			access: string; // e.g., "15m"
			refresh: string; // e.g., "7d"
		};
		passwordPolicy: {
			minLength: number;
			requireUppercase: boolean;
			requireLowercase: boolean;
			requireNumbers: boolean;
			requireSpecialChars: boolean;
			preventReuse: number;
			maxAge: number; // days
		};
		lockout: {
			maxAttempts: number;
			lockDuration: number; // minutes
		};
	};
	logging: {
		level: "error" | "warn" | "info" | "debug";
		format: "json" | "text";
		file?: string;
		maxFileSize?: number; // bytes
		maxFiles?: number;
	};
	features: {
		websockets: boolean;
		automation: boolean;
		templates: boolean;
		multiUser: boolean;
	};
	cors: {
		enabled: boolean;
		origins: string[];
		credentials: boolean;
	};
	environments: {
		headerName: string;
		default: string;
		available: string[];
	};
}

/**
 * Default configuration values
 */
export const defaultConfig: AppConfig = {
	server: {
		httpPort: parseInt(process.env.HTTP_PORT || "3003", 10),
		tcpPort: parseInt(process.env.TCP_PORT || "3001", 10),
		wsPath: process.env.WS_PATH || "/ws",
		host: process.env.HOST || "localhost",
	},
	database: {
		path: process.env.DB_PATH || "./db",
		valueEncoding: "json",
	},
	auth: {
		jwtSecret: process.env.JWT_SECRET || "",
		jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || "",
		tokenExpiry: {
			access: process.env.JWT_ACCESS_EXPIRY || "15m",
			refresh: process.env.JWT_REFRESH_EXPIRY || "7d",
		},
		passwordPolicy: {
			minLength: parseInt(process.env.PASSWORD_MIN_LENGTH || "8", 10),
			requireUppercase: process.env.PASSWORD_REQUIRE_UPPERCASE !== "false",
			requireLowercase: process.env.PASSWORD_REQUIRE_LOWERCASE !== "false",
			requireNumbers: process.env.PASSWORD_REQUIRE_NUMBERS !== "false",
			requireSpecialChars: process.env.PASSWORD_REQUIRE_SPECIAL !== "false",
			preventReuse: parseInt(process.env.PASSWORD_PREVENT_REUSE || "5", 10),
			maxAge: parseInt(process.env.PASSWORD_MAX_AGE || "90", 10),
		},
		lockout: {
			maxAttempts: parseInt(process.env.LOCKOUT_MAX_ATTEMPTS || "5", 10),
			lockDuration: parseInt(process.env.LOCKOUT_DURATION || "30", 10),
		},
	},
	logging: {
		level: (process.env.LOG_LEVEL as "debug" | "info" | "warn" | "error") || "info",
		format: (process.env.LOG_FORMAT as "json" | "text") || "json",
		...(process.env.LOG_FILE && { file: process.env.LOG_FILE }),
		maxFileSize: parseInt(process.env.LOG_MAX_FILE_SIZE || "10485760", 10), // 10MB
		maxFiles: parseInt(process.env.LOG_MAX_FILES || "5", 10),
	},
	features: {
		websockets: process.env.FEATURE_WEBSOCKETS !== "false",
		automation: process.env.FEATURE_AUTOMATION !== "false",
		templates: process.env.FEATURE_TEMPLATES !== "false",
		multiUser: process.env.FEATURE_MULTI_USER !== "false",
	},
	cors: {
		enabled: process.env.CORS_ENABLED !== "false",
		origins: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(",") : ["*"],
		credentials: process.env.CORS_CREDENTIALS === "true",
	},
	environments: {
		headerName:
			process.env.ENVIRONMENT_HEADER
			|| process.env.ISOMORPHIQ_ENVIRONMENT_HEADER
			|| "Environment",
		default:
			process.env.DEFAULT_ENVIRONMENT
			|| process.env.ISOMORPHIQ_DEFAULT_ENVIRONMENT
			|| "production",
		available: process.env.ISOMORPHIQ_ENVIRONMENTS
			? process.env.ISOMORPHIQ_ENVIRONMENTS.split(",")
			: process.env.ENVIRONMENTS
				? process.env.ENVIRONMENTS.split(",")
				: ["production", "integration"],
	},
};

/**
 * Configuration validator
 */
export const ConfigValidator = {
	validate(config: AppConfig): { isValid: boolean; errors: string[] } {
		const errors: string[] = [];

		// Validate server configuration
		if (config.server.httpPort < 1 || config.server.httpPort > 65535) {
			errors.push("HTTP port must be between 1 and 65535");
		}
		if (config.server.tcpPort < 1 || config.server.tcpPort > 65535) {
			errors.push("TCP port must be between 1 and 65535");
		}

		// Validate database configuration
		if (!config.database.path) {
			errors.push("Database path is required");
		}

		// Validate auth configuration (strict in production or when explicitly requested)
		const requireJwtSecrets =
			process.env.ISOMORPHIQ_REQUIRE_JWT_SECRETS === "true"
			|| process.env.NODE_ENV === "production";
		const hasJwtSecrets =
			(config.auth.jwtSecret && config.auth.jwtSecret.length > 0)
			|| (config.auth.jwtRefreshSecret && config.auth.jwtRefreshSecret.length > 0);
		if (requireJwtSecrets || hasJwtSecrets) {
			if (!config.auth.jwtSecret) {
				errors.push("JWT secret is required");
			}
			if (config.auth.jwtSecret.length < 32) {
				errors.push("JWT secret must be at least 32 characters long");
			}
			if (!config.auth.jwtRefreshSecret) {
				errors.push("JWT refresh secret is required");
			}
			if (config.auth.jwtRefreshSecret.length < 32) {
				errors.push("JWT refresh secret must be at least 32 characters long");
			}
		}

		// Validate password policy
		if (config.auth.passwordPolicy.minLength < 4) {
			errors.push("Password minimum length must be at least 4");
		}
		if (config.auth.passwordPolicy.maxAge < 1) {
			errors.push("Password max age must be at least 1 day");
		}

		// Validate logging configuration
		const validLogLevels = ["error", "warn", "info", "debug"];
		if (!validLogLevels.includes(config.logging.level)) {
			errors.push(`Invalid log level: ${config.logging.level}`);
		}
		const validLogFormats = ["json", "text"];
		if (!validLogFormats.includes(config.logging.format)) {
			errors.push(`Invalid log format: ${config.logging.format}`);
		}

		if (!config.environments.headerName || config.environments.headerName.trim().length === 0) {
			errors.push("Environment header name must be provided");
		}
		if (!config.environments.available || config.environments.available.length === 0) {
			errors.push("At least one environment must be configured");
		}
		if (!config.environments.default || config.environments.default.trim().length === 0) {
			errors.push("Default environment must be provided");
		}
		if (
			config.environments.default
			&& config.environments.available
			&& !config.environments.available.includes(config.environments.default)
		) {
			errors.push("Default environment must be listed in available environments");
		}

		return {
			isValid: errors.length === 0,
			errors,
		};
	},

	sanitize(config: Partial<AppConfig>): AppConfig {
		const normalizeEnvironment = (value: string | undefined): string => {
			if (!value) return "";
			return value.trim().toLowerCase();
		};
		const normalizeEnvironmentList = (values: string[] | undefined): string[] => {
			if (!values || values.length === 0) return [];
			return values
				.map((value) => normalizeEnvironment(value))
				.filter((value) => value.length > 0);
		};
		const envAvailable = normalizeEnvironmentList(
			config.environments?.available ?? defaultConfig.environments.available,
		);
		const envDefault = normalizeEnvironment(
			config.environments?.default ?? defaultConfig.environments.default,
		);
		const resolvedAvailable =
			envAvailable.length > 0
				? envAvailable.includes(envDefault)
					? envAvailable
					: [envDefault, ...envAvailable]
				: [envDefault];
		const resolvedHeaderName =
			config.environments?.headerName?.trim()
			|| defaultConfig.environments.headerName;

		return {
			server: {
				...defaultConfig.server,
				...config.server,
			},
			database: {
				...defaultConfig.database,
				...config.database,
			},
			auth: {
				...defaultConfig.auth,
				...config.auth,
				tokenExpiry: {
					...defaultConfig.auth.tokenExpiry,
					...config.auth?.tokenExpiry,
				},
				passwordPolicy: {
					...defaultConfig.auth.passwordPolicy,
					...config.auth?.passwordPolicy,
				},
				lockout: {
					...defaultConfig.auth.lockout,
					...config.auth?.lockout,
				},
			},
			logging: {
				...defaultConfig.logging,
				...config.logging,
			},
			features: {
				...defaultConfig.features,
				...config.features,
			},
			cors: {
				...defaultConfig.cors,
				...config.cors,
			},
			environments: {
				headerName: resolvedHeaderName,
				default: envDefault,
				available: resolvedAvailable,
			},
		};
	},
};

/**
 * Configuration manager
 */
export class ConfigManager {
	private static instance: ConfigManager;
	private config: AppConfig;

	private constructor() {
		this.config = this.loadConfig();
	}

	static getInstance(): ConfigManager {
		if (!ConfigManager.instance) {
			ConfigManager.instance = new ConfigManager();
		}
		return ConfigManager.instance;
	}

	private loadConfig(): AppConfig {
		// Start with default config
		let config = { ...defaultConfig };

		// Override with environment variables
		config = ConfigValidator.sanitize(config);

		// Validate final configuration
		const validation = ConfigValidator.validate(config);
		if (!validation.isValid) {
			console.error("Configuration validation failed:");
			validation.errors.forEach((error) => {
				console.error(`  - ${error}`);
			});
			throw new Error(`Invalid configuration: ${validation.errors.join(", ")}`);
		}

		return config;
	}

	getConfig(): AppConfig {
		return { ...this.config };
	}

	updateConfig(updates: Partial<AppConfig>): void {
		this.config = ConfigValidator.sanitize({
			...this.config,
			...updates,
		});

		// Validate updated configuration
		const validation = ConfigValidator.validate(this.config);
		if (!validation.isValid) {
			console.error("Configuration update validation failed:");
			validation.errors.forEach((error) => {
				console.error(`  - ${error}`);
			});
			throw new Error(`Invalid configuration update: ${validation.errors.join(", ")}`);
		}
	}

	getServerConfig() {
		return this.config.server;
	}

	getDatabaseConfig() {
		return this.config.database;
	}

	getAuthConfig() {
		return this.config.auth;
	}

	getLoggingConfig() {
		return this.config.logging;
	}

	getFeaturesConfig() {
		return this.config.features;
	}

	getCorsConfig() {
		return this.config.cors;
	}

	getEnvironmentConfig() {
		return this.config.environments;
	}

	isFeatureEnabled(feature: keyof AppConfig["features"]): boolean {
		return this.config.features[feature];
	}
}
