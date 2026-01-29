import { createConnection } from "node:net";

async function simpleTest() {
    console.log("[TEST] Starting simple TCP test...");
    
    return new Promise((resolve, reject) => {
        const client = createConnection({ port: 3001, host: "localhost" }, () => {
            console.log("[TEST] Connected to daemon");
            const testCommand = JSON.stringify({ 
                command: "get_task", 
                data: { id: "task-bfae6f99-74e8-4eba-80d4-2f275126b06c" }
            }) + "\n";
            
            console.log("[TEST] Sending command:", testCommand);
            client.write(testCommand);
        });

        let response = "";
        client.on("data", (data) => {
            response += data.toString();
            console.log("[TEST] Received data:", data.toString());
            
            try {
                const result = JSON.parse(response.trim());
                console.log("[TEST] Parsed result:", result);
                client.end();
                resolve(result);
            } catch (_e) {
                console.log("[TEST] Waiting for more data...");
            }
        });

        client.on("error", (err) => {
            console.error("[TEST] Connection error:", err);
            reject(err);
        });

        client.on("close", () => {
            console.log("[TEST] Connection closed");
            if (!response) {
                reject(new Error("Connection closed without response"));
            }
        });

        setTimeout(() => {
            client.destroy();
            reject(new Error("Request timeout"));
        }, 5000);
    });
}

simpleTest()
    .then(result => {
        console.log("[TEST] Success:", result.success ? "YES" : "NO");
        if (result.success) {
            console.log("[TEST] Task title:", result.data?.title);
        }
    })
    .catch(error => {
        console.error("[TEST] Failed:", error.message);
    });