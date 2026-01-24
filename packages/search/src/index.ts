import { z } from "zod";
import { impl, method, struct, trait } from "@tsimpl/runtime";
import type { StructSelf } from "@tsimpl/runtime";
import type { Self } from "@tsimpl/core";

export const SearchSortDirectionSchema = z.enum(["asc", "desc"]);
export type SearchSortDirection = z.output<typeof SearchSortDirectionSchema>;

export const SearchSortSchema = z.object({
    field: z.string(),
    direction: SearchSortDirectionSchema,
});

export const SearchSortStruct = struct.name("SearchSort")<z.output<typeof SearchSortSchema>, z.input<typeof SearchSortSchema>>(SearchSortSchema);
export type SearchSortBase = StructSelf<typeof SearchSortStruct>;
export type SearchSort<Field extends string = string> = Omit<SearchSortBase, "field"> & {
    field: Field;
};

export const SearchQuerySchema = z.object({
    q: z.string().optional(),
    status: z.array(z.string()).optional(),
    priority: z.array(z.string()).optional(),
    type: z.array(z.string()).optional(),
    assignedTo: z.array(z.string()).optional(),
    createdBy: z.array(z.string()).optional(),
    collaborators: z.array(z.string()).optional(),
    watchers: z.array(z.string()).optional(),
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
    updatedFrom: z.string().optional(),
    updatedTo: z.string().optional(),
    tags: z.array(z.string()).optional(),
    dependencies: z.array(z.string()).optional(),
    hasDependencies: z.boolean().optional(),
    sort: SearchSortSchema.optional(),
    limit: z.number().optional(),
    offset: z.number().optional(),
});

export const SearchQueryStruct = struct.name("SearchQuery")<z.output<typeof SearchQuerySchema>, z.input<typeof SearchQuerySchema>>(SearchQuerySchema);
export type SearchQueryBase = StructSelf<typeof SearchQueryStruct>;
export type SearchQuery<
    Status extends string = string,
    Priority extends string = string,
    Type extends string = string,
    SortField extends string = string,
> = Omit<SearchQueryBase, "status" | "priority" | "type" | "sort"> & {
    status?: Status[];
    priority?: Priority[];
    type?: Type[];
    sort?: SearchSort<SortField>;
};

export const SearchHighlightSchema = z.object({
    titleMatches: z.array(z.number()).optional(),
    descriptionMatches: z.array(z.number()).optional(),
});

export const SearchHighlightStruct = struct.name("SearchHighlight")<z.output<typeof SearchHighlightSchema>, z.input<typeof SearchHighlightSchema>>(SearchHighlightSchema);
export type SearchHighlight = StructSelf<typeof SearchHighlightStruct>;

export const SearchHighlightsSchema = z.record(SearchHighlightSchema);
export const SearchHighlightsStruct = struct.name("SearchHighlights")<z.output<typeof SearchHighlightsSchema>, z.input<typeof SearchHighlightsSchema>>(SearchHighlightsSchema);
export type SearchHighlights = StructSelf<typeof SearchHighlightsStruct>;

const facetCountsSchema = z.record(z.number());

export const SearchFacetsSchema = z.object({
    status: facetCountsSchema,
    priority: facetCountsSchema,
    type: facetCountsSchema,
    assignedTo: facetCountsSchema,
    createdBy: facetCountsSchema,
});

export const SearchFacetsStruct = struct.name("SearchFacets")<z.output<typeof SearchFacetsSchema>, z.input<typeof SearchFacetsSchema>>(SearchFacetsSchema);
export type SearchFacetsBase = StructSelf<typeof SearchFacetsStruct>;
export type SearchFacets<
    Status extends string = string,
    Priority extends string = string,
    Type extends string = string,
> = Omit<SearchFacetsBase, "status" | "priority" | "type"> & {
    status: Record<Status, number>;
    priority: Record<Priority, number>;
    type: Record<Type, number>;
};

export const SearchResultSchema = z.object({
    tasks: z.array(z.unknown()),
    total: z.number(),
    query: SearchQuerySchema,
    highlights: SearchHighlightsSchema.optional(),
    facets: SearchFacetsSchema.optional(),
    suggestions: z.array(z.string()).optional(),
});

export const SearchResultStruct = struct.name("SearchResult")<z.output<typeof SearchResultSchema>, z.input<typeof SearchResultSchema>>(SearchResultSchema);
export type SearchResultBase = StructSelf<typeof SearchResultStruct>;
export type SearchResult<
    Item = unknown,
    Status extends string = string,
    Priority extends string = string,
    Type extends string = string,
    SortField extends string = string,
> = Omit<SearchResultBase, "tasks" | "query" | "facets"> & {
    tasks: Item[];
    query: SearchQuery<Status, Priority, Type, SortField>;
    facets?: SearchFacets<Status, Priority, Type>;
};

export const SavedSearchSchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    query: SearchQuerySchema,
    createdBy: z.string(),
    isPublic: z.boolean(),
    createdAt: z.date(),
    updatedAt: z.date(),
    usageCount: z.number(),
});

export const SavedSearchStruct = struct.name("SavedSearch")<z.output<typeof SavedSearchSchema>, z.input<typeof SavedSearchSchema>>(SavedSearchSchema);
export type SavedSearchBase = StructSelf<typeof SavedSearchStruct>;
export type SavedSearch<
    Status extends string = string,
    Priority extends string = string,
    Type extends string = string,
    SortField extends string = string,
> = Omit<SavedSearchBase, "query"> & {
    query: SearchQuery<Status, Priority, Type, SortField>;
};

export const CreateSavedSearchInputSchema = z.object({
    name: z.string(),
    description: z.string().optional(),
    query: SearchQuerySchema,
    isPublic: z.boolean().optional(),
});

export const CreateSavedSearchInputStruct = struct.name("CreateSavedSearchInput")<z.output<typeof CreateSavedSearchInputSchema>, z.input<typeof CreateSavedSearchInputSchema>>(CreateSavedSearchInputSchema);
export type CreateSavedSearchInputBase = StructSelf<typeof CreateSavedSearchInputStruct>;
export type CreateSavedSearchInput<
    Status extends string = string,
    Priority extends string = string,
    Type extends string = string,
    SortField extends string = string,
> = Omit<CreateSavedSearchInputBase, "query"> & {
    query: SearchQuery<Status, Priority, Type, SortField>;
};

export const UpdateSavedSearchInputSchema = z.object({
    id: z.string(),
    name: z.string().optional(),
    description: z.string().optional(),
    query: SearchQuerySchema.optional(),
    isPublic: z.boolean().optional(),
});

export const UpdateSavedSearchInputStruct = struct.name("UpdateSavedSearchInput")<z.output<typeof UpdateSavedSearchInputSchema>, z.input<typeof UpdateSavedSearchInputSchema>>(UpdateSavedSearchInputSchema);
export type UpdateSavedSearchInputBase = StructSelf<typeof UpdateSavedSearchInputStruct>;
export type UpdateSavedSearchInput<
    Status extends string = string,
    Priority extends string = string,
    Type extends string = string,
    SortField extends string = string,
> = Omit<UpdateSavedSearchInputBase, "query"> & {
    query?: SearchQuery<Status, Priority, Type, SortField>;
};

export const SearchQueryTrait = trait({
    hasQuery: method<Self, boolean>(),
    hasFilters: method<Self, boolean>(),
});

impl(SearchQueryTrait).for(SearchQueryStruct, {
    hasQuery: method((self: SearchQueryBase) => typeof self.q === "string" && self.q.length > 0),
    hasFilters: method((self: SearchQueryBase) => {
        const hasStatus = (self.status?.length ?? 0) > 0;
        const hasPriority = (self.priority?.length ?? 0) > 0;
        const hasType = (self.type?.length ?? 0) > 0;
        const hasAssignedTo = (self.assignedTo?.length ?? 0) > 0;
        const hasCreatedBy = (self.createdBy?.length ?? 0) > 0;
        const hasCollaborators = (self.collaborators?.length ?? 0) > 0;
        const hasWatchers = (self.watchers?.length ?? 0) > 0;
        const hasDateRange =
            Boolean(self.dateFrom) ||
            Boolean(self.dateTo) ||
            Boolean(self.updatedFrom) ||
            Boolean(self.updatedTo);
        const hasTags = (self.tags?.length ?? 0) > 0;
        const hasDependencies = (self.dependencies?.length ?? 0) > 0 || self.hasDependencies === true;

        return (
            hasStatus ||
            hasPriority ||
            hasType ||
            hasAssignedTo ||
            hasCreatedBy ||
            hasCollaborators ||
            hasWatchers ||
            hasDateRange ||
            hasTags ||
            hasDependencies
        );
    }),
});

export const SearchResultTrait = trait({
    hasResults: method<Self, boolean>(),
});

impl(SearchResultTrait).for(SearchResultStruct, {
    hasResults: method((self: SearchResultBase) => self.total > 0 || self.tasks.length > 0),
});
