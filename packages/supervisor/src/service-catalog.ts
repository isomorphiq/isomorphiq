import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type SupervisorServiceId =
    | "auth-service"
    | "profiles-service"
    | "tasks-service"
    | "search-service"
    | "context-service"
    | "notifications-service"
    | "dashboard-service"
    | "gateway"
    | "worker-manager"
    | "mcp-service";

export type SupervisorServiceConfig = {
    id: SupervisorServiceId;
    name: string;
    description: string;
    entry: string;
    env: Record<string, string | undefined>;
    endpoints: readonly SupervisorServiceEndpointConfig[];
};

export type SupervisorServiceEndpointConfig = {
    label: string;
    protocol: "tcp" | "http";
    hostEnvKeys: readonly string[];
    portEnvKeys: readonly string[];
    defaultHost: string;
    defaultPort: number;
    healthPath?: string;
    enabled: (env: NodeJS.ProcessEnv) => boolean;
};

export type ResolvedSupervisorServiceEndpoint = {
    label: string;
    protocol: "tcp" | "http";
    host: string;
    port: number;
    healthPath?: string;
    enabled: boolean;
};

type ServiceCatalogOptions = {
    root?: string;
    env?: NodeJS.ProcessEnv;
    argv?: string[];
};

export const pathExists = (candidate: string): boolean => {
    try {
        fs.accessSync(candidate, fs.constants.F_OK);
        return true;
    } catch {
        return false;
    }
};

const hasWorkerEntry = (root: string): boolean =>
    pathExists(path.join(root, "packages", "worker", "src", "worker-daemon.ts"));

const hasWorkspaceConfig = (root: string): boolean => {
    const packagePath = path.join(root, "package.json");
    if (!pathExists(packagePath)) {
        return false;
    }
    try {
        const raw = fs.readFileSync(packagePath, "utf8");
        const parsed = JSON.parse(raw) as { workspaces?: unknown };
        return Array.isArray(parsed.workspaces) && parsed.workspaces.length > 0;
    } catch {
        return false;
    }
};

const findRepoRoot = (start: string): string | null => {
    let current = start;
    for (;;) {
        if (hasWorkerEntry(current) || hasWorkspaceConfig(current)) {
            return current;
        }
        const parent = path.dirname(current);
        if (parent === current) {
            return null;
        }
        current = parent;
    }
};

export const resolveSupervisorRoot = (): string => {
    const seeds = [
        process.env.INIT_CWD,
        process.cwd(),
        path.dirname(fileURLToPath(import.meta.url)),
    ].filter((value): value is string => typeof value === "string" && value.length > 0);

    for (const seed of seeds) {
        const found = findRepoRoot(seed);
        if (found) {
            return found;
        }
    }

    return process.cwd();
};

const readInteractiveFlag = (argv: string[]): boolean => {
    for (const arg of argv) {
        if (!arg.startsWith("--interactive")) {
            continue;
        }
        const [, value] = arg.split("=");
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
    }
    return true;
};

export const createSupervisorServiceCatalog = (
    options: ServiceCatalogOptions = {},
): { root: string; services: readonly SupervisorServiceConfig[] } => {
    const root = options.root ?? resolveSupervisorRoot();
    const env = options.env ?? process.env;
    const argv = options.argv ?? process.argv.slice(2);
    const interactive = readInteractiveFlag(argv);
    const gatewayPort = env.GATEWAY_PORT ?? "3003";
    const gatewayHost = env.GATEWAY_HOST ?? "127.0.0.1";
    const gatewayBaseUrl = `http://${gatewayHost}:${gatewayPort}`;
    const alwaysEnabled = (): boolean => true;

    const services: readonly SupervisorServiceConfig[] = [
        {
            id: "auth-service",
            name: "auth-service",
            description: "Authentication and authorization microservice",
            entry: path.join(root, "packages", "auth", "src", "auth-service-server.ts"),
            env: {},
            endpoints: [
                {
                    label: "trpc",
                    protocol: "http",
                    hostEnvKeys: ["AUTH_HOST"],
                    portEnvKeys: ["AUTH_HTTP_PORT", "AUTH_PORT"],
                    defaultHost: "127.0.0.1",
                    defaultPort: 3009,
                    healthPath: "/health",
                    enabled: alwaysEnabled,
                },
            ],
        },
        {
            id: "profiles-service",
            name: "profiles-service",
            description: "User profiles microservice",
            entry: path.join(root, "packages", "profiles", "src", "profiles-service-server.ts"),
            env: {},
            endpoints: [
                {
                    label: "trpc",
                    protocol: "http",
                    hostEnvKeys: ["USER_PROFILE_HOST"],
                    portEnvKeys: ["USER_PROFILE_HTTP_PORT", "USER_PROFILE_PORT"],
                    defaultHost: "127.0.0.1",
                    defaultPort: 3010,
                    healthPath: "/health",
                    enabled: alwaysEnabled,
                },
            ],
        },
        {
            id: "tasks-service",
            name: "tasks-service",
            description: "Tasks microservice",
            entry: path.join(root, "packages", "tasks", "src", "task-service-server.ts"),
            env: {},
            endpoints: [
                {
                    label: "trpc",
                    protocol: "http",
                    hostEnvKeys: ["TASKS_HOST"],
                    portEnvKeys: ["TASKS_HTTP_PORT", "TASKS_PORT"],
                    defaultHost: "127.0.0.1",
                    defaultPort: 3006,
                    healthPath: "/health",
                    enabled: alwaysEnabled,
                },
            ],
        },
        {
            id: "search-service",
            name: "search-service",
            description: "Search microservice",
            entry: path.join(root, "packages", "search", "src", "search-service-server.ts"),
            env: {},
            endpoints: [
                {
                    label: "trpc",
                    protocol: "http",
                    hostEnvKeys: ["SEARCH_HOST"],
                    portEnvKeys: ["SEARCH_HTTP_PORT", "SEARCH_PORT"],
                    defaultHost: "127.0.0.1",
                    defaultPort: 3007,
                    healthPath: "/health",
                    enabled: alwaysEnabled,
                },
            ],
        },
        {
            id: "context-service",
            name: "context-service",
            description: "Context microservice",
            entry: path.join(root, "packages", "context", "src", "context-service-server.ts"),
            env: {},
            endpoints: [
                {
                    label: "trpc",
                    protocol: "http",
                    hostEnvKeys: ["CONTEXT_HOST"],
                    portEnvKeys: ["CONTEXT_HTTP_PORT", "CONTEXT_PORT"],
                    defaultHost: "127.0.0.1",
                    defaultPort: 3008,
                    healthPath: "/health",
                    enabled: alwaysEnabled,
                },
            ],
        },
        {
            id: "notifications-service",
            name: "notifications-service",
            description: "Notifications microservice",
            entry: path.join(
                root,
                "packages",
                "notifications",
                "src",
                "notifications-service-server.ts",
            ),
            env: {},
            endpoints: [
                {
                    label: "trpc",
                    protocol: "http",
                    hostEnvKeys: ["NOTIFICATIONS_HOST"],
                    portEnvKeys: ["NOTIFICATIONS_HTTP_PORT", "NOTIFICATIONS_PORT"],
                    defaultHost: "127.0.0.1",
                    defaultPort: 3011,
                    healthPath: "/health",
                    enabled: alwaysEnabled,
                },
            ],
        },
        {
            id: "dashboard-service",
            name: "dashboard-service",
            description: "Dashboard microservice",
            entry: path.join(root, "packages", "dashboard", "src", "web", "dashboard-service.ts"),
            env: {},
            endpoints: [
                {
                    label: "http",
                    protocol: "http",
                    hostEnvKeys: ["DASHBOARD_HOST"],
                    portEnvKeys: ["DASHBOARD_PORT"],
                    defaultHost: "127.0.0.1",
                    defaultPort: 3005,
                    healthPath: "/health",
                    enabled: alwaysEnabled,
                },
            ],
        },
        {
            id: "gateway",
            name: "gateway",
            description: "HTTP gateway service",
            entry: path.join(root, "services", "gateway", "src", "index.ts"),
            env: {},
            endpoints: [
                {
                    label: "http",
                    protocol: "http",
                    hostEnvKeys: [],
                    portEnvKeys: ["GATEWAY_PORT"],
                    defaultHost: "127.0.0.1",
                    defaultPort: 3003,
                    healthPath: "/health",
                    enabled: alwaysEnabled,
                },
            ],
        },
        {
            id: "worker-manager",
            name: "worker-manager",
            description: "Supervisor microservice that manages worker processes",
            entry: path.join(
                root,
                "packages",
                "worker-manager",
                "src",
                "worker-manager-server.ts",
            ),
            env: {
                WORKER_MANAGER_HTTP_PORT: env.WORKER_MANAGER_HTTP_PORT ?? env.WORKER_MANAGER_PORT ?? "3012",
                WORKER_MANAGER_HOST: env.WORKER_MANAGER_HOST ?? "127.0.0.1",
            },
            endpoints: [
                {
                    label: "worker-manager-http",
                    protocol: "http",
                    hostEnvKeys: ["WORKER_MANAGER_HOST"],
                    portEnvKeys: ["WORKER_MANAGER_HTTP_PORT", "WORKER_MANAGER_PORT"],
                    defaultHost: "127.0.0.1",
                    defaultPort: 3012,
                    healthPath: "/health",
                    enabled: alwaysEnabled,
                },
            ],
        },
        {
            id: "mcp-service",
            name: "mcp-service",
            description: "Global MCP server for ad hoc and external clients",
            entry: path.join(root, "packages", "mcp", "src", "mcp-server.ts"),
            env: {
                MCP_TRANSPORT: env.MCP_TRANSPORT ?? "sse",
                MCP_HTTP_HOST: env.MCP_HTTP_HOST ?? "127.0.0.1",
                MCP_HTTP_PORT: env.MCP_HTTP_PORT ?? "3100",
                MCP_HTTP_PATH: env.MCP_HTTP_PATH ?? "/mcp",
                TASKS_SERVICE_URL:
                    env.TASKS_SERVICE_URL
                    ?? `${gatewayBaseUrl}/trpc/tasks-service`,
                CONTEXT_SERVICE_URL:
                    env.CONTEXT_SERVICE_URL
                    ?? `${gatewayBaseUrl}/trpc/context-service`,
            },
            endpoints: [
                {
                    label: "mcp-http",
                    protocol: "http",
                    hostEnvKeys: ["MCP_HTTP_HOST", "ISOMORPHIQ_MCP_HTTP_HOST"],
                    portEnvKeys: ["MCP_HTTP_PORT", "ISOMORPHIQ_MCP_HTTP_PORT"],
                    defaultHost: "127.0.0.1",
                    defaultPort: 3100,
                    healthPath: "/health",
                    enabled: alwaysEnabled,
                },
            ],
        },
    ];

    return { root, services };
};

const readFirstDefined = (
    env: NodeJS.ProcessEnv,
    keys: readonly string[],
): string | undefined =>
    keys
        .map((key) => env[key])
        .find((value) => typeof value === "string" && value.trim().length > 0);

export const buildServiceEnvironment = (
    baseEnv: NodeJS.ProcessEnv,
    service: SupervisorServiceConfig,
): NodeJS.ProcessEnv => ({
    ...baseEnv,
    ...Object.fromEntries(
        Object.entries(service.env).filter(([, value]) => typeof value === "string"),
    ),
});

export const resolveServiceEndpoints = (
    service: SupervisorServiceConfig,
    effectiveEnv: NodeJS.ProcessEnv,
): readonly ResolvedSupervisorServiceEndpoint[] =>
    service.endpoints.map((endpoint) => {
        const host = readFirstDefined(effectiveEnv, endpoint.hostEnvKeys) ?? endpoint.defaultHost;
        const portRaw = readFirstDefined(effectiveEnv, endpoint.portEnvKeys);
        const parsedPort = Number.parseInt(portRaw ?? "", 10);
        const port =
            Number.isFinite(parsedPort) && parsedPort > 0
                ? parsedPort
                : endpoint.defaultPort;

        return {
            label: endpoint.label,
            protocol: endpoint.protocol,
            host,
            port,
            healthPath: endpoint.healthPath,
            enabled: endpoint.enabled(effectiveEnv),
        };
    });
