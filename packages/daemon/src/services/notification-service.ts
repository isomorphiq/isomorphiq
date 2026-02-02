// TODO: This file is too complex (1094 lines) and should be refactored into several modules.
// Current concerns mixed: Multi-channel notifications (email, SMS, Slack, Teams, webhook),
// notification preferences, digest generation, rate limiting, template management.
// 
// Proposed structure:
// - notifications/channels/ - Individual channel implementations
//   - email-provider.ts, sms-provider.ts, slack-provider.ts, teams-provider.ts, webhook-provider.ts
// - notifications/notification-service.ts - Core notification orchestration
// - notifications/preference-service.ts - User notification preferences management
// - notifications/digest-service.ts - Digest generation and scheduling
// - notifications/template-service.ts - Notification template management
// - notifications/rate-limiter.ts - Rate limiting and throttling
// - notifications/types.ts - Notification-specific types and interfaces

import { EventEmitter } from "node:events";
import type { Task } from "@isomorphiq/tasks";
import type { Result } from "@isomorphiq/core";

// Notification channel types
export type NotificationChannel = "email" | "sms" | "slack" | "teams" | "websocket" | "webhook";

// Notification priority levels
export type NotificationPriority = "low" | "medium" | "high" | "urgent";

// Notification event types
export type NotificationEventType = 
    | "task_created"
    | "task_assigned" 
    | "task_status_changed"
    | "task_priority_changed"
    | "task_completed"
    | "task_failed"
    | "task_cancelled"
    | "deadline_approaching"
    | "dependency_satisfied"
    | "dependency_blocked"
    | "dependency_cycle_detected"
    | "critical_path_delay"
    | "bottleneck_identified"
    | "dependency_validation_failed"
    | "mention"
    | "digest";

// User notification preferences
export interface NotificationPreferences {
    userId: string;
    enabled: boolean;
    channels: {
        email: {
            enabled: boolean;
            address: string;
            events: NotificationEventType[];
        };
        sms: {
            enabled: boolean;
            phoneNumber: string;
            events: NotificationEventType[];
        };
        slack: {
            enabled: boolean;
            webhookUrl: string;
            channel: string;
            events: NotificationEventType[];
        };
        teams: {
            enabled: boolean;
            webhookUrl: string;
            events: NotificationEventType[];
        };
        websocket: {
            enabled: boolean;
            events: NotificationEventType[];
        };
        webhook: {
            enabled: boolean;
            url: string;
            events: NotificationEventType[];
        };
    };
    quietHours?: {
        start: string; // HH:mm format
        end: string;   // HH:mm format
        timezone: string;
    };
    frequency: {
        immediate: NotificationEventType[];
        hourly: NotificationEventType[];
        daily: NotificationEventType[];
        weekly: NotificationEventType[];
    };
}

// Notification data structure
export interface NotificationData {
    id: string;
    type: NotificationEventType;
    priority: NotificationPriority;
    title: string;
    message: string;
    data?: Record<string, any>; // Additional context data
    recipients: string[]; // User IDs
    channels: NotificationChannel[];
    timestamp: Date;
    metadata?: {
        taskId?: string;
        mentionedUsers?: string[];
        deadline?: Date;
        oldStatus?: string;
        newStatus?: string;
        oldPriority?: string;
        newPriority?: string;
        // Dependency-specific metadata
        dependentTaskId?: string;
        blockers?: string[];
        cycle?: string[];
        delayAmount?: number;
        impactCount?: number;
        validationErrors?: string[];
    };
}

// Notification template
export interface NotificationTemplate {
    type: NotificationEventType;
    subject: string;
    body: string;
    variables: string[];
    channels: NotificationChannel[];
}

// Delivery result
export interface DeliveryResult {
    channel: NotificationChannel;
    recipient: string;
    success: boolean;
    error?: string;
    timestamp: Date;
    messageId?: string;
}

// Notification history entry
export interface NotificationHistory {
    id: string;
    notificationId: string;
    userId: string;
    channel: NotificationChannel;
    type: NotificationEventType;
    delivered: boolean;
    read: boolean;
    timestamp: Date;
    error?: string;
}

// Email provider interface
export interface EmailProvider {
    sendEmail(to: string, subject: string, body: string, options?: any): Promise<Result<{ messageId: string }>>;
}

// SMS provider interface  
export interface SMSProvider {
    sendSMS(to: string, message: string, options?: any): Promise<Result<{ messageId: string }>>;
}

// Slack provider interface
export interface SlackProvider {
    sendMessage(webhookUrl: string, channel: string, message: string, options?: any): Promise<Result<{ messageId: string }>>;
}

// Teams provider interface
export interface TeamsProvider {
    sendMessage(webhookUrl: string, message: string, options?: any): Promise<Result<{ messageId: string }>>;
}

/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class NotificationService extends EventEmitter {
    private preferences: Map<string, NotificationPreferences> = new Map();
    private templates: Map<NotificationEventType, NotificationTemplate> = new Map();
    private history: NotificationHistory[] = [];
    private queue: NotificationData[] = [];
    private processing = false;

    // Provider instances
    private emailProvider?: EmailProvider;
    private smsProvider?: SMSProvider;
    private slackProvider?: SlackProvider;
    private teamsProvider?: TeamsProvider;

    // Configuration
    private config: {
        maxRetries: number;
        retryDelay: number;
        batchSize: number;
        quietHoursEnforced: boolean;
        rateLimiting: {
            enabled: boolean;
            maxPerMinute: number;
            maxPerHour: number;
        };
    };

    constructor(config?: Partial<typeof NotificationService.prototype.config>) {
        super();
        
        this.config = {
            maxRetries: 3,
            retryDelay: 5000,
            batchSize: 10,
            quietHoursEnforced: true,
            rateLimiting: {
                enabled: true,
                maxPerMinute: 60,
                maxPerHour: 1000
            },
            ...config
        };

        this.initializeDefaultTemplates();
        this.startProcessingLoop();
    }

    // Set providers
    public setEmailProvider(provider: EmailProvider): void {
        this.emailProvider = provider;
    }

    public setSMSProvider(provider: SMSProvider): void {
        this.smsProvider = provider;
    }

    public setSlackProvider(provider: SlackProvider): void {
        this.slackProvider = provider;
    }

    public setTeamsProvider(provider: TeamsProvider): void {
        this.teamsProvider = provider;
    }

    // User preferences management
    public setUserPreferences(preferences: NotificationPreferences): void {
        this.preferences.set(preferences.userId, preferences);
        this.emit("preferences_updated", preferences);
    }

    public getUserPreferences(userId: string): NotificationPreferences | null {
        return this.preferences.get(userId) || null;
    }

    public getAllUserPreferences(): NotificationPreferences[] {
        return Array.from(this.preferences.values());
    }

    // Template management
    public setTemplate(template: NotificationTemplate): void {
        this.templates.set(template.type, template);
    }

    public getTemplate(type: NotificationEventType): NotificationTemplate | null {
        return this.templates.get(type) || null;
    }

    // Core notification methods
    public async sendNotification(notification: Omit<NotificationData, "id" | "timestamp">): Promise<Result<string>> {
        const fullNotification: NotificationData = {
            ...notification,
            id: this.generateNotificationId(),
            timestamp: new Date()
        };

        // Add to queue
        this.queue.push(fullNotification);
        
        // Emit notification queued event
        this.emit("notification_queued", fullNotification);
        
        return { success: true, data: fullNotification.id };
    }

    // Task-specific notification methods
    public async notifyTaskCreated(task: Task, recipients: string[]): Promise<Result<string>> {
        const template = this.getTemplate("task_created");
        if (!template) {
            return { success: false, error: new Error("Template not found for task_created") };
        }

        const notification = this.buildNotificationFromTemplate(template, {
            task,
            recipients,
            priority: this.mapPriority(task.priority),
            metadata: { taskId: task.id }
        });

        return this.sendNotification(notification);
    }

    public async notifyTaskAssigned(task: Task, assignee: string): Promise<Result<string>> {
        const template = this.getTemplate("task_assigned");
        if (!template) {
            return { success: false, error: new Error("Template not found for task_assigned") };
        }

        const notification = this.buildNotificationFromTemplate(template, {
            task,
            recipients: [assignee],
            priority: this.mapPriority(task.priority),
            metadata: { taskId: task.id }
        });

        return this.sendNotification(notification);
    }

    public async notifyTaskStatusChanged(task: Task, oldStatus: string, newStatus: string, recipients: string[]): Promise<Result<string>> {
        const template = this.getTemplate("task_status_changed");
        if (!template) {
            return { success: false, error: new Error("Template not found for task_status_changed") };
        }

        const notification = this.buildNotificationFromTemplate(template, {
            task,
            recipients,
            priority: this.mapPriority(task.priority),
            metadata: { 
                taskId: task.id, 
                oldStatus, 
                newStatus 
            }
        });

        return this.sendNotification(notification);
    }

    public async notifyTaskCompleted(task: Task, recipients: string[]): Promise<Result<string>> {
        const template = this.getTemplate("task_completed");
        if (!template) {
            return { success: false, error: new Error("Template not found for task_completed") };
        }

        const notification = this.buildNotificationFromTemplate(template, {
            task,
            recipients,
            priority: this.mapPriority(task.priority),
            metadata: { taskId: task.id }
        });

        return this.sendNotification(notification);
    }

    public async notifyTaskFailed(task: Task, error: string, recipients: string[]): Promise<Result<string>> {
        const template = this.getTemplate("task_failed");
        if (!template) {
            return { success: false, error: new Error("Template not found for task_failed") };
        }

        const notification = this.buildNotificationFromTemplate(template, {
            task,
            recipients,
            priority: "high",
            metadata: { taskId: task.id }
        });

        notification.data = { ...notification.data, error };

        return this.sendNotification(notification);
    }

    public async notifyDeadlineApproaching(task: Task, recipients: string[]): Promise<Result<string>> {
        const template = this.getTemplate("deadline_approaching");
        if (!template) {
            return { success: false, error: new Error("Template not found for deadline_approaching") };
        }

        const notification = this.buildNotificationFromTemplate(template, {
            task,
            recipients,
            priority: "high",
            metadata: { 
                taskId: task.id,
                deadline: task.updatedAt // This should be actual deadline from task
            }
        });

        return this.sendNotification(notification);
    }

    public async notifyMention(task: Task, mentionedUsers: string[], mentionedBy: string): Promise<Result<string>> {
        const template = this.getTemplate("mention");
        if (!template) {
            return { success: false, error: new Error("Template not found for mention") };
        }

        const notification = this.buildNotificationFromTemplate(template, {
            task,
            recipients: mentionedUsers,
            priority: "medium",
            metadata: { 
                taskId: task.id,
                mentionedUsers,
                mentionedBy
            }
        });

return this.sendNotification(notification);
	}

	// Dependency-specific notification methods
	public async notifyDependencySatisfied(taskId: string, dependentTaskId: string, recipients: string[]): Promise<Result<string>> {
		const notification = {
			type: "dependency_satisfied" as NotificationEventType,
			priority: "medium" as NotificationPriority,
			title: "Dependency Satisfied",
			message: `Dependency ${taskId} has been satisfied for task ${dependentTaskId}`,
			recipients,
			channels: ["email", "slack", "teams", "websocket"] as NotificationChannel[],
			metadata: { taskId, dependentTaskId }
		};

		return this.sendNotification(notification);
	}

	public async notifyDependencyBlocked(taskId: string, blockers: string[], recipients: string[]): Promise<Result<string>> {
		const notification = {
			type: "dependency_blocked" as NotificationEventType,
			priority: "high" as NotificationPriority,
			title: "Task Blocked by Dependencies",
			message: `Task ${taskId} is blocked by ${blockers.length} unresolved dependencies: ${blockers.join(", ")}`,
			recipients,
			channels: ["email", "slack", "teams", "websocket"] as NotificationChannel[],
			metadata: { taskId, blockers }
		};

		return this.sendNotification(notification);
	}

	public async notifyDependencyCycleDetected(cycle: string[], recipients: string[]): Promise<Result<string>> {
		const notification = {
			type: "dependency_cycle_detected" as NotificationEventType,
			priority: "urgent" as NotificationPriority,
			title: "Circular Dependency Detected",
			message: `Circular dependency detected in tasks: ${cycle.join(" → ")}`,
			recipients,
			channels: ["email", "slack", "teams", "websocket"] as NotificationChannel[],
			metadata: { cycle }
		};

		return this.sendNotification(notification);
	}

	public async notifyCriticalPathDelay(taskId: string, delayAmount: number, recipients: string[]): Promise<Result<string>> {
		const notification = {
			type: "critical_path_delay" as NotificationEventType,
			priority: "high" as NotificationPriority,
			title: "Critical Path Delay",
			message: `Task ${taskId} on critical path is delayed by ${delayAmount} units`,
			recipients,
			channels: ["email", "slack", "teams", "websocket"] as NotificationChannel[],
			metadata: { taskId, delayAmount }
		};

		return this.sendNotification(notification);
	}

	public async notifyBottleneckIdentified(taskId: string, impactCount: number, recipients: string[]): Promise<Result<string>> {
		const notification = {
			type: "bottleneck_identified" as NotificationEventType,
			priority: "medium" as NotificationPriority,
			title: "Dependency Bottleneck Identified",
			message: `Task ${taskId} is blocking ${impactCount} other tasks`,
			recipients,
			channels: ["email", "slack", "teams", "websocket"] as NotificationChannel[],
			metadata: { taskId, impactCount }
		};

		return this.sendNotification(notification);
	}

	public async notifyDependencyValidationFailed(taskId: string, errors: string[], recipients: string[]): Promise<Result<string>> {
		const notification = {
			type: "dependency_validation_failed" as NotificationEventType,
			priority: "high" as NotificationPriority,
			title: "Dependency Validation Failed",
			message: `Task ${taskId} has dependency validation errors: ${errors.join(", ")}`,
			recipients,
			channels: ["email", "slack", "teams", "websocket"] as NotificationChannel[],
			metadata: { taskId, validationErrors: errors }
		};

		return this.sendNotification(notification);
	}

	// Digest notifications
    public async sendDailyDigest(userId: string, tasks: Task[]): Promise<Result<string>> {
        const template = this.getTemplate("digest");
        if (!template) {
            return { success: false, error: new Error("Template not found for digest") };
        }

        const notification = this.buildNotificationFromTemplate(template, {
            task: null,
            recipients: [userId],
            priority: "low",
            type: "digest",
            data: { 
                tasks,
                digestType: "daily",
                date: new Date().toISOString()
            }
        });

        return this.sendNotification(notification);
    }

    public async sendWeeklyDigest(userId: string, tasks: Task[]): Promise<Result<string>> {
        const template = this.getTemplate("digest");
        if (!template) {
            return { success: false, error: new Error("Template not found for digest") };
        }

        const notification = this.buildNotificationFromTemplate(template, {
            task: null,
            recipients: [userId],
            priority: "low",
            type: "digest",
            data: { 
                tasks,
                digestType: "weekly",
                date: new Date().toISOString()
            }
        });

        return this.sendNotification(notification);
    }

    // History and management
    public getNotificationHistory(userId?: string, limit?: number): NotificationHistory[] {
        let history = this.history;
        
        if (userId) {
            history = history.filter(entry => entry.userId === userId);
        }
        
        return history
            .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
            .slice(0, limit || 100);
    }

    public markNotificationAsRead(notificationId: string, userId: string): boolean {
        const entry = this.history.find(h => h.notificationId === notificationId && h.userId === userId);
        if (entry) {
            entry.read = true;
            this.emit("notification_read", entry);
            return true;
        }
        return false;
    }

    public getNotificationStats(userId?: string): {
        total: number;
        delivered: number;
        failed: number;
        read: number;
        byChannel: Record<NotificationChannel, number>;
        byType: Record<NotificationEventType, number>;
    } {
        let history = this.history;
        
        if (userId) {
            history = history.filter(entry => entry.userId === userId);
        }

        const stats = {
            total: history.length,
            delivered: history.filter(h => h.delivered).length,
            failed: history.filter(h => !h.delivered).length,
            read: history.filter(h => h.read).length,
            byChannel: {} as Record<NotificationChannel, number>,
            byType: {} as Record<NotificationEventType, number>
        };

        for (const entry of history) {
            stats.byChannel[entry.channel] = (stats.byChannel[entry.channel] || 0) + 1;
            stats.byType[entry.type] = (stats.byType[entry.type] || 0) + 1;
        }

        return stats;
    }

    // Private methods
    private buildNotificationFromTemplate(template: NotificationTemplate, data: {
        task: Task | null;
        recipients: string[];
        priority: NotificationPriority;
        type?: NotificationEventType;
        metadata?: any;
        data?: any;
    }): Omit<NotificationData, "id" | "timestamp"> {
        const variables: Record<string, string> = {};
        
        if (data.task) {
            variables.taskId = data.task.id;
            variables.taskTitle = data.task.title;
            variables.taskDescription = data.task.description;
            variables.taskStatus = data.task.status;
            variables.taskPriority = data.task.priority;
            variables.taskCreatedBy = data.task.createdBy || "Unknown";
            variables.taskAssignedTo = data.task.assignedTo || "Unassigned";
            variables.taskCreatedAt = new Date(data.task.createdAt).toLocaleString();
            variables.taskUpdatedAt = new Date(data.task.updatedAt).toLocaleString();
        }

        // Handle digest-specific variables
        if (data.data) {
            if (data.data.digestType) {
                variables.digestType = data.data.digestType;
            }
            if (data.data.date) {
                variables.date = new Date(data.data.date).toLocaleDateString();
            }
            if (data.data.tasks && Array.isArray(data.data.tasks)) {
                variables.taskCount = data.data.tasks.length.toString();
            }
        }

        const title = this.replaceVariables(template.subject, variables);
        const message = this.replaceVariables(template.body, variables);

        return {
            type: data.type || template.type,
            priority: data.priority,
            title,
            message,
            data: data.data,
            recipients: data.recipients,
            channels: template.channels,
            metadata: data.metadata
        };
    }

    private replaceVariables(template: string, variables: Record<string, string>): string {
        let result = template;
        for (const [key, value] of Object.entries(variables)) {
            result = result.replace(new RegExp(`{{${key}}}`, "g"), value);
        }
        return result;
    }

    private mapPriority(taskPriority: string): NotificationPriority {
        switch (taskPriority) {
            case "high": return "high";
            case "medium": return "medium";
            case "low": return "low";
            default: return "medium";
        }
    }

    private generateNotificationId(): string {
        return `notif_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    }

    private startProcessingLoop(): void {
        const interval = setInterval(async () => {
            if (!this.processing && this.queue.length > 0) {
                this.processing = true;
                await this.processQueue();
                this.processing = false;
            }
        }, 1000);
        interval.unref();
    }

    private async processQueue(): Promise<void> {
        const batch = this.queue.splice(0, this.config.batchSize);
        
        for (const notification of batch) {
            await this.processNotification(notification);
        }
    }

    private async processNotification(notification: NotificationData): Promise<void> {
        const results: DeliveryResult[] = [];

        for (const recipientId of notification.recipients) {
            const preferences = this.getUserPreferences(recipientId);
            
            if (!preferences || !preferences.enabled) {
                continue;
            }

            // Check quiet hours
            if (this.config.quietHoursEnforced && this.isInQuietHours(preferences)) {
                continue;
            }

            // Determine which channels to use for this recipient
            const channels = this.getChannelsForUser(preferences, notification);
            
            for (const channel of channels) {
                try {
                    const result = await this.deliverNotification(channel, recipientId, notification);
                    results.push(result);
                    
                    // Add to history
                    this.history.push({
                        id: this.generateNotificationId(),
                        notificationId: notification.id,
                        userId: recipientId,
                        channel,
                        type: notification.type,
                        delivered: result.success,
                        read: false,
                        timestamp: new Date(),
                        error: result.error
                    });

                } catch (error) {
                    results.push({
                        channel,
                        recipient: recipientId,
                        success: false,
                        error: error instanceof Error ? error.message : "Unknown error",
                        timestamp: new Date()
                    });
                }
            }
        }

        // Emit processing complete event
        this.emit("notification_processed", notification, results);
    }

    private getChannelsForUser(preferences: NotificationPreferences, notification: NotificationData): NotificationChannel[] {
        const channels: NotificationChannel[] = [];
        
        // Check each channel
        if (preferences.channels.email.enabled && preferences.channels.email.events.includes(notification.type)) {
            channels.push("email");
        }
        
        if (preferences.channels.sms.enabled && preferences.channels.sms.events.includes(notification.type)) {
            channels.push("sms");
        }
        
        if (preferences.channels.slack.enabled && preferences.channels.slack.events.includes(notification.type)) {
            channels.push("slack");
        }
        
        if (preferences.channels.teams.enabled && preferences.channels.teams.events.includes(notification.type)) {
            channels.push("teams");
        }
        
        if (preferences.channels.websocket.enabled && preferences.channels.websocket.events.includes(notification.type)) {
            channels.push("websocket");
        }
        
        if (preferences.channels.webhook.enabled && preferences.channels.webhook.events.includes(notification.type)) {
            channels.push("webhook");
        }
        
        return channels;
    }

    private isInQuietHours(preferences: NotificationPreferences): boolean {
        if (!preferences.quietHours) {
            return false;
        }

        const now = new Date();
        const currentTime = now.getHours() * 60 + now.getMinutes();
        
        const [startHour, startMin] = preferences.quietHours.start.split(":").map(Number);
        const [endHour, endMin] = preferences.quietHours.end.split(":").map(Number);
        
        const startTime = startHour * 60 + startMin;
        const endTime = endHour * 60 + endMin;
        
        if (startTime <= endTime) {
            return currentTime >= startTime && currentTime <= endTime;
        } else {
            // Overnight quiet hours (e.g., 22:00 to 06:00)
            return currentTime >= startTime || currentTime <= endTime;
        }
    }

    private async deliverNotification(channel: NotificationChannel, recipientId: string, notification: NotificationData): Promise<DeliveryResult> {
        const preferences = this.getUserPreferences(recipientId);
        if (!preferences) {
            throw new Error("User preferences not found");
        }

        switch (channel) {
            case "email":
                return this.deliverEmail(recipientId, notification, preferences);
            case "sms":
                return this.deliverSMS(recipientId, notification, preferences);
            case "slack":
                return this.deliverSlack(recipientId, notification, preferences);
            case "teams":
                return this.deliverTeams(recipientId, notification, preferences);
            case "websocket":
                return this.deliverWebSocket(recipientId, notification);
            case "webhook":
                return this.deliverWebhook(recipientId, notification, preferences);
            default:
                throw new Error(`Unsupported channel: ${channel}`);
        }
    }

    private async deliverEmail(recipientId: string, notification: NotificationData, preferences: NotificationPreferences): Promise<DeliveryResult> {
        if (!this.emailProvider) {
            return {
                channel: "email",
                recipient: recipientId,
                success: false,
                error: "Email provider not configured",
                timestamp: new Date()
            };
        }

        const emailConfig = preferences.channels.email;
        const result = await this.emailProvider.sendEmail(
            emailConfig.address,
            notification.title,
            notification.message,
            {
                html: true,
                priority: notification.priority,
                metadata: notification.metadata
            }
        );

        return {
            channel: "email",
            recipient: recipientId,
            success: result.success,
            error: result.error?.message,
            timestamp: new Date(),
            messageId: result.success ? (result.data as any).messageId : undefined
        };
    }

    private async deliverSMS(recipientId: string, notification: NotificationData, preferences: NotificationPreferences): Promise<DeliveryResult> {
        if (!this.smsProvider) {
            return {
                channel: "sms",
                recipient: recipientId,
                success: false,
                error: "SMS provider not configured",
                timestamp: new Date()
            };
        }

        const smsConfig = preferences.channels.sms;
        const result = await this.smsProvider.sendSMS(
            smsConfig.phoneNumber,
            `${notification.title}: ${notification.message}`,
            {
                priority: notification.priority
            }
        );

        return {
            channel: "sms",
            recipient: recipientId,
            success: result.success,
            error: result.error?.message,
            timestamp: new Date(),
            messageId: result.success ? (result.data as any).messageId : undefined
        };
    }

    private async deliverSlack(recipientId: string, notification: NotificationData, preferences: NotificationPreferences): Promise<DeliveryResult> {
        if (!this.slackProvider) {
            return {
                channel: "slack",
                recipient: recipientId,
                success: false,
                error: "Slack provider not configured",
                timestamp: new Date()
            };
        }

        const slackConfig = preferences.channels.slack;
        const message = this.formatSlackMessage(notification);
        
        const result = await this.slackProvider.sendMessage(
            slackConfig.webhookUrl,
            slackConfig.channel,
            message,
            {
                username: "Task Manager",
                icon_emoji: ":clipboard:",
                priority: notification.priority
            }
        );

        return {
            channel: "slack",
            recipient: recipientId,
            success: result.success,
            error: result.error?.message,
            timestamp: new Date(),
            messageId: result.success ? (result.data as any).messageId : undefined
        };
    }

    private async deliverTeams(recipientId: string, notification: NotificationData, preferences: NotificationPreferences): Promise<DeliveryResult> {
        if (!this.teamsProvider) {
            return {
                channel: "teams",
                recipient: recipientId,
                success: false,
                error: "Teams provider not configured",
                timestamp: new Date()
            };
        }

        const teamsConfig = preferences.channels.teams;
        const message = this.formatTeamsMessage(notification);
        
        const result = await this.teamsProvider.sendMessage(
            teamsConfig.webhookUrl,
            message,
            {
                title: notification.title,
                priority: notification.priority
            }
        );

        return {
            channel: "teams",
            recipient: recipientId,
            success: result.success,
            error: result.error?.message,
            timestamp: new Date(),
            messageId: result.success ? (result.data as any).messageId : undefined
        };
    }

    private async deliverWebSocket(recipientId: string, notification: NotificationData): Promise<DeliveryResult> {
        // Emit WebSocket event for real-time delivery
        this.emit("websocket_notification", {
            userId: recipientId,
            notification
        });

        return {
            channel: "websocket",
            recipient: recipientId,
            success: true,
            timestamp: new Date()
        };
    }

    private async deliverWebhook(recipientId: string, notification: NotificationData, preferences: NotificationPreferences): Promise<DeliveryResult> {
        const webhookConfig = preferences.channels.webhook;
        
        try {
            const response = await fetch(webhookConfig.url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "User-Agent": "Isomorphiq-Notification-Service/1.0"
                },
                body: JSON.stringify({
                    notification,
                    recipient: recipientId,
                    timestamp: new Date().toISOString()
                })
            });

            if (response.ok) {
                return {
                    channel: "webhook",
                    recipient: recipientId,
                    success: true,
                    timestamp: new Date(),
                    messageId: response.headers.get("x-message-id") || undefined
                };
            } else {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
        } catch (error) {
            return {
                channel: "webhook",
                recipient: recipientId,
                success: false,
                error: error instanceof Error ? error.message : "Unknown error",
                timestamp: new Date()
            };
        }
    }

    private formatSlackMessage(notification: NotificationData): string {
        let message = `*${notification.title}*\n\n${notification.message}`;
        
        if (notification.metadata?.taskId) {
            message += `\n\n<https://task-manager.com/tasks/${notification.metadata.taskId}|View Task>`;
        }
        
        // Add priority indicator
        const priorityEmoji = {
            low: ":low_brightness:",
            medium: ":medium_brightness:",
            high: ":high_brightness:",
            urgent: ":rotating_light:"
        };
        
        message = `${priorityEmoji[notification.priority]} ${message}`;
        
        return message;
    }

    private formatTeamsMessage(notification: NotificationData): any {
        return {
            type: "MessageCard",
            context: "https://schema.org/extensions",
            themeColor: this.getThemeColor(notification.priority),
            summary: notification.title,
            sections: [{
                activityTitle: notification.title,
                activitySubtitle: new Date(notification.timestamp).toLocaleString(),
                text: notification.message,
                facts: notification.metadata ? Object.entries(notification.metadata).map(([key, value]) => ({
                    name: key,
                    value: String(value)
                })) : []
            }],
            potentialActions: notification.metadata?.taskId ? [{
                "@type": "OpenUri",
                name: "View Task",
                targets: [{
                    os: "default",
                    uri: `https://task-manager.com/tasks/${notification.metadata.taskId}`
                }]
            }] : []
        };
    }

    private getThemeColor(priority: NotificationPriority): string {
        switch (priority) {
            case "low": return "6C757D";
            case "medium": return "FFC107";
            case "high": return "FD7E14";
            case "urgent": return "DC3545";
            default: return "007BFF";
        }
    }

    private initializeDefaultTemplates(): void {
        const templates: NotificationTemplate[] = [
            {
                type: "task_created",
                subject: "New Task Created: {{taskTitle}}",
                body: "A new task has been created:\n\nTitle: {{taskTitle}}\nDescription: {{taskDescription}}\nPriority: {{taskPriority}}\nCreated by: {{taskCreatedBy}}\nCreated at: {{taskCreatedAt}}",
                variables: ["taskTitle", "taskDescription", "taskPriority", "taskCreatedBy", "taskCreatedAt"],
                channels: ["email", "slack", "teams", "websocket"]
            },
            {
                type: "task_assigned",
                subject: "Task Assigned: {{taskTitle}}",
                body: "You have been assigned a new task:\n\nTitle: {{taskTitle}}\nDescription: {{taskDescription}}\nPriority: {{taskPriority}}\nAssigned by: {{taskCreatedBy}}",
                variables: ["taskTitle", "taskDescription", "taskPriority", "taskCreatedBy"],
                channels: ["email", "slack", "teams", "websocket", "sms"]
            },
            {
                type: "task_status_changed",
                subject: "Task Status Changed: {{taskTitle}}",
                body: "Task status has been updated:\n\nTitle: {{taskTitle}}\nOld Status: {{oldStatus}}\nNew Status: {{newStatus}}\nUpdated by: {{taskAssignedTo}}",
                variables: ["taskTitle", "oldStatus", "newStatus", "taskAssignedTo"],
                channels: ["email", "slack", "teams", "websocket"]
            },
            {
                type: "task_completed",
                subject: "Task Completed: {{taskTitle}}",
                body: "Task has been completed successfully:\n\nTitle: {{taskTitle}}\nCompleted by: {{taskAssignedTo}}\nCompleted at: {{taskUpdatedAt}}",
                variables: ["taskTitle", "taskAssignedTo", "taskUpdatedAt"],
                channels: ["email", "slack", "teams", "websocket"]
            },
            {
                type: "task_failed",
                subject: "Task Failed: {{taskTitle}}",
                body: "Task has failed:\n\nTitle: {{taskTitle}}\nAssigned to: {{taskAssignedTo}}\nFailed at: {{taskUpdatedAt}}\nError: {{error}}",
                variables: ["taskTitle", "taskAssignedTo", "taskUpdatedAt", "error"],
                channels: ["email", "slack", "teams", "websocket", "sms"]
            },
            {
                type: "deadline_approaching",
                subject: "Deadline Approaching: {{taskTitle}}",
                body: "Task deadline is approaching:\n\nTitle: {{taskTitle}}\nAssigned to: {{taskAssignedTo}}\nDeadline: {{deadline}}",
                variables: ["taskTitle", "taskAssignedTo", "deadline"],
                channels: ["email", "slack", "teams", "websocket", "sms"]
            },
            {
                type: "mention",
                subject: "You were mentioned in: {{taskTitle}}",
                body: "You have been mentioned in a task:\n\nTitle: {{taskTitle}}\nMentioned by: {{mentionedBy}}\nMessage: {{message}}",
                variables: ["taskTitle", "mentionedBy", "message"],
                channels: ["email", "slack", "teams", "websocket"]
            },
            {
                type: "digest",
                subject: "{{digestType}} Task Digest - {{date}}",
                body: "Here's your {{digestType}} summary:\n\n{{#tasks}}\n• {{title}} - {{status}}\n{{/tasks}}",
                variables: ["digestType", "date", "tasks"],
                channels: ["email"]
            }
        ];

        for (const template of templates) {
            this.templates.set(template.type, template);
        }
    }
}
