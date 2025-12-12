import type { DomainEvent, EventStore } from "./events.ts";

// In-memory event store implementation
export class InMemoryEventStore implements EventStore {
	private events: DomainEvent[] = [];
	private maxEvents: number;

	constructor(maxEvents: number = 10000) {
		this.maxEvents = maxEvents;
	}

	async append(event: DomainEvent): Promise<void> {
		this.events.push(event);

		// Keep only the most recent events
		if (this.events.length > this.maxEvents) {
			this.events = this.events.slice(-this.maxEvents);
		}
	}

	async getEvents(aggregateId?: string, fromVersion?: number): Promise<DomainEvent[]> {
		let filteredEvents = this.events;

		if (aggregateId) {
			// Filter by aggregate ID (could be task ID, user ID, etc.)
			filteredEvents = filteredEvents.filter(
				(event) =>
					event.data.taskId === aggregateId ||
					event.data.userId === aggregateId ||
					event.id === aggregateId,
			);
		}

		if (fromVersion !== undefined) {
			filteredEvents = filteredEvents.slice(fromVersion);
		}

		return filteredEvents;
	}

	async getEventsByType(eventType: string, limit?: number): Promise<DomainEvent[]> {
		let filteredEvents = this.events.filter((event) => event.type === eventType);

		if (limit) {
			filteredEvents = filteredEvents.slice(-limit);
		}

		return filteredEvents;
	}

	clear(): void {
		this.events = [];
	}

	getStats(): {
		totalEvents: number;
		eventTypes: Record<string, number>;
		oldestEvent?: Date;
		newestEvent?: Date;
	} {
		const eventTypes: Record<string, number> = {};
		let oldestEvent: Date | undefined;
		let newestEvent: Date | undefined;

		for (const event of this.events) {
			eventTypes[event.type] = (eventTypes[event.type] || 0) + 1;

			if (!oldestEvent || event.timestamp < oldestEvent) {
				oldestEvent = event.timestamp;
			}

			if (!newestEvent || event.timestamp > newestEvent) {
				newestEvent = event.timestamp;
			}
		}

		const result: {
			totalEvents: number;
			eventTypes: Record<string, number>;
			oldestEvent?: Date;
			newestEvent?: Date;
		} = {
			totalEvents: this.events.length,
			eventTypes,
		};

		if (oldestEvent) result.oldestEvent = oldestEvent;
		if (newestEvent) result.newestEvent = newestEvent;

		return result;
	}
}

// LevelDB-based event store implementation
export class LevelDBEventStore implements EventStore {
	private db: Map<string, unknown>;
	private namespace: string;

	constructor(_dbPath: string = "./events", namespace: string = "events") {
		this.namespace = namespace;
		// Note: This would need proper LevelDB initialization
		// For now, we'll use a simple in-memory fallback
		this.db = new Map<string, unknown>();
	}

	async append(event: DomainEvent): Promise<void> {
		const key = `${this.namespace}:${event.id}`;
		const value = JSON.stringify(event);

		// Store event by ID
		this.db.set(key, value);

		// Store event in type index
		const typeKey = `${this.namespace}:type:${event.type}:${event.id}`;
		this.db.set(typeKey, value);

		// Store event in timestamp index
		const timestampKey = `${this.namespace}:timestamp:${event.timestamp.getTime()}:${event.id}`;
		this.db.set(timestampKey, value);
	}

	async getEvents(aggregateId?: string, fromVersion?: number): Promise<DomainEvent[]> {
		const events: DomainEvent[] = [];

		// Get all events and filter
		for (const [key, value] of this.db) {
			if (
				key.startsWith(`${this.namespace}:`) &&
				!key.includes(":type:") &&
				!key.includes(":timestamp:")
			) {
				const event = JSON.parse(value as string) as DomainEvent;

				// Filter by aggregate ID if specified
				if (aggregateId) {
					const matchesAggregate =
						event.data.taskId === aggregateId ||
						event.data.userId === aggregateId ||
						event.id === aggregateId;

					if (!matchesAggregate) {
						continue;
					}
				}

				events.push(event);
			}
		}

		// Sort by timestamp
		events.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

		// Apply version offset if specified
		if (fromVersion !== undefined) {
			return events.slice(fromVersion);
		}

		return events;
	}

	async getEventsByType(eventType: string, limit?: number): Promise<DomainEvent[]> {
		const events: DomainEvent[] = [];

		// Get events by type index
		const typePrefix = `${this.namespace}:type:${eventType}:`;
		for (const [key, value] of this.db) {
			if (key.startsWith(typePrefix)) {
				const event = JSON.parse(value as string) as DomainEvent;
				events.push(event);
			}
		}

		// Sort by timestamp
		events.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

		// Apply limit if specified
		if (limit) {
			return events.slice(-limit);
		}

		return events;
	}

	async clear(): Promise<void> {
		const keysToDelete: string[] = [];

		for (const key of this.db.keys()) {
			if (key.startsWith(`${this.namespace}:`)) {
				keysToDelete.push(key);
			}
		}

		for (const key of keysToDelete) {
			this.db.delete(key);
		}
	}
}

// Event replay service
export class EventReplayService {
	private eventStore: EventStore;
	private eventHandlers: Map<string, ((event: DomainEvent) => void)[]> = new Map();

	constructor(eventStore: EventStore) {
		this.eventStore = eventStore;
	}

	// Register event handler for replay
	registerHandler(eventType: string, handler: (event: DomainEvent) => void): void {
		if (!this.eventHandlers.has(eventType)) {
			this.eventHandlers.set(eventType, []);
		}
		this.eventHandlers.get(eventType)?.push(handler);
	}

	// Unregister event handler
	unregisterHandler(eventType: string, handler: (event: DomainEvent) => void): void {
		const handlers = this.eventHandlers.get(eventType);
		if (handlers) {
			const index = handlers.indexOf(handler);
			if (index > -1) {
				handlers.splice(index, 1);
			}
		}
	}

	// Replay events from a specific point in time
	async replayEvents(fromDate?: Date, toDate?: Date): Promise<void> {
		const events = await this.eventStore.getEvents();

		// Filter by date range
		let filteredEvents = events;
		if (fromDate) {
			filteredEvents = filteredEvents.filter((event) => event.timestamp >= fromDate);
		}
		if (toDate) {
			filteredEvents = filteredEvents.filter((event) => event.timestamp <= toDate);
		}

		// Replay events in order
		for (const event of filteredEvents) {
			const handlers = this.eventHandlers.get(event.type);
			if (handlers) {
				for (const handler of handlers) {
					try {
						handler(event);
					} catch (error) {
						console.error(`[EventReplay] Error replaying event ${event.type}:`, error);
					}
				}
			}
		}
	}

	// Replay events for a specific aggregate
	async replayAggregateEvents(aggregateId: string): Promise<void> {
		const events = await this.eventStore.getEvents(aggregateId);

		for (const event of events) {
			const handlers = this.eventHandlers.get(event.type);
			if (handlers) {
				for (const handler of handlers) {
					try {
						handler(event);
					} catch (error) {
						console.error(
							`[EventReplay] Error replaying event ${event.type} for aggregate ${aggregateId}:`,
							error,
						);
					}
				}
			}
		}
	}

	// Replay events of a specific type
	async replayEventsByType(eventType: string, limit?: number): Promise<void> {
		const events = await this.eventStore.getEventsByType(eventType, limit);

		for (const event of events) {
			const handlers = this.eventHandlers.get(event.type);
			if (handlers) {
				for (const handler of handlers) {
					try {
						handler(event);
					} catch (error) {
						console.error(`[EventReplay] Error replaying event ${event.type}:`, error);
					}
				}
			}
		}
	}

	// Get replay statistics
	getReplayStats(): {
		registeredEventTypes: string[];
		totalHandlers: number;
	} {
		const registeredEventTypes = Array.from(this.eventHandlers.keys());
		const totalHandlers = Array.from(this.eventHandlers.values()).reduce(
			(total, handlers) => total + handlers.length,
			0,
		);

		return {
			registeredEventTypes,
			totalHandlers,
		};
	}
}

// Event snapshot service for performance optimization
export class EventSnapshotService {
	private eventStore: EventStore;
	private snapshots: Map<
		string,
		{ state: Record<string, unknown>; timestamp: Date; version: number }
	> = new Map();
	private snapshotInterval: number;

	constructor(eventStore: EventStore, snapshotInterval: number = 100) {
		this.eventStore = eventStore;
		this.snapshotInterval = snapshotInterval;
	}

	// Create snapshot of aggregate state
	async createSnapshot(
		aggregateId: string,
		state: Record<string, unknown>,
		version: number,
	): Promise<void> {
		this.snapshots.set(aggregateId, {
			state,
			timestamp: new Date(),
			version,
		});
	}

	// Get latest snapshot for aggregate
	getSnapshot(
		aggregateId: string,
	): { state: Record<string, unknown>; timestamp: Date; version: number } | null {
		return this.snapshots.get(aggregateId) || null;
	}

	// Get events since last snapshot
	async getEventsSinceSnapshot(aggregateId: string): Promise<DomainEvent[]> {
		const snapshot = this.getSnapshot(aggregateId);
		if (!snapshot) {
			// No snapshot, return all events
			return await this.eventStore.getEvents(aggregateId);
		}

		// Get events since snapshot version
		return await this.eventStore.getEvents(aggregateId, snapshot.version);
	}

	// Check if snapshot should be created
	shouldCreateSnapshot(aggregateId: string, currentVersion: number): boolean {
		const snapshot = this.getSnapshot(aggregateId);
		if (!snapshot) {
			return currentVersion >= this.snapshotInterval;
		}

		return currentVersion - snapshot.version >= this.snapshotInterval;
	}

	// Clean up old snapshots
	cleanupSnapshots(maxAge: number = 7 * 24 * 60 * 60 * 1000): void {
		// 7 days
		const cutoffTime = new Date(Date.now() - maxAge);

		for (const [aggregateId, snapshot] of this.snapshots) {
			if (snapshot.timestamp < cutoffTime) {
				this.snapshots.delete(aggregateId);
			}
		}
	}

	// Get snapshot statistics
	getSnapshotStats(): {
		totalSnapshots: number;
		aggregateIds: string[];
		oldestSnapshot?: Date;
		newestSnapshot?: Date;
	} {
		const aggregateIds = Array.from(this.snapshots.keys());
		let oldestSnapshot: Date | undefined;
		let newestSnapshot: Date | undefined;

		for (const snapshot of this.snapshots.values()) {
			if (!oldestSnapshot || snapshot.timestamp < oldestSnapshot) {
				oldestSnapshot = snapshot.timestamp;
			}

			if (!newestSnapshot || snapshot.timestamp > newestSnapshot) {
				newestSnapshot = snapshot.timestamp;
			}
		}

		const result: {
			totalSnapshots: number;
			aggregateIds: string[];
			oldestSnapshot?: Date;
			newestSnapshot?: Date;
		} = {
			totalSnapshots: this.snapshots.size,
			aggregateIds,
		};

		if (oldestSnapshot) result.oldestSnapshot = oldestSnapshot;
		if (newestSnapshot) result.newestSnapshot = newestSnapshot;

		return result;
	}
}
