export type DatabaseConfig = {
    path: string;
    valueEncoding: "json" | "utf8" | "binary";
};

export type ProcessSpawnOptions = {
    cwd?: string;
    env?: Record<string, string>;
    stdio?: "pipe" | "inherit" | "ignore";
};

export type OpencodeCommandResult = {
    success: boolean;
    output?: string;
    error?: string;
    sessionId?: string;
};
