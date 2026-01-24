import { createDaemonConnection } from "@isomorphiq/cli";

// Function to send command to daemon
function sendCommand(command, data = {}) {
    return new Promise((resolve, reject) => {
        const client = createDaemonConnection({ port: 3001, host: 'localhost' }, () => {
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

async function findAndClaimHighestPriorityTodoTask() {
    try {
        console.log('🔍 Getting all tasks...');
        
        // Get all tasks
        const listResponse = await sendCommand('list_tasks');
        
        if (!listResponse.success) {
            throw new Error(`Failed to list tasks: ${listResponse.error?.message}`);
        }
        
        const allTasks = listResponse.data;
        console.log(`Found ${allTasks.length} total tasks`);
        
        // Filter for high-priority todo tasks
        const highPriorityTodoTasks = allTasks.filter(task => 
            task.priority === 'high' && task.status === 'todo'
        );
        
        console.log(`Found ${highPriorityTodoTasks.length} high-priority todo tasks`);
        
        if (highPriorityTodoTasks.length === 0) {
            console.log('No high-priority todo tasks available');
            // Let's also check for medium priority
            const mediumPriorityTodoTasks = allTasks.filter(task => 
                task.priority === 'medium' && task.status === 'todo'
            );
            console.log(`Found ${mediumPriorityTodoTasks.length} medium-priority todo tasks`);
            
            if (mediumPriorityTodoTasks.length > 0) {
                mediumPriorityTodoTasks.sort((a, b) => 
                    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
                );
                const taskToClaim = mediumPriorityTodoTasks[0];
                console.log('\n🎯 CLAIMING MEDIUM-PRIORITY TODO TASK (no high-priority available):');
                await claimTask(taskToClaim);
                return taskToClaim;
            }
            return;
        }
        
        // Sort by creation date (oldest first)
        highPriorityTodoTasks.sort((a, b) => 
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
        
        const taskToClaim = highPriorityTodoTasks[0];
        
        console.log('\n🎯 CLAIMING HIGHEST PRIORITY TODO TASK:');
        await claimTask(taskToClaim);
        return taskToClaim;
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        throw error;
    }
}

async function claimTask(task) {
    console.log('ID:', task.id);
    console.log('Title:', task.title);
    console.log('Description:', task.description);
    console.log('Priority:', task.priority);
    console.log('Status:', task.status);
    console.log('Created:', task.createdAt);
    
    // Update task status to in-progress to claim it
    console.log('\n📝 Updating task status to in-progress...');
    
    const updateResponse = await sendCommand('update_task_status', {
        id: task.id,
        status: 'in-progress'
    });
    
    if (!updateResponse.success) {
        throw new Error(`Failed to claim task: ${updateResponse.error?.message}`);
    }
    
    const updatedTask = updateResponse.data;
    
    console.log('\n✅ Task claimed successfully!');
    console.log('New status:', updatedTask.status);
    console.log('Updated at:', updatedTask.updatedAt);
    
    console.log('\n📋 Task ready for implementation:');
    console.log('Title:', updatedTask.title);
    console.log('Description:', updatedTask.description);
    console.log('Priority:', updatedTask.priority);
    
    return updatedTask;
}

findAndClaimHighestPriorityTodoTask().catch(console.error);