import { createDaemonConnection } from "@isomorphiq/cli";

// Function to send command to daemon via TCP
function sendCommand(command, data = {}) {
    return new Promise((resolve, reject) => {
        const client = createDaemonConnection({ port: 3001 }, () => {
            const message = JSON.stringify({ command, data });
            console.log('[CLIENT] Sending:', message);
            client.write(message);
        });

        let responseData = "";
        
        client.on("data", (data) => {
            responseData += data.toString();
        });

        client.on("end", () => {
            try {
                const response = JSON.parse(responseData.trim());
                resolve(response);
            } catch (error) {
                reject(new Error(`Failed to parse response: ${responseData}`));
            }
        });

        client.on("error", (error) => {
            reject(error);
        });

        // Set timeout
        setTimeout(() => {
            client.destroy();
            reject(new Error("Command timeout"));
        }, 10000);
    });
}

// Main function to claim highest priority todo task
async function claimHighestPriorityTodoTask() {
    try {
        console.log('🔍 Looking for high-priority todo tasks...');
        
        // Get all tasks
        const listResponse = await sendCommand("list_tasks");
        
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
            console.log('No high-priority todo tasks available for claiming');
            return;
        }
        
        // Sort by creation date (oldest first)
        highPriorityTodoTasks.sort((a, b) => 
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
        
        const taskToClaim = highPriorityTodoTasks[0];
        
        console.log('\n🎯 CLAIMING HIGHEST PRIORITY TODO TASK:');
        console.log('ID:', taskToClaim.id);
        console.log('Title:', taskToClaim.title);
        console.log('Description:', taskToClaim.description);
        console.log('Priority:', taskToClaim.priority);
        console.log('Status:', taskToClaim.status);
        console.log('Created:', taskToClaim.createdAt);
        
        // Update task status to in-progress to claim it
        console.log('\n📝 Updating task status to in-progress...');
        const updateResponse = await sendCommand("update_task_status", {
            id: taskToClaim.id,
            status: 'in-progress'
        });
        
        if (!updateResponse.success) {
            throw new Error(`Failed to claim task: ${updateResponse.error?.message}`);
        }
        
        const updatedTask = updateResponse.data;
        
        console.log('\n✅ Task claimed successfully!');
        console.log('New status:', updatedTask.status);
        console.log('Updated at:', updatedTask.updatedAt);
        
        // Return the task details for implementation
        console.log('\n📋 Task details for implementation:');
        return updatedTask;
        
    } catch (error) {
        console.error('❌ Error claiming task:', error.message);
        throw error;
    }
}

claimHighestPriorityTodoTask().catch(console.error);