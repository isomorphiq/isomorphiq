import { useCallback, useEffect, useRef, useState } from "react";

const LOG_PREFIX = "[offlineSync]";

const logDebug = (...args: unknown[]) => console.debug(LOG_PREFIX, ...args);
const logError = (...args: unknown[]) => console.error(LOG_PREFIX, ...args);

let storageReadyGlobal = false;
let storageInitPromise: Promise<boolean> | null = null;

export interface OfflineTask {
	id: string;
	title: string;
	description: string;
	priority: "low" | "medium" | "high";
	status: "todo" | "in-progress" | "done";
	type?: string;
	assignedTo?: string;
	collaborators?: string[];
	dependencies?: string[];
	createdAt: string;
	updatedAt: string;
	isOffline?: boolean;
	lastSyncAttempt?: string;
}

export interface OfflineQueueItem {
	id: string;
	type: "create" | "update" | "delete";
	taskId: string;
	data: Partial<OfflineTask>;
	timestamp: string;
	retryCount?: number;
}

/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
class OfflineStorage {
	private db: IDBDatabase | null = null;
	private initPromise: Promise<IDBDatabase> | null = null;
	private readonly DB_NAME = "TaskManagerOffline";
	private readonly VERSION = 1;

	private openDb(): Promise<IDBDatabase> {
		return new Promise((resolve, reject) => {
			const request = indexedDB.open(this.DB_NAME, this.VERSION);

			request.onerror = () => reject(request.error);
			request.onsuccess = () => {
				resolve(request.result);
			};

			request.onupgradeneeded = (event) => {
				const db = (event.target as IDBOpenDBRequest).result;

				if (!db.objectStoreNames.contains("tasks")) {
					const taskStore = db.createObjectStore("tasks", { keyPath: "id" });
					taskStore.createIndex("status", "status", { unique: false });
					taskStore.createIndex("priority", "priority", { unique: false });
					taskStore.createIndex("createdAt", "createdAt", { unique: false });
				}

				if (!db.objectStoreNames.contains("syncQueue")) {
					const queueStore = db.createObjectStore("syncQueue", { keyPath: "id" });
					queueStore.createIndex("timestamp", "timestamp", { unique: false });
					queueStore.createIndex("type", "type", { unique: false });
				}
			};
		});
	}

	private async ensureDb(): Promise<IDBDatabase | null> {
		if (this.db) return this.db;

		if (!this.initPromise) {
			this.initPromise = this.openDb();
		}

		try {
			this.db = await this.initPromise;
			return this.db;
		} catch (error) {
			this.initPromise = null;
			logError("failed to open IndexedDB", error);
			return null;
		}
	}

	async init(): Promise<boolean> {
		if (this.db) return true;
		if (this.initPromise) {
			await this.initPromise;
			return Boolean(this.db);
		}
		logDebug("init start");
		this.initPromise = this.ensureDb();
		const db = await this.initPromise;
		const ready = Boolean(db);
		logDebug("init completed", { ready });
		return ready;
	}

	async saveTask(task: OfflineTask): Promise<void> {
		const db = await this.ensureDb();
		if (!db) return;

		return new Promise((resolve, reject) => {
			const transaction = db.transaction(["tasks"], "readwrite");
			const store = transaction.objectStore("tasks");
			const request = store.put(task);

			request.onerror = () => reject(request.error);
			request.onsuccess = () => resolve();
		});
	}

	async getTasks(): Promise<OfflineTask[]> {
		const db = await this.ensureDb();
		if (!db) return [];

		return new Promise((resolve, reject) => {
			const transaction = db.transaction(["tasks"], "readonly");
			const store = transaction.objectStore("tasks");
			const request = store.getAll();

			request.onerror = () => reject(request.error);
			request.onsuccess = () => resolve(request.result);
		});
	}

	async getTask(id: string): Promise<OfflineTask | null> {
		const db = await this.ensureDb();
		if (!db) return null;

		return new Promise((resolve, reject) => {
			const transaction = db.transaction(["tasks"], "readonly");
			const store = transaction.objectStore("tasks");
			const request = store.get(id);

			request.onerror = () => reject(request.error);
			request.onsuccess = () => resolve(request.result || null);
		});
	}

	async deleteTask(id: string): Promise<void> {
		const db = await this.ensureDb();
		if (!db) return;

		return new Promise((resolve, reject) => {
			const transaction = db.transaction(["tasks"], "readwrite");
			const store = transaction.objectStore("tasks");
			const request = store.delete(id);

			request.onerror = () => reject(request.error);
			request.onsuccess = () => resolve();
		});
	}

	async addToSyncQueue(item: OfflineQueueItem): Promise<string> {
		const db = await this.ensureDb();
		if (!db) return item.id || `${item.type}-${item.taskId}-${Date.now()}`;

		const queueItem: OfflineQueueItem = {
			...item,
			id: item.id || `${item.type}-${item.taskId}-${Date.now()}`,
		};

		return new Promise((resolve, reject) => {
			const transaction = db.transaction(["syncQueue"], "readwrite");
			const store = transaction.objectStore("syncQueue");
			const request = store.add(queueItem);

			request.onerror = () => reject(request.error);
			request.onsuccess = () => resolve(queueItem.id);
		});
	}

	async getSyncQueue(): Promise<OfflineQueueItem[]> {
		const db = await this.ensureDb();
		if (!db) return [];

		return new Promise((resolve, reject) => {
			const transaction = db.transaction(["syncQueue"], "readonly");
			const store = transaction.objectStore("syncQueue");
			const request = store.getAll();

			request.onerror = () => reject(request.error);
			request.onsuccess = () => resolve(request.result);
		});
	}

	async removeFromSyncQueue(id: string): Promise<void> {
		const db = await this.ensureDb();
		if (!db) return;

		return new Promise((resolve, reject) => {
			const transaction = db.transaction(["syncQueue"], "readwrite");
			const store = transaction.objectStore("syncQueue");
			const request = store.delete(id);

			request.onerror = () => reject(request.error);
			request.onsuccess = () => resolve();
		});
	}

	async clearSyncQueue(): Promise<void> {
		const db = await this.ensureDb();
		if (!db) return;

		return new Promise((resolve, reject) => {
			const transaction = db.transaction(["syncQueue"], "readwrite");
			const store = transaction.objectStore("syncQueue");
			const request = store.clear();

			request.onerror = () => reject(request.error);
			request.onsuccess = () => resolve();
		});
	}
}

export const offlineStorage = new OfflineStorage();

export function useOfflineSync() {
	const [isOnline, setIsOnline] = useState(navigator.onLine);
	const [syncInProgress, setSyncInProgress] = useState(false);
	const syncInProgressRef = useRef(false);
	const [storageReady, setStorageReady] = useState(false);
	const [lastSyncTime, setLastSyncTime] = useState<string | null>(
		localStorage.getItem("lastSyncTime"),
	);
	const canUseIndexedDB = typeof window !== "undefined" && "indexedDB" in window;
	const initializedRef = useRef(false);

	useEffect(() => {
		const handleOnline = () => {
			logDebug("navigator online event");
			setIsOnline(true);
		};
		const handleOffline = () => {
			logDebug("navigator offline event");
			setIsOnline(false);
		};

		window.addEventListener("online", handleOnline);
		window.addEventListener("offline", handleOffline);

		return () => {
			window.removeEventListener("online", handleOnline);
			window.removeEventListener("offline", handleOffline);
		};
	}, []);

	const ensureStorageReady = useCallback(async (): Promise<boolean> => {
		if (!canUseIndexedDB) return false;
		if (initializedRef.current && storageReady) return true;
		if (storageReadyGlobal) {
			initializedRef.current = true;
			setStorageReady(true);
			return true;
		}
		if (!storageInitPromise) {
			storageInitPromise = offlineStorage.init().then((ready) => {
				storageReadyGlobal = ready;
				if (!ready) {
					storageInitPromise = null;
				}
				return ready;
			});
		}
		const ready = await storageInitPromise;
		if (ready) {
			initializedRef.current = true;
			setStorageReady(true);
		}
		return ready;
	}, [canUseIndexedDB, storageReady]);

	useEffect(() => {
		if (!canUseIndexedDB) {
			logDebug("IndexedDB unavailable; offline mode disabled");
			return;
		}
		let cancelled = false;
		ensureStorageReady()
			.then((ready) => {
				if (cancelled) return;
				setStorageReady(ready);
			})
			.catch((error) => {
				logError("failed to initialize offline storage", error);
				if (!cancelled) setStorageReady(false);
			});
		return () => {
			cancelled = true;
		};
	}, [canUseIndexedDB, ensureStorageReady]);

	const processSyncItem = useCallback(async (item: OfflineQueueItem): Promise<void> => {
		const authToken = localStorage.getItem("authToken");
		if (!authToken) throw new Error("No auth token");

		const headers = {
			"Content-Type": "application/json",
			Authorization: `Bearer ${authToken}`,
		};

		logDebug("processing sync item", { id: item.id, type: item.type, taskId: item.taskId });

		switch (item.type) {
			case "create":
				await fetch("/api/tasks", {
					method: "POST",
					headers,
					body: JSON.stringify(item.data),
				});
				break;

			case "update":
				await fetch(`/api/tasks/${item.taskId}`, {
					method: "PUT",
					headers,
					body: JSON.stringify(item.data),
				});
				break;

			case "delete":
				await fetch(`/api/tasks/${item.taskId}`, {
					method: "DELETE",
					headers,
				});
				break;

			default:
				throw new Error(`Unknown sync item type: ${item.type}`);
		}
	}, []);

	const syncOfflineChanges = useCallback(async (): Promise<void> => {
		if (!isOnline || !canUseIndexedDB || !storageReady) {
			logDebug("skip sync", { isOnline, canUseIndexedDB, storageReady });
			return;
		}
		if (syncInProgressRef.current) {
			logDebug("skip sync; already in progress");
			return;
		}

		syncInProgressRef.current = true;
		setSyncInProgress(true);
		try {
			const ready = await ensureStorageReady();
			if (!ready) {
				logDebug("sync aborted; storage not ready");
				return;
			}
			const queue = await offlineStorage.getSyncQueue();
			logDebug("sync start", { queueSize: queue.length });

			for (const item of queue) {
				try {
					await processSyncItem(item);
					await offlineStorage.removeFromSyncQueue(item.id);
					logDebug("synced item", { id: item.id, type: item.type });
				} catch (_error) {
					logError("failed to sync item; will retry", { item, error: _error });
					const updatedItem = { ...item, retryCount: (item.retryCount || 0) + 1 };
					await offlineStorage.addToSyncQueue(updatedItem);
					await offlineStorage.removeFromSyncQueue(item.id);
				}
			}

			const now = new Date().toISOString();
			setLastSyncTime(now);
			localStorage.setItem("lastSyncTime", now);
			logDebug("sync complete", { lastSyncTime: now });
		} finally {
			syncInProgressRef.current = false;
			setSyncInProgress(false);
		}
	}, [ensureStorageReady, isOnline, canUseIndexedDB, storageReady, processSyncItem]);

	useEffect(() => {
		if (!isOnline) return;
		// Run immediately once coming online, then poll on interval
		void syncOfflineChanges();
		const interval = window.setInterval(syncOfflineChanges, 5000);
		return () => window.clearInterval(interval);
	}, [isOnline, syncOfflineChanges]);

	const createOfflineTask = async (
		taskData: Omit<OfflineTask, "id" | "createdAt" | "updatedAt">,
	): Promise<OfflineTask> => {
		if (!canUseIndexedDB) {
			throw new Error("Offline storage is unavailable in this environment");
		}
		const ready = await ensureStorageReady();
		if (!ready) throw new Error("Offline storage failed to initialize");

		const now = new Date().toISOString();
		const task: OfflineTask = {
			...taskData,
			id: `offline-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
			createdAt: now,
			updatedAt: now,
			isOffline: true,
		};

		await offlineStorage.saveTask(task);
		logDebug("created offline task", { id: task.id, isOnline });

		if (isOnline) {
			try {
				const syncItem: OfflineQueueItem = {
					id: `create-${task.id}-${now}`,
					type: "create",
					taskId: task.id,
					data: task,
					timestamp: now,
				};
				await processSyncItem(syncItem);
				task.isOffline = false;
				await offlineStorage.saveTask(task);
				logDebug("immediate sync of offline task succeeded", { id: task.id });
			} catch (_error) {
				logError("immediate sync of offline task failed; queued", { id: task.id, error: _error });
				await offlineStorage.addToSyncQueue({
					id: `create-${task.id}-${now}`,
					type: "create",
					taskId: task.id,
					data: task,
					timestamp: now,
				});
			}
		} else {
			await offlineStorage.addToSyncQueue({
				id: `create-${task.id}-${now}`,
				type: "create",
				taskId: task.id,
				data: task,
				timestamp: now,
			});
			logDebug("queued offline task for later sync", { id: task.id });
		}

		return task;
	};

	const updateOfflineTask = async (
		taskId: string,
		updates: Partial<OfflineTask>,
	): Promise<void> => {
		if (!canUseIndexedDB) {
			throw new Error("Offline storage is unavailable in this environment");
		}
		const ready = await ensureStorageReady();
		if (!ready) throw new Error("Offline storage failed to initialize");

		const existingTask = await offlineStorage.getTask(taskId);
		if (!existingTask) throw new Error("Task not found");

		const updatedTask = {
			...existingTask,
			...updates,
			updatedAt: new Date().toISOString(),
		};

		await offlineStorage.saveTask(updatedTask);
		logDebug("updated offline task", { taskId, isOnline, isOffline: existingTask.isOffline });

		if (isOnline && !existingTask.isOffline) {
			try {
				const syncItem: OfflineQueueItem = {
					id: `update-${taskId}-${updatedTask.updatedAt}`,
					type: "update",
					taskId,
					data: updates,
					timestamp: updatedTask.updatedAt,
				};
				await processSyncItem(syncItem);
				logDebug("immediate sync of update succeeded", { taskId });
			} catch (_error) {
				logError("immediate sync of update failed; queued", { taskId, error: _error });
				await offlineStorage.addToSyncQueue({
					id: `update-${taskId}-${updatedTask.updatedAt}`,
					type: "update",
					taskId,
					data: updates,
					timestamp: updatedTask.updatedAt,
				});
			}
		} else {
			await offlineStorage.addToSyncQueue({
				id: `update-${taskId}-${updatedTask.updatedAt}`,
				type: "update",
				taskId,
				data: updates,
				timestamp: updatedTask.updatedAt,
			});
			logDebug("queued update for later sync", { taskId });
		}
	};

	const deleteOfflineTask = async (taskId: string): Promise<void> => {
		if (!canUseIndexedDB) {
			throw new Error("Offline storage is unavailable in this environment");
		}
		const ready = await ensureStorageReady();
		if (!ready) throw new Error("Offline storage failed to initialize");

		await offlineStorage.deleteTask(taskId);
		logDebug("deleted offline task locally", { taskId, isOnline });

		const deleteTimestamp = new Date().toISOString();
		if (isOnline) {
			try {
				const syncItem: OfflineQueueItem = {
					id: `delete-${taskId}-${deleteTimestamp}`,
					type: "delete",
					taskId,
					data: {},
					timestamp: deleteTimestamp,
				};
				await processSyncItem(syncItem);
				logDebug("immediate delete sync succeeded", { taskId });
			} catch (_error) {
				logError("immediate delete sync failed; queued", { taskId, error: _error });
				await offlineStorage.addToSyncQueue({
					id: `delete-${taskId}-${deleteTimestamp}`,
					type: "delete",
					taskId,
					data: {},
					timestamp: deleteTimestamp,
				});
			}
		} else {
			await offlineStorage.addToSyncQueue({
				id: `delete-${taskId}-${deleteTimestamp}`,
				type: "delete",
				taskId,
				data: {},
				timestamp: deleteTimestamp,
			});
			logDebug("queued delete for later sync", { taskId });
		}
	};

	const getOfflineTasks = useCallback(async () => {
		if (!canUseIndexedDB) return [];
		const ready = await ensureStorageReady();
		if (!ready) return [];
		return offlineStorage.getTasks();
	}, [canUseIndexedDB, ensureStorageReady]);

	const getSyncQueueSize = useCallback(async () => {
		if (!canUseIndexedDB) return 0;
		const ready = await ensureStorageReady();
		if (!ready) return 0;
		const queue = await offlineStorage.getSyncQueue();
		logDebug("queue size requested", { size: queue.length });
		return queue.length;
	}, [canUseIndexedDB, ensureStorageReady]);

	return {
		isOnline,
		syncInProgress,
		lastSyncTime,
		syncOfflineChanges,
		createOfflineTask,
		updateOfflineTask,
		deleteOfflineTask,
		getOfflineTasks,
		getSyncQueueSize,
	};
}

