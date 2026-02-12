import { defineConfig } from "@playwright/test";

export default defineConfig({
    testDir: "./tests/integration/dashboard",
    testMatch: "**/*.spec.ts",
    fullyParallel: false,
    forbidOnly: Boolean(process.env.CI),
    retries: process.env.CI ? 2 : 0,
    workers: 1,
    reporter: process.env.CI
        ? [
            ["list"],
            ["junit", { outputFile: "test-results/integration-dashboard-junit.xml" }],
        ]
        : "list",
    use: {
        trace: "retain-on-failure",
    },
});
