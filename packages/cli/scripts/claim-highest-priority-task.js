import { ProductManager } from "@isomorphiq/profiles";

async function claimHighestPriorityTodoTask() {
    const productManager = new ProductManager();
    
    try {
        await productManager.initialize();
        
        // Get all tasks
        const allTasks = await productManager.getAllTasks();
        
        // Filter for high-priority todo tasks
        const highPriorityTodoTasks = allTasks.filter(task => 
            task.priority === 'high' && task.status === 'todo'
        );
        
        if (highPriorityTodoTasks.length === 0) {
            console.log('No high-priority todo tasks found');
            return;
        }
        
        // Sort by creation date (oldest first)
        highPriorityTodoTasks.sort((a, b) => 
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
        
        const taskToClaim = highPriorityTodoTasks[0];
        
        console.log('🎯 CLAIMING HIGHEST PRIORITY TODO TASK:');
        console.log('ID:', taskToClaim.id);
        console.log('Title:', taskToClaim.title);
        console.log('Description:', taskToClaim.description);
        console.log('Priority:', taskToClaim.priority);
        console.log('Status:', taskToClaim.status);
        console.log('Created:', taskToClaim.createdAt);
        
        // Update task status to in-progress to claim it
        const updatedTask = await productManager.updateTaskStatus(taskToClaim.id, 'in-progress');
        
        console.log('\n✅ Task claimed successfully!');
        console.log('New status:', updatedTask.status);
        console.log('Updated at:', updatedTask.updatedAt);
        
        // Return the task details for implementation
        return updatedTask;
        
    } catch (error) {
        console.error('Error claiming task:', error);
        throw error;
    } finally {
        await productManager.cleanup();
    }
}

claimHighestPriorityTodoTask().catch(console.error);