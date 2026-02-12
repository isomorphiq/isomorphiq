import type { Result } from "@isomorphiq/core";
import type { SMSProvider } from "./notification-service.ts";

// Twilio SMS provider
/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class TwilioSMSProvider implements SMSProvider {
    private accountSid: string;
    private authToken: string;
    private fromNumber: string;

    constructor(accountSid: string, authToken: string, fromNumber: string) {
        this.accountSid = accountSid;
        this.authToken = authToken;
        this.fromNumber = fromNumber;
    }

    async sendSMS(to: string, message: string, options?: {
        priority?: "low" | "normal" | "high";
        metadata?: Record<string, any>;
    }): Promise<Result<{ messageId: string }>> {
        try {
            // In a real implementation, this would use Twilio's SDK
            const messageId = `twilio_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
            
            console.log(`[TWILIO] Sending SMS to: ${to}`);
            console.log(`[TWILIO] Message: ${message.substring(0, 100)}...`);
            console.log(`[TWILIO] From: ${this.fromNumber}`);
            console.log(`[TWILIO] Message ID: ${messageId}`);
            
            // Simulate network delay
            await new Promise(resolve => setTimeout(resolve, 200));
            
            return { success: true, data: { messageId } };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error : new Error(String(error))
            };
        }
    }
}

// AWS SNS SMS provider
/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class AWSSMSProvider implements SMSProvider {
    private region: string;
    private accessKeyId: string;
    private secretAccessKey: string;

    constructor(region: string, accessKeyId: string, secretAccessKey: string) {
        this.region = region;
        this.accessKeyId = accessKeyId;
        this.secretAccessKey = secretAccessKey;
    }

    async sendSMS(to: string, message: string, options?: {
        priority?: "low" | "normal" | "high";
        metadata?: Record<string, any>;
    }): Promise<Result<{ messageId: string }>> {
        try {
            // In a real implementation, this would use AWS SDK
            const messageId = `sns_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
            
            console.log(`[AWS SNS] Sending SMS to: ${to}`);
            console.log(`[AWS SNS] Message: ${message.substring(0, 100)}...`);
            console.log(`[AWS SNS] Message ID: ${messageId}`);
            
            return { success: true, data: { messageId } };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error : new Error(String(error))
            };
        }
    }
}

// Mock SMS provider for testing
/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class MockSMSProvider implements SMSProvider {
    private sentSMSs: Array<{
        to: string;
        message: string;
        options?: any;
        messageId: string;
        timestamp: Date;
    }> = [];

    async sendSMS(to: string, message: string, options?: any): Promise<Result<{ messageId: string }>> {
        const messageId = `mock_sms_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        
        this.sentSMSs.push({
            to,
            message,
            options,
            messageId,
            timestamp: new Date()
        });

        console.log(`[MOCK SMS] Sent to: ${to}, Message: ${message.substring(0, 50)}..., ID: ${messageId}`);
        
        return { success: true, data: { messageId } };
    }

    getSentSMSs(): typeof this.sentSMSs {
        return [...this.sentSMSs];
    }

    clearSentSMSs(): void {
        this.sentSMSs = [];
    }
}