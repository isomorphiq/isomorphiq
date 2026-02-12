import type { User } from "@isomorphiq/auth/types";
import type { Task } from "@isomorphiq/tasks/types";
import { type OfflineTask } from "./useOfflineSync.ts";
export type AuthState = {
    user: User | null;
    token: string | null;
    isAuthenticated: boolean;
    isLoading: boolean;
};
export type DashboardTotals = {
    total: number;
    todo: number;
    inProgress: number;
    done: number;
    nextUp?: Task;
};
export declare function useDashboardTasks(): {
    auth: {
        user: User | null;
        token: string | null;
        isAuthenticated: boolean;
        isLoading: boolean;
    };
    allTasks: any[] | import("zod").objectOutputType<{
        id: import("zod").ZodString;
        createdAt: import("zod").ZodDate;
        updatedAt: import("zod").ZodDate;
    } & {
        title: import("zod").ZodString;
        description: import("zod").ZodString;
        status: import("zod").ZodEnum<["todo", "in-progress", "done", "invalid"]>;
        priority: import("zod").ZodEnum<["low", "medium", "high"]>;
        type: import("zod").ZodEnum<["theme", "initiative", "feature", "story", "task", "implementation", "integration", "testing", "research"]>;
        branch: import("zod").ZodOptional<import("zod").ZodString>;
        dependencies: import("zod").ZodArray<import("zod").ZodString, "many">;
        createdBy: import("zod").ZodString;
        assignedTo: import("zod").ZodOptional<import("zod").ZodString>;
        collaborators: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodString, "many">>;
        watchers: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodString, "many">>;
        actionLog: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodObject<{
            id: import("zod").ZodString;
            summary: import("zod").ZodString;
            profile: import("zod").ZodString;
            durationMs: import("zod").ZodNumber;
            createdAt: import("zod").ZodDate;
            success: import("zod").ZodBoolean;
            transition: import("zod").ZodOptional<import("zod").ZodString>;
            prompt: import("zod").ZodOptional<import("zod").ZodString>;
            modelName: import("zod").ZodOptional<import("zod").ZodString>;
        }, "passthrough", import("zod").ZodTypeAny, import("zod").objectOutputType<{
            id: import("zod").ZodString;
            summary: import("zod").ZodString;
            profile: import("zod").ZodString;
            durationMs: import("zod").ZodNumber;
            createdAt: import("zod").ZodDate;
            success: import("zod").ZodBoolean;
            transition: import("zod").ZodOptional<import("zod").ZodString>;
            prompt: import("zod").ZodOptional<import("zod").ZodString>;
            modelName: import("zod").ZodOptional<import("zod").ZodString>;
        }, import("zod").ZodTypeAny, "passthrough">, import("zod").objectInputType<{
            id: import("zod").ZodString;
            summary: import("zod").ZodString;
            profile: import("zod").ZodString;
            durationMs: import("zod").ZodNumber;
            createdAt: import("zod").ZodDate;
            success: import("zod").ZodBoolean;
            transition: import("zod").ZodOptional<import("zod").ZodString>;
            prompt: import("zod").ZodOptional<import("zod").ZodString>;
            modelName: import("zod").ZodOptional<import("zod").ZodString>;
        }, import("zod").ZodTypeAny, "passthrough">>, "many">>;
    }, import("zod").ZodTypeAny, "passthrough">[];
    mergedTasks: any[];
    mergedFilteredTasks: (import("zod").objectOutputType<{
        id: import("zod").ZodString;
        createdAt: import("zod").ZodDate;
        updatedAt: import("zod").ZodDate;
    } & {
        title: import("zod").ZodString;
        description: import("zod").ZodString;
        status: import("zod").ZodEnum<["todo", "in-progress", "done", "invalid"]>;
        priority: import("zod").ZodEnum<["low", "medium", "high"]>;
        type: import("zod").ZodEnum<["theme", "initiative", "feature", "story", "task", "implementation", "integration", "testing", "research"]>;
        branch: import("zod").ZodOptional<import("zod").ZodString>;
        dependencies: import("zod").ZodArray<import("zod").ZodString, "many">;
        createdBy: import("zod").ZodString;
        assignedTo: import("zod").ZodOptional<import("zod").ZodString>;
        collaborators: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodString, "many">>;
        watchers: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodString, "many">>;
        actionLog: import("zod").ZodOptional<import("zod").ZodArray<import("zod").ZodObject<{
            id: import("zod").ZodString;
            summary: import("zod").ZodString;
            profile: import("zod").ZodString;
            durationMs: import("zod").ZodNumber;
            createdAt: import("zod").ZodDate;
            success: import("zod").ZodBoolean;
            transition: import("zod").ZodOptional<import("zod").ZodString>;
            prompt: import("zod").ZodOptional<import("zod").ZodString>;
            modelName: import("zod").ZodOptional<import("zod").ZodString>;
        }, "passthrough", import("zod").ZodTypeAny, import("zod").objectOutputType<{
            id: import("zod").ZodString;
            summary: import("zod").ZodString;
            profile: import("zod").ZodString;
            durationMs: import("zod").ZodNumber;
            createdAt: import("zod").ZodDate;
            success: import("zod").ZodBoolean;
            transition: import("zod").ZodOptional<import("zod").ZodString>;
            prompt: import("zod").ZodOptional<import("zod").ZodString>;
            modelName: import("zod").ZodOptional<import("zod").ZodString>;
        }, import("zod").ZodTypeAny, "passthrough">, import("zod").objectInputType<{
            id: import("zod").ZodString;
            summary: import("zod").ZodString;
            profile: import("zod").ZodString;
            durationMs: import("zod").ZodNumber;
            createdAt: import("zod").ZodDate;
            success: import("zod").ZodBoolean;
            transition: import("zod").ZodOptional<import("zod").ZodString>;
            prompt: import("zod").ZodOptional<import("zod").ZodString>;
            modelName: import("zod").ZodOptional<import("zod").ZodString>;
        }, import("zod").ZodTypeAny, "passthrough">>, "many">>;
    }, import("zod").ZodTypeAny, "passthrough"> | OfflineTask)[];
    mergedQueue: any[];
    totals: DashboardTotals;
    totalTaskCount: number;
    isInitialLoading: boolean;
    isOnline: boolean;
    syncInProgress: boolean;
    handleStatusChange: (taskId: string, newStatus: Task["status"]) => Promise<void>;
    handlePriorityChange: (taskId: string, newPriority: Task["priority"]) => Promise<void>;
    handleDelete: (taskId: string) => Promise<void>;
    refresh: () => void;
};
