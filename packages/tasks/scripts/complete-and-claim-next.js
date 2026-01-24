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

async function completeTaskAndFindNext() {
    const taskId = "task-1765349040119";
    
    try {
        console.log(`📝 Marking task ${taskId} as completed...`);
        
        // Mark current task as completed since it's already implemented
        const updateResponse = await sendCommand('update_task_status', {
            id: taskId,
            status: 'done'
        });
        
        if (updateResponse.success) {
            console.log('✅ Task marked as completed successfully!');
            console.log('Status:', updateResponse.data.status);
        } else {
            console.log('❌ Failed to update task:', updateResponse.error?.message);
        }
        
        // Now find the next highest priority task
        console.log('\n🔍 Finding next highest priority task...');
        
        const listResponse = await sendCommand('list_tasks');
        
        if (!listResponse.success) {
            throw new Error(`Failed to list tasks: ${listResponse.error?.message}`);
        }
        
        const allTasks = listResponse.data;
        
        // Filter for todo tasks (excluding completed and in-progress)
        const todoTasks = allTasks.filter(task => task.status === 'todo');
        
        console.log(`Found ${todoTasks.length} todo tasks`);
        
        if (todoTasks.length === 0) {
            console.log('🎉 No more tasks to implement!');
            return;
        }
        
        // Prioritize: high > medium > low, then by creation date
        todoTasks.sort((a, b) => {
            const priorityOrder = { high: 3, medium: 2, low: 1, invalid: 0 };
            const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
            
            if (priorityDiff !== 0) {
                return -priorityDiff; // Higher priority first
            }
            
            // Same priority, sort by creation date (oldest first)
            return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        });
        
        const nextTask = todoTasks[0];
        
        console.log('\n🎯 NEXT HIGHEST PRIORITY TASK:');
        console.log('ID:', nextTask.id);
        console.log('Title:', nextTask.title);
        console.log('Description:', nextTask.description);
        console.log('Priority:', nextTask.priority);
        console.log('Status:', nextTask.status);
        console.log('Created:', nextTask.createdAt);
        
        console.log('\n📝 Claiming next task...');
        
        const claimResponse = await sendCommand('update_task_status', {
            id: nextTask.id,
            status: 'in-progress'
        });
        
        if (claimResponse.success) {
            console.log('\n✅ Next task claimed successfully!');
            console.log('New status:', claimResponse.data.status);
            
            console.log('\n📋 Task ready for implementation:');
            console.log('Title:', claimResponse.data.title);
            console.log('Description:', claimResponse.data.description);
            console.log('Priority:', claimResponse.data.priority);
            
            return claimResponse.data;
        } else {
            console.log('\n❌ Failed to claim next task:', claimResponse.error?.message);
        }
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        throw error;
    }
}

completeTaskAndFindNext().catch(console.error);