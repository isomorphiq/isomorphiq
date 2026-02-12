#!/usr/bin/env node

/**
 * Dashboard Demo Script
 * Demonstrates web dashboard functionality by creating sample tasks and showing real-time updates
 */

import { createConnection } from "node:net";
import { WebSocket } from "ws";

const DASHBOARD_URL = "http://localhost:3005";
const TCP_PORT = 3001;

function sendTcpCommand(command, data) {
    return new Promise((resolve, reject) => {
        const client = createConnection({ port: TCP_PORT, host: "localhost" }, () => {
            const message = JSON.stringify({ command, data }) + "\n";
            client.write(message);
        });

        let response = "";
        client.on("data", (data) => {
            response += data.toString();
            try {
                const result = JSON.parse(response.trim());
                client.end();
                resolve(result);
            } catch (e) {
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
        }, 10000);
    });
}

async function createSampleTasks() {
    console.log("🎯 Creating sample tasks for dashboard demonstration...\n");
    
    const sampleTasks = [
        {
            title: "Fix Critical Bug in Authentication",
            description: "Users are unable to login with OAuth2 providers. Need to investigate token validation flow.",
            priority: "high",
            type: "bug",
            assignedTo: "backend-team"
        },
        {
            title: "Implement Dashboard Dark Mode",
            description: "Add CSS variables and toggle switch for dark/light theme in the web dashboard.",
            priority: "medium",
            type: "feature",
            assignedTo: "frontend-team"
        },
        {
            title: "Database Performance Optimization",
            description: "Optimize slow queries identified in performance monitoring. Focus on task listing queries.",
            priority: "high",
            type: "optimization",
            dependencies: []
        },
        {
            title: "Update API Documentation",
            description: "Update OpenAPI specs with new endpoints and examples for v2.0 release.",
            priority: "low",
            type: "documentation"
        },
        {
            title: "Setup CI/CD Pipeline",
            description: "Configure GitHub Actions for automated testing and deployment to staging environment.",
            priority: "medium",
            type: "infrastructure"
        }
    ];

    const createdTasks = [];
    
    for (let i = 0; i < sampleTasks.length; i++) {
        const task = sampleTasks[i];
        console.log(`Creating task ${i + 1}/${sampleTasks.length}: ${task.title}`);
        
        try {
            const result = await sendTcpCommand("create_task", task);
            if (result.success) {
                createdTasks.push(result.data);
                console.log(`   ✅ Created: ${result.data.id}`);
            } else {
                console.log(`   ❌ Failed: ${result.error?.message || "Unknown error"}`);
            }
        } catch (error) {
            console.log(`   ❌ Error: ${error.message}`);
        }
    }
    
    console.log(`\n📝 Created ${createdTasks.length} sample tasks\n`);
    return createdTasks;
}

async function simulateTaskProgress(tasks) {
    console.log("⚡ Simulating real-time task progress...\n");
    
    // Connect to dashboard WebSocket for real-time updates
    const ws = new WebSocket(`ws://localhost:3005/dashboard-ws`);
    
    ws.on("open", () => {
        console.log("📡 Connected to dashboard WebSocket for real-time updates\n");
        
        // Simulate task progress over time
        setTimeout(async () => {
            if (tasks.length > 0) {
                const firstTask = tasks[0];
                console.log(`🔄 Updating task: ${firstTask.title} -> in-progress`);
                await sendTcpCommand("update_task_status", { 
                    id: firstTask.id, 
                    status: "in-progress" 
                });
            }
        }, 2000);
        
        setTimeout(async () => {
            if (tasks.length > 1) {
                const secondTask = tasks[1];
                console.log(`🔄 Updating task: ${secondTask.title} -> in-progress`);
                await sendTcpCommand("update_task_status", { 
                    id: secondTask.id, 
                    status: "in-progress" 
                });
            }
        }, 4000);
        
        setTimeout(async () => {
            if (tasks.length > 0) {
                const firstTask = tasks[0];
                console.log(`✅ Completing task: ${firstTask.title} -> done`);
                await sendTcpCommand("update_task_status", { 
                    id: firstTask.id, 
                    status: "done" 
                });
            }
        }, 6000);
        
        setTimeout(async () => {
            if (tasks.length > 2) {
                const thirdTask = tasks[2];
                console.log(`🔄 Updating task: ${thirdTask.title} -> in-progress`);
                await sendTcpCommand("update_task_status", { 
                    id: thirdTask.id, 
                    status: "in-progress" 
                });
            }
        }, 8000);
        
        setTimeout(() => {
            console.log("\n🎬 Demo simulation complete!");
            console.log("\n💡 Open your browser and navigate to:");
            console.log(`   ${DASHBOARD_URL}`);
            console.log("\nYou should see:");
            console.log("   • Real-time task updates appearing instantly");
            console.log("   • Task counts changing in the metrics");
            console.log("   • Status indicators updating automatically");
            console.log("   • WebSocket notifications in the browser console");
            
            ws.close();
            process.exit(0);
        }, 10000);
    });
    
    ws.on("message", (data) => {
        try {
            const message = JSON.parse(data.toString());
            switch (message.type) {
                case "task_status_changed":
                    console.log(`🔔 Real-time update: Task ${message.data.taskId} -> ${message.data.newStatus}`);
                    break;
                case "metrics_update":
                    console.log(`📊 Metrics updated: ${message.data.tasks.total} total tasks`);
                    break;
                default:
                    console.log(`📡 WebSocket message: ${message.type}`);
            }
        } catch (error) {
            console.log("📡 Received WebSocket message");
        }
    });
    
    ws.on("error", (error) => {
        console.log(`❌ WebSocket error: ${error.message}`);
    });
}

async function runDemo() {
    console.log("🚀 Task Manager Dashboard Demo");
    console.log("================================\n");
    
    console.log("This demo will:");
    console.log("1. Create sample tasks via TCP API");
    console.log("2. Connect to dashboard WebSocket");
    console.log("3. Simulate task progress updates");
    console.log("4. Show real-time dashboard updates\n");
    
    try {
        const tasks = await createSampleTasks();
        await simulateTaskProgress(tasks);
    } catch (error) {
        console.error("❌ Demo failed:", error.message);
        process.exit(1);
    }
}

// Check if dashboard is running
async function checkDashboardStatus() {
    try {
        const response = await fetch(`${DASHBOARD_URL}/api/health`);
        if (response.status === 200) {
            console.log("✅ Dashboard is running\n");
            return true;
        }
    } catch (error) {
        console.log("❌ Dashboard is not accessible");
        console.log("Please make sure the daemon is running with dashboard enabled:");
        console.log("   yarn run worker");
        console.log("Then access the dashboard at: http://localhost:3005\n");
        return false;
    }
}

// Check Node.js version for fetch
if (typeof fetch === "undefined") {
    console.log("❌ This script requires Node.js 18+ for built-in fetch");
    process.exit(1);
}

// Start demo
checkDashboardStatus().then((isRunning) => {
    if (isRunning) {
        runDemo();
    } else {
        process.exit(1);
    }
}).catch(console.error);