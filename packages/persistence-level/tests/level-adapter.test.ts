#!/usr/bin/env node

/**
 * LevelDB adapter compliance tests
 * Tests the LevelKeyValueAdapter implementation against the specification
 */

import { LevelKeyValueAdapter } from "../src/level-adapter.ts";
import { AdapterSpecificationTester, type AdapterTestConfig } from "@isomorphiq/persistence-adapter/tests/adapter-specification";
import { expect } from "../../../tests/test-utils/expect.ts";
import { randomUUID } from "node:crypto";

class LevelDBAdapterTester {
    private testDbPath: string;

    constructor() {
        this.testDbPath = `/tmp/test-leveldb-${randomUUID()}`;
    }

    private getUniqueDbPath(): string {
        return `/tmp/test-leveldb-${randomUUID()}`;
    }

    async runAllTests(): Promise<void> {
        console.log("🧪 Starting LevelDB Adapter Compliance Tests\n");

        await this.testBasicStringOperations();
        await this.testComplexObjectOperations();
        await this.testLevelDBSpecificFeatures();
        await this.testSpecificationCompliance();

        console.log("\n✅ All LevelDB adapter compliance tests completed!");
    }

    private async testBasicStringOperations(): Promise<void> {
        console.log("Testing basic string operations...");

        const config: AdapterTestConfig<string, string> = {
            createAdapter: () => new LevelKeyValueAdapter(this.getUniqueDbPath()),
            sampleKey: "test-key-1",
            sampleValue: "test-value-1",
            alternativeKey: "test-key-2", 
            alternativeValue: "test-value-2",
            complexKey: "complex-key",
            complexValue: "complex-value-with-special-chars-!@#$%^&*()"
        };

        const tester = new AdapterSpecificationTester(config);
        await tester.runAllTests();

        console.log("✅ Basic string operations tests passed");
    }

    private async testComplexObjectOperations(): Promise<void> {
        console.log("Testing complex object operations...");

        const complexObject = {
            id: randomUUID(),
            name: "Test Object",
            metadata: {
                tags: ["test", "persistence", "leveldb"],
                nested: {
                    deep: {
                        value: 42,
                        active: true,
                        nullValue: null
                    }
                }
            },
            timestamps: {
                created: new Date(),
                updated: new Date()
            },
            array: [1, 2, 3, "four", { five: 5 }]
        };

        const config: AdapterTestConfig<string, unknown> = {
            createAdapter: () => new LevelKeyValueAdapter(this.getUniqueDbPath()),
            sampleKey: "object-key-1",
            sampleValue: complexObject,
            alternativeKey: "object-key-2",
            alternativeValue: { ...complexObject, id: randomUUID(), name: "Alternative Object" },
            complexKey: "nested-complex-key",
            complexValue: {
                deeply: {
                    nested: {
                        structure: {
                            with: {
                                arrays: [1, 2, 3],
                                objects: { a: 1, b: 2 },
                                primitives: "string",
                                date: new Date(),
                                boolean: true,
                                nullValue: null
                            }
                        }
                    }
                }
            }
        };

        const tester = new AdapterSpecificationTester(config);
        await tester.runAllTests();

        console.log("✅ Complex object operations tests passed");
    }

    private async testLevelDBSpecificFeatures(): Promise<void> {
        console.log("Testing LevelDB-specific features...");

        const adapter = new LevelKeyValueAdapter<string, unknown>(this.getUniqueDbPath());
        await adapter.open();

        try {
            // Test iterator options specific to LevelDB
            await adapter.put("key-1", { value: 1 });
            await adapter.put("key-2", { value: 2 });
            await adapter.put("key-3", { value: 3 });

            // Test range iteration
            const rangeIterator = adapter.iterator({ gte: "key-1", lte: "key-2" });
            const rangeResults: Array<[string, unknown]> = [];
            
            for await (const [key, value] of rangeIterator) {
                rangeResults.push([key, value]);
            }
            
            await rangeIterator.close();
            
            expect(rangeResults).toHaveLength(2);
            expect(rangeResults[0][0]).toBe("key-1");
            expect(rangeResults[1][0]).toBe("key-2");

            // Test reverse iteration
            const reverseIterator = adapter.iterator({ reverse: true, limit: 2 });
            const reverseResults: Array<[string, unknown]> = [];
            
            for await (const [key, value] of reverseIterator) {
                reverseResults.push([key, value]);
            }
            
            await reverseIterator.close();
            
            expect(reverseResults).toHaveLength(2);

            // Test limit option
            const limitIterator = adapter.iterator({ limit: 1 });
            const limitResults: Array<[string, unknown]> = [];
            
            for await (const [key, value] of limitIterator) {
                limitResults.push([key, value]);
            }
            
            await limitIterator.close();
            
            expect(limitResults).toHaveLength(1);

        } finally {
            await adapter.close();
        }

        console.log("✅ LevelDB-specific features tests passed");
    }

    private async testSpecificationCompliance(): Promise<void> {
        console.log("Testing specification compliance...");

        const adapter = new LevelKeyValueAdapter<string, string>(this.getUniqueDbPath());
        await adapter.open();

        try {
            // Test that batch operations are supported
            expect(typeof adapter.batch).toBe("function");

            // Test batch operations work correctly
            if (adapter.batch) {
                const batchOps = [
                    { type: "put" as const, key: "batch-1", value: "value-1" },
                    { type: "put" as const, key: "batch-2", value: "value-2" },
                    { type: "del" as const, key: "non-existent" } // Should not fail
                ];

                await adapter.batch(batchOps);

                expect(await adapter.get("batch-1")).toBe("value-1");
                expect(await adapter.get("batch-2")).toBe("value-2");
                await expect(adapter.get("non-existent")).rejects.toThrow();
            }

            // Test iterator provides close method
            const iterator = adapter.iterator();
            expect(typeof iterator.close).toBe("function");
            await iterator.close();

            // Test adapter can be reopened
            await adapter.close();
            await adapter.open();
            expect(await adapter.get("batch-1")).toBe("value-1");

        } finally {
            await adapter.close();
        }

        console.log("✅ Specification compliance tests passed");
    }
}

// Run tests if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    const tester = new LevelDBAdapterTester();
    tester.runAllTests().catch((error) => {
        console.error("LevelDB adapter tests failed:", error);
        process.exit(1);
    });
}

export { LevelDBAdapterTester };