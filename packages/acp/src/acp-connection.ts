import * as acp from "@agentclientprotocol/sdk";
import type { ClientSideConnection } from "@agentclientprotocol/sdk";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { TaskClient } from "./acp-client.ts";
import {
    ConfigManager,
    resolveEnvironmentValue,
    type AcpRuntime,
    type ProcessResult,
    ProcessSpawner,
} from "@isomorphiq/core";
import type { McpServerConfig } from "./types.ts";

export interface ACPConnectionResult {
	connection: ClientSideConnection;
	sessionId: string;
	processResult: ProcessResult<WritableStream<Uint8Array>, ReadableStream<Uint8Array>>;
	taskClient: TaskClient;
}

type ClientCapabilities = {
	fs?: {
		readTextFile?: boolean;
		writeTextFile?: boolean;
	};
};

const resolveAcpRuntime = (): AcpRuntime => {
    const raw = (process.env.ACP_RUNTIME ?? process.env.ACP_SERVER ?? "").trim().toLowerCase();
    return raw === "codex" ? "codex" : "opencode";
};

const resolveModelFromEnv = (): string | null => {
    const candidates = [
        process.env.ACP_MODEL,
        process.env.OPENAI_MODEL,
        process.env.MODEL,
        process.env.LLM_MODEL,
    ];
    const match = candidates.find((value) => typeof value === "string" && value.trim().length > 0);
    return match ? match.trim() : null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value);

const readJsonFile = async (filePath: string): Promise<Record<string, unknown> | null> => {
    try {
        const content = await readFile(filePath, "utf8");
        const parsed = JSON.parse(content);
        return isRecord(parsed) ? parsed : null;
    } catch (error) {
        void error;
        return null;
    }
};

const coerceStringArray = (value: unknown): string[] | undefined => {
    if (!Array.isArray(value)) {
        return undefined;
    }
    const items = value.filter((item): item is string => typeof item === "string");
    return items.length > 0 ? items : undefined;
};

const coerceEnvArray = (value: unknown): Array<{ name: string; value: string }> => {
    if (Array.isArray(value)) {
        return value.filter((entry): entry is { name: string; value: string } => {
            return (
                entry !== null &&
                typeof entry === "object" &&
                typeof (entry as { name?: unknown }).name === "string" &&
                typeof (entry as { value?: unknown }).value === "string"
            );
        });
    }
    if (value && typeof value === "object") {
        const entries = Object.entries(value as Record<string, unknown>).flatMap((item) => {
            const [name, val] = item;
            return typeof val === "string" ? [{ name, value: val }] : [];
        });
        return entries;
    }
    return [];
};

const coerceStringRecord = (value: unknown): Record<string, string> | undefined => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return undefined;
    }
    const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, val]) => typeof val === "string")
        .map(([key, val]) => [key, String(val)]);
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

const coerceStringRecordFromArray = (value: unknown): Record<string, string> | undefined => {
    if (!Array.isArray(value)) {
        return undefined;
    }
    const entries = value
        .filter((entry): entry is { name: string; value: string } => {
            return (
                entry !== null &&
                typeof entry === "object" &&
                typeof (entry as { name?: unknown }).name === "string" &&
                typeof (entry as { value?: unknown }).value === "string"
            );
        })
        .map((entry) => [entry.name, entry.value]);
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

const coerceHeadersRecord = (value: unknown): Record<string, string> | undefined =>
    coerceStringRecord(value) ?? coerceStringRecordFromArray(value);

const toKeyValueArray = (record: Record<string, string> | undefined): Array<{ name: string; value: string }> =>
    record
        ? Object.entries(record).map(([name, value]) => ({ name, value }))
        : [];

const resolveEnvironmentContext = (environment?: string): {
    headerName: string;
    value: string;
} => {
    const config = ConfigManager.getInstance().getEnvironmentConfig();
    const isTestMode =
        process.env.ISOMORPHIQ_TEST_MODE === "true" || process.env.NODE_ENV === "test";
    const envInput =
        environment
        ?? process.env.ISOMORPHIQ_ENVIRONMENT
        ?? (isTestMode ? process.env.ISOMORPHIQ_TEST_ENVIRONMENT : undefined);
    const resolved = resolveEnvironmentValue(envInput, config);
    return {
        headerName: config.headerName,
        value: resolved,
    };
};

const resolveMcpHttpUrl = (): string => {
    const fromEnv =
        process.env.ISOMORPHIQ_MCP_SERVER_URL
        ?? process.env.MCP_SERVER_URL
        ?? process.env.ISOMORPHIQ_MCP_HTTP_URL
        ?? process.env.MCP_HTTP_URL;
    if (fromEnv && fromEnv.trim().length > 0) {
        return fromEnv.trim();
    }
    const host =
        process.env.ISOMORPHIQ_MCP_HTTP_HOST
        ?? process.env.MCP_HTTP_HOST
        ?? "localhost";
    const portRaw =
        process.env.ISOMORPHIQ_MCP_HTTP_PORT
        ?? process.env.MCP_HTTP_PORT
        ?? "3100";
    const port = Number.parseInt(portRaw, 10);
    const pathValue =
        process.env.ISOMORPHIQ_MCP_HTTP_PATH
        ?? process.env.MCP_HTTP_PATH
        ?? "/mcp";
    const normalizedPath = pathValue.startsWith("/") ? pathValue : `/${pathValue}`;
    const resolvedPort = Number.isFinite(port) && port > 0 ? port : 3100;
    return `http://${host}:${resolvedPort}${normalizedPath}`;
};

const appendEnvEntry = (
    envEntries: Array<{ name: string; value: string }>,
    name: string,
    value: string,
): Array<{ name: string; value: string }> => {
    if (envEntries.some((entry) => entry.name === name)) {
        return envEntries;
    }
    return [...envEntries, { name, value }];
};

const parseCommandMcpServerConfig = (
    value: Record<string, unknown>,
    environment?: string,
): { server: McpServerConfig; tools: string[] } | null => {
    const name = typeof value.name === "string" ? value.name : null;
    const command = typeof value.command === "string" ? value.command : null;
    if (!name || !command) {
        return null;
    }
    const args = coerceStringArray(value.args) ?? [];
    const baseEnv = coerceEnvArray(value.env);
    const env = environment
        ? appendEnvEntry(baseEnv, "ISOMORPHIQ_ENVIRONMENT", environment)
        : baseEnv;
    const tools = coerceStringArray(value.tools) ?? [];
    return {
        server: {
            name,
            command,
            args,
            env,
        },
        tools,
    };
};

const parseHttpMcpServerConfig = (
    value: Record<string, unknown>,
    environmentContext: { headerName: string; value: string },
): { server: McpServerConfig; tools: string[] } | null => {
    const name = typeof value.name === "string" ? value.name : null;
    if (!name) {
        return null;
    }
    const type = "sse";
    const url =
        typeof value.url === "string" && value.url.trim().length > 0
            ? value.url.trim()
            : resolveMcpHttpUrl();
    const headersBase = coerceHeadersRecord(value.headers) ?? {};
    const headers = {
        ...headersBase,
        [environmentContext.headerName]: environmentContext.value,
    };
    const env = coerceStringRecord(value.env) ?? coerceStringRecordFromArray(value.env) ?? {};
    const tools = coerceStringArray(value.tools) ?? [];
    return {
        server: {
            name,
            type,
            url,
            headers: toKeyValueArray(headers),
            env: toKeyValueArray(env),
        },
        tools,
    };
};

const selectMcpEntries = (
    entries: Record<string, unknown>[],
    runtime: AcpRuntime,
    environmentContext: { headerName: string; value: string },
): { servers: McpServerConfig[]; tools: string[] } => {
    const hasCommand = (entry: Record<string, unknown>): boolean =>
        typeof entry.command === "string" && entry.command.trim().length > 0;
    const hasUrl = (entry: Record<string, unknown>): boolean =>
        typeof entry.url === "string" && entry.url.trim().length > 0;
    const parsed = entries
        .map((entry) => {
            if (runtime === "opencode") {
                if (hasCommand(entry)) {
                    return parseCommandMcpServerConfig(entry, environmentContext.value);
                }
                return parseHttpMcpServerConfig(entry, environmentContext);
            }
            if (hasCommand(entry)) {
                return parseCommandMcpServerConfig(entry, environmentContext.value);
            }
            if (hasUrl(entry)) {
                return parseHttpMcpServerConfig(entry, environmentContext);
            }
            return null;
        })
        .filter((entry): entry is { server: McpServerConfig; tools: string[] } => !!entry);
    return {
        servers: parsed.map((entry) => entry.server),
        tools: parsed.flatMap((entry) => entry.tools),
    };
};

const resolveMcpServers = async (
    runtime: AcpRuntime,
    environment?: string,
): Promise<{ servers: McpServerConfig[]; tools: string[] }> => {
    const environmentContext = resolveEnvironmentContext(environment);
    const fromEnv = process.env.ACP_MCP_SERVERS ?? process.env.OPENCODE_MCP_SERVERS ?? "";
    if (fromEnv.trim().length > 0) {
        try {
            const parsed = JSON.parse(fromEnv);
            if (Array.isArray(parsed)) {
                return selectMcpEntries(parsed.filter(isRecord), runtime, environmentContext);
            }
            if (isRecord(parsed)) {
                return selectMcpEntries([parsed], runtime, environmentContext);
            }
        } catch (error) {
            void error;
        }
    }

    const defaultPath = path.join(process.cwd(), "packages", "mcp", "config", "mcp-server-config.json");
    const config = await readJsonFile(defaultPath);
    if (!config) {
        return runtime === "opencode"
            ? selectMcpEntries(
                    [
                        {
                            name: "task-manager",
                        },
                    ],
                    runtime,
                    environmentContext,
                )
            : { servers: [], tools: [] };
    }
    const selected = selectMcpEntries([config], runtime, environmentContext);
    if (selected.servers.length > 0) {
        return selected;
    }
    if (runtime === "opencode") {
        return selectMcpEntries(
            [
                {
                    name: typeof config.name === "string" ? config.name : "task-manager",
                    tools: Array.isArray(config.tools) ? config.tools : undefined,
                },
            ],
            runtime,
            environmentContext,
        );
    }
    return { servers: [], tools: [] };
};

const appendOutput = (current: string, chunk: Buffer, limit: number): string => {
    const next = `${current}${chunk.toString()}`;
    return next.length > limit ? next.slice(next.length - limit) : next;
};

const safeStringify = (value: unknown): string | null => {
    const seen = new WeakSet();
    try {
        const json = JSON.stringify(value, (_key, val) => {
            if (typeof val === "bigint") {
                return val.toString();
            }
            if (typeof val === "object" && val !== null) {
                if (seen.has(val)) {
                    return "[Circular]";
                }
                seen.add(val);
            }
            return val;
        });
        return typeof json === "string" ? json : null;
    } catch (error) {
        void error;
        return null;
    }
};

const resolveModelNameFromSession = (value: unknown): string | null => {
    if (!value || typeof value !== "object") {
        return null;
    }
    const models = (value as Record<string, unknown>).models;
    if (!models || typeof models !== "object") {
        return null;
    }
    const current = (models as Record<string, unknown>).currentModelId;
    if (typeof current !== "string" || current.trim().length === 0) {
        return null;
    }
    const available = (models as Record<string, unknown>).availableModels;
    if (Array.isArray(available)) {
        const match = available.find((entry) => {
            return (
                entry &&
                typeof entry === "object" &&
                (entry as Record<string, unknown>).modelId === current
            );
        }) as Record<string, unknown> | undefined;
        const name = match && typeof match.name === "string" ? match.name : null;
        return name ?? current;
    }
    return current;
};

const formatErrorMessage = (error: unknown): string => {
    if (error instanceof Error) {
        const rawMessage = error.message ?? "";
        const trimmed = rawMessage.trim();
        const isPlaceholder = trimmed.length === 0 || trimmed === "[object Object]";
        if (!isPlaceholder) {
            return trimmed;
        }
        const details = safeStringify({
            name: error.name,
            message: error.message,
            cause: error.cause,
        });
        if (details && details !== "{}") {
            return details;
        }
        return error.name || "Error";
    }
    return safeStringify(error) ?? String(error);
};

export async function createConnection(
	clientCapabilities: ClientCapabilities = {
		fs: {
			readTextFile: true,
			writeTextFile: true,
		},
	},
    options?: { environment?: string; modelName?: string },
): Promise<ACPConnectionResult> {
	console.log("[ACP] 🔗 Creating ACP connection...");
    let stderrOutput = "";
    let stdoutOutput = "";
    let exitCode: number | null = null;
    let exitSignal: NodeJS.Signals | null = null;

	try {
		// Spawn ACP server process (opencode or codex)
        const runtime = resolveAcpRuntime();
        const modelOverride = options?.modelName?.trim();
        const envOverrides = modelOverride
            ? {
                    ACP_MODEL: modelOverride,
                    OPENAI_MODEL: modelOverride,
                    MODEL: modelOverride,
                    LLM_MODEL: modelOverride,
                    OPENCODE_MODEL: modelOverride,
                    OPENCODE_MODEL_ID: modelOverride,
                    LLM_MODEL_ID: modelOverride,
                }
            : undefined;
		console.log(`[ACP] 🚀 Spawning ${runtime} process...`);
		const processResult = ProcessSpawner.spawnAcpServer(runtime, envOverrides);

        processResult.process.on("exit", (code, signal) => {
            exitCode = code ?? null;
            exitSignal = signal ?? null;
        });
        if (processResult.process.stderr) {
            processResult.process.stderr.on("data", (chunk) => {
                stderrOutput = appendOutput(stderrOutput, chunk as Buffer, 6000);
            });
        }
        if (processResult.process.stdout) {
            processResult.process.stdout.on("data", (chunk) => {
                stdoutOutput = appendOutput(stdoutOutput, chunk as Buffer, 2000);
            });
        }

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
        taskClient.runtimeName = runtime;
        taskClient.modelName = modelOverride ?? resolveModelFromEnv();
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
			clientCapabilities,
		});
		console.log(`[ACP] ✅ Connected to ${runtime} (protocol v${initResult.protocolVersion})`);
		console.log("[ACP] 📊 Init result:", JSON.stringify(initResult, null, 2));

		// Create session
		console.log("[ACP] 🆔 Creating new session...");
		console.log("[ACP] 📁 Working directory:", process.cwd());
        const mcpConfig = await resolveMcpServers(runtime, options?.environment);
        taskClient.mcpTools = mcpConfig.tools.length > 0 ? mcpConfig.tools : null;
        const sessionResult = await connection.newSession({
			cwd: process.cwd(),
			mcpServers: mcpConfig.servers,
		});
        if (modelOverride) {
            try {
                await connection.setSessionModel({
                    sessionId: sessionResult.sessionId,
                    modelId: modelOverride,
                });
                taskClient.modelName = modelOverride;
                console.log(`[ACP] 🎯 Session model set to ${modelOverride}`);
            } catch (error) {
                console.warn(
                    `[ACP] ⚠️ Failed to set session model to ${modelOverride}:`,
                    formatErrorMessage(error),
                );
            }
        }
        const sessionModelName = resolveModelNameFromSession(sessionResult);
        if (sessionModelName && !modelOverride) {
            taskClient.modelName = sessionModelName;
        }
		console.log("[ACP] ✅ Session created:", sessionResult.sessionId);
		console.log("[ACP] 📊 Session result:", JSON.stringify(sessionResult, null, 2));

		return {
			connection,
			sessionId: sessionResult.sessionId,
			processResult,
			taskClient,
		};
	} catch (error) {
        const baseMessage = formatErrorMessage(error);
        const stderrSnippet = stderrOutput.trim();
        const stdoutSnippet = stdoutOutput.trim();
        const exitInfo =
            exitCode !== null || exitSignal !== null
                ? `exit=${exitCode ?? "?"}${exitSignal ? ` signal=${exitSignal}` : ""}`
                : "";
        const details = [
            exitInfo,
            stderrSnippet ? `stderr=${stderrSnippet}` : "",
            stdoutSnippet ? `stdout=${stdoutSnippet}` : "",
        ].filter((part) => part.length > 0);
        const message = details.length > 0 ? `${baseMessage} | ${details.join(" | ")}` : baseMessage;

		console.error("[ACP] ❌ Connection creation failed:", message);
		console.error("[ACP] 📋 Error details:", safeStringify(error) ?? String(error));
		throw new Error(message, { cause: error instanceof Error ? error : undefined });
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
		const message = error instanceof Error ? error.message : String(error);
		if (message.includes("close timeout")) {
			console.log("[ACP] ⚠️ Connection close timed out; terminating process.");
		} else {
			console.log("[ACP] ❌ Error closing connection:", error);
		}
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
