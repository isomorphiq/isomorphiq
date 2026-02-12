import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { Readable, Transform, Writable } from "node:stream";

type DomReadable = globalThis.ReadableStream<Uint8Array>;
type DomWritable = globalThis.WritableStream<Uint8Array>;

export type AcpRuntime = "opencode" | "codex";

export type CodexConfigOverride = {
    key: string;
    value: string;
};

export interface ProcessResult<InputStream = DomWritable, OutputStream = DomReadable> {
	process: ChildProcessWithoutNullStreams;
	input: InputStream;
	outputStream: OutputStream;
}

export const ProcessSpawner = {
    spawnAcpServer(
        runtime: AcpRuntime,
        envOverrides?: Record<string, string>,
        codexConfigOverrides?: CodexConfigOverride[],
    ): ProcessResult<DomWritable, DomReadable> {
        return runtime === "codex"
            ? ProcessSpawner.spawnCodex(envOverrides, codexConfigOverrides)
            : ProcessSpawner.spawnOpencode(envOverrides);
    },

    spawnOpencode(envOverrides?: Record<string, string>): ProcessResult<DomWritable, DomReadable> {
        console.log("[PROCESS] Spawning opencode as ACP server...");

        const opencodeProcess = spawn("opencode", ["acp"], {
            stdio: ["pipe", "pipe", "pipe"],
            cwd: resolveSpawnCwd(),
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

    spawnCodex(
        envOverrides?: Record<string, string>,
        codexConfigOverrides?: CodexConfigOverride[],
    ): ProcessResult<DomWritable, DomReadable> {
        console.log("[PROCESS] Spawning codex ACP server...");

        const codexCommand = resolveCodexCommand();
        const env = { ...process.env, ...envOverrides };
        const sandboxMode = normalizeSandboxMode(env.CODEX_ACP_SANDBOX ?? "workspace-write");
        const approvalPolicy = (env.CODEX_ACP_APPROVAL_POLICY ?? "never").trim();
        const overrideMap = new Map<string, string>();
        if (sandboxMode.length > 0) {
            overrideMap.set("sandbox_mode", `"${escapeTomlStringLiteral(sandboxMode)}"`);
        }
        if (approvalPolicy.length > 0) {
            overrideMap.set("approval_policy", `"${escapeTomlStringLiteral(approvalPolicy)}"`);
        }
        const normalizedOverrides = (codexConfigOverrides ?? []).filter(
            (entry): entry is CodexConfigOverride => {
                return (
                    entry !== null
                    && typeof entry === "object"
                    && typeof entry.key === "string"
                    && entry.key.trim().length > 0
                    && typeof entry.value === "string"
                    && entry.value.trim().length > 0
                );
            },
        );
        for (const override of normalizedOverrides) {
            overrideMap.set(override.key.trim(), override.value.trim());
        }
        const codexArgs = Array.from(overrideMap.entries()).flatMap(([key, value]) => [
            "-c",
            `${key}=${value}`,
        ]);
        const finalProcess = spawn(codexCommand, codexArgs, {
            stdio: ["pipe", "pipe", "pipe"],
            cwd: resolveSpawnCwd(),
            env,
        });

        const input = Writable.toWeb(finalProcess.stdin) as DomWritable;
        const outputStream = Readable.toWeb(
            finalProcess.stdout.pipe(createYarnDlxStdoutFilter()),
        ) as DomReadable;

        console.log("[PROCESS] Codex process spawned successfully");

        return {
            process: finalProcess,
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

const hasWorkspaceMarkers = (candidateDir: string): boolean => {
    const hasMcpConfig = existsSync(
        path.join(candidateDir, "packages", "mcp", "config", "mcp-server-config.json"),
    );
    if (hasMcpConfig) {
        return true;
    }
    return (
        existsSync(path.join(candidateDir, "package.json"))
        && existsSync(path.join(candidateDir, "prompts"))
    );
};

const findWorkspaceRoot = (startDir: string): string => {
    let currentDir = path.resolve(startDir);
    while (true) {
        if (hasWorkspaceMarkers(currentDir)) {
            return currentDir;
        }
        const parentDir = path.dirname(currentDir);
        if (parentDir === currentDir) {
            return path.resolve(startDir);
        }
        currentDir = parentDir;
    }
};

const resolveSpawnCwd = (): string => {
    const candidates = [
        process.env.INIT_CWD,
        process.cwd(),
    ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
    const resolvedCandidates = candidates.map((value) => path.resolve(value.trim()));
    const uniqueCandidates = resolvedCandidates.reduce<string[]>(
        (acc, candidate) => (acc.includes(candidate) ? acc : [...acc, candidate]),
        [],
    );
    for (const candidate of uniqueCandidates) {
        const resolved = findWorkspaceRoot(candidate);
        if (hasWorkspaceMarkers(resolved)) {
            return resolved;
        }
    }
    return uniqueCandidates[0] ?? process.cwd();
};

const normalizeSandboxMode = (value: string): string => {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
        return "";
    }
    const normalized = trimmed.toLowerCase();
    if (normalized === "workspace") {
        return "workspace-write";
    }
    return trimmed;
};

const escapeTomlStringLiteral = (value: string): string =>
    value
        .replace(/\\/g, "\\\\")
        .replace(/"/g, "\\\"");

const resolveCodexCommand = (): string => {
    const override = process.env.CODEX_ACP_BINARY ?? process.env.CODEX_ACP_COMMAND;
    if (override && override.trim().length > 0) {
        return override.trim();
    }
    const fromPath = resolveCommandInPath("codex-acp");
    if (!fromPath) {
        return "codex-acp";
    }
    if (isElfBinary(fromPath)) {
        return fromPath;
    }
    if (isShebangScript(fromPath)) {
        const resolved = resolveCodexBinaryFromWrapper(fromPath);
        if (resolved) {
            return resolved;
        }
    }
    return fromPath;
};

const resolveCommandInPath = (command: string): string | null => {
    if (command.includes(path.sep)) {
        return existsSync(command) ? command : null;
    }
    const pathEntries = (process.env.PATH ?? "").split(path.delimiter).filter((entry) => entry.length > 0);
    for (const entry of pathEntries) {
        const candidate = path.join(entry, command);
        if (isExecutable(candidate)) {
            return candidate;
        }
    }
    return null;
};

const isExecutable = (filePath: string): boolean => {
    if (!existsSync(filePath)) {
        return false;
    }
    try {
        const stat = statSync(filePath);
        return stat.isFile();
    } catch (_error) {
        return false;
    }
};

const readFileHeader = (filePath: string, length: number): Buffer | null => {
    try {
        const data = readFileSync(filePath);
        return data.subarray(0, length);
    } catch (_error) {
        return null;
    }
};

const isElfBinary = (filePath: string): boolean => {
    const header = readFileHeader(filePath, 4);
    if (!header || header.length < 4) {
        return false;
    }
    return (
        header[0] === 0x7f
        && header[1] === 0x45
        && header[2] === 0x4c
        && header[3] === 0x46
    );
};

const isShebangScript = (filePath: string): boolean => {
    const header = readFileHeader(filePath, 2);
    if (!header || header.length < 2) {
        return false;
    }
    return header[0] === 0x23 && header[1] === 0x21;
};

const resolveCodexBinaryFromWrapper = (wrapperPath: string): string | null => {
    const platformPackage = resolveCodexPlatformPackage();
    const binaryName = process.platform === "win32" ? "codex-acp.exe" : "codex-acp";
    if (!platformPackage) {
        return null;
    }

    const wrapperDir = path.dirname(wrapperPath);
    const candidateRoots = new Set<string>();
    candidateRoots.add(path.resolve(wrapperDir, "..", "lib", "node_modules"));
    candidateRoots.add(path.resolve(wrapperDir, ".."));
    candidateRoots.add(path.resolve(process.cwd(), "node_modules"));

    const pathEntries = (process.env.PATH ?? "").split(path.delimiter).filter((entry) => entry.length > 0);
    for (const entry of pathEntries) {
        if (entry.endsWith(`${path.sep}bin`)) {
            candidateRoots.add(path.resolve(entry, "..", "lib", "node_modules"));
            candidateRoots.add(path.resolve(entry, ".."));
        }
    }

    const platformPathSegment = path.join("@zed-industries", platformPackage, "bin", binaryName);
    const nestedPlatformPathSegment = path.join(
        "@zed-industries",
        "codex-acp",
        "node_modules",
        "@zed-industries",
        platformPackage,
        "bin",
        binaryName,
    );

    for (const root of candidateRoots) {
        const candidate = path.join(root, platformPathSegment);
        if (existsSync(candidate) && isElfBinary(candidate)) {
            return candidate;
        }
        const nestedCandidate = path.join(root, nestedPlatformPathSegment);
        if (existsSync(nestedCandidate) && isElfBinary(nestedCandidate)) {
            return nestedCandidate;
        }
    }

    return null;
};

const resolveCodexPlatformPackage = (): string | null => {
    const platform = process.platform;
    const arch = process.arch;
    if (platform === "linux") {
        if (arch === "x64") {
            return "codex-acp-linux-x64";
        }
        if (arch === "arm64") {
            return "codex-acp-linux-arm64";
        }
    }
    if (platform === "darwin") {
        if (arch === "x64") {
            return "codex-acp-darwin-x64";
        }
        if (arch === "arm64") {
            return "codex-acp-darwin-arm64";
        }
    }
    if (platform === "win32") {
        if (arch === "x64") {
            return "codex-acp-win32-x64";
        }
        if (arch === "arm64") {
            return "codex-acp-win32-arm64";
        }
    }
    return null;
};

const createYarnDlxStdoutFilter = (): Transform => {
    let buffer = "";
    const stripBom = (line: string): string => line.replace(/^\uFEFF/, "");
    const stripAnsiPrefix = (line: string): string =>
        line.replace(/^(?:\s*\u001b\[[0-9;]*m)+/g, "");
    const normalizeLine = (line: string): string =>
        stripAnsiPrefix(stripBom(line)).trim();
    const maybeJsonLine = (line: string): string | null => {
        const normalized = normalizeLine(line);
        if (normalized.length === 0) {
            return null;
        }
        try {
            JSON.parse(normalized);
            return normalized;
        } catch (_error) {
            return null;
        }
    };
    return new Transform({
        transform(chunk, _encoding, callback) {
            buffer += chunk.toString("utf8");
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() ?? "";
            const kept = lines
                .map((line) => maybeJsonLine(line))
                .filter((line): line is string => line !== null);
            if (kept.length > 0) {
                this.push(`${kept.join("\n")}\n`);
            }
            callback();
        },
        flush(callback) {
            if (buffer.length > 0) {
                const kept = maybeJsonLine(buffer);
                if (kept) {
                    this.push(kept);
                }
            }
            callback();
        },
    });
};
