#!/usr/bin/env node

import { createConnection } from 'net';

// Function to send command to daemon
function sendCommand(command, data = {}) {
    return new Promise((resolve, reject) => {
        const client = createConnection({ port: 3001, host: 'localhost' }, () => {
            const message = JSON.stringify({ command, data }) + '\n';
            client.write(message);
        });

        let response = '';
        client.on('data', (data) => {
            response += data.toString();
            try {
                const result = JSON.parse(response.trim());
                resolve(result);
                client.end();
            } catch (e) {
                // Wait for more data
            }
        });

        client.on('error', (err) => {
            reject(err);
        });

        client.on('close', () => {
            if (response && !response.includes('success')) {
                reject(new Error('Invalid response'));
            }
        });

        // Timeout
        setTimeout(() => {
            client.destroy();
            reject(new Error('Timeout'));
        }, 5000);
    });
}

async function checkSpecificTask() {
    const taskId = "task-1765516137864-6sgm4m3mv";
    
    try {
        console.log(`🔍 Checking task ${taskId}...`);
        
        // Get all tasks to find the specific one
        const listResponse = await sendCommand('list_tasks');
        
        if (!listResponse.success) {
            throw new Error(`Failed to list tasks: ${listResponse.error?.message}`);
        }
        
        const allTasks = listResponse.data;
        const specificTask = allTasks.find(task => task.id === taskId);
        
        if (!specificTask) {
            console.log(`❌ Task ${taskId} not found!`);
            return;
        }
        
        console.log('\n📋 TASK DETAILS:');
        console.log('ID:', specificTask.id);
        console.log('Title:', specificTask.title);
        console.log('Description:', specificTask.description);
        console.log('Priority:', specificTask.priority);
        console.log('Status:', specificTask.status);
        console.log('Created:', specificTask.createdAt);
        
        if (specificTask.status === 'todo') {
            console.log('\n🎯 Task is available for claiming!');
            
            // Try to claim it
            console.log('\n📝 Claiming task...');
            const updateResponse = await sendCommand('update_task_status', {
                id: specificTask.id,
                status: 'in-progress'
            });
            
            if (updateResponse.success) {
                console.log('\n✅ Task claimed successfully!');
                console.log('New status:', updateResponse.data.status);
                return specificTask;
            } else {
                console.log('\n❌ Failed to claim task:', updateResponse.error?.message);
            }
        } else {
            console.log(`\n⚠️  Task is already ${specificTask.status}`);
        }
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        throw error;
    }
}

checkSpecificTask().catch(console.error);