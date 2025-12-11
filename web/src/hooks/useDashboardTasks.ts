import { useAtom, useSetAtom } from "jotai";
import { useEffect, useMemo, useState } from "react";
import type { Task } from "../../src/types.ts";
import { filteredTasksAtom, lastEventAtom, queueAtom, refreshAtom, tasksAtom } from "../atoms.ts";
import { authAtom } from "../authAtoms.ts";
import { type OfflineTask, offlineStorage, useOfflineSync } from "./useOfflineSync.ts";

export type AuthState = {
	user: { id: string; username: string; email: string } | null;
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

export function useDashboardTasks() {
	const [auth, setAuth] = useAtom(authAtom);
	const [filteredTasks] = useAtom(filteredTasksAtom);
	const [queue] = useAtom(queueAtom);
	const [allTasks] = useAtom(tasksAtom);
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
			alert("Please login to change task status.");
			return;
		}

		const offlineTask = offlineTasks.find((task) => task.id === taskId);

		if (offlineTask || !isOnline) {
			try {
				await updateOfflineTask(taskId, { status: newStatus });
				const tasks = await getOfflineTasks();
				setOfflineTasks(tasks);
				refresh();
			} catch (error) {
				console.error("Failed to update offline task status:", error);
				alert(
					"Failed to update task status: " +
						(error instanceof Error ? error.message : "Unknown error"),
				);
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
				const errorData = await response.json();
				throw new Error(errorData.error || "Failed to update status");
			}

			refresh();
		} catch (error) {
			console.error("Failed to update task status:", error);
			alert(
				"Failed to update task status: " +
					(error instanceof Error ? error.message : "Unknown error"),
			);
		}
	};

	const handlePriorityChange = async (taskId: string, newPriority: Task["priority"]) => {
		if (!auth.isAuthenticated) {
			alert("Please login to change task priority.");
			return;
		}

		const offlineTask = offlineTasks.find((task) => task.id === taskId);

		if (offlineTask || !isOnline) {
			try {
				await updateOfflineTask(taskId, { priority: newPriority });
				const tasks = await getOfflineTasks();
				setOfflineTasks(tasks);
				refresh();
			} catch (error) {
				console.error("Failed to update offline task priority:", error);
				alert(
					"Failed to update task priority: " +
						(error instanceof Error ? error.message : "Unknown error"),
				);
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
				const errorData = await response.json();
				throw new Error(errorData.error || "Failed to update priority");
			}

			refresh();
		} catch (error) {
			console.error("Failed to update task priority:", error);
			alert(
				"Failed to update task priority: " +
					(error instanceof Error ? error.message : "Unknown error"),
			);
		}
	};

	const handleDelete = async (taskId: string) => {
		if (!auth.isAuthenticated) {
			alert("Please login to delete tasks.");
			return;
		}

		const offlineTask = offlineTasks.find((task) => task.id === taskId);

		if (offlineTask || !isOnline) {
			try {
				await deleteOfflineTask(taskId);
				const tasks = await getOfflineTasks();
				setOfflineTasks(tasks);
				refresh();
			} catch (error) {
				console.error("Failed to delete offline task:", error);
				alert(`Failed to delete task: ${error instanceof Error ? error.message : "Unknown error"}`);
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
				const errorData = await response.json();
				throw new Error(errorData.error || "Failed to delete task");
			}

			refresh();
		} catch (error) {
			console.error("Failed to delete task:", error);
			alert(`Failed to delete task: ${error instanceof Error ? error.message : "Unknown error"}`);
		}
	};

	return {
		auth,
		allTasks,
		mergedTasks,
		mergedFilteredTasks,
		mergedQueue,
		totals,
		isOnline,
		syncInProgress,
		handleStatusChange,
		handlePriorityChange,
		handleDelete,
		refresh,
	};
}
