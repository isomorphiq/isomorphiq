import type { PermissionRequest, PermissionResponse, SessionUpdateParams } from "./types.ts";

export interface AcpClientInterface {
	requestPermission(params: PermissionRequest): Promise<PermissionResponse>;
	sessionUpdate(params: SessionUpdateParams): Promise<void>;
}

export class TaskClient implements AcpClientInterface {
	public responseText = "";
	public taskComplete = false;
	public turnComplete = false;
	public taskError = "";
	public stopReason: string | null = null;

	async sessionUpdate(params: SessionUpdateParams): Promise<void> {
		const update = (params.update ?? params.updates ?? {}) as Record<string, unknown>;
		const updateType = update.sessionUpdate as string | undefined;
		console.log(`[ACP] 🔄 Session update: ${updateType ?? "unknown"}`);
		console.log(`[ACP] 📝 Full update:`, JSON.stringify(update, null, 2));

		switch (updateType) {
			case "tool_call":
				console.log(`[ACP] 🔧 Tool call START: ${update.title}`);
				console.log(`[ACP] 📋 Tool call details:`, JSON.stringify(update, null, 2));
				console.log(`[ACP] ⚡ Tool status: ${update.status}`);
				if (update.arguments) {
					console.log(`[ACP] 📤 Tool arguments:`, JSON.stringify(update.arguments, null, 2));
				}
				break;
			case "tool_call_update":
				console.log(`[ACP] 🔄 Tool UPDATE: ${update.toolCallId}`);
				console.log(`[ACP] 📊 Tool status: ${update.status}`);
				if (update.result) {
					console.log(`[ACP] 📥 Tool result:`, JSON.stringify(update.result, null, 2));
				}
				if (update.error) {
					console.log(`[ACP] ❌ Tool error:`, JSON.stringify(update.error, null, 2));
				}
				break;
			case "agent_message_chunk": {
				const content = update.content as Record<string, unknown>;
				if (content.type === "text") {
					this.responseText += content.text as string;
					// Write just the text without newline
					process.stdout.write(content.text as string);
				}
				break;
			}
			case "turn_complete":
				console.log(`[ACP] ✅ Turn completed`);
				console.log(`[ACP] 📊 Turn stats:`, JSON.stringify(update, null, 2));
				this.markTurnComplete("turn_complete");
				break;
			case "end_turn":
				console.log(`[ACP] ✅ End turn received`);
				console.log(`[ACP] 📊 End turn stats:`, JSON.stringify(update, null, 2));
				this.markTurnComplete("end_turn");
				break;
			case "session_complete":
				console.log(`[ACP] 🏁 Session completed`);
				console.log(`[ACP] 📋 Session summary:`, JSON.stringify(update, null, 2));
				this.markTurnComplete("session_complete");
				break;
			default:
				console.log(`[ACP] ❓ Unknown update type: ${update.sessionUpdate}`);
		}
	}

	async requestPermission(params: PermissionRequest): Promise<PermissionResponse> {
		const toolCall = (params.context as Record<string, unknown>)?.toolCall as Record<
			string,
			unknown
		>;
		const _options = (params.context as Record<string, unknown>)?.options as Array<
			Record<string, unknown>
		>;
		console.log(`[ACP] 🔐 Permission requested for: ${toolCall?.title as string}`);
		console.log(`[ACP] 📋 Permission details:`, JSON.stringify(params, null, 2));
		console.log(`[ACP] ✅ Auto-approving tool call`);

		// Auto-approve all tool calls for task manager
		const response = {
			outcome: "approved" as const,
			reason: "Task manager auto-approves all tool calls",
		};
		console.log(`[ACP] 📤 Permission response:`, JSON.stringify(response, null, 2));
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
		this.turnComplete = true;
		// Treat a completed turn as completing the task for our single-turn sessions
		this.taskComplete = true;
	}
}
