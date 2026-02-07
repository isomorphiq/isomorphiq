import { z } from "zod";
import { struct } from "@tsimpl/runtime";
import type { StructSelf } from "@tsimpl/runtime";
import {
    SupervisionProcessSnapshotSchema,
    SupervisionProcessStatusSchema,
} from "@isomorphiq/core-supervision";

export const LLMServiceLaunchConfigSchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    model: z.string().min(1),
    host: z.string().default("127.0.0.1"),
    port: z.number().int().positive(),
    launchCommand: z.string().default("vllm"),
    launchCommandArgs: z.array(z.string()).default([]),
    vllmArgs: z.array(z.string()).default([]),
    env: z.record(z.string()).default({}),
    cwd: z.string().optional(),
    startupTimeoutMs: z.number().int().positive().default(45000),
    restartOnFailure: z.boolean().default(true),
    healthcheckPath: z.string().default("/v1/models"),
});
export const LLMServiceLaunchConfigStruct = struct.name("LLMServiceLaunchConfig")<
    z.output<typeof LLMServiceLaunchConfigSchema>,
    z.input<typeof LLMServiceLaunchConfigSchema>
>(LLMServiceLaunchConfigSchema);
export type LLMServiceLaunchConfig = StructSelf<typeof LLMServiceLaunchConfigStruct>;

export const OpenAICompatibleEndpointsSchema = z.object({
    baseUrl: z.string().url(),
    models: z.string().url(),
    chatCompletions: z.string().url(),
    completions: z.string().url(),
    embeddings: z.string().url(),
});
export const OpenAICompatibleEndpointsStruct = struct.name("OpenAICompatibleEndpoints")<
    z.output<typeof OpenAICompatibleEndpointsSchema>,
    z.input<typeof OpenAICompatibleEndpointsSchema>
>(OpenAICompatibleEndpointsSchema);
export type OpenAICompatibleEndpoints = StructSelf<typeof OpenAICompatibleEndpointsStruct>;

export const LLMServiceRecordSchema = SupervisionProcessSnapshotSchema.extend({
    kind: z.literal("service"),
    status: SupervisionProcessStatusSchema,
    model: z.string(),
    host: z.string(),
    port: z.number().int().positive(),
    command: z.string(),
    endpoints: OpenAICompatibleEndpointsSchema,
    restartCount: z.number().int().min(0),
    startupTimeoutMs: z.number().int().positive(),
    restartOnFailure: z.boolean(),
});
export const LLMServiceRecordStruct = struct.name("LLMServiceRecord")<
    z.output<typeof LLMServiceRecordSchema>,
    z.input<typeof LLMServiceRecordSchema>
>(LLMServiceRecordSchema);
export type LLMServiceRecord = StructSelf<typeof LLMServiceRecordStruct>;

export const InferenceServiceHealthSchema = z.object({
    status: z.literal("ok"),
    service: z.literal("inference-service"),
    supervisorId: z.string(),
    pid: z.number().int().positive(),
    models: z.object({
        running: z.number().int().min(0),
        total: z.number().int().min(0),
    }),
});
export const InferenceServiceHealthStruct = struct.name("InferenceServiceHealth")<
    z.output<typeof InferenceServiceHealthSchema>,
    z.input<typeof InferenceServiceHealthSchema>
>(InferenceServiceHealthSchema);
export type InferenceServiceHealth = StructSelf<typeof InferenceServiceHealthStruct>;

export const ServeModelRequestSchema = z.object({
    config: LLMServiceLaunchConfigSchema,
});
export const ServeModelRequestStruct = struct.name("ServeModelRequest")<
    z.output<typeof ServeModelRequestSchema>,
    z.input<typeof ServeModelRequestSchema>
>(ServeModelRequestSchema);
export type ServeModelRequest = StructSelf<typeof ServeModelRequestStruct>;

export const StopModelRequestSchema = z.object({
    targetId: z.string().min(1),
    signal: z.string().optional(),
});
export const StopModelRequestStruct = struct.name("StopModelRequest")<
    z.output<typeof StopModelRequestSchema>,
    z.input<typeof StopModelRequestSchema>
>(StopModelRequestSchema);
export type StopModelRequest = StructSelf<typeof StopModelRequestStruct>;

export const RestartModelRequestSchema = z.object({
    targetId: z.string().min(1),
});
export const RestartModelRequestStruct = struct.name("RestartModelRequest")<
    z.output<typeof RestartModelRequestSchema>,
    z.input<typeof RestartModelRequestSchema>
>(RestartModelRequestSchema);
export type RestartModelRequest = StructSelf<typeof RestartModelRequestStruct>;

export const GetModelRequestSchema = z.object({
    targetId: z.string().min(1),
});
export const GetModelRequestStruct = struct.name("GetModelRequest")<
    z.output<typeof GetModelRequestSchema>,
    z.input<typeof GetModelRequestSchema>
>(GetModelRequestSchema);
export type GetModelRequest = StructSelf<typeof GetModelRequestStruct>;

export const TransitionModelActionSchema = z.enum(["start", "stop", "restart", "noop"]);
export type TransitionModelAction = z.output<typeof TransitionModelActionSchema>;

export const TransitionModelCommandSchema = z.object({
    transition: z.string().min(1),
    action: TransitionModelActionSchema,
    targetId: z.string().optional(),
    signal: z.string().optional(),
    config: LLMServiceLaunchConfigSchema.optional(),
});
export const TransitionModelCommandStruct = struct.name("TransitionModelCommand")<
    z.output<typeof TransitionModelCommandSchema>,
    z.input<typeof TransitionModelCommandSchema>
>(TransitionModelCommandSchema);
export type TransitionModelCommand = StructSelf<typeof TransitionModelCommandStruct>;

export const ModelOperationResponseSchema = z.object({
    ok: z.boolean(),
    model: LLMServiceRecordSchema.nullable().optional(),
    models: z.array(LLMServiceRecordSchema).optional(),
    message: z.string().optional(),
});
export const ModelOperationResponseStruct = struct.name("ModelOperationResponse")<
    z.output<typeof ModelOperationResponseSchema>,
    z.input<typeof ModelOperationResponseSchema>
>(ModelOperationResponseSchema);
export type ModelOperationResponse = StructSelf<typeof ModelOperationResponseStruct>;
