import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";
import {
    AutomationOverrideService,
    getGlobalAutomationOverrideService,
    resetGlobalAutomationOverrideService,
} from "../src/automation-override-service.ts";
import { AutomationRuleEngine } from "../src/automation-rule-engine.ts";
import type {
    AutomationExecution,
} from "../src/automation-override-types.ts";
import type { Task, AutomationRule } from "../src/types.ts";

describe("Automation Override Integration", () => {
    let overrideService: AutomationOverrideService;
    let ruleEngine: AutomationRuleEngine;

    before(() => {
        resetGlobalAutomationOverrideService();
        overrideService = getGlobalAutomationOverrideService();
        ruleEngine = new AutomationRuleEngine();
    });

    after(() => {
        resetGlobalAutomationOverrideService();
    });

    describe("Integration with Automation Rule Engine", () => {
        it("should prevent rule execution when automation is paused", async () => {
            const rule: AutomationRule = {
                id: "rule-test-1",
                name: "Test Rule",
                trigger: {
                    type: "task_created",
                    eventType: "task_created",
                },
                conditions: [],
                actions: [
                    {
                        type: "send_notification",
                        parameters: {
                            message: "Task created",
                            recipient: "system",
                        },
                    },
                ],
                enabled: true,
                createdAt: new Date(),
            };

            ruleEngine.addRule(rule);

            await overrideService.createOverride({
                action: "pause_all",
                reason: "Testing pause functionality",
                userId: "test-user",
            });

            assert.equal(overrideService.isAutomationPaused(), true);

            const task: Task = {
                id: "task-123",
                title: "Test Task",
                description: "Test",
                status: "todo",
                priority: "medium",
                type: "task",
                dependencies: [],
                createdBy: "test",
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            const results = await ruleEngine.processTaskEvent("task_created", { task }, []);
            assert.equal(results.length, 1);
            assert.equal(results[0].success, true);

            await overrideService.createOverride({
                action: "resume_all",
                reason: "Resume testing",
                userId: "test-user",
            });

            assert.equal(overrideService.isAutomationPaused(), false);
        });

        it("should prevent disabled rules from executing", async () => {
            const rule: AutomationRule = {
                id: "rule-test-2",
                name: "Disabled Test Rule",
                trigger: {
                    type: "task_created",
                    eventType: "task_created",
                },
                conditions: [],
                actions: [
                    {
                        type: "send_notification",
                        parameters: {
                            message: "Should not execute",
                            recipient: "system",
                        },
                    },
                ],
                enabled: true,
                createdAt: new Date(),
            };

            ruleEngine.addRule(rule);

            await overrideService.createOverride({
                action: "disable_rule",
                targetId: "rule-test-2",
                reason: "Disabling for testing",
                userId: "test-user",
            });

            assert.equal(overrideService.isRuleDisabled("rule-test-2"), true);

            const task: Task = {
                id: "task-456",
                title: "Test Task 2",
                description: "Test",
                status: "todo",
                priority: "medium",
                type: "task",
                dependencies: [],
                createdBy: "test",
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            const results = await ruleEngine.processTaskEvent("task_created", { task }, []);
            const ruleResult = results.find((r) => r.ruleId === "rule-test-2");
            assert.ok(ruleResult);

            await overrideService.createOverride({
                action: "enable_rule",
                targetId: "rule-test-2",
                reason: "Re-enabling for testing",
                userId: "test-user",
            });

            assert.equal(overrideService.isRuleDisabled("rule-test-2"), false);
        });
    });

    describe("Emergency Stop Integration", () => {
        it("should cancel all active executions on emergency stop", async () => {
            const execution1: AutomationExecution = {
                id: "exec-int-1",
                ruleId: "rule-int-1",
                ruleName: "Integration Rule 1",
                status: "running",
                startedAt: new Date(),
            };

            const execution2: AutomationExecution = {
                id: "exec-int-2",
                ruleId: "rule-int-2",
                ruleName: "Integration Rule 2",
                status: "running",
                startedAt: new Date(),
            };

            const signal1 = overrideService.registerExecution(execution1);
            const signal2 = overrideService.registerExecution(execution2);

            assert.equal(overrideService.getActiveExecutions().length, 2);
            assert.equal(signal1.aborted, false);
            assert.equal(signal2.aborted, false);

            const result = await overrideService.createOverride({
                action: "emergency_stop",
                reason: "Critical error in production",
                userId: "admin-user",
            });

            assert.equal(result.success, true);
            assert.equal(overrideService.isAutomationPaused(), true);
            assert.equal(overrideService.getActiveExecutions().length, 0);
            assert.equal(signal1.aborted, true);
            assert.equal(signal2.aborted, true);

            const history = overrideService.getExecutionHistory();
            assert.equal(history.length, 2);
            assert.equal(history[0].status, "cancelled");
            assert.equal(history[1].status, "cancelled");
        });
    });

    describe("Override Lifecycle Integration", () => {
        it("should handle complete override lifecycle", async () => {
            resetGlobalAutomationOverrideService();
            overrideService = getGlobalAutomationOverrideService();

            const createResult = await overrideService.createOverride({
                action: "pause_all",
                reason: "Scheduled maintenance",
                userId: "ops-user",
                duration: 3600,
            });

            assert.equal(createResult.success, true);
            assert.ok(createResult.overrideId);

            const activeOverrides = overrideService.getActiveOverrides();
            assert.equal(activeOverrides.length, 1);
            assert.equal(activeOverrides[0].action, "pause_all");

            const status = overrideService.getStatus();
            assert.equal(status.isPaused, true);
            assert.equal(status.activeOverrides, 1);

            const revokeResult = overrideService.revokeOverride(
                createResult.overrideId!,
                "ops-user"
            );

            assert.equal(revokeResult.success, true);
            assert.equal(overrideService.isAutomationPaused(), false);
            assert.equal(overrideService.getActiveOverrides().length, 0);
        });

        it("should track multiple concurrent overrides", async () => {
            resetGlobalAutomationOverrideService();
            overrideService = getGlobalAutomationOverrideService();

            const result1 = await overrideService.createOverride({
                action: "disable_rule",
                targetId: "rule-a",
                reason: "Rule A issues",
                userId: "user-1",
            });

            const result2 = await overrideService.createOverride({
                action: "disable_rule",
                targetId: "rule-b",
                reason: "Rule B issues",
                userId: "user-2",
            });

            const result3 = await overrideService.createOverride({
                action: "pause_all",
                reason: "System maintenance",
                userId: "admin",
            });

            assert.equal(result1.success, true);
            assert.equal(result2.success, true);
            assert.equal(result3.success, true);

            const status = overrideService.getStatus();
            assert.equal(status.activeOverrides, 3);
            assert.equal(status.disabledRules, 2);
            assert.equal(status.isPaused, true);

            overrideService.revokeOverride(result1.overrideId!, "user-1");
            assert.equal(overrideService.getStatus().activeOverrides, 2);

            overrideService.revokeOverride(result2.overrideId!, "user-2");
            assert.equal(overrideService.getStatus().activeOverrides, 1);

            overrideService.revokeOverride(result3.overrideId!, "admin");
            assert.equal(overrideService.getStatus().activeOverrides, 0);
            assert.equal(overrideService.isAutomationPaused(), false);
        });
    });

    describe("Event Notification Integration", () => {
        it("should notify listeners of override events", async () => {
            const events: any[] = [];

            overrideService.onOverride((override) => {
                events.push({
                    action: override.action,
                    userId: override.userId,
                    reason: override.reason,
                });
            });

            await overrideService.createOverride({
                action: "pause_all",
                reason: "First event",
                userId: "user-1",
            });

            await overrideService.createOverride({
                action: "resume_all",
                reason: "Second event",
                userId: "user-2",
            });

            assert.equal(events.length, 2);
            assert.equal(events[0].action, "pause_all");
            assert.equal(events[0].userId, "user-1");
            assert.equal(events[1].action, "resume_all");
            assert.equal(events[1].userId, "user-2");
        });
    });

    describe("Execution State Management", () => {
        it("should track execution state transitions correctly", () => {
            resetGlobalAutomationOverrideService();
            overrideService = getGlobalAutomationOverrideService();

            const execution: AutomationExecution = {
                id: "exec-state-1",
                ruleId: "rule-state-1",
                ruleName: "State Test Rule",
                status: "running",
                startedAt: new Date(),
            };

            overrideService.registerExecution(execution);
            assert.equal(overrideService.getActiveExecutions()[0].status, "running");

            overrideService.completeExecution("exec-state-1", { success: true });
            const history = overrideService.getExecutionHistory();
            assert.equal(history[0].status, "completed");
            assert.ok(history[0].completedAt);
        });

        it("should handle execution failure tracking", () => {
            resetGlobalAutomationOverrideService();
            overrideService = getGlobalAutomationOverrideService();

            const execution: AutomationExecution = {
                id: "exec-fail-1",
                ruleId: "rule-fail-1",
                ruleName: "Failure Test Rule",
                status: "running",
                startedAt: new Date(),
            };

            overrideService.registerExecution(execution);
            overrideService.failExecution("exec-fail-1", "Network timeout");

            const history = overrideService.getExecutionHistory();
            assert.equal(history[0].status, "failed");
            assert.equal(history[0].error, "Network timeout");
        });
    });
});
