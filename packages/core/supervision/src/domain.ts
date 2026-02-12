import { z } from "zod";
import { struct } from "@tsimpl/runtime";
import type { StructSelf } from "@tsimpl/runtime";

export const SupervisionProcessKindSchema = z.enum([
    "supervisor",
    "worker",
    "service",
]);
export type SupervisionProcessKind = z.output<typeof SupervisionProcessKindSchema>;

export const SupervisionProcessStatusSchema = z.enum([
    "starting",
    "running",
    "stopping",
    "stopped",
    "error",
    "unknown",
]);
export type SupervisionProcessStatus = z.output<typeof SupervisionProcessStatusSchema>;

export const SupervisionProcessSnapshotSchema = z.object({
    id: z.string(),
    name: z.string(),
    kind: SupervisionProcessKindSchema,
    status: SupervisionProcessStatusSchema,
    pid: z.number().int().positive().optional(),
    managedBy: z.string().optional(),
    startedAt: z.string().datetime().optional(),
    updatedAt: z.string().datetime(),
    metadata: z.record(z.unknown()).optional(),
});
export const SupervisionProcessSnapshotStruct = struct.name("SupervisionProcessSnapshot")<
    z.output<typeof SupervisionProcessSnapshotSchema>,
    z.input<typeof SupervisionProcessSnapshotSchema>
>(SupervisionProcessSnapshotSchema);
export type SupervisionProcessSnapshot = StructSelf<typeof SupervisionProcessSnapshotStruct>;

export const SupervisionStartRequestSchema = z.object({
    targetId: z.string(),
});
export const SupervisionStartRequestStruct = struct.name("SupervisionStartRequest")<
    z.output<typeof SupervisionStartRequestSchema>,
    z.input<typeof SupervisionStartRequestSchema>
>(SupervisionStartRequestSchema);
export type SupervisionStartRequest = StructSelf<typeof SupervisionStartRequestStruct>;

export const SupervisionStopRequestSchema = z.object({
    targetId: z.string(),
    signal: z.string().optional(),
});
export const SupervisionStopRequestStruct = struct.name("SupervisionStopRequest")<
    z.output<typeof SupervisionStopRequestSchema>,
    z.input<typeof SupervisionStopRequestSchema>
>(SupervisionStopRequestSchema);
export type SupervisionStopRequest = StructSelf<typeof SupervisionStopRequestStruct>;

export const SupervisionReconcileRequestSchema = z.object({
    desiredCount: z.number().int().min(0),
});
export const SupervisionReconcileRequestStruct = struct.name("SupervisionReconcileRequest")<
    z.output<typeof SupervisionReconcileRequestSchema>,
    z.input<typeof SupervisionReconcileRequestSchema>
>(SupervisionReconcileRequestSchema);
export type SupervisionReconcileRequest = StructSelf<typeof SupervisionReconcileRequestStruct>;
