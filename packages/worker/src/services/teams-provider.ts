import type { Result } from "@isomorphiq/core";
import type { TeamsProvider } from "./notification-service.ts";

export interface TeamsMessage {
    type: string;
    context: string;
    themeColor?: string;
    summary?: string;
    sections?: Array<{
        activityTitle?: string;
        activitySubtitle?: string;
        activityImage?: string;
        facts?: Array<{
            name: string;
            value: string;
        }>;
        text?: string;
    }>;
    potentialActions?: Array<{
        "@type": string;
        name: string;
        targets?: Array<{
            os: string;
            uri: string;
        }>;
    }>;
}

// Microsoft Teams webhook provider
/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class TeamsWebhookProvider implements TeamsProvider {
    async sendMessage(
        webhookUrl: string, 
        message: string, 
        options?: {
            title?: string;
            priority?: "low" | "medium" | "high" | "urgent";
            taskUrl?: string;
            taskId?: string;
            metadata?: Record<string, any>;
        }
    ): Promise<Result<{ messageId: string }>> {
        try {
            const teamsMessage = this.buildTeamsMessage(message, options);
            
            const messageId = `teams_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
            
            console.log(`[TEAMS] Sending message`);
            console.log(`[TEAMS] Title: ${options?.title || 'No title'}`);
            console.log(`[TEAMS] Message: ${message.substring(0, 100)}...`);
            
            // In real implementation, this would make HTTP request to webhook
            const response = await fetch(webhookUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(teamsMessage)
            });

            if (!response.ok) {
                throw new Error(`Teams API error: ${response.status} ${response.statusText}`);
            }
            
            return { success: true, data: { messageId } };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error : new Error(String(error))
            };
        }
    }

    private buildTeamsMessage(message: string, options?: any): TeamsMessage {
        const themeColor = this.getThemeColorByPriority(options?.priority);
        
        const teamsMessage: TeamsMessage = {
            type: "MessageCard",
            context: "https://schema.org/extensions",
            themeColor,
            summary: options?.title || "Task Notification",
            sections: [{
                activityTitle: options?.title || "Task Update",
                activitySubtitle: new Date().toLocaleString(),
                text: message
            }]
        };

        // Add facts/metadata if provided
        if (options?.metadata && Object.keys(options.metadata).length > 0) {
            const facts = Object.entries(options.metadata).map(([key, value]) => ({
                name: key,
                value: String(value)
            }));
            
            if (teamsMessage.sections?.[0]) {
                teamsMessage.sections[0].facts = facts;
            }
        }

        // Add action buttons if task URL is provided
        if (options?.taskUrl) {
            teamsMessage.potentialActions = [{
                "@type": "OpenUri",
                name: "View Task",
                targets: [{
                    os: "default",
                    uri: options.taskUrl
                }]
            }];
        }

        return teamsMessage;
    }

    private getThemeColorByPriority(priority?: string): string {
        switch (priority) {
            case "low": return "6C757D";
            case "medium": return "FFC107";
            case "high": return "FD7E14";
            case "urgent": return "DC3545";
            default: return "007BFF";
        }
    }
}

// Mock Teams provider for testing
/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class MockTeamsProvider implements TeamsProvider {
    private sentMessages: Array<{
        webhookUrl: string;
        message: string;
        options?: any;
        messageId: string;
        timestamp: Date;
    }> = [];

    async sendMessage(webhookUrl: string, message: string, options?: any): Promise<Result<{ messageId: string }>> {
        const messageId = `mock_teams_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        
        this.sentMessages.push({
            webhookUrl,
            message,
            options,
            messageId,
            timestamp: new Date()
        });

        console.log(`[MOCK TEAMS] Sent message: ${message.substring(0, 50)}..., ID: ${messageId}`);
        
        return { success: true, data: { messageId } };
    }

    getSentMessages(): typeof this.sentMessages {
        return [...this.sentMessages];
    }

    clearSentMessages(): void {
        this.sentMessages = [];
    }
}