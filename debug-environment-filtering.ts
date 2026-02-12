#!/usr/bin/env node

import { createTaskClient } from "./packages/tasks/src/task-client.ts";

// Copy the exact functions from portfolio-creation.ts
const normalizeTaskType = (value: string | undefined): string => (value ?? "").trim().toLowerCase();

const matchesEnvironmentForTask = (
    task: any,
    environment?: string,
): boolean => {
    if (!environment) return true;
    const envValue = (task as Record<string, unknown>).environment;
    return typeof envValue !== "string" || envValue === environment;
};

const countThemeTasksForEnvironment = (
    tasks: any[],
    environment?: string,
): number =>
    tasks.filter(
        (task) =>
            normalizeTaskType(task.type) === "theme"
            && matchesEnvironmentForTask(task, environment),
    ).length;

async function testEnvironmentFiltering() {
    console.log("🌍 Testing environment-based theme task counting...");
    
    try {
        // Get tasks the same way the workflow does
        const tasksServiceUrl = "http://127.0.0.1:3003/trpc/tasks-service";
        const taskClient = createTaskClient({
            url: tasksServiceUrl,
            enableSubscriptions: false,
        });
        
        const allTasks = await taskClient.listTasks();
        console.log(`📊 Total tasks retrieved: ${allTasks.length}`);
        
        // Test different environment scenarios
        const environments = [undefined, "production", "development", "test"];
        
        for (const env of environments) {
            const themeCount = countThemeTasksForEnvironment(allTasks, env);
            console.log(`🎨 Environment ${env ?? "undefined"}: ${themeCount} theme tasks`);
            
            if (themeCount <= 3 && env !== undefined) {
                console.log(`⚠️  Environment ${env} has ${themeCount} themes (≤3) - would trigger retry-theme-research!`);
                
                // Show what theme tasks exist in this environment
                const themeTasks = allTasks.filter(task => 
                    normalizeTaskType(task.type) === "theme" && matchesEnvironmentForTask(task, env)
                );
                
                console.log(`  Theme tasks in environment ${env}:`);
                for (const task of themeTasks) {
                    console.log(`    - ${task.id}: ${task.title} (env=${(task as any).environment ?? "undefined"})`);
                }
            }
        }
        
        // Check what environment fields the theme tasks actually have
        console.log("\n🔍 Checking theme task environment fields:");
        const allThemeTasks = allTasks.filter(task => normalizeTaskType(task.type) === "theme");
        
        const envCounts: Record<string, number> = {};
        for (const task of allThemeTasks) {
            const env = (task as any).environment ?? "undefined";
            envCounts[env] = (envCounts[env] || 0) + 1;
        }
        
        console.log("  Environment breakdown:");
        for (const [env, count] of Object.entries(envCounts)) {
            console.log(`    ${env}: ${count} tasks`);
        }
        
        // Show some examples
        console.log("\n📋 Sample theme tasks with environment fields:");
        for (let i = 0; i < Math.min(5, allThemeTasks.length); i++) {
            const task = allThemeTasks[i];
            console.log(`  - ${task.id}: ${task.title}`);
            console.log(`    environment: ${(task as any).environment ?? "undefined"}`);
        }
        
    } catch (error) {
        console.error("❌ Error:", error);
    } finally {
        process.exit(0);
    }
}

testEnvironmentFiltering();