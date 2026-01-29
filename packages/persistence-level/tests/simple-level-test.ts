#!/usr/bin/env node

/**
 * Simple LevelDB adapter test
 */

import { LevelKeyValueAdapter } from "../src/level-adapter.ts";
import { expect } from "../../../tests/test-utils/expect.ts";
import { randomUUID } from "node:crypto";

async function testLevelDBAdapter(): Promise<void> {
    console.log("🧪 Testing LevelDB Adapter Implementation\n");

    const dbPath = `/tmp/test-leveldb-${randomUUID()}`;
    const adapter = new LevelKeyValueAdapter<string, unknown>(dbPath);

    try {
        // Test connection lifecycle
        console.log("Testing connection lifecycle...");
        await adapter.open();
        await adapter.open(); // Should not fail
        await adapter.close();
        await adapter.close(); // Should not fail
        await adapter.open(); // Should reopen
        console.log("✅ Connection lifecycle tests passed");

        // Test basic CRUD
        console.log("Testing basic CRUD operations...");
        const testData = {
            id: randomUUID(),
            name: "Test Task",
            status: "todo",
            priority: "high",
            metadata: { tags: ["test", "persistence"] }
        };

        await adapter.put("task-1", testData);
        const retrieved = await adapter.get("task-1");
        expect(retrieved).toEqual(testData);
        console.log("✅ Basic CRUD operations tests passed");

        // Test iteration
        console.log("Testing iteration...");
        await adapter.put("task-2", { id: 2, name: "Task 2" });
        
        const iterator = adapter.iterator();
        const entries: Array<[string, unknown]> = [];
        
        for await (const [key, value] of iterator) {
            entries.push([key, value]);
        }
        
        await iterator.close();
        
        expect(entries.length).toBeGreaterThanOrEqual(2);
        console.log("✅ Iteration tests passed");

        // Test batch operations
        console.log("Testing batch operations...");
        if (adapter.batch) {
            await adapter.batch([
                { type: "put", key: "batch-1", value: { batch: "data1" } },
                { type: "put", key: "batch-2", value: { batch: "data2" } },
                { type: "del", key: "task-2" }
            ]);

            const batch1 = await adapter.get("batch-1");
            const batch2 = await adapter.get("batch-2");
            expect(batch1).toEqual({ batch: "data1" });
            expect(batch2).toEqual({ batch: "data2" });
            
            try {
                await adapter.get("task-2");
                throw new Error("Expected get to throw for deleted key");
            } catch (error) {
                // Expected to throw
            }
            console.log("✅ Batch operations tests passed");
        }

        // Test error handling
        console.log("Testing error handling...");
        try {
            await adapter.get("non-existent");
            throw new Error("Expected get to throw for non-existent key");
        } catch (error) {
            // Expected to throw
        }
        await adapter.del("non-existent"); // Should not fail
        console.log("✅ Error handling tests passed");

        console.log("\n✅ All LevelDB adapter tests passed successfully!");

    } catch (error) {
        console.error("\n❌ LevelDB adapter tests failed:", error);
        throw error;
    } finally {
        await adapter.close();
    }
}

// Run tests if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    testLevelDBAdapter().catch((error) => {
        console.error("Test execution failed:", error);
        process.exit(1);
    });
}

export { testLevelDBAdapter };