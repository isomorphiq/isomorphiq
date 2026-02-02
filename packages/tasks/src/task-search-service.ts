import type { TaskRepository } from "./task-repository.ts";
import type { Task, TaskSearchQuery, TaskSearchResult, TaskSearchFacets, TaskSavedSearch, TaskCreateSavedSearchInput, TaskUpdateSavedSearchInput } from "./types.ts";
import type { Result } from "@isomorphiq/core";
import { SavedSearchRepository } from "./saved-search-repository.ts";

export type TaskSearchHighlight = {
    title?: [number, number];
    description?: [number, number];
};

export type TaskSearchHighlights = Record<string, TaskSearchHighlight>;

export interface TaskSearchServiceApi {
    searchTasks(query: TaskSearchQuery): Promise<TaskSearchResult>;
    createSavedSearch(input: TaskCreateSavedSearchInput): Promise<TaskSavedSearch>;
    getSavedSearch(id: string): Promise<TaskSavedSearch | null>;
    listSavedSearches(createdBy?: string): Promise<TaskSavedSearch[]>;
    updateSavedSearch(input: TaskUpdateSavedSearchInput): Promise<TaskSavedSearch>;
    deleteSavedSearch(id: string): Promise<void>;
    executeSavedSearch(id: string): Promise<TaskSearchResult>;
}

/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class TaskSearchService implements TaskSearchServiceApi {
    private savedSearches: Map<string, TaskSavedSearch> = new Map();
    private repository: TaskRepository;

    constructor(repository: TaskRepository) {
        this.repository = repository;
    }

    async searchTasks(query: TaskSearchQuery): Promise<TaskSearchResult> {
        const allTasksResult = await this.repository.findAll();
        
        if (!allTasksResult.success) {
            throw new Error(`Failed to fetch tasks: ${allTasksResult.error?.message}`);
        }
        
        let filteredTasks = [...allTasksResult.data];
        
        // Apply text search
        if (query.q && query.q.trim().length > 0) {
            const searchTerm = query.q.toLowerCase().trim();
            filteredTasks = filteredTasks.filter(task => {
                const titleMatch = task.title.toLowerCase().includes(searchTerm);
                const descriptionMatch = task.description.toLowerCase().includes(searchTerm);
                const assignedToMatch = task.assignedTo?.toLowerCase().includes(searchTerm) || false;
                const createdByMatch = task.createdBy.toLowerCase().includes(searchTerm);
                
                return titleMatch || descriptionMatch || assignedToMatch || createdByMatch;
            });
        }
        
        // Apply status filter
        if (query.status && query.status.length > 0) {
            filteredTasks = filteredTasks.filter(task => 
                query.status!.includes(task.status)
            );
        }
        
        // Apply priority filter
        if (query.priority && query.priority.length > 0) {
            filteredTasks = filteredTasks.filter(task => 
                query.priority!.includes(task.priority)
            );
        }
        
        // Apply type filter
        if (query.type && query.type.length > 0) {
            filteredTasks = filteredTasks.filter(task => 
                query.type!.includes(task.type)
            );
        }
        
        // Apply assignee filter
        if (query.assignedTo && query.assignedTo.length > 0) {
            filteredTasks = filteredTasks.filter(task => 
                task.assignedTo && query.assignedTo!.includes(task.assignedTo)
            );
        }
        
        // Apply creator filter
        if (query.createdBy && query.createdBy.length > 0) {
            filteredTasks = filteredTasks.filter(task => 
                query.createdBy!.includes(task.createdBy)
            );
        }
        
        // Apply collaborators filter
        if (query.collaborators && query.collaborators.length > 0) {
            filteredTasks = filteredTasks.filter(task => {
                const collaborators = task.collaborators as unknown;
                return Array.isArray(collaborators) && 
                    (collaborators as string[]).some((collab: string) => 
                        query.collaborators!.includes(collab)
                    );
            });
        }
        
        // Apply watchers filter
        if (query.watchers && query.watchers.length > 0) {
            filteredTasks = filteredTasks.filter(task => {
                const watchers = task.watchers as unknown;
                return Array.isArray(watchers) && 
                    (watchers as string[]).some((watcher: string) => 
                        query.watchers!.includes(watcher)
                    );
            });
        }
        
        // Apply date range filter for creation date
        if (query.dateFrom || query.dateTo) {
            filteredTasks = filteredTasks.filter(task => {
                const taskDate = new Date(task.createdAt).getTime();
                const fromDate = query.dateFrom ? new Date(query.dateFrom).getTime() : 0;
                const toDate = query.dateTo ? new Date(query.dateTo).getTime() : Date.now();
                return taskDate >= fromDate && taskDate <= toDate;
            });
        }
        
        // Apply date range filter for updated date
        if (query.updatedFrom || query.updatedTo) {
            filteredTasks = filteredTasks.filter(task => {
                const taskDate = new Date(task.updatedAt).getTime();
                const fromDate = query.updatedFrom ? new Date(query.updatedFrom).getTime() : 0;
                const toDate = query.updatedTo ? new Date(query.updatedTo).getTime() : Date.now();
                return taskDate >= fromDate && taskDate <= toDate;
            });
        }
        
        // Apply tags filter
        if (query.tags && query.tags.length > 0) {
            filteredTasks = filteredTasks.filter(task => {
                const tags = task.tags as unknown;
                return Array.isArray(tags) && 
                    (tags as string[]).some((tag: string) => query.tags!.includes(tag));
            });
        }
        
        // Apply dependencies filter
        if (query.dependencies && query.dependencies.length > 0) {
            filteredTasks = filteredTasks.filter(task => 
                task.dependencies && task.dependencies.some((dep: string) => 
                    query.dependencies!.includes(dep)
                )
            );
        }
        
        // Apply hasDependencies filter
        if (query.hasDependencies !== undefined) {
            filteredTasks = filteredTasks.filter(task => {
                const hasDeps = task.dependencies && task.dependencies.length > 0;
                return query.hasDependencies ? hasDeps : !hasDeps;
            });
        }
        
        // Calculate facets
        const facets: TaskSearchFacets = {
            status: {},
            priority: {},
            type: {},
        };
        
        allTasksResult.data.forEach((task: Task) => {
            facets.status[task.status] = (facets.status[task.status] || 0) + 1;
            facets.priority[task.priority] = (facets.priority[task.priority] || 0) + 1;
            facets.type[task.type] = (facets.type[task.type] || 0) + 1;
        });
        
        // Sort tasks
        if (query.sort) {
            filteredTasks.sort((a, b) => {
                const { field, direction } = query.sort!;
                let aValue: any;
                let bValue: any;
                
                switch (field) {
                    case "title":
                        aValue = a.title.toLowerCase();
                        bValue = b.title.toLowerCase();
                        break;
                    case "createdAt":
                        aValue = new Date(a.createdAt).getTime();
                        bValue = new Date(b.createdAt).getTime();
                        break;
                    case "updatedAt":
                        aValue = new Date(a.updatedAt).getTime();
                        bValue = new Date(b.updatedAt).getTime();
                        break;
                    case "priority":
                        const priorityOrder = { "low": 1, "medium": 2, "high": 3 };
                        aValue = priorityOrder[a.priority as keyof typeof priorityOrder] || 0;
                        bValue = priorityOrder[b.priority as keyof typeof priorityOrder] || 0;
                        break;
                    case "status":
                        const statusOrder = { "todo": 1, "in-progress": 2, "done": 3, "invalid": 4 };
                        aValue = statusOrder[a.status as keyof typeof statusOrder] || 0;
                        bValue = statusOrder[b.status as keyof typeof statusOrder] || 0;
                        break;
                    default:
                        aValue = a[field as keyof Task];
                        bValue = b[field as keyof Task];
                }
                
                if (aValue < bValue) {
                    return direction === "asc" ? -1 : 1;
                } else if (aValue > bValue) {
                    return direction === "asc" ? 1 : -1;
                }
                return 0;
            });
        } else {
            // Default sort: by creation date (newest first)
            filteredTasks.sort((a, b) => 
                new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
            );
        }
        
        // Calculate total before pagination
        const total = filteredTasks.length;
        
        // Apply pagination
        const offset = query.offset || 0;
        const limit = query.limit || 50;
        const paginatedTasks = filteredTasks.slice(offset, offset + limit);
        
        // Generate highlights for text search
        const highlights: Record<string, { titleMatches?: number[]; descriptionMatches?: number[]; }> = {};
        if (query.q && query.q.trim().length > 0) {
            const searchTerm = query.q.toLowerCase();
            paginatedTasks.forEach(task => {
                highlights[task.id] = {};
                
                // Find title matches
                const titleLower = task.title.toLowerCase();
                let matchIndex = titleLower.indexOf(searchTerm);
                if (matchIndex !== -1) {
                    highlights[task.id].titleMatches = [matchIndex, matchIndex + searchTerm.length];
                }
                
                // Find description matches
                const descLower = task.description.toLowerCase();
                matchIndex = descLower.indexOf(searchTerm);
                if (matchIndex !== -1) {
                    highlights[task.id].descriptionMatches = [matchIndex, matchIndex + searchTerm.length];
                }
            });
        }
        
        // Generate suggestions for common misspellings
        const suggestions: string[] = [];
        if (query.q && query.q.length > 2) {
            const commonTerms = [
                "task",
                "bug",
                "theme",
                "initiative",
                "feature",
                "improvement",
                "documentation",
            ];
            const queryLower = query.q.toLowerCase();
            
            commonTerms.forEach(term => {
                if (term.includes(queryLower) || queryLower.includes(term)) {
                    return;
                }
                
                // Simple Levenshtein distance check for suggestions
                if (Math.abs(term.length - queryLower.length) <= 2 && 
                    term.substring(0, 2) === queryLower.substring(0, 2)) {
                    suggestions.push(term);
                }
            });
        }
        
        return {
            tasks: paginatedTasks,
            total,
            query,
            highlights: Object.keys(highlights).length > 0 ? highlights : undefined,
            facets,
            suggestions: suggestions.length > 0 ? suggestions : undefined,
        };
    }
    
    async createSavedSearch(input: TaskCreateSavedSearchInput): Promise<TaskSavedSearch> {
        const savedSearch: TaskSavedSearch = {
            id: crypto.randomUUID(),
            name: input.name,
            description: input.description || "",
            query: input.query,
            createdBy: "system", // TODO: Get from context
            isPublic: input.isPublic || false,
            createdAt: new Date(),
            updatedAt: new Date(),
            usageCount: 0,
        };
        
        this.savedSearches.set(savedSearch.id, savedSearch);
        return savedSearch;
    }
    
    async getSavedSearch(id: string): Promise<TaskSavedSearch | null> {
        return this.savedSearches.get(id) || null;
    }
    
    async listSavedSearches(createdBy?: string): Promise<TaskSavedSearch[]> {
        const searches = Array.from(this.savedSearches.values());
        if (createdBy) {
            return searches.filter(search => search.createdBy === createdBy);
        }
        return searches;
    }
    
    async updateSavedSearch(input: TaskUpdateSavedSearchInput): Promise<TaskSavedSearch> {
        const existing = this.savedSearches.get(input.id);
        
        if (!existing) {
            throw new Error(`Saved search not found: ${input.id}`);
        }
        
        const updated: TaskSavedSearch = {
            ...existing,
            name: input.name || existing.name,
            description: input.description !== undefined ? input.description : existing.description,
            query: input.query || existing.query,
            isPublic: input.isPublic !== undefined ? input.isPublic : existing.isPublic,
            updatedAt: new Date(),
        };
        
        this.savedSearches.set(input.id, updated);
        return updated;
    }
    
    async deleteSavedSearch(id: string): Promise<void> {
        this.savedSearches.delete(id);
    }
    
    async executeSavedSearch(id: string): Promise<TaskSearchResult> {
        const savedSearch = await this.getSavedSearch(id);
        if (!savedSearch) {
            throw new Error(`Saved search not found: ${id}`);
        }
        
        // Increment usage count
        const updatedSearch: TaskSavedSearch = {
            ...savedSearch,
            usageCount: savedSearch.usageCount + 1,
            updatedAt: new Date(),
        };
        
        this.savedSearches.set(id, updatedSearch);
        
        // Execute the search
        return await this.searchTasks(savedSearch.query);
    }
}

export function createTaskSearchService(repository: TaskRepository): TaskSearchService {
    return new TaskSearchService(repository);
}
