import { z } from "zod";
import { impl, method, struct, trait } from "@tsimpl/runtime";
import type { StructSelf } from "@tsimpl/runtime";
import type { Self } from "@tsimpl/core";

export const SessionScopedTrait = trait({
    sessionId: method<Self, string>(),
});

export const AcpClientConfigSchema = z.object({
    protocolVersion: z.number(),
    clientInfo: z.object({
        name: z.string(),
        version: z.string(),
    }),
});

export const AcpClientConfigStruct = struct.name("AcpClientConfig")<z.output<typeof AcpClientConfigSchema>, z.input<typeof AcpClientConfigSchema>>(AcpClientConfigSchema);
export type AcpClientConfig = StructSelf<typeof AcpClientConfigStruct>;

export const McpServerConfigSchema = z.object({
    name: z.string(),
    command: z.string(),
    args: z.array(z.string()).optional(),
});

export const McpServerConfigStruct = struct.name("McpServerConfig")<z.output<typeof McpServerConfigSchema>, z.input<typeof McpServerConfigSchema>>(McpServerConfigSchema);
export type McpServerConfig = StructSelf<typeof McpServerConfigStruct>;

export const SessionConfigSchema = z.object({
    cwd: z.string(),
    mcpServers: z.array(McpServerConfigSchema),
});

export const SessionConfigStruct = struct.name("SessionConfig")<z.output<typeof SessionConfigSchema>, z.input<typeof SessionConfigSchema>>(SessionConfigSchema);
export type SessionConfig = StructSelf<typeof SessionConfigStruct>;

export const PromptMessageSchema = z.object({
    type: z.literal("text"),
    text: z.string(),
});

export const PromptMessageStruct = struct.name("PromptMessage")<z.output<typeof PromptMessageSchema>, z.input<typeof PromptMessageSchema>>(PromptMessageSchema);
export type PromptMessage = StructSelf<typeof PromptMessageStruct>;

export const PromptInputSchema = z.object({
    sessionId: z.string(),
    prompt: z.array(PromptMessageSchema),
});

export const PromptInputStruct = struct.name("PromptInput")<z.output<typeof PromptInputSchema>, z.input<typeof PromptInputSchema>>(PromptInputSchema);
export type PromptInput = StructSelf<typeof PromptInputStruct>;

export const PermissionRequestSchema = z.object({
    permission: z.string(),
    context: z.record(z.unknown()).optional(),
});

export const PermissionRequestStruct = struct.name("PermissionRequest")<z.output<typeof PermissionRequestSchema>, z.input<typeof PermissionRequestSchema>>(PermissionRequestSchema);
export type PermissionRequest = StructSelf<typeof PermissionRequestStruct>;

export const PermissionResponseSchema = z.object({
    outcome: z.enum(["approved", "denied"]),
    reason: z.string().optional(),
});

export const PermissionResponseStruct = struct.name("PermissionResponse")<z.output<typeof PermissionResponseSchema>, z.input<typeof PermissionResponseSchema>>(PermissionResponseSchema);
export type PermissionResponse = StructSelf<typeof PermissionResponseStruct>;

export const SessionUpdateParamsSchema = z.object({
    sessionId: z.string(),
    updates: z.record(z.unknown()).optional(),
    update: z.record(z.unknown()).optional(),
});

export const SessionUpdateParamsStruct = struct.name("SessionUpdateParams")<z.output<typeof SessionUpdateParamsSchema>, z.input<typeof SessionUpdateParamsSchema>>(SessionUpdateParamsSchema);
export type SessionUpdateParams = StructSelf<typeof SessionUpdateParamsStruct>;

export const WriteTextFileParamsSchema = z.object({
    path: z.string(),
    content: z.string(),
    encoding: z.enum(["utf8", "base64"]).optional(),
});

export const WriteTextFileParamsStruct = struct.name("WriteTextFileParams")<z.output<typeof WriteTextFileParamsSchema>, z.input<typeof WriteTextFileParamsSchema>>(WriteTextFileParamsSchema);
export type WriteTextFileParams = StructSelf<typeof WriteTextFileParamsStruct>;

export const WriteTextFileResultSchema = z.object({
    success: z.boolean(),
    path: z.string(),
});

export const WriteTextFileResultStruct = struct.name("WriteTextFileResult")<z.output<typeof WriteTextFileResultSchema>, z.input<typeof WriteTextFileResultSchema>>(WriteTextFileResultSchema);
export type WriteTextFileResult = StructSelf<typeof WriteTextFileResultStruct>;

export const ReadTextFileParamsSchema = z.object({
    path: z.string(),
    encoding: z.enum(["utf8", "base64"]).optional(),
});

export const ReadTextFileParamsStruct = struct.name("ReadTextFileParams")<z.output<typeof ReadTextFileParamsSchema>, z.input<typeof ReadTextFileParamsSchema>>(ReadTextFileParamsSchema);
export type ReadTextFileParams = StructSelf<typeof ReadTextFileParamsStruct>;

export const ReadTextFileResultSchema = z.object({
    content: z.string(),
    encoding: z.string(),
});

export const ReadTextFileResultStruct = struct.name("ReadTextFileResult")<z.output<typeof ReadTextFileResultSchema>, z.input<typeof ReadTextFileResultSchema>>(ReadTextFileResultSchema);
export type ReadTextFileResult = StructSelf<typeof ReadTextFileResultStruct>;

export const ListDirParamsSchema = z.object({
    path: z.string(),
    recursive: z.boolean().optional(),
});

export const ListDirParamsStruct = struct.name("ListDirParams")<z.output<typeof ListDirParamsSchema>, z.input<typeof ListDirParamsSchema>>(ListDirParamsSchema);
export type ListDirParams = StructSelf<typeof ListDirParamsStruct>;

export const DirEntrySchema = z.object({
    name: z.string(),
    path: z.string(),
    type: z.enum(["file", "directory"]),
    size: z.number().optional(),
});

export const DirEntryStruct = struct.name("DirEntry")<z.output<typeof DirEntrySchema>, z.input<typeof DirEntrySchema>>(DirEntrySchema);
export type DirEntry = StructSelf<typeof DirEntryStruct>;

export const ListDirResultSchema = z.object({
    entries: z.array(DirEntrySchema),
});

export const ListDirResultStruct = struct.name("ListDirResult")<z.output<typeof ListDirResultSchema>, z.input<typeof ListDirResultSchema>>(ListDirResultSchema);
export type ListDirResult = StructSelf<typeof ListDirResultStruct>;

export const CreateTerminalParamsSchema = z.object({
    command: z.string(),
    args: z.array(z.string()).optional(),
    cwd: z.string().optional(),
    env: z.record(z.string()).optional(),
});

export const CreateTerminalParamsStruct = struct.name("CreateTerminalParams")<z.output<typeof CreateTerminalParamsSchema>, z.input<typeof CreateTerminalParamsSchema>>(CreateTerminalParamsSchema);
export type CreateTerminalParams = StructSelf<typeof CreateTerminalParamsStruct>;

export const CreateTerminalResultSchema = z.object({
    handle: z.string(),
});

export const CreateTerminalResultStruct = struct.name("CreateTerminalResult")<z.output<typeof CreateTerminalResultSchema>, z.input<typeof CreateTerminalResultSchema>>(CreateTerminalResultSchema);
export type CreateTerminalResult = StructSelf<typeof CreateTerminalResultStruct>;

export const TerminalOutputParamsSchema = z.object({
    handle: z.string(),
});

export const TerminalOutputParamsStruct = struct.name("TerminalOutputParams")<z.output<typeof TerminalOutputParamsSchema>, z.input<typeof TerminalOutputParamsSchema>>(TerminalOutputParamsSchema);
export type TerminalOutputParams = StructSelf<typeof TerminalOutputParamsStruct>;

export const TerminalOutputResultSchema = z.object({
    output: z.string(),
    done: z.boolean(),
});

export const TerminalOutputResultStruct = struct.name("TerminalOutputResult")<z.output<typeof TerminalOutputResultSchema>, z.input<typeof TerminalOutputResultSchema>>(TerminalOutputResultSchema);
export type TerminalOutputResult = StructSelf<typeof TerminalOutputResultStruct>;

impl(SessionScopedTrait).for(PromptInputStruct, {
    sessionId: method((self: PromptInput) => self.sessionId),
});

impl(SessionScopedTrait).for(SessionUpdateParamsStruct, {
    sessionId: method((self: SessionUpdateParams) => self.sessionId),
});
