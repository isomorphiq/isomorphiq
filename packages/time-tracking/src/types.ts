import { z } from "zod";
import { impl, method, struct, trait } from "@tsimpl/runtime";
import type { StructSelf } from "@tsimpl/runtime";
import type { Self } from "@tsimpl/core";
import { ValidationError, type Result } from "@isomorphiq/core";

export const IdentifiableTrait = trait({
    id: method<Self, string>(),
});

export const TimestampedTrait = trait({
    createdAt: method<Self, Date>(),
    updatedAt: method<Self, Date>(),
});

export const TimeEntryStatusSchema = z.enum(["active", "paused", "completed", "deleted"]);
export type TimeEntryStatus = z.output<typeof TimeEntryStatusSchema>;

export const TimeEntryTypeSchema = z.enum(["manual", "automatic", "timer"]);
export type TimeEntryType = z.output<typeof TimeEntryTypeSchema>;

export const BillableStatusSchema = z.enum(["billable", "non-billable", "pending"]);
export type BillableStatus = z.output<typeof BillableStatusSchema>;

export const TimeEntrySchema = z
    .object({
        id: z.string(),
        taskId: z.string(),
        userId: z.string(),
        description: z.string().optional(),
        startTime: z.date(),
        endTime: z.date().optional(),
        duration: z.number().optional(),
        pauseDuration: z.number().optional(),
        type: TimeEntryTypeSchema,
        status: TimeEntryStatusSchema,
        billableStatus: BillableStatusSchema,
        tags: z.array(z.string()).optional(),
        createdAt: z.date(),
        updatedAt: z.date(),
        createdBy: z.string(),
        updatedBy: z.string().optional(),
    })
    .passthrough();

export const TimeEntryStruct = struct.name("TimeEntry")<
    z.output<typeof TimeEntrySchema>,
    z.input<typeof TimeEntrySchema>
>(TimeEntrySchema);
export type TimeEntry = StructSelf<typeof TimeEntryStruct>;

export const TimeEntryCreateInputSchema = z.object({
    taskId: z.string(),
    userId: z.string(),
    description: z.string().optional(),
    startTime: z.date().optional(),
    type: TimeEntryTypeSchema.optional(),
    billableStatus: BillableStatusSchema.optional(),
    tags: z.array(z.string()).optional(),
});
export const TimeEntryCreateInputStruct = struct.name("TimeEntryCreateInput")<
    z.output<typeof TimeEntryCreateInputSchema>,
    z.input<typeof TimeEntryCreateInputSchema>
>(TimeEntryCreateInputSchema);
export type TimeEntryCreateInput = StructSelf<typeof TimeEntryCreateInputStruct>;

export const TimeEntryUpdateInputSchema = z.object({
    id: z.string(),
    description: z.string().optional(),
    endTime: z.date().optional(),
    duration: z.number().optional(),
    billableStatus: BillableStatusSchema.optional(),
    tags: z.array(z.string()).optional(),
});
export const TimeEntryUpdateInputStruct = struct.name("TimeEntryUpdateInput")<
    z.output<typeof TimeEntryUpdateInputSchema>,
    z.input<typeof TimeEntryUpdateInputSchema>
>(TimeEntryUpdateInputSchema);
export type TimeEntryUpdateInput = StructSelf<typeof TimeEntryUpdateInputStruct>;

export const TimeEntryPauseInputSchema = z.object({
    id: z.string(),
    pauseTime: z.date(),
    resumeTime: z.date().optional(),
});
export const TimeEntryPauseInputStruct = struct.name("TimeEntryPauseInput")<
    z.output<typeof TimeEntryPauseInputSchema>,
    z.input<typeof TimeEntryPauseInputSchema>
>(TimeEntryPauseInputSchema);
export type TimeEntryPauseInput = StructSelf<typeof TimeEntryPauseInputStruct>;

export const TimesheetEntrySchema = z.object({
    timeEntry: TimeEntrySchema,
    taskTitle: z.string(),
    taskPriority: z.string(),
    projectName: z.string().optional(),
    clientName: z.string().optional(),
});
export const TimesheetEntryStruct = struct.name("TimesheetEntry")<
    z.output<typeof TimesheetEntrySchema>,
    z.input<typeof TimesheetEntrySchema>
>(TimesheetEntrySchema);
export type TimesheetEntry = StructSelf<typeof TimesheetEntryStruct>;

export const TimesheetPeriodSchema = z.enum(["daily", "weekly", "monthly"]);
export type TimesheetPeriod = z.output<typeof TimesheetPeriodSchema>;

export const TimesheetStatusSchema = z.enum(["draft", "submitted", "approved", "rejected", "locked"]);
export type TimesheetStatus = z.output<typeof TimesheetStatusSchema>;

export const TimesheetSchema = z.object({
    id: z.string(),
    userId: z.string(),
    period: TimesheetPeriodSchema,
    status: TimesheetStatusSchema,
    entries: z.array(TimesheetEntrySchema),
    totalHours: z.number(),
    billableHours: z.number(),
    nonBillableHours: z.number(),
    submittedAt: z.date().optional(),
    submittedBy: z.string().optional(),
    approvedAt: z.date().optional(),
    approvedBy: z.string().optional(),
    rejectedAt: z.date().optional(),
    rejectedBy: z.string().optional(),
    rejectionReason: z.string().optional(),
    createdAt: z.date(),
    updatedAt: z.date(),
});
export const TimesheetStruct = struct.name("Timesheet")<
    z.output<typeof TimesheetSchema>,
    z.input<typeof TimesheetSchema>
>(TimesheetSchema);
export type Timesheet = StructSelf<typeof TimesheetStruct>;

export const TimesheetCreateInputSchema = z.object({
    userId: z.string(),
    period: TimesheetPeriodSchema,
    startDate: z.date(),
    endDate: z.date(),
});
export const TimesheetCreateInputStruct = struct.name("TimesheetCreateInput")<
    z.output<typeof TimesheetCreateInputSchema>,
    z.input<typeof TimesheetCreateInputSchema>
>(TimesheetCreateInputSchema);
export type TimesheetCreateInput = StructSelf<typeof TimesheetCreateInputStruct>;

export const TimesheetSubmitInputSchema = z.object({
    id: z.string(),
    submittedBy: z.string(),
});
export const TimesheetSubmitInputStruct = struct.name("TimesheetSubmitInput")<
    z.output<typeof TimesheetSubmitInputSchema>,
    z.input<typeof TimesheetSubmitInputSchema>
>(TimesheetSubmitInputSchema);
export type TimesheetSubmitInput = StructSelf<typeof TimesheetSubmitInputStruct>;

export const TimesheetApprovalInputSchema = z.object({
    id: z.string(),
    approvedBy: z.string(),
    status: z.enum(["approved", "rejected"]),
    rejectionReason: z.string().optional(),
});
export const TimesheetApprovalInputStruct = struct.name("TimesheetApprovalInput")<
    z.output<typeof TimesheetApprovalInputSchema>,
    z.input<typeof TimesheetApprovalInputSchema>
>(TimesheetApprovalInputSchema);
export type TimesheetApprovalInput = StructSelf<typeof TimesheetApprovalInputStruct>;

export const TimeAnalyticsSchema = z.object({
    totalHoursTracked: z.number(),
    billableHours: z.number(),
    nonBillableHours: z.number(),
    averageDailyHours: z.number(),
    tasksCompleted: z.number(),
    averageTaskDuration: z.number(),
    productivityScore: z.number(),
    hoursByDay: z.array(
        z.object({
            date: z.string(),
            hours: z.number(),
            billableHours: z.number(),
        }),
    ),
    hoursByTask: z.array(
        z.object({
            taskId: z.string(),
            taskTitle: z.string(),
            hours: z.number(),
        }),
    ),
    hoursByProject: z.array(
        z.object({
            projectId: z.string(),
            projectName: z.string(),
            hours: z.number(),
        }),
    ),
    onTimeCompletionRate: z.number(),
    overtimeHours: z.number(),
    efficiencyScore: z.number(),
});
export const TimeAnalyticsStruct = struct.name("TimeAnalytics")<
    z.output<typeof TimeAnalyticsSchema>,
    z.input<typeof TimeAnalyticsSchema>
>(TimeAnalyticsSchema);
export type TimeAnalytics = StructSelf<typeof TimeAnalyticsStruct>;

export const TimeFiltersSchema = z.object({
    userId: z.string().optional(),
    taskId: z.string().optional(),
    dateFrom: z.date().optional(),
    dateTo: z.date().optional(),
    status: z.array(TimeEntryStatusSchema).optional(),
    type: z.array(TimeEntryTypeSchema).optional(),
    billableStatus: z.array(BillableStatusSchema).optional(),
    tags: z.array(z.string()).optional(),
});
export const TimeFiltersStruct = struct.name("TimeFilters")<
    z.output<typeof TimeFiltersSchema>,
    z.input<typeof TimeFiltersSchema>
>(TimeFiltersSchema);
export type TimeFilters = StructSelf<typeof TimeFiltersStruct>;

const TimeSearchSortSchema = z.object({
    field: z.enum(["startTime", "duration", "updatedAt"]),
    direction: z.enum(["asc", "desc"]),
});

export const TimeSearchOptionsSchema = z.object({
    query: z.string().optional(),
    filters: TimeFiltersSchema.optional(),
    sort: TimeSearchSortSchema.optional(),
    limit: z.number().optional(),
    offset: z.number().optional(),
});
export const TimeSearchOptionsStruct = struct.name("TimeSearchOptions")<
    z.output<typeof TimeSearchOptionsSchema>,
    z.input<typeof TimeSearchOptionsSchema>
>(TimeSearchOptionsSchema);
export type TimeSearchOptions = StructSelf<typeof TimeSearchOptionsStruct>;

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

        const maxPeriodDays = 365;
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
        if (timeEntry.userId === userId) {
            return true;
        }

        return false;
    },

    canDeleteTimeEntry(timeEntry: TimeEntry, userId: string): boolean {
        if (timeEntry.userId === userId) {
            return true;
        }

        return false;
    },

    canApproveTimesheet(timesheet: Timesheet, userId: string): boolean {
        if (timesheet.userId === userId) {
            return false;
        }

        return false;
    },

    calculateDuration(startTime: Date, endTime?: Date, pauseDuration = 0): number {
        const end = endTime || new Date();
        const totalMs = end.getTime() - startTime.getTime();
        const pauseMs = pauseDuration * 60 * 1000;
        return Math.max(0, Math.round((totalMs - pauseMs) / (1000 * 60)));
    },

    formatDuration(minutes: number): string {
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;

        if (hours === 0) {
            return `${mins}m`;
        }
        if (mins === 0) {
            return `${hours}h`;
        }
        return `${hours}h ${mins}m`;
    },

    getBillableHours(entries: TimeEntry[]): number {
        return (
            entries
                .filter((entry) => entry.billableStatus === "billable" && entry.duration)
                .reduce((total, entry) => total + (entry.duration || 0), 0) / 60
        );
    },

    getNonBillableHours(entries: TimeEntry[]): number {
        return (
            entries
                .filter((entry) => entry.billableStatus === "non-billable" && entry.duration)
                .reduce((total, entry) => total + (entry.duration || 0), 0) / 60
        );
    },
};

export const TimeTrackingFactory = {
    createTimeEntry(input: TimeEntryCreateInput, createdBy: string): Result<TimeEntry> {
        const validation = TimeTrackingDomainRules.validateTimeEntryCreateInput(input);
        if (!validation.success) {
            return { success: false, error: validation.error };
        }

        const now = new Date();
        const candidate = {
            id: `time-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
            taskId: input.taskId,
            userId: input.userId,
            ...(input.description ? { description: input.description } : {}),
            startTime: input.startTime || now,
            type: input.type || "manual",
            status: "active",
            billableStatus: input.billableStatus || "pending",
            tags: input.tags || [],
            createdAt: now,
            updatedAt: now,
            createdBy,
        };

        try {
            const timeEntry = TimeEntryStruct.from(candidate);
            return { success: true, data: timeEntry };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error : new Error(String(error)),
            };
        }
    },

    createTimesheet(input: TimesheetCreateInput): Result<Timesheet> {
        const validation = TimeTrackingDomainRules.validateTimesheetPeriod(
            input.startDate,
            input.endDate,
        );
        if (!validation.success) {
            return { success: false, error: validation.error };
        }

        const now = new Date();
        const candidate = {
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

        try {
            const timesheet = TimesheetStruct.from(candidate);
            return { success: true, data: timesheet };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error : new Error(String(error)),
            };
        }
    },
};

impl(IdentifiableTrait).for(TimeEntryStruct, {
    id: method((self: TimeEntry) => self.id),
});

impl(TimestampedTrait).for(TimeEntryStruct, {
    createdAt: method((self: TimeEntry) => self.createdAt),
    updatedAt: method((self: TimeEntry) => self.updatedAt),
});

impl(IdentifiableTrait).for(TimesheetStruct, {
    id: method((self: Timesheet) => self.id),
});

impl(TimestampedTrait).for(TimesheetStruct, {
    createdAt: method((self: Timesheet) => self.createdAt),
    updatedAt: method((self: Timesheet) => self.updatedAt),
});
