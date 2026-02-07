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

async function testExactWorkflowCall() {
    console.log("🎯 Testing EXACT workflow task provider call...");
    
    try {
        // Replicate the exact workflow setup from worker-daemon.ts:144-148
        const tasksServiceUrl = "http://127.0.0.1:3003/trpc/tasks-service";
        console.log(`📡 Using tasks service URL: ${tasksServiceUrl}`);
        
        const taskClient = createTaskClient({
            url: tasksServiceUrl,
            enableSubscriptions: false,
        });
        
        const taskService = createTaskServiceClient(taskClient);
        console.log(`✅ Created task service client`);
        
        // Test the exact call: taskService.getAllTasks()
        console.log(`\n🔄 Testing taskService.getAllTasks()...`);
        const allTasksResult = await taskService.getAllTasks();
        console.log(`📊 Raw result type: ${typeof allTasksResult}`);
        console.log(`📊 Raw result keys: ${Object.keys(allTasksResult)}`);
        
        // Test with resolveResult (exact workflow call)
        console.log(`\n🔄 Testing resolveResult(taskService.getAllTasks())...`);
        const workflowTasks = await resolveResult(taskService.getAllTasks()) as any[];
        console.log(`📊 Workflow task provider retrieved: ${workflowTasks.length} tasks`);
        
        // Test the decider with the exact workflow data
        console.log(`\n🤖 Testing workflow decider with exact task data...`);
        const workflowDecision = themesProposedDecider(workflowTasks);
        console.log(`🎯 Workflow decision: ${workflowDecision}`);
        
        // Compare with direct client call
        console.log(`\n🔄 Comparing with direct client call...`);
        const directTasks = await taskClient.listTasks();
        console.log(`📊 Direct client retrieved: ${directTasks.length} tasks`);
        
        const directDecision = themesProposedDecider(directTasks);
        console.log(`🎯 Direct client decision: ${directDecision}`);
        
        // Check if they're the same
        if (workflowTasks.length === directTasks.length) {
            console.log(`✅ Task counts match: ${workflowTasks.length}`);
        } else {
            console.log(`❌ Task counts differ: workflow=${workflowTasks.length}, direct=${directTasks.length}`);
        }
        
        if (workflowDecision === directDecision) {
            console.log(`✅ Decisions match: ${workflowDecision}`);
        } else {
            console.log(`❌ Decisions differ: workflow=${workflowDecision}, direct=${directDecision}`);
        }
        
    } catch (error) {
        console.error("❌ Error:", error);
        console.error("Stack:", error.stack);
    } finally {
        process.exit(0);
    }
}

testExactWorkflowCall();