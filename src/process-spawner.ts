import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import type { ReadableStream, WritableStream } from "node:stream/web";

export interface ProcessResult {
	process: ChildProcessWithoutNullStreams;
	input: WritableStream;
	outputStream: ReadableStream;
}

export const ProcessSpawner = {
	spawnOpencode(): ProcessResult {
		console.log("[PROCESS] Spawning opencode as ACP server...");

		const opencodeProcess = spawn("opencode", ["acp"], {
			stdio: ["pipe", "pipe", "pipe"],
			cwd: process.cwd(),
			env: { ...process.env },
		});

		const input = Writable.toWeb(opencodeProcess.stdin);
		const outputStream = Readable.toWeb(opencodeProcess.stdout);

		console.log("[PROCESS] Opencode process spawned successfully");

		return {
			process: opencodeProcess,
			input,
			outputStream,
		};
	},

	cleanupProcess(processResult: ProcessResult): void {
		try {
			if (processResult.process) {
				processResult.process.kill("SIGTERM");
				console.log("[PROCESS] Process terminated");
			}
		} catch (error) {
			console.log("[PROCESS] Error terminating process:", error);
		}
	},
};
