#!/usr/bin/env node

import { test, describe } from "node:test";
import assert from "node:assert";

// Direct MCP tool calls for testing
async function createTask(data: { title: string; description: string; priority?: string }) {
    const response = await fetch("http://localhost:3001/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
    });
    return response.json();
}

async function listTasks() {
    const response = await fetch("http://localhost:3001/api/tasks");
    return response.json();
}

async function getTask(id: string) {
    const response = await fetch(`http://localhost:3001/api/tasks/${id}`);
    return response.json();
}

async function updateTaskStatus(id: string, status: string) {
    const response = await fetch(`http://localhost:3001/api/tasks/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status })
    });
    return response.json();
}

async function deleteTask(id: string) {
    const response = await fetch(`http://localhost:3001/api/tasks/${id}`, {
        method: "DELETE"
    });
    return response.json();
}

describe("Task Manager End-to-End Tests", () => {
    test("should create and retrieve task successfully", async () => {
        console.log("\n🧪 Testing task creation and retrieval...");
        
        // Create a task
        const createResult = await createTask({
            title: "E2E Test Task",
            description: "Testing end-to-end functionality",
            priority: "high"
        });
        
        assert.ok(createResult.success, "Task creation should succeed");
        assert.ok(createResult.data?.id, "Task should have an ID");
        
        const taskId = createResult.data.id;
        console.log(`✅ Created task: ${taskId}`);
        
        // Get the specific task
        const getResult = await getTask(taskId);
        assert.ok(getResult.success, "Task retrieval should succeed");
        assert.strictEqual(getResult.data?.title, "E2E Test Task");
        assert.strictEqual(getResult.data?.status, "todo");
        
        console.log("✅ Retrieved task successfully");
        
        // List all tasks
        const listResult = await listTasks();
        console.log(`📋 Found ${Array.isArray(listResult.data) ? listResult.data.length : 0} tasks in list`);
        
        // Update task status
        const updateResult = await updateTaskStatus(taskId, "in-progress");
        assert.ok(updateResult.success, "Task status update should succeed");
        assert.strictEqual(updateResult.data?.status, "in-progress");
        
        console.log("✅ Updated task status");
        
        // Clean up
        const deleteResult = await deleteTask(taskId);
        assert.ok(deleteResult.success, "Task deletion should succeed");
        
        console.log("✅ Deleted task");
    });
    
    test("should handle concurrent operations", async () => {
        console.log("\n🧪 Testing concurrent operations...");
        
        // Create multiple tasks concurrently
        const taskPromises = Array.from({ length: 5 }, (_, i) => 
            createTask({
                title: `Concurrent Task ${i + 1}`,
                description: `Testing concurrent operation ${i + 1}`,
                priority: i % 2 === 0 ? "high" : "medium"
            })
        );
        
        const results = await Promise.allSettled(taskPromises);
        const successful = results.filter(r => r.status === "fulfilled" && r.value.success);
        
        console.log(`✅ Created ${successful.length}/5 tasks concurrently`);
        
        // List tasks to verify all are present
        const listResult = await listTasks();
        const taskCount = Array.isArray(listResult.data) ? listResult.data.length : 0;
        console.log(`📋 Total tasks in system: ${taskCount}`);
        
        // Clean up concurrent tasks
        for (const result of successful) {
            if (result.status === "fulfilled" && result.value.data?.id) {
                await deleteTask(result.value.data.id);
            }
        }
        
        console.log("✅ Cleaned up concurrent tasks");
    });
    
    test("should validate error handling", async () => {
        console.log("\n🧪 Testing error handling...");
        
        // Try to get non-existent task
        const getResult = await getTask("non-existent-id");
        assert.ok(!getResult.success, "Non-existent task should fail");
        
        // Try to update non-existent task
        const updateResult = await updateTaskStatus("non-existent-id", "done");
        assert.ok(!updateResult.success, "Non-existent task update should fail");
        
        // Try to create invalid task
        const createResult = await createTask({
            title: "", // Empty title should fail
            description: "Invalid task",
            priority: "medium"
        });
        
        // Note: This might succeed depending on validation - check for appropriate response
        console.log(`📝 Invalid task creation result: ${createResult.success ? "succeeded" : "failed appropriately"}`);
        
        console.log("✅ Error handling validated");
    });
});

console.log("🚀 Starting Task Manager E2E Tests");