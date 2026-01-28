import { strict } from "node:assert";
import { describe, it, beforeEach, afterEach } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
    TaskAuditService,
    type TaskAuditEvent,
    type TaskAuditFilter,
    type TaskHistorySummary,
    type AuditStatistics,
} from "./task-audit-service.ts";

describe("TaskAuditService", () => {
    let auditService: TaskAuditService;
    let testDbPath: string;

    beforeEach(async () => {
        testDbPath = await mkdtemp(path.join(tmpdir(), "isomorphiq-test-audit-db-"));
        auditService = new TaskAuditService(testDbPath);
        await auditService.initialize();
    });

    afterEach(async () => {
        await auditService.shutdown();
        // Clean up test database
        try {
            await rm(testDbPath, { recursive: true, force: true });
        } catch (error) {
            // Ignore cleanup errors
        }
    });

    describe("Task Creation Auditing", () => {
        it("should record task creation event", async () => {
            const task = {
                id: "test-task-1",
                title: "Test Task",
                description: "Test Description",
                status: "todo",
                priority: "medium",
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                createdBy: "test-user",
            };

            await auditService.recordTaskCreated(task, "test-user");

            const history = await auditService.getTaskHistory({ taskId: "test-task-1" });
            strict.equal(history.length, 1);
            strict.equal(history[0].eventType, "created");
            strict.equal(history[0].taskId, "test-task-1");
            strict.equal(history[0].changedBy, "test-user");
            strict.equal(history[0].newStatus, "todo");
            strict.equal(history[0].newPriority, "medium");
        });

        it("should store task metadata in creation event", async () => {
            const task = {
                id: "test-task-2",
                title: "Test Task with Dependencies",
                description: "Test Description",
                status: "todo",
                priority: "high",
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                createdBy: "test-user",
                dependencies: ["dep-1", "dep-2"],
                type: "feature",
            };

            await auditService.recordTaskCreated(task, "test-user");

            const history = await auditService.getTaskHistory({ taskId: "test-task-2" });
            strict.equal(history.length, 1);
            strict.equal(history[0].eventType, "created");
            strict.equal(history[0].metadata?.title, "Test Task with Dependencies");
            strict.deepEqual(history[0].metadata?.dependencies, ["dep-1", "dep-2"]);
            strict.equal(history[0].metadata?.type, "feature");
        });
    });

    describe("Task Status Change Auditing", () => {
        it("should record status change event", async () => {
            await auditService.recordTaskStatusChanged(
                "test-task-3",
                "todo",
                "in-progress",
                "test-user",
                undefined,
                5000
            );

            const history = await auditService.getTaskHistory({ taskId: "test-task-3" });
            strict.equal(history.length, 1);
            strict.equal(history[0].eventType, "status_changed");
            strict.equal(history[0].oldStatus, "todo");
            strict.equal(history[0].newStatus, "in-progress");
            strict.equal(history[0].changedBy, "test-user");
            strict.equal(history[0].duration, 5000);
        });

        it("should record status change with error", async () => {
            await auditService.recordTaskStatusChanged(
                "test-task-4",
                "in-progress",
                "failed",
                "test-user",
                "Execution failed",
                3000
            );

            const history = await auditService.getTaskHistory({ taskId: "test-task-4" });
            strict.equal(history.length, 1);
            strict.equal(history[0].eventType, "status_changed");
            strict.equal(history[0].oldStatus, "in-progress");
            strict.equal(history[0].newStatus, "failed");
            strict.equal(history[0].errorMessage, "Execution failed");
        });
    });

    describe("Task Priority Change Auditing", () => {
        it("should record priority change event", async () => {
            await auditService.recordTaskPriorityChanged(
                "test-task-5",
                "medium",
                "high",
                "test-user"
            );

            const history = await auditService.getTaskHistory({ taskId: "test-task-5" });
            strict.equal(history.length, 1);
            strict.equal(history[0].eventType, "priority_changed");
            strict.equal(history[0].oldPriority, "medium");
            strict.equal(history[0].newPriority, "high");
            strict.equal(history[0].changedBy, "test-user");
        });
    });

    describe("Task Assignment Auditing", () => {
        it("should record task assignment event", async () => {
            await auditService.recordTaskAssigned(
                "test-task-6",
                "assigned-user",
                "assigning-user"
            );

            const history = await auditService.getTaskHistory({ taskId: "test-task-6" });
            strict.equal(history.length, 1);
            strict.equal(history[0].eventType, "assigned");
            strict.equal(history[0].assignedTo, "assigned-user");
            strict.equal(history[0].assignedBy, "assigning-user");
        });

        it("should record assignment without assigner", async () => {
            await auditService.recordTaskAssigned(
                "test-task-7",
                "assigned-user"
            );

            const history = await auditService.getTaskHistory({ taskId: "test-task-7" });
            strict.equal(history.length, 1);
            strict.equal(history[0].eventType, "assigned");
            strict.equal(history[0].assignedTo, "assigned-user");
            strict.equal(history[0].assignedBy, undefined);
        });
    });

    describe("Task Update Auditing", () => {
        it("should record task update event", async () => {
            const metadata = {
                title: "Updated Title",
                description: "Updated Description"
            };

            await auditService.recordTaskUpdated(
                "test-task-8",
                "test-user",
                metadata
            );

            const history = await auditService.getTaskHistory({ taskId: "test-task-8" });
            strict.equal(history.length, 1);
            strict.equal(history[0].eventType, "updated");
            strict.equal(history[0].changedBy, "test-user");
            strict.deepEqual(history[0].metadata, metadata);
        });
    });

    describe("Task Deletion Auditing", () => {
        it("should record task deletion event", async () => {
            await auditService.recordTaskDeleted("test-task-9", "test-user");

            const history = await auditService.getTaskHistory({ taskId: "test-task-9" });
            strict.equal(history.length, 1);
            strict.equal(history[0].eventType, "deleted");
            strict.equal(history[0].taskId, "test-task-9");
            strict.equal(history[0].changedBy, "test-user");
        });
    });

    describe("Dependency Change Auditing", () => {
        it("should record dependency addition event", async () => {
            await auditService.recordDependencyAdded(
                "test-task-10",
                "dep-3",
                "test-user"
            );

            const history = await auditService.getTaskHistory({ taskId: "test-task-10" });
            strict.equal(history.length, 1);
            strict.equal(history[0].eventType, "dependency_added");
            strict.equal(history[0].taskId, "test-task-10");
            strict.equal(history[0].dependencyId, "dep-3");
            strict.equal(history[0].changedBy, "test-user");
        });

        it("should record dependency removal event", async () => {
            await auditService.recordDependencyRemoved(
                "test-task-11",
                "dep-4",
                "test-user"
            );

            const history = await auditService.getTaskHistory({ taskId: "test-task-11" });
            strict.equal(history.length, 1);
            strict.equal(history[0].eventType, "dependency_removed");
            strict.equal(history[0].taskId, "test-task-11");
            strict.equal(history[0].dependencyId, "dep-4");
            strict.equal(history[0].changedBy, "test-user");
        });
    });

    describe("History Querying and Filtering", () => {
        beforeEach(async () => {
            // Create test data
            await auditService.recordTaskCreated({
                id: "filter-test-1",
                title: "Task 1",
                description: "Description 1",
                status: "todo",
                priority: "low",
                createdAt: new Date("2024-01-01").toISOString(),
                updatedAt: new Date("2024-01-01").toISOString(),
                createdBy: "user1",
            }, "user1");

            await auditService.recordTaskStatusChanged("filter-test-1", "todo", "in-progress", "user1");
            await auditService.recordTaskStatusChanged("filter-test-1", "in-progress", "done", "user2");

            await auditService.recordTaskCreated({
                id: "filter-test-2",
                title: "Task 2",
                description: "Description 2",
                status: "todo",
                priority: "high",
                createdAt: new Date("2024-01-02").toISOString(),
                updatedAt: new Date("2024-01-02").toISOString(),
                createdBy: "user2",
            }, "user2");

            await auditService.recordTaskPriorityChanged("filter-test-2", "high", "medium", "user1");
        });

        it("should filter by task ID", async () => {
            const history = await auditService.getTaskHistory({ taskId: "filter-test-1" });
            strict.equal(history.length, 2);
            history.forEach(event => {
                strict.equal(event.taskId, "filter-test-1");
            });
        });

        it("should filter by event type", async () => {
            const history = await auditService.getTaskHistory({ eventType: "status_changed" });
            strict.equal(history.length, 3);
            history.forEach(event => {
                strict.equal(event.eventType, "status_changed");
            });
        });

        it("should filter by changed by user", async () => {
            const history = await auditService.getTaskHistory({ changedBy: "user1" });
            strict.equal(history.length, 2);
            history.forEach(event => {
                strict.equal(event.changedBy, "user1");
            });
        });

        it("should filter by date range", async () => {
            const history = await auditService.getTaskHistory({
                fromDate: new Date("2024-01-02"),
                toDate: new Date("2024-01-02")
            });
            strict.equal(history.length, 2); // Task 2 creation and priority change
        });

        it("should apply multiple filters", async () => {
            const history = await auditService.getTaskHistory({
                eventType: ["created", "priority_changed"],
                changedBy: "user1"
            });
            strict.equal(history.length, 1); // Only priority change by user1
        });

        it("should limit results", async () => {
            const history = await auditService.getTaskHistory({ limit: 2 });
            strict.equal(history.length, 2);
        });

        it("should apply offset", async () => {
            const allHistory = await auditService.getTaskHistory({ limit: 10 });
            const offsetHistory = await auditService.getTaskHistory({ limit: 2, offset: 2 });
            
            strict.equal(offsetHistory.length, 2);
            // The offset history should skip the first 2 and return the next 2
            strict.notDeepEqual(offsetHistory, allHistory.slice(0, 2));
        });
    });

    describe("Task History Summary", () => {
        beforeEach(async () => {
            // Create a complete task lifecycle
            await auditService.recordTaskCreated({
                id: "summary-test-1",
                title: "Summary Test Task",
                description: "Test for summary",
                status: "todo",
                priority: "medium",
                createdAt: new Date("2024-01-01T10:00:00Z").toISOString(),
                updatedAt: new Date("2024-01-01T10:00:00Z").toISOString(),
                createdBy: "test-user",
            }, "test-user");

            await auditService.recordTaskStatusChanged("summary-test-1", "todo", "in-progress", "test-user", undefined, 5000);
            await auditService.recordTaskStatusChanged("summary-test-1", "in-progress", "failed", "test-user", "Failed execution", 3000);
            await auditService.recordTaskStatusChanged("summary-test-1", "failed", "todo", "test-user"); // retry
            await auditService.recordTaskStatusChanged("summary-test-1", "todo", "in-progress", "test-user", undefined, 2000);
            await auditService.recordTaskStatusChanged("summary-test-1", "in-progress", "done", "test-user", undefined, 4000);
        });

        it("should generate task summary correctly", async () => {
            const summary = await auditService.getTaskHistorySummary("summary-test-1");
            
            strict.ok(summary);
            strict.equal(summary.taskId, "summary-test-1");
            strict.equal(summary.totalEvents, 6); // created + 5 status changes
            strict.equal(summary.statusTransitions, 5);
            strict.equal(summary.currentStatus, "done");
            strict.equal(summary.failureCount, 1);
            strict.equal(summary.retryCount, 1);
            strict.ok(summary.firstEvent instanceof Date);
            strict.ok(summary.lastEvent instanceof Date);
            
            // Check total duration (creation to completion)
            const expectedDuration = 5000 + 3000 + 2000 + 4000; // sum of all durations
            strict.equal(summary.totalDuration, expectedDuration);
            
            // Check average transition time
            const expectedAvg = (5000 + 3000 + 2000 + 4000) / 4; // average of 4 status changes
            strict.equal(summary.averageTransitionTime, expectedAvg);
        });

        it("should return null for non-existent task", async () => {
            const summary = await auditService.getTaskHistorySummary("non-existent-task");
            strict.equal(summary, null);
        });
    });

    describe("Audit Statistics", () => {
        beforeEach(async () => {
            // Create diverse test data
            for (let i = 1; i <= 5; i++) {
                await auditService.recordTaskCreated({
                    id: `stats-test-${i}`,
                    title: `Stats Task ${i}`,
                    description: `Description ${i}`,
                    status: "todo",
                    priority: i % 2 === 0 ? "high" : "medium",
                    createdAt: new Date(`2024-01-${i.toString().padStart(2, '0')}`).toISOString(),
                    updatedAt: new Date(`2024-01-${i.toString().padStart(2, '0')}`).toISOString(),
                    createdBy: `user${i}`,
                }, `user${i}`);
                
                if (i <= 3) {
                    await auditService.recordTaskStatusChanged(`stats-test-${i}`, "todo", "done", `user${i}`);
                } else {
                    await auditService.recordTaskStatusChanged(`stats-test-${i}`, "todo", "failed", `user${i}`);
                }
            }
        });

        it("should generate overall statistics", async () => {
            const stats = await auditService.getAuditStatistics();
            
            strict.ok(stats);
            strict.equal(stats.totalEvents, 10); // 5 created + 5 status changes
            strict.ok(stats.eventsByType);
            strict.equal(stats.eventsByType.created, 5);
            strict.equal(stats.eventsByType.status_changed, 5);
            strict.ok(stats.eventsByDate);
            strict.ok(stats.mostActiveTasks);
            strict.ok(stats.dailyStats);
            
            // Check failure rate
            const expectedFailureRate = (2 / 5) * 100; // 2 failed out of 5 completed tasks
            strict.equal(stats.failureRate, expectedFailureRate);
        });

        it("should filter statistics by date range", async () => {
            const stats = await auditService.getAuditStatistics(
                new Date("2024-01-01"),
                new Date("2024-01-03")
            );
            
            strict.equal(stats.totalEvents, 6); // events from first 3 days
            strict.equal(Object.keys(stats.eventsByDate).length, 3); // 3 days of events
        });
    });

    describe("Database Maintenance", () => {
        it("should cleanup old events", async () => {
            // Create old event
            await auditService.recordTaskCreated({
                id: "old-event-task",
                title: "Old Task",
                description: "Should be cleaned up",
                status: "todo",
                priority: "low",
                createdAt: new Date("2020-01-01").toISOString(),
                updatedAt: new Date("2020-01-01").toISOString(),
                createdBy: "old-user",
            }, "old-user");

            const beforeCleanup = await auditService.getTaskHistory({ limit: 100 });
            const deletedCount = await auditService.cleanupOldEvents(1); // Cleanup events older than 1 day
            const afterCleanup = await auditService.getTaskHistory({ limit: 100 });

            strict.ok(deletedCount >= 1); // At least the old event should be deleted
            strict.ok(afterCleanup.length < beforeCleanup.length);
        });
    });
});
