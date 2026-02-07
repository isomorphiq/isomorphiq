import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { unlinkSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { ProductManager } from "@isomorphiq/profiles";

describe("Acceptance Criteria Validation", () => {
    let pm: ProductManager;
    let originalCwd: string;
    const TEST_ID = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const TEST_DB_PATH = join("/tmp", `acceptance-db-${TEST_ID}`);
    const TEST_SEARCHES_PATH = join("/tmp", `acceptance-searches-${TEST_ID}`);

    before(async () => {
        originalCwd = process.cwd();
        
        // Clean up test environment
        if (existsSync(TEST_DB_PATH)) unlinkSync(TEST_DB_PATH);
        if (existsSync(TEST_SEARCHES_PATH)) unlinkSync(TEST_SEARCHES_PATH);
        
        mkdirSync(TEST_DB_PATH, { recursive: true });
        mkdirSync(TEST_SEARCHES_PATH, { recursive: true });
        
        process.chdir(TEST_DB_PATH);
        process.env.DB_PATH = TEST_DB_PATH;
        process.env.SAVED_SEARCHES_DB_PATH = TEST_SEARCHES_PATH;
        
        pm = new ProductManager(TEST_DB_PATH);
        await pm.initialize();
    });

    after(async () => {
        process.chdir(originalCwd);
        delete process.env.SAVED_SEARCHES_DB_PATH;
        
        try {
            if (existsSync(TEST_DB_PATH)) unlinkSync(TEST_DB_PATH);
            if (existsSync(TEST_SEARCHES_PATH)) unlinkSync(TEST_SEARCHES_PATH);
        } catch (error) {
            // Ignore cleanup errors
        }
    });

    describe("Core Acceptance Criteria", () => {
        it("AC1: Task Creation with Validation", async () => {
            // Valid task creation
            const validTask = await pm.createTask(
                "Test Task",
                "Valid description",
                "medium"
            );
            
            assert.ok(validTask.id, "Task should have ID");
            assert.equal(validTask.title, "Test Task");
            assert.equal(validTask.description, "Valid description");
            assert.equal(validTask.priority, "medium");
            assert.equal(validTask.status, "todo");

            // Invalid task creation (missing title)
            try {
                await pm.createTask("", "Description", "high");
                assert.fail("Should reject empty title");
            } catch (error) {
                assert.ok(error.message.includes("Title is required"));
            }
        });

        it("AC2: Task Status Workflow", async () => {
            const task = await pm.createTask("Workflow Test", "Test status transitions");
            
            // Initial state
            assert.equal(task.status, "todo");
            
            // Progress to in-progress
            const inProgress = await pm.updateTaskStatus(task.id, "in-progress");
            assert.equal(inProgress.status, "in-progress");
            
            // Complete task
            const completed = await pm.updateTaskStatus(task.id, "done");
            assert.equal(completed.status, "done");
            
            // Verify final state
            const final = await pm.getTask(task.id);
            assert.ok(final, "Task should exist");
            assert.equal(final.status, "done");
        });

        it("AC3: Priority Management", async () => {
            const task = await pm.createTask("Priority Test", "Test priority changes", "low");
            
            // Change priority
            const updated = await pm.updateTaskPriority(task.id, "high");
            assert.equal(updated.priority, "high");
            
            // Verify persistence
            const retrieved = await pm.getTask(task.id);
            assert.ok(retrieved, "Task should exist");
            assert.equal(retrieved.priority, "high");
        });

        it("AC4: Task Dependencies", async () => {
            const task1 = await pm.createTask("Task 1", "First task");
            const task2 = await pm.createTask("Task 2", "Second task with dependency");
            
            // Add dependency
            const withDeps = await pm.updateTask(task2.id, {
                dependencies: [task1.id]
            });
            
            assert.deepEqual(withDeps.dependencies, [task1.id]);
            
            // Verify dependency tracking
            const retrieved = await pm.getTask(task2.id);
            assert.ok(retrieved, "Task should exist");
            assert.deepEqual(retrieved.dependencies, [task1.id]);
        });

        it("AC5: Concurrent Operations Safety", async () => {
            const task = await pm.createTask("Concurrent Test", "Test concurrent updates");
            
            // Simulate concurrent status and priority updates
            const statusPromise = pm.updateTaskStatus(task.id, "in-progress");
            const priorityPromise = pm.updateTaskPriority(task.id, "high");
            
            const [statusResult, priorityResult] = await Promise.all([
                statusPromise,
                priorityPromise
            ]);
            
            // Both operations should succeed
            assert.equal(statusResult.status, "in-progress");
            assert.equal(priorityResult.priority, "high");
            
            // Final state should be consistent
            const final = await pm.getTask(task.id);
            assert.ok(final, "Task should exist");
            assert.equal(final.status, "in-progress");
            assert.equal(final.priority, "high");
        });

        it("AC6: Data Integrity Under Load", async () => {
            const taskCount = 50;
            const tasks = [];
            
            // Create many tasks rapidly
            for (let i = 0; i < taskCount; i++) {
                const task = await pm.createTask(
                    `Load Test Task ${i}`,
                    `Description for task ${i}`,
                    i % 3 === 0 ? "high" : i % 3 === 1 ? "medium" : "low"
                );
                tasks.push(task);
            }
            
            // Verify all tasks were created correctly
            assert.equal(tasks.length, taskCount);
            
            for (let i = 0; i < tasks.length; i++) {
                const task = tasks[i];
                const retrieved = await pm.getTask(task.id);
                assert.ok(retrieved, `Task ${i} should exist`);
                assert.equal(retrieved.title, task.title);
                assert.equal(retrieved.priority, task.priority);
            }
            
            // Update status for half tasks
            const updatePromises = tasks.slice(0, taskCount / 2).map(task =>
                pm.updateTaskStatus(task.id, "done")
            );
            
            await Promise.all(updatePromises);
            
            // Verify updates persisted
            const updatedTasks = await pm.getAllTasks();
            const doneTasks = updatedTasks.filter(t => t.status === "done");
            assert.equal(doneTasks.length, taskCount / 2);
        });

        it("AC7: Error Handling and Recovery", async () => {
            // Test non-existent task operations
            const fakeId = "non-existent-id";
            
            const nonExistent = await pm.getTask(fakeId);
            assert.equal(nonExistent, null);
            
            try {
                await pm.updateTaskStatus(fakeId, "done");
                assert.fail("Should handle non-existent task gracefully");
            } catch (error) {
                assert.ok(error.message.includes("not found") || error.message.includes("Task"));
            }
            
            try {
                await pm.deleteTask(fakeId);
                // Should not throw - deletion of non-existent should be handled
            } catch (error) {
                // Depending on implementation, this might throw or be silent
                assert.ok(true, "Deletion handled");
            }
        });
    });

    describe("Quality Bar Validation", () => {
        it("QB1: Performance Requirements", async () => {
            const startTime = Date.now();
            
            // Create 20 tasks
            const tasks = [];
            for (let i = 0; i < 20; i++) {
                tasks.push(await pm.createTask(`Perf Test ${i}`, `Test performance`));
            }
            
            // Update all tasks
            const updates = tasks.map(task => pm.updateTaskStatus(task.id, "in-progress"));
            await Promise.all(updates);
            
            const duration = Date.now() - startTime;
            
            // Should complete within reasonable time (adjust threshold as needed)
            assert.ok(duration < 5000, `Operations took ${duration}ms, should be < 5000ms`);
        });

        it("QB2: Memory and Resource Management", async () => {
            // Test that we can create and delete many tasks without memory leaks
            for (let cycle = 0; cycle < 5; cycle++) {
                const tasks = [];
                for (let i = 0; i < 20; i++) {
                    const task = await pm.createTask(`Cycle ${cycle} Task ${i}`, `Test`);
                    if (task && task.id) {
                        tasks.push(task);
                    }
                }
                
                // Delete all tasks
                const deletePromises = tasks.map(task => 
                    task.id ? pm.deleteTask(task.id) : Promise.resolve()
                );
                await Promise.all(deletePromises);
            }
            
            // Verify clean state
            const remainingTasks = await pm.getAllTasks();
            assert.equal(remainingTasks.length, 0);
        });
    });

    describe("Integration Validation", () => {
        it("INT1: Complete Workflow Integration", async () => {
            // Create a realistic task workflow
            const researchTask = await pm.createTask(
                "Research Requirements",
                "Gather and document project requirements",
                "high"
            );
            
            const designTask = await pm.createTask(
                "Design System",
                "Create system architecture design",
                "high"
            );
            
            const implementationTask = await pm.createTask(
                "Implement Features",
                "Code core functionality",
                "medium"
            );
            
            // Set up dependencies
            await pm.updateTask(designTask.id, {
                dependencies: [researchTask.id]
            });
            
            await pm.updateTask(implementationTask.id, {
                dependencies: [designTask.id]
            });
            
            // Execute workflow
            await pm.updateTaskStatus(researchTask.id, "in-progress");
            await pm.updateTaskStatus(researchTask.id, "done");
            
            await pm.updateTaskStatus(designTask.id, "in-progress");
            await pm.updateTaskStatus(designTask.id, "done");
            
            await pm.updateTaskStatus(implementationTask.id, "in-progress");
            await pm.updateTaskStatus(implementationTask.id, "done");
            
            // Verify final state
            const finalResearch = await pm.getTask(researchTask.id);
            const finalDesign = await pm.getTask(designTask.id);
            const finalImplementation = await pm.getTask(implementationTask.id);
            
            assert.ok(finalResearch, "Research task should exist");
            assert.ok(finalDesign, "Design task should exist");
            assert.ok(finalImplementation, "Implementation task should exist");
            
            assert.equal(finalResearch.status, "done");
            assert.equal(finalDesign.status, "done");
            assert.equal(finalImplementation.status, "done");
        });
    });
});

console.log("Acceptance Criteria Test Suite Completed");