/* eslint-disable no-unused-vars, @typescript-eslint/no-unused-vars */
import type { DomainEvent, EventMiddleware } from "./events.ts";

// Logging middleware
export const loggingMiddleware: EventMiddleware = (event, next) => {
	console.log(`[Event] ${event.type} at ${event.timestamp.toISOString()}`, {
		id: event.id,
		metadata: event.metadata,
	});
	next();
};

// Metrics collection middleware
export class MetricsMiddleware {
	private metrics: Map<string, number> = new Map();
	private eventCounts: Map<string, number> = new Map();

	middleware: EventMiddleware = (event, next) => {
		const startTime = Date.now();

		// Count events by type
		const currentCount = this.eventCounts.get(event.type) || 0;
		this.eventCounts.set(event.type, currentCount + 1);

		next();

		// Record processing time
		const processingTime = Date.now() - startTime;
		this.metrics.set(event.type, processingTime);
	};

	getMetrics(): {
		eventCounts: Record<string, number>;
		averageProcessingTimes: Record<string, number>;
	} {
		const eventCounts: Record<string, number> = {};
		const averageProcessingTimes: Record<string, number> = {};

		for (const [eventType, count] of this.eventCounts) {
			eventCounts[eventType] = count;
		}

		for (const [eventType, time] of this.metrics) {
			averageProcessingTimes[eventType] = time;
		}

		return { eventCounts, averageProcessingTimes };
	}

	reset(): void {
		this.metrics.clear();
		this.eventCounts.clear();
	}
}

// Event filtering middleware
export class EventFilterMiddleware {
	private allowedTypes: Set<string>;
	private blockedTypes: Set<string>;
	private allowedSources: Set<string>;
	private blockedSources: Set<string>;

	constructor(
		options: {
			allowedTypes?: string[];
			blockedTypes?: string[];
			allowedSources?: string[];
			blockedSources?: string[];
		} = {},
	) {
		this.allowedTypes = new Set(options.allowedTypes || []);
		this.blockedTypes = new Set(options.blockedTypes || []);
		this.allowedSources = new Set(options.allowedSources || []);
		this.blockedSources = new Set(options.blockedSources || []);
	}

	middleware: EventMiddleware = (event, next) => {
		// Check type filters
		if (this.allowedTypes.size > 0 && !this.allowedTypes.has(event.type)) {
			return; // Skip event
		}

		if (this.blockedTypes.has(event.type)) {
			return; // Skip event
		}

		// Check source filters
		const source = event.metadata?.source;
		if (source) {
			if (this.allowedSources.size > 0 && !this.allowedSources.has(source)) {
				return; // Skip event
			}

			if (this.blockedSources.has(source)) {
				return; // Skip event
			}
		}

		next();
	};

	addAllowedType(eventType: string): void {
		this.allowedTypes.add(eventType);
	}

	removeAllowedType(eventType: string): void {
		this.allowedTypes.delete(eventType);
	}

	addBlockedType(eventType: string): void {
		this.blockedTypes.add(eventType);
	}

	removeBlockedType(eventType: string): void {
		this.blockedTypes.delete(eventType);
	}
}

// Event transformation middleware
export class EventTransformMiddleware {
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	private transformers: Map<string, (event: DomainEvent) => DomainEvent> = new Map();

	addTransformer(eventType: string, transformer: (event: DomainEvent) => DomainEvent): void {
		this.transformers.set(eventType, transformer);
	}

	removeTransformer(eventType: string): void {
		this.transformers.delete(eventType);
	}

	middleware: EventMiddleware = (event, next) => {
		const transformer = this.transformers.get(event.type);
		if (transformer) {
			try {
				const transformedEvent = transformer(event);
				// Replace the event with transformed version
				Object.assign(event, transformedEvent);
			} catch (error) {
				console.error(`[EventTransform] Error transforming event ${event.type}:`, error);
			}
		}

		next();
	};
}

// Rate limiting middleware
export class RateLimitMiddleware {
	private eventCounts: Map<string, { count: number; resetTime: number }> = new Map();
	private maxEventsPerWindow: number;
	private windowSizeMs: number;

	constructor(maxEventsPerWindow: number = 100, windowSizeMs: number = 60000) {
		this.maxEventsPerWindow = maxEventsPerWindow;
		this.windowSizeMs = windowSizeMs;
	}

	middleware: EventMiddleware = (event, next) => {
		const now = Date.now();
		const key = event.type;

		const current = this.eventCounts.get(key);
		if (!current || now > current.resetTime) {
			// Reset window
			this.eventCounts.set(key, {
				count: 1,
				resetTime: now + this.windowSizeMs,
			});
			next();
			return;
		}

		if (current.count >= this.maxEventsPerWindow) {
			console.warn(`[RateLimit] Event type ${event.type} exceeded rate limit`);
			return; // Skip event
		}

		current.count++;
		next();
	};

	getStats(): Record<string, { count: number; resetTime: number }> {
		const stats: Record<string, { count: number; resetTime: number }> = {};
		for (const [key, value] of this.eventCounts) {
			stats[key] = { ...value };
		}
		return stats;
	}

	reset(): void {
		this.eventCounts.clear();
	}
}

// Event enrichment middleware
export class EventEnrichmentMiddleware {
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	private enrichers: Map<string, (event: DomainEvent) => Partial<DomainEvent>> = new Map();

	addEnricher(eventType: string, enricher: (event: DomainEvent) => Partial<DomainEvent>): void {
		this.enrichers.set(eventType, enricher);
	}

	removeEnricher(eventType: string): void {
		this.enrichers.delete(eventType);
	}

	middleware: EventMiddleware = (event, next) => {
		const enricher = this.enrichers.get(event.type);
		if (enricher) {
			try {
				const enrichment = enricher(event);
				// Merge enrichment into event
				Object.assign(event, enrichment);
			} catch (error) {
				console.error(`[EventEnrichment] Error enriching event ${event.type}:`, error);
			}
		}

		next();
	};
}

// Error handling middleware
export class ErrorHandlingMiddleware {
	private errorHandler: (event: DomainEvent, error: Error) => void;

	constructor(errorHandler?: (event: DomainEvent, error: Error) => void) {
		this.errorHandler =
			errorHandler ||
			((_event, _error) => {
				// Default error handler
			});
	}

	middleware: EventMiddleware = (event, next) => {
		try {
			next();
		} catch (error) {
			console.error(`[ErrorHandling] Error processing event ${event.type}:`, error);

			this.errorHandler(event, error as Error);
		}
	};
}

// Event validation middleware
export class EventValidationMiddleware {
	private validators: Map<string, (event: DomainEvent) => boolean> = new Map();

	addValidator(eventType: string, validator: (event: DomainEvent) => boolean): void {
		this.validators.set(eventType, validator);
	}

	removeValidator(eventType: string): void {
		this.validators.delete(eventType);
	}

	middleware: EventMiddleware = (event, next) => {
		const validator = this.validators.get(event.type);
		if (validator) {
			try {
				if (!validator(event)) {
					console.warn(`[EventValidation] Event ${event.type} failed validation`);
					return; // Skip invalid event
				}
			} catch (error) {
				console.error(`[EventValidation] Error validating event ${event.type}:`, error);
				return; // Skip event on validation error
			}
		}

		next();
	};
}

// Predefined middleware collections
export const defaultMiddleware = [loggingMiddleware, new ErrorHandlingMiddleware().middleware];

export const productionMiddleware = [
	loggingMiddleware,
	new MetricsMiddleware().middleware,
	new EventValidationMiddleware().middleware,
	new ErrorHandlingMiddleware().middleware,
];

export const developmentMiddleware = [
	loggingMiddleware,
	new MetricsMiddleware().middleware,
	new EventTransformMiddleware().middleware,
	new ErrorHandlingMiddleware().middleware,
];
