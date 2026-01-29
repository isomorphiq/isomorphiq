import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type StartMode = "interactive" | "non-interactive";

type ChildSpec = {
    name: string;
    command: string;
    args: string[];
    env: Record<string, string | undefined>;
    logFile?: string;
};

const parseInteractiveFlag = (args: string[]): boolean => {
    const flag = args.find((arg) => arg.startsWith("--interactive"));
    if (!flag) {
        return true;
    }
    const [, value] = flag.split("=");
    if (!value) {
        return true;
    }
    const normalized = value.trim().toLowerCase();
    if (["false", "0", "no"].includes(normalized)) {
        return false;
    }
    if (["true", "1", "yes"].includes(normalized)) {
        return true;
    }
    return true;
};

const resolveRoot = (): string => {
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    return path.resolve(moduleDir, "..");
};

const ensureDir = (dirPath: string): void => {
    fs.mkdirSync(dirPath, { recursive: true });
};

const writeEmptyFile = (filePath: string): void => {
    fs.writeFileSync(filePath, "");
};

const buildEnv = (
    root: string,
    extra: Record<string, string | undefined> = {},
): Record<string, string | undefined> => ({
    ...process.env,
    DB_PATH: process.env.DB_PATH ?? path.join(root, "db"),
    DAEMON_HTTP_PORT: process.env.DAEMON_HTTP_PORT ?? "3004",
    GATEWAY_PORT: process.env.GATEWAY_PORT ?? "3003",
    INIT_CWD: process.env.INIT_CWD ?? root,
    ...extra,
});

const spawnService = (spec: ChildSpec, mode: StartMode): ChildProcess => {
    const stdio =
        mode === "interactive"
            ? [
                    "ignore",
                    spec.logFile ? fs.openSync(spec.logFile, "a") : "ignore",
                    spec.logFile ? fs.openSync(spec.logFile, "a") : "ignore",
                ]
            : "inherit";
    const child = spawn(spec.command, spec.args, {
        cwd: resolveRoot(),
        env: spec.env,
        stdio,
    });
    return child;
};

const buildChildren = (
    root: string,
    mode: StartMode,
    logDir?: string,
    streamPath?: string,
): ChildSpec[] => {
    const logsDir = logDir ?? path.join(root, "logs");
    if (mode === "interactive") {
        ensureDir(logsDir);
    }

    const envBase = buildEnv(
        root,
        mode === "interactive"
            ? {
                    ACP_SESSION_UPDATE_PATH: streamPath,
                    ACP_SESSION_UPDATE_QUIET: "1",
                }
            : {},
    );
    const withLogs = (name: string): string => path.join(logsDir, `${name}.log`);

    return [
        {
            name: "mcp",
            command: "yarn",
            args: ["workspace", "@isomorphiq/mcp", "start"],
            env: envBase,
            logFile: mode === "interactive" ? withLogs("mcp") : undefined,
        },
        {
            name: "supervisor",
            command: "yarn",
            args: ["workspace", "@isomorphiq/supervisor", "start"],
            env: envBase,
            logFile: mode === "interactive" ? withLogs("supervisor") : undefined,
        },
        {
            name: "gateway",
            command: "yarn",
            args: ["workspace", "@isomorphiq/gateway", "start"],
            env: envBase,
            logFile: mode === "interactive" ? withLogs("gateway") : undefined,
        },
        {
            name: "web",
            command: "yarn",
            args: ["run", "web"],
            env: envBase,
            logFile: mode === "interactive" ? withLogs("web") : undefined,
        },
    ];
};

const startInkUi = (root: string, streamPath: string, logsDir: string): ChildProcess => {

    const args = [
        "--experimental-strip-types",
        path.join(root, "packages", "cli", "src", "ink-ui.ts"),
        "--stream-path",
        streamPath,
        "--log-paths",
        [
            path.join(logsDir, "mcp.log"),
            path.join(logsDir, "supervisor.log"),
            path.join(logsDir, "gateway.log"),
            path.join(logsDir, "web.log"),
        ].join(","),
    ];
    const env = buildEnv(root, {
        ACP_SESSION_UPDATE_PATH: streamPath,
        ACP_SESSION_UPDATE_QUIET: "1",
    });

    return spawn("node", args, {
        cwd: root,
        env,
        stdio: "inherit",
    });
};

const main = (): void => {
    const root = resolveRoot();
    const interactive = parseInteractiveFlag(process.argv.slice(2));
    const mode: StartMode = interactive ? "interactive" : "non-interactive";

    const streamPath = path.join(root, ".tmp", "acp-session.jsonl");
    const logDir = path.join(root, "logs");

    if (mode === "interactive") {
        ensureDir(path.join(root, ".tmp"));
        ensureDir(logDir);
        writeEmptyFile(streamPath);
    }

    const children = buildChildren(root, mode, logDir, streamPath).map((spec) =>
        spawnService(spec, mode),
    );
    const ui = mode === "interactive" ? startInkUi(root, streamPath, logDir) : null;
    const allChildren = ui ? [...children, ui] : children;

    const shutdown = (signal: NodeJS.Signals): void => {
        for (const child of allChildren) {
            if (!child.killed) {
                child.kill(signal);
            }
        }
        process.exit(0);
    };

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
};

main();
