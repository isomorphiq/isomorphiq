import { ProductManager } from "@isomorphiq/profiles";
import { ProfileManager } from "@isomorphiq/profiles";
import { createWorkflowAgentRunner } from "@isomorphiq/workflow/agent-runner";
import { ProfileWorkflowRunner } from "@isomorphiq/workflow";

/**
 * Workflows service: runs workflow deciders and agent Effects isolated from the HTTP gateway.
 */
export async function startWorkflowsService(): Promise<void> {
    const profileManager = new ProfileManager();
    await profileManager.waitForProfileOverrides();
    const workflowRunner = createWorkflowAgentRunner({ profileManager });
    const pm = new ProductManager();
    await pm.initialize();

    console.log("[WORKFLOWS] Starting workflow engine");
    const runner = new ProfileWorkflowRunner({
        taskProvider: () => pm.getAllTasks(),
        taskExecutor: workflowRunner.executeTask,
        updateTaskStatus: async (id, status, updatedBy) => {
            await pm.updateTaskStatus(id, status, updatedBy);
        },
    });
    await runner.runLoop();
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
    startWorkflowsService().catch((err) => {
        console.error("[WORKFLOWS] Failed to start:", err);
        process.exit(1);
    });
}
