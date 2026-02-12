// FILE_CONTEXT: "context-4d28ecbe-e543-479b-9908-c828fcb45cd0"

import type { User } from "@isomorphiq/auth/types";
import type { Task } from "@isomorphiq/tasks/types";
import { useAtom, useSetAtom } from "jotai";
import { useEffect, useMemo, useState } from "react";
import {
    filteredTasksAtom,
    lastEventAtom,
    queueAtom,
    queueLoadableAtom,
    refreshAtom,
    tasksAtom,
    tasksLoadableAtom,
} from "../atoms.ts";
import { authAtom } from "../authAtoms.ts";
import { type OfflineTask, offlineStorage, useOfflineSync } from "./useOfflineSync.ts";

const LOG_PREFIX = "[dashboardTasks]";

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

const toErrorMessage = (fallback: string, error: unknown) =>
    error instanceof Error && error.message ? error.message : fallback;

export function useDashboardTasks() {
    const [auth, setAuth] = useAtom(authAtom);
    const [filteredTasks] = useAtom(filteredTasksAtom);
    const [queue] = useAtom(queueAtom);
    const [allTasks] = useAtom(tasksAtom);
    const [tasksLoadable] = useAtom(tasksLoadableAtom);
    const [queueLoadable] = useAtom(queueLoadableAtom);
    const bumpRefresh = useSetAtom(refreshAtom);
    const [_lastEvent, _setLastEvent] = useAtom(lastEventAtom);
    const [offlineTasks, setOfflineTasks] = useState<OfflineTask[]>([]);

    const { isOnline, syncInProgress, updateOfflineTask, deleteOfflineTask, getOfflineTasks } =
        useOfflineSync();

    useEffect(() => {
        const initOffline = async () => {
            try {
                await offlineStorage.init();
                const tasks = await getOfflineTasks();
                setOfflineTasks(tasks);
            } catch (error) {
                console.error("Failed to initialize offline storage:", error);
            }
        };
        void initOffline();
    }, [getOfflineTasks]);

    useEffect(() => {
        const interval = setInterval(() => bumpRefresh((c) => c + 1), 30000);
        return () => {
            clearInterval(interval);
        };
    }, [bumpRefresh]);

    useEffect(() => {
        const hydrate = async () => {
            if (!auth.isAuthenticated || auth.user) return;
            try {
                const resp = await fetch("/api/auth/me", {
                    headers: {
                        Authorization: `Bearer ${auth.token}`,
                    },
                });
                if (resp.ok) {
                    const data = await resp.json();
                    const user = data.user;
                    localStorage.setItem("user", JSON.stringify(user));
                    setAuth((prev) => ({ ...prev, user }));
                } else if (resp.status === 401) {
                    localStorage.removeItem("authToken");
                    localStorage.removeItem("user");
                    setAuth({
                        user: null,
                        token: null,
                        isAuthenticated: false,
                        isLoading: false,
                    });
                }
            } catch {
                // ignore; user can still browse public pages
            }
        };
        void hydrate();
    }, [auth.isAuthenticated, auth.token, auth.user, setAuth]);

    const mergedTasks = isOnline ? allTasks : [...allTasks, ...offlineTasks];
    const mergedFilteredTasks = isOnline ? filteredTasks : [...filteredTasks, ...offlineTasks];
    const mergedQueue = isOnline
        ? queue
        : [...queue, ...offlineTasks.filter((task) => task.status === "todo")];
    const isTasksLoading = tasksLoadable.state === "loading" && mergedTasks.length === 0;
    const isQueueLoading =
        queueLoadable.state === "loading" && mergedQueue.length === 0 && mergedTasks.length === 0;
    const isInitialLoading = isTasksLoading || isQueueLoading;

    const totals: DashboardTotals = useMemo(
        () => ({
            total: mergedTasks.length,
            todo: mergedTasks.filter((task) => task.status === "todo").length,
            inProgress: mergedTasks.filter((task) => task.status === "in-progress").length,
            done: mergedTasks.filter((task) => task.status === "done").length,
            nextUp: mergedQueue[0],
        }),
        [mergedQueue, mergedTasks],
    );

    const refresh = () => bumpRefresh((count) => count + 1);

    const handleStatusChange = async (taskId: string, newStatus: Task["status"]) => {
        if (!auth.isAuthenticated) {
            throw new Error("Please login to change task status.");
        }

        const offlineTask = offlineTasks.find((task) => task.id === taskId);

        if (offlineTask || !isOnline) {
            try {
                await updateOfflineTask(taskId, { status: newStatus });
                const tasks = await getOfflineTasks();
                setOfflineTasks(tasks);
                console.debug(LOG_PREFIX, "updated status offline", { taskId, newStatus, isOnline });
                refresh();
            } catch (error) {
                console.error("Failed to update offline task status:", error);
                throw new Error(toErrorMessage("Failed to update task status.", error));
            }
            return;
        }

        try {
            const response = await fetch(`/api/tasks/${taskId}/status`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${auth.token}`,
                },
                body: JSON.stringify({ status: newStatus }),
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                const errorMessage =
                    typeof (errorData as { error?: string }).error === "string"
                        ? (errorData as { error?: string }).error
                        : "Failed to update status";
                throw new Error(errorMessage);
            }

            console.debug(LOG_PREFIX, "updated status online", { taskId, newStatus });
            refresh();
        } catch (error) {
            console.error("Failed to update task status:", error);
            throw new Error(toErrorMessage("Failed to update task status.", error));
        }
    };

    const handlePriorityChange = async (taskId: string, newPriority: Task["priority"]) => {
        if (!auth.isAuthenticated) {
            throw new Error("Please login to change task priority.");
        }

        const offlineTask = offlineTasks.find((task) => task.id === taskId);

        if (offlineTask || !isOnline) {
            try {
                await updateOfflineTask(taskId, { priority: newPriority });
                const tasks = await getOfflineTasks();
                setOfflineTasks(tasks);
                console.debug(LOG_PREFIX, "updated priority offline", { taskId, newPriority, isOnline });
                refresh();
            } catch (error) {
                console.error("Failed to update offline task priority:", error);
                throw new Error(toErrorMessage("Failed to update task priority.", error));
            }
            return;
        }

        try {
            const response = await fetch(`/api/tasks/${taskId}/priority`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${auth.token}`,
                },
                body: JSON.stringify({ priority: newPriority }),
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                const errorMessage =
                    typeof (errorData as { error?: string }).error === "string"
                        ? (errorData as { error?: string }).error
                        : "Failed to update priority";
                throw new Error(errorMessage);
            }

            console.debug(LOG_PREFIX, "updated priority online", { taskId, newPriority });
            refresh();
        } catch (error) {
            console.error("Failed to update task priority:", error);
            throw new Error(toErrorMessage("Failed to update task priority.", error));
        }
    };

    const handleDelete = async (taskId: string) => {
        if (!auth.isAuthenticated) {
            throw new Error("Please login to delete tasks.");
        }

        const offlineTask = offlineTasks.find((task) => task.id === taskId);

        if (offlineTask || !isOnline) {
            try {
                await deleteOfflineTask(taskId);
                const tasks = await getOfflineTasks();
                setOfflineTasks(tasks);
                console.debug(LOG_PREFIX, "deleted offline task", { taskId, isOnline });
                refresh();
            } catch (error) {
                console.error("Failed to delete offline task:", error);
                throw new Error(toErrorMessage("Failed to delete task.", error));
            }
            return;
        }

        try {
            const response = await fetch(`/api/tasks/${taskId}`, {
                method: "DELETE",
                headers: {
                    Authorization: `Bearer ${auth.token}`,
                },
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                const errorMessage =
                    typeof (errorData as { error?: string }).error === "string"
                        ? (errorData as { error?: string }).error
                        : "Failed to delete task";
                throw new Error(errorMessage);
            }

            console.debug(LOG_PREFIX, "deleted task online", { taskId });
            refresh();
        } catch (error) {
            console.error("Failed to delete task:", error);
            throw new Error(toErrorMessage("Failed to delete task.", error));
        }
    };

    return {
        auth,
        allTasks,
        mergedTasks,
        mergedFilteredTasks,
        mergedQueue,
        totals,
        totalTaskCount: mergedTasks.length,
        isInitialLoading,
        isOnline,
        syncInProgress,
        handleStatusChange,
        handlePriorityChange,
        handleDelete,
        refresh,
    };
}
