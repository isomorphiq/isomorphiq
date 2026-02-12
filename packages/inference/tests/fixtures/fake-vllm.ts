import http from "node:http";

type ParsedArgs = {
    model: string;
    host: string;
    port: number;
};

const parseArgs = (argv: readonly string[]): ParsedArgs => {
    const args = [...argv];
    const serveIndex = args.findIndex((value) => value === "serve");
    if (serveIndex < 0 || serveIndex + 1 >= args.length) {
        throw new Error("Expected arguments in form: serve <model> --host <host> --port <port>");
    }

    const model = args[serveIndex + 1];
    let host = "127.0.0.1";
    let port = 8000;

    for (let index = serveIndex + 2; index < args.length; index += 1) {
        const value = args[index];
        if (value === "--host") {
            const nextValue = args[index + 1];
            if (nextValue) {
                host = nextValue;
                index += 1;
            }
            continue;
        }
        if (value === "--port") {
            const nextValue = args[index + 1];
            const parsed = Number.parseInt(nextValue ?? "", 10);
            if (Number.isFinite(parsed) && parsed > 0) {
                port = parsed;
                index += 1;
            }
            continue;
        }
    }

    return {
        model,
        host,
        port,
    };
};

const readBody = async (req: http.IncomingMessage): Promise<unknown> => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    if (chunks.length === 0) {
        return {};
    }
    const raw = Buffer.concat(chunks).toString("utf8").trim();
    if (raw.length === 0) {
        return {};
    }
    return JSON.parse(raw);
};

const writeJson = (res: http.ServerResponse, status: number, body: unknown): void => {
    res.writeHead(status, {
        "Content-Type": "application/json",
    });
    res.end(JSON.stringify(body));
};

const toUserMessage = (payload: unknown): string => {
    if (!payload || typeof payload !== "object") {
        return "";
    }
    const messages = (payload as { messages?: unknown }).messages;
    if (!Array.isArray(messages)) {
        return "";
    }
    const firstUser = messages.find((entry) => {
        if (!entry || typeof entry !== "object") {
            return false;
        }
        return (entry as { role?: unknown }).role === "user";
    }) as { content?: unknown } | undefined;
    return typeof firstUser?.content === "string" ? firstUser.content : "";
};

const main = async (): Promise<void> => {
    const { model, host, port } = parseArgs(process.argv.slice(2));

    const server = http.createServer(async (req, res) => {
        const method = req.method ?? "GET";
        const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

        if (method === "GET" && url.pathname === "/v1/models") {
            writeJson(res, 200, {
                object: "list",
                data: [
                    {
                        id: model,
                        object: "model",
                        owned_by: "fake-vllm",
                    },
                ],
            });
            return;
        }

        if (method === "POST" && url.pathname === "/v1/chat/completions") {
            const payload = await readBody(req);
            const prompt = toUserMessage(payload);
            writeJson(res, 200, {
                id: `chatcmpl-${Date.now()}`,
                object: "chat.completion",
                created: Math.floor(Date.now() / 1000),
                model,
                choices: [
                    {
                        index: 0,
                        finish_reason: "stop",
                        message: {
                            role: "assistant",
                            content: `fake-vllm:${model}:${prompt}`,
                        },
                    },
                ],
            });
            return;
        }

        if (method === "POST" && url.pathname === "/v1/completions") {
            const payload = (await readBody(req)) as { prompt?: unknown };
            const prompt = typeof payload.prompt === "string" ? payload.prompt : "";
            writeJson(res, 200, {
                id: `cmpl-${Date.now()}`,
                object: "text_completion",
                created: Math.floor(Date.now() / 1000),
                model,
                choices: [
                    {
                        text: `fake-vllm:${model}:${prompt}`,
                        index: 0,
                        finish_reason: "stop",
                    },
                ],
            });
            return;
        }

        if (method === "POST" && url.pathname === "/v1/embeddings") {
            writeJson(res, 200, {
                object: "list",
                model,
                data: [
                    {
                        object: "embedding",
                        index: 0,
                        embedding: [0.1, 0.2, 0.3],
                    },
                ],
            });
            return;
        }

        if (method === "GET" && url.pathname === "/health") {
            writeJson(res, 200, {
                status: "ok",
                model,
            });
            return;
        }

        writeJson(res, 404, {
            error: "Not found",
        });
    });

    await new Promise<void>((resolve) => {
        server.listen(port, host, () => {
            resolve();
        });
    });

    const shutdown = async (): Promise<void> => {
        await new Promise<void>((resolve) => {
            server.close(() => {
                resolve();
            });
        });
        process.exit(0);
    };

    process.on("SIGTERM", () => {
        void shutdown();
    });
    process.on("SIGINT", () => {
        void shutdown();
    });
};

main().catch((error) => {
    console.error("[FAKE-VLLM] Fatal error:", error);
    process.exit(1);
});
