import { getUserManager } from "./src/user-manager.ts";

async function emergencyUnlock() {
    console.log("🚨 EMERGENCY ACCOUNT UNLOCK - bypassing authentication");
    
    const userManager = getUserManager();
    
    try {
        // Force database open by creating a new instance to avoid lock contention
        console.log("Accessing user database directly...");
        const users = await userManager.getAllUsers();
        
        console.log(`Found ${users.length} users in database`);
        
        let unlockedCount = 0;
        let lockedUsers = [];
        
        for (const user of users) {
            if (user.lockedUntil || user.failedLoginAttempts > 0) {
                lockedUsers.push({
                    username: user.username,
                    failedAttempts: user.failedLoginAttempts,
                    lockedUntil: user.lockedUntil
                });
                
                console.log(`🔒 Locked user found: ${user.username}`);
                console.log(`   Failed attempts: ${user.failedLoginAttempts}`);
                console.log(`   Locked until: ${user.lockedUntil || 'Not set'}`);
                
                // Create updated user with lock removed
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
                    console.error(`❌ Failed to unlock ${user.username}:`, error instanceof Error ? error.message : String(error));
                }
            }
        }
        
        console.log("\n" + "=".repeat(50));
        console.log("EMERGENCY UNLOCK SUMMARY");
        console.log("=".repeat(50));
        console.log(`Total users: ${users.length}`);
        console.log(`Users unlocked: ${unlockedCount}`);
        console.log(`Users already active: ${users.length - unlockedCount}`);
        
        if (lockedUsers.length > 0) {
            console.log("\nLocked users that were processed:");
            lockedUsers.forEach(user => {
                console.log(`  - ${user.username} (${user.failedAttempts} failed attempts)`);
            });
        }
        
        if (unlockedCount > 0) {
            console.log("\n🎉 SUCCESS: All locked accounts have been unlocked!");
            console.log("Users should now be able to log in with their valid credentials.");
        } else {
            console.log("\n✅ No locked accounts found - all users are already active.");
        }
        
        return unlockedCount;
        
    } catch (error) {
        console.error("💥 CRITICAL ERROR during emergency unlock:", error);
        throw error;
    }
}

// Run the emergency unlock
emergencyUnlock()
    .then((count) => {
        console.log(`\n🔓 Emergency unlock completed. ${count} accounts were unlocked.`);
        process.exit(count > 0 ? 0 : 1);
    })
    .catch((error) => {
        console.error("\n💥 Emergency unlock failed:", error);
        process.exit(2);
    });