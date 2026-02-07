import { existsSync } from "node:fs";
import path from "node:path";

const hasWorkspaceMarkers = (candidateDir: string): boolean => {
    const hasMcpConfig = existsSync(
        path.join(candidateDir, "packages", "mcp", "config", "mcp-server-config.json"),
    );
    if (hasMcpConfig) {
        return true;
    }
    const hasPrompts = existsSync(path.join(candidateDir, "prompts"));
    const hasPackageJson = existsSync(path.join(candidateDir, "package.json"));
    return hasPrompts && hasPackageJson;
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

export const resolveWorkspaceRoot = (): string => {
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

export const hasPlaywrightConfig = (workspaceRoot: string): boolean =>
    existsSync(path.join(workspaceRoot, "playwright.config.ts"))
    || existsSync(path.join(workspaceRoot, "playwright.config.js"))
    || existsSync(path.join(workspaceRoot, "playwright.config.mjs"));
