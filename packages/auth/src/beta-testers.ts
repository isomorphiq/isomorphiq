import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { AuthCredentials } from "./types.ts";
import { UserRoleSchema } from "./types.ts";

const BetaTesterCredentialSchema = z.object({
    username: z.string().min(1),
    password: z.string().min(1),
    role: UserRoleSchema.optional(),
    email: z.string().email().optional(),
});

const BetaTestersFileSchema = z.object({
    testers: z.array(BetaTesterCredentialSchema),
});

export type BetaTesterCredential = z.output<typeof BetaTesterCredentialSchema>;

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const betaTestersPathCandidates = Array.from(
    new Set([
        path.join(process.cwd(), "packages", "auth", "beta-testers.jsonc"),
        path.join(process.cwd(), "beta-testers.jsonc"),
        path.join(moduleDir, "..", "beta-testers.jsonc"),
    ]),
);

const stripJsonComments = (value: string): string => {
    let result = "";
    let inString = false;
    let inLineComment = false;
    let inBlockComment = false;
    let escaped = false;

    for (let index = 0; index < value.length; index += 1) {
        const current = value[index];
        const next = value[index + 1] ?? "";

        if (inLineComment) {
            if (current === "\n") {
                inLineComment = false;
                result += current;
            }
            continue;
        }

        if (inBlockComment) {
            if (current === "*" && next === "/") {
                inBlockComment = false;
                index += 1;
            }
            continue;
        }

        if (inString) {
            result += current;
            if (escaped) {
                escaped = false;
                continue;
            }
            if (current === "\\") {
                escaped = true;
                continue;
            }
            if (current === "\"") {
                inString = false;
            }
            continue;
        }

        if (current === "\"") {
            inString = true;
            result += current;
            continue;
        }

        if (current === "/" && next === "/") {
            inLineComment = true;
            index += 1;
            continue;
        }

        if (current === "/" && next === "*") {
            inBlockComment = true;
            index += 1;
            continue;
        }

        result += current;
    }

    return result;
};

const readBetaTestersFile = async (): Promise<string | null> => {
    for (const candidatePath of betaTestersPathCandidates) {
        try {
            return await fs.readFile(candidatePath, "utf-8");
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
                throw error;
            }
        }
    }
    return null;
};

const loadBetaTesterCredentials = async (): Promise<BetaTesterCredential[]> => {
    try {
        const raw = await readBetaTestersFile();
        if (!raw) {
            return [];
        }
        const parsed = JSON.parse(stripJsonComments(raw));
        const validated = BetaTestersFileSchema.parse(parsed);
        return validated.testers;
    } catch (error) {
        console.error("[BETA-TESTERS] Failed to load beta testers file:", error);
        return [];
    }
};

export const findBetaTesterByCredentials = async (
    credentials: AuthCredentials,
): Promise<BetaTesterCredential | null> => {
    const testers = await loadBetaTesterCredentials();
    return (
        testers.find(
            (candidate) =>
                candidate.username === credentials.username
                && candidate.password === credentials.password,
        ) ?? null
    );
};
