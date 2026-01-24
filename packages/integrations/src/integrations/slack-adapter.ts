import type { Task } from "@isomorphiq/tasks";
import { BaseIntegrationAdapter } from "./base-adapter.ts";
import type { ExternalTask, IntegrationHealth, IntegrationSettings } from "./types.ts";

type SlackSettings = NonNullable<IntegrationSettings["slack"]>;
type SlackWebhookEvent = {
	type?: string;
	event?: Record<string, unknown>;
	challenge?: string;
	token?: string;
	team_id?: string;
	api_app_id?: string;
};

/**
 * Slack integration adapter
 */
export class SlackIntegration extends BaseIntegrationAdapter {
	private apiUrl = "https://slack.com/api";
	private botToken?: string;

	constructor() {
		super("slack", "Slack");
	}

	protected async onInitialize(): Promise<void> {
		if (!this.config) {
			throw new Error("Slack integration not configured");
		}

		// Validate Slack-specific settings
		const slackSettings = this.config.settings.slack;
		if (!slackSettings?.workspace) {
			throw new Error("Slack workspace is required");
		}

		// Set bot token
		this.botToken = this.config.credentials.accessToken;

		// Test connection
		const isConnected = await this.onTestConnection();
		if (!isConnected) {
			throw new Error("Failed to connect to Slack API");
		}

		console.log(`[SLACK] Initialized for workspace: ${slackSettings.workspace}`);
	}

	protected async onTestConnection(): Promise<boolean> {
		try {
			const response = await this.makeSlackRequest("GET", "/auth.test");
			const data = await response.json();
			return data.ok;
		} catch (error) {
			console.error("[SLACK] Connection test failed:", error);
			return false;
		}
	}

	protected async onHealthCheck(): Promise<boolean> {
		try {
			const response = await this.makeSlackRequest("GET", "/auth.test");
			const data = await response.json();
			return data.ok;
		} catch (error) {
			console.error("[SLACK] Health check failed:", error);
			return false;
		}
	}

	protected async onSyncInbound(): Promise<ExternalTask[]> {
		// Slack doesn't have traditional "tasks" to sync inbound
		// This could be used to sync messages from a specific channel
		// or to process task creation commands from Slack
		console.log("[SLACK] Inbound sync not implemented for Slack integration");
		return [];
	}

	protected async onSyncSingleTask(task: Task): Promise<{ created: boolean; updated: boolean }> {
		const slackSettings = this.getSlackSettings();

		try {
			// Send notification about task to Slack
			if (slackSettings.notifyChannel) {
				await this.sendTaskNotification(task, slackSettings.notifyChannel);
			}

			// For Slack, we don't create external tasks in the traditional sense
			// We just send notifications and handle commands
			return { created: false, updated: false };
		} catch (error) {
			console.error(`[SLACK] Failed to sync task ${task.id}:`, error);
			throw error;
		}
	}

	protected async onCreateExternalTask(task: Task): Promise<ExternalTask> {
		// Send notification about new task
		const slackSettings = this.getSlackSettings();
		if (slackSettings.notifyChannel && slackSettings.notifyOnTaskCreated) {
			await this.sendTaskNotification(task, slackSettings.notifyChannel, "created");
		}

		// Return a minimal external task representation
		return this.createExternalTaskFromTask(task, `slack-${task.id}`);
	}

	protected async onUpdateExternalTask(task: Task, externalId: string): Promise<ExternalTask> {
		// Send notification about task update
		const slackSettings = this.getSlackSettings();
		if (slackSettings.notifyChannel) {
			await this.sendTaskNotification(task, slackSettings.notifyChannel, "updated");
		}

		return this.createExternalTaskFromTask(task, externalId);
	}

	protected async onDeleteExternalTask(externalId: string): Promise<void> {
		// Send notification about task deletion
		const slackSettings = this.getSlackSettings();
		if (slackSettings.notifyChannel) {
			await this.sendMessage(
				slackSettings.notifyChannel,
				`Task ${externalId.replace("slack-", "")} has been deleted.`,
			);
		}
	}

	protected async onHandleWebhook(payload: Record<string, unknown>): Promise<void> {
		const webhook = payload as SlackWebhookEvent;
		const type = webhook.type;
		const event = webhook.event;

		console.log(`[SLACK] Processing webhook event: ${type}`);

		switch (type) {
				case "url_verification":
					await this.handleUrlVerification();
				break;
			case "event_callback":
				await this.handleEventCallback(event);
				break;
			default:
				console.log(`[SLACK] Unhandled webhook event: ${type}`);
		}
	}

	protected async onCleanup(): Promise<void> {
		this.botToken = undefined;
	}

	// Slack API methods
	private async makeSlackRequest(
		method: string,
		path: string,
		body?: Record<string, unknown>,
	): Promise<Response> {
		const token = this.botToken;
		if (!token) {
			throw new Error("Slack bot token not configured");
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

		if (!response.ok) {
			const error = await response.json();
			throw new Error(`Slack API error: ${error.error}`);
		}

		return response;
	}

	private async sendMessage(
		channel: string,
		text: string,
		blocks?: Array<Record<string, unknown>>,
	): Promise<void> {
		const payload: Record<string, unknown> = {
			channel,
			text,
		};

		if (blocks) {
			payload.blocks = blocks;
		}

		const response = await this.makeSlackRequest("POST", "/chat.postMessage", payload);
		const data = await response.json();

		if (!data.ok) {
			throw new Error(`Failed to send Slack message: ${data.error}`);
		}

		console.log(`[SLACK] Message sent to channel ${channel}`);
	}

	private async sendTaskNotification(
		task: Task,
		channel: string,
		action: "created" | "updated" | "completed" = "updated",
	): Promise<void> {
		const slackSettings = this.getSlackSettings();
		const userMapping = slackSettings.userMapping || {};

		// Map user ID to Slack username if available
		const assignedTo = task.assignedTo
			? userMapping[task.assignedTo] || task.assignedTo
			: "Unassigned";

		const actionText =
			action === "created" ? "Created" : action === "completed" ? "Completed" : "Updated";

		const blocks = [
			{
				type: "section",
				text: {
					type: "mrkdwn",
					text: `*${actionText} Task:* ${task.title}`,
				},
			},
			{
				type: "section",
				fields: [
					{
						type: "mrkdwn",
						text: `*Status:*\n${task.status}`,
					},
					{
						type: "mrkdwn",
						text: `*Priority:*\n${task.priority}`,
					},
					{
						type: "mrkdwn",
						text: `*Assigned To:*\n${assignedTo}`,
					},
					{
						type: "mrkdwn",
						text: `*Created By:*\n${task.createdBy}`,
					},
				],
			},
			{
				type: "section",
				text: {
					type: "mrkdwn",
					text: `*Description:*\n${task.description.substring(0, 200)}${task.description.length > 200 ? "..." : ""}`,
				},
			},
		];

		await this.sendMessage(channel, `${actionText} task: ${task.title}`, blocks);
	}

	private getStatusColor(status: string): string {
		switch (status) {
			case "todo":
				return "#808080"; // Gray
			case "in-progress":
				return "#0066cc"; // Blue
			case "done":
				return "#36a64f"; // Green
			default:
				return "#808080"; // Gray
		}
	}

	// Webhook handlers
	private async handleUrlVerification(): Promise<void> {
		console.log("[SLACK] Handling URL verification");
		// This would return the challenge in a real webhook implementation
		// For now, we just log it
	}

	private async handleEventCallback(event: Record<string, unknown> | undefined): Promise<void> {
		const eventType = event?.type as string | undefined;
		console.log(`[SLACK] Processing event: ${eventType}`);

		switch (eventType) {
			case "message":
				await this.handleMessageEvent(event);
				break;
			case "app_mention":
				await this.handleAppMentionEvent(event);
				break;
			default:
				console.log(`[SLACK] Unhandled event type: ${eventType}`);
		}
	}

	private async handleMessageEvent(event: Record<string, unknown>): Promise<void> {
		// Skip bot messages
		if ((event as { bot_id?: string }).bot_id || event.subtype === "bot_message") {
			return;
		}

		const slackSettings = this.getSlackSettings();

		// Check if this is a command message
		if (
			slackSettings.allowCommands &&
			typeof event.text === "string" &&
			event.text.startsWith(slackSettings.commandPrefix)
		) {
			await this.handleCommand(event);
		}
	}

	private async handleAppMentionEvent(event: Record<string, unknown>): Promise<void> {
		const slackSettings = this.getSlackSettings();

		// Handle mentions of the bot
		if (slackSettings.allowCommands) {
			await this.handleCommand(event);
		}
	}

	private async handleCommand(event: Record<string, unknown>): Promise<void> {
		const slackSettings = this.getSlackSettings();
		const text = typeof event.text === "string" ? event.text : "";
		const prefix = slackSettings.commandPrefix;

		if (!text.startsWith(prefix)) {
			return;
		}

		const command = text.substring(prefix.length).trim().toLowerCase();
		const channel = typeof event.channel === "string" ? event.channel : "";

		console.log(`[SLACK] Processing command: ${command}`);

		// Handle different commands
		switch (command) {
			case "help":
				await this.sendHelpMessage(channel);
				break;
			case "tasks":
				await this.sendTasksList(channel);
				break;
			case "status":
				await this.sendStatusMessage(channel);
				break;
			default:
				await this.sendMessage(
					channel,
					`Unknown command: ${command}. Type \`${prefix}help\` for available commands.`,
				);
		}
	}

	private async sendHelpMessage(channel: string): Promise<void> {
		const slackSettings = this.getSlackSettings();
		const prefix = slackSettings.commandPrefix;

		const helpText = `
*Available Commands:*
\`${prefix}help\` - Show this help message
\`${prefix}tasks\` - List recent tasks
\`${prefix}status\` - Show integration status

*Task Management:*
You can create tasks by mentioning me with a task description.
Example: \`@bot Create a new feature for user authentication\`
		`.trim();

		await this.sendMessage(channel, helpText);
	}

	private async sendTasksList(channel: string): Promise<void> {
		// This would fetch recent tasks and send them to the channel
		// For now, we'll send a placeholder message
		await this.sendMessage(
			channel,
			"Recent tasks feature coming soon! This will show a list of recent tasks.",
		);
	}

	private async sendStatusMessage(channel: string): Promise<void> {
		const health = await this.healthCheck();

		const statusText =
			health.status === "connected"
				? "✅ Slack integration is working properly"
				: "❌ Slack integration has issues";

		await this.sendMessage(channel, statusText);
	}

	private getSlackSettings(): SlackSettings {
		if (!this.config?.settings.slack) {
			throw new Error("Slack integration not configured");
		}
		return this.config.settings.slack;
	}

	protected async getMetrics(): Promise<IntegrationHealth["metrics"]> {
		// Slack adapter currently does not capture sync metrics; return baseline values.
		return {
			syncsCompleted: 0,
			syncsFailed: 0,
			averageSyncTime: 0,
			lastSyncDuration: 0,
		};
	}
}
