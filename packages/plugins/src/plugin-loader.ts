import fs from "node:fs/promises";
import path from "node:path";
import type { PluginMetadata, ProfilePlugin } from "./plugin-system.ts";

/**
 * Simple filesystem plugin loader.
 */
export class FileSystemPluginLoader {
    private pluginsDirectory: string;

    constructor(pluginsDirectory: string = path.join(process.cwd(), "plugins")) {
        this.pluginsDirectory = pluginsDirectory;
    }

    async loadPlugin(name: string): Promise<{ plugin: ProfilePlugin; metadata: PluginMetadata }> {
        const pluginPath = path.join(this.pluginsDirectory, `${name}.js`);
        const module = await import(pathToFileUrl(pluginPath).href);
        const plugin: ProfilePlugin = module.default || module.plugin || module[name];
        if (!plugin) {
            throw new Error(`Plugin ${name} not found in ${pluginPath}`);
        }
        const metadata: PluginMetadata = {
            name,
            version: "0.0.0",
            description: "",
            author: "",
            license: "UNLICENSED",
            keywords: [],
        };
        return { plugin, metadata };
    }

    async listAvailablePlugins(): Promise<string[]> {
        try {
            const files = await fs.readdir(this.pluginsDirectory);
            return files.filter((file) => file.endsWith(".js")).map((file) => file.replace(/\\.js$/, ""));
        } catch (_error) {
            return [];
        }
    }
}

function pathToFileUrl(filePath: string): URL {
    return new URL(`file://${path.resolve(filePath)}`);
}
