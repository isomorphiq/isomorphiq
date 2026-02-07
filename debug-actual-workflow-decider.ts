#!/usr/bin/env node

import { createTaskClient } from "./packages/tasks/src/task-client.ts";

// Copy the exact functions from workflow.ts
const normalizeTaskType = (value: string | undefined): string => (value ?? "").trim().toLowerCase();
const isActiveStatus = (status: string): boolean => status === "todo" || status === "in-progress";

const isThemeTask = (task: any): boolean =>
    normalizeTaskType(task.type) === "theme" && isActiveStatus(task.status);

// Copy the exact decider from workflow.ts
const themesProposedDecider = (tasks: any[]): string => {
    const themeCount = tasks.filter(isThemeTask).length;
    console.log(`[DECIDER] themes-proposed decider called with ${tasks.length} tasks, ${themeCount} theme tasks`);
    
    if (themeCount === 0) {
        console.log(`[DECIDER] Returning 'retry-theme-research' (themeCount=${themeCount})`);
        return "retry-theme-research";
    }
    
    console.log(`[DECIDER] Returning 'prioritize-themes' (themeCount=${themeCount})`);
    return "prioritize-themes";
};

async function testActualWorkflowDecider() {
    console.log("🔍 Testing actual workflow decider with different task sources...");
    
    try {
        // Test 1: Direct task client (like my previous tests)
        console.log("\n=== Test 1: Direct Task Client ===");
        const tasksServiceUrl = "http://127.0.0.1:3003/trpc/tasks-service";
        const taskClient = createTaskClient({
            url: tasksServiceUrl,
            enableSubscriptions: false,
        });
        
        const directTasks = await taskClient.listTasks();
        console.log(`📊 Direct task client retrieved: ${directTasks.length} tasks`);
        
        const directDecision = themesProposedDecider(directTasks);
        console.log(`✅ Direct task client decision: ${directDecision}`);
        
        // Test 2: Via Gateway (like the webapp)
        console.log("\n=== Test 2: Via Gateway ===");
        const gatewayResponse = await fetch("http://127.0.0.1:3003/api/tasks", {
            headers: { "Content-Type": "application/json" }
        });
        
        if (gatewayResponse.ok) {
            const gatewayData = await gatewayResponse.json();
            const gatewayTasks = Array.isArray(gatewayData) ? gatewayData : 
                               (gatewayData.tasks || []);
            console.log(`📊 Gateway retrieved: ${gatewayTasks.length} tasks`);
            
            const gatewayDecision = themesProposedDecider(gatewayTasks);
            console.log(`✅ Gateway decision: ${gatewayDecision}`);
        } else {
            console.log(`❌ Gateway request failed: ${gatewayResponse.status}`);
        }
        
        // Test 3: Check if there are differences in task structure
        console.log("\n=== Test 3: Task Structure Comparison ===");
        if (directTasks.length > 0) {
            const sampleTask = directTasks[0];
            console.log("Sample task structure:");
            console.log(`  - id: ${sampleTask.id}`);
            console.log(`  - title: ${sampleTask.title}`);
            console.log(`  - type: ${sampleTask.type}`);
            console.log(`  - status: ${sampleTask.status}`);
            console.log(`  - Keys: ${Object.keys(sampleTask).join(", ")}`);
        }
        
        // Test 4: Simulate what happens if tasks array is empty
        console.log("\n=== Test 4: Empty Tasks Array ===");
        const emptyDecision = themesProposedDecider([]);
        console.log(`🚨 Empty tasks decision: ${emptyDecision}`);
        
        // Test 5: Simulate what happens if tasks array has no theme tasks
        console.log("\n=== Test 5: No Theme Tasks ===");
        const nonThemeTasks = directTasks.filter(task => 
            normalizeTaskType(task.type) !== "theme"
        );
        const noThemeDecision = themesProposedDecider(nonThemeTasks);
        console.log(`🚨 No theme tasks decision: ${noThemeDecision}`);
        
    } catch (error) {
        console.error("❌ Error:", error);
    } finally {
        process.exit(0);
    }
}

testActualWorkflowDecider();