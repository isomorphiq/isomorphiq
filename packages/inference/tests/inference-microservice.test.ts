import assert from "node:assert/strict";
import net from "node:net";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import {
    createInferenceClient,
    startInferenceServiceServer,
    type InferenceServiceServerHandle,
} from "../src/index.ts";

const resolveFreePort = async (): Promise<number> =>
    await new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            if (!address || typeof address === "string") {
                reject(new Error("Failed to resolve free port"));
                return;
            }
            const { port } = address;
            server.close((error) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve(port);
            });
        });
    });

const canBindTcpSocket = async (): Promise<boolean> => {
    try {
        const server = net.createServer();
        await new Promise<void>((resolve, reject) => {
            server.once("error", reject);
            server.listen(0, "127.0.0.1", () => {
                resolve();
            });
        });
        await new Promise<void>((resolve, reject) => {
            server.close((error) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve();
            });
        });
        return true;
    } catch (error) {
        const record = error as NodeJS.ErrnoException;
        if (record.code === "EPERM" || record.code === "EACCES") {
            return false;
        }
        throw error;
    }
};

test("inference microservice starts, serves model, exposes openai endpoints, and performs inference", {
    timeout: 45000,
}, async (t) => {
    const canBind = await canBindTcpSocket();
    if (!canBind) {
        t.skip("Socket binding is not permitted in this runtime environment");
        return;
    }

    const servicePort = await resolveFreePort();
    const modelPort = await resolveFreePort();

    let handle: InferenceServiceServerHandle | null = null;

    try {
        handle = await startInferenceServiceServer({
            host: "127.0.0.1",
            port: servicePort,
        });

        const client = createInferenceClient({
            url: handle.trpcUrl,
        });

        const health = await client.health();
        assert.equal(health.status, "ok");
        assert.equal(health.models.total, 0);

        const fixturePath = path.resolve(
            path.dirname(fileURLToPath(import.meta.url)),
            "./fixtures/fake-vllm.ts",
        );

        const startedModel = await client.startModelForTransition("transition:execute", {
            id: "llm-coder",
            name: "LLM Coder",
            model: "fake/coder-model",
            host: "127.0.0.1",
            port: modelPort,
            launchCommand: "node",
            launchCommandArgs: ["--experimental-strip-types", fixturePath],
            vllmArgs: [],
            startupTimeoutMs: 15000,
            healthcheckPath: "/v1/models",
            restartOnFailure: true,
            env: {},
        });

        assert.equal(startedModel.id, "llm-coder");
        assert.equal(startedModel.status, "running");
        assert.equal(startedModel.port, modelPort);
        assert.equal(startedModel.model, "fake/coder-model");

        const fetchedModel = await client.getModel("llm-coder");
        assert.ok(fetchedModel);
        assert.equal(fetchedModel?.endpoints.baseUrl, `http://127.0.0.1:${modelPort}`);

        const modelsResponse = await fetch(fetchedModel?.endpoints.models ?? "");
        assert.equal(modelsResponse.status, 200);
        const modelsBody = await modelsResponse.json();
        assert.equal(modelsBody?.data?.[0]?.id, "fake/coder-model");

        const chatResponse = await fetch(fetchedModel?.endpoints.chatCompletions ?? "", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: "fake/coder-model",
                messages: [
                    {
                        role: "user",
                        content: "say hi",
                    },
                ],
            }),
        });
        assert.equal(chatResponse.status, 200);
        const chatBody = await chatResponse.json();
        assert.equal(chatBody?.model, "fake/coder-model");
        assert.match(
            String(chatBody?.choices?.[0]?.message?.content ?? ""),
            /^fake-vllm:fake\/coder-model:say hi$/,
        );

        const stoppedModel = await client.stopModelForTransition(
            "transition:teardown",
            "llm-coder",
        );
        assert.ok(stoppedModel);
        assert.equal(stoppedModel?.status, "stopped");
    } finally {
        if (handle) {
            await handle.stop("SIGTERM");
        }
    }
});
