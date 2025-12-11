#!/usr/bin/env node

import { getUserManager } from "./src/user-manager.ts";

async function checkUserStatus() {
    const userManager = getUserManager();
    
    try {
        console.log("Getting all users...");
        const users = await userManager.getAllUsers();
        
        console.log(`Found ${users.length} users:`);
        for (const user of users) {
            console.log(`- ${user.username}: active=${user.isActive}, lockedUntil=${user.lockedUntil}, failedAttempts=${user.failedLoginAttempts}`);
        }
        
        // Check sessions
        console.log("\nChecking sessions...");
        const sessions = [];
        const sessionIterator = userManager.sessionDb.iterator();
        
        for await (const [key, value] of sessionIterator) {
            sessions.push({ key, ...value });
        }
        await sessionIterator.close();
        
        console.log(`Found ${sessions.length} sessions:`);
        for (const session of sessions) {
            console.log(`- Session ${session.id}: userId=${session.userId}, active=${session.isActive}, expiresAt=${session.expiresAt}`);
        }
        
    } catch (error) {
        console.error("Error:", error);
    }
}

checkUserStatus().catch(console.error);