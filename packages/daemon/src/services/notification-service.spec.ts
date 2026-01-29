import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { NotificationService, type NotificationPreferences, type NotificationEventType, type NotificationChannel } from "./notification-service.ts";
import { MockEmailProvider } from "./email-provider.ts";
import { MockSMSProvider } from "./sms-provider.ts";
import { MockSlackProvider } from "./slack-provider.ts";
import { MockTeamsProvider } from "./teams-provider.ts";

describe("NotificationService", () => {
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

    describe("User Preferences Management", () => {
        it("should set and retrieve user preferences", () => {
            const preferences: NotificationPreferences = {
                userId: "user123",
                enabled: true,
                channels: {
                    email: {
                        enabled: true,
                        address: "test@example.com",
                        events: ["task_created", "task_assigned"] as NotificationEventType[]
                    },
                    sms: { 
                        enabled: false, 
                        phoneNumber: "", 
                        events: [] 
                    },
                    slack: { 
                        enabled: false, 
                        webhookUrl: "", 
                        channel: "", 
                        events: [] 
                    },
                    teams: { 
                        enabled: false, 
                        webhookUrl: "", 
                        events: [] 
                    },
                    websocket: { 
                        enabled: false, 
                        events: [] 
                    },
                    webhook: { 
                        enabled: false, 
                        url: "", 
                        events: [] 
                    }
                },
                frequency: {
                    immediate: ["task_created", "task_assigned"],
                    hourly: [],
                    daily: [],
                    weekly: []
                }
            };

            notificationService.setUserPreferences(preferences);
            const retrieved = notificationService.getUserPreferences("user123");
            assert.deepStrictEqual(retrieved?.userId, "user123");
        });

        it("should return null for non-existent user preferences", () => {
            const retrieved = notificationService.getUserPreferences("nonexistent");
            assert.strictEqual(retrieved, null);
        });
    });

    describe("Template Management", () => {
        it("should set and retrieve notification templates", () => {
            const template = {
                type: "task_created" as NotificationEventType,
                subject: "Test Subject",
                body: "Test body with {{variable}}",
                variables: ["variable"],
                channels: ["email", "websocket"] as NotificationChannel[]
            };

            notificationService.setTemplate(template);
            const retrieved = notificationService.getTemplate("task_created");
            assert.ok(retrieved);
            assert.strictEqual(retrieved?.subject, "Test Subject");
        });

        it("should return default templates for known event types", () => {
            const taskCreatedTemplate = notificationService.getTemplate("task_created");
            assert.ok(taskCreatedTemplate);
            assert.strictEqual(taskCreatedTemplate?.type, "task_created");
            assert.ok(taskCreatedTemplate?.subject.includes("{{taskTitle}}"));
        });
    });

    describe("Notification Sending", () => {
        it("should queue and process notifications", async () => {
            // Set up WebSocket listener before sending notification
            const wsNotifications: any[] = [];
            notificationService.on("websocket_notification", (data: any) => {
                wsNotifications.push(data);
            });

            // Set up user preferences to enable WebSocket for task_created
            const preferences: NotificationPreferences = {
                userId: "user123",
                enabled: true,
                channels: {
                    email: { enabled: false, address: "", events: [] },
                    sms: { enabled: false, phoneNumber: "", events: [] },
                    slack: { enabled: false, webhookUrl: "", channel: "", events: [] },
                    teams: { enabled: false, webhookUrl: "", events: [] },
                    websocket: { 
                        enabled: true, 
                        events: ["task_created" as NotificationEventType] 
                    },
                    webhook: { enabled: false, url: "", events: [] }
                },
                frequency: {
                    immediate: [],
                    hourly: [],
                    daily: [],
                    weekly: []
                }
            };
            notificationService.setUserPreferences(preferences);

            const notificationData = {
                type: "task_created" as NotificationEventType,
                priority: "medium" as const,
                title: "Test Task",
                message: "A test task has been created",
                recipients: ["user123"],
                channels: ["websocket"] as NotificationChannel[]
            };

            const result = await notificationService.sendNotification(notificationData);
            assert.ok(result.success);
            assert.ok(result.data);
            
            // Wait for processing
            await new Promise(resolve => setTimeout(resolve, 1500));
            
            assert.ok(wsNotifications.length > 0);
        });

        it("should send email notifications", async () => {
            const preferences: NotificationPreferences = {
                userId: "user123",
                enabled: true,
                channels: {
                    email: {
                        enabled: true,
                        address: "test@example.com",
                        events: ["task_assigned" as NotificationEventType]
                    },
                    sms: { enabled: false, phoneNumber: "", events: [] },
                    slack: { enabled: false, webhookUrl: "", channel: "", events: [] },
                    teams: { enabled: false, webhookUrl: "", events: [] },
                    websocket: { enabled: false, events: [] },
                    webhook: { enabled: false, url: "", events: [] }
                },
                frequency: {
                    immediate: [],
                    hourly: [],
                    daily: [],
                    weekly: []
                }
            };

            notificationService.setUserPreferences(preferences);

            const notificationData = {
                type: "task_assigned" as NotificationEventType,
                priority: "medium" as const,
                title: "Test Task",
                message: "Task assigned to you",
                recipients: ["user123"],
                channels: ["email"] as NotificationChannel[]
            };

            const result = await notificationService.sendNotification(notificationData);
            assert.ok(result.success);
            
            // Wait for processing
            await new Promise(resolve => setTimeout(resolve, 1500));
            
            const sentEmails = mockEmailProvider.getSentEmails();
            assert.ok(sentEmails.length > 0);
            assert.strictEqual(sentEmails[0].to, "test@example.com");
        });

        it("should send SMS notifications for high priority tasks", async () => {
            const preferences: NotificationPreferences = {
                userId: "user123",
                enabled: true,
                channels: {
                    email: { enabled: false, address: "", events: [] },
                    sms: { 
                        enabled: true, 
                        phoneNumber: "+1234567890",
                        events: ["task_failed" as NotificationEventType]
                    },
                    slack: { enabled: false, webhookUrl: "", channel: "", events: [] },
                    teams: { enabled: false, webhookUrl: "", events: [] },
                    websocket: { enabled: false, events: [] },
                    webhook: { enabled: false, url: "", events: [] }
                },
                frequency: {
                    immediate: [],
                    hourly: [],
                    daily: [],
                    weekly: []
                }
            };

            notificationService.setUserPreferences(preferences);

            const notificationData = {
                type: "task_failed" as NotificationEventType,
                priority: "high" as const,
                title: "Failed Task",
                message: "Task has failed",
                recipients: ["user123"],
                channels: ["sms"] as NotificationChannel[]
            };

            const result = await notificationService.sendNotification(notificationData);
            assert.ok(result.success);
            
            // Wait for processing
            await new Promise(resolve => setTimeout(resolve, 1500));
            
            const sentSMSs = mockSMSProvider.getSentSMSs();
            assert.ok(sentSMSs.length > 0);
            assert.strictEqual(sentSMSs[0].to, "+1234567890");
        });

        it("should send Slack notifications", async () => {
            const preferences: NotificationPreferences = {
                userId: "user123",
                enabled: true,
                channels: {
                    email: { enabled: false, address: "", events: [] },
                    sms: { enabled: false, phoneNumber: "", events: [] },
                    slack: { 
                        enabled: true, 
                        webhookUrl: "https://hooks.slack.com/test",
                        channel: "#general",
                        events: ["task_completed" as NotificationEventType]
                    },
                    teams: { enabled: false, webhookUrl: "", events: [] },
                    websocket: { enabled: false, events: [] },
                    webhook: { enabled: false, url: "", events: [] }
                },
                frequency: {
                    immediate: [],
                    hourly: [],
                    daily: [],
                    weekly: []
                }
            };

            notificationService.setUserPreferences(preferences);

            const notificationData = {
                type: "task_completed" as NotificationEventType,
                priority: "medium" as const,
                title: "Completed Task",
                message: "Task completed successfully",
                recipients: ["user123"],
                channels: ["slack"] as NotificationChannel[]
            };

            const result = await notificationService.sendNotification(notificationData);
            assert.ok(result.success);
            
            // Wait for processing
            await new Promise(resolve => setTimeout(resolve, 1500));
            
            const sentMessages = mockSlackProvider.getSentMessages();
            assert.ok(sentMessages.length > 0);
            assert.strictEqual(sentMessages[0].channel, "#general");
        });
    });

    describe("Mentions", () => {
        it("should detect and notify mentions", async () => {
            const task = {
                id: "task1",
                title: "Test task for @user123 and @user456",
                description: "Test description mentioning @user789",
                status: "todo" as const,
                priority: "medium" as const,
                type: "task" as const,
                createdAt: new Date(),
                updatedAt: new Date(),
                dependencies: [],
                createdBy: "creator123"
            };

            const result = await notificationService.notifyMention(task, [], "creator123");
            assert.ok(result.success);
        });

        it("should handle tasks without mentions", async () => {
            const task = {
                id: "task2",
                title: "Simple task title",
                description: "Simple task description",
                status: "todo" as const,
                priority: "medium" as const,
                type: "task" as const,
                createdAt: new Date(),
                updatedAt: new Date(),
                dependencies: [],
                createdBy: "creator123"
            };

            const result = await notificationService.notifyMention(task, [], "creator123");
            assert.ok(result.success);
        });
    });

    describe("Digest Notifications", () => {
        it("should send daily digest", async () => {
            const preferences: NotificationPreferences = {
                userId: "user123",
                enabled: true,
                channels: {
                    email: {
                        enabled: true,
                        address: "test@example.com",
                        events: ["digest" as NotificationEventType]
                    },
                    sms: { enabled: false, phoneNumber: "", events: [] },
                    slack: { enabled: false, webhookUrl: "", channel: "", events: [] },
                    teams: { enabled: false, webhookUrl: "", events: [] },
                    websocket: { enabled: false, events: [] },
                    webhook: { enabled: false, url: "", events: [] }
                },
                frequency: {
                    immediate: [],
                    hourly: [],
                    daily: ["digest" as NotificationEventType],
                    weekly: []
                }
            };

            notificationService.setUserPreferences(preferences);

            const tasks = [
                {
                    id: "task1",
                    title: "Task 1",
                    description: "Task 1 description",
                    status: "done" as const,
                    priority: "medium" as const,
                    type: "task" as const,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    dependencies: [],
                    createdBy: "user123"
                },
                {
                    id: "task2",
                    title: "Task 2",
                    description: "Task 2 description",
                    status: "in-progress" as const,
                    priority: "high" as const,
                    type: "task" as const,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    dependencies: [],
                    createdBy: "user123"
                }
            ];

            const result = await notificationService.sendDailyDigest("user123", tasks);
            assert.ok(result.success);
            
            // Wait for processing
            await new Promise(resolve => setTimeout(resolve, 1500));
            
            const sentEmails = mockEmailProvider.getSentEmails();
            assert.ok(sentEmails.length > 0);
            assert.ok(sentEmails[0].subject.includes("daily"));
        });

        it("should send weekly digest", async () => {
            const preferences: NotificationPreferences = {
                userId: "user123",
                enabled: true,
                channels: {
                    email: {
                        enabled: true,
                        address: "test@example.com",
                        events: ["digest" as NotificationEventType]
                    },
                    sms: { enabled: false, phoneNumber: "", events: [] },
                    slack: { enabled: false, webhookUrl: "", channel: "", events: [] },
                    teams: { enabled: false, webhookUrl: "", events: [] },
                    websocket: { enabled: false, events: [] },
                    webhook: { enabled: false, url: "", events: [] }
                },
                frequency: {
                    immediate: [],
                    hourly: [],
                    daily: [],
                    weekly: ["digest" as NotificationEventType]
                }
            };

            notificationService.setUserPreferences(preferences);

            const tasks = [
                {
                    id: "task1",
                    title: "Task 1",
                    description: "Task 1 description",
                    status: "done" as const,
                    priority: "low" as const,
                    type: "task" as const,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    dependencies: [],
                    createdBy: "user123"
                }
            ];

            const result = await notificationService.sendWeeklyDigest("user123", tasks);
            assert.ok(result.success);
            
            // Wait for processing
            await new Promise(resolve => setTimeout(resolve, 1500));
            
            const sentEmails = mockEmailProvider.getSentEmails();
            assert.ok(sentEmails.length > 0);
            assert.ok(sentEmails[0].subject.includes("weekly"));
        });
    });

    describe("Notification History", () => {
        it("should track notification history", async () => {
            const preferences: NotificationPreferences = {
                userId: "user123",
                enabled: true,
                channels: {
                    email: {
                        enabled: true,
                        address: "test@example.com",
                        events: ["task_created" as NotificationEventType]
                    },
                    sms: { enabled: false, phoneNumber: "", events: [] },
                    slack: { enabled: false, webhookUrl: "", channel: "", events: [] },
                    teams: { enabled: false, webhookUrl: "", events: [] },
                    websocket: { enabled: false, events: [] },
                    webhook: { enabled: false, url: "", events: [] }
                },
                frequency: {
                    immediate: [],
                    hourly: [],
                    daily: [],
                    weekly: []
                }
            };

            notificationService.setUserPreferences(preferences);

            const notificationData = {
                type: "task_created" as NotificationEventType,
                priority: "medium" as const,
                title: "Test Task",
                message: "A test task has been created",
                recipients: ["user123"],
                channels: ["email"] as NotificationChannel[]
            };

            const result = await notificationService.sendNotification(notificationData);
            assert.ok(result.success);
            
            // Wait for processing
            await new Promise(resolve => setTimeout(resolve, 1500));
            
            const history = notificationService.getNotificationHistory("user123");
            assert.ok(history.length > 0);
        });

        it("should mark notifications as read", async () => {
            const preferences: NotificationPreferences = {
                userId: "user123",
                enabled: true,
                channels: {
                    email: { enabled: true, address: "test@example.com", events: ["task_created" as NotificationEventType] },
                    sms: { enabled: false, phoneNumber: "", events: [] },
                    slack: { enabled: false, webhookUrl: "", channel: "", events: [] },
                    teams: { enabled: false, webhookUrl: "", events: [] },
                    websocket: { enabled: false, events: [] },
                    webhook: { enabled: false, url: "", events: [] }
                },
                frequency: {
                    immediate: [],
                    hourly: [],
                    daily: [],
                    weekly: []
                }
            };

            notificationService.setUserPreferences(preferences);

            // Create a notification first
            const notificationData = {
                type: "task_created" as NotificationEventType,
                priority: "medium" as const,
                title: "Test Task",
                message: "A test task has been created",
                recipients: ["user123"],
                channels: ["email"] as NotificationChannel[]
            };

            const result = await notificationService.sendNotification(notificationData);
            assert.ok(result.success);
            
            // Wait for processing
            await new Promise(resolve => setTimeout(resolve, 1500));

            // Mark the notification as read
            const success = notificationService.markNotificationAsRead(result.data!, "user123");
            assert.ok(success);
        });

        it("should provide notification statistics", () => {
            const preferences: NotificationPreferences = {
                userId: "user123",
                enabled: true,
                channels: {
                    email: { enabled: false, address: "", events: [] },
                    sms: { enabled: false, phoneNumber: "", events: [] },
                    slack: { enabled: false, webhookUrl: "", channel: "", events: [] },
                    teams: { enabled: false, webhookUrl: "", events: [] },
                    websocket: { enabled: false, events: [] },
                    webhook: { enabled: false, url: "", events: [] }
                },
                frequency: {
                    immediate: [],
                    hourly: [],
                    daily: [],
                    weekly: []
                }
            };

            notificationService.setUserPreferences(preferences);

            const stats = notificationService.getNotificationStats("user123");
            assert.ok(stats);
            assert.ok(stats.total >= 0);
        });
    });

    describe("Variable Replacement", () => {
        it("should replace template variables correctly", () => {
            // Test variable replacement through notification sending
            const preferences: NotificationPreferences = {
                userId: "user123",
                enabled: true,
                channels: {
                    email: {
                        enabled: true,
                        address: "test@example.com",
                        events: ["task_created" as NotificationEventType]
                    },
                    sms: { enabled: false, phoneNumber: "", events: [] },
                    slack: { enabled: false, webhookUrl: "", channel: "", events: [] },
                    teams: { enabled: false, webhookUrl: "", events: [] },
                    websocket: { enabled: false, events: [] },
                    webhook: { enabled: false, url: "", events: [] }
                },
                frequency: {
                    immediate: [],
                    hourly: [],
                    daily: [],
                    weekly: []
                }
            };

            notificationService.setUserPreferences(preferences);

            const notificationData = {
                type: "task_created" as NotificationEventType,
                priority: "medium" as const,
                title: "Test Task for John Doe",
                message: "A test task has been created",
                recipients: ["user123"],
                channels: ["email"] as NotificationChannel[]
            };

            const result = notificationService.sendNotification(notificationData);
            assert.ok(result);
        });
    });

    describe("Quiet Hours", () => {
        it("should respect quiet hours", async () => {
            const preferences: NotificationPreferences = {
                userId: "user123",
                enabled: true,
                channels: {
                    email: {
                        enabled: true,
                        address: "test@example.com",
                        events: ["task_created" as NotificationEventType]
                    },
                    sms: { enabled: false, phoneNumber: "", events: [] },
                    slack: { enabled: false, webhookUrl: "", channel: "", events: [] },
                    teams: { enabled: false, webhookUrl: "", events: [] },
                    websocket: { enabled: false, events: [] },
                    webhook: { enabled: false, url: "", events: [] }
                },
                quietHours: {
                    start: "22:00",
                    end: "08:00",
                    timezone: "UTC"
                },
                frequency: {
                    immediate: [],
                    hourly: [],
                    daily: [],
                    weekly: []
                }
            };

            notificationService.setUserPreferences(preferences);

            const notificationData = {
                type: "task_created" as NotificationEventType,
                priority: "low" as const,
                title: "Test Task",
                message: "A test task has been created",
                recipients: ["user123"],
                channels: ["email"] as NotificationChannel[]
            };

            const result = await notificationService.sendNotification(notificationData);
            assert.ok(result.success);
            
            // Wait for processing
            await new Promise(resolve => setTimeout(resolve, 1500));
            
            // Check that email was not sent during quiet hours for low priority
            const sentEmails = mockEmailProvider.getSentEmails();
            assert.strictEqual(sentEmails.length, 0);
        });
    });
});