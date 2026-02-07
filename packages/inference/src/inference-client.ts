import { createTRPCClient, httpLink } from "@trpc/client";
import type { TRPCClient } from "@trpc/client";
import { z } from "zod";
import {
    SupervisionProcessSnapshotSchema,
    type SupervisionProcessSnapshot,
} from "@isomorphiq/core-supervision";
import {
    InferenceServiceHealthSchema,
    LLMServiceRecordSchema,
    type InferenceServiceHealth,
    type LLMServiceLaunchConfig,
    type LLMServiceRecord,
    type TransitionModelCommand,
} from "./inference-domain.ts";

type InferenceServiceRouter = import("./inference-service-router.ts").InferenceServiceRouter;

export type InferenceClientOptions = {
    url?: string;
    headers?: Record<string, string>;
};

export type InferenceClient = {
    health: () => Promise<InferenceServiceHealth>;
    listModels: () => Promise<readonly LLMServiceRecord[]>;
    getModel: (targetId: string) => Promise<LLMServiceRecord | null>;
    serveModel: (config: LLMServiceLaunchConfig) => Promise<LLMServiceRecord>;
    stopModel: (targetId: string, signal?: NodeJS.Signals) => Promise<LLMServiceRecord | null>;
    restartModel: (targetId: string) => Promise<LLMServiceRecord | null>;
    transitionModel: (command: TransitionModelCommand) => Promise<LLMServiceRecord | null>;
    listProcesses: () => Promise<readonly SupervisionProcessSnapshot[]>;
    reconcileProcesses: (
        desiredCount: number,
    ) => Promise<readonly SupervisionProcessSnapshot[]>;
    startModelForTransition: (
        transition: string,
        config: LLMServiceLaunchConfig,
    ) => Promise<LLMServiceRecord>;
    stopModelForTransition: (
        transition: string,
        targetId: string,
        signal?: NodeJS.Signals,
    ) => Promise<LLMServiceRecord | null>;
};

const normalizeTrpcUrl = (url: string): string => {
    if (url.includes("/trpc")) {
        return url;
    }
    return `${url.replace(/\/$/, "")}/trpc`;
};

const resolveBaseUrl = (): string => {
    const direct = process.env.INFERENCE_SERVICE_URL ?? process.env.INFERENCE_HTTP_URL;
    if (direct && direct.trim().length > 0) {
        return direct.trim();
    }
    const host = process.env.INFERENCE_HOST ?? "127.0.0.1";
    const portRaw = process.env.INFERENCE_HTTP_PORT ?? process.env.INFERENCE_PORT ?? "3022";
    const parsedPort = Number.parseInt(portRaw, 10);
    const port = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 3022;
    return `http://${host}:${port}`;
};

const parseModel = (value: unknown): LLMServiceRecord =>
    LLMServiceRecordSchema.parse(value) as LLMServiceRecord;

const parseOptionalModel = (value: unknown): LLMServiceRecord | null => {
    if (value === null || value === undefined) {
        return null;
    }
    return parseModel(value);
};

const ProcessListSchema = z.array(SupervisionProcessSnapshotSchema);

export const createInferenceClient = (
    options: InferenceClientOptions = {},
): InferenceClient => {
    const baseUrl = normalizeTrpcUrl(options.url ?? resolveBaseUrl());

    const client: TRPCClient<InferenceServiceRouter> =
        createTRPCClient<InferenceServiceRouter>({
            links: [
                httpLink({
                    url: baseUrl,
                    headers: options.headers,
                }),
            ],
        });

    return {
        health: async () =>
            InferenceServiceHealthSchema.parse(await client.health.query()) as InferenceServiceHealth,
        listModels: async () =>
            z.array(LLMServiceRecordSchema).parse(await client.listModels.query()) as LLMServiceRecord[],
        getModel: async (targetId) =>
            parseOptionalModel(await client.getModel.query({ targetId })),
        serveModel: async (config) =>
            parseModel(await client.serveModel.mutate({ config })),
        stopModel: async (targetId, signal) =>
            parseOptionalModel(await client.stopModel.mutate({ targetId, signal })),
        restartModel: async (targetId) =>
            parseOptionalModel(await client.restartModel.mutate({ targetId })),
        transitionModel: async (command) =>
            parseOptionalModel(await client.transitionModel.mutate(command)),
        listProcesses: async () =>
            ProcessListSchema.parse(await client.listProcesses.query()),
        reconcileProcesses: async (desiredCount) =>
            ProcessListSchema.parse(
                await client.reconcileProcesses.mutate({ desiredCount }),
            ),
        startModelForTransition: async (transition, config) =>
            parseModel(
                await client.transitionModel.mutate({
                    transition,
                    action: "start",
                    config,
                    targetId: config.id,
                }),
            ),
        stopModelForTransition: async (transition, targetId, signal) =>
            parseOptionalModel(
                await client.transitionModel.mutate({
                    transition,
                    action: "stop",
                    targetId,
                    signal,
                }),
            ),
    };
};
