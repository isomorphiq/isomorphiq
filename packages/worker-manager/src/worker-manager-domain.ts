import { z } from "zod";
import { struct } from "@tsimpl/runtime";
import type { StructSelf } from "@tsimpl/runtime";
import { SupervisionProcessSnapshotSchema } from "@isomorphiq/core-supervision";

export const WorkerRecordSchema = SupervisionProcessSnapshotSchema.extend({
    kind: z.literal("worker"),
    port: z.number().int().positive(),
    restartCount: z.number().int().min(0),
});
export const WorkerRecordStruct = struct.name("WorkerRecord")<
    z.output<typeof WorkerRecordSchema>,
    z.input<typeof WorkerRecordSchema>
>(WorkerRecordSchema);
export type WorkerRecord = StructSelf<typeof WorkerRecordStruct>;

export const WorkerManagerHealthSchema = z.object({
    status: z.literal("ok"),
    service: z.literal("worker-manager"),
    managerId: z.string(),
    pid: z.number().int().positive(),
    workers: z.object({
        running: z.number().int().min(0),
        total: z.number().int().min(0),
    }),
});
export const WorkerManagerHealthStruct = struct.name("WorkerManagerHealth")<
    z.output<typeof WorkerManagerHealthSchema>,
    z.input<typeof WorkerManagerHealthSchema>
>(WorkerManagerHealthSchema);
export type WorkerManagerHealth = StructSelf<typeof WorkerManagerHealthStruct>;

export const WorkerListResponseSchema = z.object({
    workers: z.array(WorkerRecordSchema),
});
export const WorkerListResponseStruct = struct.name("WorkerListResponse")<
    z.output<typeof WorkerListResponseSchema>,
    z.input<typeof WorkerListResponseSchema>
>(WorkerListResponseSchema);
export type WorkerListResponse = StructSelf<typeof WorkerListResponseStruct>;

export const WorkerStartRequestSchema = z.object({
    workerId: z.string().optional(),
    port: z.number().int().positive().optional(),
});
export const WorkerStartRequestStruct = struct.name("WorkerStartRequest")<
    z.output<typeof WorkerStartRequestSchema>,
    z.input<typeof WorkerStartRequestSchema>
>(WorkerStartRequestSchema);
export type WorkerStartRequest = StructSelf<typeof WorkerStartRequestStruct>;

export const WorkerStopRequestSchema = z.object({
    signal: z.string().optional(),
});
export const WorkerStopRequestStruct = struct.name("WorkerStopRequest")<
    z.output<typeof WorkerStopRequestSchema>,
    z.input<typeof WorkerStopRequestSchema>
>(WorkerStopRequestSchema);
export type WorkerStopRequest = StructSelf<typeof WorkerStopRequestStruct>;

export const WorkerReconcileRequestSchema = z.object({
    desiredCount: z.number().int().min(0),
});
export const WorkerReconcileRequestStruct = struct.name("WorkerReconcileRequest")<
    z.output<typeof WorkerReconcileRequestSchema>,
    z.input<typeof WorkerReconcileRequestSchema>
>(WorkerReconcileRequestSchema);
export type WorkerReconcileRequest = StructSelf<typeof WorkerReconcileRequestStruct>;

export const WorkerOperationResponseSchema = z.object({
    ok: z.boolean(),
    worker: WorkerRecordSchema.optional(),
    workers: z.array(WorkerRecordSchema).optional(),
    message: z.string().optional(),
});
export const WorkerOperationResponseStruct = struct.name("WorkerOperationResponse")<
    z.output<typeof WorkerOperationResponseSchema>,
    z.input<typeof WorkerOperationResponseSchema>
>(WorkerOperationResponseSchema);
export type WorkerOperationResponse = StructSelf<typeof WorkerOperationResponseStruct>;
