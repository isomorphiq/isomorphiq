import type { Result } from "@isomorphiq/core";
import type { EmailProvider } from "./notification-service.ts";

// Simple SMTP email provider using Node.js
export class SMTPEmailProvider implements EmailProvider {
    private config: {
        host: string;
        port: number;
        secure: boolean;
        auth: {
            user: string;
            pass: string;
        };
        from: string;
        fromName: string;
    };

    constructor(config: SMTPEmailProvider["config"]) {
        this.config = config;
    }

    async sendEmail(to: string, subject: string, body: string, options?: {
        html?: boolean;
        priority?: "low" | "normal" | "high";
        metadata?: Record<string, any>;
    }): Promise<Result<{ messageId: string }>> {
        try {
            // In a real implementation, this would use nodemailer or similar
            // For now, we'll simulate the email sending
            const messageId = `email_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
            
            console.log(`[EMAIL] Sending email to: ${to}`);
            console.log(`[EMAIL] Subject: ${subject}`);
            console.log(`[EMAIL] Body: ${body.substring(0, 100)}...`);
            console.log(`[EMAIL] Message ID: ${messageId}`);
            
            // Simulate network delay
            await new Promise(resolve => setTimeout(resolve, 100));
            
            return { success: true, data: { messageId } };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error : new Error(String(error))
            };
        }
    }
}

// Mock email provider for testing
export class MockEmailProvider implements EmailProvider {
    private sentEmails: Array<{
        to: string;
        subject: string;
        body: string;
        options?: any;
        messageId: string;
        timestamp: Date;
    }> = [];

    async sendEmail(to: string, subject: string, body: string, options?: any): Promise<Result<{ messageId: string }>> {
        const messageId = `mock_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        
        this.sentEmails.push({
            to,
            subject,
            body,
            options,
            messageId,
            timestamp: new Date()
        });

        console.log(`[MOCK EMAIL] Sent to: ${to}, Subject: ${subject}, ID: ${messageId}`);
        
        return { success: true, data: { messageId } };
    }

    getSentEmails(): typeof this.sentEmails {
        return [...this.sentEmails];
    }

    clearSentEmails(): void {
        this.sentEmails = [];
    }
}

// SendGrid email provider (for future implementation)
export class SendGridEmailProvider implements EmailProvider {
    private apiKey: string;
    private fromEmail: string;
    private fromName: string;

    constructor(apiKey: string, fromEmail: string, fromName?: string) {
        this.apiKey = apiKey;
        this.fromEmail = fromEmail;
        this.fromName = fromName || "Task Manager";
    }

    async sendEmail(to: string, subject: string, body: string, options?: {
        html?: boolean;
        priority?: "low" | "normal" | "high";
        metadata?: Record<string, any>;
    }): Promise<Result<{ messageId: string }>> {
        try {
            // This would use SendGrid's API in real implementation
            const messageId = `sg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
            
            console.log(`[SENDGRID] Would send email to: ${to}`);
            console.log(`[SENDGRID] Subject: ${subject}`);
            
            return { success: true, data: { messageId } };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error : new Error(String(error))
            };
        }
    }
}