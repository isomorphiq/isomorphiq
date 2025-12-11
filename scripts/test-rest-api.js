#!/usr/bin/env node
// Test script for REST API endpoints
import http from 'node:http';
const API_BASE = 'http://localhost:3002/api';
// Helper function to make HTTP requests
function makeRequest(method, path, data) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, API_BASE);
        const options = {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            method: method,
            headers: {
                'Content-Type': 'application/json',
            },
        };
        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => {
                body += chunk;
            });
            res.on('end', () => {
                try {
                    const result = JSON.parse(body);
                    resolve({ status: res.statusCode, data: result });
                }
                catch (_error) {
                    resolve({ status: res.statusCode, data: body });
                }
            });
        });
        req.on('error', (error) => {
            reject(error);
        });
        if (data) {
            req.write(JSON.stringify(data));
        }
        req.end();
    });
}
// Test functions
async function testHealthCheck() {
    console.log('\n🔍 Testing health check...');
    try {
        const response = await makeRequest('GET', '/health');
        console.log(`✅ Health check: ${response.status}`);
        console.log(`   Response:`, response.data);
    }
    catch (error) {
        console.error(`❌ Health check failed:`, error.message);
    }
}
async function testCreateTask() {
    console.log('\n🔍 Testing task creation...');
    try {
        const taskData = {
            title: 'Test REST API Task',
            description: 'This is a test task created via REST API',
            priority: 'high'
        };
        const response = await makeRequest('POST', '/tasks', taskData);
        console.log(`✅ Create task: ${response.status}`);
        console.log(`   Response:`, response.data);
        return response.data.task?.id;
    }
    catch (error) {
        console.error(`❌ Create task failed:`, error.message);
        return null;
    }
}
async function testListTasks() {
    console.log('\n🔍 Testing task listing...');
    try {
        const response = await makeRequest('GET', '/tasks');
        console.log(`✅ List tasks: ${response.status}`);
        console.log(`   Found ${response.data.count} tasks`);
        return response.data.tasks;
    }
    catch (error) {
        console.error(`❌ List tasks failed:`, error.message);
        return [];
    }
}
async function testGetTask(taskId) {
    console.log(`\n🔍 Testing get task ${taskId}...`);
    try {
        const response = await makeRequest('GET', `/tasks/${taskId}`);
        console.log(`✅ Get task: ${response.status}`);
        console.log(`   Response:`, response.data);
    }
    catch (error) {
        console.error(`❌ Get task failed:`, error.message);
    }
}
async function testUpdateTaskStatus(taskId) {
    console.log(`\n🔍 Testing update task status ${taskId}...`);
    try {
        const response = await makeRequest('PUT', `/tasks/${taskId}/status`, { status: 'in-progress' });
        console.log(`✅ Update task status: ${response.status}`);
        console.log(`   Response:`, response.data);
    }
    catch (error) {
        console.error(`❌ Update task status failed:`, error.message);
    }
}
async function testUpdateTaskPriority(taskId) {
    console.log(`\n🔍 Testing update task priority ${taskId}...`);
    try {
        const response = await makeRequest('PUT', `/tasks/${taskId}/priority`, { priority: 'medium' });
        console.log(`✅ Update task priority: ${response.status}`);
        console.log(`   Response:`, response.data);
    }
    catch (error) {
        console.error(`❌ Update task priority failed:`, error.message);
    }
}
async function testGetTasksByStatus() {
    console.log('\n🔍 Testing get tasks by status...');
    try {
        const response = await makeRequest('GET', '/tasks/status/todo');
        console.log(`✅ Get tasks by status: ${response.status}`);
        console.log(`   Found ${response.data.count} todo tasks`);
    }
    catch (error) {
        console.error(`❌ Get tasks by status failed:`, error.message);
    }
}
async function testGetTasksByPriority() {
    console.log('\n🔍 Testing get tasks by priority...');
    try {
        const response = await makeRequest('GET', '/tasks/priority/high');
        console.log(`✅ Get tasks by priority: ${response.status}`);
        console.log(`   Found ${response.data.count} high priority tasks`);
    }
    catch (error) {
        console.error(`❌ Get tasks by priority failed:`, error.message);
    }
}
async function testGetStats() {
    console.log('\n🔍 Testing get task statistics...');
    try {
        const response = await makeRequest('GET', '/stats');
        console.log(`✅ Get stats: ${response.status}`);
        console.log(`   Response:`, response.data);
    }
    catch (error) {
        console.error(`❌ Get stats failed:`, error.message);
    }
}
async function testDeleteTask(taskId) {
    console.log(`\n🔍 Testing delete task ${taskId}...`);
    try {
        const response = await makeRequest('DELETE', `/tasks/${taskId}`);
        console.log(`✅ Delete task: ${response.status}`);
        console.log(`   Response:`, response.data);
    }
    catch (error) {
        console.error(`❌ Delete task failed:`, error.message);
    }
}
async function testErrorHandling() {
    console.log('\n🔍 Testing error handling...');
    try {
        // Test invalid endpoint
        const response = await makeRequest('GET', '/invalid-endpoint');
        console.log(`✅ Invalid endpoint: ${response.status}`);
    }
    catch (error) {
        console.error(`❌ Error handling test failed:`, error.message);
    }
    try {
        // Test invalid task data
        const response = await makeRequest('POST', '/tasks', { title: '' });
        console.log(`✅ Invalid task data: ${response.status}`);
    }
    catch (error) {
        console.error(`❌ Invalid task data test failed:`, error.message);
    }
}
// Main test runner
async function runTests() {
    console.log('🚀 Starting REST API Tests...');
    console.log('=====================================');
    // Test basic functionality
    await testHealthCheck();
    await testListTasks();
    await testGetStats();
    await testGetTasksByStatus();
    await testGetTasksByPriority();
    // Test CRUD operations
    const taskId = await testCreateTask();
    if (taskId) {
        await testGetTask(taskId);
        await testUpdateTaskStatus(taskId);
        await testUpdateTaskPriority(taskId);
        await testDeleteTask(taskId);
    }
    // Test error handling
    await testErrorHandling();
    console.log('\n=====================================');
    console.log('✅ REST API Tests Completed!');
}
// Check if server is running, then run tests
async function checkServerAndRunTests() {
    try {
        await makeRequest('GET', '/health');
        await runTests();
    }
    catch (_error) {
        console.error('❌ Cannot connect to REST API server on port 3002');
        console.error('Please start the server with: npm run http-api');
        process.exit(1);
    }
}
// Run tests
checkServerAndRunTests().catch(console.error);
//# sourceMappingURL=test-rest-api.js.map