import { defineConfig } from "@playwright/test";

export default defineConfig({
    testDir: "./tests/e2e",
    testMatch: "**/*.spec.ts",
    testIgnore: [
        "**/db/**",
        "**/saved-searches-db/**",
        "**/scripts/**",
    ],
    fullyParallel: false,
    forbidOnly: Boolean(process.env.CI),
    retries: process.env.CI ? 2 : 0,
    workers: 1,
    reporter: process.env.CI
        ? [
            ["list"],
            ["junit", { outputFile: "test-results/e2e-junit.xml" }],
        ]
        : "list",
    use: {
        trace: "retain-on-failure",
    },
});
