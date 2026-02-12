import { createDaemonConnection } from "@isomorphiq/cli";

function sendCommand(command, data = {}) {
	return new Promise((resolve, reject) => {
		const client = createDaemonConnection({ host: "localhost", port: 3001 }, () => {
			const message = `${JSON.stringify({ command, data })}\n`;
			client.write(message);
		});

		let response = "";
		client.on("data", (chunk) => {
			response += chunk.toString();
			if (response.endsWith("\n")) {
				client.end();
				try {
					const result = JSON.parse(response.trim());
					resolve(result);
				} catch (_err) {
					reject(new Error("Invalid response from server"));
				}
			}
		});

		client.on("error", (err) => {
			reject(err);
		});
	});
}

async function findAndClaimHighestPriorityTask() {
	try {
		console.log("[HANDOFF] Finding highest priority task for development...");
		
		const tasksResult = await sendCommand("list_tasks");
		if (!tasksResult.success) {
			throw new Error("Failed to list tasks");
		}
		
		const tasks = tasksResult.data;
		
		// Find highest priority todo tasks (not already in-progress or done)
		const todoTasks = tasks.filter(task => 
			task.status === "todo" && 
			task.priority === "high"
		);
		
		if (todoTasks.length === 0) {
			console.log("[HANDOFF] No high priority todo tasks found");
			
			// Try medium priority if no high priority todo tasks
			const mediumTodoTasks = tasks.filter(task => 
				task.status === "todo" && 
				task.priority === "medium"
			);
			
			if (mediumTodoTasks.length > 0) {
				const targetTask = mediumTodoTasks[0];
				console.log(`[HANDOFF] Claiming medium priority task: ${targetTask.title}`);
				
				const updateResult = await sendCommand("update_task_status", {
					id: targetTask.id,
					status: "in-progress"
				});
				
				if (updateResult.success) {
					console.log("[HANDOFF] ✅ Task claimed and assigned to development:");
					console.log(`   ID: ${targetTask.id}`);
					console.log(`   Title: ${targetTask.title}`);
					console.log(`   Priority: ${targetTask.priority}`);
					console.log(`   Status: in-progress`);
					console.log(`   Description: ${targetTask.description}`);
					console.log("\n[HANDOFF] 🚀 Task handed to development for implementation!");
					process.exit(0);
				}
			}
			
			console.log("[HANDOFF] No available tasks to claim");
			process.exit(1);
		}
		
		// Claim the first high priority todo task
		const targetTask = todoTasks[0];
		console.log(`[HANDOFF] Claiming high priority task: ${targetTask.title}`);
		
		const updateResult = await sendCommand("update_task_status", {
			id: targetTask.id,
			status: "in-progress"
		});
		
		if (updateResult.success) {
			console.log("[HANDOFF] ✅ Task claimed and assigned to development:");
			console.log(`   ID: ${targetTask.id}`);
			console.log(`   Title: ${targetTask.title}`);
			console.log(`   Priority: ${targetTask.priority}`);
			console.log(`   Status: in-progress`);
			console.log(`   Description: ${targetTask.description}`);
			console.log("\n[HANDOFF] 🚀 Task handed to development for implementation!");
			process.exit(0);
		} else {
			throw new Error("Failed to update task status");
		}
		
	} catch (error) {
		console.error("[HANDOFF] Error:", error);
		process.exit(1);
	}
}

findAndClaimHighestPriorityTask();