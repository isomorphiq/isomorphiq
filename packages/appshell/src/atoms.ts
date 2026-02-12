// FILE_CONTEXT: "context-986a9174-588d-4846-b3e4-df4552330d12"

import type { WebSocketEvent } from "@isomorphiq/realtime/types";
import type { Task, TaskFilters, TaskSort } from "@isomorphiq/tasks/types";
import { atom, type Atom } from "jotai";
import { loadable } from "jotai/utils";
export * from "./atoms/themeAtoms.ts";

const readAccessToken = (): string | null => {
    if (typeof window === "undefined") {
        return null;
    }
    const localStorageToken =
        window.localStorage.getItem("authToken")
        ?? window.localStorage.getItem("token");
    const sessionStorageToken =
        window.sessionStorage.getItem("authToken")
        ?? window.sessionStorage.getItem("token");
    return localStorageToken ?? sessionStorageToken;
};

const buildApiHeaders = (): Record<string, string> => {
    const token = readAccessToken();
    if (!token) {
        return {
            "Content-Type": "application/json",
        };
    }
    return {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
    };
};

const normalizeTaskListResponse = (payload: unknown): Task[] => {
    if (Array.isArray(payload)) {
        return payload as Task[];
    }
    if (payload && typeof payload === "object") {
        const record = payload as Record<string, unknown>;
        if (Array.isArray(record.tasks)) {
            return record.tasks as Task[];
        }
        if (Array.isArray(record.queue)) {
            return record.queue as Task[];
        }
    }
    return [];
};

const fetchTasks = async (): Promise<Task[]> => {
    try {
        const response = await fetch("/api/tasks", {
            headers: buildApiHeaders(),
            cache: "no-store",
        });
        if (!response.ok) {
            console.error(`[appshell] Failed to fetch tasks (status=${response.status})`);
            return [];
        }
        const payload = (await response.json()) as unknown;
        return normalizeTaskListResponse(payload);
    } catch (error) {
        console.error("[appshell] Tasks request failed:", error);
        return [];
    }
};

const fetchQueue = async (): Promise<Task[]> => {
    try {
        const response = await fetch("/api/queue", {
            headers: buildApiHeaders(),
            cache: "no-store",
        });
        if (!response.ok) {
            console.error(`[appshell] Failed to fetch queue (status=${response.status})`);
            return [];
        }
        const payload = (await response.json()) as unknown;
        return normalizeTaskListResponse(payload);
    } catch (error) {
        console.error("[appshell] Queue request failed:", error);
        return [];
    }
};

const baseTasksAtom: Atom<Promise<Task[]>> = atom(async () => fetchTasks());
const baseQueueAtom: Atom<Promise<Task[]>> = atom(async () => fetchQueue());

// Refresh counter to trigger refetch on events
export const refreshAtom = atom(0);
const baseTasksLoadableAtom = loadable(baseTasksAtom);
const baseQueueLoadableAtom = loadable(baseQueueAtom);

// Search and filter state
export const searchQueryAtom = atom<string>("");
export const taskFiltersAtom = atom<TaskFilters>({});
export const taskSortAtom = atom<TaskSort>({ field: "createdAt", direction: "desc" });

// Filtered tasks atom - applies client-side filtering and sorting
export const filteredTasksAtom = atom(async (get) => {
	get(refreshAtom);
	const allTasks = (await get(baseTasksAtom)) ?? [];
	const searchQuery = get(searchQueryAtom);
	const filters = get(taskFiltersAtom);
	const sort = get(taskSortAtom);

	let filtered = [...allTasks];

	// Apply text search
	if (searchQuery.trim()) {
		const query = searchQuery.toLowerCase();
		filtered = filtered.filter(
			(task) =>
				task.title.toLowerCase().includes(query) || task.description.toLowerCase().includes(query),
		);
	}

	// Apply status filter
	if (filters.status && filters.status.length > 0) {
		filtered = filtered.filter((task) => filters.status?.includes(task.status));
	}

	// Apply priority filter
	if (filters.priority && filters.priority.length > 0) {
		filtered = filtered.filter((task) => filters.priority?.includes(task.priority));
	}

	// Apply date range filter
	if (filters.dateFrom) {
		const fromDate = new Date(filters.dateFrom);
		filtered = filtered.filter((task) => new Date(task.createdAt) >= fromDate);
	}

	if (filters.dateTo) {
		const toDate = new Date(filters.dateTo);
		filtered = filtered.filter((task) => new Date(task.createdAt) <= toDate);
	}

	// Apply sorting
	filtered.sort((a, b) => {
		let aValue: string | number;
		let bValue: string | number;

		switch (sort.field) {
			case "title":
				aValue = a.title.toLowerCase();
				bValue = b.title.toLowerCase();
				break;
			case "priority": {
				const priorityOrder = { high: 0, medium: 1, low: 2 };
				aValue = priorityOrder[a.priority];
				bValue = priorityOrder[b.priority];
				break;
			}
			case "status": {
				const statusOrder = { todo: 0, "in-progress": 1, done: 2 };
				aValue = statusOrder[a.status];
				bValue = statusOrder[b.status];
				break;
			}
			case "createdAt":
				aValue = new Date(a.createdAt).getTime();
				bValue = new Date(b.createdAt).getTime();
				break;
			case "updatedAt":
				aValue = new Date(a.updatedAt).getTime();
				bValue = new Date(b.updatedAt).getTime();
				break;
			default:
				return 0;
		}

		if (aValue < bValue) return sort.direction === "asc" ? -1 : 1;
		if (aValue > bValue) return sort.direction === "asc" ? 1 : -1;
		return 0;
	});

	return filtered;
});

export const tasksAtom = atom((get) => {
	get(refreshAtom);
	return get(baseTasksAtom) ?? [];
});

export const queueAtom = atom((get) => {
	get(refreshAtom);
	return get(baseQueueAtom) ?? [];
});

export const tasksLoadableAtom = atom((get) => {
	get(refreshAtom);
	return get(baseTasksLoadableAtom);
});

export const queueLoadableAtom = atom((get) => {
	get(refreshAtom);
	return get(baseQueueLoadableAtom);
});

export const lastEventAtom = atom<WebSocketEvent | null>(null);
