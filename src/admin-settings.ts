import fs from "node:fs/promises";
import path from "node:path";
import type { AdminSettings } from "./types.ts";

const settingsPath = path.join(process.cwd(), "db", "admin-settings.json");

const defaultSettings: AdminSettings = {
    registrationEnabled: false,
    allowNonAdminWrites: false,
};

export async function loadAdminSettings(): Promise<AdminSettings> {
    try {
        const raw = await fs.readFile(settingsPath, "utf-8");
        const parsed = JSON.parse(raw) as Partial<AdminSettings>;
        return {
            ...defaultSettings,
            ...parsed,
        };
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            console.error("[ADMIN-SETTINGS] Failed to read settings file:", error);
        }
        return defaultSettings;
    }
}

export async function saveAdminSettings(partial: Partial<AdminSettings>): Promise<AdminSettings> {
    const current = await loadAdminSettings();
    const nextSettings: AdminSettings = {
        ...current,
        ...partial,
    };

    await fs.mkdir(path.dirname(settingsPath), { recursive: true });
    await fs.writeFile(settingsPath, JSON.stringify(nextSettings, null, 2), "utf-8");

    return nextSettings;
}

export function isAdminUser(username?: string | null): boolean {
    return username === "nyan";
}
