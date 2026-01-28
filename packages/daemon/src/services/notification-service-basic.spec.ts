import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { NotificationService } from "./notification-service.ts";
import { MockEmailProvider } from "./email-provider.ts";
import { MockSMSProvider } from "./sms-provider.ts";
import { MockSlackProvider } from "./slack-provider.ts";
import { MockTeamsProvider } from "./teams-provider.ts";

describe("NotificationService - Basic Tests", () => {
    let notificationService: NotificationService;
    let mockEmailProvider: MockEmailProvider;
    let mockSMSProvider: MockSMSProvider;
    let mockSlackProvider: MockSlackProvider;
    let mockTeamsProvider: MockTeamsProvider;

    beforeEach(() => {
        notificationService = new NotificationService({
            maxRetries: 2,
            retryDelay: 100,
            batchSize: 5,
            rateLimiting: {
                enabled: true,
                maxPerMinute: 60,
                maxPerHour: 1000
            }
        });

        mockEmailProvider = new MockEmailProvider();
        mockSMSProvider = new MockSMSProvider();
        mockSlackProvider = new MockSlackProvider();
        mockTeamsProvider = new MockTeamsProvider();

        notificationService.setEmailProvider(mockEmailProvider);
        notificationService.setSMSProvider(mockSMSProvider);
        notificationService.setSlackProvider(mockSlackProvider);
        notificationService.setTeamsProvider(mockTeamsProvider);
    });

    afterEach(() => {
        mockEmailProvider.clearSentEmails();
        mockSMSProvider.clearSentSMSs();
        mockSlackProvider.clearSentMessages();
        mockTeamsProvider.clearSentMessages();
    });

    describe("Basic Functionality", () => {
        it("should create notification service instance", () => {
            assert.ok(notificationService instanceof NotificationService);
        });

        it("should set and retrieve user preferences", () => {
            const preferences = {
                userId: "user123",
                enabled: true,
                channels: {
                    email: {
                        enabled: true,
                        address: "user@example.com",
                        events: ["task_created", "task_assigned"]
                    },
                    sms: {
                        enabled: false,
                        phoneNumber: "",
                        events: []
                    },
                    slack: {
                        enabled: true,
                        webhookUrl: "https://hooks.slack.com/test",
                        channel: "#general",
                        events: ["task_completed"]
                    },
                    teams: {
                        enabled: false,
                        webhookUrl: "",
                        events: []
                    },
                    websocket: {
                        enabled: true,
                        events: ["task_status_changed"]
                    },
                    webhook: {
                        enabled: false,
                        url: "",
                        events: []
                    }
                },
                frequency: {
                    immediate: ["task_assigned"],
                    hourly: [],
                    daily: ["digest"],
                    weekly: []
                }
            };

            notificationService.setUserPreferences(preferences);
            
            const retrieved = notificationService.getUserPreferences("user123");
            assert.ok(retrieved);
            assert.strictEqual(retrieved?.userId, "user123");
            assert.strictEqual(retrieved?.enabled, true);
            assert.strictEqual(retrieved?.channels.email.address, "user@example.com");
        });

        it("should return null for non-existent user preferences", () => {
            const retrieved = notificationService.getUserPreferences("nonexistent");
            assert.strictEqual(retrieved, null);
        });

        it("should get default templates", () => {
            const taskCreatedTemplate = notificationService.getTemplate("task_created");
            assert.ok(taskCreatedTemplate);
            assert.strictEqual(taskCreatedTemplate?.type, "task_created");
            assert.ok(taskCreatedTemplate?.subject.includes("{{taskTitle}}"));
        });

        it("should send basic notification", async () => {
            const result = await notificationService.sendNotification({
                type: "task_created",
                priority: "medium",
                title: "Test Task",
                message: "A test task has been created",
                recipients: ["user123"],
                channels: ["websocket"]
            });

            assert.ok(result.success);
            assert.ok(result.data);
        });

        it("should track notification history", () => {
            const history = notificationService.getNotificationHistory();
            assert.ok(Array.isArray(history));
        });

        it("should provide notification statistics", () => {
            const stats = notificationService.getNotificationStats();
            assert.strictEqual(typeof stats.total, "number");
            assert.strictEqual(typeof stats.delivered, "number");
            assert.strictEqual(typeof stats.failed, "number");
            assert.strictEqual(typeof stats.read, "number");
            assert.strictEqual(typeof stats.byChannel, "object");
            assert.strictEqual(typeof stats.byType, "object");
        });

        it("should mark notifications as read", () => {
            const result = notificationService.markNotificationAsRead("test_notif_id", "user123");
            assert.strictEqual(typeof result, "boolean");
        });
    });

    describe("Provider Integration", () => {
        it("should use mock email provider", () => {
            const sentEmails = mockEmailProvider.getSentEmails();
            assert.ok(Array.isArray(sentEmails));
            assert.strictEqual(sentEmails.length, 0);
        });

        it("should use mock SMS provider", () => {
            const sentSMSs = mockSMSProvider.getSentSMSs();
            assert.ok(Array.isArray(sentSMSs));
            assert.strictEqual(sentSMSs.length, 0);
        });

        it("should use mock Slack provider", () => {
            const sentMessages = mockSlackProvider.getSentMessages();
            assert.ok(Array.isArray(sentMessages));
            assert.strictEqual(sentMessages.length, 0);
        });

        it("should use mock Teams provider", () => {
            const sentMessages = mockTeamsProvider.getSentMessages();
            assert.ok(Array.isArray(sentMessages));
            assert.strictEqual(sentMessages.length, 0);
        });
    });

    describe("Template Management", () => {
        it("should set custom template", () => {
            const template = {
                type: "test_event",
                subject: "Test Subject",
                body: "Test body with {{variable}}",
                variables: ["variable"],
                channels: ["email"]
            };

            notificationService.setTemplate(template);
            
            const retrieved = notificationService.getTemplate("test_event");
            assert.ok(retrieved);
            assert.strictEqual(retrieved?.subject, "Test Subject");
            assert.strictEqual(retrieved?.body, "Test body with {{variable}}");
        });
    });

    describe("Event Emission", () => {
        it("should emit events", (done) => {
            let eventReceived = false;
            
            notificationService.on("notification_queued", () => {
                eventReceived = true;
                done();
            });

            notificationService.sendNotification({
                type: "task_created",
                priority: "medium",
                title: "Test Task",
                message: "A test task has been created",
                recipients: ["user123"],
                channels: ["websocket"]
            }).then(() => {
                // Event should be emitted synchronously
                assert.ok(eventReceived);
            });
        });
    });

    describe("Configuration", () => {
        it("should accept custom configuration", () => {
            const customService = new NotificationService({
                maxRetries: 5,
                retryDelay: 1000,
                batchSize: 20,
                quietHoursEnforced: false
            });

            assert.ok(customService instanceof NotificationService);
        });
    });
});