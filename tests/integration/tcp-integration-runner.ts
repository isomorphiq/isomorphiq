import { createConnection } from "node:net";

async function runIntegrationTest() {
    console.log("=== TCP Integration Test Execution ===");
    
    async function sendCommand(command: string, data: any): Promise<any> {
        return new Promise((resolve, reject) => {
            const client = createConnection({ port: 3001, host: "localhost" }, () => {
                const message = `${JSON.stringify({ command, data })}\n`;
                client.write(message);
            });

            let response = "";
            client.on("data", (data) => {
                response += data.toString();
                try {
                    const result = JSON.parse(response.trim());
                    client.end();
                    resolve(result);
                } catch (_e) {
                    // Wait for more data
                }
            });

            client.on("error", (err) => {
                reject(new Error(`Connection error: ${err.message}`));
            });

            client.on("close", () => {
                if (!response) {
                    reject(new Error("Connection closed without response"));
                }
            });

            setTimeout(() => {
                client.destroy();
                reject(new Error("Request timeout"));
            }, 5000);
        });
    }

    let testCount = 0;
    let passCount = 0;

    async function runTest(name: string, testFn: () => Promise<void>) {
        testCount++;
        try {
            await testFn();
            console.log(`✓ ${name}`);
            passCount++;
        } catch (error) {
            console.log(`✗ ${name}: ${error.message}`);
        }
    }

    await runTest("should check daemon status", async () => {
        const result = await sendCommand("get_daemon_status", {});
        if (!result.success) throw new Error("Daemon status check failed");
    });

    await runTest("should create a task", async () => {
        const taskData = {
            title: "Integration Test Task",
            description: "Task created via TCP integration test", 
            priority: "medium",
            createdBy: "integration-test"
        };
        const result = await sendCommand("create_task", taskData);
        if (!result.success) throw new Error("Task creation failed");
        if (!result.data.id) throw new Error("No task ID returned");
        if (result.data.title !== taskData.title) throw new Error("Title mismatch");
        if (result.data.description !== taskData.description) throw new Error("Description mismatch");
        if (result.data.priority !== taskData.priority) throw new Error("Priority mismatch");
        if (result.data.createdBy !== taskData.createdBy) throw new Error("Creator mismatch");
        if (result.data.status !== "todo") throw new Error("Default status should be todo");
    });

    await runTest("should list tasks", async () => {
        const result = await sendCommand("list_tasks", {});
        if (!result.success) throw new Error("Task listing failed");
        if (!Array.isArray(result.data)) throw new Error("Should return array of tasks");
    });

    await runTest("should get task by ID", async () => {
        // First create a task
        const createResult = await sendCommand("create_task", {
            title: "Get Task Test",
            description: "Task for get operation test",
            priority: "medium"
        });

        if (!createResult.success) throw new Error("Task creation failed");
        const taskId = createResult.data.id;

        // Now get the task
        const getResult = await sendCommand("get_task", { id: taskId });
        if (!getResult.success) throw new Error("Task retrieval failed");
        if (getResult.data.id !== taskId) throw new Error("Wrong task ID returned");
        if (getResult.data.title !== "Get Task Test") throw new Error("Wrong task title");
    });

    await runTest("should update task status", async () => {
        // Create a task first
        const createResult = await sendCommand("create_task", {
            title: "Status Update Test", 
            description: "Task for status update test",
            priority: "low"
        });

        if (!createResult.success) throw new Error("Task creation failed");
        const taskId = createResult.data.id;
        const initialStatus = createResult.data.status;

        // Update the task status
        const updateResult = await sendCommand("update_task_status", { 
            id: taskId, 
            status: "done" 
        });
        
        if (!updateResult.success) throw new Error("Task status update failed");
        if (updateResult.data.status !== "done") throw new Error("Status not updated correctly");
        if (updateResult.data.status === initialStatus) throw new Error("Status should have changed");
    });

    await runTest("should update task priority", async () => {
        // Create a task first
        const createResult = await sendCommand("create_task", {
            title: "Priority Update Test",
            description: "Task for priority update test", 
            priority: "medium"
        });

        if (!createResult.success) throw new Error("Task creation failed");
        const taskId = createResult.data.id;
        const initialPriority = createResult.data.priority;

        // Update the task priority
        const updateResult = await sendCommand("update_task_priority", { 
            id: taskId, 
            priority: "high" 
        });
        
        if (!updateResult.success) throw new Error("Task priority update failed");
        if (updateResult.data.priority !== "high") throw new Error("Priority not updated correctly");
        if (updateResult.data.priority === initialPriority) throw new Error("Priority should have changed");
    });

    await runTest("should delete a task", async () => {
        // Create a task first
        const createResult = await sendCommand("create_task", {
            title: "Delete Test Task",
            description: "Task for deletion test",
            priority: "low"
        });

        if (!createResult.success) throw new Error("Task creation failed");
        const taskId = createResult.data.id;

        // Delete the task
        const deleteResult = await sendCommand("delete_task", { id: taskId });
        if (!deleteResult.success) throw new Error("Task deletion failed");
        if (deleteResult.data !== true) throw new Error("Should return true for successful deletion");

        // Verify task is deleted
        const getResult = await sendCommand("get_task", { id: taskId });
        if (getResult.success) throw new Error("Deleted task should not be found");
    });

    await runTest("should handle invalid data", async () => {
        const invalidTaskData = {
            title: "", // Empty title should fail
            description: "Invalid task with empty title"
        };

        const result = await sendCommand("create_task", invalidTaskData);
        if (result.success) throw new Error("Should fail to create task with empty title");
        if (!result.error) throw new Error("Should provide error message");
    });

    await runTest("should handle non-existent task", async () => {
        const result = await sendCommand("get_task", { id: "non-existent-task-id" });
        if (result.success) throw new Error("Should fail for non-existent task");
        if (!result.error) throw new Error("Should provide error object");
    });

    await runTest("should filter tasks by status", async () => {
        // Create tasks with different statuses
        await sendCommand("create_task", {
            title: "Todo Task",
            description: "Task with todo status",
            priority: "medium"
        });

        const updateResult = await sendCommand("create_task", {
            title: "Done Task", 
            description: "Task that will be marked done",
            priority: "low"
        });

        if (updateResult.success) {
            await sendCommand("update_task_status", { 
                id: updateResult.data.id, 
                status: "done" 
            });
        }

        const result = await sendCommand("list_tasks_filtered", {
            filters: { status: "todo" }
        });

        if (!result.success) throw new Error("Task filtering failed");
        if (!Array.isArray(result.data)) throw new Error("Should return array of tasks");
        
        // All returned tasks should have the specified status
        result.data.forEach((task: any) => {
            if (task.status !== "todo") {
                throw new Error("All tasks should have todo status");
            }
        });
    });

    await runTest("should search tasks", async () => {
        // Create tasks with specific content
        await sendCommand("create_task", {
            title: "Integration Test Task One",
            description: "First task for integration testing",
            priority: "medium"
        });

        await sendCommand("create_task", {
            title: "Integration Test Task Two", 
            description: "Second task for integration testing",
            priority: "low"
        });

        const result = await sendCommand("list_tasks_filtered", {
            filters: { search: "integration test" }
        });

        if (!result.success) throw new Error("Task search failed");
        if (!Array.isArray(result.data)) throw new Error("Should return array of tasks");
        
        // All returned tasks should contain the search text
        result.data.forEach((task: any) => {
            const searchText = "integration test";
            const containsInTitle = task.title.toLowerCase().includes(searchText);
            const containsInDescription = task.description.toLowerCase().includes(searchText);
            if (!containsInTitle && !containsInDescription) {
                throw new Error("Task should contain search text");
            }
        });
    });

    await runTest("should create monitoring session", async () => {
        const result = await sendCommand("create_monitoring_session", {
            filters: {
                status: "todo",
                priority: "high"
            }
        });

        if (!result.success) throw new Error("Monitoring session creation failed");
        if (!result.data.id) throw new Error("Should return session ID");
        if (!result.data.filters) throw new Error("Should return filters");
        if (!result.data.createdAt) throw new Error("Should return creation timestamp");
        if (result.data.active !== true) throw new Error("Should be active");
    });

    await runTest("should handle concurrent requests", async () => {
        const requests = Array.from({ length: 3 }, () =>
            sendCommand("list_tasks", {})
        );

        const results = await Promise.allSettled(requests);
        
        // Most requests should succeed
        const successful = results.filter(r => r.status === 'fulfilled').length;
        if (successful < 2) throw new Error(`At least 2 of 3 requests should succeed, got ${successful}`);

        // Verify responses are consistent
        const successfulResults = results
            .filter(r => r.status === 'fulfilled')
            .map(r => (r as PromiseFulfilledResult<any>).value);
        
        successfulResults.forEach(result => {
            if (!result.success) throw new Error("Successful requests should return success");
            if (!Array.isArray(result.data)) throw new Error("Should return array of tasks");
        });
    });

    console.log(`\n=== Test Results ===`);
    console.log(`Total tests: ${testCount}`);
    console.log(`Passed: ${passCount}`);
    console.log(`Failed: ${testCount - passCount}`);
    console.log(`Success rate: ${Math.round((passCount / testCount) * 100)}%`);
    
    if (passCount === testCount) {
        console.log("\n🎉 All tests passed! TCP integration is working correctly.");
    } else {
        console.log("\n❌ Some tests failed. Please check the issues above.");
        process.exit(1);
    }
}

runIntegrationTest().catch(error => {
    console.error("Integration test failed:", error);
    process.exit(1);
});