#!/usr/bin/env node

import { createTaskClient } from "./packages/tasks/src/task-client.ts";

// Copied from worker-daemon.ts since it's not exported
const resolveGatewayBaseUrl = (): string => {
    const direct = process.env.GATEWAY_BASE_URL ?? process.env.WORKER_GATEWAY_URL;
    if (direct && direct.trim().length > 0) {
        return direct.trim();
    }
    return "http://127.0.0.1:3003";
};

async function debugWorkflowTasks() {
    console.log("🔍 Debugging workflow task provider...");
    
    try {
        // Create the same task client the workflow uses
        const tasksServiceUrl = `${resolveGatewayBaseUrl()}/trpc/tasks-service`;
        console.log(`📡 Connecting to: ${tasksServiceUrl}`);
        
        const taskClient = createTaskClient({
            url: tasksServiceUrl,
            enableSubscriptions: false,
        });
        
        // Get all tasks like the workflow does
        const allTasks = await taskClient.listTasks();
        console.log(`📊 Total tasks retrieved: ${allTasks.length}`);
        
        // Group tasks by type
        const tasksByType: Record<string, number> = {};
        const themeTasks: any[] = [];
        
        for (const task of allTasks) {
            const type = task.type || "undefined";
            tasksByType[type] = (tasksByType[type] || 0) + 1;
            
            if (type === "theme") {
                themeTasks.push(task);
            }
        }
        
        console.log("\n📈 Tasks by type:");
        for (const [type, count] of Object.entries(tasksByType)) {
            console.log(`  ${type}: ${count}`);
        }
        
        console.log(`\n🎨 Theme tasks found: ${themeTasks.length}`);
        if (themeTasks.length > 0) {
            console.log("Theme task details (first 5):");
            for (let i = 0; i < Math.min(5, themeTasks.length); i++) {
                const task = themeTasks[i];
                console.log(`  - ID: ${task.id}`);
                console.log(`    Title: ${task.title}`);
                console.log(`    Status: ${task.status}`);
                console.log(`    Type: ${task.type}`);
                console.log(`    Priority: ${task.priority}`);
                console.log("");
            }
            
            // Test the workflow filtering logic
            console.log("🧪 Testing workflow filtering logic:");
            const normalizeTaskType = (value: string | undefined): string => (value ?? "").trim().toLowerCase();
            const isActiveStatus = (status: string): boolean => status === "todo" || status === "in-progress";
            
            const filtered = allTasks.filter(
                (task) =>
                    normalizeTaskType(task.type) === "theme" && isActiveStatus(task.status),
            );
            
            console.log(`  Theme tasks with active status: ${filtered.length}`);
            if (filtered.length === 0) {
                console.log("❌ No active theme tasks found!");
                console.log("Theme task statuses:");
                const statusCounts: Record<string, number> = {};
                for (const task of themeTasks) {
                    statusCounts[task.status] = (statusCounts[task.status] || 0) + 1;
                }
                for (const [status, count] of Object.entries(statusCounts)) {
                    console.log(`  ${status}: ${count}`);
                }
            }
        } else {
            console.log("❌ No theme tasks found!");
        }
        
    } catch (error) {
        console.error("❌ Error:", error);
    } finally {
        process.exit(0);
    }
}

debugWorkflowTasks();