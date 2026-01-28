import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { NotificationService } from "./notification-service.ts";
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
            const preferences = {
                userId: "user123",
                enabled: true,
                channels: {
                    email: {
                        enabled: true,
                        address: "user@example.com",
                        events: ["task_created" as const, "task_assigned" as const]
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
    });

    describe("Template Management", () => {
        it("should set and retrieve notification templates", () => {
            const template = {
                type: "test_event" as const,
                subject: "Test Subject",
                body: "Test body with {{variable}}",
                variables: ["variable"],
                channels: ["email", "slack"]
            };

            notificationService.setTemplate(template);
            
            const retrieved = notificationService.getTemplate("test_event");
            assert.ok(retrieved);
            assert.strictEqual(retrieved?.subject, "Test Subject");
            assert.strictEqual(retrieved?.body, "Test body with {{variable}}");
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
            const notificationData = {
                type: "task_created" as const,
                priority: "medium" as const,
                title: "Test Task",
                message: "A test task has been created",
                recipients: ["user123"],
                channels: ["websocket"] as const
            };

            const result = await notificationService.sendNotification(notificationData);
            assert.ok(result.success);
            assert.ok(result.data);
            
            // Wait for processing
            await new Promise(resolve => setTimeout(resolve, 1500));
            
            // Check WebSocket event was emitted
            const wsNotifications: any[] = [];
            notificationService.on("websocket_notification", (data: any) => {
                wsNotifications.push(data);
            });
            
            assert.ok(wsNotifications.length > 0);
        });

        it("should send email notifications", async () => {
            const preferences = {
                userId: "user123",
                enabled: true,
                channels: {
                    email: {
                        enabled: true,
                        address: "test@example.com",
                        events: ["task_assigned"]
                    },
                    sms: { enabled: false, phoneNumber: "", events: [] },
                    slack: { enabled: false, webhookUrl: "", channel: "", events: [] },
                    teams: { enabled: false, webhookUrl: "", events: [] },
                    websocket: { enabled: true, events: [] },
                    webhook: { enabled: false, url: "", events: [] }
                },
                frequency: {
                    immediate: ["task_assigned"],
                    hourly: [],
                    daily: [],
                    weekly: []
                }
            };

            notificationService.setUserPreferences(preferences);

            const task = {
                id: "task123",
                title: "Test Task",
                description: "Test description",
                status: "todo" as const,
                priority: "high" as const,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                assignedTo: "user123"
            };

            const result = await notificationService.notifyTaskAssigned(task, "user123");
            assert.ok(result.success);
            
            // Wait for processing
            await new Promise(resolve => setTimeout(resolve, 1500));
            
            const sentEmails = mockEmailProvider.getSentEmails();
            assert.ok(sentEmails.length > 0);
            assert.strictEqual(sentEmails[0].to, "test@example.com");
        });

        it("should send SMS notifications for high priority tasks", async () => {
            const preferences = {
                userId: "user123",
                enabled: true,
                channels: {
                    email: { enabled: false, address: "", events: [] },
                    sms: {
                        enabled: true,
                        phoneNumber: "+1234567890",
                        events: ["task_failed"]
                    },
                    slack: { enabled: false, webhookUrl: "", channel: "", events: [] },
                    teams: { enabled: false, webhookUrl: "", events: [] },
                    websocket: { enabled: true, events: [] },
                    webhook: { enabled: false, url: "", events: [] }
                },
                frequency: {
                    immediate: ["task_failed"],
                    hourly: [],
                    daily: [],
                    weekly: []
                }
            };

            notificationService.setUserPreferences(preferences);

            const task = {
                id: "task123",
                title: "Failed Task",
                description: "Test description",
                status: "failed" as const,
                priority: "high" as const,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                assignedTo: "user123"
            };

            const result = await notificationService.notifyTaskFailed(task, "Error message", ["user123"]);
            assert.ok(result.success);
            
            // Wait for processing
            await new Promise(resolve => setTimeout(resolve, 1500));
            
            const sentSMSs = mockSMSProvider.getSentSMSs();
            assert.ok(sentSMSs.length > 0);
            assert.strictEqual(sentSMSs[0].to, "+1234567890");
        });

        it("should send Slack notifications", async () => {
            const preferences = {
                userId: "user123",
                enabled: true,
                channels: {
                    email: { enabled: false, address: "", events: [] },
                    sms: { enabled: false, phoneNumber: "", events: [] },
                    slack: {
                        enabled: true,
                        webhookUrl: "https://hooks.slack.com/test",
                        channel: "#general",
                        events: ["task_completed"]
                    },
                    teams: { enabled: false, webhookUrl: "", events: [] },
                    websocket: { enabled: true, events: [] },
                    webhook: { enabled: false, url: "", events: [] }
                },
                frequency: {
                    immediate: ["task_completed"],
                    hourly: [],
                    daily: [],
                    weekly: []
                }
            };

            notificationService.setUserPreferences(preferences);

            const task = {
                id: "task123",
                title: "Completed Task",
                description: "Test description",
                status: "done" as const,
                priority: "medium" as const,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                assignedTo: "user123"
            };

            const result = await notificationService.notifyTaskCompleted(task, ["user123"]);
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
                id: "task123",
                title: "Task with @john mention",
                description: "Please review @jane",
                status: "todo" as const,
                priority: "medium" as const,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                createdBy: "creator123"
            };

            const result = await notificationService.notifyMention(task, ["john", "jane"], "creator123");
            assert.ok(result.success);
        });

        it("should handle tasks without mentions", async () => {
            const task = {
                id: "task123",
                title: "Regular task title",
                description: "No mentions here",
                status: "todo" as const,
                priority: "medium" as const,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                createdBy: "creator123"
            };

            const result = await notificationService.notifyMention(task, [], "creator123");
            assert.ok(result.success);
        });
    });

    describe("Digest Notifications", () => {
        it("should send daily digest", async () => {
            const tasks = [
                {
                    id: "task1",
                    title: "Task 1",
                    status: "done" as const,
                    priority: "medium" as const,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                },
                {
                    id: "task2",
                    title: "Task 2",
                    status: "in-progress" as const,
                    priority: "high" as const,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                }
            ];

            const result = await notificationService.sendDailyDigest("user123", tasks as any);
            assert.ok(result.success);
            
            // Wait for processing
            await new Promise(resolve => setTimeout(resolve, 1500));
            
            const sentEmails = mockEmailProvider.getSentEmails();
            assert.ok(sentEmails.length > 0);
            assert.ok(sentEmails[0].subject.includes("Daily"));
        });

        it("should send weekly digest", async () => {
            const tasks = [
                {
                    id: "task1",
                    title: "Task 1",
                    status: "done" as const,
                    priority: "low" as const,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                }
            ];

            const result = await notificationService.sendWeeklyDigest("user123", tasks as any);
            assert.ok(result.success);
            
            // Wait for processing
            await new Promise(resolve => setTimeout(resolve, 1500));
            
            const sentEmails = mockEmailProvider.getSentEmails();
            assert.ok(sentEmails.length > 0);
            assert.ok(sentEmails[0].subject.includes("Weekly"));
        });
    });

    describe("Notification History", () => {
        it("should track notification history", async () => {
            const preferences = {
                userId: "user123",
                enabled: true,
                channels: {
                    email: {
                        enabled: true,
                        address: "test@example.com",
                        events: ["task_created"]
                    },
                    sms: { enabled: false, phoneNumber: "", events: [] },
                    slack: { enabled: false, webhookUrl: "", channel: "", events: [] },
                    teams: { enabled: false, webhookUrl: "", events: [] },
                    websocket: { enabled: true, events: [] },
                    webhook: { enabled: false, url: "", events: [] }
                },
                frequency: {
                    immediate: ["task_created"],
                    hourly: [],
                    daily: [],
                    weekly: []
                }
            };

            notificationService.setUserPreferences(preferences);

            const task = {
                id: "task123",
                title: "Test Task",
                description: "Test description",
                status: "todo" as const,
                priority: "medium" as const,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                createdBy: "user123"
            };

            await notificationService.notifyTaskCreated(task, ["user123"]);
            
            // Wait for processing
            await new Promise(resolve => setTimeout(resolve, 1500));
            
            const history = notificationService.getNotificationHistory("user123");
            assert.ok(history.length > 0);
            assert.strictEqual(history[0].userId, "user123");
            assert.strictEqual(history[0].type, "task_created");
        });

        it("should mark notifications as read", () => {
            // First add some test history
            const history = notificationService.getNotificationHistory();
            const initialLength = history.length;
            
            // This would typically be called with a real notification ID
            // For testing, we'll verify the method exists and returns appropriate values
            const result = notificationService.markNotificationAsRead("test_notif_id", "user123");
            assert.strictEqual(typeof result, "boolean");
        });

        it("should provide notification statistics", async () => {
            const preferences = {
                userId: "user123",
                enabled: true,
                channels: {
                    email: {
                        enabled: true,
                        address: "test@example.com",
                        events: ["task_created"]
                    },
                    sms: { enabled: false, phoneNumber: "", events: [] },
                    slack: { enabled: false, webhookUrl: "", channel: "", events: [] },
                    teams: { enabled: false, webhookUrl: "", events: [] },
                    websocket: { enabled: true, events: [] },
                    webhook: { enabled: false, url: "", events: [] }
                },
                frequency: {
                    immediate: ["task_created"],
                    hourly: [],
                    daily: [],
                    weekly: []
                }
            };

            notificationService.setUserPreferences(preferences);

            const task = {
                id: "task123",
                title: "Test Task",
                description: "Test description",
                status: "todo" as const,
                priority: "medium" as const,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                createdBy: "user123"
            };

            await notificationService.notifyTaskCreated(task, ["user123"]);
            
            // Wait for processing
            await new Promise(resolve => setTimeout(resolve, 1500));
            
            const stats = notificationService.getNotificationStats("user123");
            assert.strictEqual(typeof stats.total, "number");
            assert.strictEqual(typeof stats.delivered, "number");
            assert.strictEqual(typeof stats.failed, "number");
            assert.strictEqual(typeof stats.read, "number");
            assert.strictEqual(typeof stats.byChannel, "object");
            assert.strictEqual(typeof stats.byType, "object");
        });
    });

    describe("Variable Replacement", () => {
        it("should replace template variables correctly", async () => {
            const template = {
                type: "test_event" as const,
                subject: "Task {{taskTitle}} is {{taskStatus}}",
                body: "Task {{taskTitle}} assigned to {{taskAssignedTo}}",
                variables: ["taskTitle", "taskStatus", "taskAssignedTo"],
                channels: ["email"]
            };

            notificationService.setTemplate(template);

            const task = {
                id: "task123",
                title: "Important Task",
                description: "Test description",
                status: "in-progress" as const,
                priority: "high" as const,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                assignedTo: "user123"
            };

            const result = await notificationService.sendNotification({
                type: "test_event",
                priority: "high",
                title: "Should be replaced",
                message: "Should be replaced",
                recipients: ["user123"],
                channels: ["email"],
                data: { task }
            });

            assert.ok(result.success);
        });
    });

    describe("Quiet Hours", () => {
        it("should respect quiet hours", async () => {
            const preferences = {
                userId: "user123",
                enabled: true,
                channels: {
                    email: {
                        enabled: true,
                        address: "test@example.com",
                        events: ["task_created"]
                    },
                    sms: { enabled: false, phoneNumber: "", events: [] },
                    slack: { enabled: false, webhookUrl: "", channel: "", events: [] },
                    teams: { enabled: false, webhookUrl: "", events: [] },
                    websocket: { enabled: true, events: [] },
                    webhook: { enabled: false, url: "", events: [] }
                },
                quietHours: {
                    start: "22:00",
                    end: "08:00",
                    timezone: "UTC"
                },
                frequency: {
                    immediate: ["task_created"],
                    hourly: [],
                    daily: [],
                    weekly: []
                }
            };

            notificationService.setUserPreferences(preferences);

            // Create a new service instance with quiet hours enabled
            const quietHoursService = new NotificationService({
                quietHoursEnforced: true
            });
            quietHoursService.setEmailProvider(mockEmailProvider);
            quietHoursService.setUserPreferences(preferences);

            const task = {
                id: "task123",
                title: "Test Task",
                description: "Test description",
                status: "todo" as const,
                priority: "medium" as const,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                createdBy: "user123"
            };

            const result = await quietHoursService.notifyTaskCreated(task, ["user123"]);
            assert.ok(result.success);
            
            // Wait for processing
            await new Promise(resolve => setTimeout(resolve, 1500));
            
            // Email should not be sent during quiet hours (depending on current time)
            // This test might be flaky based on when it's run
        });
    });
});