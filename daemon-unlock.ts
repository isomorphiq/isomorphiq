import { createConnection } from "node:net";

interface DaemonMessage {
    command: string;
    data: any;
}

interface DaemonResponse {
    success: boolean;
    data?: any;
    error?: string;
    unlockedCount?: number;
    totalUsers?: number;
    message?: string;
}

async function sendDaemonCommand(command: string, data: any = {}): Promise<DaemonResponse> {
    return new Promise((resolve, reject) => {
        const client = createConnection(3001, "localhost");
        
        client.on("connect", () => {
            console.log(`[TCP] Connected to daemon, sending command: ${command}`);
            
            const message: DaemonMessage = { command, data };
            const messageStr = JSON.stringify(message) + "\n";
            
            client.write(messageStr);
        });
        
        client.on("data", (data) => {
            try {
                const response = JSON.parse(data.toString().trim());
                console.log(`[TCP] Received response:`, response);
                resolve(response);
            } catch (error) {
                console.error(`[TCP] Failed to parse response:`, error);
                reject(error);
            } finally {
                client.end();
            }
        });
        
        client.on("error", (error) => {
            console.error(`[TCP] Connection error:`, error);
            reject(error);
        });
        
        client.on("timeout", () => {
            console.error(`[TCP] Connection timeout`);
            client.end();
            reject(new Error("Connection timeout"));
        });
        
        client.setTimeout(10000); // 10 second timeout
    });
}

async function unlockAllAccountsViaDaemon() {
    console.log("🔓 Attempting to unlock all accounts via daemon TCP API...");
    
    try {
        const response = await sendDaemonCommand("unlock_accounts");
        
        if (response.success) {
            console.log("✅ SUCCESS: Daemon unlocked accounts successfully!");
            console.log(`📊 Results:`, response);
            
            const unlockedCount = response.unlockedCount || 0;
            
            if (unlockedCount > 0) {
                console.log(`🎉 ${unlockedCount} user accounts were unlocked!`);
                console.log("Users should now be able to log in with their valid credentials.");
            } else {
                console.log("ℹ️  No locked accounts found - all users are already active.");
            }
            
            return unlockedCount;
        } else {
            console.error("❌ FAILED: Daemon failed to unlock accounts");
            console.error("Error:", response.error);
            throw new Error(response.error || "Unknown daemon error");
        }
        
    } catch (error) {
        console.error("💥 CRITICAL ERROR: Failed to communicate with daemon:", error);
        throw error;
    }
}

// Run the unlock operation
unlockAllAccountsViaDaemon()
    .then((count) => {
        console.log(`\n🔓 Account unlock completed via daemon. ${count} accounts were unlocked.`);
        process.exit(count > 0 ? 0 : 1);
    })
    .catch((error) => {
        console.error("\n💥 Account unlock failed:", error);
        process.exit(2);
    });