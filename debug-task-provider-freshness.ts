#!/usr/bin/env node

import { createTaskClient } from "./packages/tasks/src/task-client.ts";
import { createTaskServiceClient } from "./packages/tasks/src/task-service-client.ts";

// Copy the exact resolveResult function from worker-daemon.ts
const resolveResult = async <T>(
    action: Promise<any>,
): Promise<T> => {
    const result = await action;
    if (result.success && result.data !== undefined) {
        return result.data;
    }
    throw result.error ?? new Error("Task service operation failed");
};

// Copy the exact functions from workflow.ts
const normalizeTaskType = (value: string | undefined): string => (value ?? "").trim().toLowerCase();
const isActiveStatus = (status: string): boolean => status === "todo" || status === "in-progress";

const isThemeTask = (task: any): boolean =>
    normalizeTaskType(task.type) === "theme" && isActiveStatus(task.status);

const themesProposedDecider = (tasks: any[]): string => {
    const themeCount = tasks.filter(isThemeTask).length;
    console.log(`[WORKFLOW] themes-proposed decider called with ${tasks.length} tasks, ${themeCount} theme tasks`);
    
    if (themeCount === 0) {
        console.log(`[WORKFLOW] Returning 'retry-theme-research' (themeCount=${themeCount})`);
        return "retry-theme-research";
    }
    
    console.log(`[WORKFLOW] Returning 'prioritize-themes' (themeCount=${themeCount})`);
    return "prioritize-themes";
};

async function testTaskProviderFreshness() {
    console.log("🔄 Testing task provider freshness...");
    
    try {
        // Replicate the exact workflow task provider
        const tasksServiceUrl = "http://127.0.0.1:3003/trpc/tasks-service";
        const taskClient = createTaskClient({
            url: tasksServiceUrl,
            enableSubscriptions: false,
        });
        const taskService = createTaskServiceClient(taskClient);
        
        // Create the exact taskProvider function from worker-daemon.ts:180
        const taskProvider = async () => await resolveResult(taskService.getAllTasks());
        
        console.log("\n=== Test 1: Multiple task provider calls ===");
        
        // Call the task provider multiple times to see if it returns fresh data
        for (let i = 1; i <= 3; i++) {
            console.log(`\n📞 Call ${i}:`);
            const tasks = await taskProvider() as any[];
            console.log(`  Retrieved ${tasks.length} tasks`);
            
            const themeCount = tasks.filter(isThemeTask).length;
            console.log(`  Theme tasks: ${themeCount}`);
            
            const decision = themesProposedDecider(tasks);
            console.log(`  Decision: ${decision}`);
            
            // Add a small delay to see if anything changes
            if (i < 3) {
                console.log("  ⏳ Waiting 1 second...");
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        
        console.log("\n=== Test 2: Simulate workflow context caching ===");
        
        // Test what happens if we cache the tasks (like stale context might do)
        console.log("📦 Simulating cached task data...");
        const cachedTasks = await taskProvider() as any[];
        console.log(`  Cached ${cachedTasks.length} tasks with ${cachedTasks.filter(isThemeTask).length} theme tasks`);
        
        // Simulate time passing and tasks being changed by other workers
        console.log("⏳ Simulating other workers changing tasks...");
        
        // Get fresh data
        const freshTasks = await taskProvider() as any[];
        console.log(`  Fresh call returned ${freshTasks.length} tasks with ${freshTasks.filter(isThemeTask).length} theme tasks`);
        
        // Test decisions
        console.log("\n🤖 Testing decisions:");
        const cachedDecision = themesProposedDecider(cachedTasks);
        const freshDecision = themesProposedDecider(freshTasks);
        
        console.log(`  Cached data decision: ${cachedDecision}`);
        console.log(`  Fresh data decision: ${freshDecision}`);
        
        if (cachedDecision !== freshDecision) {
            console.log("❌ DECISION MISMATCH: Stale data would cause wrong workflow transition!");
        } else {
            console.log("✅ Decisions match: No stale data issue detected");
        }
        
        console.log("\n=== Test 3: Check for potential caching issues ===");
        
        // Test direct tRPC client vs task service client
        console.log("🔍 Comparing direct client vs task service client...");
        
        const directTasks = await taskClient.listTasks();
        const serviceTasks = await resolveResult(taskService.getAllTasks()) as any[];
        
        console.log(`  Direct client: ${directTasks.length} tasks`);
        console.log(`  Task service: ${serviceTasks.length} tasks`);
        
        const directThemeCount = directTasks.filter(isThemeTask).length;
        const serviceThemeCount = serviceTasks.filter(isThemeTask).length;
        
        console.log(`  Direct client theme tasks: ${directThemeCount}`);
        console.log(`  Task service theme tasks: ${serviceThemeCount}`);
        
        if (directTasks.length === serviceTasks.length && directThemeCount === serviceThemeCount) {
            console.log("✅ Both clients return identical data");
        } else {
            console.log("❌ CLIENT MISMATCH: Different clients return different data!");
        }
        
    } catch (error) {
        console.error("❌ Error:", error);
        console.error("Stack:", error.stack);
    } finally {
        process.exit(0);
    }
}

testTaskProviderFreshness();