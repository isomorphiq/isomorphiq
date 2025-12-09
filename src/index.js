import { Level } from 'level';
import { exec } from 'child_process';
import path from 'path';
// Initialize LevelDB
const dbPath = path.join(process.cwd(), 'db');
const db = new Level(dbPath, { valueEncoding: 'json' });
// Product Manager class to handle task operations
class ProductManager {
    constructor() { }
    // Create a new task
    async createTask(title, description) {
        const id = `task-${Date.now()}`;
        const task = {
            id,
            title,
            description,
            status: 'todo',
            createdAt: new Date(),
            updatedAt: new Date()
        };
        await db.put(id, task);
        return task;
    }
    // Get all tasks
    async getAllTasks() {
        const tasks = [];
        for await (const [key, value] of db.iterator()) {
            tasks.push(value);
        }
        return tasks;
    }
    // Update task status
    async updateTaskStatus(id, status) {
        const task = await db.get(id);
        task.status = status;
        task.updatedAt = new Date();
        await db.put(id, task);
        return task;
    }
    // Run opencode command with a prompt
    async runOpencode(prompt) {
        return new Promise((resolve, reject) => {
            exec(`opencode ${prompt}`, (error, stdout, stderr) => {
                if (error) {
                    reject(new Error(`Error running opencode: ${error.message}`));
                }
                else {
                    resolve(stdout);
                }
            });
        });
    }
    // Process tasks by running opencode commands
    async processTasks() {
        const tasks = await this.getAllTasks();
        console.log('Processing tasks with opencode...');
        for (const task of tasks) {
            if (task.status === 'todo') {
                console.log(`Starting task: ${task.title}`);
                await this.updateTaskStatus(task.id, 'in-progress');
                // Run opencode command based on task
                try {
                    const result = await this.runOpencode(task.description);
                    console.log(`Opencode result for "${task.title}":`, result);
                    // Mark as done after successful execution
                    await this.updateTaskStatus(task.id, 'done');
                    console.log(`Completed task: ${task.title}`);
                }
                catch (error) {
                    console.error(`Failed to process task "${task.title}":`, error);
                }
            }
        }
    }
}
// Main function
async function main() {
    const pm = new ProductManager();
    // Create some sample tasks
    const tasks = [
        { title: "Implement user authentication", description: "Create login and signup functionality" },
        { title: "Add task tracking feature", description: "Implement CRUD operations for tasks" },
        { title: "Setup CI/CD pipeline", description: "Configure automated testing and deployment" }
    ];
    console.log('Creating sample tasks...');
    for (const task of tasks) {
        await pm.createTask(task.title, task.description);
    }
    // Process all tasks
    await pm.processTasks();
    console.log('All tasks processed!');
}
// Run the application
main().catch(console.error);
