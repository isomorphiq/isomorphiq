#!/usr/bin/env node

import { createTaskClient } from "./packages/tasks/src/task-client.ts";

// Copy the workflow's filtering logic exactly as it appears
const normalizeTaskType = (value: string | undefined): string => (value ?? "").trim().toLowerCase();
const isActiveStatus = (status: string): boolean => status === "todo" || status === "in-progress";

async function testWorkflowFiltering() {
    console.log("🧪 Testing workflow filtering logic...");
    
    try {
        // Get tasks the same way the workflow does
        const tasksServiceUrl = "http://127.0.0.1:3003/trpc/tasks-service";
        const taskClient = createTaskClient({
            url: tasksServiceUrl,
            enableSubscriptions: false,
        });
        
        const allTasks = await taskClient.listTasks();
        console.log(`📊 Total tasks retrieved: ${allTasks.length}`);
        
        // Test the exact filtering logic from profile-workflow-runner.ts:609-615
        const filtered = allTasks.filter(
            (task) =>
                normalizeTaskType(task.type) === "theme" && isActiveStatus(task.status),
        );
        
        console.log(`🎨 Theme tasks with active status: ${filtered.length}`);
        
        if (filtered.length === 0) {
            console.log("❌ No theme tasks found with active status!");
            
            // Debug: show all theme tasks and their statuses
            const allThemeTasks = allTasks.filter(task => normalizeTaskType(task.type) === "theme");
            console.log(`📋 All theme tasks (${allThemeTasks.length}):`);
            
            const statusCounts: Record<string, number> = {};
            for (const task of allThemeTasks) {
                const status = task.status;
                statusCounts[status] = (statusCounts[status] || 0) + 1;
                
                if (statusCounts[status] <= 3) { // Show first 3 examples of each status
                    console.log(`  - ${task.id}: ${task.title} (${status})`);
                }
            }
            
            console.log("\n📊 Theme task status breakdown:");
            for (const [status, count] of Object.entries(statusCounts)) {
                console.log(`  ${status}: ${count}`);
            }
            
            // Test the normalize functions
            console.log("\n🔧 Testing normalize functions:");
            console.log(`  normalizeTaskType("theme") = "${normalizeTaskType("theme")}"`);
            console.log(`  normalizeTaskType("Theme") = "${normalizeTaskType("Theme")}"`);
            console.log(`  normalizeTaskType("THEME") = "${normalizeTaskType("THEME")}"`);
            console.log(`  normalizeTaskType(undefined) = "${normalizeTaskType(undefined)}"`);
            console.log(`  isActiveStatus("todo") = ${isActiveStatus("todo")}`);
            console.log(`  isActiveStatus("in-progress") = ${isActiveStatus("in-progress")}`);
            console.log(`  isActiveStatus("done") = ${isActiveStatus("done")}`);
            
        } else {
            console.log("✅ Found theme tasks with active status:");
            for (let i = 0; i < Math.min(5, filtered.length); i++) {
                const task = filtered[i];
                console.log(`  - ${task.id}: ${task.title} (${task.type}, ${task.status})`);
            }
        }
        
    } catch (error) {
        console.error("❌ Error:", error);
    } finally {
        process.exit(0);
    }
}

testWorkflowFiltering();