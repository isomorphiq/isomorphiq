import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import {
    PriorityThresholdTriggerService,
    createPriorityThresholdTriggerService,
    getGlobalPriorityThresholdTriggerService,
    setGlobalPriorityThresholdTriggerService,
    defaultPriorityThresholdServiceConfig,
} from "../src/priority-threshold-trigger-service.ts";
import {
    PriorityThresholdConfigStruct,
} from "../src/priority-threshold-types.ts";
import type { PriorityThresholdConfig } from "../src/priority-threshold-types.ts";
import type { TaskPriority } from "@isomorphiq/types";

// Simple expect helper
const expect = (value: unknown) => ({
    toBe: (expected: unknown) => assert.strictEqual(value, expected),
    toEqual: (expected: unknown) => assert.deepStrictEqual(value, expected),
    toContain: (expected: unknown) => assert.ok(
        Array.isArray(value) ? value.includes(expected) : String(value).includes(String(expected))
    ),
    toHaveLength: (expected: number) => assert.strictEqual((value as { length: number }).length, expected),
    toBeDefined: () => assert.notStrictEqual(value, undefined),
    toBeTruthy: () => assert.ok(value),
    toBeNull: () => assert.strictEqual(value, null),
    toMatch: (expected: RegExp | string) => {
        const str = String(value);
        assert.ok(expected instanceof RegExp ? expected.test(str) : str.includes(expected));
    },
    toBeGreaterThan: (expected: number) => assert.ok((value as number) > expected),
    toBeGreaterThanOrEqual: (expected: number) => assert.ok((value as number) >= expected),
    toBeLessThan: (expected: number) => assert.ok((value as number) < expected),
    toBeLessThanOrEqual: (expected: number) => assert.ok((value as number) <= expected),
    not: {
        toBe: (expected: unknown) => assert.notStrictEqual(value, expected),
        toEqual: (expected: unknown) => assert.notDeepStrictEqual(value, expected),
        toContain: (expected: unknown) => assert.ok(
            Array.isArray(value) ? !value.includes(expected) : !String(value).includes(String(expected))
        ),
    },
});

describe("PriorityThresholdTriggerService", () => {
    let service: PriorityThresholdTriggerService;

    beforeEach(() => {
        service = createPriorityThresholdTriggerService({
            enableLogging: true,
            defaultDebounceMs: 100,
            defaultCooldownMs: 1000,
        });
    });

    afterEach(() => {
        service.stop();
    });

    describe("Configuration Management", () => {
        it("should register a threshold configuration", () => {
            const config = createTestConfig("High Priority Trigger", "high", "pipeline-1");
            const result = service.registerThresholdConfig(config);

            expect(result.success).toBe(true);
            expect(service.getThresholdConfig(config.id)).toBeDefined();
        });

        it("should reject invalid threshold configuration", () => {
            const invalidConfig = {
                id: "test",
                name: "Test",
                // Missing required fields
            } as PriorityThresholdConfig;

            const result = service.registerThresholdConfig(invalidConfig);
            expect(result.success).toBe(false);
        });

        it("should unregister a threshold configuration", () => {
            const config = createTestConfig("Test", "high", "pipeline-1");
            service.registerThresholdConfig(config);

            const removed = service.unregisterThresholdConfig(config.id);
            expect(removed).toBe(true);
            assert.strictEqual(service.getThresholdConfig(config.id), undefined);
        });

        it("should return all registered configurations", () => {
            const config1 = createTestConfig("Config 1", "high", "pipeline-1");
            const config2 = createTestConfig("Config 2", "critical", "pipeline-2");

            service.registerThresholdConfig(config1);
            service.registerThresholdConfig(config2);

            const configs = service.getThresholdConfigs();
            expect(configs).toHaveLength(2);
        });
    });

    describe("Priority Evaluation", () => {
        it("should trigger when priority meets threshold (greater_than_or_equal)", async () => {
            const config = createTestConfig("High Trigger", "high", "pipeline-1");
            service.registerThresholdConfig(config);

            const results = await service.evaluatePriorityChange("story-1", "medium", "high");

            expect(results).toHaveLength(1);
            expect(results[0].shouldTrigger).toBe(true);
            expect(results[0].reason).toContain("meets threshold");
        });

        it("should not trigger when priority is below threshold", async () => {
            const config = createTestConfig("High Trigger", "high", "pipeline-1");
            service.registerThresholdConfig(config);

            const results = await service.evaluatePriorityChange("story-1", "low", "medium");

            expect(results).toHaveLength(1);
            expect(results[0].shouldTrigger).toBe(false);
        });

        it("should trigger for equals comparison when priorities match", async () => {
            const config = createTestConfig("Exact High", "high", "pipeline-1", "equals");
            service.registerThresholdConfig(config);

            const results = await service.evaluatePriorityChange("story-1", "medium", "high");

            expect(results[0].shouldTrigger).toBe(true);
        });

        it("should not trigger for equals comparison when priorities differ", async () => {
            const config = createTestConfig("Exact High", "high", "pipeline-1", "equals");
            service.registerThresholdConfig(config);

            const results = await service.evaluatePriorityChange("story-1", "low", "high");

            expect(results[0].shouldTrigger).toBe(false);
        });

        it("should trigger for greater_than comparison when priority exceeds threshold", async () => {
            const config = createTestConfig("Above Medium", "medium", "pipeline-1", "greater_than");
            service.registerThresholdConfig(config);

            const results = await service.evaluatePriorityChange("story-1", "medium", "high");

            expect(results[0].shouldTrigger).toBe(true);
        });

        it("should not trigger for greater_than when priority equals threshold", async () => {
            const config = createTestConfig("Above Medium", "medium", "pipeline-1", "greater_than");
            service.registerThresholdConfig(config);

            const results = await service.evaluatePriorityChange("story-1", "low", "medium");

            expect(results[0].shouldTrigger).toBe(false);
        });

        it("should not trigger for disabled configurations", async () => {
            const config = createTestConfig("Disabled", "high", "pipeline-1");
            config.enabled = false;
            service.registerThresholdConfig(config);

            const results = await service.evaluatePriorityChange("story-1", "low", "high");

            expect(results).toHaveLength(0);
        });
    });

    describe("Cooldown and Rate Limiting", () => {
        it("should respect cooldown period", async () => {
            const config = createTestConfig("High Trigger", "high", "pipeline-1");
            config.cooldownMs = 5000; // 5 second cooldown
            service.registerThresholdConfig(config);

            // First trigger
            const results1 = await service.evaluatePriorityChange("story-1", "low", "high");
            expect(results1[0].shouldTrigger).toBe(true);

            // Second trigger within cooldown
            const results2 = await service.evaluatePriorityChange("story-1", "medium", "high");
            expect(results2[0].shouldTrigger).toBe(false);
            expect(results2[0].cooldownActive).toBe(true);
        });

        it("should respect max triggers per story limit", async () => {
            const config = createTestConfig("High Trigger", "high", "pipeline-1");
            config.maxTriggersPerStory = 2;
            config.cooldownMs = 0; // No cooldown for this test
            service.registerThresholdConfig(config);

            // First two triggers should work
            await service.evaluatePriorityChange("story-1", "low", "high");
            await service.evaluatePriorityChange("story-1", "medium", "high");

            // Third trigger should be blocked
            const results = await service.evaluatePriorityChange("story-1", "low", "high");
            expect(results[0].maxTriggersReached).toBe(true);
            expect(results[0].shouldTrigger).toBe(false);
        });
    });

    describe("Event Logging", () => {
        it("should log trigger events", async () => {
            const config = createTestConfig("High Trigger", "high", "pipeline-1");
            service.registerThresholdConfig(config);

            await service.evaluatePriorityChange("story-1", "low", "high");

            // Wait for debounce
            await sleep(200);

            const logs = service.getEventLogs("story-1");
            expect(logs.length).toBeGreaterThan(0);
            expect(logs[0].storyId).toBe("story-1");
            expect(logs[0].newPriority).toBe("high");
        });

        it("should include metadata in logs", async () => {
            const config = createTestConfig("High Trigger", "high", "pipeline-1");
            service.registerThresholdConfig(config);

            const metadata = { userId: "user-1", reason: "urgent" };
            await service.evaluatePriorityChange("story-1", "low", "high", metadata);

            const logs = service.getEventLogs("story-1");
            expect(logs[0].metadata).toEqual(metadata);
        });

        it("should limit log entries to maxLogEntries", async () => {
            const limitedService = createPriorityThresholdTriggerService({
                maxLogEntries: 5,
                enableLogging: true,
            });

            const config = createTestConfig("High Trigger", "high", "pipeline-1");
            limitedService.registerThresholdConfig(config);

            // Generate more events than maxLogEntries
            for (let i = 0; i < 10; i++) {
                await limitedService.evaluatePriorityChange(`story-${i}`, "low", "high");
            }

            const logs = limitedService.getEventLogs();
            expect(logs.length).toBeLessThanOrEqual(5);

            limitedService.stop();
        });
    });

    describe("Pipeline Execution", () => {
        it("should register and execute pipeline executor", async () => {
            const config = createTestConfig("High Trigger", "high", "pipeline-1");
            service.registerThresholdConfig(config);

            let executed = false;
            service.registerPipelineExecutor("pipeline-1", async (request) => {
                executed = true;
                expect(request.storyId).toBe("story-1");
                expect(request.priority).toBe("high");
                return { success: true, data: undefined };
            });

            await service.evaluatePriorityChange("story-1", "low", "high");

            // Wait for debounce and execution
            await sleep(300);

            expect(executed).toBe(true);
        });

        it("should track pending execution requests", async () => {
            const config = createTestConfig("High Trigger", "high", "pipeline-1");
            config.debounceMs = 500; // Long debounce to keep it pending
            service.registerThresholdConfig(config);

            await service.evaluatePriorityChange("story-1", "low", "high");

            const pending = service.getPendingRequests();
            expect(pending.length).toBeGreaterThan(0);
        });
    });

    describe("Story State Management", () => {
        it("should track trigger state per story", async () => {
            const config = createTestConfig("High Trigger", "high", "pipeline-1");
            service.registerThresholdConfig(config);

            await service.evaluatePriorityChange("story-1", "low", "high");

            const state = service.getStoryTriggerState("story-1", config.id);
            expect(state).toBeDefined();
            expect(state?.storyId).toBe("story-1");
            expect(state?.triggerCount).toBeGreaterThan(0);
        });

        it("should reset story trigger state", async () => {
            const config = createTestConfig("High Trigger", "high", "pipeline-1");
            service.registerThresholdConfig(config);

            await service.evaluatePriorityChange("story-1", "low", "high");

            const reset = service.resetStoryTriggerState("story-1", config.id);
            expect(reset).toBe(true);

            const state = service.getStoryTriggerState("story-1", config.id);
            expect(state?.triggerCount).toBe(0);
        });
    });

    describe("Statistics", () => {
        it("should track service statistics", async () => {
            const config1 = createTestConfig("Config 1", "high", "pipeline-1");
            const config2 = createTestConfig("Config 2", "critical", "pipeline-2");
            config2.enabled = false;

            service.registerThresholdConfig(config1);
            service.registerThresholdConfig(config2);

            await service.evaluatePriorityChange("story-1", "low", "high");
            await service.evaluatePriorityChange("story-2", "medium", "high");

            const stats = service.getStats();
            expect(stats.totalConfigs).toBe(2);
            expect(stats.enabledConfigs).toBe(1);
            expect(stats.totalEvaluations).toBe(2);
            expect(stats.lastEvaluationAt).toBeDefined();
        });
    });

    describe("Global Service", () => {
        it("should provide singleton global service", () => {
            const global1 = getGlobalPriorityThresholdTriggerService();
            const global2 = getGlobalPriorityThresholdTriggerService();

            expect(global1).toBe(global2);
        });

        it("should allow setting global service", () => {
            const newService = createPriorityThresholdTriggerService();
            setGlobalPriorityThresholdTriggerService(newService);

            const global = getGlobalPriorityThresholdTriggerService();
            expect(global).toBe(newService);

            global.stop();
        });
    });

    describe("Default Config", () => {
        it("should have sensible default configuration", () => {
            expect(defaultPriorityThresholdServiceConfig.defaultDebounceMs).toBe(1000);
            expect(defaultPriorityThresholdServiceConfig.defaultCooldownMs).toBe(3600000);
            expect(defaultPriorityThresholdServiceConfig.enableLogging).toBe(true);
            expect(defaultPriorityThresholdServiceConfig.enableRealTimeEvaluation).toBe(true);
        });
    });
});

// Helper functions
function createTestConfig(
    name: string,
    thresholdLevel: "low" | "medium" | "high" | "critical",
    pipelineId: string,
    comparison: "equals" | "greater_than_or_equal" | "greater_than" = "greater_than_or_equal",
): PriorityThresholdConfig {
    return PriorityThresholdConfigStruct.from({
        id: `threshold-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        name,
        thresholdLevel,
        comparison,
        pipelineId,
        enabled: true,
        debounceMs: 100,
        maxTriggersPerStory: 10,
        cooldownMs: 1000,
        requireConfirmation: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: "test",
    });
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
