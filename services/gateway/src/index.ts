import http from "node:http";
import net from "node:net";
import { ConfigManager, resolveEnvironmentFromHeaders } from "@isomorphiq/core";
import { createTaskClient } from "@isomorphiq/tasks";

const readNumber = (value: string | undefined, fallback: number): number => {
    if (!value) {
        return fallback;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const getGatewayPort = (): number => readNumber(process.env.GATEWAY_PORT, 3003);
const getDaemonPort = (): number => readNumber(process.env.DAEMON_HTTP_PORT, 3004);
const getDaemonHost = (): string => process.env.DAEMON_HTTP_HOST || "127.0.0.1";
const getTasksPort = (): number => readNumber(process.env.TASKS_HTTP_PORT ?? process.env.TASKS_PORT, 3006);
const getTasksHost = (): string => process.env.TASKS_HOST || "127.0.0.1";
const getSearchPort = (): number => readNumber(process.env.SEARCH_HTTP_PORT ?? process.env.SEARCH_PORT, 3007);
const getSearchHost = (): string => process.env.SEARCH_HOST || "127.0.0.1";
const getContextPort = (): number => readNumber(process.env.CONTEXT_HTTP_PORT ?? process.env.CONTEXT_PORT, 3008);
const getContextHost = (): string => process.env.CONTEXT_HOST || "127.0.0.1";

const resolveTarget = (req: http.IncomingMessage): { host: string; port: number; path: string } => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (url.pathname.startsWith("/trpc/search")) {
        const suffix = url.pathname.slice("/trpc/search".length);
        const path = `/trpc${suffix}${url.search}`;
        return { host: getSearchHost(), port: getSearchPort(), path };
    }
    if (url.pathname.startsWith("/trpc/context-service")) {
        const suffix = url.pathname.slice("/trpc/context-service".length);
        const path = `/trpc${suffix}${url.search}`;
        return { host: getContextHost(), port: getContextPort(), path };
    }
    if (url.pathname.startsWith("/trpc/tasks-service")) {
        const suffix = url.pathname.slice("/trpc/tasks-service".length);
        const path = `/trpc${suffix}${url.search}`;
        return { host: getTasksHost(), port: getTasksPort(), path };
    }
    if (url.pathname.startsWith("/trpc")) {
        return { host: getDaemonHost(), port: getDaemonPort(), path: req.url ?? "/" };
    }
    return { host: getDaemonHost(), port: getDaemonPort(), path: req.url ?? "/" };
};

const formatUpgradeHeaders = (headers: http.IncomingHttpHeaders): string[] => {
    const lines: string[] = [];
    for (const [key, value] of Object.entries(headers)) {
        if (typeof value === "undefined") {
            continue;
        }
        if (Array.isArray(value)) {
            for (const entry of value) {
                lines.push(`${key}: ${entry}`);
            }
        } else {
            lines.push(`${key}: ${value}`);
        }
    }
    return lines;
};

const proxyHttpRequest = (req: http.IncomingMessage, res: http.ServerResponse): void => {
    const target = resolveTarget(req);
    const targetPath = target.path;

    const proxy = http.request(
        {
            host: target.host,
            port: target.port,
            method: req.method,
            path: targetPath,
            headers: req.headers,
        },
        (proxyRes) => {
            res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
            proxyRes.pipe(res);
        },
    );

    proxy.on("error", (error) => {
        console.error("[GATEWAY] Proxy request failed:", error);
        if (!res.headersSent) {
            res.writeHead(502);
        }
        res.end("Bad gateway");
    });

    req.pipe(proxy);
};

const proxyUpgradeRequest = (
    req: http.IncomingMessage,
    clientSocket: net.Socket,
    head: Buffer,
): void => {
    const target = resolveTarget(req);
    const targetSocket = net.connect(target.port, target.host, () => {
        const requestLine = `${req.method || "GET"} ${target.path} HTTP/1.1`;
        const headerLines = formatUpgradeHeaders(req.headers);
        const headersBlock = [requestLine, ...headerLines, "", ""].join("\r\n");
        targetSocket.write(headersBlock);
        if (head.length > 0) {
            targetSocket.write(head);
        }
        clientSocket.pipe(targetSocket).pipe(clientSocket);
    });

    targetSocket.on("error", (error) => {
        console.error("[GATEWAY] Proxy upgrade failed:", error);
        clientSocket.destroy();
    });

    clientSocket.on("error", () => {
        targetSocket.destroy();
    });
};

const handleGatewaySummary = async (
    req: http.IncomingMessage,
    res: http.ServerResponse,
): Promise<void> => {
    const environment = resolveEnvironmentFromHeaders(
        req.headers,
        ConfigManager.getInstance().getEnvironmentConfig(),
    );
    const client = createTaskClient({
        environment,
        enableSubscriptions: false,
    });

    try {
        const tasks = await client.listTasks();
        const daemonHealthResponse = await fetch(
            `http://${getDaemonHost()}:${getDaemonPort()}/api/health`,
        ).catch(() => null);
        const daemonHealth = daemonHealthResponse
            ? await daemonHealthResponse.json().catch(() => null)
            : null;

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
            JSON.stringify({
                gateway: "ok",
                environment,
                tasks: {
                    total: tasks.length,
                },
                daemon: daemonHealth,
                timestamp: new Date().toISOString(),
            }),
        );
    } catch (error) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
            JSON.stringify({
                error: error instanceof Error ? error.message : "Unknown error",
            }),
        );
    } finally {
        await client.close();
    }
};

export async function startGateway(port: number = getGatewayPort()): Promise<void> {
    const server = http.createServer((req, res) => {
        const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
        if (url.pathname === "/api/gateway/summary") {
            void handleGatewaySummary(req, res);
            return;
        }
        proxyHttpRequest(req, res);
    });
    server.on("upgrade", proxyUpgradeRequest);

    return await new Promise((resolve, reject) => {
        server.listen(port, () => {
            console.log(
                `[GATEWAY] Gateway listening on ${port} (tasks: ${getTasksHost()}:${getTasksPort()}, search: ${getSearchHost()}:${getSearchPort()}, context: ${getContextHost()}:${getContextPort()}, daemon: ${getDaemonHost()}:${getDaemonPort()})`,
            );
            resolve();
        });
        server.on("error", (error) => {
            console.error("[GATEWAY] Failed to start gateway:", error);
            reject(error);
        });
    });
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
    startGateway().catch((err) => {
        console.error("[GATEWAY] Failed to start:", err);
        process.exit(1);
    });
}
