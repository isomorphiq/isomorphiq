import { createLevelStore, type KeyValueStore } from "./persistence/key-value-store.ts";
import type { TaskSavedSearch, TaskCreateSavedSearchInput } from "./types.ts";

/**
 * Persistent storage for saved searches using LevelDB
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class SavedSearchRepository {
    private store: KeyValueStore<string, TaskSavedSearch>;

    constructor(databasePath: string) {
        this.store = createLevelStore(databasePath);
    }

    async initialize(): Promise<void> {
        // LevelDB initialization is handled by createLevelStore
        console.log("[SavedSearchRepository] Initialized");
    }

    async save(savedSearch: TaskSavedSearch): Promise<void> {
        await this.store.put(savedSearch.id, savedSearch);
    }

    async findById(id: string): Promise<TaskSavedSearch | null> {
        try {
            return await this.store.get(id);
        } catch (error: any) {
            if (error.message === "NotFound") {
                return null;
            }
            throw error;
        }
    }

    async findAll(createdBy?: string): Promise<TaskSavedSearch[]> {
        const searches: TaskSavedSearch[] = [];
        const iterator = this.store.iterator();
        
        for await (const [key, value] of iterator) {
            if (!createdBy || value.createdBy === createdBy) {
                searches.push(value);
            }
        }

        // Sort by creation date (newest first)
        searches.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        
        await iterator.close();
        return searches;
    }

    async update(savedSearch: TaskSavedSearch): Promise<void> {
        const existing = await this.findById(savedSearch.id);
        if (!existing) {
            throw new Error(`Saved search not found: ${savedSearch.id}`);
        }
        
        await this.store.put(savedSearch.id, savedSearch);
    }

    async delete(id: string): Promise<void> {
        const existing = await this.findById(id);
        if (!existing) {
            throw new Error(`Saved search not found: ${id}`);
        }
        
        await this.store.del(id);
    }

    async create(input: TaskCreateSavedSearchInput & { createdBy?: string }): Promise<TaskSavedSearch> {
        const savedSearch: TaskSavedSearch = {
            id: crypto.randomUUID(),
            name: input.name,
            description: input.description || "",
            query: input.query,
            createdBy: input.createdBy || "system",
            isPublic: input.isPublic || false,
            createdAt: new Date(),
            updatedAt: new Date(),
            usageCount: 0,
        };

        await this.save(savedSearch);
        return savedSearch;
    }

    async incrementUsageCount(id: string): Promise<TaskSavedSearch> {
        const savedSearch = await this.findById(id);
        if (!savedSearch) {
            throw new Error(`Saved search not found: ${id}`);
        }

        const updated: TaskSavedSearch = {
            ...savedSearch,
            usageCount: savedSearch.usageCount + 1,
            updatedAt: new Date(),
        };

        await this.update(updated);
        return updated;
    }

    async searchByName(name: string, createdBy?: string): Promise<TaskSavedSearch[]> {
        const allSearches = await this.findAll(createdBy);
        const nameLower = name.toLowerCase();
        
        return allSearches.filter(search => 
            search.name.toLowerCase().includes(nameLower)
        );
    }

    async findPublicSearches(): Promise<TaskSavedSearch[]> {
        const searches: TaskSavedSearch[] = [];
        const iterator = this.store.iterator();
        
        for await (const [key, value] of iterator) {
            if (value.isPublic) {
                searches.push(value);
            }
        }

        // Sort by usage count (most used first)
        searches.sort((a, b) => b.usageCount - a.usageCount);
        
        await iterator.close();
        return searches;
    }

    async getStatistics(createdBy?: string): Promise<{
        total: number;
        public: number;
        private: number;
        totalUsage: number;
    }> {
        const searches = await this.findAll(createdBy);
        
        const publicCount = searches.filter(s => s.isPublic).length;
        const privateCount = searches.length - publicCount;
        const totalUsage = searches.reduce((sum, s) => sum + s.usageCount, 0);

        return {
            total: searches.length,
            public: publicCount,
            private: privateCount,
            totalUsage,
        };
    }
}