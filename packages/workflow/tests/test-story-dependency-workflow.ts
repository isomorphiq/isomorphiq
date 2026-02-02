#!/usr/bin/env node

/**
 * Test script for Story Dependency Workflow
 */

import {
    DependencySatisfactionChecker,
    CriticalPathIntegration,
    DependencyBlockingWorkflow,
    CircularDependencyPrevention,
    createStoryDependencyWorkflowIntegration,
} from "@isomorphiq/workflow";

async function testStoryDependencyWorkflow() {
    console.log("🧪 Testing Story Dependency Workflow...\n");

    let passed = 0;
    let failed = 0;

    // Test 1: DependencySatisfactionChecker - validates unsatisfied dependencies block transition
    console.log("1️⃣ Testing DependencySatisfactionChecker...");
    try {
        const checker = new DependencySatisfactionChecker();

        const result = await checker.validateDependenciesBeforeTransition(
            "story-1",
            ["dep-1", "dep-2"],
            "in_progress",
        );

        // Should fail because dependencies are not satisfied and blockOnUnsatisfiedDependencies is true
        if (!result.success) {
            console.log("   ✅ Dependency validation correctly blocks transition with unsatisfied dependencies");
            passed++;
        } else {
            console.log("   ❌ Dependency validation should have blocked transition");
            failed++;
        }
    } catch (error) {
        console.log(`   ❌ Error: ${error instanceof Error ? error.message : String(error)}`);
        failed++;
    }

    // Test 2: Dependency caching
    console.log("\n2️⃣ Testing dependency caching...");
    try {
        const checker = new DependencySatisfactionChecker();

        checker.markDependencySatisfied("story-1", "dep-1");
        const cached = checker.getCachedDependencies("story-1");

        if (cached.length === 1 && cached[0].satisfied) {
            console.log("   ✅ Dependency caching works correctly");
            passed++;
        } else {
            console.log("   ❌ Dependency caching failed");
            failed++;
        }
    } catch (error) {
        console.log(`   ❌ Error: ${error instanceof Error ? error.message : String(error)}`);
        failed++;
    }

    // Test 3: CriticalPathIntegration
    console.log("\n3️⃣ Testing CriticalPathIntegration...");
    try {
        const criticalPath = new CriticalPathIntegration();

        const stories = [
            { id: "story-1", estimatedDuration: 5, dependencies: [] },
            { id: "story-2", estimatedDuration: 3, dependencies: ["story-1"] },
            { id: "story-3", estimatedDuration: 4, dependencies: ["story-1"] },
        ];

        const result = await criticalPath.calculateCriticalPath(stories);

        if (result.success && result.data && result.data.length === 3) {
            console.log("   ✅ Critical path calculation works correctly");
            passed++;
        } else {
            console.log("   ❌ Critical path calculation failed");
            failed++;
        }
    } catch (error) {
        console.log(`   ❌ Error: ${error instanceof Error ? error.message : String(error)}`);
        failed++;
    }

    // Test 4: Critical path boost
    console.log("\n4️⃣ Testing critical path priority boost...");
    try {
        const criticalPath = new CriticalPathIntegration({
            prioritizeCriticalPathStories: true,
            criticalPathBoostFactor: 1.2,
        });

        const stories = [
            { id: "story-1", estimatedDuration: 5, dependencies: [] },
            { id: "story-2", estimatedDuration: 3, dependencies: ["story-1"] },
        ];

        await criticalPath.calculateCriticalPath(stories);

        const boostedPriority = criticalPath.applyCriticalPathBoost(5, "story-1");
        const normalPriority = criticalPath.applyCriticalPathBoost(5, "story-2");

        if (boostedPriority > normalPriority) {
            console.log("   ✅ Critical path boost works correctly");
            passed++;
        } else {
            console.log("   ❌ Critical path boost failed");
            failed++;
        }
    } catch (error) {
        console.log(`   ❌ Error: ${error instanceof Error ? error.message : String(error)}`);
        failed++;
    }

    // Test 5: DependencyBlockingWorkflow
    console.log("\n5️⃣ Testing DependencyBlockingWorkflow...");
    try {
        const blocking = new DependencyBlockingWorkflow();

        const result = await blocking.blockStory(
            "story-1",
            ["dep-1"],
            "Dependency failed",
        );

        if (result.success && result.data && blocking.isStoryBlocked("story-1")) {
            console.log("   ✅ Story blocking works correctly");
            passed++;
        } else {
            console.log("   ❌ Story blocking failed");
            failed++;
        }
    } catch (error) {
        console.log(`   ❌ Error: ${error instanceof Error ? error.message : String(error)}`);
        failed++;
    }

    // Test 6: Unblocking stories
    console.log("\n6️⃣ Testing story unblocking...");
    try {
        const blocking = new DependencyBlockingWorkflow();

        await blocking.blockStory("story-1", ["dep-1"], "Test block");
        const result = await blocking.unblockStory("story-1", "user-1");

        if (result.success && !blocking.isStoryBlocked("story-1")) {
            console.log("   ✅ Story unblocking works correctly");
            passed++;
        } else {
            console.log("   ❌ Story unblocking failed");
            failed++;
        }
    } catch (error) {
        console.log(`   ❌ Error: ${error instanceof Error ? error.message : String(error)}`);
        failed++;
    }

    // Test 7: CircularDependencyPrevention
    console.log("\n7️⃣ Testing CircularDependencyPrevention...");
    try {
        const prevention = new CircularDependencyPrevention();

        const stories = [
            { id: "story-1", dependencies: ["story-2"] },
            { id: "story-2", dependencies: ["story-3"] },
            { id: "story-3", dependencies: [] },
        ];

        const result = prevention.detectCircularDependencies("story-1", ["story-2"], stories);

        if (result.success && result.data && !result.data.hasCycle) {
            console.log("   ✅ Circular dependency detection works correctly");
            passed++;
        } else {
            console.log("   ❌ Circular dependency detection failed");
            failed++;
        }
    } catch (error) {
        console.log(`   ❌ Error: ${error instanceof Error ? error.message : String(error)}`);
        failed++;
    }

    // Test 8: Cycle detection
    console.log("\n8️⃣ Testing cycle detection...");
    try {
        const prevention = new CircularDependencyPrevention();

        const stories = [
            { id: "story-1", dependencies: ["story-2"] },
            { id: "story-2", dependencies: ["story-3"] },
            { id: "story-3", dependencies: ["story-1"] }, // Creates cycle
        ];

        const result = prevention.detectCircularDependencies("story-1", ["story-2"], stories);

        if (result.success && result.data && result.data.hasCycle) {
            console.log("   ✅ Cycle detection works correctly");
            passed++;
        } else {
            console.log("   ❌ Cycle detection failed");
            failed++;
        }
    } catch (error) {
        console.log(`   ❌ Error: ${error instanceof Error ? error.message : String(error)}`);
        failed++;
    }

    // Test 9: Dependency validation
    console.log("\n9️⃣ Testing dependency addition validation...");
    try {
        const prevention = new CircularDependencyPrevention();

        const stories = [
            { id: "story-1", dependencies: [] },
            { id: "story-2", dependencies: [] },
        ];

        const result = prevention.validateDependencyAddition("story-1", "story-2", stories);

        if (result.success && result.data && result.data.canAdd) {
            console.log("   ✅ Dependency validation works correctly");
            passed++;
        } else {
            console.log("   ❌ Dependency validation failed");
            failed++;
        }
    } catch (error) {
        console.log(`   ❌ Error: ${error instanceof Error ? error.message : String(error)}`);
        failed++;
    }

    // Test 10: Integration factory
    console.log("\n🔟 Testing createStoryDependencyWorkflowIntegration...");
    try {
        const integration = createStoryDependencyWorkflowIntegration();

        if (
            integration.satisfactionChecker &&
            integration.criticalPathIntegration &&
            integration.blockingWorkflow &&
            integration.cyclePrevention
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
        console.log("\n🎉 All story dependency workflow tests passed!");
        process.exit(0);
    } else {
        console.log("\n⚠️  Some tests failed");
        process.exit(1);
    }
}

// Run tests
testStoryDependencyWorkflow().catch((error) => {
    console.error("\n💥 Test suite failed:", error);
    process.exit(1);
});
