import { initTRPC } from "@trpc/server";
import { z } from "zod";
import {
    CreateSavedSearchInputSchema,
    SearchQuerySchema,
    UpdateSavedSearchInputSchema,
    type CreateSavedSearchInput,
    type SearchQuery,
    type UpdateSavedSearchInput,
} from "./search-domain.ts";
import type { SearchService } from "./search-service.ts";

export type SearchServiceContext = {
    environment: string;
    searchService: SearchService;
};

const t = initTRPC.context<SearchServiceContext>().create();

export const searchServiceRouter = t.router({
    search: t.procedure
        .input(SearchQuerySchema)
        .query(async ({ ctx, input }) => {
            const query = SearchQuerySchema.parse(input) as SearchQuery;
            return ctx.searchService.search(query);
        }),
    createSavedSearch: t.procedure
        .input(
            z.object({
                input: CreateSavedSearchInputSchema,
                createdBy: z.string(),
            }),
        )
        .mutation(async ({ ctx, input }) => {
            const normalized =
                CreateSavedSearchInputSchema.parse(input.input) as CreateSavedSearchInput;
            return ctx.searchService.createSavedSearch(normalized, input.createdBy);
        }),
    listSavedSearches: t.procedure
        .input(
            z.object({
                userId: z.string().optional(),
            }),
        )
        .query(async ({ ctx, input }) =>
            ctx.searchService.listSavedSearches(input.userId),
        ),
    getSavedSearch: t.procedure
        .input(
            z.object({
                id: z.string(),
                userId: z.string().optional(),
            }),
        )
        .query(async ({ ctx, input }) =>
            ctx.searchService.getSavedSearch(input.id, input.userId),
        ),
    updateSavedSearch: t.procedure
        .input(
            z.object({
                input: UpdateSavedSearchInputSchema,
                userId: z.string(),
            }),
        )
        .mutation(async ({ ctx, input }) => {
            const normalized =
                UpdateSavedSearchInputSchema.parse(input.input) as UpdateSavedSearchInput;
            return ctx.searchService.updateSavedSearch(normalized, input.userId);
        }),
    deleteSavedSearch: t.procedure
        .input(
            z.object({
                id: z.string(),
                userId: z.string(),
            }),
        )
        .mutation(async ({ ctx, input }) =>
            ctx.searchService.deleteSavedSearch(input.id, input.userId),
        ),
    executeSavedSearch: t.procedure
        .input(
            z.object({
                id: z.string(),
                userId: z.string().optional(),
            }),
        )
        .query(async ({ ctx, input }) =>
            ctx.searchService.executeSavedSearch(input.id, input.userId),
        ),
});

export type SearchServiceRouter = typeof searchServiceRouter;
