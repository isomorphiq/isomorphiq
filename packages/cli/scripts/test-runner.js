#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..", "..");
const testEntry = path.join(projectRoot, "src", "test.ts");

console.log("[TEST-RUNNER] Running tests in development mode...");

const testProcess = spawn("node", ["--experimental-strip-types", testEntry], {
    cwd: projectRoot,
    stdio: "inherit",
    env: process.env,
});

testProcess.on("close", (code) => {
    if (code === 0) {
        console.log("[TEST-RUNNER] ✅ All tests passed");
    } else {
        console.log("[TEST-RUNNER] ❌ Tests failed");
        process.exit(code || 1);
    }
});

testProcess.on("error", (error) => {
    console.error("[TEST-RUNNER] Error running tests:", error);
    process.exit(1);
});
