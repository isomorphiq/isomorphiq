#!/usr/bin/env node

/**
 * Performance benchmarks for persistence adapters
 * Tests throughput, latency, and resource usage across different scenarios
 */

import { LevelKeyValueAdapter } from "@isomorphiq/persistence-level";
import type { KeyValueAdapter } from "@isomorphiq/persistence-adapter";
import { randomUUID } from "node:crypto";

interface BenchmarkResult {
    name: string;
    operations: number;
    duration: number;
    opsPerSecond: number;
    memoryUsage?: {
        before: number;
        after: number;
        delta: number;
    };
}

class PerformanceBenchmark {
    private results: BenchmarkResult[] = [];

    private measureMemory(): number {
        return process.memoryUsage().heapUsed;
    }

    private async runBenchmark<T>(
        name: string,
        operations: number,
        operation: () => Promise<T>
    ): Promise<BenchmarkResult> {
        console.log(`Running ${name} (${operations} operations)...`);
        
        const memoryBefore = this.measureMemory();
        const startTime = performance.now();
        
        for (let i = 0; i < operations; i++) {
            await operation();
        }
        
        const endTime = performance.now();
        const memoryAfter = this.measureMemory();
        
        const duration = endTime - startTime;
        const opsPerSecond = (operations / duration) * 1000;
        
        const result: BenchmarkResult = {
            name,
            operations,
            duration,
            opsPerSecond,
            memoryUsage: {
                before: memoryBefore,
                after: memoryAfter,
                delta: memoryAfter - memoryBefore
            }
        };
        
        this.results.push(result);
        console.log(`✅ ${name}: ${opsPerSecond.toFixed(2)} ops/sec (${duration.toFixed(2)}ms)`);
        
        return result;
    }

    async benchmarkWritePerformance<T>(
        adapter: KeyValueAdapter<string, T>,
        name: string,
        count: number,
        dataFactory: (index: number) => T
    ): Promise<BenchmarkResult> {
        await adapter.open();
        
        try {
            return await this.runBenchmark(
                `${name} - Sequential Writes`,
                count,
                async () => {
                    const index = Math.floor(Math.random() * count);
                    const key = `perf-${index}`;
                    const value = dataFactory(index);
                    await adapter.put(key, value);
                }
            );
        } finally {
            await adapter.close();
        }
    }

    async benchmarkReadPerformance<T>(
        adapter: KeyValueAdapter<string, T>,
        name: string,
        count: number,
        dataFactory: (index: number) => T
    ): Promise<BenchmarkResult> {
        await adapter.open();
        
        // Pre-populate data
        for (let i = 0; i < count; i++) {
            await adapter.put(`perf-${i}`, dataFactory(i));
        }
        
        try {
            return await this.runBenchmark(
                `${name} - Sequential Reads`,
                count,
                async () => {
                    const index = Math.floor(Math.random() * count);
                    const key = `perf-${index}`;
                    await adapter.get(key);
                }
            );
        } finally {
            await adapter.close();
        }
    }

    async benchmarkBatchPerformance<T>(
        adapter: KeyValueAdapter<string, T>,
        name: string,
        count: number,
        dataFactory: (index: number) => T,
        batchSize: number = 100
    ): Promise<BenchmarkResult> {
        if (!adapter.batch) {
            console.log(`⚠️  ${name}: Batch operations not supported`);
            return {
                name: `${name} - Batch Writes`,
                operations: 0,
                duration: 0,
                opsPerSecond: 0
            };
        }

        await adapter.open();
        
        try {
            return await this.runBenchmark(
                `${name} - Batch Writes (size: ${batchSize})`,
                Math.ceil(count / batchSize),
                async () => {
                    const ops = [];
                    for (let i = 0; i < batchSize; i++) {
                        const index = Math.floor(Math.random() * count);
                        ops.push({
                            type: "put" as const,
                            key: `batch-${index}`,
                            value: dataFactory(index)
                        });
                    }
                    await adapter.batch!(ops);
                }
            );
        } finally {
            await adapter.close();
        }
    }

    async benchmarkIterationPerformance<T>(
        adapter: KeyValueAdapter<string, T>,
        name: string,
        count: number,
        dataFactory: (index: number) => T
    ): Promise<BenchmarkResult> {
        await adapter.open();
        
        // Pre-populate data
        for (let i = 0; i < count; i++) {
            await adapter.put(`iter-${i}`, dataFactory(i));
        }
        
        try {
            let iterations = 0;
            return await this.runBenchmark(
                `${name} - Iteration`,
                1,
                async () => {
                    const iterator = adapter.iterator();
                    for await (const [key, value] of iterator) {
                        iterations++;
                    }
                    await iterator.close();
                }
            );
        } finally {
            await adapter.close();
        }
    }

    async benchmarkConcurrency<T>(
        adapter: KeyValueAdapter<string, T>,
        name: string,
        count: number,
        dataFactory: (index: number) => T,
        concurrency: number = 10
    ): Promise<BenchmarkResult> {
        await adapter.open();
        
        try {
            return await this.runBenchmark(
                `${name} - Concurrent Operations (${concurrency} workers)`,
                count,
                async () => {
                    const promises = [];
                    for (let i = 0; i < concurrency; i++) {
                        promises.push(
                            (async () => {
                                const index = Math.floor(Math.random() * count);
                                const key = `concurrent-${index}-${randomUUID()}`;
                                const value = dataFactory(index);
                                await adapter.put(key, value);
                            })()
                        );
                    }
                    await Promise.all(promises);
                }
            );
        } finally {
            await adapter.close();
        }
    }

    printResults(): void {
        console.log("\n📊 Benchmark Results Summary:");
        console.log("================================");
        
        for (const result of this.results) {
            console.log(`\n${result.name}:`);
            console.log(`  Operations: ${result.operations.toLocaleString()}`);
            console.log(`  Duration: ${result.duration.toFixed(2)}ms`);
            console.log(`  Throughput: ${result.opsPerSecond.toFixed(2)} ops/sec`);
            
            if (result.memoryUsage) {
                const memoryMB = (bytes: number) => (bytes / 1024 / 1024).toFixed(2);
                console.log(`  Memory: ${memoryMB(result.memoryUsage.before)}MB → ${memoryMB(result.memoryUsage.after)}MB (+${memoryMB(result.memoryUsage.delta)}MB)`);
            }
        }
        
        console.log("\n🏆 Performance Comparison:");
        const writeResults = this.results.filter(r => r.name.includes("Writes"));
        const readResults = this.results.filter(r => r.name.includes("Reads"));
        
        if (writeResults.length > 1) {
            writeResults.sort((a, b) => b.opsPerSecond - a.opsPerSecond);
            console.log(`\nBest Write Performance: ${writeResults[0].name} (${writeResults[0].opsPerSecond.toFixed(2)} ops/sec)`);
        }
        
        if (readResults.length > 1) {
            readResults.sort((a, b) => b.opsPerSecond - a.opsPerSecond);
            console.log(`Best Read Performance: ${readResults[0].name} (${readResults[0].opsPerSecond.toFixed(2)} ops/sec)`);
        }
    }
}

async function runPerformanceBenchmarks(): Promise<void> {
    console.log("🚀 Starting Persistence Performance Benchmarks\n");

    const benchmark = new PerformanceBenchmark();
    
    // Test data factories
    const smallDataFactory = (index: number) => ({
        id: index,
        value: `test-data-${index}`,
        timestamp: Date.now()
    });

    const mediumDataFactory = (index: number) => ({
        id: index,
        title: `Task ${index}`,
        description: `This is a test task with index ${index}`,
        metadata: {
            priority: index % 3 === 0 ? "high" : index % 3 === 1 ? "medium" : "low",
            tags: [`tag-${index % 5}`, `category-${index % 3}`],
            created: new Date().toISOString()
        },
        dependencies: Array.from({ length: index % 3 }, (_, i) => `task-${index}-${i}`)
    });

    const largeDataFactory = (index: number) => ({
        id: index,
        content: 'x'.repeat(1024), // 1KB of text
        nested: {
            deeply: {
                nested: {
                    array: Array.from({ length: 100 }, (_, i) => ({ index: i, value: `item-${i}` })),
                    metadata: {
                        timestamp: Date.now(),
                        uuid: randomUUID(),
                        tags: Array.from({ length: 20 }, (_, i) => `tag-${i}`)
                    }
                }
            }
        }
    });

    // LevelDB benchmarks
    console.log("🔍 LevelDB Performance Tests");
    
    const levelDbPath = `/tmp/benchmark-leveldb-${randomUUID()}`;
    const levelAdapter = new LevelKeyValueAdapter<string, unknown>(levelDbPath);
    
    // Small data benchmarks
    await benchmark.benchmarkWritePerformance(levelAdapter, "LevelDB", 1000, smallDataFactory);
    await benchmark.benchmarkReadPerformance(levelAdapter, "LevelDB", 1000, smallDataFactory);
    await benchmark.benchmarkBatchPerformance(levelAdapter, "LevelDB", 1000, smallDataFactory);
    
    // Medium data benchmarks
    await benchmark.benchmarkWritePerformance(levelAdapter, "LevelDB-Medium", 500, mediumDataFactory);
    await benchmark.benchmarkReadPerformance(levelAdapter, "LevelDB-Medium", 500, mediumDataFactory);
    
    // Large data benchmarks
    await benchmark.benchmarkWritePerformance(levelAdapter, "LevelDB-Large", 100, largeDataFactory);
    await benchmark.benchmarkReadPerformance(levelAdapter, "LevelDB-Large", 100, largeDataFactory);
    
    // Iteration benchmarks
    await benchmark.benchmarkIterationPerformance(levelAdapter, "LevelDB", 500, mediumDataFactory);
    
    // Concurrency benchmarks
    await benchmark.benchmarkConcurrency(levelAdapter, "LevelDB", 200, smallDataFactory, 20);

    // In-memory benchmarks for comparison
    console.log("\n🧠 In-Memory Performance Tests");
    
    class InMemoryAdapter implements KeyValueAdapter<string, unknown> {
        private store = new Map<string, unknown>();
        private isOpen = false;

        async open(): Promise<void> { this.isOpen = true; }
        async close(): Promise<void> { this.isOpen = false; }
        
        async get(key: string): Promise<unknown> {
            if (!this.isOpen) throw new Error("Not open");
            const value = this.store.get(key);
            if (value === undefined) throw new Error("Key not found");
            return value;
        }
        
        async put(key: string, value: unknown): Promise<void> {
            if (!this.isOpen) throw new Error("Not open");
            this.store.set(key, value);
        }
        
        async del(key: string): Promise<void> {
            if (!this.isOpen) throw new Error("Not open");
            this.store.delete(key);
        }
        
        iterator() {
            const entries = Array.from(this.store.entries());
            let index = 0;
            
            return {
                async next() {
                    if (index >= entries.length) return { done: true, value: undefined };
                    return { done: false, value: entries[index++] };
                },
                async return() { return { done: true, value: undefined }; },
                [Symbol.asyncIterator]() { return this; },
                close: async () => {}
            };
        }
    }
    
    const memoryAdapter = new InMemoryAdapter();
    
    await benchmark.benchmarkWritePerformance(memoryAdapter, "InMemory", 1000, smallDataFactory);
    await benchmark.benchmarkReadPerformance(memoryAdapter, "InMemory", 1000, smallDataFactory);
    await benchmark.benchmarkIterationPerformance(memoryAdapter, "InMemory", 500, mediumDataFactory);
    await benchmark.benchmarkConcurrency(memoryAdapter, "InMemory", 200, smallDataFactory, 20);

    // Print comprehensive results
    benchmark.printResults();
    
    console.log("\n✅ Performance benchmarks completed!");
}

// Run benchmarks if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    runPerformanceBenchmarks().catch((error) => {
        console.error("Benchmark execution failed:", error);
        process.exit(1);
    });
}

export { runPerformanceBenchmarks, PerformanceBenchmark };