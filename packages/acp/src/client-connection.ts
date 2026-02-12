import { z } from "zod";
import {
    AGENT_METHODS,
    CLIENT_METHODS,
    RequestError,
} from "@agentclientprotocol/sdk";
import type { Client } from "@agentclientprotocol/sdk";
import type { AnyMessage } from "@agentclientprotocol/sdk";
import type { Stream } from "@agentclientprotocol/sdk";
import * as validate from "@agentclientprotocol/sdk/dist/schema/zod.gen.js";

type RequestHandler = (method: string, params: unknown) => Promise<unknown>;
type NotificationHandler = (method: string, params: unknown) => Promise<void>;
type ResponsePayload =
    | { result: unknown }
    | { error: { code: number; message: string; data?: unknown } };

class Connection {
    #pendingResponses = new Map<number, { resolve: (value: unknown) => void; reject: (error: unknown) => void }>();
    #nextRequestId = 0;
    #requestHandler: RequestHandler;
    #notificationHandler: NotificationHandler;
    #stream: Stream;
    #writeQueue = Promise.resolve();
    #abortController = new AbortController();
    #closedPromise: Promise<void>;

    constructor(
        requestHandler: RequestHandler,
        notificationHandler: NotificationHandler,
        stream: Stream,
    ) {
        this.#requestHandler = requestHandler;
        this.#notificationHandler = notificationHandler;
        this.#stream = stream;
        this.#closedPromise = new Promise((resolve) => {
            this.#abortController.signal.addEventListener("abort", () => resolve());
        });
        void this.#receive();
    }

    get signal(): AbortSignal {
        return this.#abortController.signal;
    }

    get closed(): Promise<void> {
        return this.#closedPromise;
    }

    async close(): Promise<void> {
        this.#abortController.abort();
        try {
            await this.#stream.readable.cancel();
        } catch (_error) {
            // ignore
        }
        try {
            const writer = this.#stream.writable.getWriter();
            await writer.close();
            writer.releaseLock();
        } catch (_error) {
            // ignore
        }
    }

    async #receive(): Promise<void> {
        const reader = this.#stream.readable.getReader();
        try {
            while (true) {
                const { value: message, done } = await reader.read();
                if (done) {
                    break;
                }
                if (!message) {
                    continue;
                }
                try {
                    await this.#processMessage(message as Record<string, unknown>);
                } catch (err) {
                    console.error("Unexpected error during message processing:", message, err);
                    if ("id" in message && message.id !== undefined) {
                        await this.#sendMessage({
                            jsonrpc: "2.0",
                            id: message.id,
                            error: {
                                code: -32700,
                                message: "Parse error",
                            },
                        });
                    }
                }
            }
        } finally {
            reader.releaseLock();
            this.#abortController.abort();
        }
    }

    async #processMessage(message: Record<string, unknown>): Promise<void> {
        if ("method" in message && "id" in message) {
            const response = await this.#tryCallRequestHandler(
                message.method as string,
                message.params,
            );
            if ("error" in response) {
                console.error("Error handling request", message, response.error);
            }
            const responseId =
                typeof message.id === "number" || typeof message.id === "string" ? message.id : null;
            const responseMessage: AnyMessage =
                "error" in response
                    ? { jsonrpc: "2.0", id: responseId, error: response.error }
                    : { jsonrpc: "2.0", id: responseId, result: response.result };
            await this.#sendMessage(responseMessage);
            return;
        }

        if ("method" in message) {
            const response = await this.#tryCallNotificationHandler(
                message.method as string,
                message.params,
            );
            if ("error" in response) {
                console.error("Error handling notification", message, response.error);
            }
            return;
        }

        if ("id" in message) {
            this.#handleResponse(message);
            return;
        }

        console.error("Invalid message", { message });
    }

    async #tryCallRequestHandler(method: string, params: unknown): Promise<ResponsePayload> {
        try {
            const result = await this.#requestHandler(method, params);
            return { result: result ?? null };
        } catch (error) {
            if (error instanceof RequestError) {
                return error.toResult();
            }
            if (error instanceof z.ZodError) {
                return RequestError.invalidParams(error.format()).toResult();
            }
            let details: string | undefined;
            if (error instanceof Error) {
                details = error.message;
            } else if (
                typeof error === "object"
                && error != null
                && "message" in error
                && typeof (error as { message?: unknown }).message === "string"
            ) {
                details = (error as { message: string }).message;
            }
            try {
                return RequestError.internalError(details ? JSON.parse(details) : {}).toResult();
            } catch {
                return RequestError.internalError({ details }).toResult();
            }
        }
    }

    async #tryCallNotificationHandler(
        method: string,
        params: unknown,
    ): Promise<ResponsePayload> {
        try {
            await this.#notificationHandler(method, params);
            return { result: null };
        } catch (error) {
            if (error instanceof RequestError) {
                return error.toResult();
            }
            if (error instanceof z.ZodError) {
                return RequestError.invalidParams(error.format()).toResult();
            }
            let details: string | undefined;
            if (error instanceof Error) {
                details = error.message;
            } else if (
                typeof error === "object"
                && error != null
                && "message" in error
                && typeof (error as { message?: unknown }).message === "string"
            ) {
                details = (error as { message: string }).message;
            }
            try {
                return RequestError.internalError(details ? JSON.parse(details) : {}).toResult();
            } catch {
                return RequestError.internalError({ details }).toResult();
            }
        }
    }

    #handleResponse(response: Record<string, unknown>): void {
        const id = response.id as number | undefined;
        const pending = id !== undefined ? this.#pendingResponses.get(id) : undefined;
        if (!pending) {
            console.error("Got response to unknown request", response.id);
            return;
        }
        this.#pendingResponses.delete(id as number);
        if ("error" in response) {
            pending.reject(response.error);
        } else {
            pending.resolve(response.result);
        }
    }

    async sendRequest(method: string, params: unknown): Promise<unknown> {
        const id = this.#nextRequestId++;
        const responsePromise = new Promise<unknown>((resolve, reject) => {
            this.#pendingResponses.set(id, { resolve, reject });
        });
        await this.#sendMessage({ jsonrpc: "2.0", id, method, params });
        return responsePromise;
    }

    async sendNotification(method: string, params: unknown): Promise<void> {
        await this.#sendMessage({ jsonrpc: "2.0", method, params });
    }

    async #sendMessage(message: AnyMessage): Promise<void> {
        this.#writeQueue = this.#writeQueue
            .then(async () => {
                const writer = this.#stream.writable.getWriter();
                try {
                    await writer.write(message);
                } finally {
                    writer.releaseLock();
                }
            })
            .catch((error) => {
                console.error("ACP write error:", error);
            });
        await this.#writeQueue;
    }
}

export class ClientSideConnection {
    #connection: Connection;

    constructor(
        toClient: (connection: ClientSideConnection) => Client,
        stream: Stream,
    ) {
        const client = toClient(this);
        const requestHandler = async (method: string, params: unknown): Promise<unknown> => {
            switch (method) {
                case CLIENT_METHODS.fs_write_text_file: {
                    const validatedParams = validate.zWriteTextFileRequest.parse(params);
                    return client.writeTextFile?.(validatedParams);
                }
                case CLIENT_METHODS.fs_read_text_file: {
                    const validatedParams = validate.zReadTextFileRequest.parse(params);
                    return client.readTextFile?.(validatedParams);
                }
                case CLIENT_METHODS.session_request_permission: {
                    const validatedParams = validate.zRequestPermissionRequest.parse(params);
                    return client.requestPermission(validatedParams);
                }
                case CLIENT_METHODS.terminal_create: {
                    const validatedParams = validate.zCreateTerminalRequest.parse(params);
                    return client.createTerminal?.(validatedParams);
                }
                case CLIENT_METHODS.terminal_output: {
                    const validatedParams = validate.zTerminalOutputRequest.parse(params);
                    return client.terminalOutput?.(validatedParams);
                }
                case CLIENT_METHODS.terminal_release: {
                    const validatedParams = validate.zReleaseTerminalRequest.parse(params);
                    const result = await client.releaseTerminal?.(validatedParams);
                    return result ?? {};
                }
                case CLIENT_METHODS.terminal_wait_for_exit: {
                    const validatedParams = validate.zWaitForTerminalExitRequest.parse(params);
                    return client.waitForTerminalExit?.(validatedParams);
                }
                case CLIENT_METHODS.terminal_kill: {
                    const validatedParams = validate.zKillTerminalCommandRequest.parse(params);
                    const result = await client.killTerminal?.(validatedParams);
                    return result ?? {};
                }
                default:
                    if (method.startsWith("_")) {
                        const customMethod = method.substring(1);
                        if (!client.extMethod) {
                            throw RequestError.methodNotFound(method);
                        }
                        return client.extMethod(customMethod, params as Record<string, unknown>);
                    }
                    throw RequestError.methodNotFound(method);
            }
        };

        const notificationHandler = async (method: string, params: unknown): Promise<void> => {
            switch (method) {
                case CLIENT_METHODS.session_update: {
                    // Accept any session update payload to avoid strict union mismatches
                    return client.sessionUpdate(params as Record<string, unknown>);
                }
                default:
                    if (method.startsWith("_")) {
                        const customMethod = method.substring(1);
                        if (!client.extNotification) {
                            return;
                        }
                        return client.extNotification(customMethod, params as Record<string, unknown>);
                    }
                    throw RequestError.methodNotFound(method);
            }
        };

        this.#connection = new Connection(requestHandler, notificationHandler, stream);
    }

    get signal(): AbortSignal {
        return this.#connection.signal;
    }

    get closed(): Promise<void> {
        return this.#connection.closed;
    }

    async close(): Promise<void> {
        await this.#connection.close();
    }

    async initialize(params: Record<string, unknown>): Promise<Record<string, unknown>> {
        return (await this.#connection.sendRequest(AGENT_METHODS.initialize, params)) as Record<
            string,
            unknown
        >;
    }

    async newSession(params: Record<string, unknown>): Promise<Record<string, unknown>> {
        return (await this.#connection.sendRequest(AGENT_METHODS.session_new, params)) as Record<
            string,
            unknown
        >;
    }

    async loadSession(params: Record<string, unknown>): Promise<Record<string, unknown>> {
        return ((await this.#connection.sendRequest(AGENT_METHODS.session_load, params)) ??
            {}) as Record<string, unknown>;
    }

    async setSessionMode(params: Record<string, unknown>): Promise<Record<string, unknown>> {
        return ((await this.#connection.sendRequest(AGENT_METHODS.session_set_mode, params)) ??
            {}) as Record<string, unknown>;
    }

    async setSessionModel(params: Record<string, unknown>): Promise<Record<string, unknown>> {
        return ((await this.#connection.sendRequest(AGENT_METHODS.session_set_model, params)) ??
            {}) as Record<string, unknown>;
    }

    async authenticate(params: Record<string, unknown>): Promise<Record<string, unknown>> {
        return ((await this.#connection.sendRequest(AGENT_METHODS.authenticate, params)) ??
            {}) as Record<string, unknown>;
    }

    async prompt(params: Record<string, unknown>): Promise<Record<string, unknown>> {
        return (await this.#connection.sendRequest(AGENT_METHODS.session_prompt, params)) as Record<
            string,
            unknown
        >;
    }
}
