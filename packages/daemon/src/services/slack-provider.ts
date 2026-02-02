import type { Result } from "@isomorphiq/core";
import type { SlackProvider } from "./notification-service.ts";

export interface SlackMessage {
    text?: string;
    attachments?: Array<{
        color?: string;
        title?: string;
        title_link?: string;
        text?: string;
        fields?: Array<{
            title: string;
            value: string;
            short?: boolean;
        }>;
        actions?: Array<{
            type: string;
            text: string;
            url?: string;
            style?: string;
        }>;
    }>;
    username?: string;
    icon_emoji?: string;
    channel?: string;
}

// Slack webhook provider
/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class SlackWebhookProvider implements SlackProvider {
    private defaultUsername: string;
    private defaultIcon: string;

    constructor(username?: string, icon?: string) {
        this.defaultUsername = username || "Task Manager";
        this.defaultIcon = icon || ":clipboard:";
    }

    async sendMessage(
        webhookUrl: string, 
        channel: string, 
        message: string, 
        options?: {
            username?: string;
            icon_emoji?: string;
            priority?: "low" | "medium" | "high" | "urgent";
            taskUrl?: string;
            taskId?: string;
            metadata?: Record<string, any>;
        }
    ): Promise<Result<{ messageId: string }>> {
        try {
            const slackMessage = this.buildSlackMessage(message, channel, options);
            
            const messageId = `slack_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
            
            console.log(`[SLACK] Sending message to channel: ${channel}`);
            console.log(`[SLACK] Message: ${message.substring(0, 100)}...`);
            
            // In real implementation, this would make HTTP request to webhook
            const response = await fetch(webhookUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(slackMessage)
            });

            if (!response.ok) {
                throw new Error(`Slack API error: ${response.status} ${response.statusText}`);
            }
            
            return { success: true, data: { messageId } };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error : new Error(String(error))
            };
        }
    }

    private buildSlackMessage(message: string, channel: string, options?: any): SlackMessage {
        const color = this.getColorByPriority(options?.priority);
        const slackMessage: SlackMessage = {
            channel,
            username: options?.username || this.defaultUsername,
            icon_emoji: options?.icon_emoji || this.defaultIcon,
            text: message
        };

        // Add attachment for better formatting
        if (options?.taskId || options?.metadata) {
            const fields: Array<{ title: string; value: string; short?: boolean }> = [];
            
            if (options?.taskId) {
                fields.push({
                    title: "Task ID",
                    value: options.taskId,
                    short: true
                });
                
                if (options?.taskUrl) {
                    slackMessage.attachments = [{
                        color,
                        title: "View Task",
                        title_link: options.taskUrl,
                        text: message,
                        fields,
                        actions: [{
                            type: "button",
                            text: "Open Task",
                            url: options.taskUrl,
                            style: "primary"
                        }]
                    }];
                } else {
                    slackMessage.attachments = [{
                        color,
                        text: message,
                        fields
                    }];
                }
            } else if (options?.metadata) {
                // Add metadata as fields
                Object.entries(options.metadata).forEach(([key, value]) => {
                    fields.push({
                        title: key,
                        value: String(value),
                        short: true
                    });
                });
                
                slackMessage.attachments = [{
                    color,
                    text: message,
                    fields
                }];
            }
        }

        return slackMessage;
    }

    private getColorByPriority(priority?: string): string {
        switch (priority) {
            case "low": return "#6C757D";
            case "medium": return "#FFC107";
            case "high": return "#FD7E14";
            case "urgent": return "#DC3545";
            default: return "#007BFF";
        }
    }
}

// Mock Slack provider for testing
/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class MockSlackProvider implements SlackProvider {
    private sentMessages: Array<{
        webhookUrl: string;
        channel: string;
        message: string;
        options?: any;
        messageId: string;
        timestamp: Date;
    }> = [];

    async sendMessage(webhookUrl: string, channel: string, message: string, options?: any): Promise<Result<{ messageId: string }>> {
        const messageId = `mock_slack_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        
        this.sentMessages.push({
            webhookUrl,
            channel,
            message,
            options,
            messageId,
            timestamp: new Date()
        });

        console.log(`[MOCK SLACK] Sent to channel: ${channel}, Message: ${message.substring(0, 50)}..., ID: ${messageId}`);
        
        return { success: true, data: { messageId } };
    }

    getSentMessages(): typeof this.sentMessages {
        return [...this.sentMessages];
    }

    clearSentMessages(): void {
        this.sentMessages = [];
    }
}