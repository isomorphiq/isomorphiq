
// Account Lock Prevention Script
// This script can be run periodically to prevent account lock issues

import { sendDaemonCommand } from "./daemon-unlock.ts";

async function checkAndPreventLocks() {
    console.log("🔍 Checking for potential account lock issues...");
    
    try {
        // Get all users
        const usersResponse = await sendDaemonCommand("list_users");
        
        if (!usersResponse.success) {
            throw new Error("Failed to get users list");
        }
        
        const users = usersResponse.data || [];
        let atRiskUsers = 0;
        let unlockedPreemptively = 0;
        
        for (const user of users) {
            // Check if user has high failed attempts (close to lock threshold)
            if (user.failedLoginAttempts >= 3) { // Warning threshold
                atRiskUsers++;
                console.log(`⚠️  User ${user.username} has ${user.failedLoginAttempts} failed attempts`);
                
                // Optionally unlock users with high failed attempts
                if (user.failedLoginAttempts >= 4) {
                    console.log(`🔓 Preemptively unlocking ${user.username} to prevent lock`);
                    const unlockResponse = await sendDaemonCommand("update_user", {
                        id: user.id,
                        failedLoginAttempts: 0,
                        updatedAt: new Date()
                    });
                    
                    if (unlockResponse.success) {
                        unlockedPreemptively++;
                        delete unlockResponse.data.lockedUntil;
                        await sendDaemonCommand("update_user", unlockResponse.data);
                    }
                }
            }
        }
        
        console.log(`\n📊 Prevention Summary:`);
        console.log(`- Users at risk: ${atRiskUsers}`);
        console.log(`- Users preemptively unlocked: ${unlockedPreemptively}`);
        
        return { atRiskUsers, unlockedPreemptively };
        
    } catch (error) {
        console.error("💥 Error in preventive check:", error);
        throw error;
    }
}

// Export for use in other scripts
export { checkAndPreventLocks };
