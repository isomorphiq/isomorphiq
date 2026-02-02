import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value);

const readPackageJson = (packageJsonPath: string): Record<string, unknown> => {
    const raw = readFileSync(packageJsonPath, "utf8");
    const parsed = JSON.parse(raw);
    return isRecord(parsed) ? parsed : {};
};

const asString = (value: unknown): string | null =>
    typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const extractExportEntries = (value: unknown): string[] => {
    if (typeof value === "string") {
        return [value];
    }
    if (!isRecord(value)) {
        return [];
    }
    if ("." in value) {
        return extractExportEntries(value["."]);
    }
    const keys = ["import", "require", "default", "types"];
    return keys.flatMap((key) => {
        const entry = value[key];
        return typeof entry === "string" ? [entry] : [];
    });
};

const uniqueEntries = (entries: string[]): string[] =>
    entries.reduce<string[]>(
        (acc, entry) => (acc.includes(entry) ? acc : [...acc, entry]),
        [],
    );

const resolveEntryCandidates = (pkg: Record<string, unknown>): string[] => {
    const rawEntries = [
        asString(pkg.main),
        asString(pkg.module),
        asString(pkg.types),
        asString(pkg.typings),
        ...extractExportEntries(pkg.exports),
    ].flatMap((entry) => (entry ? [entry] : []));
    return uniqueEntries(rawEntries);
};

const resolveWorkspaceName = (pkg: Record<string, unknown>): string =>
    asString(pkg.name) ?? "unknown-workspace";

const workspaceRoot = process.cwd();
const packageJsonPath = path.join(workspaceRoot, "package.json");

test("workspace package.json exists", () => {
    assert.ok(existsSync(packageJsonPath), `Missing package.json at ${packageJsonPath}`);
});

test("workspace package.json parses", () => {
    assert.doesNotThrow(() => readPackageJson(packageJsonPath));
});

test("workspace entrypoints exist", () => {
    const pkg = readPackageJson(packageJsonPath);
    const entries = resolveEntryCandidates(pkg);
    if (entries.length === 0) {
        assert.ok(true, `No entrypoints declared for ${resolveWorkspaceName(pkg)}`);
        return;
    }
    const missing = entries.filter((entry) => !existsSync(path.resolve(workspaceRoot, entry)));
    assert.equal(
        missing.length,
        0,
        `Missing entrypoints for ${resolveWorkspaceName(pkg)}: ${missing.join(", ")}`,
    );
});

test("workspace entrypoints include exports", () => {
    const pkg = readPackageJson(packageJsonPath);
    const entries = resolveEntryCandidates(pkg);
    if (entries.length === 0) {
        assert.ok(true, `No entrypoints declared for ${resolveWorkspaceName(pkg)}`);
        return;
    }
    const failures: string[] = [];
    for (const entry of entries) {
        const resolved = path.resolve(workspaceRoot, entry);
        if (!existsSync(resolved)) {
            failures.push(`${entry} (missing)`);
            continue;
        }
        const content = readFileSync(resolved, "utf8");
        if (!/\bexport\b/.test(content)) {
            failures.push(`${entry} (no export found)`);
        }
    }
    assert.equal(
        failures.length,
        0,
        `Entrypoints missing exports for ${resolveWorkspaceName(pkg)}: ${failures.join("; ")}`,
    );
});
