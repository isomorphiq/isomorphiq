#!/usr/bin/env node

// Kill existing daemon and restart
const { spawn } = require('child_process');
const fs = require('fs');

async function killAndRestartDaemon() {
    try {
        console.log("🔄 Restarting daemon...");
        
        // Find and kill existing daemon process
        const { exec } = require('child_process');
        exec('pkill -f "src/daemon.ts"', (error, stdout, stderr) => {
            if (error) {
                console.log("No daemon process found to kill");
            } else {
                console.log("Killed existing daemon process");
            }
            
            // Wait a moment
            setTimeout(() => {
                console.log("🚀 Starting new daemon instance...");
                const daemon = spawn('npm', ['run', 'daemon'], {
                    stdio: ['ignore', 'pipe', 'pipe'],
                    detached: true
                });
                
                daemon.stdout.on('data', (data) => {
                    console.log(`📋 Daemon: ${data.toString().trim()}`);
                });
                
                daemon.stderr.on('data', (data) => {
                    console.error(`❌ Daemon error: ${data.toString().trim()}`);
                });
                
                daemon.on('close', (code) => {
                    console.log(`Daemon process exited with code ${code}`);
                });
                
                // Detach from parent process
                daemon.unref();
                
                console.log("✅ Daemon restart initiated");
                
                // Wait for daemon to initialize
                setTimeout(() => {
                    console.log("🎯 Daemon should be ready now");
                    process.exit(0);
                }, 3000);
                
            }, 2000);
        });
        
    } catch (error) {
        console.error("💥 Error restarting daemon:", error.message);
        process.exit(1);
    }
}

killAndRestartDaemon();