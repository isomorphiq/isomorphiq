import { z } from "zod";
import { struct } from "@tsimpl/runtime";
import type { StructSelf } from "@tsimpl/runtime";

export const MicroserviceKindSchema = z.enum([
    "http",
    "trpc",
    "worker-manager",
]);
export type MicroserviceKind = z.output<typeof MicroserviceKindSchema>;

export const MicroserviceLifecycleStatusSchema = z.enum([
    "starting",
    "running",
    "stopping",
    "stopped",
    "error",
]);
export type MicroserviceLifecycleStatus = z.output<typeof MicroserviceLifecycleStatusSchema>;

export const MicroserviceHealthSnapshotSchema = z.object({
    id: z.string(),
    name: z.string(),
    kind: MicroserviceKindSchema,
    status: MicroserviceLifecycleStatusSchema,
    host: z.string(),
    port: z.number().int().positive(),
    endpoint: z.string(),
    startedAt: z.string().datetime().optional(),
    updatedAt: z.string().datetime(),
    uptimeMs: z.number().int().min(0),
    pid: z.number().int().positive(),
    metadata: z.record(z.unknown()).optional(),
});
export const MicroserviceHealthSnapshotStruct = struct.name("MicroserviceHealthSnapshot")<
    z.output<typeof MicroserviceHealthSnapshotSchema>,
    z.input<typeof MicroserviceHealthSnapshotSchema>
>(MicroserviceHealthSnapshotSchema);
export type MicroserviceHealthSnapshot = StructSelf<typeof MicroserviceHealthSnapshotStruct>;

export const HttpMicroserviceStartOptionsSchema = z.object({
    id: z.string(),
    name: z.string(),
    host: z.string(),
    port: z.number().int().positive(),
    kind: MicroserviceKindSchema.default("http"),
});
export const HttpMicroserviceStartOptionsStruct = struct.name("HttpMicroserviceStartOptions")<
    z.output<typeof HttpMicroserviceStartOptionsSchema>,
    z.input<typeof HttpMicroserviceStartOptionsSchema>
>(HttpMicroserviceStartOptionsSchema);
export type HttpMicroserviceStartOptions = StructSelf<
    typeof HttpMicroserviceStartOptionsStruct
>;
