import { describe, it, before, after, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { unlinkSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { ProductManager } from "@isomorphiq/tasks";
import type { TaskStatus } from "@isomorphiq/tasks";

// Test database path - clean up before/after tests
const TEST_ID = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
const TEST_DB_PATH = join("/tmp", `test-tasks-db-${TEST_ID}`);
const TEST_SEARCHES_PATH = join("/tmp", `test-searches-db-${TEST_ID}`);

describe("Task Management Core Functionality", () => {
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
        
        console.log("[TEST] Task management test suite initialized");
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
        console.log("[TEST] Task management test suite completed");
    });

beforeEach(async () => {
        // Clean up all existing tasks before each test to ensure isolation
        try {
            const allTasks = await pm.getAllTasks();
            for (const task of allTasks) {
                await pm.deleteTask(task.id);
            }
        } catch (error) {
            // Ignore cleanup errors
        }
    });

    describe("Task Creation", () => {
        it("should create a basic task with default priority", async () => {
            const title = "Test Task";
            const description = "Test Description";
            
            const task = await pm.createTask(title, description);
            
            assert.ok(task.id, "Task should have an ID");
            assert.equal(task.title, title, "Task title should match");
            assert.equal(task.description, description, "Task description should match");
            assert.equal(task.status, "todo", "Default status should be todo");
            assert.equal(task.priority, "medium", "Default priority should be medium");
            assert.ok(task.createdAt, "Task should have createdAt timestamp");
            assert.ok(task.updatedAt, "Task should have updatedAt timestamp");
        });

        it("should create tasks with different priorities", async () => {
            const lowTask = await pm.createTask("Low Task", "Description", "low");
            const mediumTask = await pm.createTask("Medium Task", "Description");
            const highTask = await pm.createTask("High Task", "Description", "high");
            
            assert.equal(lowTask.priority, "low", "Low priority should be set correctly");
            assert.equal(mediumTask.priority, "medium", "Default priority should be medium");
            assert.equal(highTask.priority, "high", "High priority should be set correctly");
        });

        it("should handle task creation with special characters", async () => {
            const title = "Task with & special <characters> and \"quotes\"";
            const description = "Description with unicode: ñáéíóú and emoji: 🚀";
            
            const task = await pm.createTask(title, description);
            
            assert.equal(task.title, title, "Should handle special characters in title");
            assert.equal(task.description, description, "Should handle unicode in description");
        });

        it("should reject invalid task data", async () => {
            try {
                await pm.createTask("", "Description");
                assert.fail("Should reject empty title");
            } catch (error) {
                assert.ok(error instanceof Error, "Should throw an error");
                console.log("Actual error message:", error.message);
                // Check if error message contains any validation-related text
                const hasValidationKeyword = error.message.toLowerCase().includes("title") || 
                                         error.message.toLowerCase().includes("required") ||
                                         error.message.toLowerCase().includes("invalid") ||
                                         error.message.toLowerCase().includes("empty");
                assert.ok(hasValidationKeyword, `Error should mention validation issue: ${error.message}`);
            }
        });
    });

    describe("Task Retrieval", () => {
        it("should retrieve a task by ID", async () => {
            const createdTask = await pm.createTask("Test Task", "Description");
            
            const retrievedTask = await pm.getTask(createdTask.id);
            
            assert.ok(retrievedTask, "Task should be found");
            assert.equal(retrievedTask.id, createdTask.id, "Retrieved task ID should match");
            assert.equal(retrievedTask.title, createdTask.title, "Retrieved task title should match");
        });

        it("should return null for non-existent task", async () => {
            const task = await pm.getTask("non-existent-id");
            assert.equal(task, null, "Should return null for non-existent task");
        });

        it("should get tasks by status", async () => {
            // Create tasks with different statuses
            await pm.createTask("Task 1", "Description", "high");
            const task2 = await pm.createTask("Task 2", "Description", "medium");
            const task3 = await pm.createTask("Task 3", "Description", "low");
            
            // Update one task to in-progress
            await pm.updateTaskStatus(task2.id, "in-progress");
            // Update one task to done
            await pm.updateTaskStatus(task3.id, "done");
            
            const todoTasks = await pm.getTasksByStatus("todo");
            const inProgressTasks = await pm.getTasksByStatus("in-progress");
            const doneTasks = await pm.getTasksByStatus("done");
            
            assert.equal(todoTasks.length, 1, "Should have 1 todo task");
            assert.equal(inProgressTasks.length, 1, "Should have 1 in-progress task");
            assert.equal(doneTasks.length, 1, "Should have 1 done task");
        });
    });

    describe("Task Updates", () => {
        it("should update task status", async () => {
            const task = await pm.createTask("Test Task", "Description");
            
            const updatedTask = await pm.updateTaskStatus(task.id, "in-progress");
            
            assert.ok(updatedTask, "Should return updated task");
            assert.equal(updatedTask.status, "in-progress", "Status should be updated");
            assert.notEqual(updatedTask.updatedAt, task.updatedAt, "UpdatedAt should be modified");
        });

        it("should update task priority", async () => {
            const task = await pm.createTask("Test Task", "Description", "low");
            
            const updatedTask = await pm.updateTaskPriority(task.id, "high");
            
            assert.ok(updatedTask, "Should return updated task");
            assert.equal(updatedTask.priority, "high", "Priority should be updated");
            assert.notEqual(updatedTask.updatedAt, task.updatedAt, "UpdatedAt should be modified");
        });

        it("should reject invalid status updates", async () => {
            const task = await pm.createTask("Test Task", "Description");
            
            try {
                await pm.updateTaskStatus(task.id, "invalid-status" as TaskStatus);
                assert.fail("Should reject invalid status");
            } catch (error) {
                assert.ok(error instanceof Error, "Should throw an error");
            }
        });

        it("should handle updates for non-existent tasks", async () => {
            try {
                await pm.updateTaskStatus("non-existent-id", "in-progress");
                assert.fail("Should throw error for non-existent task");
            } catch (error) {
                assert.ok(error instanceof Error, "Should throw an error");
                assert.ok(error.message.includes("not found"), "Error should mention not found");
            }
        });
    });

    describe("Task Deletion", () => {
        it("should delete a task", async () => {
            const task = await pm.createTask("Test Task", "Description");
            
            await pm.deleteTask(task.id);
            
            const retrievedTask = await pm.getTask(task.id);
            assert.equal(retrievedTask, null, "Task should not exist after deletion");
        });

        it("should handle deletion of non-existent tasks", async () => {
            try {
                await pm.deleteTask("non-existent-id");
                assert.fail("Should throw error for non-existent task");
            } catch (error) {
                assert.ok(error instanceof Error, "Should throw an error");
            }
        });
    });

    describe("Task Dependencies", () => {
        it("should create tasks with dependencies", async () => {
            const task1 = await pm.createTask("Task 1", "Description", "high");
            const task2 = await pm.createTask("Task 2", "Description", "medium", [task1.id]);
            
            assert.deepEqual(task2.dependencies, [task1.id], "Task 2 should depend on Task 1");
        });
    });

    describe("Error Handling", () => {
        it("should handle concurrent operations", async () => {
            const promises: Promise<any>[] = [];
            // Use different timestamps and random data to ensure uniqueness
            for (let i = 0; i < 10; i++) {
                promises.push(pm.createTask(
                    `Concurrent Task ${i} ${Date.now()}-${Math.random()}`, 
                    `Description ${i} ${Date.now()}-${Math.random()}`
                ));
            }
            
            const tasks = await Promise.all(promises);
            assert.equal(tasks.length, 10, "Should handle concurrent task creation");
            
            // Verify all tasks were created with unique IDs
            const ids = tasks.map((t: any) => t.id);
            const uniqueIds = new Set(ids);
            assert.equal(uniqueIds.size, 10, "All tasks should have unique IDs");
        });
    });
});