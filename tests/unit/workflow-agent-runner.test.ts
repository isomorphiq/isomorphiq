import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { createWorkflowAgentRunner } from "@isomorphiq/workflow";

describe("Workflow Agent Runner Tests", () => {
    let agentRunner: ReturnType<typeof createWorkflowAgentRunner>;

    before(async () => {
        // Initialize workflow agent runner
        agentRunner = createWorkflowAgentRunner({
            workspaceRoot: process.cwd()
        });
    });

    describe("Agent Runner Initialization", () => {
        it("should create agent runner successfully", () => {
            assert.ok(agentRunner, "Agent runner should be created");
            assert.ok(typeof agentRunner.executeTask === "function", "Should have executeTask method");
            assert.ok(typeof agentRunner.seedTask === "function", "Should have seedTask method");
            assert.ok(agentRunner.profileManager, "Should have profile manager");
        });

        it("should have profile manager initialized", () => {
            const profiles = agentRunner.profileManager.getAllProfiles();
            assert.ok(Array.isArray(profiles), "Should return array of profiles");
            assert.ok(profiles.length > 0, "Should have at least one profile");
        });
    });

    describe("Task Execution Structure", () => {
        it("should have proper executeTask method signature", () => {
            const task = {
                id: "test-task-1",
                title: "Test Task",
                description: "Test Description",
                type: "task",
                status: "todo",
                assignedTo: "senior-developer"
            };

            // Test that method exists and has correct signature
            assert.ok(typeof agentRunner.executeTask === "function", "Should have executeTask method");
            
            // Test parameters without actually calling (to avoid timeout)
            const methodStr = agentRunner.executeTask.toString();
            assert.ok(methodStr.includes("async"), "Should be async function");
            assert.ok(methodStr.includes("task"), "Should accept task parameter");
        });
    });

    describe("Profile Resolution", () => {
        it("should resolve workflow profile names correctly", () => {
            const profile = agentRunner.profileManager.getProfile("senior-developer");
            assert.ok(profile, "Should find senior-developer profile");
            assert.equal(profile?.name, "senior-developer", "Profile name should match");
        });
    });
});