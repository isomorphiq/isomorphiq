import { useCallback, useEffect, useState } from "react";

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

				// Tasks store
				if (!db.objectStoreNames.contains("tasks")) {
					const taskStore = db.createObjectStore("tasks", { keyPath: "id" });
					taskStore.createIndex("status", "status", { unique: false });
					taskStore.createIndex("priority", "priority", { unique: false });
					taskStore.createIndex("createdAt", "createdAt", { unique: false });
				}

				// Sync queue store
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
			console.error("OfflineStorage: failed to open IndexedDB", error);
			return null;
		}
	}

	async init(): Promise<boolean> {
		const db = await this.ensureDb();
		return Boolean(db);
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
	const [storageReady, setStorageReady] = useState(false);
	const [lastSyncTime, setLastSyncTime] = useState<string | null>(
		localStorage.getItem("lastSyncTime"),
	);
	const canUseIndexedDB = typeof window !== "undefined" && "indexedDB" in window;

	useEffect(() => {
		const handleOnline = () => setIsOnline(true);
		const handleOffline = () => setIsOnline(false);

		window.addEventListener("online", handleOnline);
		window.addEventListener("offline", handleOffline);

		return () => {
			window.removeEventListener("online", handleOnline);
			window.removeEventListener("offline", handleOffline);
		};
	}, []);

	// Ensure the offline database is opened once on mount
	useEffect(() => {
		if (!canUseIndexedDB) return;
		let cancelled = false;
		offlineStorage
			.init()
			.then((ready) => {
				if (!cancelled) setStorageReady(ready);
			})
			.catch((error) => {
				console.error("Failed to initialize offline storage:", error);
				if (!cancelled) setStorageReady(false);
			});
		return () => {
			cancelled = true;
		};
	}, [canUseIndexedDB]);

	const processSyncItem = useCallback(async (item: OfflineQueueItem): Promise<void> => {
		const authToken = localStorage.getItem("authToken");
		if (!authToken) throw new Error("No auth token");

		const headers = {
			"Content-Type": "application/json",
			Authorization: `Bearer ${authToken}`,
		};

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
		if (!isOnline || !canUseIndexedDB || !storageReady) return;

		setSyncInProgress(true);
		try {
			await offlineStorage.init();
			const queue = await offlineStorage.getSyncQueue();

			for (const item of queue) {
				try {
					await processSyncItem(item);
					await offlineStorage.removeFromSyncQueue(item.id);
				} catch (_error) {
					console.error("Failed to sync item:", item, _error);
					// Update retry count
					const updatedItem = { ...item, retryCount: (item.retryCount || 0) + 1 };
					await offlineStorage.addToSyncQueue(updatedItem);
					await offlineStorage.removeFromSyncQueue(item.id);
				}
			}

			const now = new Date().toISOString();
			setLastSyncTime(now);
			localStorage.setItem("lastSyncTime", now);
		} finally {
			setSyncInProgress(false);
		}
	}, [isOnline, canUseIndexedDB, storageReady, processSyncItem]);

	useEffect(() => {
		if (isOnline && !syncInProgress) {
			syncOfflineChanges();
		}
	}, [isOnline, syncInProgress, syncOfflineChanges]);

	const createOfflineTask = async (
		taskData: Omit<OfflineTask, "id" | "createdAt" | "updatedAt">,
	): Promise<OfflineTask> => {
		if (!canUseIndexedDB) {
			throw new Error("Offline storage is unavailable in this environment");
		}
		await offlineStorage.init();

		const now = new Date().toISOString();
		const task: OfflineTask = {
			...taskData,
			id: `offline-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
			createdAt: now,
			updatedAt: now,
			isOffline: true,
		};

		await offlineStorage.saveTask(task);

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
			} catch (_error) {
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
		await offlineStorage.init();

		const existingTask = await offlineStorage.getTask(taskId);
		if (!existingTask) throw new Error("Task not found");

		const updatedTask = {
			...existingTask,
			...updates,
			updatedAt: new Date().toISOString(),
		};

		await offlineStorage.saveTask(updatedTask);

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
			} catch (_error) {
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
		}
	};

	const deleteOfflineTask = async (taskId: string): Promise<void> => {
		if (!canUseIndexedDB) {
			throw new Error("Offline storage is unavailable in this environment");
		}
		await offlineStorage.init();

		await offlineStorage.deleteTask(taskId);

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
			} catch (_error) {
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
		}
	};

	return {
		isOnline,
		syncInProgress,
		lastSyncTime,
		syncOfflineChanges,
		createOfflineTask,
		updateOfflineTask,
		deleteOfflineTask,
		getOfflineTasks: () => (canUseIndexedDB ? offlineStorage.getTasks() : Promise.resolve([])),
		getSyncQueueSize: async () => {
			if (!canUseIndexedDB) return 0;
			await offlineStorage.init();
			const queue = await offlineStorage.getSyncQueue();
			return queue.length;
		},
	};
}
