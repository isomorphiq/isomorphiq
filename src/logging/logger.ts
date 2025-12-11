import type { AppConfig } from "../config/config.ts";

/**
 * Log levels in order of severity
 */
export type LogLevel = "error" | "warn" | "info" | "debug";

/**
 * Log entry interface
 */
export interface LogEntry {
	timestamp: string;
	level: LogLevel;
	message: string;
	context?: string;
	userId?: string;
	requestId?: string;
	metadata?: Record<string, unknown>;
	error?: {
		name: string;
		message: string;
		stack: string;
	};
}

/**
 * Logger interface
 */
export interface ILogger {
	error(message: string, context?: string, metadata?: Record<string, unknown>): void;
	warn(message: string, context?: string, metadata?: Record<string, unknown>): void;
	info(message: string, context?: string, metadata?: Record<string, unknown>): void;
	debug(message: string, context?: string, metadata?: Record<string, unknown>): void;
	log(level: LogLevel, message: string, context?: string, metadata?: Record<string, unknown>): void;
}

/**
 * File logger implementation
 */
export class FileLogger implements ILogger {
	private logFile: string;
	private maxFileSize: number;
	private maxFiles: number;
	private currentFileSize: number = 0;

	constructor(
		private config: AppConfig["logging"],
		private context: string = "App",
	) {
		this.logFile = config.file || "app.log";
		this.maxFileSize = config.maxFileSize || 10 * 1024 * 1024; // 10MB
		this.maxFiles = config.maxFiles || 5;
	}

	private shouldRotate(): boolean {
		return this.currentFileSize >= this.maxFileSize;
	}

	private rotateLogFile(): void {
		if (!this.config.file) return;

		const fs = require("node:fs");
		const _path = require("node:path");

		// Move current log file to backup
		for (let i = this.maxFiles - 1; i > 0; i--) {
			const oldFile = `${this.logFile}.${i}`;
			const newFile = `${this.logFile}.${i + 1}`;

			if (fs.existsSync(oldFile)) {
				if (fs.existsSync(newFile)) {
					fs.unlinkSync(newFile);
				}
				fs.renameSync(oldFile, newFile);
			}
		}

		// Move current log to .1
		const backupFile = `${this.logFile}.1`;
		if (fs.existsSync(this.logFile)) {
			if (fs.existsSync(backupFile)) {
				fs.unlinkSync(backupFile);
			}
			fs.renameSync(this.logFile, backupFile);
		}

		this.currentFileSize = 0;
	}

	private writeLog(entry: LogEntry): void {
		if (!this.config.file) {
			// Fallback to console if no file configured
			this.writeToConsole(entry);
			return;
		}

		const fs = require("node:fs");
		const logLine = this.formatLog(entry);

		try {
			fs.appendFileSync(this.logFile, `${logLine}\n`);
			this.currentFileSize += Buffer.byteLength(`${logLine}\n`, "utf8");

			if (this.shouldRotate()) {
				this.rotateLogFile();
			}
		} catch (error) {
			console.error("Failed to write to log file:", error);
			this.writeToConsole(entry);
		}
	}

	private formatLog(entry: LogEntry): string {
		if (this.config.format === "json") {
			return JSON.stringify(entry);
		} else {
			const timestamp = new Date(entry.timestamp).toISOString();
			const contextStr = entry.context ? `[${entry.context}]` : "";
			const metadataStr = entry.metadata ? ` ${JSON.stringify(entry.metadata)}` : "";
			return `${timestamp} ${entry.level.toUpperCase()} ${contextStr} ${entry.message}${metadataStr}`;
		}
	}

	private writeToConsole(entry: LogEntry): void {
		const timestamp = new Date(entry.timestamp).toISOString();
		const contextStr = entry.context ? `[${entry.context}]` : "";
		const message = `${timestamp} ${entry.level.toUpperCase()} ${contextStr} ${entry.message}`;

		switch (entry.level) {
			case "error":
				console.error(message, entry.metadata || "", entry.error || "");
				break;
			case "warn":
				console.warn(message, entry.metadata || "");
				break;
			case "info":
				console.info(message, entry.metadata || "");
				break;
			case "debug":
				console.debug(message, entry.metadata || "");
				break;
		}
	}

	error(message: string, context?: string, metadata?: Record<string, unknown>): void {
		this.log("error", message, context, metadata);
	}

	warn(message: string, context?: string, metadata?: Record<string, unknown>): void {
		this.log("warn", message, context, metadata);
	}

	info(message: string, context?: string, metadata?: Record<string, unknown>): void {
		this.log("info", message, context, metadata);
	}

	debug(message: string, context?: string, metadata?: Record<string, unknown>): void {
		this.log("debug", message, context, metadata);
	}

	log(
		level: LogLevel,
		message: string,
		context?: string,
		metadata?: Record<string, unknown>,
	): void {
		const config = require("../config/config.ts").ConfigManager.getInstance().getLoggingConfig();

		// Only log if level is enabled
		if (!this.isLevelEnabled(level, config.level)) {
			return;
		}

		const entry: LogEntry = {
			timestamp: new Date().toISOString(),
			level,
			message,
			context: context || this.context,
			...(metadata && { metadata }),
		};

		// Add error details if error object is passed
		if (metadata && metadata.error instanceof Error) {
			entry.error = {
				name: metadata.error.name,
				message: metadata.error.message,
				stack: metadata.error.stack,
			};
			entry.metadata = { ...metadata };
			delete (entry.metadata as { error?: unknown }).error;
		}

		this.writeLog(entry);
	}

	private isLevelEnabled(logLevel: LogLevel, configLevel: LogLevel): boolean {
		const levels: LogLevel[] = ["error", "warn", "info", "debug"];
		const logIndex = levels.indexOf(logLevel);
		const configIndex = levels.indexOf(configLevel);
		return logIndex <= configIndex;
	}
}

/**
 * Console logger implementation
 */
export class ConsoleLogger implements ILogger {
	error(message: string, context?: string, metadata?: Record<string, unknown>): void {
		this.log("error", message, context, metadata);
	}

	warn(message: string, context?: string, metadata?: Record<string, unknown>): void {
		this.log("warn", message, context, metadata);
	}

	info(message: string, context?: string, metadata?: Record<string, unknown>): void {
		this.log("info", message, context, metadata);
	}

	debug(message: string, context?: string, metadata?: Record<string, unknown>): void {
		this.log("debug", message, context, metadata);
	}

	log(
		level: LogLevel,
		message: string,
		context?: string,
		metadata?: Record<string, unknown>,
	): void {
		const config = require("../config/config.ts").ConfigManager.getInstance().getLoggingConfig();

		// Only log if level is enabled
		if (!this.isLevelEnabled(level, config.level)) {
			return;
		}

		const timestamp = new Date().toISOString();
		const contextStr = context ? `[${context}]` : "";
		const metadataStr = metadata ? ` ${JSON.stringify(metadata)}` : "";
		const logMessage = `${timestamp} ${level.toUpperCase()} ${contextStr} ${message}${metadataStr}`;

		switch (level) {
			case "error":
				console.error(logMessage);
				break;
			case "warn":
				console.warn(logMessage);
				break;
			case "info":
				console.info(logMessage);
				break;
			case "debug":
				console.debug(logMessage);
				break;
		}
	}

	private isLevelEnabled(logLevel: LogLevel, configLevel: LogLevel): boolean {
		const levels: LogLevel[] = ["error", "warn", "info", "debug"];
		const logIndex = levels.indexOf(logLevel);
		const configIndex = levels.indexOf(configLevel);
		return logIndex <= configIndex;
	}
}

/**
 * Null logger (disables logging)
 */
export class NullLogger implements ILogger {
	error(): void {}
	warn(): void {}
	info(): void {}
	debug(): void {}
	log(): void {}
}

/**
 * Logger factory
 */
const _LoggerFactory = (() => {
	const loggers: Map<string, ILogger> = new Map();
	let config: AppConfig["logging"];

	const getLogger = (context?: string): ILogger => {
		const key = context || "default";

		if (!loggers.has(key)) {
			const logger: ILogger = config.file ? new FileLogger(config, context) : new ConsoleLogger();
			loggers.set(key, logger);
		}

		const logger = loggers.get(key);
		if (!logger) {
			throw new Error("Logger not initialized");
		}
		return logger;
	};

	return {
		initialize(newConfig: AppConfig["logging"]): void {
			config = newConfig;
		},
		getLogger,
		setLevel(level: LogLevel): void {
			if (config) {
				config.level = level;
				loggers.clear();
			}
		},
		createRequestLogger(requestId: string, userId?: string): ILogger {
			const baseLogger = getLogger(requestId);

			return {
				error: (message: string, ctx?: string, metadata?: Record<string, unknown>) => {
					baseLogger.error(message, ctx, { ...metadata, requestId, userId });
				},
				warn: (message: string, ctx?: string, metadata?: Record<string, unknown>) => {
					baseLogger.warn(message, ctx, { ...metadata, requestId, userId });
				},
				info: (message: string, ctx?: string, metadata?: Record<string, unknown>) => {
					baseLogger.info(message, ctx, { ...metadata, requestId, userId });
				},
				debug: (message: string, ctx?: string, metadata?: Record<string, unknown>) => {
					baseLogger.debug(message, ctx, { ...metadata, requestId, userId });
				},
				log: (
					level: LogLevel,
					message: string,
					ctx?: string,
					metadata?: Record<string, unknown>,
				) => {
					baseLogger.log(level, message, ctx, { ...metadata, requestId, userId });
				},
			};
		},
	};
})();
