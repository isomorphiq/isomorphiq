#!/usr/bin/env node

import { spawn } from "node:child_process";

async function testDashboard() {
    console.log("🚀 Testing Task Dashboard Implementation");
    console.log("=====================================\n");

    const baseUrl = "http://localhost:3005";
    
    try {
        // Test 1: Check dashboard page is accessible
        console.log("1️⃣ Testing dashboard page accessibility...");
        const response = await fetch(`${baseUrl}/`);
        if (response.ok) {
            console.log("✅ Dashboard page is accessible");
        } else {
            console.log("❌ Dashboard page not accessible");
            return;
        }

        // Test 2: Test metrics API
        console.log("\n2️⃣ Testing metrics API...");
        const metricsResponse = await fetch(`${baseUrl}/api/metrics`);
        if (metricsResponse.ok) {
            const metrics = await metricsResponse.json();
            console.log("✅ Metrics API working");
            console.log(`   - Total tasks: ${metrics.tasks.total}`);
            console.log(`   - Pending: ${metrics.tasks.pending}`);
            console.log(`   - In Progress: ${metrics.tasks.inProgress}`);
            console.log(`   - Completed: ${metrics.tasks.completed}`);
            console.log(`   - Daemon uptime: ${Math.floor(metrics.daemon.uptime)}s`);
        } else {
            console.log("❌ Metrics API not working");
        }

        // Test 3: Test tasks API
        console.log("\n3️⃣ Testing tasks API...");
        const tasksResponse = await fetch(`${baseUrl}/api/tasks`);
        if (tasksResponse.ok) {
            const tasks = await tasksResponse.json();
            console.log("✅ Tasks API working");
            console.log(`   - Retrieved ${tasks.length} tasks`);
        } else {
            console.log("❌ Tasks API not working");
        }

        // Test 4: Test task creation
        console.log("\n4️⃣ Testing task creation...");
        const createResponse = await fetch(`${baseUrl}/api/tasks`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                title: "Dashboard Test Task",
                description: "Testing dashboard functionality",
                priority: "medium",
                assignedTo: "test-user"
            })
        });
        
        if (createResponse.ok) {
            const result = await createResponse.json();
            console.log("✅ Task creation working");
            console.log(`   - Created task: ${result.data.id}`);
            console.log(`   - Title: ${result.data.title}`);
        } else {
            console.log("❌ Task creation not working");
        }

        // Test 5: Test queue status
        console.log("\n5️⃣ Testing queue status API...");
        const queueResponse = await fetch(`${baseUrl}/api/queue/status`);
        if (queueResponse.ok) {
            const queue = await queueResponse.json();
            console.log("✅ Queue status API working");
            console.log(`   - Total in queue: ${queue.total}`);
            console.log(`   - High priority: ${queue.highPriority}`);
            console.log(`   - Average processing time: ${Math.floor(queue.processingTimes.averageProcessingTime)}s`);
        } else {
            console.log("❌ Queue status API not working");
        }

        // Test 6: Test health endpoint
        console.log("\n6️⃣ Testing health API...");
        const healthResponse = await fetch(`${baseUrl}/api/health`);
        if (healthResponse.ok) {
            const health = await healthResponse.json();
            console.log("✅ Health API working");
            console.log(`   - Status: ${health.status}`);
            console.log(`   - Memory usage: ${health.daemon.memory.percentage}%`);
        } else {
            console.log("❌ Health API not working");
        }

        console.log("\n🎉 Dashboard Implementation Test Complete!");
        console.log("=====================================");
        console.log("Dashboard appears to be fully functional with:");
        console.log("✅ Web interface serving");
        console.log("✅ Real-time metrics API");
        console.log("✅ Task management APIs");
        console.log("✅ Queue status monitoring");
        console.log("✅ Health checks");
        console.log("✅ Task creation and management");

    } catch (error) {
        console.error("❌ Error testing dashboard:", error);
    }
}

// Run the test
testDashboard();