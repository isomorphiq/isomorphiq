import type { Result } from "../core/result.ts";
import { ConflictError, NotFoundError, UnauthorizedError } from "../core/result.ts";
import type {
	TimeAnalytics,
	TimeEntry,
	TimeEntryCreateInput,
	TimeEntryUpdateInput,
	TimeSearchOptions,
	Timesheet,
	TimesheetApprovalInput,
	TimesheetCreateInput,
	TimesheetSubmitInput,
} from "../core/time-tracking.ts";
import { TimeTrackingDomainRules, TimeTrackingFactory } from "../core/time-tracking.ts";
import type { ITimeTrackingRepository } from "../repositories/time-tracking-repository.ts";

export interface ProductivityReport {
	message: string;
}

export interface TimeUtilizationReport {
	message: string;
}

/**
 * Service interface for Time Tracking operations
 */
export interface ITimeTrackingService {
	// Time Entry operations
	startTimeEntry(input: TimeEntryCreateInput, createdBy: string): Promise<Result<TimeEntry>>;
	stopTimeEntry(id: string, stoppedBy: string): Promise<Result<TimeEntry>>;
	pauseTimeEntry(id: string, pauseTime: Date, pausedBy: string): Promise<Result<TimeEntry>>;
	resumeTimeEntry(id: string, resumeTime: Date, resumedBy: string): Promise<Result<TimeEntry>>;
	createManualTimeEntry(input: TimeEntryCreateInput, createdBy: string): Promise<Result<TimeEntry>>;
	updateTimeEntry(
		id: string,
		input: TimeEntryUpdateInput,
		updatedBy: string,
	): Promise<Result<TimeEntry>>;
	deleteTimeEntry(id: string, deletedBy: string): Promise<Result<void>>;

	// Time Entry queries
	getTimeEntry(id: string): Promise<Result<TimeEntry>>;
	getAllTimeEntries(): Promise<Result<TimeEntry[]>>;
	getTimeEntriesByUser(userId: string): Promise<Result<TimeEntry[]>>;
	getTimeEntriesByTask(taskId: string): Promise<Result<TimeEntry[]>>;
	getActiveTimeEntry(userId: string): Promise<Result<TimeEntry | null>>;
	searchTimeEntries(
		options: TimeSearchOptions,
	): Promise<Result<{ entries: TimeEntry[]; total: number }>>;

	// Timesheet operations
	createTimesheet(input: TimesheetCreateInput): Promise<Result<Timesheet>>;
	submitTimesheet(input: TimesheetSubmitInput): Promise<Result<Timesheet>>;
	approveTimesheet(input: TimesheetApprovalInput): Promise<Result<Timesheet>>;
	updateTimesheet(id: string, entries: TimeEntry[], updatedBy: string): Promise<Result<Timesheet>>;
	deleteTimesheet(id: string, deletedBy: string): Promise<Result<void>>;

	// Timesheet queries
	getTimesheet(id: string): Promise<Result<Timesheet>>;
	getAllTimesheets(): Promise<Result<Timesheet[]>>;
	getTimesheetsByUser(userId: string): Promise<Result<Timesheet[]>>;
	getTimesheetsByStatus(status: string): Promise<Result<Timesheet[]>>;

	// Analytics
	getTimeAnalytics(
		userId: string,
		startDate?: Date,
		endDate?: Date,
	): Promise<Result<TimeAnalytics>>;
	getProductivityReport(
		userId: string,
		period: "daily" | "weekly" | "monthly",
	): Promise<Result<ProductivityReport>>;
	getTimeUtilizationReport(
		userId: string,
		startDate: Date,
		endDate: Date,
	): Promise<Result<TimeUtilizationReport>>;
}

/**
 * Time tracking service implementation
 */
export class TimeTrackingService implements ITimeTrackingService {
	private readonly timeTrackingRepository: ITimeTrackingRepository;

	constructor(timeTrackingRepository: ITimeTrackingRepository) {
		this.timeTrackingRepository = timeTrackingRepository;
	}

	// Time Entry operations

	async startTimeEntry(input: TimeEntryCreateInput, createdBy: string): Promise<Result<TimeEntry>> {
		// Check if user already has an active time entry
		const activeEntryResult = await this.getActiveTimeEntry(input.userId);
		if (activeEntryResult.success && activeEntryResult.data) {
			return {
				success: false,
				error: new ConflictError("User already has an active time entry"),
			};
		}

		// Create time entry with timer type
		const timerInput = { ...input, type: "timer" as const };
		const timeEntryResult = TimeTrackingFactory.createTimeEntry(timerInput, createdBy);
		if (!timeEntryResult.success) {
			return timeEntryResult;
		}

		// Save to repository
		return await this.timeTrackingRepository.createTimeEntry(timeEntryResult.data);
	}

	async stopTimeEntry(id: string, stoppedBy: string): Promise<Result<TimeEntry>> {
		// Get existing time entry
		const existingResult = await this.getTimeEntry(id);
		if (!existingResult.success) {
			return existingResult;
		}

		const timeEntry = existingResult.data;
		if (!timeEntry) {
			return {
				success: false,
				error: new NotFoundError("Time entry", id),
			};
		}

		// Check if user can update this time entry
		if (!TimeTrackingDomainRules.canUpdateTimeEntry(timeEntry, stoppedBy)) {
			return {
				success: false,
				error: new UnauthorizedError("update", "time entry"),
			};
		}

		// Check if time entry is already stopped
		if (timeEntry.status === "completed") {
			return {
				success: false,
				error: new ConflictError("Time entry is already completed"),
			};
		}

		// Update time entry
		const now = new Date();
		const duration = TimeTrackingDomainRules.calculateDuration(
			timeEntry.startTime,
			now,
			timeEntry.pauseDuration,
		);

		const updatedEntry: TimeEntry = {
			...timeEntry,
			endTime: now,
			duration,
			status: "completed",
			updatedAt: now,
			updatedBy: stoppedBy,
		};

		// Save to repository
		return await this.timeTrackingRepository.updateTimeEntry(id, updatedEntry);
	}

	async pauseTimeEntry(id: string, pauseTime: Date, pausedBy: string): Promise<Result<TimeEntry>> {
		const existingResult = await this.getTimeEntry(id);
		if (!existingResult.success || !existingResult.data) {
			return existingResult.success
				? { success: false, error: new NotFoundError("Time entry", id) }
				: existingResult;
		}

		const timeEntry = existingResult.data;

		if (!TimeTrackingDomainRules.canUpdateTimeEntry(timeEntry, pausedBy)) {
			return {
				success: false,
				error: new UnauthorizedError("update", "time entry"),
			};
		}

		if (timeEntry.status !== "active") {
			return {
				success: false,
				error: new ConflictError("Only active time entries can be paused"),
			};
		}

		const updatedEntry: TimeEntry = {
			...timeEntry,
			status: "paused",
			updatedAt: pauseTime,
			updatedBy: pausedBy,
		};

		return await this.timeTrackingRepository.updateTimeEntry(id, updatedEntry);
	}

	async resumeTimeEntry(
		id: string,
		resumeTime: Date,
		resumedBy: string,
	): Promise<Result<TimeEntry>> {
		const existingResult = await this.getTimeEntry(id);
		if (!existingResult.success || !existingResult.data) {
			return existingResult.success
				? { success: false, error: new NotFoundError("Time entry", id) }
				: existingResult;
		}

		const timeEntry = existingResult.data;

		if (!TimeTrackingDomainRules.canUpdateTimeEntry(timeEntry, resumedBy)) {
			return {
				success: false,
				error: new UnauthorizedError("update", "time entry"),
			};
		}

		if (timeEntry.status !== "paused") {
			return {
				success: false,
				error: new ConflictError("Only paused time entries can be resumed"),
			};
		}

		// Calculate pause duration and add to total pause time
		const pauseDuration = TimeTrackingDomainRules.calculateDuration(
			timeEntry.updatedAt,
			resumeTime,
		);
		const totalPauseDuration = (timeEntry.pauseDuration || 0) + pauseDuration;

		const updatedEntry: TimeEntry = {
			...timeEntry,
			status: "active",
			pauseDuration: totalPauseDuration,
			updatedAt: resumeTime,
			updatedBy: resumedBy,
		};

		return await this.timeTrackingRepository.updateTimeEntry(id, updatedEntry);
	}

	async createManualTimeEntry(
		input: TimeEntryCreateInput,
		createdBy: string,
	): Promise<Result<TimeEntry>> {
		// Create manual time entry
		const manualInput = { ...input, type: "manual" as const };
		const timeEntryResult = TimeTrackingFactory.createTimeEntry(manualInput, createdBy);
		if (!timeEntryResult.success) {
			return timeEntryResult;
		}

		const timeEntry = timeEntryResult.data;

		// For manual entries, duration and endTime would need to be set via update after creation
		// This is a limitation of the current interface

		// Save to repository
		return await this.timeTrackingRepository.createTimeEntry(timeEntry);
	}

	async updateTimeEntry(
		id: string,
		input: TimeEntryUpdateInput,
		updatedBy: string,
	): Promise<Result<TimeEntry>> {
		const existingResult = await this.getTimeEntry(id);
		if (!existingResult.success || !existingResult.data) {
			return existingResult.success
				? { success: false, error: new NotFoundError("Time entry", id) }
				: existingResult;
		}

		const timeEntry = existingResult.data;

		if (!TimeTrackingDomainRules.canUpdateTimeEntry(timeEntry, updatedBy)) {
			return {
				success: false,
				error: new UnauthorizedError("update", "time entry"),
			};
		}

		const validation = TimeTrackingDomainRules.validateTimeEntryUpdateInput(input);
		if (!validation.success) {
			return { success: false, error: validation.error };
		}

		const updatedEntry: TimeEntry = {
			...timeEntry,
			...input,
			updatedAt: new Date(),
			updatedBy,
		};

		// Recalculate duration if end time is provided
		if (input.endTime) {
			updatedEntry.duration = TimeTrackingDomainRules.calculateDuration(
				updatedEntry.startTime,
				input.endTime,
				updatedEntry.pauseDuration,
			);
		}

		return await this.timeTrackingRepository.updateTimeEntry(id, updatedEntry);
	}

	async deleteTimeEntry(id: string, deletedBy: string): Promise<Result<void>> {
		const existingResult = await this.getTimeEntry(id);
		if (!existingResult.success) {
			return { success: false, error: existingResult.error };
		}
		if (!existingResult.data) {
			return { success: false, error: new NotFoundError("Time entry", id) };
		}

		const timeEntry = existingResult.data;

		if (!TimeTrackingDomainRules.canDeleteTimeEntry(timeEntry, deletedBy)) {
			return {
				success: false,
				error: new UnauthorizedError("delete", "time entry"),
			};
		}

		return await this.timeTrackingRepository.deleteTimeEntry(id);
	}

	// Time Entry queries

	async getTimeEntry(id: string): Promise<Result<TimeEntry>> {
		const result = await this.timeTrackingRepository.getTimeEntry(id);

		if (!result.success) {
			return result;
		}

		if (!result.data) {
			return {
				success: false,
				error: new NotFoundError("Time entry", id),
			};
		}

		return { success: true, data: result.data };
	}

	async getAllTimeEntries(): Promise<Result<TimeEntry[]>> {
		return await this.timeTrackingRepository.getAllTimeEntries();
	}

	async getTimeEntriesByUser(userId: string): Promise<Result<TimeEntry[]>> {
		return await this.timeTrackingRepository.findTimeEntriesByUser(userId);
	}

	async getTimeEntriesByTask(taskId: string): Promise<Result<TimeEntry[]>> {
		return await this.timeTrackingRepository.findTimeEntriesByTask(taskId);
	}

	async getActiveTimeEntry(userId: string): Promise<Result<TimeEntry | null>> {
		const userEntriesResult = await this.getTimeEntriesByUser(userId);
		if (!userEntriesResult.success) {
			return userEntriesResult;
		}

		const activeEntry = userEntriesResult.data.find(
			(entry) => entry.status === "active" || entry.status === "paused",
		);

		return { success: true, data: activeEntry || null };
	}

	async searchTimeEntries(
		options: TimeSearchOptions,
	): Promise<Result<{ entries: TimeEntry[]; total: number }>> {
		return await this.timeTrackingRepository.searchTimeEntries(options);
	}

	// Timesheet operations

	async createTimesheet(input: TimesheetCreateInput): Promise<Result<Timesheet>> {
		const timesheetResult = TimeTrackingFactory.createTimesheet(input);
		if (!timesheetResult.success) {
			return timesheetResult;
		}

		// Get time entries for the period
		const entriesResult = await this.timeTrackingRepository.findTimeEntriesByDateRange(
			input.startDate,
			input.endDate,
		);
		if (!entriesResult.success) {
			return { success: false, error: entriesResult.error };
		}
		if (!entriesResult.data) {
			return { success: false, error: new Error("No time entries found for period") };
		}

		// Filter entries for the user
		const userEntries = entriesResult.data.filter((entry) => entry.userId === input.userId);

		// Update timesheet with entries and summary
		const timesheet = timesheetResult.data;
		timesheet.entries = userEntries.map((entry) => ({
			timeEntry: entry,
			taskTitle: `Task ${entry.taskId}`, // TODO: Get actual task title
			taskPriority: "medium", // TODO: Get actual task priority
		}));

		// Calculate summary
		timesheet.totalHours =
			userEntries.reduce((total, entry) => total + (entry.duration || 0), 0) / 60;
		timesheet.billableHours = TimeTrackingDomainRules.getBillableHours(userEntries);
		timesheet.nonBillableHours = TimeTrackingDomainRules.getNonBillableHours(userEntries);

		return await this.timeTrackingRepository.createTimesheet(timesheet);
	}

	async submitTimesheet(input: TimesheetSubmitInput): Promise<Result<Timesheet>> {
		const existingResult = await this.getTimesheet(input.id);
		if (!existingResult.success || !existingResult.data) {
			return existingResult.success
				? { success: false, error: new NotFoundError("Timesheet", input.id) }
				: existingResult;
		}

		const timesheet = existingResult.data;

		if (timesheet.status !== "draft") {
			return {
				success: false,
				error: new ConflictError("Only draft timesheets can be submitted"),
			};
		}

		const updatedTimesheet: Timesheet = {
			...timesheet,
			status: "submitted",
			submittedAt: new Date(),
			submittedBy: input.submittedBy,
			updatedAt: new Date(),
		};

		return await this.timeTrackingRepository.updateTimesheet(input.id, updatedTimesheet);
	}

	async approveTimesheet(input: TimesheetApprovalInput): Promise<Result<Timesheet>> {
		const existingResult = await this.getTimesheet(input.id);
		if (!existingResult.success || !existingResult.data) {
			return existingResult.success
				? { success: false, error: new NotFoundError("Timesheet", input.id) }
				: existingResult;
		}

		const timesheet = existingResult.data;

		if (!TimeTrackingDomainRules.canApproveTimesheet(timesheet, input.approvedBy)) {
			return {
				success: false,
				error: new UnauthorizedError("approve", "timesheet"),
			};
		}

		if (timesheet.status !== "submitted") {
			return {
				success: false,
				error: new ConflictError("Only submitted timesheets can be approved/rejected"),
			};
		}

		const now = new Date();
		const updatedTimesheet: Timesheet = {
			...timesheet,
			status: input.status,
			updatedAt: now,
		};

		if (input.status === "approved") {
			updatedTimesheet.approvedAt = now;
			updatedTimesheet.approvedBy = input.approvedBy;
		} else if (input.status === "rejected") {
			updatedTimesheet.rejectedAt = now;
			updatedTimesheet.rejectedBy = input.approvedBy;
			if (input.rejectionReason) {
				updatedTimesheet.rejectionReason = input.rejectionReason;
			}
		}

		return await this.timeTrackingRepository.updateTimesheet(input.id, updatedTimesheet);
	}

	async updateTimesheet(
		id: string,
		entries: TimeEntry[],
		_updatedBy: string,
	): Promise<Result<Timesheet>> {
		const existingResult = await this.getTimesheet(id);
		if (!existingResult.success || !existingResult.data) {
			return existingResult.success
				? { success: false, error: new NotFoundError("Timesheet", id) }
				: existingResult;
		}

		const timesheet = existingResult.data;

		if (timesheet.status !== "draft") {
			return {
				success: false,
				error: new ConflictError("Only draft timesheets can be updated"),
			};
		}

		// Update timesheet entries and summary
		const updatedEntries = entries.map((entry) => ({
			timeEntry: entry,
			taskTitle: `Task ${entry.taskId}`, // TODO: Get actual task title
			taskPriority: "medium", // TODO: Get actual task priority
		}));

		const updatedTimesheet: Timesheet = {
			...timesheet,
			entries: updatedEntries,
			totalHours: entries.reduce((total, entry) => total + (entry.duration || 0), 0) / 60,
			billableHours: TimeTrackingDomainRules.getBillableHours(entries),
			nonBillableHours: TimeTrackingDomainRules.getNonBillableHours(entries),
			updatedAt: new Date(),
		};

		return await this.timeTrackingRepository.updateTimesheet(id, updatedTimesheet);
	}

	async deleteTimesheet(id: string, deletedBy: string): Promise<Result<void>> {
		const existingResult = await this.getTimesheet(id);
		if (!existingResult.success) {
			return { success: false, error: existingResult.error };
		}
		if (!existingResult.data) {
			return { success: false, error: new NotFoundError("Timesheet", id) };
		}

		const timesheet = existingResult.data;

		// Only draft timesheets can be deleted
		if (timesheet.status !== "draft") {
			return {
				success: false,
				error: new ConflictError("Only draft timesheets can be deleted"),
			};
		}

		// Users can only delete their own timesheets
		if (timesheet.userId !== deletedBy) {
			return {
				success: false,
				error: new UnauthorizedError("delete", "timesheet"),
			};
		}

		return await this.timeTrackingRepository.deleteTimesheet(id);
	}

	// Timesheet queries

	async getTimesheet(id: string): Promise<Result<Timesheet>> {
		const result = await this.timeTrackingRepository.getTimesheet(id);

		if (!result.success) {
			return result;
		}

		if (!result.data) {
			return {
				success: false,
				error: new NotFoundError("Timesheet", id),
			};
		}

		return { success: true, data: result.data };
	}

	async getAllTimesheets(): Promise<Result<Timesheet[]>> {
		return await this.timeTrackingRepository.getAllTimesheets();
	}

	async getTimesheetsByUser(userId: string): Promise<Result<Timesheet[]>> {
		return await this.timeTrackingRepository.findTimesheetsByUser(userId);
	}

	async getTimesheetsByStatus(status: string): Promise<Result<Timesheet[]>> {
		return await this.timeTrackingRepository.findTimesheetsByStatus(status);
	}

	// Analytics

	async getTimeAnalytics(
		userId: string,
		startDate?: Date,
		endDate?: Date,
	): Promise<Result<TimeAnalytics>> {
		const allEntriesResult = await this.getTimeEntriesByUser(userId);
		if (!allEntriesResult.success || !allEntriesResult.data) {
			return { success: false, error: allEntriesResult.error };
		}

		let entries = allEntriesResult.data;

		// Filter by date range if provided
		if (startDate || endDate) {
			entries = entries.filter((entry) => {
				const entryDate = new Date(entry.startTime);
				if (startDate && entryDate < startDate) return false;
				if (endDate && entryDate > endDate) return false;
				return true;
			});
		}

		// Calculate analytics
		const totalMinutes = entries.reduce((total, entry) => total + (entry.duration || 0), 0);
		const totalHours = totalMinutes / 60;
		const billableHours = TimeTrackingDomainRules.getBillableHours(entries);
		const nonBillableHours = TimeTrackingDomainRules.getNonBillableHours(entries);

		// Group by day
		const hoursByDay = this.groupHoursByDay(entries);

		// Group by task
		const hoursByTask = this.groupHoursByTask(entries);

		// Calculate productivity metrics
		const completedTasks = new Set(
			entries.filter((e) => e.status === "completed").map((e) => e.taskId),
		).size;
		const averageTaskDuration = completedTasks > 0 ? totalMinutes / completedTasks : 0;
		const productivityScore = Math.min(
			100,
			Math.round((completedTasks / Math.max(1, entries.length)) * 100),
		);

		const analytics: TimeAnalytics = {
			totalHoursTracked: totalHours,
			billableHours,
			nonBillableHours,
			averageDailyHours: this.calculateAverageDailyHours(entries),
			tasksCompleted: completedTasks,
			averageTaskDuration,
			productivityScore,
			hoursByDay,
			hoursByTask,
			hoursByProject: [], // TODO: Implement project grouping
			onTimeCompletionRate: 85, // TODO: Calculate based on deadlines
			overtimeHours: Math.max(0, totalHours - 40), // Assuming 40-hour work week
			efficiencyScore: Math.min(100, Math.round((billableHours / Math.max(1, totalHours)) * 100)),
		};

		return { success: true, data: analytics };
	}

	async getProductivityReport(
		_userId: string,
		_period: "daily" | "weekly" | "monthly",
	): Promise<Result<ProductivityReport>> {
		// TODO: Implement detailed productivity report
		return { success: true, data: { message: "Productivity report not yet implemented" } };
	}

	async getTimeUtilizationReport(
		_userId: string,
		_startDate: Date,
		_endDate: Date,
	): Promise<Result<TimeUtilizationReport>> {
		// TODO: Implement time utilization report
		return { success: true, data: { message: "Time utilization report not yet implemented" } };
	}

	// Helper methods

	private groupHoursByDay(
		entries: TimeEntry[],
	): Array<{ date: string; hours: number; billableHours: number }> {
		const grouped: Map<string, { total: number; billable: number }> = new Map();

		entries.forEach((entry) => {
			if (!entry.duration) return;

			const dateStr = new Date(entry.startTime).toISOString().split("T")[0];
			const hours = entry.duration / 60;
			const billable = entry.billableStatus === "billable" ? hours : 0;

			const existing = grouped.get(dateStr);
			if (existing) {
				grouped.set(dateStr, {
					total: existing.total + hours,
					billable: existing.billable + billable,
				});
			} else {
				grouped.set(dateStr, {
					total: hours,
					billable: billable,
				});
			}
		});

		return Array.from(grouped.entries())
			.map(([dateKey, data]) => ({
				date: dateKey,
				hours: data.total,
				billableHours: data.billable,
			}))
			.sort((a, b) => a.date.localeCompare(b.date));
	}

	private groupHoursByTask(
		entries: TimeEntry[],
	): Array<{ taskId: string; taskTitle: string; hours: number }> {
		const grouped = new Map<string, number>();

		entries.forEach((entry) => {
			if (!entry.duration) return;
			const hours = entry.duration / 60;
			grouped.set(entry.taskId, (grouped.get(entry.taskId) || 0) + hours);
		});

		return Array.from(grouped.entries()).map(([taskId, hours]) => ({
			taskId,
			taskTitle: `Task ${taskId}`, // TODO: Get actual task title
			hours,
		}));
	}

	private calculateAverageDailyHours(entries: TimeEntry[]): number {
		if (entries.length === 0) return 0;

		const uniqueDays = new Set(
			entries.map((entry) => new Date(entry.startTime).toISOString().split("T")[0]),
		);
		const totalHours = entries.reduce((total, entry) => total + (entry.duration || 0), 0) / 60;

		return totalHours / uniqueDays.size;
	}
}
