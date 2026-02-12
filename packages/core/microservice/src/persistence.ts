import path from "node:path";
import { ConfigManager } from "@isomorphiq/core";

export const resolveLevelDbRootPath = (): string => {
    const config = ConfigManager.getInstance();
    const basePath = config.getDatabaseConfig().path;
    return path.isAbsolute(basePath)
        ? basePath
        : path.join(process.cwd(), basePath);
};

export const resolveEnvironmentName = (): string => {
    const config = ConfigManager.getInstance();
    const environmentConfig = config.getEnvironmentConfig();
    const requested =
        process.env.ISOMORPHIQ_ENVIRONMENT
        ?? process.env.DEFAULT_ENVIRONMENT
        ?? environmentConfig.default;
    return environmentConfig.available.includes(requested)
        ? requested
        : environmentConfig.default;
};

export const resolveEnvironmentLevelDbPath = (
    environment: string,
    segments: readonly string[] = [],
): string => path.join(resolveLevelDbRootPath(), environment, ...segments);

export const resolveScopedLevelDbPath = (
    scope: string,
    options: {
        environment?: string;
        segments?: readonly string[];
    } = {},
): string => {
    const environment = options.environment ?? resolveEnvironmentName();
    const segments = options.segments ?? [];
    return resolveEnvironmentLevelDbPath(environment, [scope, ...segments]);
};
