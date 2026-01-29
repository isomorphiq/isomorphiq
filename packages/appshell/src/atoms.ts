import type { WebSocketEvent } from "@isomorphiq/realtime/types";
import type { Task, TaskFilters, TaskSort } from "@isomorphiq/tasks/types";
import { atom, type Atom } from "jotai";
import { trpc } from "./trpc";
export * from "./atoms/themeAtoms";

// Base atoms powered by tRPC (auto fetch)
const baseTasksAtom = (trpc.tasks as {
	atomWithQuery: (getInput: () => undefined) => Atom<Promise<Task[] | undefined>>;
}).atomWithQuery(() => undefined);
const baseQueueAtom = (trpc.queue as {
	atomWithQuery: (getInput: () => undefined) => Atom<Promise<Task[] | undefined>>;
}).atomWithQuery(() => undefined);

// Refresh counter to trigger refetch on events
export const refreshAtom = atom(0);

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

export const lastEventAtom = atom<WebSocketEvent | null>(null);
