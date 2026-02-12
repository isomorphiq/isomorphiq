#!/usr/bin/env node

import { UserManager } from "./src/user-manager.js";

async function unlockAllAccounts() {
  const userManager = new UserManager();
  
  try {
    console.log("Getting all users...");
    const users = await userManager.getAllUsers();
    
    let unlockedCount = 0;
    let lockedCount = 0;
    
    for (const user of users) {
      if (user.lockedUntil || user.failedLoginAttempts > 0) {
        console.log(`Unlocking user: ${user.username} (failed attempts: ${user.failedLoginAttempts}, locked until: ${user.lockedUntil})`);
        
        // Reset failed login attempts and remove lock
        const updatedUser = {
          ...user,
          failedLoginAttempts: 0,
          lastLoginAt: user.lastLoginAt,
          updatedAt: new Date()
        };
        
        // Remove lockedUntil property
        delete updatedUser.lockedUntil;
        
        const updateResult = await userManager.updateUser(updatedUser);
        if (updateResult.success) {
          unlockedCount++;
          console.log(`✅ Successfully unlocked ${user.username}`);
        } else {
          console.log(`❌ Failed to unlock ${user.username}: ${updateResult.error?.message}`);
        }
      } else {
        lockedCount++;
      }
    }
    
    console.log(`\nSummary:`);
    console.log(`- Total users: ${users.length}`);
    console.log(`- Users unlocked: ${unlockedCount}`);
    console.log(`- Users already active: ${lockedCount}`);
    
  } catch (error) {
    console.error("Error unlocking accounts:", error);
  } finally {
    await userManager.close();
  }
}

unlockAllAccounts().catch(console.error);