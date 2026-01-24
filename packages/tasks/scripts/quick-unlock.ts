import { getUserManager } from "./src/user-manager.ts";

async function unlockAllAccounts() {
    const userManager = getUserManager();
    
    try {
        console.log("Getting all users...");
        const users = await userManager.getAllUsers();
        
        let unlockedCount = 0;
        let activeCount = 0;
        
        for (const user of users) {
            if (user.lockedUntil || user.failedLoginAttempts > 0) {
                console.log(`Unlocking user: ${user.username} (failed attempts: ${user.failedLoginAttempts}, locked until: ${user.lockedUntil})`);
                
                // Reset failed login attempts and remove lock
                const updatedUser = {
                    ...user,
                    failedLoginAttempts: 0,
                    updatedAt: new Date()
                };
                
                // Remove lockedUntil property
                delete updatedUser.lockedUntil;
                
                try {
                    await userManager.updateUser(updatedUser);
                    unlockedCount++;
                    console.log(`✅ Successfully unlocked ${user.username}`);
                } catch (error) {
                    console.log(`❌ Failed to unlock ${user.username}: ${error instanceof Error ? error.message : String(error)}`);
                }
            } else {
                activeCount++;
            }
        }
        
        console.log(`\nSummary:`);
        console.log(`- Total users: ${users.length}`);
        console.log(`- Users unlocked: ${unlockedCount}`);
        console.log(`- Users already active: ${activeCount}`);
        
    } catch (error) {
        console.error("Error unlocking accounts:", error);
    }
}

unlockAllAccounts().catch(console.error);