import path from "node:path";
import { Level } from "level";
import type { Result } from "../core/result.ts";
import type { TimeEntry, TimeSearchOptions, Timesheet } from "../core/time-tracking.ts";

/**
 * Repository interface for Time Tracking data access
 */
export interface ITimeTrackingRepository {
	// Time Entry operations
	createTimeEntry(timeEntry: TimeEntry): Promise<Result<TimeEntry>>;
	getTimeEntry(id: string): Promise<Result<TimeEntry | null>>;
	getAllTimeEntries(): Promise<Result<TimeEntry[]>>;
	updateTimeEntry(id: string, timeEntry: TimeEntry): Promise<Result<TimeEntry>>;
	deleteTimeEntry(id: string): Promise<Result<void>>;

	// Time Entry queries
	findTimeEntriesByUser(userId: string): Promise<Result<TimeEntry[]>>;
	findTimeEntriesByTask(taskId: string): Promise<Result<TimeEntry[]>>;
	findTimeEntriesByDateRange(startDate: Date, endDate: Date): Promise<Result<TimeEntry[]>>;
	searchTimeEntries(
		options: TimeSearchOptions,
	): Promise<Result<{ entries: TimeEntry[]; total: number }>>;

	// Timesheet operations
	createTimesheet(timesheet: Timesheet): Promise<Result<Timesheet>>;
	getTimesheet(id: string): Promise<Result<Timesheet | null>>;
	getAllTimesheets(): Promise<Result<Timesheet[]>>;
	updateTimesheet(id: string, timesheet: Timesheet): Promise<Result<Timesheet>>;
	deleteTimesheet(id: string): Promise<Result<void>>;

	// Timesheet queries
	findTimesheetsByUser(userId: string): Promise<Result<Timesheet[]>>;
	findTimesheetsByStatus(status: string): Promise<Result<Timesheet[]>>;
	findTimesheetsByPeriod(
		userId: string,
		period: string,
		startDate: Date,
		endDate: Date,
	): Promise<Result<Timesheet[]>>;
}

/**
 * LevelDB implementation of TimeTrackingRepository
 */
export class LevelDbTimeTrackingRepository implements ITimeTrackingRepository {
	private timeDb: Level<string, TimeEntry>;
	private timesheetDb: Level<string, Timesheet>;
	private dbReady = false;

	constructor(dbPath?: string) {
		const defaultPath = path.join(process.cwd(), "db");
		this.timeDb = new Level(path.join(defaultPath || dbPath || "", "time-entries"), {
			valueEncoding: "json",
		});
		this.timesheetDb = new Level(path.join(defaultPath || dbPath || "", "timesheets"), {
			valueEncoding: "json",
		});
	}

	private async ensureDbOpen(): Promise<void> {
		if (!this.dbReady) {
			await Promise.all([this.timeDb.open(), this.timesheetDb.open()]);
			this.dbReady = true;
		}
	}

	// Time Entry operations

	async createTimeEntry(timeEntry: TimeEntry): Promise<Result<TimeEntry>> {
		try {
			await this.ensureDbOpen();
			await this.timeDb.put(timeEntry.id, timeEntry);
			return { success: true, data: timeEntry };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}

	async getTimeEntry(id: string): Promise<Result<TimeEntry | null>> {
		try {
			await this.ensureDbOpen();
			const timeEntry = await this.timeDb.get(id).catch(() => null);
			return { success: true, data: timeEntry };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}

	async getAllTimeEntries(): Promise<Result<TimeEntry[]>> {
		try {
			await this.ensureDbOpen();
			const entries: TimeEntry[] = [];
			const iterator = this.timeDb.iterator();

			for await (const [, value] of iterator) {
				entries.push(value);
			}

			await iterator.close();
			return { success: true, data: entries };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}

	async updateTimeEntry(id: string, timeEntry: TimeEntry): Promise<Result<TimeEntry>> {
		try {
			await this.ensureDbOpen();

			// Check if time entry exists
			const existing = await this.timeDb.get(id).catch(() => null);
			if (!existing) {
				return {
					success: false,
					error: new Error(`Time entry with id ${id} not found`),
				};
			}

			await this.timeDb.put(id, timeEntry);
			return { success: true, data: timeEntry };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}

	async deleteTimeEntry(id: string): Promise<Result<void>> {
		try {
			await this.ensureDbOpen();

			// Check if time entry exists
			const existing = await this.timeDb.get(id).catch(() => null);
			if (!existing) {
				return {
					success: false,
					error: new Error(`Time entry with id ${id} not found`),
				};
			}

			await this.timeDb.del(id);
			return { success: true, data: undefined };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}

	// Time Entry queries

	async findTimeEntriesByUser(userId: string): Promise<Result<TimeEntry[]>> {
		try {
			const allEntriesResult = await this.getAllTimeEntries();
			if (!allEntriesResult.success) {
				return allEntriesResult;
			}

			const entries = allEntriesResult.data.filter((entry) => entry.userId === userId);
			return { success: true, data: entries };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}

	async findTimeEntriesByTask(taskId: string): Promise<Result<TimeEntry[]>> {
		try {
			const allEntriesResult = await this.getAllTimeEntries();
			if (!allEntriesResult.success) {
				return allEntriesResult;
			}

			const entries = allEntriesResult.data.filter((entry) => entry.taskId === taskId);
			return { success: true, data: entries };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}

	async findTimeEntriesByDateRange(startDate: Date, endDate: Date): Promise<Result<TimeEntry[]>> {
		try {
			const allEntriesResult = await this.getAllTimeEntries();
			if (!allEntriesResult.success) {
				return allEntriesResult;
			}

			const entries = allEntriesResult.data.filter((entry) => {
				const entryDate = new Date(entry.startTime);
				return entryDate >= startDate && entryDate <= endDate;
			});
			return { success: true, data: entries };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}

	async searchTimeEntries(
		options: TimeSearchOptions,
	): Promise<Result<{ entries: TimeEntry[]; total: number }>> {
		try {
			const allEntriesResult = await this.getAllTimeEntries();
			if (!allEntriesResult.success) {
				return {
					success: false,
					error: allEntriesResult.error || new Error("Failed to fetch time entries"),
				};
			}

			let entries = allEntriesResult.data;

			// Apply filters
			if (options.filters) {
				if (options.filters.userId) {
					entries = entries.filter((entry) => entry.userId === options.filters?.userId);
				}
				if (options.filters.taskId) {
					entries = entries.filter((entry) => entry.taskId === options.filters?.taskId);
				}
				if (options.filters.dateFrom) {
					entries = entries.filter(
						(entry) => new Date(entry.startTime) >= (options.filters?.dateFrom as Date),
					);
				}
				if (options.filters.dateTo) {
					entries = entries.filter(
						(entry) => new Date(entry.startTime) <= (options.filters?.dateTo as Date),
					);
				}
				if (options.filters.status) {
					entries = entries.filter((entry) => options.filters?.status?.includes(entry.status));
				}
				if (options.filters.type) {
					entries = entries.filter((entry) => options.filters?.type?.includes(entry.type));
				}
				if (options.filters.billableStatus) {
					entries = entries.filter((entry) =>
						options.filters?.billableStatus?.includes(entry.billableStatus),
					);
				}
				if (options.filters.tags && options.filters.tags.length > 0) {
					entries = entries.filter((entry) =>
						options.filters?.tags?.some((tag) => entry.tags?.includes(tag)),
					);
				}
			}

			// Apply text search
			if (options.query) {
				const query = options.query.toLowerCase();
				entries = entries.filter(
					(entry) =>
						entry.description?.toLowerCase().includes(query) ||
						entry.tags?.some((tag) => tag.toLowerCase().includes(query)),
				);
			}

			// Apply sorting
			if (options.sort) {
				entries.sort((a, b) => {
					const { field, direction } = options.sort ?? { field: undefined, direction: "asc" };
					const aValue = a[field as keyof TimeEntry];
					const bValue = b[field as keyof TimeEntry];

					if (aValue < bValue) return direction === "asc" ? -1 : 1;
					if (aValue > bValue) return direction === "asc" ? 1 : -1;
					return 0;
				});
			}

			// Apply pagination
			const total = entries.length;
			if (options.offset) {
				entries = entries.slice(options.offset);
			}
			if (options.limit) {
				entries = entries.slice(0, options.limit);
			}

			return { success: true, data: { entries, total } };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}

	// Timesheet operations

	async createTimesheet(timesheet: Timesheet): Promise<Result<Timesheet>> {
		try {
			await this.ensureDbOpen();
			await this.timesheetDb.put(timesheet.id, timesheet);
			return { success: true, data: timesheet };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}

	async getTimesheet(id: string): Promise<Result<Timesheet | null>> {
		try {
			await this.ensureDbOpen();
			const timesheet = await this.timesheetDb.get(id).catch(() => null);
			return { success: true, data: timesheet };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}

	async getAllTimesheets(): Promise<Result<Timesheet[]>> {
		try {
			await this.ensureDbOpen();
			const timesheets: Timesheet[] = [];
			const iterator = this.timesheetDb.iterator();

			for await (const [, value] of iterator) {
				timesheets.push(value);
			}

			await iterator.close();
			return { success: true, data: timesheets };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}

	async updateTimesheet(id: string, timesheet: Timesheet): Promise<Result<Timesheet>> {
		try {
			await this.ensureDbOpen();

			// Check if timesheet exists
			const existing = await this.timesheetDb.get(id).catch(() => null);
			if (!existing) {
				return {
					success: false,
					error: new Error(`Timesheet with id ${id} not found`),
				};
			}

			await this.timesheetDb.put(id, timesheet);
			return { success: true, data: timesheet };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}

	async deleteTimesheet(id: string): Promise<Result<void>> {
		try {
			await this.ensureDbOpen();

			// Check if timesheet exists
			const existing = await this.timesheetDb.get(id).catch(() => null);
			if (!existing) {
				return {
					success: false,
					error: new Error(`Timesheet with id ${id} not found`),
				};
			}

			await this.timesheetDb.del(id);
			return { success: true, data: undefined };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}

	// Timesheet queries

	async findTimesheetsByUser(userId: string): Promise<Result<Timesheet[]>> {
		try {
			const allTimesheetsResult = await this.getAllTimesheets();
			if (!allTimesheetsResult.success) {
				return allTimesheetsResult;
			}

			const timesheets = allTimesheetsResult.data.filter(
				(timesheet) => timesheet.userId === userId,
			);
			return { success: true, data: timesheets };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}

	async findTimesheetsByStatus(status: string): Promise<Result<Timesheet[]>> {
		try {
			const allTimesheetsResult = await this.getAllTimesheets();
			if (!allTimesheetsResult.success) {
				return allTimesheetsResult;
			}

			const timesheets = allTimesheetsResult.data.filter(
				(timesheet) => timesheet.status === status,
			);
			return { success: true, data: timesheets };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}

	async findTimesheetsByPeriod(
		userId: string,
		period: string,
		startDate: Date,
		endDate: Date,
	): Promise<Result<Timesheet[]>> {
		try {
			const allTimesheetsResult = await this.getAllTimesheets();
			if (!allTimesheetsResult.success) {
				return allTimesheetsResult;
			}

			const timesheets = allTimesheetsResult.data.filter(
				(timesheet) =>
					timesheet.userId === userId &&
					timesheet.period === period &&
					timesheet.createdAt >= startDate &&
					timesheet.createdAt <= endDate,
			);
			return { success: true, data: timesheets };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}
}
