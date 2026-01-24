import http from "node:http";
import net from "node:net";

const readNumber = (value: string | undefined, fallback: number): number => {
    if (!value) {
        return fallback;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const getGatewayPort = (): number => readNumber(process.env.GATEWAY_PORT, 3003);
const getTargetPort = (): number => readNumber(process.env.DAEMON_HTTP_PORT, 3004);
const getTargetHost = (): string => process.env.DAEMON_HTTP_HOST || "127.0.0.1";

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
    const targetHost = getTargetHost();
    const targetPort = getTargetPort();
    const targetPath = req.url || "/";

    const proxy = http.request(
        {
            host: targetHost,
            port: targetPort,
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
    const targetHost = getTargetHost();
    const targetPort = getTargetPort();
    const targetSocket = net.connect(targetPort, targetHost, () => {
        const requestLine = `${req.method || "GET"} ${req.url || "/"} HTTP/1.1`;
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

export async function startGateway(port: number = getGatewayPort()): Promise<void> {
    const server = http.createServer(proxyHttpRequest);
    server.on("upgrade", proxyUpgradeRequest);

    return await new Promise((resolve, reject) => {
        server.listen(port, () => {
            console.log(
                `[GATEWAY] Proxy listening on ${port} -> ${getTargetHost()}:${getTargetPort()}`,
            );
            resolve();
        });
        server.on("error", (error) => {
            console.error("[GATEWAY] Failed to start proxy:", error);
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
