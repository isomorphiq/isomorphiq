import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";

type DomReadable = globalThis.ReadableStream<Uint8Array>;
type DomWritable = globalThis.WritableStream<Uint8Array>;

export interface ProcessResult<InputStream = DomWritable, OutputStream = DomReadable> {
	process: ChildProcessWithoutNullStreams;
	input: InputStream;
	outputStream: OutputStream;
}

export const ProcessSpawner = {
	spawnOpencode(): ProcessResult<DomWritable, DomReadable> {
		console.log("[PROCESS] Spawning opencode as ACP server...");

		const opencodeProcess = spawn("opencode", ["acp"], {
			stdio: ["pipe", "pipe", "pipe"],
			cwd: process.cwd(),
			env: { ...process.env },
		});

		const input = Writable.toWeb(opencodeProcess.stdin) as DomWritable;
		const outputStream = Readable.toWeb(opencodeProcess.stdout) as DomReadable;

		console.log("[PROCESS] Opencode process spawned successfully");

		return {
			process: opencodeProcess,
			input,
			outputStream,
		};
	},

	cleanupProcess<I, O>(processResult: ProcessResult<I, O>): void {
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
