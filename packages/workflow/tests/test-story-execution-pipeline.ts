#!/usr/bin/env node

/**
 * Test script for Story Execution Pipeline
 */

import {
    PipelineTrigger,
    StageExecutor,
    PipelineMonitor,
    PipelineRecovery,
    StoryExecutionPipeline,
    createStoryExecutionPipeline,
} from "@isomorphiq/workflow";
import type { WorkflowDefinition } from "@isomorphiq/workflow";

async function testStoryExecutionPipeline() {
    console.log("🧪 Testing Story Execution Pipeline...\n");

    let passed = 0;
    let failed = 0;

    // Test 1: PipelineTrigger
    console.log("1️⃣ Testing PipelineTrigger...");
    try {
        const trigger = new PipelineTrigger({
            eventTypes: ["story_created"],
            conditions: { priority: "high" },
            enabled: true,
        });

        const shouldTrigger = trigger.shouldTrigger("story_created", { priority: "high" });
        const shouldNotTrigger = trigger.shouldTrigger("story_created", { priority: "low" });

        if (shouldTrigger && !shouldNotTrigger) {
            console.log("   ✅ Pipeline trigger works correctly");
            passed++;
        } else {
            console.log("   ❌ Pipeline trigger failed");
            failed++;
        }
    } catch (error) {
        console.log(`   ❌ Error: ${error instanceof Error ? error.message : String(error)}`);
        failed++;
    }

    // Test 2: PipelineTrigger event handling
    console.log("\n2️⃣ Testing PipelineTrigger event handling...");
    try {
        const trigger = new PipelineTrigger({
            eventTypes: ["test_event"],
            conditions: {},
            enabled: true,
        });

        let triggered = false;
        trigger.onTrigger(() => {
            triggered = true;
        });

        trigger.trigger({ test: true });

        if (triggered) {
            console.log("   ✅ Event handling works correctly");
            passed++;
        } else {
            console.log("   ❌ Event handling failed");
            failed++;
        }
    } catch (error) {
        console.log(`   ❌ Error: ${error instanceof Error ? error.message : String(error)}`);
        failed++;
    }

    // Test 3: PipelineMonitor
    console.log("\n3️⃣ Testing PipelineMonitor...");
    try {
        const monitor = new PipelineMonitor();

        const status = monitor.startExecution("pipeline-1", "exec-1");

        if (status.status === "running" && status.pipelineId === "pipeline-1") {
            console.log("   ✅ Pipeline monitor works correctly");
            passed++;
        } else {
            console.log("   ❌ Pipeline monitor failed");
            failed++;
        }
    } catch (error) {
        console.log(`   ❌ Error: ${error instanceof Error ? error.message : String(error)}`);
        failed++;
    }

    // Test 4: PipelineMonitor status updates
    console.log("\n4️⃣ Testing PipelineMonitor status updates...");
    try {
        const monitor = new PipelineMonitor();

        monitor.startExecution("pipeline-1", "exec-1");
        monitor.updateStageProgress("exec-1", "stage-1", true);
        monitor.completeExecution("exec-1", true);

        const finalStatus = monitor.getExecutionStatus("exec-1");

        if (finalStatus && finalStatus.status === "completed" && finalStatus.completedStages.includes("stage-1")) {
            console.log("   ✅ Status updates work correctly");
            passed++;
        } else {
            console.log("   ❌ Status updates failed");
            failed++;
        }
    } catch (error) {
        console.log(`   ❌ Error: ${error instanceof Error ? error.message : String(error)}`);
        failed++;
    }

    // Test 5: PipelineRecovery
    console.log("\n5️⃣ Testing PipelineRecovery...");
    try {
        const recovery = new PipelineRecovery();

        recovery.registerStrategy("stage-1", {
            type: "retry",
            config: {},
        });

        const result = await recovery.recoverFromFailure(
            "stage-1",
            new Error("Test error"),
            {},
        );

        if (result.success && result.data && result.data.recovered && result.data.action === "retry") {
            console.log("   ✅ Pipeline recovery works correctly");
            passed++;
        } else {
            console.log("   ❌ Pipeline recovery failed");
            failed++;
        }
    } catch (error) {
        console.log(`   ❌ Error: ${error instanceof Error ? error.message : String(error)}`);
        failed++;
    }

    // Test 6: PipelineRecovery without strategy
    console.log("\n6️⃣ Testing PipelineRecovery without strategy...");
    try {
        const recovery = new PipelineRecovery();

        const result = await recovery.recoverFromFailure(
            "stage-without-strategy",
            new Error("Test error"),
            {},
        );

        if (!result.success) {
            console.log("   ✅ Missing strategy detection works correctly");
            passed++;
        } else {
            console.log("   ❌ Missing strategy detection failed");
            failed++;
        }
    } catch (error) {
        console.log(`   ❌ Error: ${error instanceof Error ? error.message : String(error)}`);
        failed++;
    }

    // Test 7: StoryExecutionPipeline creation
    console.log("\n7️⃣ Testing StoryExecutionPipeline creation...");
    try {
        const workflowDefinition: WorkflowDefinition = {
            id: "wf-1",
            name: "Test Workflow",
            description: "Test",
            version: "1.0.0",
            category: "task_management",
            nodes: [],
            connections: [],
            variables: [],
            settings: { timeout: 300000 },
            metadata: { tags: ["test"], author: "test" },
            enabled: true,
            createdAt: new Date(),
            updatedAt: new Date(),
            createdBy: "test",
            updatedBy: "test",
        };

        const stages = [
            {
                id: "stage-1",
                name: "First Stage",
                nodeIds: ["node-1"],
                dependsOn: [],
                timeout: 60000,
                retryPolicy: { maxAttempts: 3, backoffMultiplier: 2, maxDelay: 30000 },
            },
        ];

        const triggers = [
            {
                eventTypes: ["story_created"],
                conditions: {},
                enabled: true,
            },
        ];

        const pipeline = createStoryExecutionPipeline(workflowDefinition, stages, triggers);

        if (pipeline && pipeline.getMonitor() && pipeline.getRecovery()) {
            console.log("   ✅ Pipeline creation works correctly");
            passed++;
        } else {
            console.log("   ❌ Pipeline creation failed");
            failed++;
        }
    } catch (error) {
        console.log(`   ❌ Error: ${error instanceof Error ? error.message : String(error)}`);
        failed++;
    }

    // Test 8: Disabled pipeline execution
    console.log("\n8️⃣ Testing disabled pipeline execution...");
    try {
        const workflowDefinition: WorkflowDefinition = {
            id: "wf-1",
            name: "Test Workflow",
            description: "Test",
            version: "1.0.0",
            category: "task_management",
            nodes: [],
            connections: [],
            variables: [],
            settings: { timeout: 300000 },
            metadata: { tags: ["test"], author: "test" },
            enabled: false, // Disabled
            createdAt: new Date(),
            updatedAt: new Date(),
            createdBy: "test",
            updatedBy: "test",
        };

        const stages: any[] = [];
        const triggers: any[] = [];

        const pipeline = createStoryExecutionPipeline(workflowDefinition, stages, triggers);
        const result = await pipeline.execute({});

        if (!result.success) {
            console.log("   ✅ Disabled pipeline prevention works correctly");
            passed++;
        } else {
            console.log("   ❌ Disabled pipeline prevention failed");
            failed++;
        }
    } catch (error) {
        console.log(`   ❌ Error: ${error instanceof Error ? error.message : String(error)}`);
        failed++;
    }

    // Test 9: Pipeline event handling
    console.log("\n9️⃣ Testing pipeline event handling...");
    try {
        const workflowDefinition: WorkflowDefinition = {
            id: "wf-1",
            name: "Test Workflow",
            description: "Test",
            version: "1.0.0",
            category: "task_management",
            nodes: [],
            connections: [],
            variables: [],
            settings: { timeout: 300000 },
            metadata: { tags: ["test"], author: "test" },
            enabled: true,
            createdAt: new Date(),
            updatedAt: new Date(),
            createdBy: "test",
            updatedBy: "test",
        };

        const stages: any[] = [];
        const triggers = [
            {
                eventTypes: ["test_event"],
                conditions: { type: "story" },
                enabled: true,
            },
        ];

        const pipeline = createStoryExecutionPipeline(workflowDefinition, stages, triggers);

        // Should not throw
        pipeline.onEvent("test_event", { type: "story" });

        console.log("   ✅ Pipeline event handling works correctly");
        passed++;
    } catch (error) {
        console.log(`   ❌ Error: ${error instanceof Error ? error.message : String(error)}`);
        failed++;
    }

    // Test 10: Recovery strategy registration
    console.log("\n🔟 Testing recovery strategy registration...");
    try {
        const workflowDefinition: WorkflowDefinition = {
            id: "wf-1",
            name: "Test Workflow",
            description: "Test",
            version: "1.0.0",
            category: "task_management",
            nodes: [],
            connections: [],
            variables: [],
            settings: { timeout: 300000 },
            metadata: { tags: ["test"], author: "test" },
            enabled: true,
            createdAt: new Date(),
            updatedAt: new Date(),
            createdBy: "test",
            updatedBy: "test",
        };

        const stages: any[] = [];
        const triggers: any[] = [];

        const pipeline = createStoryExecutionPipeline(workflowDefinition, stages, triggers);

        pipeline.registerRecoveryStrategy("stage-1", {
            type: "skip",
            config: {},
        });

        const strategy = pipeline.getRecovery().getStrategy("stage-1");

        if (strategy && strategy.type === "skip") {
            console.log("   ✅ Recovery strategy registration works correctly");
            passed++;
        } else {
            console.log("   ❌ Recovery strategy registration failed");
            failed++;
        }
    } catch (error) {
        console.log(`   ❌ Error: ${error instanceof Error ? error.message : String(error)}`);
        failed++;
    }

    // Summary
    console.log("\n📊 Test Summary:");
    console.log(`   ✅ Passed: ${passed}`);
    console.log(`   ❌ Failed: ${failed}`);
    console.log(`   📈 Success Rate: ${Math.round((passed / (passed + failed)) * 100)}%`);

    if (failed === 0) {
        console.log("\n🎉 All story execution pipeline tests passed!");
        process.exit(0);
    } else {
        console.log("\n⚠️  Some tests failed");
        process.exit(1);
    }
}

// Run tests
testStoryExecutionPipeline().catch((error) => {
    console.error("\n💥 Test suite failed:", error);
    process.exit(1);
});
