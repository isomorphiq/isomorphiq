/* eslint-disable no-unused-vars */
import type {
    PermissionRequest,
    PermissionResponse,
    SessionUpdateParams,
    ReadTextFileParams,
    ReadTextFileResult,
    WriteTextFileParams,
    WriteTextFileResult,
} from "./types.ts";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface AcpClientInterface {
	requestPermission(params: PermissionRequest): Promise<PermissionResponse>;
	sessionUpdate(params: SessionUpdateParams): Promise<void>;
    readTextFile?(params: ReadTextFileParams): Promise<ReadTextFileResult>;
    writeTextFile?(params: WriteTextFileParams): Promise<WriteTextFileResult>;
}

/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class TaskClient implements AcpClientInterface {
	public responseText = "";
    public taskComplete = false;
    public turnComplete = false;
    public turnCompletionCount = 0;
    public taskError = "";
    public stopReason: string | null = null;
    public thoughtText = "";
    public profileName: string | null = null;
    public sessionId: string | null = null;
    public runtimeName: string | null = null;
    public modelName: string | null = null;
    public requestedModelName: string | null = null;
    public mcpTools: string[] | null = null;
    public taskId: string | null = null;
    public taskTitle: string | null = null;
    public taskType: string | null = null;
    public taskStatus: string | null = null;
    public workflowState: string | null = null;
    public workflowSourceState: string | null = null;
    public workflowTargetState: string | null = null;
    public workflowTransition: string | null = null;
    public turnMcpToolCallCount = 0;
    public turnNonMcpToolCallCount = 0;
    public turnToolCallTitles: string[] = [];
    public canReadFiles = true;
    public canWriteFiles = true;
    public workspaceRoot = process.cwd();
    public onConfigOptions?: (options: Array<Record<string, unknown>>) => void;

	private async emitSessionUpdate(update: Record<string, unknown>): Promise<void> {
		const streamPath = process.env.ACP_SESSION_UPDATE_PATH;
		const streamMode = process.env.ACP_SESSION_UPDATE_STREAM;
		const line = `${JSON.stringify({
			...update,
            profileName: this.profileName ?? undefined,
            sessionId: this.sessionId ?? undefined,
            runtimeName: this.runtimeName ?? undefined,
            modelName: this.modelName ?? undefined,
            requestedModelName: this.requestedModelName ?? undefined,
            mcpTools: this.mcpTools ?? undefined,
            taskId: this.taskId ?? undefined,
            taskTitle: this.taskTitle ?? undefined,
            taskType: this.taskType ?? undefined,
            taskStatus: this.taskStatus ?? undefined,
            workflowState: this.workflowState ?? undefined,
            workflowSourceState: this.workflowSourceState ?? undefined,
            workflowTargetState: this.workflowTargetState ?? undefined,
            workflowTransition: this.workflowTransition ?? undefined,
		})}\n`;

		if (streamPath && streamPath.trim().length > 0) {
			try {
				await appendFile(streamPath, line);
			} catch {
				// Ignore stream write failures.
			}
			return;
		}

		if (streamMode === "jsonl") {
			process.stdout.write(line);
		}
	}

	async sessionUpdate(params: SessionUpdateParams): Promise<void> {
		const update = (params.update ?? params.updates ?? {}) as Record<string, unknown>;
		const updateType = update.sessionUpdate as string | undefined;
		const streamMode = process.env.ACP_SESSION_UPDATE_STREAM;
		const quietLogs = process.env.ACP_SESSION_UPDATE_QUIET === "1" || streamMode === "jsonl";
        const logPrefix = [
            "[ACP]",
            this.profileName ? `[${this.profileName}]` : "",
            this.runtimeName ? `[${this.runtimeName}]` : "",
        ]
            .filter((part) => part.length > 0)
            .join("");

		void this.emitSessionUpdate({
			sessionUpdate: updateType ?? "unknown",
			update,
			timestamp: new Date().toISOString(),
		});

		if (!quietLogs) {
			console.log(`${logPrefix} 🔄 Session update: ${updateType ?? "unknown"}`);
			console.log(`${logPrefix} 📝 Full update:`, JSON.stringify(update, null, 2));
		}

		switch (updateType) {
			case "tool_call":
                {
                    const title =
                        typeof update.title === "string" ? update.title : "unknown-tool";
                    const rawInput = (update as Record<string, unknown>).rawInput;
                    const isMcpToolCall =
                        rawInput !== null
                        && typeof rawInput === "object"
                        && typeof (rawInput as Record<string, unknown>).server === "string"
                        && typeof (rawInput as Record<string, unknown>).tool === "string";
                    if (isMcpToolCall) {
                        this.turnMcpToolCallCount += 1;
                    } else {
                        this.turnNonMcpToolCallCount += 1;
                    }
                    if (!this.turnToolCallTitles.includes(title)) {
                        this.turnToolCallTitles = [...this.turnToolCallTitles, title];
                    }
                }
				if (!quietLogs) {
					console.log(`${logPrefix} 🔧 Tool call START: ${update.title}`);
					console.log(`${logPrefix} 📋 Tool call details:`, JSON.stringify(update, null, 2));
					console.log(`${logPrefix} ⚡ Tool status: ${update.status}`);
					if (update.arguments) {
						console.log(
							`${logPrefix} 📤 Tool arguments:`,
							JSON.stringify(update.arguments, null, 2),
						);
					}
				}
				break;
			case "tool_call_update":
				if (!quietLogs) {
					console.log(`${logPrefix} 🔄 Tool UPDATE: ${update.toolCallId}`);
					console.log(`${logPrefix} 📊 Tool status: ${update.status}`);
					if (update.result) {
						console.log(
							`${logPrefix} 📥 Tool result:`,
							JSON.stringify(update.result, null, 2),
						);
					}
					if (update.error) {
						console.log(
							`${logPrefix} ❌ Tool error:`,
							JSON.stringify(update.error, null, 2),
						);
					}
				}
				break;
			case "agent_message_chunk": {
				const content = update.content as Record<string, unknown>;
				if (content.type === "text") {
					this.responseText += content.text as string;
					// Write just the text without newline
					if (!quietLogs) {
						process.stdout.write(content.text as string);
					}
				}
				break;
			}
			case "agent_thought_chunk": {
				const content = update.content as Record<string, unknown>;
				if (content.type === "text") {
					this.thoughtText += content.text as string;
				}
				break;
			}
			case "turn_complete":
				if (!quietLogs) {
					console.log(`${logPrefix} ✅ Turn completed`);
					console.log(`${logPrefix} 📊 Turn stats:`, JSON.stringify(update, null, 2));
				}
				this.markTurnComplete("turn_complete");
				break;
			case "end_turn":
				if (!quietLogs) {
					console.log(`${logPrefix} ✅ End turn received`);
					console.log(`${logPrefix} 📊 End turn stats:`, JSON.stringify(update, null, 2));
				}
				this.markTurnComplete("end_turn");
				break;
			case "session_complete":
				if (!quietLogs) {
					console.log(`${logPrefix} 🏁 Session completed`);
					console.log(`${logPrefix} 📋 Session summary:`, JSON.stringify(update, null, 2));
				}
				this.markTurnComplete("session_complete");
				break;
			case "session_meta":
                if (!quietLogs) {
                    console.log(`${logPrefix} ℹ️ Session metadata updated`);
                }
                break;
            case "config_option_update": {
                const options = Array.isArray((update as Record<string, unknown>).configOptions)
                    ? ((update as Record<string, unknown>).configOptions as Array<Record<string, unknown>>)
                    : [];
                if (options.length > 0) {
                    this.onConfigOptions?.(options);
                }
                break;
            }
			default:
				if (!quietLogs) {
					console.log(`${logPrefix} ❓ Unknown update type: ${update.sessionUpdate}`);
				}
		}
	}

    private resolveWorkspacePath(targetPath: string): string {
        const root = this.workspaceRoot;
        const resolved = path.resolve(root, targetPath);
        const relative = path.relative(root, resolved);
        if (relative.startsWith("..") || path.isAbsolute(relative)) {
            throw new Error(`Path is outside the workspace: ${targetPath}`);
        }
        return resolved;
    }

    async readTextFile(params: ReadTextFileParams): Promise<ReadTextFileResult> {
        if (!this.canReadFiles) {
            throw new Error("File read access is disabled for this session.");
        }
        const resolved = this.resolveWorkspacePath(params.path);
        const encoding = params.encoding ?? "utf8";
        const buffer = await readFile(resolved);
        const content =
            encoding === "base64" ? buffer.toString("base64") : buffer.toString("utf8");
        return {
            content,
            encoding,
        };
    }

    async writeTextFile(params: WriteTextFileParams): Promise<WriteTextFileResult> {
        if (!this.canWriteFiles) {
            throw new Error("File write access is disabled for this session.");
        }
        const resolved = this.resolveWorkspacePath(params.path);
        const encoding = params.encoding ?? "utf8";
        const data =
            encoding === "base64"
                ? Buffer.from(params.content, "base64")
                : Buffer.from(params.content, "utf8");
        await writeFile(resolved, data);
        return {
            success: true,
            path: params.path,
        };
    }

	async requestPermission(params: PermissionRequest): Promise<PermissionResponse> {
		const toolCall = (params.context as Record<string, unknown>)?.toolCall as Record<
			string,
			unknown
		>;

        const logPrefix = [
            "[ACP]",
            this.profileName ? `[${this.profileName}]` : "",
            this.runtimeName ? `[${this.runtimeName}]` : "",
        ]
            .filter((part) => part.length > 0)
            .join("");

		console.log(`${logPrefix} 🔐 Permission requested for: ${toolCall?.title as string}`);
		console.log(`${logPrefix} 📋 Permission details:`, JSON.stringify(params, null, 2));
		console.log(`${logPrefix} ✅ Auto-approving tool call`);

		// Auto-approve all tool calls for task manager
		const response = {
			outcome: "approved" as const,
			reason: "Task manager auto-approves all tool calls",
		};
		console.log(`${logPrefix} 📤 Permission response:`, JSON.stringify(response, null, 2));
		return response;
	}

	getResponse(): { output: string; error: string } {
		return {
			output: this.responseText,
			error: this.taskError,
		};
	}

	isTurnComplete(): boolean {
		return this.turnComplete || this.taskComplete || !!this.stopReason;
	}

	markTurnComplete(reason?: string): void {
		if (reason) {
			this.stopReason = reason;
		}
        if (!this.turnComplete) {
            this.turnComplete = true;
            // Treat a completed turn as completing the task for our single-turn sessions
            this.taskComplete = true;
            this.turnCompletionCount += 1;
        }
	}

    beginNewTurn(): void {
        this.responseText = "";
        this.taskError = "";
        this.thoughtText = "";
        this.turnComplete = false;
        this.taskComplete = false;
        this.stopReason = null;
        this.turnMcpToolCallCount = 0;
        this.turnNonMcpToolCallCount = 0;
        this.turnToolCallTitles = [];
    }
}
