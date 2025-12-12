import { createTaskManagerClient } from "./src/task-manager-client.ts";

async function claimHighestPriorityTask() {
  try {
    console.log("[HANDOFF] Claiming highest priority task for development...");
    
    const client = createTaskManagerClient();
    const result = await client.claimHighestPriorityTask("development");
    
    if (result) {
      console.log("[HANDOFF] ✅ Successfully claimed task:");
      console.log(`   ID: ${result.id}`);
      console.log(`   Title: ${result.title}`);
      console.log(`   Priority: ${result.priority}`);
      console.log(`   Status: ${result.status}`);
      console.log(`   Assigned to: ${result.assignedTo}`);
      console.log("\n[HANDOFF] 🚀 Task handed to development for implementation!");
      process.exit(0);
    } else {
      console.log("[HANDOFF] No tasks available to claim");
      process.exit(1);
    }
  } catch (error) {
    console.error("[HANDOFF] Error claiming task:", error);
    process.exit(1);
  }
}

claimHighestPriorityTask();