import { describe, it, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import {
    AutomationOverrideService,
    getGlobalAutomationOverrideService,
    resetGlobalAutomationOverrideService,
} from "../src/automation-override-service.ts";
import type {
    CreateOverrideInput,
    AutomationExecution,
} from "../src/automation-override-types.ts";

describe("AutomationOverrideService", () => {
    let service: AutomationOverrideService;

    beforeEach(() => {
        resetGlobalAutomationOverrideService();
        service = new AutomationOverrideService();
    });

    describe("createOverride", () => {
        it("should create a pause_all override", async () => {
            const input: CreateOverrideInput = {
                action: "pause_all",
                reason: "System maintenance",
                userId: "user-123",
            };

            const result = await service.createOverride(input);

            assert.equal(result.success, true);
            assert.ok(result.overrideId);
            assert.ok(result.message?.includes("paused"));
            assert.equal(service.isAutomationPaused(), true);
        });

        it("should create a resume_all override", async () => {
            await service.createOverride({
                action: "pause_all",
                reason: "Test",
                userId: "user-123",
            });

            const result = await service.createOverride({
                action: "resume_all",
                reason: "Maintenance complete",
                userId: "user-123",
            });

            assert.equal(result.success, true);
            assert.equal(service.isAutomationPaused(), false);
        });

        it("should create an override with duration", async () => {
            const input: CreateOverrideInput = {
                action: "pause_all",
                reason: "Temporary pause",
                userId: "user-123",
                duration: 3600,
            };

            const result = await service.createOverride(input);

            assert.equal(result.success, true);
            const overrides = service.getActiveOverrides();
            assert.ok(overrides[0].expiresAt);
        });
    });

    describe("cancel_execution", () => {
        it("should cancel an active execution", async () => {
            const execution: AutomationExecution = {
                id: "exec-123",
                ruleId: "rule-456",
                ruleName: "Test Rule",
                status: "running",
                startedAt: new Date(),
            };

            service.registerExecution(execution);

            const result = await service.createOverride({
                action: "cancel_execution",
                targetId: "exec-123",
                reason: "User requested cancellation",
                userId: "user-123",
            });

            assert.equal(result.success, true);
            assert.ok(result.message?.includes("cancelled"));
            assert.equal(service.getActiveExecutions().length, 0);
        });

        it("should fail to cancel non-existent execution", async () => {
            const result = await service.createOverride({
                action: "cancel_execution",
                targetId: "non-existent",
                reason: "Test",
                userId: "user-123",
            });

            assert.equal(result.success, false);
            assert.ok(result.error?.includes("not found"));
        });

        it("should fail to cancel execution without targetId", async () => {
            const result = await service.createOverride({
                action: "cancel_execution",
                reason: "Test",
                userId: "user-123",
            });

            assert.equal(result.success, false);
            assert.ok(result.error?.includes("targetId is required"));
        });
    });

    describe("disable_rule", () => {
        it("should disable a rule", async () => {
            const result = await service.createOverride({
                action: "disable_rule",
                targetId: "rule-123",
                reason: "Rule causing issues",
                userId: "user-123",
            });

            assert.equal(result.success, true);
            assert.equal(service.isRuleDisabled("rule-123"), true);
        });

        it("should fail to disable rule without targetId", async () => {
            const result = await service.createOverride({
                action: "disable_rule",
                reason: "Test",
                userId: "user-123",
            });

            assert.equal(result.success, false);
            assert.ok(result.error?.includes("targetId is required"));
        });
    });

    describe("enable_rule", () => {
        it("should enable a previously disabled rule", async () => {
            await service.createOverride({
                action: "disable_rule",
                targetId: "rule-123",
                reason: "Test",
                userId: "user-123",
            });

            const result = await service.createOverride({
                action: "enable_rule",
                targetId: "rule-123",
                reason: "Rule fixed",
                userId: "user-123",
            });

            assert.equal(result.success, true);
            assert.equal(service.isRuleDisabled("rule-123"), false);
        });

        it("should fail to enable rule without targetId", async () => {
            const result = await service.createOverride({
                action: "enable_rule",
                reason: "Test",
                userId: "user-123",
            });

            assert.equal(result.success, false);
            assert.ok(result.error?.includes("targetId is required"));
        });
    });

    describe("emergency_stop", () => {
        it("should pause automation and cancel all active executions", async () => {
            const exec1: AutomationExecution = {
                id: "exec-1",
                ruleId: "rule-1",
                ruleName: "Rule 1",
                status: "running",
                startedAt: new Date(),
            };
            const exec2: AutomationExecution = {
                id: "exec-2",
                ruleId: "rule-2",
                ruleName: "Rule 2",
                status: "running",
                startedAt: new Date(),
            };

            service.registerExecution(exec1);
            service.registerExecution(exec2);

            const result = await service.createOverride({
                action: "emergency_stop",
                reason: "Critical system issue",
                userId: "admin-123",
            });

            assert.equal(result.success, true);
            assert.equal(service.isAutomationPaused(), true);
            assert.equal(service.getActiveExecutions().length, 0);
            assert.ok(result.message?.includes("2"));
        });
    });

    describe("execution management", () => {
        it("should register and complete execution", () => {
            const execution: AutomationExecution = {
                id: "exec-123",
                ruleId: "rule-456",
                ruleName: "Test Rule",
                status: "running",
                startedAt: new Date(),
            };

            service.registerExecution(execution);
            assert.equal(service.getActiveExecutions().length, 1);

            service.completeExecution("exec-123", { success: true });
            assert.equal(service.getActiveExecutions().length, 0);
            assert.equal(service.getExecutionHistory().length, 1);
        });

        it("should register and fail execution", () => {
            const execution: AutomationExecution = {
                id: "exec-123",
                ruleId: "rule-456",
                ruleName: "Test Rule",
                status: "running",
                startedAt: new Date(),
            };

            service.registerExecution(execution);
            service.failExecution("exec-123", "Something went wrong");

            const history = service.getExecutionHistory();
            assert.equal(history.length, 1);
            assert.equal(history[0].status, "failed");
            assert.equal(history[0].error, "Something went wrong");
        });

        it("should provide abort signal for execution", () => {
            const execution: AutomationExecution = {
                id: "exec-123",
                ruleId: "rule-456",
                ruleName: "Test Rule",
                status: "running",
                startedAt: new Date(),
            };

            const signal = service.registerExecution(execution);
            assert.ok(signal);
            assert.equal(signal.aborted, false);
        });
    });

    describe("revokeOverride", () => {
        it("should revoke an active override", async () => {
            const createResult = await service.createOverride({
                action: "pause_all",
                reason: "Test",
                userId: "user-123",
            });

            const revokeResult = service.revokeOverride(
                createResult.overrideId!,
                "user-456"
            );

            assert.equal(revokeResult.success, true);
            assert.equal(service.isAutomationPaused(), false);
        });

        it("should fail to revoke non-existent override", () => {
            const result = service.revokeOverride("non-existent", "user-123");
            assert.equal(result.success, false);
            assert.ok(result.error?.includes("not found"));
        });

        it("should re-enable rule when disable override is revoked", async () => {
            const createResult = await service.createOverride({
                action: "disable_rule",
                targetId: "rule-123",
                reason: "Test",
                userId: "user-123",
            });

            assert.equal(service.isRuleDisabled("rule-123"), true);

            service.revokeOverride(createResult.overrideId!, "user-456");

            assert.equal(service.isRuleDisabled("rule-123"), false);
        });
    });

    describe("getStatus", () => {
        it("should return current status", async () => {
            const execution: AutomationExecution = {
                id: "exec-123",
                ruleId: "rule-456",
                ruleName: "Test Rule",
                status: "running",
                startedAt: new Date(),
            };
            service.registerExecution(execution);

            await service.createOverride({
                action: "disable_rule",
                targetId: "rule-789",
                reason: "Test",
                userId: "user-123",
            });

            await service.createOverride({
                action: "pause_all",
                reason: "Test",
                userId: "user-123",
            });

            const status = service.getStatus();

            assert.equal(status.isPaused, true);
            assert.equal(status.activeExecutions, 1);
            assert.equal(status.disabledRules, 1);
            assert.equal(status.activeOverrides, 2);
        });
    });

    describe("event listeners", () => {
        it("should notify listeners when override is created", async () => {
            let listenerCalled = false;
            let receivedOverride: any = null;

            service.onOverride((override) => {
                listenerCalled = true;
                receivedOverride = override;
            });

            await service.createOverride({
                action: "pause_all",
                reason: "Test",
                userId: "user-123",
            });

            assert.equal(listenerCalled, true);
            assert.equal(receivedOverride.action, "pause_all");
            assert.equal(receivedOverride.reason, "Test");
            assert.equal(receivedOverride.userId, "user-123");
        });
    });

    describe("global service", () => {
        it("should return singleton instance", () => {
            const service1 = getGlobalAutomationOverrideService();
            const service2 = getGlobalAutomationOverrideService();

            assert.equal(service1, service2);
        });

        it("should reset global service", () => {
            const service1 = getGlobalAutomationOverrideService();
            resetGlobalAutomationOverrideService();
            const service2 = getGlobalAutomationOverrideService();

            assert.notEqual(service1, service2);
        });
    });
});
