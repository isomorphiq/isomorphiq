#!/usr/bin/env node

/**
 * Core adapter specification tests for KeyValueAdapter implementations
 * Provides a comprehensive test suite that all adapters should pass
 */

import type { KeyValueAdapter } from "../src/index.ts";
import { expect } from "../../../tests/test-utils/expect.ts";

export interface AdapterTestConfig<K = string, V = unknown> {
    createAdapter: () => KeyValueAdapter<K, V>;
    sampleKey: K;
    sampleValue: V;
    alternativeKey: K;
    alternativeValue: V;
    complexKey?: K;
    complexValue?: V;
}

export class AdapterSpecificationTester<K = string, V = unknown> {
    private config: AdapterTestConfig<K, V>;

    constructor(config: AdapterTestConfig<K, V>) {
        this.config = config;
    }

    async runAllTests(): Promise<void> {
        console.log("🧪 Starting Adapter Specification Tests\n");

        await this.testConnectionLifecycle();
        await this.testBasicCRUDOperations();
        await this.testIteratorFunctionality();
        await this.testBatchOperations();
        await this.testErrorHandling();
        await this.testDataIntegrity();
        await this.testConcurrentAccess();

        console.log("\n✅ All adapter specification tests completed!");
    }

    private async testConnectionLifecycle(): Promise<void> {
        console.log("Testing connection lifecycle...");

        const adapter = this.config.createAdapter();
        
        // Test open operation
        await adapter.open();
        
        // Test double open (should not fail)
        await adapter.open();
        
        // Test close operation
        await adapter.close();
        
        // Test double close (should not fail)
        await adapter.close();

        console.log("✅ Connection lifecycle tests passed");
    }

    private async testBasicCRUDOperations(): Promise<void> {
        console.log("Testing basic CRUD operations...");

        const adapter = this.config.createAdapter();
        await adapter.open();

        try {
            // Test initial state - key should not exist
            await expect(adapter.get(this.config.sampleKey)).rejects.toThrow();

            // Test put operation
            await adapter.put(this.config.sampleKey, this.config.sampleValue);

            // Test get operation
            const retrievedValue = await adapter.get(this.config.sampleKey);
            expect(retrievedValue).toEqual(this.config.sampleValue);

            // Test overwrite operation
            await adapter.put(this.config.sampleKey, this.config.alternativeValue);
            const overwrittenValue = await adapter.get(this.config.sampleKey);
            expect(overwrittenValue).toEqual(this.config.alternativeValue);

            // Test delete operation
            await adapter.del(this.config.sampleKey);
            await expect(adapter.get(this.config.sampleKey)).rejects.toThrow();

        } finally {
            await adapter.close();
        }

        console.log("✅ Basic CRUD operations tests passed");
    }

    private async testIteratorFunctionality(): Promise<void> {
        console.log("Testing iterator functionality...");

        const adapter = this.config.createAdapter();
        await adapter.open();

        try {
            // Setup test data
            await adapter.put(this.config.sampleKey, this.config.sampleValue);
            await adapter.put(this.config.alternativeKey, this.config.alternativeValue);

            // Test basic iteration
            const iterator = adapter.iterator();
            const entries: Array<[K, V]> = [];
            
            for await (const [key, value] of iterator) {
                entries.push([key, value]);
            }
            
            await iterator.close();
            
            expect(entries.length).toBeGreaterThanOrEqual(2);
            
            // Verify our test data is in the results
            const hasSampleKey = entries.some(([key, value]) => 
                key === this.config.sampleKey && value === this.config.sampleValue
            );
            const hasAlternativeKey = entries.some(([key, value]) => 
                key === this.config.alternativeKey && value === this.config.alternativeValue
            );
            
            expect(hasSampleKey).toBe(true);
            expect(hasAlternativeKey).toBe(true);

            // Test iterator options (if supported)
            const optionsIterator = adapter.iterator({ gte: this.config.sampleKey });
            const filteredEntries: Array<[K, V]> = [];
            
            for await (const [key, value] of optionsIterator) {
                filteredEntries.push([key, value]);
            }
            
            await optionsIterator.close();
            expect(filteredEntries.length).toBeGreaterThan(0);

        } finally {
            await adapter.close();
        }

        console.log("✅ Iterator functionality tests passed");
    }

    private async testBatchOperations(): Promise<void> {
        console.log("Testing batch operations...");

        const adapter = this.config.createAdapter();
        await adapter.open();

        try {
            if (!adapter.batch) {
                console.log("⚠️  Batch operations not supported by this adapter");
                return;
            }

            // Test batch put operations
            const batchOps = [
                { type: "put" as const, key: this.config.sampleKey, value: this.config.sampleValue },
                { type: "put" as const, key: this.config.alternativeKey, value: this.config.alternativeValue }
            ];

            await adapter.batch(batchOps);

            // Verify batch put results
            const sampleResult = await adapter.get(this.config.sampleKey);
            const alternativeResult = await adapter.get(this.config.alternativeKey);

            expect(sampleResult).toEqual(this.config.sampleValue);
            expect(alternativeResult).toEqual(this.config.alternativeValue);

            // Test batch delete operations
            const deleteOps = [
                { type: "del" as const, key: this.config.sampleKey },
                { type: "del" as const, key: this.config.alternativeKey }
            ];

            await adapter.batch(deleteOps);

            // Verify batch delete results
            await expect(adapter.get(this.config.sampleKey)).rejects.toThrow();
            await expect(adapter.get(this.config.alternativeKey)).rejects.toThrow();

        } finally {
            await adapter.close();
        }

        console.log("✅ Batch operations tests passed");
    }

    private async testErrorHandling(): Promise<void> {
        console.log("Testing error handling...");

        const adapter = this.config.createAdapter();
        
        // Test operations on closed adapter
        await expect(adapter.get(this.config.sampleKey)).rejects.toThrow();

        await adapter.open();

        try {
            // Test deletion of non-existent key (should not throw)
            await adapter.del(this.config.sampleKey);

            // Test iterator cleanup
            const iterator = adapter.iterator();
            await iterator.close();
            await iterator.close(); // Double close should not fail

        } finally {
            await adapter.close();
        }

        console.log("✅ Error handling tests passed");
    }

    private async testDataIntegrity(): Promise<void> {
        console.log("Testing data integrity...");

        const adapter = this.config.createAdapter();
        await adapter.open();

        try {
            // Test with complex data types if provided
            if (this.config.complexKey && this.config.complexValue) {
                await adapter.put(this.config.complexKey, this.config.complexValue);
                const retrievedComplex = await adapter.get(this.config.complexKey);
                expect(retrievedComplex).toEqual(this.config.complexValue);
            }

            // Test data preservation across connection cycles
            await adapter.put(this.config.sampleKey, this.config.sampleValue);
            await adapter.close();
            await adapter.open();
            
            const preservedValue = await adapter.get(this.config.sampleKey);
            expect(preservedValue).toEqual(this.config.sampleValue);

        } finally {
            await adapter.close();
        }

        console.log("✅ Data integrity tests passed");
    }

    private async testConcurrentAccess(): Promise<void> {
        console.log("Testing concurrent access...");

        const adapter = this.config.createAdapter();
        await adapter.open();

        try {
            // Test concurrent reads
            await adapter.put(this.config.sampleKey, this.config.sampleValue);
            
            const concurrentReads = Array.from({ length: 10 }, () => 
                adapter.get(this.config.sampleKey)
            );
            
            const results = await Promise.all(concurrentReads);
            results.forEach(result => {
                expect(result).toEqual(this.config.sampleValue);
            });

            // Test concurrent writes
            const concurrentWrites = Array.from({ length: 5 }, (_, i) => {
                const key = `${this.config.sampleKey}_concurrent_${i}` as unknown as K;
                const value = `${this.config.alternativeValue}_${i}` as unknown as V;
                return adapter.put(key, value);
            });
            
            await Promise.all(concurrentWrites);

            // Verify concurrent writes
            for (let i = 0; i < 5; i++) {
                const key = `${this.config.sampleKey}_concurrent_${i}` as unknown as K;
                const expectedValue = `${this.config.alternativeValue}_${i}` as unknown as V;
                const actualValue = await adapter.get(key);
                expect(actualValue).toEqual(expectedValue);
            }

        } finally {
            await adapter.close();
        }

        console.log("✅ Concurrent access tests passed");
    }
}