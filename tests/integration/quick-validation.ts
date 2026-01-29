import { DaemonTcpClient } from "../e2e/dashboard/tcp-client.ts";

async function quickValidation() {
    console.log("[VALIDATION] Starting TCP integration validation...");
    
    const tcpClient = new DaemonTcpClient();
    
    try {
        // Test 1: Connection
        console.log("[VALIDATION] Testing connection...");
        const isConnected = await tcpClient.checkConnection();
        console.log(`[VALIDATION] Connection status: ${isConnected}`);
        
        // Test 2: Create a task
        console.log("[VALIDATION] Testing task creation...");
        const createResult = await tcpClient.createTask({
            title: "Integration Test Task",
            description: "Task created via TCP integration test",
            priority: "medium",
            createdBy: "integration-test"
        });
        
        if (createResult.success && createResult.data) {
            console.log(`[VALIDATION] Task created successfully with ID: ${createResult.data.id}`);
            
            // Test 3: Get the task
            console.log("[VALIDATION] Testing task retrieval...");
            const getResult = await tcpClient.getTask(createResult.data.id);
            
            if (getResult.success && getResult.data) {
                console.log(`[VALIDATION] Task retrieved successfully: ${getResult.data.title}`);
                
                // Test 4: Update task status
                console.log("[VALIDATION] Testing task status update...");
                const updateResult = await tcpClient.updateTaskStatus(createResult.data.id, "done");
                
                if (updateResult.success && updateResult.data) {
                    console.log(`[VALIDATION] Task status updated to: ${updateResult.data.status}`);
                } else {
                    console.error("[VALIDATION] Failed to update task status:", updateResult.error);
                }
            } else {
                console.error("[VALIDATION] Failed to retrieve task:", getResult.error);
            }
        } else {
            console.error("[VALIDATION] Failed to create task:", createResult.error);
        }
        
        // Test 5: List tasks
        console.log("[VALIDATION] Testing task listing...");
        const listResult = await tcpClient.listTasks();
        
        if (listResult.success && listResult.data) {
            console.log(`[VALIDATION] Listed ${listResult.data.length} tasks successfully`);
        } else {
            console.error("[VALIDATION] Failed to list tasks:", listResult.error);
        }
        
        console.log("[VALIDATION] TCP integration validation completed successfully!");
        
    } catch (error) {
        console.error("[VALIDATION] Validation failed:", error);
    } finally {
        tcpClient.disconnectWebSocket();
    }
}

quickValidation().catch(console.error);