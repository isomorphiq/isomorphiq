#!/usr/bin/env node

/**
 * Cross-adapter compatibility tests
 * Tests data consistency and migration between different adapter implementations
 */

import { LevelKeyValueAdapter } from "@isomorphiq/persistence-level";
import type { KeyValueAdapter, KeyValueIterator } from "@isomorphiq/persistence-adapter";
import { expect } from "../../tests/test-utils/expect.ts";
import { randomUUID } from "node:crypto";

// Simple in-memory adapter for testing
/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
class InMemoryKeyValueAdapter<K = string, V = unknown> implements KeyValueAdapter<K, V> {
    private store = new Map<K, V>();
    private isOpen = false;

    async open(): Promise<void> {
        this.isOpen = true;
    }

    async close(): Promise<void> {
        this.isOpen = false;
    }

    async get(key: K): Promise<V> {
        if (!this.isOpen) throw new Error("Adapter not open");
        const value = this.store.get(key);
        if (value === undefined) throw new Error("Key not found");
        return value;
    }

    async put(key: K, value: V): Promise<void> {
        if (!this.isOpen) throw new Error("Adapter not open");
        this.store.set(key, value);
    }

    async del(key: K): Promise<void> {
        if (!this.isOpen) throw new Error("Adapter not open");
        this.store.delete(key);
    }

    iterator(options: Record<string, unknown> = {}): KeyValueIterator<K, V> {
        if (!this.isOpen) throw new Error("Adapter not open");
        
        const entries = Array.from(this.store.entries());
        
        // Apply simple filtering
        let filtered = entries;
        if (options.gte) {
            const gteKey = options.gte as K;
            filtered = filtered.filter(([key]) => key >= gteKey);
        }
        if (options.lte) {
            const lteKey = options.lte as K;
            filtered = filtered.filter(([key]) => key <= lteKey);
        }
        if (options.limit) {
            filtered = filtered.slice(0, options.limit as number);
        }
        if (options.reverse) {
            filtered = filtered.reverse();
        }
        
        let index = 0;
        
        const iterator = {
            async next(): Promise<IteratorResult<[K, V]>> {
                if (index >= filtered.length) {
                    return { done: true, value: undefined };
                }
                const value = filtered[index++];
                return { done: false, value };
            },
            
            async return(): Promise<IteratorResult<[K, V]>> {
                return { done: true, value: undefined };
            },
            
            [Symbol.asyncIterator]() {
                return this;
            }
        };
        
        return Object.assign(iterator, {
            close: async () => {
                // No cleanup needed for in-memory iterator
            }
        });
    }
}

async function testCrossAdapterCompatibility(): Promise<void> {
    console.log("🧪 Testing Cross-Adapter Compatibility\n");

    const levelDbPath = `/tmp/test-cross-leveldb-${randomUUID()}`;
    const levelAdapter = new LevelKeyValueAdapter<string, unknown>(levelDbPath);
    const memoryAdapter = new InMemoryKeyValueAdapter<string, unknown>();

    try {
        // Test data consistency between adapters
        console.log("Testing data consistency between adapters...");
        
        const testData = {
            tasks: [
                { id: "1", title: "Task 1", status: "todo", priority: "high" },
                { id: "2", title: "Task 2", status: "in-progress", priority: "medium" },
                { id: "3", title: "Task 3", status: "done", priority: "low" }
            ],
            metadata: {
                version: "1.0.0",
                created: new Date(),
                tags: ["persistence", "testing", "compatibility"]
            }
        };

        // Write to LevelDB
        await levelAdapter.open();
        await levelAdapter.put("tasks", testData.tasks);
        await levelAdapter.put("metadata", testData.metadata);

        // Write to memory adapter
        await memoryAdapter.open();
        await memoryAdapter.put("tasks", testData.tasks);
        await memoryAdapter.put("metadata", testData.metadata);

        // Verify both adapters have the same data
        const levelTasks = await levelAdapter.get("tasks");
        const memoryTasks = await memoryAdapter.get("tasks");
        expect(levelTasks).toEqual(memoryTasks);
        expect(levelTasks).toEqual(testData.tasks);

        const levelMetadata = await levelAdapter.get("metadata");
        const memoryMetadata = await memoryAdapter.get("metadata");
        
        // LevelDB serializes dates as strings, so we need to normalize
        const levelMetaObj = levelMetadata as { version: string; created: string | Date; tags: string[] };
        const memoryMetaObj = memoryMetadata as { version: string; created: Date; tags: string[] };
        
        const normalizedLevelMetadata = {
            version: levelMetaObj.version,
            created: new Date(levelMetaObj.created),
            tags: levelMetaObj.tags
        };
        
        expect(normalizedLevelMetadata).toEqual(memoryMetaObj);
        expect(normalizedLevelMetadata).toEqual(testData.metadata);

        console.log("✅ Data consistency tests passed");

        // Test data migration
        console.log("Testing data migration between adapters...");
        
        // Create new adapters for migration test
        const sourceAdapter = new InMemoryKeyValueAdapter<string, unknown>();
        const targetAdapter = new LevelKeyValueAdapter<string, unknown>(`/tmp/test-target-${randomUUID()}`);

        await sourceAdapter.open();
        await targetAdapter.open();

        // Populate source
        const migrationData = {
            users: [
                { id: "user-1", name: "Alice", email: "alice@example.com" },
                { id: "user-2", name: "Bob", email: "bob@example.com" }
            ],
            settings: { theme: "dark", notifications: true }
        };

        await sourceAdapter.put("users", migrationData.users);
        await sourceAdapter.put("settings", migrationData.settings);

        // Migrate data
        const sourceIterator = sourceAdapter.iterator();
        for await (const [key, value] of sourceIterator) {
            await targetAdapter.put(key, value);
        }
        await sourceIterator.close();

        // Verify migration
        const migratedUsers = await targetAdapter.get("users");
        const migratedSettings = await targetAdapter.get("settings");
        
        expect(migratedUsers).toEqual(migrationData.users);
        expect(migratedSettings).toEqual(migrationData.settings);

        await sourceAdapter.close();
        await targetAdapter.close();

        console.log("✅ Data migration tests passed");

        // Test adapter behavior differences
        console.log("Testing adapter behavior differences...");
        
        // Test batch operations (only LevelDB supports them)
        const batchLevel = new LevelKeyValueAdapter<string, unknown>(`/tmp/test-batch-${randomUUID()}`);
        const batchMemory = new InMemoryKeyValueAdapter<string, unknown>();

        await batchLevel.open();
        await batchMemory.open();

        if (batchLevel.batch) {
            await batchLevel.batch([
                { type: "put", key: "batch-1", value: { data: "test1" } },
                { type: "put", key: "batch-2", value: { data: "test2" } }
            ]);
        }

        // Memory adapter doesn't support batch, so we add sequentially
        await batchMemory.put("batch-1", { data: "test1" });
        await batchMemory.put("batch-2", { data: "test2" });

        // Both should have the same result
        const levelResult = await batchLevel.get("batch-1");
        const memoryResult = await batchMemory.get("batch-1");
        expect(levelResult).toEqual(memoryResult);

        await batchLevel.close();
        await batchMemory.close();

        console.log("✅ Adapter behavior differences tests passed");

        // Test iterator behavior differences
        console.log("Testing iterator behavior differences...");
        
        const iterLevel = new LevelKeyValueAdapter<string, unknown>(`/tmp/test-iter-${randomUUID()}`);
        const iterMemory = new InMemoryKeyValueAdapter<string, unknown>();

        await iterLevel.open();
        await iterMemory.open();

        // Add test data
        const testItems = [
            ["a", { value: 1 }],
            ["b", { value: 2 }],
            ["c", { value: 3 }]
        ] as Array<[string, unknown]>;

        for (const [key, value] of testItems) {
            await iterLevel.put(key, value);
            await iterMemory.put(key, value);
        }

        // Test range iteration
        const levelRange = iterLevel.iterator({ gte: "b", lte: "c" });
        const memoryRange = iterMemory.iterator({ gte: "b", lte: "c" });

        const levelResults: Array<[string, unknown]> = [];
        const memoryResults: Array<[string, unknown]> = [];

        for await (const entry of levelRange) {
            levelResults.push(entry);
        }
        for await (const entry of memoryRange) {
            memoryResults.push(entry);
        }

        await levelRange.close();
        await memoryRange.close();

        expect(levelResults.length).toBe(memoryResults.length);
        expect(levelResults).toEqual(memoryResults);

        await iterLevel.close();
        await iterMemory.close();

        console.log("✅ Iterator behavior differences tests passed");

        console.log("\n✅ All cross-adapter compatibility tests passed successfully!");

    } catch (error) {
        console.error("\n❌ Cross-adapter compatibility tests failed:", error);
        throw error;
    } finally {
        await levelAdapter.close();
        await memoryAdapter.close();
    }
}

// Run tests if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    testCrossAdapterCompatibility().catch((error) => {
        console.error("Test execution failed:", error);
        process.exit(1);
    });
}

export { testCrossAdapterCompatibility };