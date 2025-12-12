import type { Task } from "../types.ts";
import { BaseIntegrationAdapter } from "./base-adapter.ts";
import type { ExternalTask, IntegrationHealth, IntegrationSettings } from "./types.ts";

type CalendarSettings = NonNullable<IntegrationSettings["calendar"]>;

interface CalendarEvent {
	id: string;
	htmlLink?: string;
	extendedProperties?: {
		private?: {
			taskId?: string;
			taskStatus?: string;
			taskPriority?: string;
		};
	};
}

type CalendarPayload = {
	headers?: Record<string, string>;
};

/**
 * Google Calendar integration adapter
 */
export class CalendarIntegration extends BaseIntegrationAdapter {
	private apiUrl = "https://www.googleapis.com/calendar/v3";
	private accessToken?: string;

	constructor() {
		super("calendar", "Google Calendar");
	}

	protected async onInitialize(): Promise<void> {
		const calendarSettings = this.getCalendarSettings();
		if (!calendarSettings.calendarId) {
			throw new Error("Calendar ID is required");
		}

		// Set access token
		this.accessToken = this.config.credentials.accessToken;

		// Test connection
		const isConnected = await this.onTestConnection();
		if (!isConnected) {
			throw new Error("Failed to connect to Google Calendar API");
		}

		console.log(`[CALENDAR] Initialized for calendar: ${calendarSettings.calendarId}`);
	}

	protected async onTestConnection(): Promise<boolean> {
		try {
			const response = await this.makeCalendarRequest(
				"GET",
				`/calendars/${this.getCalendarSettings().calendarId}`,
			);
			return response.ok;
		} catch (error) {
			console.error("[CALENDAR] Connection test failed:", error);
			return false;
		}
	}

	protected async onHealthCheck(): Promise<boolean> {
		try {
			const response = await this.makeCalendarRequest(
				"GET",
				`/calendars/${this.getCalendarSettings().calendarId}`,
			);
			return response.ok;
		} catch (error) {
			console.error("[CALENDAR] Health check failed:", error);
			return false;
		}
	}

	protected async onSyncInbound(): Promise<ExternalTask[]> {
		// Calendar integration is primarily outbound (creating events from tasks)
		// Inbound sync could sync calendar events back to tasks
		console.log("[CALENDAR] Inbound sync not implemented for Calendar integration");
		return [];
	}

	protected async onSyncSingleTask(task: Task): Promise<{ created: boolean; updated: boolean }> {
		try {
			// Check if event already exists for this task
			const existingEvent = await this.findEventByTaskId(task.id);

			if (existingEvent) {
				// Update existing event
				await this.updateEvent(existingEvent.id, task);
				return { created: false, updated: true };
			} else {
				// Create new event
				await this.createEvent(task);
				return { created: true, updated: false };
			}
		} catch (error) {
			console.error(`[CALENDAR] Failed to sync task ${task.id}:`, error);
			throw error;
		}
	}

	protected async onCreateExternalTask(task: Task): Promise<ExternalTask> {
		const event = await this.createEvent(task);

		return this.createExternalTaskFromTask(task, event.id, event.htmlLink);
	}

	protected async onUpdateExternalTask(task: Task, externalId: string): Promise<ExternalTask> {
		const event = await this.updateEvent(externalId, task);

		return this.createExternalTaskFromTask(task, externalId, event.htmlLink);
	}

	protected async onDeleteExternalTask(externalId: string): Promise<void> {
		await this.deleteEvent(externalId);
	}

	protected async onHandleWebhook(payload: CalendarPayload): Promise<void> {
		// Handle Google Calendar push notifications
		const headers = payload.headers ?? {};
		const resourceState = headers?.["x-goog-resource-state"];
		const resourceId = headers?.["x-goog-resource-id"];

		console.log(`[CALENDAR] Processing webhook: ${resourceState} for resource ${resourceId}`);

		switch (resourceState) {
			case "exists":
				// Resource created or updated
				await this.handleEventChange(resourceId, "updated");
				break;
			case "sync":
				// Synchronization event
				console.log("[CALENDAR] Sync event received");
				break;
			case "deleted":
				// Resource deleted
				await this.handleEventChange(resourceId, "deleted");
				break;
		}
	}

	protected async onCleanup(): Promise<void> {
		this.accessToken = undefined;
	}

	// Google Calendar API methods
	private async makeCalendarRequest(
		method: string,
		path: string,
		body?: Record<string, unknown>,
	): Promise<Response> {
		const token = this.accessToken;
		if (!token) {
			throw new Error("Google Calendar access token not configured");
		}

		const url = `${this.apiUrl}${path}`;
		const headers: HeadersInit = {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		};

		const options: RequestInit = {
			method,
			headers,
		};

		if (body && (method === "POST" || method === "PATCH" || method === "PUT")) {
			options.body = JSON.stringify(body);
		}

		const response = await fetch(url, options);

		if (!response.ok && response.status === 401) {
			throw new Error("Google Calendar authentication failed. Check your access token.");
		}

		if (!response.ok && response.status === 403) {
			throw new Error("Google Calendar access forbidden. Check permissions.");
		}

		return response;
	}

	private async createEvent(task: Task): Promise<CalendarEvent> {
		const calendarSettings = this.getCalendarSettings();

		const eventData = this.buildEventFromTask(task, calendarSettings);

		const response = await this.makeCalendarRequest(
			"POST",
			`/calendars/${calendarSettings.calendarId}/events`,
			eventData,
		);

		if (!response.ok) {
			const error = await response.json();
			throw new Error(
				`Failed to create calendar event: ${error.error?.message || "Unknown error"}`,
			);
		}

		const event = await response.json();
		console.log(`[CALENDAR] Created event: ${event.id} for task: ${task.id}`);

		return event;
	}

	private async updateEvent(eventId: string, task: Task): Promise<CalendarEvent> {
		const calendarSettings = this.getCalendarSettings();

		const eventData = this.buildEventFromTask(task, calendarSettings);

		const response = await this.makeCalendarRequest(
			"PATCH",
			`/calendars/${calendarSettings.calendarId}/events/${eventId}`,
			eventData,
		);

		if (!response.ok) {
			const error = await response.json();
			throw new Error(
				`Failed to update calendar event: ${error.error?.message || "Unknown error"}`,
			);
		}

		const event = await response.json();
		console.log(`[CALENDAR] Updated event: ${event.id} for task: ${task.id}`);

		return event;
	}

	private async deleteEvent(eventId: string): Promise<void> {
		const calendarSettings = this.getCalendarSettings();

		const response = await this.makeCalendarRequest(
			"DELETE",
			`/calendars/${calendarSettings.calendarId}/events/${eventId}`,
		);

		if (!response.ok) {
			const error = await response.json();
			throw new Error(
				`Failed to delete calendar event: ${error.error?.message || "Unknown error"}`,
			);
		}

		console.log(`[CALENDAR] Deleted event: ${eventId}`);
	}

	private async findEventByTaskId(taskId: string): Promise<CalendarEvent | null> {
		const calendarSettings = this.getCalendarSettings();

		// Search for event with task ID in extended properties
		const query = `privateProperty=taskId=${taskId}`;
		const response = await this.makeCalendarRequest(
			"GET",
			`/calendars/${calendarSettings.calendarId}/events?q=${encodeURIComponent(query)}`,
		);

		if (!response.ok) {
			return null;
		}

		const data = await response.json();
		return data.items?.[0] || null;
	}

	private buildEventFromTask(
		task: Task,
		calendarSettings: CalendarSettings,
	): Record<string, unknown> {
		// Calculate event timing based on task
		const now = new Date();
		const startTime = task.status === "done" ? new Date(task.updatedAt) : now;
		const duration = calendarSettings.defaultDuration || 60; // Default 1 hour
		const endTime = new Date(startTime.getTime() + duration * 60 * 1000);

		const eventData: Record<string, unknown> = {
			summary: task.title,
			description: task.description,
			start: {
				dateTime: startTime.toISOString(),
				timeZone: calendarSettings.timezone || "UTC",
			},
			end: {
				dateTime: endTime.toISOString(),
				timeZone: calendarSettings.timezone || "UTC",
			},
			extendedProperties: {
				private: {
					taskId: task.id,
					taskStatus: task.status,
					taskPriority: task.priority,
				},
			},
		};

		// Add color based on priority
		eventData.colorId = this.getEventColor(task.priority);

		// Add reminders if configured
		if (calendarSettings.reminders && calendarSettings.reminders.length > 0) {
			eventData.reminders = {
				useDefault: false,
				overrides: calendarSettings.reminders.map((minutes) => ({
					method: "email",
					minutes: minutes,
				})),
			};
		}

		// Set visibility based on task status
		eventData.visibility = task.status === "done" ? "private" : "default";

		return eventData;
	}

	private getEventColor(priority: string): string {
		switch (priority) {
			case "high":
				return "11"; // Red
			case "medium":
				return "6"; // Orange
			case "low":
				return "10"; // Green
			default:
				return "1"; // Blue
		}
	}

	// Webhook handlers
	private async handleEventChange(
		resourceId: string,
		action: "updated" | "deleted",
	): Promise<void> {
		try {
			// Get event details
			const calendarSettings = this.getCalendarSettings();
			const response = await this.makeCalendarRequest(
				"GET",
				`/calendars/${calendarSettings.calendarId}/events/${resourceId}`,
			);

			if (!response.ok) {
				console.error(`[CALENDAR] Failed to get event ${resourceId}`);
				return;
			}

			const event = await response.json();
			const taskId = event.extendedProperties?.private?.taskId;

			if (!taskId) {
				console.log(`[CALENDAR] Event ${resourceId} has no task ID, skipping`);
				return;
			}

			console.log(`[CALENDAR] Event ${action} for task: ${taskId}`);

			// This would emit events to update the corresponding task
			// Implementation would depend on event system integration
			if (action === "deleted") {
				// Handle event deletion - maybe mark task as cancelled or remove deadline
				console.log(`[CALENDAR] Calendar event deleted for task: ${taskId}`);
			} else {
				// Handle event update - maybe update task deadline or status
				console.log(`[CALENDAR] Calendar event updated for task: ${taskId}`);
			}
		} catch (error) {
			console.error(`[CALENDAR] Failed to handle event change for ${resourceId}:`, error);
		}
	}

	protected async getMetrics(): Promise<IntegrationHealth["metrics"]> {
		// For now we expose basic sync counters; calendar adapter does not yet track them
		return {
			syncsCompleted: 0,
			syncsFailed: 0,
			averageSyncTime: 0,
			lastSyncDuration: 0,
		};
	}

	private getCalendarSettings(): CalendarSettings {
		if (!this.config || !this.config.settings.calendar) {
			throw new Error("Calendar integration not configured");
		}
		return this.config.settings.calendar;
	}
}
