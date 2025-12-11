#!/usr/bin/env node

// This script uses the daemon's task manager to unlock accounts
import { createTask } from "./src/index.ts";

async function createUnlockTask() {
    try {
        const task = await createTask(
            "Emergency: Unlock all locked user accounts",
            "Critical issue: Users cannot log in due to account locks. Unlock all user accounts immediately by resetting failedLoginAttempts to 0 and removing lockedUntil property.",
            "high"
        );
        
        console.log("Created emergency unlock task:", task.id);
        console.log("Task will be processed by daemon to unlock accounts.");
        
    } catch (error) {
        console.error("Failed to create unlock task:", error);
    }
}

createUnlockTask();