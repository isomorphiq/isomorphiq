import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";

type DomReadable = globalThis.ReadableStream<Uint8Array>;
type DomWritable = globalThis.WritableStream<Uint8Array>;

export type AcpRuntime = "opencode" | "codex";

export interface ProcessResult<InputStream = DomWritable, OutputStream = DomReadable> {
	process: ChildProcessWithoutNullStreams;
	input: InputStream;
	outputStream: OutputStream;
}

export const ProcessSpawner = {
    spawnAcpServer(
        runtime: AcpRuntime,
        envOverrides?: Record<string, string>,
    ): ProcessResult<DomWritable, DomReadable> {
        return runtime === "codex"
            ? ProcessSpawner.spawnCodex(envOverrides)
            : ProcessSpawner.spawnOpencode(envOverrides);
    },

    spawnOpencode(envOverrides?: Record<string, string>): ProcessResult<DomWritable, DomReadable> {
        console.log("[PROCESS] Spawning opencode as ACP server...");

        const opencodeProcess = spawn("opencode", ["acp"], {
            stdio: ["pipe", "pipe", "pipe"],
            cwd: process.cwd(),
            env: { ...process.env, ...envOverrides },
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

    spawnCodex(envOverrides?: Record<string, string>): ProcessResult<DomWritable, DomReadable> {
        console.log("[PROCESS] Spawning codex as ACP server...");

        const codexProcess = spawn("codex", ["acp"], {
            stdio: ["pipe", "pipe", "pipe"],
            cwd: process.cwd(),
            env: { ...process.env, ...envOverrides },
        });

        const input = Writable.toWeb(codexProcess.stdin) as DomWritable;
        const outputStream = Readable.toWeb(codexProcess.stdout) as DomReadable;

        console.log("[PROCESS] Codex process spawned successfully");

        return {
            process: codexProcess,
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
