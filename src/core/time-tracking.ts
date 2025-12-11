import { ValidationError } from "../core/result.ts";
import type { BaseEntity, Result } from "../core/result.ts";

/**
 * Time tracking core types
 */

export type TimeEntryStatus = "active" | "paused" | "completed" | "deleted";
export type TimeEntryType = "manual" | "automatic" | "timer";
export type BillableStatus = "billable" | "non-billable" | "pending";

export interface TimeEntry extends BaseEntity {
	id: string;
	taskId: string;
	userId: string;
	description?: string;

	// Time tracking data
	startTime: Date;
	endTime?: Date;
	duration?: number; // in minutes
	pauseDuration?: number; // total pause time in minutes

	// Metadata
	type: TimeEntryType;
	status: TimeEntryStatus;
	billableStatus: BillableStatus;
	tags?: string[];

	// System fields
	createdAt: Date;
	updatedAt: Date;
	createdBy: string;
	updatedBy?: string;
}

export interface TimeEntryCreateInput {
	taskId: string;
	userId: string;
	description?: string;
	startTime?: Date;
	type?: TimeEntryType;
	billableStatus?: BillableStatus;
	tags?: string[];
}

export interface TimeEntryUpdateInput {
	id: string;
	description?: string;
	endTime?: Date;
	duration?: number;
	billableStatus?: BillableStatus;
	tags?: string[];
}

export interface TimeEntryPauseInput {
	id: string;
	pauseTime: Date;
	resumeTime?: Date;
}

export interface TimesheetEntry {
	timeEntry: TimeEntry;
	taskTitle: string;
	taskPriority: string;
	projectName?: string;
	clientName?: string;
}

export interface Timesheet {
	id: string;
	userId: string;
	period: TimesheetPeriod;
	status: TimesheetStatus;
	entries: TimesheetEntry[];

	// Summary data
	totalHours: number;
	billableHours: number;
	nonBillableHours: number;

	// Approval workflow
	submittedAt?: Date;
	submittedBy?: string;
	approvedAt?: Date;
	approvedBy?: string;
	rejectedAt?: Date;
	rejectedBy?: string;
	rejectionReason?: string;

	// System fields
	createdAt: Date;
	updatedAt: Date;
}

export type TimesheetPeriod = "daily" | "weekly" | "monthly";
export type TimesheetStatus = "draft" | "submitted" | "approved" | "rejected" | "locked";

export interface TimesheetCreateInput {
	userId: string;
	period: TimesheetPeriod;
	startDate: Date;
	endDate: Date;
}

export interface TimesheetSubmitInput {
	id: string;
	submittedBy: string;
}

export interface TimesheetApprovalInput {
	id: string;
	approvedBy: string;
	status: "approved" | "rejected";
	rejectionReason?: string;
}

export interface TimeAnalytics {
	// Time metrics
	totalHoursTracked: number;
	billableHours: number;
	nonBillableHours: number;
	averageDailyHours: number;

	// Productivity metrics
	tasksCompleted: number;
	averageTaskDuration: number;
	productivityScore: number;

	// Trend data
	hoursByDay: Array<{ date: string; hours: number; billableHours: number }>;
	hoursByTask: Array<{ taskId: string; taskTitle: string; hours: number }>;
	hoursByProject: Array<{ projectId: string; projectName: string; hours: number }>;

	// Performance metrics
	onTimeCompletionRate: number;
	overtimeHours: number;
	efficiencyScore: number;
}

export interface TimeFilters {
	userId?: string;
	taskId?: string;
	dateFrom?: Date;
	dateTo?: Date;
	status?: TimeEntryStatus[];
	type?: TimeEntryType[];
	billableStatus?: BillableStatus[];
	tags?: string[];
}

export interface TimeSearchOptions {
	query?: string;
	filters?: TimeFilters;
	sort?: {
		field: "startTime" | "duration" | "updatedAt";
		direction: "asc" | "desc";
	};
	limit?: number;
	offset?: number;
}

/**
 * Time tracking domain rules and validation
 */
export const TimeTrackingDomainRules = {
	validateTimeEntryCreateInput(input: TimeEntryCreateInput): Result<void> {
		if (!input.taskId || input.taskId.trim().length === 0) {
			return {
				success: false,
				error: new ValidationError("Task ID is required", "taskId"),
			};
		}

		if (!input.userId || input.userId.trim().length === 0) {
			return {
				success: false,
				error: new ValidationError("User ID is required", "userId"),
			};
		}

		if (input.startTime && input.startTime > new Date()) {
			return {
				success: false,
				error: new ValidationError("Start time cannot be in the future", "startTime"),
			};
		}

		const validTypes: TimeEntryType[] = ["manual", "automatic", "timer"];
		if (input.type && !validTypes.includes(input.type)) {
			return {
				success: false,
				error: new ValidationError("Invalid time entry type", "type"),
			};
		}

		const validBillableStatuses: BillableStatus[] = ["billable", "non-billable", "pending"];
		if (input.billableStatus && !validBillableStatuses.includes(input.billableStatus)) {
			return {
				success: false,
				error: new ValidationError("Invalid billable status", "billableStatus"),
			};
		}

		return { success: true, data: undefined };
	},

	validateTimeEntryUpdateInput(input: TimeEntryUpdateInput): Result<void> {
		if (!input.id || input.id.trim().length === 0) {
			return {
				success: false,
				error: new ValidationError("Time entry ID is required", "id"),
			};
		}

		if (input.endTime && input.endTime < new Date(0)) {
			return {
				success: false,
				error: new ValidationError("Invalid end time", "endTime"),
			};
		}

		if (input.duration !== undefined && input.duration < 0) {
			return {
				success: false,
				error: new ValidationError("Duration cannot be negative", "duration"),
			};
		}

		const validBillableStatuses: BillableStatus[] = ["billable", "non-billable", "pending"];
		if (input.billableStatus && !validBillableStatuses.includes(input.billableStatus)) {
			return {
				success: false,
				error: new ValidationError("Invalid billable status", "billableStatus"),
			};
		}

		return { success: true, data: undefined };
	},

	validateTimesheetPeriod(startDate: Date, endDate: Date): Result<void> {
		if (startDate >= endDate) {
			return {
				success: false,
				error: new ValidationError("Start date must be before end date", "startDate"),
			};
		}

		const maxPeriodDays = 365; // Maximum 1 year for a timesheet period
		const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));

		if (daysDiff > maxPeriodDays) {
			return {
				success: false,
				error: new ValidationError("Timesheet period cannot exceed 365 days", "period"),
			};
		}

		return { success: true, data: undefined };
	},

	canUpdateTimeEntry(timeEntry: TimeEntry, userId: string): boolean {
		// User can update their own time entries
		if (timeEntry.userId === userId) {
			return true;
		}

		// TODO: Add role-based permissions for managers/admins
		return false;
	},

	canDeleteTimeEntry(timeEntry: TimeEntry, userId: string): boolean {
		// Users can delete their own time entries
		if (timeEntry.userId === userId) {
			return true;
		}

		// TODO: Add role-based permissions for managers/admins
		return false;
	},

	canApproveTimesheet(timesheet: Timesheet, userId: string): boolean {
		// Users cannot approve their own timesheets
		if (timesheet.userId === userId) {
			return false;
		}

		// TODO: Add role-based permissions for managers/admins
		return false;
	},

	calculateDuration(startTime: Date, endTime?: Date, pauseDuration = 0): number {
		const end = endTime || new Date();
		const totalMs = end.getTime() - startTime.getTime();
		const pauseMs = pauseDuration * 60 * 1000; // Convert minutes to milliseconds
		return Math.max(0, Math.round((totalMs - pauseMs) / (1000 * 60))); // Return minutes
	},

	formatDuration(minutes: number): string {
		const hours = Math.floor(minutes / 60);
		const mins = minutes % 60;

		if (hours === 0) {
			return `${mins}m`;
		} else if (mins === 0) {
			return `${hours}h`;
		} else {
			return `${hours}h ${mins}m`;
		}
	},

	getBillableHours(entries: TimeEntry[]): number {
		return (
			entries
				.filter((entry) => entry.billableStatus === "billable" && entry.duration)
				.reduce((total, entry) => total + (entry.duration || 0), 0) / 60
		); // Convert to hours
	},

	getNonBillableHours(entries: TimeEntry[]): number {
		return (
			entries
				.filter((entry) => entry.billableStatus === "non-billable" && entry.duration)
				.reduce((total, entry) => total + (entry.duration || 0), 0) / 60
		); // Convert to hours
	},
};

/**
 * Time tracking factory
 */
export const TimeTrackingFactory = {
	createTimeEntry(input: TimeEntryCreateInput, createdBy: string): Result<TimeEntry> {
		const validation = TimeTrackingDomainRules.validateTimeEntryCreateInput(input);
		if (!validation.success) {
			return validation as Result<TimeEntry>;
		}

		const now = new Date();
		const timeEntry: TimeEntry = {
			id: `time-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
			taskId: input.taskId,
			userId: input.userId,
			...(input.description && { description: input.description }),
			startTime: input.startTime || now,
			type: input.type || "manual",
			status: "active",
			billableStatus: input.billableStatus || "pending",
			tags: input.tags || [],
			createdAt: now,
			updatedAt: now,
			createdBy,
		};

		return { success: true, data: timeEntry };
	},

	createTimesheet(input: TimesheetCreateInput): Result<Timesheet> {
		const validation = TimeTrackingDomainRules.validateTimesheetPeriod(
			input.startDate,
			input.endDate,
		);
		if (!validation.success) {
			return validation as Result<Timesheet>;
		}

		const now = new Date();
		const timesheet: Timesheet = {
			id: `timesheet-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
			userId: input.userId,
			period: input.period,
			status: "draft",
			entries: [],
			totalHours: 0,
			billableHours: 0,
			nonBillableHours: 0,
			createdAt: now,
			updatedAt: now,
		};

		return { success: true, data: timesheet };
	},
};
