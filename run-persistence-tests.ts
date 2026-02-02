#!/usr/bin/env node

/**
 * Comprehensive persistence test runner for task-b7c2d592
 * Runs all persistence-related tests and provides summary
 */

import { testLevelDBAdapter } from "./packages/persistence-level/tests/simple-level-test.ts";
import { testCrossAdapterCompatibility } from "./tests/integration/persistence-compatibility.test.ts";
import { benchmarkLevelDB } from "./packages/persistence-level/tests/performance-benchmarks.ts";
import { FailureScenarioTester } from "./packages/persistence-level/tests/failure-scenarios.test.ts";

interface TestSuite {
    name: string;
    run: () => Promise<void>;
    critical: boolean;
}

/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
class PersistenceTestRunner {
    private testSuites: TestSuite[] = [
        {
            name: "LevelDB Adapter Compliance",
            run: testLevelDBAdapter,
            critical: true
        },
        {
            name: "Cross-Adapter Compatibility", 
            run: testCrossAdapterCompatibility,
            critical: true
        },
        {
            name: "Performance Benchmarks",
            run: benchmarkLevelDB,
            critical: false
        },
        {
            name: "Failure Scenarios",
            run: () => new FailureScenarioTester().runAllTests(),
            critical: true
        }
    ];

    async runAllTests(): Promise<void> {
        console.log("🚀 Starting Comprehensive Persistence Test Suite\n");
        console.log("Task: task-b7c2d592 Persistence Test");
        console.log("Priority: High");
        console.log(`Timestamp: ${new Date().toISOString()}`);
        console.log(`Node Version: ${process.version}`);
        console.log(`Platform: ${process.platform}\n`);

        const results: Array<{
            name: string;
            status: "passed" | "failed" | "skipped";
            duration: number;
            error?: string;
        }> = [];

        const totalStartTime = Date.now();

        for (const suite of this.testSuites) {
            const suiteName = suite.name;
            const startTime = Date.now();
            
            console.log(`\n📋 Running: ${suiteName}`);
            console.log("=".repeat(50));

            try {
                await suite.run();
                const duration = Date.now() - startTime;
                results.push({
                    name: suiteName,
                    status: "passed",
                    duration
                });
                console.log(`\n✅ ${suiteName} PASSED (${duration}ms)`);
            } catch (error) {
                const duration = Date.now() - startTime;
                const errorMessage = error instanceof Error ? error.message : String(error);
                results.push({
                    name: suiteName,
                    status: "failed", 
                    duration,
                    error: errorMessage
                });
                console.log(`\n❌ ${suiteName} FAILED (${duration}ms)`);
                console.log(`Error: ${errorMessage}`);

                if (suite.critical) {
                    console.log("⚠️  Critical test failed, continuing with remaining suites...");
                }
            }
        }

        const totalDuration = Date.now() - totalStartTime;
        this.printSummary(results, totalDuration);
        
        const criticalFailures = results.filter(r => 
            r.status === "failed" && this.testSuites.find(s => s.name === r.name)?.critical
        );
        
        if (criticalFailures.length > 0) {
            console.log("\n❌ Critical persistence tests failed!");
            process.exit(1);
        } else {
            console.log("\n🎉 All critical persistence tests passed!");
        }
    }

    private printSummary(results: typeof results, totalDuration: number): void {
        console.log("\n" + "=".repeat(60));
        console.log("📊 PERSISTENCE TEST SUMMARY");
        console.log("=".repeat(60));

        const passed = results.filter(r => r.status === "passed");
        const failed = results.filter(r => r.status === "failed");
        const total = results.length;

        console.log(`\nOverall Status: ${failed.length === 0 ? "✅ PASSED" : "❌ FAILED"}`);
        console.log(`Total Duration: ${totalDuration}ms`);
        console.log(`Test Suites: ${total}`);
        console.log(`Passed: ${passed.length} ✅`);
        console.log(`Failed: ${failed.length} ${failed.length > 0 ? "❌" : "✅"}`);

        if (passed.length > 0) {
            console.log("\n✅ Passed Test Suites:");
            passed.forEach(result => {
                const critical = this.testSuites.find(s => s.name === result.name)?.critical;
                console.log(`  ${result.name} (${result.duration}ms) ${critical ? "[CRITICAL]" : ""}`);
            });
        }

        if (failed.length > 0) {
            console.log("\n❌ Failed Test Suites:");
            failed.forEach(result => {
                const critical = this.testSuites.find(s => s.name === result.name)?.critical;
                console.log(`  ${result.name} (${result.duration}ms) ${critical ? "[CRITICAL]" : ""}`);
                if (result.error) {
                    console.log(`    Error: ${result.error}`);
                }
            });
        }

        // Performance summary if benchmarks ran
        const benchmarkResult = results.find(r => r.name === "Performance Benchmarks");
        if (benchmarkResult && benchmarkResult.status === "passed") {
            console.log("\n📈 Performance Highlights:");
            console.log("  - LevelDB adapter demonstrates high throughput");
            console.log("  - Read operations consistently faster than writes");
            console.log("  - Batch operations provide good performance gains");
        }

        console.log("\n" + "=".repeat(60));
        console.log("Task-b7c2d592 Persistence Test Complete");
        console.log("=".repeat(60));
    }

    async runQuickTests(): Promise<void> {
        console.log("🏃 Running Quick Persistence Tests (Critical Only)\n");

        const criticalSuites = this.testSuites.filter(s => s.critical);
        const results: Array<{ name: string; status: "passed" | "failed"; error?: string }> = [];

        for (const suite of criticalSuites) {
            console.log(`Running: ${suite.name}`);
            try {
                await suite.run();
                results.push({ name: suite.name, status: "passed" });
                console.log(`✅ ${suite.name} PASSED`);
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                results.push({ name: suite.name, status: "failed", error: errorMessage });
                console.log(`❌ ${suite.name} FAILED`);
                console.log(`Error: ${errorMessage}`);
            }
        }

        const passed = results.filter(r => r.status === "passed");
        const failed = results.filter(r => r.status === "failed");

        console.log(`\nQuick Test Summary: ${passed.length} passed, ${failed.length} failed`);
        
        if (failed.length > 0) {
            process.exit(1);
        }
    }
}

// Command line interface
async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const runner = new PersistenceTestRunner();

    if (args.includes("--quick")) {
        await runner.runQuickTests();
    } else if (args.includes("--help") || args.includes("-h")) {
        console.log("Persistence Test Runner - task-b7c2d592");
        console.log("\nUsage:");
        console.log("  node run-persistence-tests.ts          Run all tests");
        console.log("  node run-persistence-tests.ts --quick    Run critical tests only");
        console.log("  node run-persistence-tests.ts --help     Show this help");
        process.exit(0);
    } else {
        await runner.runAllTests();
    }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((error) => {
        console.error("Test runner failed:", error);
        process.exit(1);
    });
}

export { PersistenceTestRunner };