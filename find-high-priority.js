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

async function findHighPriorityTasks() {
    try {
        console.log('🔍 Searching for high priority tasks...');
        
        const listResponse = await sendCommand('list_tasks');
        
        if (!listResponse.success) {
            throw new Error(`Failed to list tasks: ${listResponse.error?.message}`);
        }
        
        const allTasks = listResponse.data;
        
        // Look for tasks with "high" priority or containing "Task 3" or "urgent"
        const highPriorityTasks = allTasks.filter(task => {
            const title = task.title.toLowerCase();
            const description = task.description.toLowerCase();
            
            return (
                (task.priority === 'high' && task.status === 'todo') ||
                title.includes('task 3') ||
                title.includes('urgent') ||
                description.includes('urgent') ||
                description.includes('critical') ||
                title.includes('high priority')
            );
        });
        
        console.log(`Found ${highPriorityTasks.length} high-priority or urgent tasks`);
        
        if (highPriorityTasks.length === 0) {
            console.log('No high-priority tasks found. Looking for Task 3 specifically...');
            
            const task3Tasks = allTasks.filter(task => 
                task.title.includes('Task 3') && task.status === 'todo'
            );
            
            if (task3Tasks.length > 0) {
                console.log(`Found ${task3Tasks.length} Task 3 items that are todo`);
                task3Tasks.forEach((task, index) => {
                    console.log(`\n${index + 1}. Task 3:`);
                    console.log('   ID:', task.id);
                    console.log('   Title:', task.title);
                    console.log('   Description:', task.description);
                    console.log('   Priority:', task.priority);
                    console.log('   Status:', task.status);
                });
                
                // Try to claim the first Task 3
                const taskToClaim = task3Tasks[0];
                console.log('\n📝 Claiming Task 3...');
                
                const claimResponse = await sendCommand('update_task_status', {
                    id: taskToClaim.id,
                    status: 'in-progress'
                });
                
                if (claimResponse.success) {
                    console.log('\n✅ Task 3 claimed successfully!');
                    return claimResponse.data;
                }
            }
        } else {
            console.log('\n🎯 HIGH PRIORITY TASKS FOUND:');
            highPriorityTasks.forEach((task, index) => {
                console.log(`\n${index + 1}. ${task.title}:`);
                console.log('   ID:', task.id);
                console.log('   Description:', task.description);
                console.log('   Priority:', task.priority);
                console.log('   Status:', task.status);
            });
        }
        
        return null;
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        throw error;
    }
}

findHighPriorityTasks().catch(console.error);