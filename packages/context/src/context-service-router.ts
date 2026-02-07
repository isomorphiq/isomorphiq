import { initTRPC } from "@trpc/server";
import { z } from "zod";
import {
    CreateContextInputSchema,
    FileContextLookupInputSchema,
    ReplaceContextInputSchema,
    UpdateContextInputSchema,
} from "./context-domain.ts";
import type { ContextService } from "./context-service.ts";

export type ContextServiceContext = {
    environment: string;
    contextService: ContextService;
};

const t = initTRPC.context<ContextServiceContext>().create();

export const contextServiceRouter = t.router({
    create: t.procedure
        .input(CreateContextInputSchema)
        .mutation(async ({ ctx, input }) => ctx.contextService.createContext(input)),
    getOrCreateFile: t.procedure
        .input(FileContextLookupInputSchema)
        .mutation(async ({ ctx, input }) => ctx.contextService.getOrCreateFileContext(input)),
    get: t.procedure
        .input(z.object({ id: z.string() }))
        .query(async ({ ctx, input }) => ctx.contextService.getContext(input.id)),
    update: t.procedure
        .input(UpdateContextInputSchema)
        .mutation(async ({ ctx, input }) =>
            ctx.contextService.updateContext(input.id, input.patch),
        ),
    replace: t.procedure
        .input(ReplaceContextInputSchema)
        .mutation(async ({ ctx, input }) =>
            ctx.contextService.replaceContext(input.id, input.data),
        ),
    delete: t.procedure
        .input(z.object({ id: z.string() }))
        .mutation(async ({ ctx, input }) => {
            await ctx.contextService.deleteContext(input.id);
            return { success: true };
        }),
    list: t.procedure.query(async ({ ctx }) => ctx.contextService.listContexts()),
});

export type ContextServiceRouter = typeof contextServiceRouter;
