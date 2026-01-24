import { ProductManager } from "@isomorphiq/tasks";
import { WORKFLOW, advanceToken, createToken, runFlow } from "@isomorphiq/workflow";

/**
 * Workflows service: runs workflow deciders and agent Effects isolated from the HTTP gateway.
 */
export async function startWorkflowsService(): Promise<void> {
    const pm = new ProductManager();
    await pm.initialize();

    console.log("[WORKFLOWS] Starting workflow engine");

    // Simple runner placeholder: advance a token through a basic transition loop.
    // Replace with real deciders/agents as we flesh out the workflow service.
    const token = createToken("new-feature-proposed");
    await runFlow({ currentState: token.state, transition: "prioritize" }, WORKFLOW);
    const next = await advanceToken(token, "prioritize", WORKFLOW);
    console.log("[WORKFLOWS] Advanced token to", next.state);
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
    startWorkflowsService().catch((err) => {
        console.error("[WORKFLOWS] Failed to start:", err);
        process.exit(1);
    });
}
