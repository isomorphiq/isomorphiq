#!/usr/bin/env node

import { createTaskClient } from "./packages/tasks/src/task-client.ts";

// Copy the exact functions from workflow.ts
const normalizeTaskType = (value: string | undefined): string => (value ?? "").trim().toLowerCase();
const isActiveStatus = (status: string): boolean => status === "todo" || status === "in-progress";

const isThemeTask = (task: any): boolean =>
    normalizeTaskType(task.type) === "theme" && isActiveStatus(task.status);

async function testWorkflowDecider() {
    console.log("🔍 Testing workflow decider logic...");
    
    try {
        // Get tasks the same way the workflow does
        const tasksServiceUrl = "http://127.0.0.1:3003/trpc/tasks-service";
        const taskClient = createTaskClient({
            url: tasksServiceUrl,
            enableSubscriptions: false,
        });
        
        const allTasks = await taskClient.listTasks();
        console.log(`📊 Total tasks retrieved: ${allTasks.length}`);
        
        // Test the exact decider logic from workflow.ts:282-286
        const themeCount = allTasks.filter(isThemeTask).length;
        console.log(`🎨 Theme tasks found by decider: ${themeCount}`);
        
        // Test the decision
        let decision: string;
        if (themeCount === 0) {
            decision = "retry-theme-research";
        } else {
            decision = "prioritize-themes";
        }
        
        console.log(`🤖 Workflow decider decision: ${decision}`);
        
        if (decision === "retry-theme-research") {
            console.log("❌ BUG: Decider chose retry-theme-research despite having theme tasks!");
            
            // Debug: Show what the decider is seeing
            console.log("\n🔍 Debugging decider input:");
            console.log(`  Total tasks: ${allTasks.length}`);
            
            const themeTasks = allTasks.filter(isThemeTask);
            console.log(`  Tasks matching isThemeTask(): ${themeTasks.length}`);
            
            // Show some examples of what matches and what doesn't
            console.log("\n✅ Tasks that match isThemeTask():");
            for (let i = 0; i < Math.min(3, themeTasks.length); i++) {
                const task = themeTasks[i];
                console.log(`  - ${task.id}: ${task.title} (type=${task.type}, status=${task.status})`);
                console.log(`    normalizeTaskType('${task.type}') = '${normalizeTaskType(task.type)}'`);
                console.log(`    isActiveStatus('${task.status}') = ${isActiveStatus(task.status)}`);
            }
            
            // Show tasks that are type "theme" but don't match status
            const themeTypeButInactive = allTasks.filter(
                task => normalizeTaskType(task.type) === "theme" && !isActiveStatus(task.status)
            );
            if (themeTypeButInactive.length > 0) {
                console.log("\n⚠️  Theme tasks with inactive status:");
                for (let i = 0; i < Math.min(3, themeTypeButInactive.length); i++) {
                    const task = themeTypeButInactive[i];
                    console.log(`  - ${task.id}: ${task.title} (type=${task.type}, status=${task.status})`);
                }
            }
            
        } else {
            console.log("✅ Decider correctly chose prioritize-themes");
        }
        
    } catch (error) {
        console.error("❌ Error:", error);
    } finally {
        process.exit(0);
    }
}

testWorkflowDecider();