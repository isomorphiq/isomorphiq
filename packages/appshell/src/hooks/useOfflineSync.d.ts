// FILE_CONTEXT: "context-5e18cc7a-dd8f-46e6-93cf-ba72290776d8"

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
declare class OfflineStorage {
    private db;
    private initPromise;
    private readonly DB_NAME;
    private readonly VERSION;
    private openDb;
    private ensureDb;
    init(): Promise<boolean>;
    saveTask(task: OfflineTask): Promise<void>;
    getTasks(): Promise<OfflineTask[]>;
    getTask(id: string): Promise<OfflineTask | null>;
    deleteTask(id: string): Promise<void>;
    addToSyncQueue(item: OfflineQueueItem): Promise<string>;
    getSyncQueue(): Promise<OfflineQueueItem[]>;
    removeFromSyncQueue(id: string): Promise<void>;
    clearSyncQueue(): Promise<void>;
}
export declare const offlineStorage: OfflineStorage;
export declare function useOfflineSync(): {
    isOnline: boolean;
    syncInProgress: boolean;
    syncError: string | null;
    syncRetryDelayMs: number;
    lastSyncTime: string | null;
    syncOfflineChanges: () => Promise<void>;
    retrySyncNow: () => Promise<void>;
    createOfflineTask: (taskData: Omit<OfflineTask, "id" | "createdAt" | "updatedAt">) => Promise<OfflineTask>;
    updateOfflineTask: (taskId: string, updates: Partial<OfflineTask>) => Promise<void>;
    deleteOfflineTask: (taskId: string) => Promise<void>;
    getOfflineTasks: () => Promise<OfflineTask[]>;
    getSyncQueueSize: () => Promise<number>;
};
export {};
