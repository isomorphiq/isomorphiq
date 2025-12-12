// Enhanced structured logger utility
export interface LogEntry {
	timestamp: string;
	level: LogLevel;
	message: string;
	service?: string;
	component?: string | undefined;
	taskId?: string;
	userId?: string;
	sessionId?: string;
	error?: {
		name: string;
		message: string;
		stack?: string;
		code?: string;
	};
	metadata?: Record<string, unknown>;
	duration?: number;
	correlationId?: string;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export class Logger {
	private level: LogLevel = "info";
	private service: string;
	private component?: string;

	constructor(level: LogLevel = "info", service: string = "task-manager", component?: string) {
		this.level = level;
		this.service = service;
		if (component !== undefined) {
			this.component = component;
		}
	}

	private shouldLog(level: LogLevel): boolean {
		const levels: LogLevel[] = ["debug", "info", "warn", "error"];
		return levels.indexOf(level) >= levels.indexOf(this.level);
	}

	private createLogEntry(
		level: LogLevel,
		message: string,
		metadata?: Record<string, unknown>,
	): LogEntry {
		const entry: LogEntry = {
			timestamp: new Date().toISOString(),
			level,
			message,
			service: this.service,
			...metadata,
		};

		if (this.component !== undefined) {
			entry.component = this.component;
		}

		return entry;
	}

	private formatLogEntry(entry: LogEntry): string {
		const baseFields = [
			entry.timestamp,
			entry.level.toUpperCase(),
			entry.service,
			entry.component || "unknown",
		]
			.filter(Boolean)
			.join(" | ");

		let message = `[${baseFields}] ${entry.message}`;

		// Add contextual fields
		const contextFields: string[] = [];
		if (entry.taskId) contextFields.push(`task=${entry.taskId}`);
		if (entry.userId) contextFields.push(`user=${entry.userId}`);
		if (entry.sessionId) contextFields.push(`session=${entry.sessionId}`);
		if (entry.correlationId) contextFields.push(`corr=${entry.correlationId}`);
		if (entry.duration !== undefined) contextFields.push(`duration=${entry.duration}ms`);

		if (contextFields.length > 0) {
			message += ` [${contextFields.join(", ")}]`;
		}

		// Add structured metadata
		if (entry.error || entry.metadata) {
			const structured = {
				...(entry.error && { error: entry.error }),
				...(entry.metadata && { meta: entry.metadata }),
			};
			message += ` ${JSON.stringify(structured)}`;
		}

		return message;
	}

	private log(level: LogLevel, message: string, metadata?: Record<string, unknown>): void {
		if (!this.shouldLog(level)) return;

		const entry = this.createLogEntry(level, message, metadata);
		const formattedMessage = this.formatLogEntry(entry);

		switch (level) {
			case "debug":
				console.debug(formattedMessage);
				break;
			case "info":
				console.info(formattedMessage);
				break;
			case "warn":
				console.warn(formattedMessage);
				break;
			case "error":
				console.error(formattedMessage);
				break;
		}
	}

	debug(message: string, metadata?: Record<string, unknown>): void {
		this.log("debug", message, metadata);
	}

	info(message: string, metadata?: Record<string, unknown>): void {
		this.log("info", message, metadata);
	}

	warn(message: string, metadata?: Record<string, unknown>): void {
		this.log("warn", message, metadata);
	}

	error(
		message: string,
		error?: Error | Record<string, unknown>,
		metadata?: Record<string, unknown>,
	): void {
		let errorData: LogEntry["error"];

		if (error instanceof Error) {
			const code = (error as { code?: string | number }).code;
			errorData = {
				name: error.name,
				message: error.message,
				stack: error.stack,
				...(code !== undefined && { code: String(code) }),
			};
		} else if (error && typeof error === "object") {
			errorData = error as LogEntry["error"];
		}

		this.log("error", message, {
			...metadata,
			...(errorData && { error: errorData }),
		});
	}

	// Performance logging
	startTimer(operation: string, metadata?: Record<string, unknown>): () => void {
		const startTime = Date.now();
		const correlationId = this.generateCorrelationId();

		this.debug(`Starting operation: ${operation}`, {
			...metadata,
			correlationId,
			operationStart: true,
		});

		return () => {
			const duration = Date.now() - startTime;
			this.info(`Completed operation: ${operation}`, {
				...metadata,
				correlationId,
				duration,
				operationComplete: true,
			});
		};
	}

	// Task-specific logging
	logTaskEvent(
		taskId: string,
		event: string,
		message: string,
		metadata?: Record<string, unknown>,
	): void {
		this.info(message, {
			...metadata,
			taskId,
			taskEvent: event,
		});
	}

	logTaskError(
		taskId: string,
		event: string,
		message: string,
		error?: Error,
		metadata?: Record<string, unknown>,
	): void {
		this.error(message, error, {
			...metadata,
			taskId,
			taskEvent: event,
		});
	}

	// Create child logger with additional context
	child(context: { component?: string; service?: string }): Logger {
		return new Logger(
			this.level,
			context.service || this.service,
			context.component || this.component,
		);
	}

	private generateCorrelationId(): string {
		return (
			Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
		);
	}

	// Static factory methods
	static create(service: string, component?: string): Logger {
		return new Logger("info", service, component);
	}

	static createDebug(service: string, component?: string): Logger {
		return new Logger("debug", service, component);
	}
}

// Default logger instance
export const logger = Logger.create("task-manager");
