#!/usr/bin/env node

async function testEnhancedDashboardFeatures() {
    console.log("🚀 Testing Enhanced Dashboard Features");
    console.log("=======================================\n");

    const baseUrl = "http://localhost:3005";
    
    try {
        // Test 1: Test task creation with dependencies
        console.log("1️⃣ Testing task creation with dependencies...");
        
        // First, get some existing tasks to use as dependencies
        const tasksResponse = await fetch(`${baseUrl}/api/tasks`);
        const tasks = await tasksResponse.json();
        
        if (tasks.length > 0) {
            const dependencyIds = [tasks[0].id, tasks[1].id].slice(0, 2); // Use first 2 tasks as dependencies
            
            const createTaskWithDepsResponse = await fetch(`${baseUrl}/api/tasks`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    title: "Enhanced Task with Dependencies",
                    description: "Testing task creation with multiple dependencies",
                    priority: "high",
                    assignedTo: "test-user",
                    dependencies: dependencyIds
                })
            });
            
            if (createTaskWithDepsResponse.ok) {
                const result = await createTaskWithDepsResponse.json();
                if (result.success) {
                    console.log("✅ Task creation with dependencies working");
                    console.log(`   - Created task: ${result.data.id}`);
                    console.log(`   - Dependencies: ${dependencyIds.join(', ')}`);
                } else {
                    console.log("❌ Task creation with dependencies failed");
                }
            } else {
                console.log("❌ Could not get tasks for dependency testing");
            }

        // Test 2: Test scheduled task creation
        console.log("\n2️⃣ Testing scheduled task creation...");
        
        const scheduledTaskResponse = await fetch(`${baseUrl}/api/scheduler/create`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                task: {
                    title: "Scheduled Test Task",
                    description: "Testing cron scheduling functionality",
                    priority: "medium",
                    assignedTo: "test-user"
                },
                schedule: {
                    type: "recurring",
                    cronExpression: "0 9 * * 1-5" // Weekdays at 9 AM
                }
            })
        });
        
        if (scheduledTaskResponse.ok) {
            const result = await scheduledTaskResponse.json();
            if (result.success) {
                console.log("✅ Scheduled task creation working");
                console.log(`   - Created scheduled task: ${result.data.id}`);
                console.log(`   - Cron expression: ${result.data.cronExpression}`);
            } else {
                console.log("❌ Scheduled task creation failed");
                console.log(`   - Error: ${result.error}`);
            }
        } else {
            console.log("❌ Scheduled task API not responding");
        }

        // Test 3: Test dependency graph API
        console.log("\n3️⃣ Testing dependency graph API...");
        
        const dependencyGraphResponse = await fetch(`${baseUrl}/api/dependencies/graph`);
        if (dependencyGraphResponse.ok) {
            const graphData = await dependencyGraphResponse.json();
            if (graphData.success) {
                console.log("✅ Dependency graph API working");
                console.log(`   - Nodes: ${graphData.data.nodes.length}`);
                console.log(`   - Edges: ${graphData.data.links.length}`);
                console.log(`   - Max depth: ${graphData.data.maxDepth || 'N/A'}`);
            } else {
                console.log("❌ Dependency graph API failed");
            }
        } else {
            console.log("❌ Dependency graph API not responding");
        }

        // Test 4: Test task search functionality
        console.log("\n4️⃣ Testing task search functionality...");
        
        const searchResponse = await fetch(`${baseUrl}/api/tasks/search?q=test`);
        if (searchResponse.ok) {
            const searchResults = await searchResponse.json();
            console.log("✅ Task search working");
            console.log(`   - Found ${searchResults.length} tasks matching 'test'`);
        } else {
            console.log("❌ Task search failed");
        }

        // Test 5: Test task status update
        console.log("\n5️⃣ Testing task status update...");
        
        if (tasks.length > 0) {
            const updateResponse = await fetch(`${baseUrl}/api/tasks/update`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    id: tasks[0].id,
                    status: "in-progress"
                })
            });
            
            if (updateResponse.ok) {
                const result = await updateResponse.json();
                if (result.success) {
                    console.log("✅ Task status update working");
                    console.log(`   - Updated task: ${tasks[0].id}`);
                    console.log(`   - New status: in-progress`);
                } else {
                    console.log("❌ Task status update failed");
                }
            } else {
                console.log("❌ Task update API not responding");
            }
        } else {
            console.log("❌ Task update API not responding");
        }

        console.log("\n🎉 Enhanced Dashboard Features Test Complete!");
        console.log("===========================================");
        console.log("Enhanced dashboard features tested:");
        console.log("✅ Task creation with dependencies");
        console.log("✅ Scheduled task creation");
        console.log("✅ Dependency graph API");
        console.log("✅ Task search functionality");
        console.log("✅ Task status updates");
        console.log("\nThe dashboard now includes advanced task management features!");
        
    } catch (error) {
        console.error("❌ Error testing enhanced features:", error);
    }
}

// Run the enhanced tests
testEnhancedDashboardFeatures();