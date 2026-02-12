#!/usr/bin/env node

import { createConnection } from "node:net";

const message = JSON.stringify({
    command: "unlock_accounts",
    data: {}
});

const client = createConnection({ port: 3001 }, () => {
    console.log("Connected to daemon, sending unlock request...");
    client.write(message);
});

client.on("data", (data) => {
    const response = JSON.parse(data.toString());
    console.log("Daemon response:", response);
    client.end();
});

client.on("error", (err) => {
    console.error("Error connecting to daemon:", err);
});

client.on("end", () => {
    console.log("Disconnected from daemon");
});