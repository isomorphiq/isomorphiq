import * as acp from "@agentclientprotocol/sdk";
import type { ClientSideConnection } from "@agentclientprotocol/sdk";
import { TaskClient } from "./acp-client.ts";
import { type ProcessResult, ProcessSpawner } from "./process-spawner.ts";

export interface ACPConnectionResult {
	connection: ClientSideConnection;
	sessionId: string;
	processResult: ProcessResult<WritableStream<Uint8Array>, ReadableStream<Uint8Array>>;
	taskClient: TaskClient;
}

export async function createConnection(): Promise<ACPConnectionResult> {
	console.log("[ACP] 🔗 Creating ACP connection...");

	try {
		// Spawn opencode process
		console.log("[ACP] 🚀 Spawning opencode process...");
		const processResult = ProcessSpawner.spawnOpencode();

		// Give process a moment to start
		await new Promise((resolve) => setTimeout(resolve, 1000));

		// Set up ACP communication streams
		console.log("[ACP] 📡 Setting up communication streams...");
		console.log("[ACP] 📚 ACP SDK loaded");
		const stream = acp.ndJsonStream(processResult.input, processResult.outputStream);
		console.log("[ACP] 🌊 NDJSON stream created");

		// Create task client and connection
		console.log("[ACP] 👤 Creating task client...");
		const taskClient = new TaskClient();
		console.log("[ACP] 🔌 Creating client-side connection...");
		const connection = new acp.ClientSideConnection(
			() => taskClient as unknown as acp.Client,
			stream,
		);
		console.log("[ACP] ✅ Client-side connection created");

		// Initialize connection
		console.log("[ACP] 🤝 Initializing ACP connection...");
		console.log("[ACP] 📋 Protocol version:", acp.PROTOCOL_VERSION);
		const initResult = await connection.initialize({
			protocolVersion: acp.PROTOCOL_VERSION,
			clientCapabilities: {
				fs: {
					readTextFile: true,
					writeTextFile: true,
				},
			},
		});
		console.log(`[ACP] ✅ Connected to opencode (protocol v${initResult.protocolVersion})`);
		console.log("[ACP] 📊 Init result:", JSON.stringify(initResult, null, 2));

		// Create session
		console.log("[ACP] 🆔 Creating new session...");
		console.log("[ACP] 📁 Working directory:", process.cwd());
		const sessionResult = await connection.newSession({
			cwd: process.cwd(),
			mcpServers: [],
		});
		console.log("[ACP] ✅ Session created:", sessionResult.sessionId);
		console.log("[ACP] 📊 Session result:", JSON.stringify(sessionResult, null, 2));

		return {
			connection,
			sessionId: sessionResult.sessionId,
			processResult,
			taskClient,
		};
	} catch (error) {
		console.error("[ACP] ❌ Connection creation failed:", error);
		console.error("[ACP] 📋 Error details:", JSON.stringify(error, null, 2));
		throw error;
	}
}

export async function cleanupConnection(
	connection: ClientSideConnection,
	processResult: ProcessResult,
): Promise<void> {
	try {
		console.log("[ACP] 🧹 Cleaning up connection...");

		// Proactively close the connection so `closed` will resolve
		const conn = connection as { close?: () => Promise<void> };
		if (typeof conn.close === "function") {
			try {
				await conn.close();
			} catch (closeError) {
				console.log("[ACP] ⚠️ Error issuing close():", closeError);
			}
		}

		// Wait for closure but don't hang indefinitely
		const closed = await Promise.race([
			connection.closed,
			new Promise((_resolve, reject) =>
				setTimeout(() => reject(new Error("close timeout after 3s")), 3000),
			),
		]);
		console.log("[ACP] ✅ Connection closed", closed ? "" : "");
	} catch (error) {
		console.log("[ACP] ❌ Error closing connection:", error);
	}

	ProcessSpawner.cleanupProcess(processResult);
}

export async function sendPrompt(
	connection: ClientSideConnection,
	sessionId: string,
	prompt: string,
	taskClient?: TaskClient,
): Promise<Record<string, unknown>> {
	console.log("[ACP] 📤 Sending prompt turn request...");
	console.log(
		`[ACP] 📝 Prompt content (${prompt.length} chars):`,
		prompt.substring(0, 200) + (prompt.length > 200 ? "..." : ""),
	);
	console.log("[ACP] 🆔 Session ID:", sessionId);
	const result = await connection.prompt({
		sessionId,
		prompt: [
			{
				type: "text",
				text: prompt,
			},
		],
	});
	console.log("[ACP] ✅ Prompt completed with stop reason:", result.stopReason);
	console.log("[ACP] 📊 Prompt result:", JSON.stringify(result, null, 2));
	// Mark turn complete on the task client if available
	const client = taskClient as {
		markTurnComplete?: () => void;
		stopReason?: string;
	};
	if (client && typeof client.markTurnComplete === "function") {
		try {
			client.stopReason = result.stopReason ?? client.stopReason;
			client.markTurnComplete();
		} catch (err) {
			console.log("[ACP] ⚠️ Failed to mark turn complete on task client:", err);
		}
	}
	return result;
}

export async function waitForTaskCompletion(
	taskClient: TaskClient,
	timeoutMs: number = 30000,
	profileName: string,
): Promise<{ output: string; error: string }> {
	console.log(`[ACP][${profileName}] ⏳ Waiting for task completion (timeout: ${timeoutMs}ms)...`);
	const startTime = Date.now();
	let lastOutputLength = 0;

	while (!taskClient.getResponse().error && Date.now() - startTime < timeoutMs) {
		const currentResponse = taskClient.getResponse();

		// Check if turn is complete - this is the key fix!
		if (taskClient.isTurnComplete()) {
			const reason = taskClient.stopReason || "unknown";
			console.log(
				`[ACP][${profileName}] 🔄 Turn completed detected - finishing task (reason: ${reason})`,
			);
			break;
		}

		// Log progress if we're getting output
		if (currentResponse.output && currentResponse.output.length > lastOutputLength) {
			console.log(
				`[ACP][${profileName}] 📈 Progress: ${currentResponse.output.length} characters received`,
			);
			lastOutputLength = currentResponse.output.length;
		}

		// Log status every 5 seconds
		const elapsed = Date.now() - startTime;
		if (elapsed % 5000 < 100) {
			console.log(
				`[ACP][${profileName}] ⏱️ Elapsed: ${elapsed}ms, Turn complete: ${taskClient.isTurnComplete()}, Output length: ${currentResponse.output.length}`,
			);
		}

		await new Promise((resolve) => setTimeout(resolve, 100));
	}

	const response = taskClient.getResponse();

	if (response.output) {
		console.log(
			`[ACP][${profileName}] ✅ Task completed successfully via ACP (${response.output.length} chars)`,
		);
		console.log(
			`[ACP][${profileName}] 📄 Final output preview:`,
			response.output.substring(0, 300) + (response.output.length > 300 ? "..." : ""),
		);
		return { output: response.output, error: "" };
	} else if (response.error) {
		console.error(`[ACP][${profileName}] ❌ Task failed via ACP:`, response.error);
		return { output: "", error: response.error };
	} else if (taskClient.stopReason) {
		console.log(
			`[ACP][${profileName}] ✅ Turn completed with stop reason: ${taskClient.stopReason}`,
		);
		return { output: response.output || "", error: "" };
	} else {
		const errorMsg = `Task timed out after ${timeoutMs}ms`;
		console.log(`[ACP][${profileName}] ⏰ Task timed out after ${timeoutMs}ms`);
		return { output: "", error: errorMsg };
	}
}

export const ACPConnectionManager = {
	createConnection,
	cleanupConnection,
	sendPrompt,
	waitForTaskCompletion,
};
