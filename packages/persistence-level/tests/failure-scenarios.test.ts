#!/usr/bin/env node

/**
 * Failure scenario and recovery tests for persistence adapters
 * Tests behavior under error conditions and recovery mechanisms
 */

import { LevelKeyValueAdapter } from "@isomorphiq/persistence-level";
import { expect } from "../../../tests/test-utils/expect.ts";
import { randomUUID } from "node:crypto";

class FailureScenarioTester {
    
    async runAllTests(): Promise<void> {
        console.log("🧪 Starting Failure Scenario and Recovery Tests\n");

        await this.testClosedAdapterOperations();
        await this.testInvalidKeyOperations();
        await this.testDataCorruptionHandling();
        await this.testResourceExhaustion();
        await this.testConcurrentFailureScenarios();

        console.log("\n✅ All failure scenario tests completed!");
    }

    private async testClosedAdapterOperations(): Promise<void> {
        console.log("Testing operations on closed adapter...");

        const adapter = new LevelKeyValueAdapter<string, unknown>(`/tmp/test-closed-${randomUUID()}`);
        
        // Test operations on closed adapter
        try {
            await adapter.get("test");
            throw new Error("Expected get to throw on closed adapter");
        } catch (error) {
            expect(error).toBeInstanceOf(Error);
        }

        try {
            await adapter.put("test", "value");
            throw new Error("Expected put to throw on closed adapter");
        } catch (error) {
            expect(error).toBeInstanceOf(Error);
        }

        try {
            await adapter.del("test");
            throw new Error("Expected del to throw on closed adapter");
        } catch (error) {
            expect(error).toBeInstanceOf(Error);
        }

        // Test iterator on closed adapter
        try {
            const iterator = adapter.iterator();
            throw new Error("Expected iterator to throw on closed adapter");
        } catch (error) {
            expect(error).toBeInstanceOf(Error);
        }

        console.log("✅ Closed adapter operations tests passed");
    }

    private async testInvalidKeyOperations(): Promise<void> {
        console.log("Testing operations with invalid keys...");

        const adapter = new LevelKeyValueAdapter<string, unknown>(`/tmp/test-invalid-${randomUUID()}`);
        await adapter.open();

        try {
            // Test non-existent key retrieval
            try {
                await adapter.get("non-existent-key");
                throw new Error("Expected get to throw for non-existent key");
            } catch (error) {
                expect(error).toBeInstanceOf(Error);
            }

            // Test deletion of non-existent key (should not throw)
            await adapter.del("another-non-existent-key");

            // Test empty key operations
            await adapter.put("", "empty-key-test");
            const emptyKeyValue = await adapter.get("");
            expect(emptyKeyValue).toBe("empty-key-test");

            // Test very long key
            const longKey = "x".repeat(1000);
            await adapter.put(longKey, "long-key-test");
            const longKeyValue = await adapter.get(longKey);
            expect(longKeyValue).toBe("long-key-test");

        } finally {
            await adapter.close();
        }

        console.log("✅ Invalid key operations tests passed");
    }

    private async testDataCorruptionHandling(): Promise<void> {
        console.log("Testing data corruption handling...");

        const adapter = new LevelKeyValueAdapter<string, unknown>(`/tmp/test-corruption-${randomUUID()}`);
        await adapter.open();

        try {
            // Test circular reference (should be handled gracefully)
            const circularData: any = { name: "test" };
            circularData.self = circularData;

            try {
                await adapter.put("circular", circularData);
                // LevelDB with JSON encoding should handle this by failing gracefully
                console.log("⚠️  Circular reference handling depends on JSON.stringify");
            } catch (error) {
                expect(error).toBeInstanceOf(Error);
            }

            // Test undefined values (LevelDB doesn't allow them)
            try {
                await adapter.put("undefined", undefined);
                throw new Error("Expected undefined to be rejected");
            } catch (error) {
                expect(error).toBeInstanceOf(Error);
            }

            // Test null values (LevelDB doesn't allow them)
            try {
                await adapter.put("null", null);
                throw new Error("Expected null to be rejected");
            } catch (error) {
                expect(error).toBeInstanceOf(Error);
            }

            // Test special characters in keys and values
            const specialKey = "special-key-!@#$%^&*(){}[]|\\:;\"'<>,.?/~`";
            const specialValue = {
                text: "Special chars: !@#$%^&*()",
                unicode: "Unicode: αβγδεζηθ",
                emoji: "Emoji: 🚀🧪✅❌",
                control: "Control: \t\n\r"
            };

            await adapter.put(specialKey, specialValue);
            const retrievedSpecial = await adapter.get(specialKey);
            expect(retrievedSpecial).toEqual(specialValue);

        } finally {
            await adapter.close();
        }

        console.log("✅ Data corruption handling tests passed");
    }

    private async testResourceExhaustion(): Promise<void> {
        console.log("Testing resource exhaustion scenarios...");

        const adapter = new LevelKeyValueAdapter<string, unknown>(`/tmp/test-resources-${randomUUID()}`);
        await adapter.open();

        try {
            // Test large object storage
            const largeObject = {
                data: "x".repeat(1024 * 1024), // 1MB of data
                array: new Array(10000).fill(0).map((_, i) => ({ index: i, data: `item-${i}` }))
            };

            await adapter.put("large-object", largeObject);
            const retrievedLarge = await adapter.get("large-object");
            expect(retrievedLarge.data).toHaveLength(1024 * 1024);
            expect(retrievedLarge.array).toHaveLength(10000);

            // Test many small objects
            const batchSize = 1000;
            if (adapter.batch) {
                const batchOps = [];
                for (let i = 0; i < batchSize; i++) {
                    batchOps.push({
                        type: "put" as const,
                        key: `batch-${i}`,
                        value: { index: i, data: `test-data-${i}`.repeat(10) }
                    });
                }
                await adapter.batch(batchOps);
                
                // Verify batch insertion
                const firstItem = await adapter.get("batch-0");
                const lastItem = await adapter.get("batch-999");
                expect(firstItem).toEqual({ index: 0, data: `test-data-0`.repeat(10) });
                expect(lastItem).toEqual({ index: 999, data: `test-data-999`.repeat(10) });
            }

            // Test iterator with large dataset
            let itemCount = 0;
            const iterator = adapter.iterator({ limit: 500 });
            for await (const [key, value] of iterator) {
                itemCount++;
                if (itemCount > 100) break; // Limit iteration time
            }
            await iterator.close();
            expect(itemCount).toBeGreaterThan(0);

        } finally {
            await adapter.close();
        }

        console.log("✅ Resource exhaustion tests passed");
    }

    private async testConcurrentFailureScenarios(): Promise<void> {
        console.log("Testing concurrent failure scenarios...");

        const adapter = new LevelKeyValueAdapter<string, unknown>(`/tmp/test-concurrent-${randomUUID()}`);
        await adapter.open();

        try {
            // Test concurrent operations with mixed success/failure
            const promises = [];
            const results: Array<{ success: boolean; error?: string }> = [];

            // Successful operations
            for (let i = 0; i < 50; i++) {
                promises.push(
                    adapter.put(`success-${i}`, { index: i, status: "success" })
                        .then(() => results.push({ success: true }))
                        .catch((error) => results.push({ success: false, error: error.message }))
                );
            }

            // Operations that might fail (trying to get non-existent keys)
            for (let i = 0; i < 25; i++) {
                promises.push(
                    adapter.get(`non-existent-${i}`)
                        .then(() => results.push({ success: false, error: "Expected to fail" }))
                        .catch(() => results.push({ success: true })) // Expected failure
                );
            }

            await Promise.all(promises);

            const successfulOps = results.filter(r => r.success).length;
            const failedOps = results.length - successfulOps;

            expect(successfulOps).toBeGreaterThanOrEqual(50); // Should have writes succeed
            expect(failedOps).toBeGreaterThanOrEqual(25); // Should have expected failures

            // Verify successful writes are persisted
            const firstSuccess = await adapter.get("success-0");
            expect(firstSuccess).toEqual({ index: 0, status: "success" });

        } finally {
            await adapter.close();
        }

        console.log("✅ Concurrent failure scenarios tests passed");
    }
}

// Run tests if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    const tester = new FailureScenarioTester();
    tester.runAllTests().catch((error) => {
        console.error("Failure scenario tests failed:", error);
        process.exit(1);
    });
}

export { FailureScenarioTester };