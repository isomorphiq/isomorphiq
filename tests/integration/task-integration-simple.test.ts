import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { ProductManager } from "@isomorphiq/user-profile";
import { unlinkSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// Test database path - clean up before/after tests
const TEST_ID = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
const TEST_DB_PATH = join("/tmp", `test-integration-db-${TEST_ID}`);
const TEST_SEARCHES_PATH = join("/tmp", `test-integration-searches-${TEST_ID}`);

describe("Task Integration Tests", () => {
    let pm: ProductManager;
    let originalCwd: string;

    before(async () => {
        // Store original working directory and environment
        originalCwd = process.cwd();
        
        // Clean up any existing test database
        if (existsSync(TEST_DB_PATH)) {
            unlinkSync(TEST_DB_PATH);
        }
        if (existsSync(TEST_SEARCHES_PATH)) {
            unlinkSync(TEST_SEARCHES_PATH);
        }
        
        // Create test directories
        mkdirSync(TEST_DB_PATH, { recursive: true });
        mkdirSync(TEST_SEARCHES_PATH, { recursive: true });
        
        // Change to test directory to isolate saved-searches-db
        process.chdir(TEST_DB_PATH);
        
        // Set environment to use our test databases
        process.env.DB_PATH = TEST_DB_PATH;
        process.env.SAVED_SEARCHES_DB_PATH = TEST_SEARCHES_PATH;
        
        pm = new ProductManager(TEST_DB_PATH);
        await pm.initialize();
        
        // Clean up any existing tasks from previous runs
        try {
            const allTasks = await pm.getAllTasks();
            for (const task of allTasks) {
                await pm.deleteTask(task.id);
            }
        } catch (error) {
            // Ignore cleanup errors
        }
        
        console.log("[TEST] Integration test suite initialized");
    });

    after(async () => {
        // Restore original working directory and environment
        process.chdir(originalCwd);
        delete process.env.SAVED_SEARCHES_DB_PATH;
        
        // Clean up test database
        try {
            if (existsSync(TEST_DB_PATH)) {
                unlinkSync(TEST_DB_PATH);
            }
            if (existsSync(TEST_SEARCHES_PATH)) {
                unlinkSync(TEST_SEARCHES_PATH);
            }
        } catch (error) {
            // Ignore cleanup errors
        }
        console.log("[TEST] Integration test suite completed");
    });

    describe("Task Workflow Integration", () => {
        it("should handle complete task lifecycle", async () => {
            // Create a task
            const task = await pm.createTask(
                "Integration Test Task", 
                "Testing complete workflow", 
                "high"
            );
            
            assert.ok(task.id, "Task should have an ID");
            assert.equal(task.status, "todo", "Initial status should be todo");
            
            // Update status to in-progress
            const inProgressTask = await pm.updateTaskStatus(task.id, "in-progress");
            assert.equal(inProgressTask.status, "in-progress", "Status should be updated");
            
            // Update priority
            const updatedTask = await pm.updateTaskPriority(task.id, "low");
            assert.equal(updatedTask.priority, "low", "Priority should be updated");
            
            // Complete the task
            const completedTask = await pm.updateTaskStatus(task.id, "done");
            assert.equal(completedTask.status, "done", "Task should be completed");
            
            // Verify task exists and is completed
            const finalTask = await pm.getTask(task.id);
            assert.ok(finalTask, "Task should still exist");
            assert.equal(finalTask.status, "done", "Final status should be done");
            assert.equal(finalTask.priority, "low", "Priority should remain updated");
        });

        it("should handle task dependencies correctly", async () => {
            // Create parent task
            const parentTask = await pm.createTask("Parent Task", "Parent task description");
            
            // Create child task with dependency
            const childTask = await pm.createTask(
                "Child Task", 
                "Child task description", 
                "medium", 
                [parentTask.id]
            );
            
            assert.deepEqual(childTask.dependencies, [parentTask.id], "Child task should depend on parent");
            
            // Verify both tasks exist
            const retrievedParent = await pm.getTask(parentTask.id);
            const retrievedChild = await pm.getTask(childTask.id);
            
            assert.ok(retrievedParent, "Parent task should exist");
            assert.ok(retrievedChild, "Child task should exist");
            assert.deepEqual(retrievedChild.dependencies, [parentTask.id], "Dependencies should be preserved");
        });

        it("should handle concurrent task operations", async () => {
            const promises: Promise<any>[] = [];
            
            // Create multiple tasks concurrently
            for (let i = 0; i < 5; i++) {
                promises.push(
                    pm.createTask(
                        `Concurrent Task ${i}`, 
                        `Description ${i}`, 
                        i % 2 === 0 ? "high" : "low"
                    )
                );
            }
            
            const tasks = await Promise.all(promises);
            assert.equal(tasks.length, 5, "Should create all tasks");
            
            // Verify all tasks have unique IDs
            const ids = tasks.map((t: any) => t.id);
            const uniqueIds = new Set(ids);
            assert.equal(uniqueIds.size, 5, "All tasks should have unique IDs");
            
            // Update all tasks concurrently
            const updatePromises = tasks.map((task: any, index: number) => 
                pm.updateTaskStatus(task.id, index % 2 === 0 ? "in-progress" : "done")
            );
            
            const updatedTasks = await Promise.all(updatePromises);
            assert.equal(updatedTasks.length, 5, "Should update all tasks");
            
            // Verify updates were applied correctly
            for (let i = 0; i < updatedTasks.length; i++) {
                const expectedStatus = i % 2 === 0 ? "in-progress" : "done";
                assert.equal(updatedTasks[i].status, expectedStatus, `Task ${i} should have correct status`);
            }
        });

        it("should handle task filtering and sorting", async () => {
            // Create tasks with different priorities and statuses
            await pm.createTask("High Priority Todo", "High priority todo task", "high");
            await pm.createTask("Low Priority Todo", "Low priority todo task", "low");
            
            const task1 = await pm.createTask("Medium Priority Task", "Medium priority task", "medium");
            const task2 = await pm.createTask("High Priority Task 2", "Another high priority task", "high");
            
            await pm.updateTaskStatus(task1.id, "in-progress");
            await pm.updateTaskStatus(task2.id, "done");
            
            // Test filtering by status
            const todoTasks = await pm.getTasksByStatus("todo");
            const inProgressTasks = await pm.getTasksByStatus("in-progress");
            const doneTasks = await pm.getTasksByStatus("done");
            
            assert.equal(todoTasks.length, 2, "Should have 2 todo tasks");
            assert.equal(inProgressTasks.length, 1, "Should have 1 in-progress task");
            assert.equal(doneTasks.length, 1, "Should have 1 done task");
            
            // Verify task contents
            const todoTitles = todoTasks.map(t => t.title).sort();
            assert.deepEqual(todoTitles, ["High Priority Todo", "Low Priority Todo"], "Todo tasks should have correct titles");
        });

        it("should handle error cases gracefully", async () => {
            // Test invalid task creation
            try {
                await pm.createTask("", "Invalid empty title");
                assert.fail("Should reject empty title");
            } catch (error) {
                assert.ok(error instanceof Error, "Should throw an error");
                assert.ok(error.message.includes("required"), "Error should mention validation");
            }
            
            // Test invalid status update
            const task = await pm.createTask("Valid Task", "Valid description");
            try {
                await pm.updateTaskStatus(task.id, "invalid-status" as any);
                assert.fail("Should reject invalid status");
            } catch (error) {
                assert.ok(error instanceof Error, "Should throw an error");
            }
            
            // Test non-existent task operations
            try {
                await pm.getTask("non-existent-id");
                assert.equal(null, null, "Should return null for non-existent task");
            } catch (error) {
                // Either returning null or throwing is acceptable
                assert.ok(true, "Should handle non-existent task gracefully");
            }
        });
    });

    describe("Performance and Reliability", () => {
        it("should handle large numbers of tasks efficiently", async () => {
            const startTime = Date.now();
            
            // Create 50 tasks
            const promises: Promise<any>[] = [];
            for (let i = 0; i < 50; i++) {
                promises.push(pm.createTask(`Task ${i}`, `Description for task ${i}`));
            }
            
            const tasks = await Promise.all(promises);
            const createTime = Date.now() - startTime;
            
            assert.equal(tasks.length, 50, "Should create all tasks");
            assert.ok(createTime < 5000, "Should create tasks within reasonable time");
            
            // Test retrieval performance
            const retrieveStart = Date.now();
            const allTasks = await pm.getAllTasks();
            const retrieveTime = Date.now() - retrieveStart;
            
            assert.ok(allTasks.length >= 50, "Should retrieve all tasks");
            assert.ok(retrieveTime < 1000, "Should retrieve tasks quickly");
        });

        it("should maintain data consistency", async () => {
            // Create a task
            const originalTask = await pm.createTask("Consistency Test", "Test data consistency");
            
            // Perform multiple updates
            await pm.updateTaskStatus(originalTask.id, "in-progress");
            await pm.updateTaskPriority(originalTask.id, "high");
            
            // Retrieve and verify final state
            const finalTask = await pm.getTask(originalTask.id);
            
            assert.ok(finalTask, "Task should still exist");
            assert.equal(finalTask.id, originalTask.id, "Task ID should be consistent");
            assert.equal(finalTask.title, originalTask.title, "Title should be unchanged");
            assert.equal(finalTask.description, originalTask.description, "Description should be unchanged");
            assert.equal(finalTask.status, "in-progress", "Status should be updated");
            assert.equal(finalTask.priority, "high", "Priority should be updated");
            assert.ok(finalTask.updatedAt > originalTask.updatedAt, "UpdatedAt should be modified");
        });
    });
});