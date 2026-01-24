import { initTRPC } from "@trpc/server";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { observable } from "@trpc/server/observable";
import type {
    CreateSavedSearchInput,
    SearchQuery,
    UpdateSavedSearchInput,
} from "@isomorphiq/tasks";
import type { WebSocketEvent } from "@isomorphiq/realtime";
import type { ProductManager } from "@isomorphiq/tasks";
import type { WebSocketManager } from "@isomorphiq/realtime";

export type TrpcContext = { pm: ProductManager; wsManager?: WebSocketManager };

const t = initTRPC.context<TrpcContext>().create();

export const appRouter: ReturnType<typeof t.router> = t.router({
    tasks: t.procedure.query(async ({ ctx }) => ctx.pm.getAllTasks()),
    queue: t.procedure.query(async ({ ctx }) => ctx.pm.getTasksSortedByDependencies()),
    advancedSearch: t.procedure
        .input((query: unknown) => query as SearchQuery)
        .query(async ({ ctx, input }) => ctx.pm.searchTasks(input)),
    getSavedSearches: t.procedure
        .input((input: unknown) => input as { userId?: string })
        .query(async ({ ctx, input }) => ctx.pm.getSavedSearches(input.userId)),
    getSavedSearch: t.procedure
        .input((input: unknown) => input as { id: string; userId?: string })
        .query(async ({ ctx, input }) => ctx.pm.getSavedSearch(input.id, input.userId)),
    createSavedSearch: t.procedure
        .input((input: unknown) => input as { search: CreateSavedSearchInput; userId: string })
        .mutation(async ({ ctx, input }) => ctx.pm.createSavedSearch(input.search, input.userId)),
    updateSavedSearch: t.procedure
        .input((input: unknown) => input as { search: UpdateSavedSearchInput; userId: string })
        .mutation(async ({ ctx, input }) => ctx.pm.updateSavedSearch(input.search, input.userId)),
    deleteSavedSearch: t.procedure
        .input((input: unknown) => input as { id: string; userId: string })
        .mutation(async ({ ctx, input }) => {
            await ctx.pm.deleteSavedSearch(input.id, input.userId);
            return { success: true };
        }),
    taskUpdates: t.procedure.subscription(({ ctx }) => {
        return observable<WebSocketEvent>((emit) => {
            const wsMgr = ctx.wsManager;
            if (!wsMgr || typeof wsMgr.addListener !== "function") {
                emit.complete();
                return () => {};
            }

            const unsubscribe = wsMgr.addListener((event: WebSocketEvent) => emit.next(event));
            return () => unsubscribe();
        });
    }),
});

export type AppRouter = typeof appRouter;

export const createTrpcContext = (pm: ProductManager): TrpcContext => ({
    pm,
    wsManager: pm.getWebSocketManager(),
});

export const createTrpcMiddleware = (pm: ProductManager) =>
    createExpressMiddleware({ router: appRouter, createContext: () => createTrpcContext(pm) });
