import type {
    CreateSavedSearchInput,
    SavedSearch,
    SearchQuery,
    SearchResult,
    UpdateSavedSearchInput,
} from "./search-domain.ts";
import {
    createSavedSearchRepository,
    type SavedSearchRepository,
} from "./saved-search-repository.ts";
import {
    createTasksSearchClient,
    type TaskSearchOptionsLike,
    type TasksSearchClient,
    type TaskSearchSortField,
} from "./tasks-search-client.ts";

export type SearchService = {
    open: () => Promise<void>;
    close: () => Promise<void>;
    search: (query: SearchQuery) => Promise<SearchResult>;
    createSavedSearch: (input: CreateSavedSearchInput, createdBy: string) => Promise<SavedSearch>;
    listSavedSearches: (userId?: string) => Promise<SavedSearch[]>;
    getSavedSearch: (id: string, userId?: string) => Promise<SavedSearch | null>;
    updateSavedSearch: (input: UpdateSavedSearchInput, userId: string) => Promise<SavedSearch>;
    deleteSavedSearch: (id: string, userId: string) => Promise<void>;
    executeSavedSearch: (id: string, userId?: string) => Promise<SearchResult>;
};

export type SearchServiceOptions = {
    savedSearchesPath: string;
    environment: string;
    tasksServiceUrl?: string;
    repository?: SavedSearchRepository;
    tasksClient?: TasksSearchClient;
};

const mapSortField = (value: string | undefined): TaskSearchSortField | undefined => {
    if (!value) {
        return undefined;
    }
    if (value === "relevance") {
        return "title";
    }
    if (value === "title") return "title";
    if (value === "createdAt") return "createdAt";
    if (value === "updatedAt") return "updatedAt";
    if (value === "priority") return "priority";
    if (value === "status") return "status";
    return undefined;
};

const normalizeSearchQuery = (query: SearchQuery): TaskSearchOptionsLike => {
    const sortField = mapSortField(query.sort?.field);
    const sort =
        sortField && query.sort
            ? {
                field: sortField,
                direction: query.sort.direction,
            }
            : undefined;
    const filters =
        query.status ||
        query.priority ||
        query.assignedTo ||
        query.createdBy ||
        query.collaborators ||
        query.watchers ||
        query.dateFrom ||
        query.dateTo
            ? {
                status: query.status,
                priority: query.priority,
                assignedTo: query.assignedTo,
                createdBy: query.createdBy,
                collaborators: query.collaborators,
                watchers: query.watchers,
                dateFrom: query.dateFrom,
                dateTo: query.dateTo,
            }
            : undefined;

    return {
        query: query.q,
        filters,
        sort,
        limit: query.limit,
        offset: query.offset,
    };
};

const createSavedSearchId = (): string => `saved-search-${Date.now()}`;

export const createSearchService = (options: SearchServiceOptions): SearchService => {
    const repository = options.repository ?? createSavedSearchRepository(options.savedSearchesPath);
    const tasksClient =
        options.tasksClient
        ?? createTasksSearchClient({
            url: options.tasksServiceUrl,
            environment: options.environment,
        });

    const open = async (): Promise<void> => {
        await repository.open();
    };

    const close = async (): Promise<void> => {
        await repository.close();
    };

    const search = async (query: SearchQuery): Promise<SearchResult> => {
        const normalized = normalizeSearchQuery(query);
        const result = await tasksClient.searchTasks(normalized);
        return {
            tasks: result.tasks,
            total: result.total,
            query,
        };
    };

    const createSavedSearch = async (
        input: CreateSavedSearchInput,
        createdBy: string,
    ): Promise<SavedSearch> => {
        const now = new Date();
        const savedSearch: SavedSearch = {
            id: createSavedSearchId(),
            name: input.name,
            description: input.description,
            query: input.query,
            createdBy,
            isPublic: input.isPublic ?? false,
            createdAt: now,
            updatedAt: now,
            usageCount: 0,
        };
        await repository.put(savedSearch);
        return savedSearch;
    };

    const listSavedSearches = async (userId?: string): Promise<SavedSearch[]> => {
        const searches = await repository.list();
        const visible = searches.filter(
            (search) => search.isPublic || (userId && search.createdBy === userId),
        );
        return visible.sort(
            (left, right) => right.updatedAt.getTime() - left.updatedAt.getTime(),
        );
    };

    const getSavedSearch = async (
        id: string,
        userId?: string,
    ): Promise<SavedSearch | null> => {
        const savedSearch = await repository.get(id);
        if (!savedSearch) {
            return null;
        }
        if (!savedSearch.isPublic && (!userId || savedSearch.createdBy !== userId)) {
            return null;
        }

        const updated: SavedSearch = {
            ...savedSearch,
            usageCount: savedSearch.usageCount + 1,
            updatedAt: new Date(),
        };
        await repository.put(updated);
        return updated;
    };

    const updateSavedSearch = async (
        input: UpdateSavedSearchInput,
        userId: string,
    ): Promise<SavedSearch> => {
        const existing = await repository.get(input.id);
        if (!existing) {
            throw new Error("Saved search not found");
        }
        if (existing.createdBy !== userId) {
            throw new Error("Not authorized to update this saved search");
        }

        const updated: SavedSearch = {
            ...existing,
            ...(input.name ? { name: input.name } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
            ...(input.query ? { query: input.query } : {}),
            ...(input.isPublic !== undefined ? { isPublic: input.isPublic } : {}),
            updatedAt: new Date(),
        };

        await repository.put(updated);
        return updated;
    };

    const deleteSavedSearch = async (id: string, userId: string): Promise<void> => {
        const existing = await repository.get(id);
        if (!existing) {
            throw new Error("Saved search not found");
        }
        if (existing.createdBy !== userId) {
            throw new Error("Not authorized to delete this saved search");
        }
        await repository.del(id);
    };

    const executeSavedSearch = async (
        id: string,
        userId?: string,
    ): Promise<SearchResult> => {
        const savedSearch = await getSavedSearch(id, userId);
        if (!savedSearch) {
            throw new Error("Saved search not found");
        }
        return await search(savedSearch.query);
    };

    return {
        open,
        close,
        search,
        createSavedSearch,
        listSavedSearches,
        getSavedSearch,
        updateSavedSearch,
        deleteSavedSearch,
        executeSavedSearch,
    };
};
