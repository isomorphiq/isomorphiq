#!/usr/bin/env node

/**
 * Simple performance benchmarks for LevelDB adapter
 */

import { LevelKeyValueAdapter } from "@isomorphiq/persistence-level";
import { randomUUID } from "node:crypto";

interface BenchmarkResult {
    name: string;
    opsPerSecond: number;
    duration: number;
    operations: number;
}

async function benchmarkLevelDB(): Promise<void> {
    console.log("🚀 LevelDB Performance Benchmarks\n");
    
    const results: BenchmarkResult[] = [];

    const dbPath = `/tmp/benchmark-leveldb-${randomUUID()}`;
    const adapter = new LevelKeyValueAdapter<string, unknown>(dbPath);
    
    const measureOps = async (name: string, operations: number, operation: () => Promise<void>): Promise<BenchmarkResult> => {
        console.log(`Running ${name}...`);
        
        const startTime = performance.now();
        for (let i = 0; i < operations; i++) {
            await operation();
        }
        const endTime = performance.now();
        
        const duration = endTime - startTime;
        const opsPerSecond = (operations / duration) * 1000;
        
        const result = {
            name,
            operations,
            duration,
            opsPerSecond
        };
        
        results.push(result);
        console.log(`✅ ${name}: ${opsPerSecond.toFixed(2)} ops/sec (${duration.toFixed(2)}ms)`);
        
        return result;
    };

    try {
        await adapter.open();
        
        // Write benchmark
        await measureOps("Sequential Writes", 1000, async () => {
            const key = `write-${Math.random()}`;
            const value = { data: "test", timestamp: Date.now() };
            await adapter.put(key, value);
        });
        
        // Read benchmark (prepare data first)
        const readKeys: string[] = [];
        for (let i = 0; i < 100; i++) {
            const key = `read-${i}`;
            readKeys.push(key);
            await adapter.put(key, { index: i });
        }
        
        await measureOps("Sequential Reads", 1000, async () => {
            const key = readKeys[Math.floor(Math.random() * readKeys.length)];
            await adapter.get(key);
        });
        
        // Batch benchmark
        if (adapter.batch) {
            await measureOps("Batch Operations", 100, async () => {
                const ops = [];
                for (let i = 0; i < 10; i++) {
                    ops.push({
                        type: "put" as const,
                        key: `batch-${Math.random()}`,
                        value: { batch: true, index: i }
                    });
                }
                await adapter.batch(ops);
            });
        }
        
        // Iteration benchmark
        console.log("Running Iteration Performance...");
        const iterStartTime = performance.now();
        
        let count = 0;
        const iterator = adapter.iterator({ limit: 1000 });
        for await (const [key, value] of iterator) {
            count++;
        }
        await iterator.close();
        
        const iterEndTime = performance.now();
        const iterDuration = iterEndTime - iterStartTime;
        console.log(`✅ Iteration: ${count} items in ${iterDuration.toFixed(2)}ms`);
        
        console.log("\n📊 Benchmark Results Summary:");
        console.log("================================");
        
        for (const result of results) {
            console.log(`${result.name}:`);
            console.log(`  Operations: ${result.operations.toLocaleString()}`);
            console.log(`  Duration: ${result.duration.toFixed(2)}ms`);
            console.log(`  Throughput: ${result.opsPerSecond.toFixed(2)} ops/sec`);
            console.log("");
        }
        
        console.log("✅ Performance benchmarks completed!");
        
    } catch (error) {
        console.error("❌ Benchmark failed:", error);
        throw error;
    } finally {
        await adapter.close();
    }
}

// Run benchmarks if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    benchmarkLevelDB().catch((error) => {
        console.error("Benchmark execution failed:", error);
        process.exit(1);
    });
}

export { benchmarkLevelDB };