import { z } from "zod";
import { struct } from "@tsimpl/runtime";
import type { StructSelf } from "@tsimpl/runtime";

export const ContextDataSchema = z.record(z.unknown());
export type ContextData = z.output<typeof ContextDataSchema>;

const DateSchema = z.preprocess((value) => {
    if (value instanceof Date) {
        return value;
    }
    if (typeof value === "string" || typeof value === "number") {
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) {
            return parsed;
        }
    }
    return value;
}, z.date());

export const ContextRecordSchema = z.object({
    id: z.string(),
    data: ContextDataSchema,
    createdAt: DateSchema,
    updatedAt: DateSchema,
});

export const ContextRecordStruct = struct.name("ContextRecord")<
    z.output<typeof ContextRecordSchema>,
    z.input<typeof ContextRecordSchema>
>(ContextRecordSchema);
export type ContextRecord = StructSelf<typeof ContextRecordStruct>;

export const CreateContextInputSchema = z.object({
    id: z.string().optional(),
    data: ContextDataSchema.optional(),
});

export const CreateContextInputStruct = struct.name("CreateContextInput")<
    z.output<typeof CreateContextInputSchema>,
    z.input<typeof CreateContextInputSchema>
>(CreateContextInputSchema);
export type CreateContextInput = StructSelf<typeof CreateContextInputStruct>;

export const UpdateContextInputSchema = z.object({
    id: z.string(),
    patch: ContextDataSchema,
});

export const UpdateContextInputStruct = struct.name("UpdateContextInput")<
    z.output<typeof UpdateContextInputSchema>,
    z.input<typeof UpdateContextInputSchema>
>(UpdateContextInputSchema);
export type UpdateContextInput = StructSelf<typeof UpdateContextInputStruct>;

export const ReplaceContextInputSchema = z.object({
    id: z.string(),
    data: ContextDataSchema,
});

export const ReplaceContextInputStruct = struct.name("ReplaceContextInput")<
    z.output<typeof ReplaceContextInputSchema>,
    z.input<typeof ReplaceContextInputSchema>
>(ReplaceContextInputSchema);
export type ReplaceContextInput = StructSelf<typeof ReplaceContextInputStruct>;

export const FileContextLookupInputSchema = z.object({
    filePath: z.string().min(1),
    contextId: z.string().optional(),
    operation: z.string().optional(),
    taskId: z.string().optional(),
    taskTitle: z.string().optional(),
    reason: z.string().optional(),
    relatedFiles: z.array(z.string()).optional(),
    todos: z.array(z.string()).optional(),
});

export const FileContextLookupInputStruct = struct.name("FileContextLookupInput")<
    z.output<typeof FileContextLookupInputSchema>,
    z.input<typeof FileContextLookupInputSchema>
>(FileContextLookupInputSchema);
export type FileContextLookupInput = StructSelf<typeof FileContextLookupInputStruct>;
