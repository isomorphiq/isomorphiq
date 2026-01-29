#!/usr/bin/env node

/**
 * Test runner for LevelDB adapter compliance tests
 */

import { LevelDBAdapterTester } from "./level-adapter.test.ts";

async function main(): Promise<void> {
    try {
        const tester = new LevelDBAdapterTester();
        await tester.runAllTests();
        console.log("\n🎉 All LevelDB tests passed successfully!");
        process.exit(0);
    } catch (error) {
        console.error("\n❌ LevelDB tests failed:", error);
        process.exit(1);
    }
}

main();