#!/usr/bin/env node
import { createConnection } from "node:net";

const TASK_DATA = {
    title: "Add Module Federation Support to Frontend",
    description: "Implement module federation to enable micro-frontend architecture with independent deployments and better performance. This should include: 1) Setting up Module Federation Plugin in the build system, 2) Configuring shared dependencies, 3) Creating remote module containers, 4) Implementing lazy loading for remote modules, 5) Adding error boundaries and fallbacks.",
    priority: "high",
    type: "feature",
    assignedTo: "senior-developer",
    dependencies: []
};

async function createTask() {
    const client = createConnection({ port: 3001, host: "localhost" }, () => {
        console.log("Connected to daemon");
        
        const command = JSON.stringify({ 
            command: "create_task", 
            data: TASK_DATA 
        }) + "\n";
        
        client.write(command);
    });

    let response = "";
    
    client.on("data", (data) => {
        response += data.toString();
        
        try {
            const result = JSON.parse(response.trim());
            if (result.success) {
                console.log("✅ Task created successfully!");
                console.log(`Task ID: ${result.data.id}`);
                console.log(`Title: ${result.data.title}`);
                console.log(`Status: ${result.data.status}`);
                console.log(`Priority: ${result.data.priority}`);
            } else {
                console.error("❌ Failed to create task:", result.error);
            }
            client.end();
        } catch (error) {
            // Wait for more data if JSON is incomplete
            if (response.length < 1000) {
                return;
            }
            console.error("❌ Invalid response from daemon:", response);
            client.end();
        }
    });

    client.on("error", (error) => {
        console.error("❌ Connection error:", error.message);
        process.exit(1);
    });

    client.on("timeout", () => {
        console.error("❌ Connection timeout");
        process.exit(1);
    });

    client.on("close", () => {
        if (!response) {
            console.error("❌ Connection closed without response");
        }
        process.exit(0);
    });

    client.setTimeout(10000);
}

createTask().catch((error) => {
    console.error("❌ Failed to create task:", error.message);
    process.exit(1);
});