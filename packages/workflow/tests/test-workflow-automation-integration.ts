#!/usr/bin/env node

/**
 * Test script for Workflow Automation Integration
 */

import {
    WorkflowTriggerAdapter,
    AutomationActionExecutor,
    PriorityChangeAutomation,
    DependencySatisfactionAutomation,
    createWorkflowAutomationIntegration,
} from "@isomorphiq/workflow";
import type { WorkflowExecution, WorkflowNodeExecution } from "@isomorphiq/workflow";

async function testWorkflowAutomationIntegration() {
    console.log("🧪 Testing Workflow Automation Integration...\n");

    let passed = 0;
    let failed = 0;

    // Test 1: WorkflowTriggerAdapter basic functionality
    console.log("1️⃣ Testing WorkflowTriggerAdapter...");
    try {
        const adapter = new WorkflowTriggerAdapter();
        adapter.start();

        const execution: WorkflowExecution = {
            id: "exec-1",
            workflowId: "wf-1",
            workflowVersion: "1.0.0",
            status: "running",
            startedAt: new Date(),
            triggerData: { storyId: "story-123" },
            context: {
                variables: {},
                tasks: [],
                timestamp: new Date(),
                environment: "development",
            },
            nodes: [],
            metadata: {
                triggeredBy: "user-1",
                source: "manual",
            },
        };

        const nodeExecution: WorkflowNodeExecution = {
            nodeId: "node-1",
            status: "completed",
            startedAt: new Date(),
            input: {},
            output: { actionType: "evaluate_priority" },
            logs: [],
        };

        const result = adapter.convertWorkflowStateChangeToEvent(execution, nodeExecution);

        if (result.success && result.data && result.data.type === "evaluation_completed") {
            console.log("   ✅ Event conversion works correctly");
            passed++;
        } else {
            console.log("   ❌ Event conversion failed");
            failed++;
        }

        adapter.stop();
    } catch (error) {
        console.log(`   ❌ Error: ${error instanceof Error ? error.message : String(error)}`);
        failed++;
    }

    // Test 2: Event handling
    console.log("\n2️⃣ Testing event handling...");
    try {
        const adapter = new WorkflowTriggerAdapter();
        const events: string[] = [];

        adapter.registerEventHandler("evaluation_completed", async (event) => {
            events.push(event.id);
        });

        adapter.start();

        const event = {
            id: "event-1",
            type: "evaluation_completed" as const,
            workflowId: "wf-1",
            timestamp: new Date(),
            data: {},
            processed: false,
            retryCount: 0,
        };

        adapter.queueEvent(event);

        await new Promise((resolve) => setTimeout(resolve, 200));

        if (events.includes("event-1")) {
            console.log("   ✅ Event processing works correctly");
            passed++;
        } else {
            console.log("   ❌ Event processing failed");
            failed++;
        }

        adapter.stop();
    } catch (error) {
        console.log(`   ❌ Error: ${error instanceof Error ? error.message : String(error)}`);
        failed++;
    }

    // Test 3: AutomationActionExecutor
    console.log("\n3️⃣ Testing AutomationActionExecutor...");
    try {
        const executor = new AutomationActionExecutor();
        let executed = false;

        executor.registerAction({
            id: "action-1",
            type: "test",
            parameters: {},
            execute: async () => {
                executed = true;
                return { success: true, data: "executed" };
            },
        });

        const result = await executor.executeAction("action-1");

        if (result.success && executed) {
            console.log("   ✅ Action execution works correctly");
            passed++;
        } else {
            console.log("   ❌ Action execution failed");
            failed++;
        }
    } catch (error) {
        console.log(`   ❌ Error: ${error instanceof Error ? error.message : String(error)}`);
        failed++;
    }

    // Test 4: PriorityChangeAutomation
    console.log("\n4️⃣ Testing PriorityChangeAutomation...");
    try {
        const automation = new PriorityChangeAutomation();

        const result = await automation.onPriorityChanged(
            "story-1",
            "medium",
            "high",
            "user-1",
        );

        if (result.success && result.data && result.data.notificationsSent > 0) {
            console.log("   ✅ Priority change automation works correctly");
            passed++;
        } else {
            console.log("   ❌ Priority change automation failed");
            failed++;
        }
    } catch (error) {
        console.log(`   ❌ Error: ${error instanceof Error ? error.message : String(error)}`);
        failed++;
    }

    // Test 5: DependencySatisfactionAutomation
    console.log("\n5️⃣ Testing DependencySatisfactionAutomation...");
    try {
        const automation = new DependencySatisfactionAutomation();

        const result = await automation.onDependenciesSatisfied(
            "story-1",
            ["dep-1", "dep-2"],
        );

        if (result.success) {
            console.log("   ✅ Dependency satisfaction automation works correctly");
            passed++;
        } else {
            console.log("   ❌ Dependency satisfaction automation failed");
            failed++;
        }
    } catch (error) {
        console.log(`   ❌ Error: ${error instanceof Error ? error.message : String(error)}`);
        failed++;
    }

    // Test 6: Integration factory
    console.log("\n6️⃣ Testing createWorkflowAutomationIntegration...");
    try {
        const integration = createWorkflowAutomationIntegration();

        if (
            integration.triggerAdapter &&
            integration.actionExecutor &&
            integration.priorityAutomation &&
            integration.dependencyAutomation
        ) {
            console.log("   ✅ Integration factory creates all components");
            passed++;
        } else {
            console.log("   ❌ Integration factory failed");
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
        console.log("\n🎉 All workflow automation integration tests passed!");
        process.exit(0);
    } else {
        console.log("\n⚠️  Some tests failed");
        process.exit(1);
    }
}

// Run tests
testWorkflowAutomationIntegration().catch((error) => {
    console.error("\n💥 Test suite failed:", error);
    process.exit(1);
});
