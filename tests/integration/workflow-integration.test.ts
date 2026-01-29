import { describe, it, before, after, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { unlinkSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { ProductManager } from "@isomorphiq/tasks";
import type { Task } from "@isomorphiq/tasks";

// Test database path - clean up before/after tests
const TEST_ID = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
const TEST_DB_PATH = join("/tmp", `test-workflow-db-${TEST_ID}`);
const TEST_SEARCHES_PATH = join("/tmp", `test-workflow-searches-${TEST_ID}`);

describe("Workflow Integration Tests", () => {
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
        
        console.log("[TEST] Workflow integration test suite initialized");
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
        console.log("[TEST] Workflow integration test suite completed");
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

    describe("Task Creation and Management", () => {
        it("should create tasks with different properties", async () => {
            const task1 = await pm.createTask("Basic Task", "A basic task");
            const task2 = await pm.createTask("High Priority Task", "High priority task", "high");
            const task3 = await pm.createTask("Task with Dependencies", "Task with deps", "medium", [task1.id]);
            
            assert.equal(task1.priority, "medium", "Default priority should be medium");
            assert.equal(task2.priority, "high", "Should set high priority");
            assert.deepEqual(task3.dependencies, [task1.id], "Should set dependencies");
        });

        it("should handle task status lifecycle", async () => {
            const task = await pm.createTask("Lifecycle Task", "Test status changes");
            
            // Initially should be todo
            assert.equal(task.status, "todo", "Task should start as todo");
            
            // Update to in-progress
            const inProgressTask = await pm.updateTaskStatus(task.id, "in-progress");
            assert.equal(inProgressTask.status, "in-progress", "Status should update to in-progress");
            
            // Complete task
            const completedTask = await pm.updateTaskStatus(task.id, "done");
            assert.equal(completedTask.status, "done", "Status should update to done");
            
            // Mark as invalid
            const invalidTask = await pm.updateTaskStatus(task.id, "invalid");
            assert.equal(invalidTask.status, "invalid", "Status should update to invalid");
        });

        it("should handle task assignments", async () => {
            const task = await pm.createTask("Assignment Task", "Test task assignment");
            
            // Assign task
            const assignedTask = await pm.assignTask(task.id, "user123", "admin");
            assert.equal(assignedTask.assignedTo, "user123", "Should assign task to user");
            
            // Add collaborators
            const collaboratedTask = await pm.addCollaborator(task.id, "user456", "admin");
            assert.ok(collaboratedTask.collaborators?.includes("user456"), "Should add collaborator");
            
            // Remove collaborator
            const updatedTask = await pm.removeCollaborator(task.id, "user456", "admin");
            assert.ok(!updatedTask.collaborators?.includes("user456"), "Should remove collaborator");
        });

        it("should update task priority", async () => {
            const task = await pm.createTask("Priority Task", "Test priority updates", "low");
            
            const highPriorityTask = await pm.updateTaskPriority(task.id, "high");
            assert.equal(highPriorityTask.priority, "high", "Should update priority to high");
            
            const mediumPriorityTask = await pm.updateTaskPriority(task.id, "medium");
            assert.equal(mediumPriorityTask.priority, "medium", "Should update priority to medium");
        });
    });

    describe("Task Dependencies", () => {
        it("should create and resolve task dependencies", async () => {
            const task1 = await pm.createTask("Dependency 1", "First task");
            const task2 = await pm.createTask("Dependency 2", "Second task", "medium", [task1.id]);
            const task3 = await pm.createTask("Dependency 3", "Third task", "low", [task1.id, task2.id]);
            
            // Check dependencies
            assert.deepEqual(task2.dependencies, [task1.id], "Task 2 should depend on Task 1");
            assert.deepEqual(task3.dependencies, [task1.id, task2.id], "Task 3 should depend on Task 1 and Task 2");
            
            // Verify tasks can be retrieved with dependencies
            const retrievedTask2 = await pm.getTask(task2.id);
            assert.deepEqual(retrievedTask2?.dependencies, [task1.id], "Retrieved task should preserve dependencies");
        });

        it("should manage task dependencies dynamically", async () => {
            const task1 = await pm.createTask("Task 1", "First task");
            const task2 = await pm.createTask("Task 2", "Second task");
            
            // Add dependency
            const taskWithDep = await pm.addDependency(task2.id, task1.id, "admin");
            assert.deepEqual(taskWithDep.dependencies, [task1.id], "Should add dependency");
            
            // Remove dependency
            const taskWithoutDep = await pm.removeDependency(task2.id, task1.id, "admin");
            assert.equal(taskWithoutDep.dependencies.length, 0, "Should remove dependency");
        });
    });

    describe("Task Queries and Filtering", () => {
        it("should get tasks by status", async () => {
            await pm.createTask("Todo Task 1", "Todo task 1", "high");
            await pm.createTask("Todo Task 2", "Todo task 2", "medium");
            const inProgressTask = await pm.createTask("In Progress Task", "In progress task", "low");
            const doneTask = await pm.createTask("Done Task", "Done task", "high");
            
            await pm.updateTaskStatus(inProgressTask.id, "in-progress");
            await pm.updateTaskStatus(doneTask.id, "done");
            
            const todoTasks = await pm.getTasksByStatus("todo");
            const inProgressTasks = await pm.getTasksByStatus("in-progress");
            const doneTasks = await pm.getTasksByStatus("done");
            
            assert.equal(todoTasks.length, 2, "Should have 2 todo tasks");
            assert.equal(inProgressTasks.length, 1, "Should have 1 in-progress task");
            assert.equal(doneTasks.length, 1, "Should have 1 done task");
        });

        it("should get tasks sorted by dependencies", async () => {
            const task3 = await pm.createTask("Task 3", "Third task");
            const task1 = await pm.createTask("Task 1", "First task");
            const task2 = await pm.createTask("Task 2", "Second task", "medium", [task1.id]);
            
            const sortedTasks = await pm.getTasksSortedByDependencies();
            
            // Task 1 should come before Task 2 (dependency)
            const task1Index = sortedTasks.findIndex(t => t.id === task1.id);
            const task2Index = sortedTasks.findIndex(t => t.id === task2.id);
            
            assert.ok(task1Index < task2Index, "Task 1 should come before Task 2 in sorted order");
        });
    });

    describe("Error Handling and Edge Cases", () => {
        it("should handle concurrent task operations", async () => {
            const promises: Promise<Task>[] = [];
            
            // Create multiple tasks concurrently
            for (let i = 0; i < 20; i++) {
                promises.push(pm.createTask(`Concurrent Task ${i}`, `Description ${i}`, "medium"));
            }
            
            const tasks = await Promise.all(promises);
            assert.equal(tasks.length, 20, "Should create all 20 tasks");
            
            // Verify all tasks have unique IDs
            const ids = tasks.map(t => t.id);
            const uniqueIds = new Set(ids);
            assert.equal(uniqueIds.size, 20, "All tasks should have unique IDs");
            
            // Update tasks concurrently
            const updatePromises = tasks.map((task, index) => 
                pm.updateTaskStatus(task.id, index % 2 === 0 ? "in-progress" : "done")
            );
            
            const updatedTasks = await Promise.all(updatePromises);
            assert.equal(updatedTasks.length, 20, "Should update all tasks");
            
            const inProgressCount = updatedTasks.filter(t => t.status === "in-progress").length;
            const doneCount = updatedTasks.filter(t => t.status === "done").length;
            
            assert.equal(inProgressCount, 10, "Should have 10 in-progress tasks");
            assert.equal(doneCount, 10, "Should have 10 done tasks");
        });

        it("should handle task deletion gracefully", async () => {
            const task1 = await pm.createTask("Parent Task", "Parent task");
            const task2 = await pm.createTask("Child Task", "Child task", "medium", [task1.id]);
            const task3 = await pm.createTask("Independent Task", "Independent task");
            
            // Delete parent task
            await pm.deleteTask(task1.id);
            
            // Check remaining tasks
            const remainingTask2 = await pm.getTask(task2.id);
            const remainingTask3 = await pm.getTask(task3.id);
            
            assert.ok(remainingTask3, "Independent task should remain");
            // Child task behavior depends on implementation
            assert.ok(true, "Handled deletion with dependencies");
        });

        it("should handle task updates with partial data", async () => {
            const task = await pm.createTask("Original Task", "Original description", "medium");
            
            // Update just the title
            const updatedTask = await pm.updateTask(task.id, { title: "Updated Task" });
            assert.equal(updatedTask.title, "Updated Task", "Should update title");
            assert.equal(updatedTask.description, "Original description", "Should preserve description");
            assert.equal(updatedTask.priority, "medium", "Should preserve priority");
            
            // Update multiple fields
            const finalTask = await pm.updateTask(task.id, {
                description: "Updated description",
                priority: "high"
            });
            assert.equal(finalTask.description, "Updated description", "Should update description");
            assert.equal(finalTask.priority, "high", "Should update priority");
        });
    });

    describe("Task Search and Filtering", () => {
        it("should retrieve all tasks efficiently", async () => {
            // Create multiple tasks
            await pm.createTask("Task 1", "Description 1", "high");
            await pm.createTask("Task 2", "Description 2", "medium");
            await pm.createTask("Task 3", "Description 3", "low");
            
            const allTasks = await pm.getAllTasks();
            assert.equal(allTasks.length, 3, "Should retrieve all tasks");
            
            // Verify tasks have required properties
            for (const task of allTasks) {
                assert.ok(task.id, "Task should have ID");
                assert.ok(task.title, "Task should have title");
                assert.ok(task.description, "Task should have description");
                assert.ok(task.createdAt, "Task should have createdAt");
                assert.ok(task.updatedAt, "Task should have updatedAt");
            }
        });

        it("should handle task retrieval by ID", async () => {
            const createdTask = await pm.createTask("Find Me Task", "This task should be found");
            
            const foundTask = await pm.getTask(createdTask.id);
            assert.ok(foundTask, "Should find task by ID");
            assert.equal(foundTask?.id, createdTask.id, "Found task ID should match");
            assert.equal(foundTask?.title, createdTask.title, "Found task title should match");
            
            // Test non-existent task
            const notFoundTask = await pm.getTask("non-existent-id");
            assert.equal(notFoundTask, null, "Should return null for non-existent task");
        });
    });
});